#!/usr/bin/env node
// export-votes.js — snapshot community amenity/feature votes into votes-summary.json.
//
// YOU run this (it needs read access to your Firestore, which Claude does not have). It reads
// the whole `votes` collection once and aggregates per location into yes/no tallies — the same
// counts the app computes live per popup — then writes a small summary file you upload to Claude
// for baking into the *-locations.js files.
//
// SETUP (one time, on a computer with Node — not the phone):
//   1. Firebase console → Project settings → Service accounts → "Generate new private key".
//      Save it next to this file as  serviceAccountKey.json  (never commit it).
//   2. npm install firebase-admin
//
// RUN:
//   node export-votes.js
//   -> writes votes-summary.json  (upload this to Claude)
//
// The summary contains ONLY aggregate counts keyed by location id — no user identifiers.

const admin = require('firebase-admin');
const fs = require('fs');

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();

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

  // Stream the collection so a large votes set doesn't blow memory.
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

  fs.writeFileSync('votes-summary.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    votesScanned: voteCount,
    locations: summary
  }));
  console.log(`Wrote votes-summary.json — ${voteCount} votes across ${Object.keys(summary).length} locations. Upload this to Claude.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
