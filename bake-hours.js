#!/usr/bin/env node
/*
 * bake-hours.js — fold community-verified hours (from hourStatus) into the static location files.
 * Idempotent + deterministic, like bake-confirmed.js: recomputes every run, so a store that LOST
 * verification is reverted to its prior hours/source.
 *
 * Snapshot lives ON THE RECORD (meta.prevHrs / meta.prevHours / meta.prevHrsSrc), captured the first
 * time community hours overwrite a record — so revert needs no Firestore write-back and is exact.
 *
 * Usage:
 *   node bake-hours.js hours-status.json <chain-locations.js> [more...]
 *   node bake-hours.js hours-status.json *-locations.js
 *
 * hours-status.json = { "<storeId>": { verified, value, kind, source }, ... }  (dump of hourStatus)
 */
'use strict';
const fs = require('fs');

const [,, statusPath, ...locPaths] = process.argv;
if (!statusPath || !locPaths.length){
  console.error('Usage: node bake-hours.js hours-status.json <chain-locations.js> [more...]');
  process.exit(1);
}
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));

// Only verified statuses with a value apply; everything else means "not community-verified".
const verified = {};
for (const [id, st] of Object.entries(status)){
  if (st && st.verified && st.value != null) verified[id] = st;
}


// A file matching *-locations.js is not necessarily DATA. compact-locations.js is a maintenance
// script, and every loader here evaluates the file — a shebang line is a SyntaxError that killed
// the whole run (silently, because bake.yml swallowed it). Verify shape before evaluating.
function looksLikeDataFile(src){
  if(/^\s*#!/.test(src)) return false;                 // shebang -> executable script
  return /^\s*window\.[A-Za-z_$][\w$]*\s*=\s*\[/m.test(src);
}

function loadFile(file){
  const src = fs.readFileSync(file, 'utf8');
  if(!looksLikeDataFile(src)) return null;
  const sandbox = { window:{} };
  new Function('window', src)(sandbox.window);
  const varName = Object.keys(sandbox.window)[0];
  return { varName, records: sandbox.window[varName] };
}
function serialize(varName, records){
  // One record per line — same format as bake-overrides.js and bake-confirmed.js (see
  // bake-overrides.js for the rationale). Keep all three writers identical.
  return 'window.' + varName + ' = [\n' +
    records.map(r => JSON.stringify(r)).join(',\n') +
    '\n];\n';
}

const t0 = Date.now();
let applied = 0, reverted = 0, filesTouched = 0, processed = 0;
for (const file of locPaths){
  const parsed = loadFile(file);
  if(!parsed){ console.log('  skipped ' + file + ' (not a data file)'); continue; }
  const { varName, records } = parsed;
  let fileApplied = 0, fileReverted = 0;
  for (const rec of records){
    processed++;
    const st = verified[rec.id];
    const meta = rec.meta || {};
    const isCommunity = meta.hrsSrc === 'community_verified' || meta.hrsSrc === 'admin_override';

    if (st){
      // capture the pre-community snapshot exactly once
      if (!isCommunity){
        meta.prevHrs = rec.hrs !== undefined ? rec.hrs : '';
        if (rec.hours !== undefined) meta.prevHours = rec.hours; else delete meta.prevHours;
        meta.prevHrsSrc = meta.hrsSrc || '';
      }
      // apply verified hours (per-day map or single window)
      if (st.kind === 'perday' && st.value && typeof st.value === 'object'){
        rec.hours = st.value; delete rec.hrs;
      } else {
        rec.hrs = st.value; delete rec.hours;
      }
      meta.hrsSrc = (st.source === 'admin_override') ? 'admin_override' : 'community_verified';
      rec.meta = meta;
      fileApplied++;
    } else if (isCommunity){
      // was community-verified, no longer verified -> revert to the captured snapshot
      if (meta.prevHours !== undefined){ rec.hours = meta.prevHours; delete rec.hrs; }
      else { rec.hrs = (meta.prevHrs !== undefined ? meta.prevHrs : ''); delete rec.hours; }
      if (meta.prevHrsSrc) meta.hrsSrc = meta.prevHrsSrc; else delete meta.hrsSrc;
      delete meta.prevHrs; delete meta.prevHours; delete meta.prevHrsSrc;
      rec.meta = meta;
      fileReverted++;
    }
  }
  if (fileApplied || fileReverted){
    fs.writeFileSync(file, serialize(varName, records));
    filesTouched++;
  }
  applied += fileApplied; reverted += fileReverted;
  console.log(`${file}: applied ${fileApplied}, reverted ${fileReverted}`);
}
const skipped = Object.keys(status).length - Object.keys(verified).length; // non-verified statuses (pending/conflict/override)
console.log(`\n── bake-hours summary ──`);
console.log(`  Records processed : ${processed}`);
console.log(`  hourStatus docs   : ${Object.keys(status).length} (verified ${Object.keys(verified).length}, not-verified ${skipped})`);
console.log(`  Applied           : ${applied}`);
console.log(`  Reverted          : ${reverted}`);
console.log(`  Files changed     : ${filesTouched}`);
console.log(`  Elapsed           : ${((Date.now()-t0)/1000).toFixed(1)}s`);
