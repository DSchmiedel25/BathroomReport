#!/usr/bin/env node
/**
 * apply-ev.js — set osm.evCharging on locations that the source says have EV charging.
 *
 *   node apply-ev.js <chain-locations.js> <chain-enrichment.json> [--write] [--radius=120]
 *
 * evCharging is an existing STORE_FEATURE, and the app renders `loc.osm.<key>` as an
 * OSM-verified badge — the same mechanism as osm.gas. Only sets the flag where the source
 * says yes; never clears an existing one (a store could have gained a charger since the
 * scrape, and community confirmations outrank a snapshot).
 */
const fs = require('fs');
const [, , locFile, enrichFile, ...flags] = process.argv;
if (!locFile || !enrichFile) { console.error('usage: node apply-ev.js <locations.js> <enrichment.json> [--write]'); process.exit(1); }
const WRITE = flags.includes('--write');
const RADIUS = Number((flags.find(f => f.startsWith('--radius=')) || '--radius=120').split('=')[1]);

const raw = fs.readFileSync(locFile, 'utf8');
const s = raw.indexOf('['), e = raw.lastIndexOf(']');
const header = raw.slice(0, s), footer = raw.slice(e + 1);
const locs = JSON.parse(raw.slice(s, e + 1));
const src = JSON.parse(fs.readFileSync(enrichFile, 'utf8')).records
  .filter(r => String(r['fuel:electricity']).toLowerCase() === 'yes');
console.log(`${locFile}: ${locs.length} records | source EV sites: ${src.length}`);

const CELL = 0.02, grid = new Map();
for (const r of src) {
  const k = Math.round(r.lat / CELL) + ':' + Math.round(r.lng / CELL);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(r);
}
const met = (a, b, c, d) => {
  const R = x => x * Math.PI / 180, dla = R(c - a), dln = R(d - b);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(R(a)) * Math.cos(R(c)) * Math.sin(dln / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
let set = 0, already = 0, ambiguous = 0;
for (const loc of locs) {
  const la = Number(loc.lat), ln = Number(loc.lng);
  if (!isFinite(la) || !isFinite(ln)) continue;
  const gy = Math.round(la / CELL), gx = Math.round(ln / CELL);
  const near = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
    for (const r of grid.get((gy + dy) + ':' + (gx + dx)) || []) {
      const d = met(la, ln, r.lat, r.lng);
      if (d <= RADIUS) near.push(d);
    }
  if (!near.length) continue;
  near.sort((a, b) => a - b);
  if (near.length > 1 && near[1] - near[0] < 40) { ambiguous++; continue; }
  if (loc.osm && loc.osm.evCharging) { already++; continue; }
  loc.osm = loc.osm || {};
  loc.osm.evCharging = 1;
  set++;
}
console.log(`  SET osm.evCharging : ${set}\n  already flagged    : ${already}\n  ambiguous (skipped): ${ambiguous}`);
if (!WRITE) { console.log('\nDRY RUN — nothing written.'); process.exit(0); }
fs.copyFileSync(locFile, locFile + '.bak');
fs.writeFileSync(locFile, header + '[\n' + locs.map(o => JSON.stringify(o)).join(',\n') + '\n]' + footer);
console.log('Written. Backup at ' + locFile + '.bak');
