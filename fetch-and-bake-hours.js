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
  snap.forEach(d => { status[d.id] = d.data(); });
  console.log('Fetched ' + Object.keys(status).length + ' hourStatus doc(s).');
  fs.writeFileSync(STATUS_JSON, JSON.stringify(status, null, 2));
  // bake into the location files in place (idempotent; reverts downgrades)
  const locFiles = fs.readdirSync(__dirname).filter(f => /-locations\.js$/.test(f));
  if (!locFiles.length){ console.log('No *-locations.js files here.'); process.exit(0); }
  execFileSync('node', ['bake-hours.js', STATUS_JSON, ...locFiles], { stdio:'inherit' });
  console.log('\nReview the changed *-locations.js, then commit/push (bump sw.js).');
  process.exit(0);
}
main().catch(err => { console.error('\n\u2717 Failed:', err.message || err); process.exit(1); });
