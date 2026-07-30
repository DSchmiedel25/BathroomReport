#!/usr/bin/env node
/* rebuild-aggregates.js — recompute every aggregates/{locId} from the votes collection.
 *
 * WHY THIS EXISTS
 * The amenity tallies in aggregates/{locId}.amen only started being written when
 * recomputeBathroomAggregate learned to write them. Every amenity answer cast before that is
 * absent from the counters. The trigger now CLAMPS at zero, so a stale decrement can no longer
 * drive a count negative — but the counts are still an undercount until this runs once.
 *
 * Undercount is safe: an amenity simply takes longer to reach CONFIRM_THRESHOLD. Negative was
 * not safe, which is why the clamp shipped first and this is optional.
 *
 * Rating totals (bathroomSum / bathroomCount) have been maintained since day one, so they are
 * recomputed here too as a consistency check rather than a repair — if this changes them, the
 * trigger has been dropping writes and that is worth knowing.
 *
 * USAGE
 *   node tools/rebuild-aggregates.js            # report only, writes nothing
 *   node tools/rebuild-aggregates.js --write    # apply
 *
 * Needs serviceAccountKey.json in the repo root, same as the bake scripts. NEVER commit that.
 */
const admin = require('firebase-admin');
const path  = require('path');

const WRITE = process.argv.includes('--write');

// Must match AMENITY_KEYS in functions/index.js and the rules allowlist. tools/audit-ui.js
// check 15 fails the build if those two drift; this is a third copy and deliberately narrow —
// an unknown key here would recreate the field-path problem the allowlist exists to prevent.
const AMENITY_KEYS = new Set([
  'restroomType', 'accessible', 'changing', 'hasRestroom',
  'evCharging', 'airPump', 'shower', 'indoorSeating', 'wifi', 'grabAndGo', 'hotFood',
]);

// Same normalisation the app and functions use: '/' is a Firestore path separator.
const fsId = (id) => String(id == null ? '' : id).replace(/\//g, '__');

admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve('serviceAccountKey.json'))),
});
const db = admin.firestore();

(async () => {
  console.log(WRITE ? 'REBUILDING aggregates from votes...' : 'DRY RUN — reporting only, nothing will be written\n');

  const votes = await db.collection('votes').get();
  console.log(`read ${votes.size} vote document(s)`);

  const agg = {};   // locId -> { sum, count, amen: { key: {yes,no} }, lastRatedAt, lastRatedBy }
  let skipped = 0;
  votes.forEach((doc) => {
    const v = doc.data() || {};
    const locId = v.locId;
    if (!locId) { skipped++; return; }
    const a = (agg[locId] = agg[locId] || { sum: 0, count: 0, amen: {}, lastRatedAt: 0, lastRatedBy: null });

    if (typeof v.bathroom === 'number' && v.bathroom > 0) {
      a.sum += v.bathroom;
      a.count += 1;
      const t = typeof v.ratedAt === 'number' ? v.ratedAt : (typeof v.lastUpdated === 'number' ? v.lastUpdated : 0);
      if (t > a.lastRatedAt) {
        a.lastRatedAt = t;
        a.lastRatedBy = typeof v.username === 'string' && v.username ? v.username.slice(0, 40) : null;
      }
    }
    for (const field of ['amenities', 'storeFeatures']) {
      const m = v[field];
      if (!m || typeof m !== 'object') continue;
      for (const [key, val] of Object.entries(m)) {
        if (!AMENITY_KEYS.has(key)) continue;
        const s = String(val);
        if (s !== 'yes' && s !== 'no') continue;
        const cell = (a.amen[key] = a.amen[key] || { yes: 0, no: 0 });
        cell[s] += 1;
      }
    }
  });
  if (skipped) console.log(`  ${skipped} vote(s) had no locId and were ignored`);
  console.log(`computed totals for ${Object.keys(agg).length} location(s)\n`);

  // Compare against what is stored, so a dry run tells you whether anything is actually wrong.
  let ratingDrift = 0, amenDrift = 0, negatives = 0, created = 0;
  const batchLimit = 400;
  let batch = db.batch(), inBatch = 0, written = 0;

  for (const [locId, a] of Object.entries(agg)) {
    const ref = db.doc(`aggregates/${fsId(locId)}`);
    const snap = await ref.get();
    const cur = snap.exists ? (snap.data() || {}) : {};
    if (!snap.exists) created++;

    if ((cur.bathroomSum || 0) !== a.sum || (cur.bathroomCount || 0) !== a.count) {
      ratingDrift++;
      console.log(`  rating drift ${locId}: stored ${cur.bathroomSum || 0}/${cur.bathroomCount || 0} -> computed ${a.sum}/${a.count}`);
    }
    const curAmen = (cur.amen && typeof cur.amen === 'object') ? cur.amen : {};
    for (const [k, cell] of Object.entries(a.amen)) {
      const c = curAmen[k] || {};
      if ((c.yes || 0) !== cell.yes || (c.no || 0) !== cell.no) amenDrift++;
    }
    for (const cell of Object.values(curAmen)) {
      if ((cell && cell.yes < 0) || (cell && cell.no < 0)) negatives++;
    }

    if (WRITE) {
      batch.set(ref, {
        schemaVersion: 2,
        bathroomSum: a.sum,
        bathroomCount: a.count,
        amen: a.amen,
        lastUpdated: Date.now(),
        ...(a.lastRatedAt ? { lastRatedAt: a.lastRatedAt } : {}),
        ...(a.lastRatedBy ? { lastRatedBy: a.lastRatedBy } : {}),
      }, { merge: true });
      if (++inBatch >= batchLimit) { await batch.commit(); written += inBatch; batch = db.batch(); inBatch = 0; }
    }
  }
  if (WRITE && inBatch) { await batch.commit(); written += inBatch; }

  console.log('');
  console.log(`  aggregates that do not exist yet : ${created}`);
  console.log(`  rating totals disagreeing        : ${ratingDrift}   (should be 0 — the trigger has always maintained these)`);
  console.log(`  amenity counters disagreeing     : ${amenDrift}   (expected > 0 before the first run)`);
  console.log(`  NEGATIVE counters found          : ${negatives}   (the trigger now clamps, so this only shows pre-existing damage)`);
  console.log('');
  console.log(WRITE ? `WROTE ${written} aggregate document(s).` : 'Dry run complete. Re-run with --write to apply.');
  process.exit(0);
})().catch((e) => { console.error('rebuild failed:', e); process.exit(1); });
