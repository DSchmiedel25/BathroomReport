#!/usr/bin/env node
/*
 * bake-overrides.js
 * -----------------
 * Folds the admin corrections stored in the Firestore `overrides` collection back
 * into the static <chain>-locations.js files, so those files stay the canonical
 * source of truth. Run this occasionally (e.g. monthly) after admins have been
 * fixing hours/addresses from FlushPanel.
 *
 * It does NOT talk to Firestore directly (that would need a service account, which
 * must never be committed). Instead you give it a JSON dump of the overrides.
 *
 * HOW TO GET overrides.json:
 *   Option 1 — one-off browser dump (easiest): open FlushPanel while signed in as an
 *   admin, open the dev console, and run:
 *
 *     (async () => {
 *       const { db, collection, getDocs } = await fb();
 *       const snap = await getDocs(collection(db, 'overrides'));
 *       const out = {}; snap.forEach(d => out[d.id] = d.data());
 *       console.log(JSON.stringify(out));
 *     })();
 *
 *   Copy the printed JSON into a file named overrides.json.
 *
 *   Option 2 — `firebase firestore:export` to a bucket, then convert. (Heavier.)
 *
 * USAGE:
 *   node bake-overrides.js overrides.json [locationsDir] [outDir]
 *     locationsDir  folder containing the *-locations.js files   (default: ".")
 *     outDir        where to write the updated files             (default: "./baked")
 *
 * The originals are never modified in place; review the files in outDir, then copy
 * them over your repo copies and redeploy (bumping the service-worker cache version).
 */

'use strict';
const fs = require('fs');
const path = require('path');

// Only these fields may be baked in; audit fields are intentionally ignored.
// Map: override field -> record field.
const FIELD_MAP = {
  hrs: 'hrs', hours: 'hours', addr: 'addr', city: 'city', state: 'state',
  zipCode: 'zipCode', phone: 'phone', lat: 'lat', lng: 'lng', locName: 'n'
};

function loadLocationsFile(file){
  // Each file is `window.<var> = [ ... ];`. Eval it with a stub window.
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox.window);
  const varName = Object.keys(sandbox.window)[0];
  return { varName, records: sandbox.window[varName] };
}

function serializeLocationsFile(varName, records){
  return 'window.' + varName + ' = ' + JSON.stringify(records, null, 2) + ';\n';
}

function applyOverride(rec, ov){
  const changes = [];
  for(const [ovKey, recKey] of Object.entries(FIELD_MAP)){
    if(!(ovKey in ov)) continue;
    const val = ov[ovKey];
    // Empty single-window string or empty per-day map means "unknown" — drop the field
    // so the baked file matches the app's "no hours = unknown" convention.
    if((ovKey === 'hrs' && val === '') || (ovKey === 'hours' && val && Object.keys(val).length === 0)){
      if(recKey in rec){ delete rec[recKey]; changes.push(recKey + ' cleared'); }
      continue;
    }
    const before = JSON.stringify(rec[recKey]);
    const after = JSON.stringify(val);
    if(before !== after){ rec[recKey] = val; changes.push(recKey); }
  }
  return changes;
}

function main(){
  const [,, overridesPath, dirArg, outArg] = process.argv;
  if(!overridesPath){
    console.error('Usage: node bake-overrides.js overrides.json [locationsDir] [outDir]');
    process.exit(1);
  }
  const dir = dirArg || '.';
  const outDir = outArg || path.join(dir, 'baked');

  // Load overrides (map {locId: {...}} or array [{id, ...}]).
  let raw = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
  const overrides = {};
  if(Array.isArray(raw)){ raw.forEach(o => { if(o && o.id) overrides[o.id] = o; }); }
  else { Object.assign(overrides, raw); }
  const overrideIds = Object.keys(overrides);
  console.log('Loaded ' + overrideIds.length + ' override(s).');

  // Index every location record across every *-locations.js file.
  const files = fs.readdirSync(dir).filter(f => /-locations\.js$/.test(f));
  const byId = {};              // locId -> { file, record }
  const loaded = {};            // file -> { varName, records }
  for(const f of files){
    const full = path.join(dir, f);
    const parsed = loadLocationsFile(full);
    loaded[f] = parsed;
    parsed.records.forEach(r => { if(r && r.id) byId[r.id] = { file: f, record: r }; });
  }
  console.log('Indexed ' + Object.keys(byId).length + ' locations across ' + files.length + ' file(s).');

  // Apply.
  const changedFiles = new Set();
  const unmatched = [];
  let applied = 0;
  for(const id of overrideIds){
    const hit = byId[id];
    if(!hit){ unmatched.push(id); continue; }
    const changes = applyOverride(hit.record, overrides[id]);
    if(changes.length){
      changedFiles.add(hit.file);
      applied++;
      console.log('  ' + id + '  ->  ' + changes.join(', '));
    }
  }

  // Write only the files that actually changed.
  if(changedFiles.size){
    fs.mkdirSync(outDir, { recursive: true });
    for(const f of changedFiles){
      const { varName, records } = loaded[f];
      fs.writeFileSync(path.join(outDir, f), serializeLocationsFile(varName, records));
    }
  }

  console.log('\nDone. ' + applied + ' location(s) updated across ' + changedFiles.size + ' file(s).');
  if(changedFiles.size) console.log('Updated files written to: ' + outDir);
  if(unmatched.length){
    console.log('\nWARNING: ' + unmatched.length + ' override(s) had no matching location and were skipped:');
    unmatched.forEach(id => console.log('  - ' + id));
  }
}

main();
