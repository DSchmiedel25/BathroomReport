'use strict';
// fetch-and-bake-hours.js — read hourStatus from Firestore (read-only) and bake verified community
// hours into the static *-locations.js files via bake-hours.js. Mirrors fetch-and-bake.js.
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
  console.log('Reading hourStatus from Firestore (read-only)\u2026');
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
  console.log('\nReview the changed *-locations.js, then commit/push (bump sw.js).');
  process.exit(0);
}
main().catch(err => { console.error('\n\u2717 Failed:', err.message || err); process.exit(1); });
