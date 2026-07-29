#!/usr/bin/env node
/**
 * atp-to-hours.js — convert an All the Places spider GeoJSON into the flat
 * {lat,lng,hours} array that match-hours.js consumes.
 *
 *   node atp-to-hours.js wawa.geojson wawa-hours.json
 *
 * ATP publishes opening_hours in OSM syntax. That syntax is far richer than the
 * app's single "HHMM-HHMM" slot (it supports per-day ranges, seasons, holidays,
 * "off" days). Rather than flatten something lossy, this only converts the cases
 * that map cleanly and reports the rest — an unconverted store keeps "hours
 * unknown", which the app already handles honestly. A wrong open/closed state is
 * far worse than a missing one.
 */
const fs = require('fs');
const [, , inFile, outFile] = process.argv;
if (!inFile) { console.error('usage: node atp-to-hours.js <spider.geojson> [out.json]'); process.exit(1); }

const raw = fs.readFileSync(inFile, 'utf8');
let feats;
try {
  const j = JSON.parse(raw);
  feats = j.features || (Array.isArray(j) ? j : []);
} catch {
  // ndjson fallback — ATP also publishes one feature per line
  feats = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const hhmm = (s) => {
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  return m ? String(m[1]).padStart(2, '0') + m[2] : null;
};
// "00:00-24:00" and "00:00-00:00" are round-the-clock. Emitting them as a range
// would make the app print "12:00 AM - 12:00 AM" instead of "Open 24 hours".
const ROUND_CLOCK = new Set(['0000-2400', '0000-0000', '0000-2359']);
const collapse = (o, c) => (o === c || ROUND_CLOCK.has(`${o}-${c}`)) ? '24' : `${o}-${c}`;

const unconverted = new Map();
function fromOsm(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^24\/7$/i.test(s)) return '24';

  // Single uniform range covering every day: "Mo-Su 05:00-23:00" / "05:00-23:00"
  let m = s.match(/^(?:Mo-Su\s+)?(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/i);
  if (m) {
    const o = hhmm(m[1]), c = hhmm(m[2]);
    if (o && c) return collapse(o, c);
  }
  // Every listed day shares one range: "Mo-Fr 06:00-22:00; Sa-Su 06:00-22:00"
  const parts = s.split(';').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const ranges = parts.map((p) => {
      const mm = p.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      return mm ? collapse(hhmm(mm[1]), hhmm(mm[2])) : null;
    });
    if (ranges.every((r) => r && r === ranges[0])) return ranges[0];
  }
  unconverted.set(s, (unconverted.get(s) || 0) + 1);
  return '';
}

/* Some spiders emit one record per FACILITY at a single site — Casey's publishes
 * "<ref>_fuel" and "<ref>_store" at identical coordinates, and their hours differ
 * (pumps 24h, store closes at 22:00). For a bathroom finder the STORE hours are the
 * only correct ones: the restroom is inside the building, not at the pump island.
 * Keep the store record, drop the fuel twin. */
const FUEL = /(^|[_\-])(fuel|pump|gas|carwash|wash)$/i;
const STORE = /(^|[_\-])(store|shop|market)$/i;
function preferStoreRecords(list) {
  const byBase = new Map();
  for (const f of list) {
    const ref = String((f.properties || {}).ref || '');
    const base = ref.replace(/(^|[_\-])(fuel|pump|gas|carwash|wash|store|shop|market)$/i, '');
    if (!base || base === ref) continue;             // no facility suffix — leave alone
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
  }
  const drop = new Set();
  let collapsed = 0;
  for (const [, group] of byBase) {
    if (group.length < 2) continue;
    const store = group.find((f) => STORE.test(String(f.properties.ref)));
    if (!store) continue;                            // no store record — keep what's there
    for (const f of group) {
      if (f !== store && FUEL.test(String(f.properties.ref))) { drop.add(f); collapsed++; }
    }
  }
  if (collapsed) console.log(`  collapsed ${collapsed} fuel/carwash twins -> kept the store record`);
  return list.filter((f) => !drop.has(f));
}
feats = preferStoreRecords(feats);

const out = [];
let noHours = 0;
for (const f of feats) {
  const p = f.properties || {};
  const g = f.geometry || {};
  const c = g.coordinates;
  if (!Array.isArray(c)) continue;
  const lng = Number(c[0]), lat = Number(c[1]);
  if (!isFinite(lat) || !isFinite(lng)) continue;
  const hours = fromOsm(p.opening_hours);
  if (!hours) noHours++;
  out.push({ id: p.ref || f.id || '', lat, lng, hours });
}

const h24 = out.filter((r) => r.hours === '24').length;
const timed = out.filter((r) => r.hours && r.hours !== '24').length;
console.log(`${inFile}: ${feats.length} features -> ${out.length} usable`);
console.log(`  24/7: ${h24}   timed: ${timed}   no usable hours: ${noHours}`);
if (unconverted.size) {
  console.log('  OSM strings not converted (left unknown rather than guessed):');
  [...unconverted.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .forEach(([s, n]) => console.log(`     ${n}x  ${s.slice(0, 70)}`));
}
fs.writeFileSync(outFile || 'atp-hours.json', JSON.stringify(out));
console.log(`wrote ${outFile || 'atp-hours.json'}`);
