#!/usr/bin/env node
/*
 * build-public-toilets.js — Overpass `amenity=toilets` exports → regional location files.
 *
 * WHY REGIONS
 * A single nationwide file would be the largest asset in the repo by a wide margin, and
 * index.html eager-loads every *-locations.js with <script defer>, so it would land on every
 * visitor before the map draws whether or not they ever turn the layer on. Splitting by census
 * division gives nine files that can be fetched on demand, and it also keeps each Overpass
 * query small enough that the public instance will actually answer it.
 *
 * Every region file appends to ONE global array rather than declaring its own:
 *
 *   (window.usPublicLocations = window.usPublicLocations || []).push(...)
 *
 * so the chain registry needs a single `usPublic` entry with dataVar 'usPublicLocations',
 * not nine near-identical ones that would each show up as their own "Public restroom" row in
 * the chain filter.
 *
 * INPUT   osm-data/public-toilets-<ST>.json   (raw Overpass JSON, one file per state)
 * OUTPUT  public-<region>-locations.js        (nine files)
 *         public-toilets-manifest.js          (region -> file, bbox, count)
 *
 * USAGE   node build-public-toilets.js [--keep-pit] [--keep-seasonal] [--dry]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OSM_DIR = 'osm-data';
const ARGS = new Set(process.argv.slice(2));
const KEEP_PIT      = ARGS.has('--keep-pit');
const KEEP_SEASONAL = ARGS.has('--keep-seasonal');
const DRY           = ARGS.has('--dry');

/* US Census divisions, with ONE deliberate departure: California is its own region.
 *
 * Straight census divisions put CA in Pacific alongside AK, HI, OR and WA, which measured at
 * 3.0 MB with only Alaska and California counted — Oregon, Washington and Hawaii would have
 * pushed it past 5 MB, making it larger than the next three regions combined. California alone
 * is 14.6% of every toilet node in the country, a mix of a very active OSM community and a lot
 * of state and federal park land.
 *
 * Splitting it costs one extra file and buys two evenly-sized ones. Nothing downstream cares
 * how many regions there are — the manifest is generated, and the loader reads it. */
const REGIONS = {
  newengland:   { label: 'New England',        states: ['CT','ME','MA','NH','RI','VT'] },
  midatlantic:  { label: 'Mid-Atlantic',       states: ['NJ','NY','PA'] },
  eastnorth:    { label: 'East North Central', states: ['IL','IN','MI','OH','WI'] },
  westnorth:    { label: 'West North Central', states: ['IA','KS','MN','MO','NE','ND','SD'] },
  southatlantic:{ label: 'South Atlantic',     states: ['DE','DC','FL','GA','MD','NC','SC','VA','WV'] },
  eastsouth:    { label: 'East South Central', states: ['AL','KY','MS','TN'] },
  westsouth:    { label: 'West South Central', states: ['AR','LA','OK','TX'] },
  mountain:     { label: 'Mountain',           states: ['AZ','CO','ID','MT','NV','NM','UT','WY'] },
  california:   { label: 'California',         states: ['CA'] },
  pacific:      { label: 'Pacific',            states: ['AK','HI','OR','WA'] },
};
const REGION_OF = {};
for (const [key, r] of Object.entries(REGIONS)) for (const st of r.states) REGION_OF[st] = key;

/* Already-shipped public sets. A nationwide pull re-includes every node in them, so these are
 * excluded by OSM id — exact, and cheaper than the spatial match the chain data needs. */
const EXISTING_FILES = ['ny-public-locations.js', 'nyc-public-locations.js', 'bos-public-locations.js'];

function loadWindowFile(file) {
  const sandbox = { window: {} };
  new Function('window', fs.readFileSync(file, 'utf8'))(sandbox.window);
  const varName = Object.keys(sandbox.window)[0];
  return sandbox.window[varName] || [];
}

function existingSrcIds() {
  const seen = new Set();
  for (const f of EXISTING_FILES) {
    if (!fs.existsSync(f)) { console.warn(`  ! ${f} not found — its nodes may duplicate`); continue; }
    for (const rec of loadWindowFile(f)) {
      const s = rec && rec.meta && rec.meta.srcId;
      if (s) seen.add(s);
    }
  }
  return seen;
}

/* Reject reasons are counted rather than silently dropped: an export that is 80% rejected is
 * usually a bad query, not a clean region, and the tally is the only way to notice. */
const DROP = {
  noCoords: 0, access: 0, pit: 0, seasonal: 0, duplicateExisting: 0, duplicateInternal: 0, unknownState: 0,
};

function accessAllowed(tags) {
  const a = (tags.access || '').toLowerCase();
  // permissive and yes are open to the public; blank is unknown and kept, since most nodes
  // carry no access tag at all and dropping them would discard the bulk of the data.
  return !['private', 'customers', 'permit', 'no'].includes(a);
}

/* OSM disposal values arrive misspelled often enough to matter: the six states sampled carried
 * `valut`, `vaut` and a capitalised `Composting` alongside the correct spellings. Those slip
 * past an exact-match filter, so a vault toilet typed by someone in a hurry survives a filter
 * written to exclude vault toilets. Normalise before comparing. */
const DISPOSAL_ALIASES = { valut: 'vault', vaut: 'vault', composting: 'composting' };
function disposalOf(tags) {
  const raw = String(tags['toilets:disposal'] || '').toLowerCase().trim();
  return DISPOSAL_ALIASES[raw] || raw;
}

/* Backcountry facility types — a pit, vault, composting or bucket toilet at a trailhead is a
 * real toilet and a terrible search result for someone in a car in a city, which is the exact
 * failure the rest-area hedging already guards against. */
const BACKCOUNTRY = new Set(['pitlatrine', 'vault', 'composting', 'bucket']);

function toRecord(el, state) {
  const tags = el.tags || {};
  const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
  const lng = el.lon != null ? el.lon : (el.center && el.center.lon);
  if (lat == null || lng == null) { DROP.noCoords++; return null; }
  if (!accessAllowed(tags)) { DROP.access++; return null; }

  const disposal = disposalOf(tags);
  if (!KEEP_PIT && BACKCOUNTRY.has(disposal)) { DROP.pit++; return null; }
  if (!KEEP_SEASONAL && (tags.seasonal || '').toLowerCase() === 'yes') { DROP.seasonal++; return null; }

  const srcId = `${el.type}/${el.id}`;
  const fee = (tags.fee || '').toLowerCase();

  /* meta.facility mirrors the hedging already used for rest areas: a node with no building and
   * no disposal tag may be a locked seasonal vault, so the popup says "unconfirmed" rather than
   * promising a restroom. */
  const facility = (disposal === 'chemical' || disposal === 'bucket') ? 'portable'
                 : (el.type !== 'node' ? 'polygon' : '');

  return {
    n: tags.name || 'Public restroom',
    lat: Number(lat.toFixed(7)),
    lng: Number(lng.toFixed(7)),
    addr: '',
    id: srcId.replace('/', '__'),
    hrs: '',
    chain: 'usPublic',
    metroInfo: {
      access: (tags.access || ''),
      hoursRaw: tags.opening_hours || '',
      ...(fee === 'no' ? { fee: 'free' } : fee === 'yes' ? { fee: 'paid' } : {}),
      ...(facility === 'portable' ? { disposal: true } : {}),
    },
    /* Only keys osmVerifiedBadges can render as a plain yes-badge. restroomType and genderSplit
     * are deliberately NOT set from OSM: that function renders `icon + a.label` with no state,
     * so a multi-state key would surface as a badge reading "Restroom setup" — true of every
     * location and informative about none. Those two stay community-only. */
    osm: {
      ...(String(tags.wheelchair).toLowerCase() === 'yes' ? { accessible: 1 } : {}),
      ...(String(tags.changing_table).toLowerCase() === 'yes' ? { changing: 1 } : {}),
    },
    meta: {
      srcId,
      state,
      facility,
      /* Carried but NOT yet displayed. OSM answers the men's/women's question for about 14% of
       * nodes — unisex=yes is "one shared restroom", male=yes AND female=yes is "separate" —
       * which would seed genderSplit on thousands of locations instead of waiting for three
       * votes each. Displaying it needs osmVerifiedBadges to handle multi-state amenities,
       * which it cannot: it renders `icon + label` with no state, so a multi-state key would
       * surface as a badge reading "Restroom rooms" — true everywhere, informative nowhere.
       * That is a change to how EVERY osm badge renders on every chain, so it ships on its own.
       * Storing the answer now costs a few bytes and means no re-import when it does. */
      ...(String(tags.unisex).toLowerCase() === 'yes' ? { osmGender: 'single' }
        : (String(tags.male).toLowerCase() === 'yes' && String(tags.female).toLowerCase() === 'yes') ? { osmGender: 'multiple' }
        : {}),
      dataSource: 'openstreetmap_overpass',
      lastVerified: new Date().toISOString().slice(0, 10),
    },
  };
}

function main() {
  if (!fs.existsSync(OSM_DIR)) { console.error(`missing ${OSM_DIR}/`); process.exit(1); }

  console.log('loading already-shipped public sets…');
  const shipped = existingSrcIds();
  console.log(`  ${shipped.size} node id(s) already on the map\n`);

  const files = fs.readdirSync(OSM_DIR).filter(f => /^public-toilets-[A-Z]{2}\.json$/.test(f));
  if (!files.length) {
    console.error(`no public-toilets-<ST>.json in ${OSM_DIR}/ — fetch them first`);
    process.exit(1);
  }

  const byRegion = {};
  const seenGlobal = new Set();

  for (const f of files.sort()) {
    const state = f.slice(-7, -5);
    const region = REGION_OF[state];
    if (!region) { DROP.unknownState++; console.warn(`  ? ${state} maps to no region — skipped`); continue; }

    let json;
    try { json = JSON.parse(fs.readFileSync(path.join(OSM_DIR, f), 'utf8')); }
    catch (e) { console.warn(`  ! ${f} is not valid JSON — skipped (${e.message})`); continue; }

    let kept = 0;
    for (const el of (json.elements || [])) {
      const rec = toRecord(el, state);
      if (!rec) continue;
      if (shipped.has(rec.meta.srcId)) { DROP.duplicateExisting++; continue; }
      if (seenGlobal.has(rec.meta.srcId)) { DROP.duplicateInternal++; continue; }
      seenGlobal.add(rec.meta.srcId);
      (byRegion[region] = byRegion[region] || []).push(rec);
      kept++;
    }
    console.log(`  ${state}  ${String(kept).padStart(6)} kept  → ${region}`);
  }

  console.log('\nregion files');
  const manifest = [];
  for (const [key, meta] of Object.entries(REGIONS)) {
    const recs = byRegion[key] || [];
    if (!recs.length) { console.log(`  ${key.padEnd(14)} (empty — no file written)`); continue; }

    // bbox computed from the data rather than hardcoded, so it can never drift from what the
    // file actually contains — this is what the viewport check will load against.
    let s = 90, w = 180, n = -90, e = -180;
    for (const r of recs) {
      if (r.lat < s) s = r.lat; if (r.lat > n) n = r.lat;
      if (r.lng < w) w = r.lng; if (r.lng > e) e = r.lng;
    }

    const file = `public-${key}-locations.js`;
    const body = '(window.usPublicLocations = window.usPublicLocations || []).push(\n'
      + recs.map(r => JSON.stringify(r)).join(',\n')
      + '\n);\n';
    if (!DRY) fs.writeFileSync(file, body);

    manifest.push({ region: key, label: meta.label, file, count: recs.length, bbox: [s, w, n, e] });
    console.log(`  ${key.padEnd(14)} ${String(recs.length).padStart(6)} records  ${(body.length / 1048576).toFixed(2)} MB`);
  }

  if (!DRY) {
    fs.writeFileSync('public-toilets-manifest.js',
      'window.publicToiletManifest = ' + JSON.stringify(manifest, null, 2) + ';\n');
  }

  const total = manifest.reduce((a, m) => a + m.count, 0);
  console.log(`\n${total} record(s) across ${manifest.length} region file(s)`);
  console.log('dropped:', Object.entries(DROP).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('  ') || 'nothing');
  if (DRY) console.log('\n--dry: nothing written');
}

main();
