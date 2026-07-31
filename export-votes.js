#!/usr/bin/env node
// export-votes.js — snapshot community amenity/feature votes into votes-summary.json.
//
// Runs in the nightly bake workflow (and can be run by hand on any machine with Node).
// It reads the whole `votes` collection once and aggregates per location into yes/no tallies —
// the same counts the app computes live per popup — then writes votes-summary.json, which
// bake-confirmed.js folds into the *-locations.js files.
//
// SETUP (only needed for a manual run; the workflow supplies the key from a secret):
//   1. Firebase console → Project settings → Service accounts → "Generate new private key".
//      Save it next to this file as  serviceAccountKey.json  (never commit it).
//   2. npm install firebase-admin
//
// RUN:
//   node export-votes.js      -> writes votes-summary.json
//
// The summary contains ONLY aggregate counts keyed by location id — no user identifiers.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_FILE = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(KEY_FILE)) {
  console.error('\n\u2717 serviceAccountKey.json not found here.');
  process.exit(1);
}

/* Initialise exactly the way fetch-and-bake-hours.js does.
 *
 * This used to call admin.credential.cert(...), which threw
 *   TypeError: Cannot read properties of undefined (reading 'cert')
 * every night — `credential` is not present on the object this firebase-admin version returns,
 * while `cert` is. The failure was invisible because bake.yml ended the step with
 * `|| echo "... — continuing"`, so the amenity bake has not run in a long time.
 *
 * Keep this in step with fetch-and-bake.js and fetch-and-bake-hours.js: if one of them changes
 * how it initialises, they all should, because they all run in the same workflow against the
 * same installed version. */
admin.initializeApp({ credential: admin.cert(require(KEY_FILE)) });
const db = require('firebase-admin/firestore').getFirestore();

/* Feature keys the app tracks. Bathroom answers live under vote.amenities, store answers under
 * vote.storeFeatures, and the two sets are DISJOINT — the same key in both would let one person
 * confirm something twice.
 *
 * These lists had gone stale and it mattered. They still named `handDrying`, an amenity that no
 * longer exists, and OMITTED hasRestroom, grabAndGo and hotFood. So the nightly bake never baked
 * a single hasRestroom confirmation — the one question that can prune a pin from the map. That
 * feature has had no working path at all: the aggregate never carried it either.
 *
 * restroomType is deliberately absent: it is multi-state (single / multiple), not yes/no, so it
 * does not reduce to a confirmation count. tools/audit-ui.js check 15 holds these in step with
 * app.js, the rules and functions/index.js. */
const AMENITY_KEYS = ['accessible', 'changing', 'hasRestroom'];
const STORE_KEYS   = ['evCharging', 'airPump', 'shower', 'indoorSeating', 'wifi', 'grabAndGo', 'hotFood'];

(async () => {
  const summary = {};   // locId -> { amenities:{key:{yes,no}}, storeFeatures:{key:{yes,no}} }
  let voteCount = 0;

  const snap = await db.collection('votes').get();
  snap.forEach(doc => {
    const v = doc.data();
    const locId = v.locId;
    if (!locId) return;
    voteCount++;

    const rec = summary[locId] || (summary[locId] = { amenities: {}, storeFeatures: {} });

    const am = v.amenities || {};
    for (const k of AMENITY_KEYS) {
      if (am[k] === 'yes' || am[k] === 'no') {
        const t = rec.amenities[k] || (rec.amenities[k] = { yes: 0, no: 0 });
        t[am[k]]++;
      }
    }
    const sf = v.storeFeatures || {};
    for (const k of STORE_KEYS) {
      if (sf[k] === 'yes' || sf[k] === 'no') {
        const t = rec.storeFeatures[k] || (rec.storeFeatures[k] = { yes: 0, no: 0 });
        t[sf[k]]++;
      }
    }
  });

  /* Refuse to write an empty summary.
   *
   * bake-confirmed.js treats this file as authoritative, so a summary with no locations would
   * clear confirmations rather than leave them alone — the same failure mode fetch-and-bake.js
   * and fetch-and-bake-hours.js both already guard against. An empty read is indistinguishable
   * from a transient Firestore error or a permissions change. */
  if (voteCount === 0) {
    console.log('No votes returned — refusing to write votes-summary.json, because an empty');
    console.log('summary could clear existing confirmations. Nothing written.');
    process.exit(0);
  }

  fs.writeFileSync(path.join(__dirname, 'votes-summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    votesScanned: voteCount,
    locations: summary
  }));
  console.log(`Wrote votes-summary.json — ${voteCount} votes across ${Object.keys(summary).length} locations.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
