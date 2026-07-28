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
  // One record per line: cuts the pretty-printed (2-space indented) format's size by roughly
  // a third — this whitespace ships to every user on every load — while keeping git diffs
  // readable (a changed store still shows as one changed line, not a whole-file diff).
  return 'window.' + varName + ' = [\n' +
    records.map(r => JSON.stringify(r)).join(',\n') +
    '\n];\n';
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

// Build a brand-new location record from an override that has no existing match.
// Requires a valid id + numeric lat/lng; name/addr/hours come through FIELD_MAP.
function buildNewRecord(id, ov){
  const rec = { n: ov.locName || ov.n || id, lat: ov.lat, lng: ov.lng, addr: ov.addr || '', id: id };
  // hours: prefer per-day map, else single window (skip empty = unknown)
  if(ov.hours && typeof ov.hours === 'object' && Object.keys(ov.hours).length) rec.hours = ov.hours;
  else if(ov.hrs) rec.hrs = ov.hrs;
  // optional identity fields, only if present
  ['city','state','zipCode','phone'].forEach(k => { if(ov[k]) rec[k] = ov[k]; });
  if(ov.chain) rec.chain = ov.chain;
  return rec;
}

function isValidCoord(v){ return v !== '' && v != null && !Number.isNaN(parseFloat(v)); }

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

  // Map a chain key -> its file, accepting both the varName style ("cumberlandFarms")
  // and the filename style ("cumberland-farms") so overrides route regardless of casing.
  const chainToFile = {};
  for(const f of files){
    const vkey = (loaded[f].varName || '').replace(/Locations$/, '');   // e.g. cumberlandFarms
    const fkey = f.replace(/-locations\.js$/, '');                      // e.g. cumberland-farms
    [vkey, vkey.toLowerCase(), fkey, fkey.toLowerCase()].forEach(k => { if(k) chainToFile[k] = f; });
  }

  // Apply.
  const changedFiles = new Set();
  const unmatched = [];
  let applied = 0, created = 0;
  const removedIds = new Set();
  for(const id of overrideIds){
    const ov = overrides[id];
    // Permanent removal: an override flagged {remove:true} deletes the record from its file
    // entirely (bad OSM data, not-a-real-location, permanently closed). Permanent = permanent.
    if(ov && ov.remove === true){
      const hit = byId[id];
      if(hit){
        removedIds.add(id);
        changedFiles.add(hit.file);
        console.log('  - REMOVED ' + id + '  ->  ' + hit.file + '  (' + (hit.record.n || '') + ')');
      } else {
        console.log('  (remove ' + id + ' — no matching record, nothing to delete)');
      }
      continue;
    }
    const hit = byId[id];
    if(!hit){
      // No existing record — treat as a NEW store if the override tells us its chain.
      const file = ov && ov.chain ? chainToFile[ov.chain] || chainToFile[String(ov.chain).toLowerCase()] : null;
      if(!file){ unmatched.push(id); continue; }
      if(!isValidCoord(ov.lat) || !isValidCoord(ov.lng)){
        console.log('  SKIP new ' + id + ' (chain "' + ov.chain + '"): missing/invalid lat or lng');
        unmatched.push(id); continue;
      }
      const rec = buildNewRecord(id, ov);
      loaded[file].records.push(rec);
      byId[id] = { file, record: rec };
      changedFiles.add(file);
      created++;
      console.log('  + NEW ' + id + '  ->  ' + file + '  (' + (rec.n) + ')');
      continue;
    }
    const changes = applyOverride(hit.record, overrides[id]);
    if(changes.length){
      changedFiles.add(hit.file);
      applied++;
      console.log('  ' + id + '  ->  ' + changes.join(', '));
    }
  }

  // Actually drop the removed records from their files before serializing.
  let removed = 0;
  if(removedIds.size){
    for(const f of changedFiles){
      const before = loaded[f].records.length;
      loaded[f].records = loaded[f].records.filter(r => !(r && r.id && removedIds.has(r.id)));
      removed += before - loaded[f].records.length;
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

  console.log('\nDone. ' + applied + ' updated, ' + created + ' created, ' + removed + ' removed, across ' + changedFiles.size + ' file(s).');
  if(changedFiles.size) console.log('Updated files written to: ' + outDir);
  if(unmatched.length){
    console.log('\nWARNING: ' + unmatched.length + ' override(s) had no matching location and were skipped:');
    unmatched.forEach(id => console.log('  - ' + id));
  }
}

main();
