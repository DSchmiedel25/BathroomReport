#!/usr/bin/env node
/*
 * BathroomReport — one-time backfill of contribution credits
 * ------------------------------------------------------------
 * The credit triggers in functions/index.js only fire on WRITES. Everything already approved
 * before they were deployed has no credit document, so without this pass a moderator's entire
 * back catalogue of resolved reports counts for nothing.
 *
 * Run it once, after deploying the functions. Safe to run repeatedly: every credit document id
 * is derived from the thing it credits, so a second pass writes the same documents and the
 * counts do not move.
 *
 * WHAT IT CREDITS
 *   reportHistory   status === 'resolved'  -> report_{id}   (dismissed credits nothing)
 *   missingReports  status === 'resolved'  -> place_{id}    (only those carrying a uid)
 *   hourStatus      verified === true      -> hours_{storeId} for every matching submitter
 *
 * USAGE
 *   node backfill-credits.js --dry-run     inspect first, writes nothing
 *   node backfill-credits.js               apply
 *
 * Needs serviceAccountKey.json in the working directory. That file is gitignored and must stay
 * that way — it grants full database access.
 * ------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry-run');

const KEY = path.join(process.cwd(), 'serviceAccountKey.json');
if (!fs.existsSync(KEY)) {
  console.error('serviceAccountKey.json not found in ' + process.cwd());
  console.error('Firebase Console -> Project settings -> Service accounts -> Generate new key.');
  process.exit(1);
}

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({ credential: cert(require(KEY)) });
const db = getFirestore();

/* Mirrors canonicalize() in functions/index.js closely enough to compare values. The trigger
 * compares a submission's canonical value against the verified one; here the verified value is
 * already canonical because hourStatus stores what the function computed, so only the
 * submission side needs normalising. A single window is a string, a per-day report is a map. */
function canonValue(value, kind) {
  if (kind === 'single') return typeof value === 'string' ? value : null;
  if (kind === 'perday') return (value && typeof value === 'object') ? value : null;
  return null;
}

let granted = 0, skipped = 0;

async function credit(uid, creditId, payload) {
  if (!uid || !creditId) { skipped++; return; }
  granted++;
  if (DRY) return;
  await db.doc('userStats/' + uid + '/credits/' + creditId)
    .set({ ...payload, grantedAt: Date.now(), backfilled: true }, { merge: true });
}

async function backfillReports() {
  const snap = await db.collection('reportHistory').get();
  let n = 0;
  for (const doc of snap.docs) {
    const r = doc.data();
    if (r.status !== 'resolved' || !r.reporterId) continue;
    await credit(r.reporterId, 'report_' + doc.id, { type: 'report', locId: r.locId || null });
    n++;
  }
  console.log(`reportHistory: ${snap.size} archived, ${n} resolved and credited`);
}

async function backfillPlaces() {
  const snap = await db.collection('missingReports').get();
  let n = 0, orphan = 0;
  for (const doc of snap.docs) {
    const m = doc.data();
    if (m.status !== 'resolved') continue;
    // Submissions predating the uid field have nothing tying them to a person. Counted here so
    // the number is visible rather than silently absent.
    if (!m.uid) { orphan++; continue; }
    await credit(m.uid, 'place_' + doc.id, { type: 'place' });
    n++;
  }
  console.log(`missingReports: ${snap.size} total, ${n} credited, ${orphan} resolved but unattributable`);
}

async function backfillHours() {
  const snap = await db.collection('hourStatus').get();
  let stores = 0, people = 0;
  for (const doc of snap.docs) {
    const st = doc.data();
    if (st.verified !== true || st.value === undefined || st.value === null) continue;
    const target = JSON.stringify(st.value);
    const subs = await db.collection('hourReports/' + doc.id + '/submissions').get();
    const winners = new Set();
    for (const sub of subs.docs) {
      const s = sub.data();
      const v = canonValue(s.value, s.kind);
      if (v === null || !s.uid) continue;
      if (JSON.stringify(v) !== target) continue;   // outvoted: contributed to the tally, not the answer
      winners.add(s.uid);
    }
    if (!winners.size) continue;
    for (const uid of winners) {
      await credit(uid, 'hours_' + doc.id, { type: 'hours', storeId: doc.id });
      people++;
    }
    // Same ledger the trigger keeps, so a later change can revoke cleanly.
    if (!DRY) {
      await db.doc('hourCredits/' + doc.id)
        .set({ uids: [...winners], updatedAt: Date.now() }, { merge: true });
    }
    stores++;
  }
  console.log(`hourStatus: ${stores} verified stores, ${people} contributor credits`);
}

(async () => {
  console.log(DRY ? '— DRY RUN, nothing will be written —' : '— APPLYING —');
  await backfillReports();
  await backfillPlaces();
  await backfillHours();
  console.log(`\ntotal credits ${DRY ? 'that would be granted' : 'granted'}: ${granted}` +
    (skipped ? `  (${skipped} skipped for a missing uid)` : ''));
  if (DRY) console.log('Re-run without --dry-run to apply.');
})().catch((e) => { console.error('backfill failed:', e); process.exit(1); });
