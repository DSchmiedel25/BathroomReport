#!/usr/bin/env node
'use strict';
/*
 * prune-overrides.js — retire overrides that are already baked into the static files.
 *
 * WHY THIS IS SAFE, AND WHERE IT STOPS
 *
 * bake-overrides.js only ever SETS fields; it never reverts one. So once an override's values
 * are present in the *-locations.js record, deleting the override changes nothing users see.
 * This script verifies that field by field using the SAME comparison bake-overrides.js uses —
 * if the two ever disagreed, this would retire something the bake never actually applied.
 * FIELD_MAP below is copied from bake-overrides.js and must stay in step with it.
 *
 * `remove: true` overrides are NEVER retired. They are the only ones that must survive: they
 * are the memory of "this pin is not real." A regenerated chain will happily re-add a rejected
 * location, and has — two Casey's records in Billings MT came back under new ids during a
 * rebuild because nothing remembered they had been rejected.
 *
 * Orphans (no matching record) are reported but NOT touched by default. An override with no
 * record could be a pending create that the bake skipped for a fixable reason, and deleting it
 * throws the correction away. Pass --include-orphans once you have read the list.
 *
 * Nothing is deleted outright: each doc is copied to `overridesArchive` first, so a from-scratch
 * chain rebuild can replay it.
 *
 * USAGE
 *   node prune-overrides.js                  # dry run — report only, no writes
 *   node prune-overrides.js --apply          # archive + delete the eligible ones
 *   node prune-overrides.js --apply --days 30
 *   node prune-overrides.js --apply --include-orphans
 */

const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, 'serviceAccountKey.json');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ORPHANS = args.includes('--include-orphans');
const AGE_DAYS = args.includes('--days')
  ? parseInt(args[args.indexOf('--days') + 1], 10) : 14;

if (!fs.existsSync(KEY_FILE)) {
  console.error('\n\u2717 serviceAccountKey.json not found here.');
  process.exit(1);
}
let admin;
try { admin = require('firebase-admin'); }
catch (e) {
  console.error('\n\u2717 firebase-admin not installed. Run: npm install firebase-admin\n');
  process.exit(1);
}

// ---- copied verbatim from bake-overrides.js ------------------------------
const FIELD_MAP = {
  hrs: 'hrs', hours: 'hours', addr: 'addr', city: 'city', state: 'state',
  zipCode: 'zipCode', phone: 'phone', lat: 'lat', lng: 'lng', locName: 'n'
};

function looksLikeDataFile(src) {
  if (/^\s*#!/.test(src)) return false;
  return /^\s*window\.[A-Za-z_$][\w$]*\s*=\s*\[/m.test(src);
}

function loadLocationsFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (!looksLikeDataFile(src)) return null;
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox.window);
  const varName = Object.keys(sandbox.window)[0];
  return { varName, records: sandbox.window[varName] };
}

/** Mirrors applyOverride() in bake-overrides.js, but reports instead of mutating.
 *  Returns the list of fields the bake WOULD still change. Empty === fully applied. */
function pendingChanges(rec, ov) {
  const changes = [];
  for (const [ovKey, recKey] of Object.entries(FIELD_MAP)) {
    if (!(ovKey in ov)) continue;
    const val = ov[ovKey];
    // empty hrs / empty hours map means "unknown" -> the bake DELETES the field
    if ((ovKey === 'hrs' && val === '') ||
        (ovKey === 'hours' && val && Object.keys(val).length === 0)) {
      if (recKey in rec) changes.push(recKey + ' (clear)');
      continue;
    }
    if (JSON.stringify(rec[recKey]) !== JSON.stringify(val)) changes.push(recKey);
  }
  return changes;
}

// ---------------------------------------------------------------------------

async function main() {
  admin.initializeApp({ credential: admin.cert(require(KEY_FILE)) });
  const db = require('firebase-admin/firestore').getFirestore();

  // index every record exactly the way bake-overrides.js does
  const files = fs.readdirSync(__dirname).filter(f => /-locations\.js$/.test(f));
  const byId = {};
  let recCount = 0;
  for (const f of files) {
    const parsed = loadLocationsFile(path.join(__dirname, f));
    if (!parsed) continue;
    parsed.records.forEach(r => { if (r && r.id) { byId[r.id] = r; recCount++; } });
  }
  console.log(`Indexed ${recCount} records across ${files.length} file(s).`);

  const snap = await db.collection('overrides').get();
  console.log(`Fetched ${snap.size} override(s).\n`);

  // An empty read is indistinguishable from a permissions failure. Refuse, the same way
  // fetch-and-bake.js and fetch-and-bake-hours.js do.
  if (snap.size === 0) {
    console.log('No overrides returned — nothing to do (and refusing to treat this as "all clear").');
    process.exit(0);
  }

  const cutoff = Date.now() - AGE_DAYS * 86400000;
  const retire = [], keepRemove = [], tooNew = [], notApplied = [], orphans = [];

  snap.forEach(d => {
    const ov = d.data() || {};
    const entry = { id: d.id, ov };

    if (ov.remove === true) { keepRemove.push(entry); return; }

    const touched = ov.updatedAt || ov.removedAt || 0;
    if (!touched || touched > cutoff) { tooNew.push(entry); return; }

    const rec = byId[d.id];
    if (!rec) { orphans.push(entry); return; }

    const changes = pendingChanges(rec, ov);
    if (changes.length) { entry.changes = changes; notApplied.push(entry); }
    else retire.push(entry);
  });

  const fmtAge = t => t ? Math.floor((Date.now() - t) / 86400000) + 'd' : '—';

  console.log(`${'='.repeat(58)}`);
  console.log(`  fully baked, eligible to retire : ${retire.length}`);
  console.log(`  remove:true — kept forever      : ${keepRemove.length}`);
  console.log(`  newer than ${AGE_DAYS}d — left alone     : ${tooNew.length}`);
  console.log(`  NOT yet applied by the bake     : ${notApplied.length}`);
  console.log(`  orphans (no matching record)    : ${orphans.length}`);
  console.log(`${'='.repeat(58)}\n`);

  if (notApplied.length) {
    console.log('These have unbaked changes — investigate, do not delete:');
    notApplied.forEach(e =>
      console.log(`  ${e.id}  ->  ${e.changes.join(', ')}  (${fmtAge(e.ov.updatedAt)})`));
    console.log();
  }
  if (orphans.length) {
    console.log(`Orphans — the bake skips these every run${ORPHANS ? ' (INCLUDED this run)' : ' (not touched; pass --include-orphans)'}:`);
    orphans.forEach(e => console.log(`  ${e.id}  (${fmtAge(e.ov.updatedAt)})`));
    console.log();
  }

  const targets = ORPHANS ? retire.concat(orphans) : retire;
  if (!targets.length) { console.log('Nothing to retire.'); process.exit(0); }

  if (!APPLY) {
    console.log(`DRY RUN — would archive + delete ${targets.length} override(s).`);
    targets.slice(0, 20).forEach(e => console.log(`  ${e.id}`));
    if (targets.length > 20) console.log(`  … and ${targets.length - 20} more`);
    console.log('\nRe-run with --apply to do it.');
    process.exit(0);
  }

  const archivedAt = Date.now();
  let done = 0;
  for (let i = 0; i < targets.length; i += 200) {   // 2 writes per doc, cap is 500
    const chunk = targets.slice(i, i + 200);
    const batch = db.batch();
    for (const e of chunk) {
      batch.set(db.collection('overridesArchive').doc(e.id),
                Object.assign({}, e.ov, { archivedAt, archivedReason: 'baked' }));
      batch.delete(db.collection('overrides').doc(e.id));
    }
    await batch.commit();
    done += chunk.length;
    console.log(`  archived ${done}/${targets.length}`);
  }
  console.log(`\nRetired ${done} override(s). ${keepRemove.length} remove-flag override(s) untouched.`);
  process.exit(0);
}

main().catch(err => { console.error('\n\u2717 Failed:', err.message || err); process.exit(1); });
