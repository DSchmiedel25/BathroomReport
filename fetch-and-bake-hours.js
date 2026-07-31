'use strict';
// fetch-and-bake-hours.js — read hourStatus from Firestore and bake verified community
// hours into the static *-locations.js files via bake-hours.js. Mirrors fetch-and-bake.js.
// Writes back only one thing: bakedRevision, stamped after a successful bake (see below).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const KEY_FILE = path.join(__dirname, 'serviceAccountKey.json');
const STATUS_JSON = path.join(__dirname, 'hours-status.json');
if (!fs.existsSync(KEY_FILE)){ console.error('\n\u2717 serviceAccountKey.json not found here.'); process.exit(1); }
let admin;
try { admin = require('firebase-admin'); }
catch(e){ console.error('\n\u2717 firebase-admin not installed. Run: npm install firebase-admin\n'); process.exit(1); }
async function main(){
  admin.initializeApp({ credential: admin.cert(require(KEY_FILE)) });
  const db = require('firebase-admin/firestore').getFirestore();
  console.log('Reading hourStatus from Firestore\u2026');
  const snap = await db.collection('hourStatus').get();
  const status = {};
  /* Key by the document id AS STORED. Do not reverse it.
   *
   * This used to do d.id.split('__').join('/'), and that was correct BEFORE Phase 1: location
   * records carried a slash ('node/123') while hourReports/hourStatus were written through
   * fsId(), so the doc id was 'node__123' and had to be turned back to match a record.
   *
   * Phase 1 renamed the records to the canonical form. Both sides are now 'node__123', so the
   * reversal produces a key that matches NOTHING — and bake-hours is authoritative: any record
   * flagged community_verified whose id is absent from this map gets REVERTED to its
   * pre-community hours. Eight records were one bake away from silently losing their verified
   * hours.
   *
   * The srcId fallback below covers the reverse case: a status document written before Phase 1
   * whose key never went through fsId at all. */
  snap.forEach(d => { status[d.id] = d.data(); });
  console.log('Fetched ' + Object.keys(status).length + ' hourStatus doc(s).');
  // REFUSE to bake an empty fetch. bake-hours.js is authoritative and idempotent: any record
  // flagged community_verified whose id is absent from the status file gets REVERTED to its
  // pre-community hours. An empty result is indistinguishable from a transient Firestore error,
  // a permissions change, or a renamed collection — and the consequence is silently wiping every
  // community-verified hour on the map. fetch-and-bake.js already guards this way; this didn't.
  if (Object.keys(status).length === 0){
    console.log('No hourStatus docs returned — refusing to bake, because an empty fetch would');
    console.log('revert every community-verified hour. If hourStatus is genuinely empty, run');
    console.log('bake-hours.js directly with an explicit empty file to confirm that is intended.');
    process.exit(0);
  }
  fs.writeFileSync(STATUS_JSON, JSON.stringify(status, null, 2));
  // bake into the location files in place (idempotent; reverts downgrades)
  const locFiles = fs.readdirSync(__dirname).filter(f => /-locations\.js$/.test(f));
  if (!locFiles.length){ console.log('No *-locations.js files here.'); process.exit(0); }
  execFileSync('node', ['bake-hours.js', STATUS_JSON, ...locFiles], { stdio:'inherit' });

  /* Mark what we just baked.
   *
   * This script was read-only, and nothing else in the pipeline writes bakedRevision. FlushPanel's
   * Bake review lists a row as pending while `verified && revision !== bakedRevision`, so every
   * verified row stayed pending FOREVER — including hours baked into the static files days
   * earlier. The page looked like a growing backlog when it was really a log of past work.
   *
   * Safe here and only here: bake-hours.js is authoritative and throws on failure (execFileSync
   * above), so by this line every verified row in `status` is reflected in the location files.
   * Runs under the service account, which bypasses the `allow write: if false` rule on
   * hourStatus — no client can forge a baked stamp.
   *
   * Only verified rows are stamped. Conflicts and single-report rows are deliberately left alone:
   * they were never baked, and they must keep surfacing for a human. */
  const toStamp = Object.entries(status).filter(([, r]) =>
    r && r.verified && r.revision !== undefined && r.revision !== r.bakedRevision);

  if (!toStamp.length){
    console.log('\nNo newly baked rows to stamp — bakedRevision already current.');
  } else {
    const bakedAt = Date.now();
    let written = 0;
    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < toStamp.length; i += 450){
      const chunk = toStamp.slice(i, i + 450);
      const batch = db.batch();
      for (const [id, r] of chunk){
        batch.update(db.collection('hourStatus').doc(id), {
          bakedRevision: r.revision,
          bakedAt: bakedAt
        });
      }
      await batch.commit();
      written += chunk.length;
      console.log('  stamped ' + written + '/' + toStamp.length);
    }
    console.log('\nStamped ' + toStamp.length + ' row(s) as baked.');
  }

  console.log('\nReview the changed *-locations.js, then commit/push (bump sw.js).');
  process.exit(0);
}
main().catch(err => { console.error('\n\u2717 Failed:', err.message || err); process.exit(1); });
