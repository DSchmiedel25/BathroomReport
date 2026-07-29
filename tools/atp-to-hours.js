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
  const perDay = fromOsmPerDay(s);
  if (perDay) return perDay;                       // object -> caller writes loc.hours
  unconverted.set(s, (unconverted.get(s) || 0) + 1);
  return '';
}

/* Weekday/weekend splits ("Mo-Sa 05:00-19:00; Su 06:00-19:00") are extremely common —
 * roughly 40% of Dunkin'. The app already supports a per-day `loc.hours` map keyed
 * mon..sun and prefers it over the single `hrs` window, so those cases don't have to be
 * thrown away. Returns a day map, or null when the string still can't be represented
 * (split shifts like "00:00-01:00,04:00-24:00" have no single window per day). */
const OSM_DAYS = { mo:'mon', tu:'tue', we:'wed', th:'thu', fr:'fri', sa:'sat', su:'sun' };
const DAY_SEQ = ['mo','tu','we','th','fr','sa','su'];
function fromOsmPerDay(s) {
  const out = {};
  for (const chunk of s.split(';').map((p) => p.trim()).filter(Boolean)) {
    const m = chunk.match(/^([A-Za-z,\-]+)\s+(.+)$/);
    if (!m) return null;
    const dayPart = m[1], timePart = m[2].trim();
    if (/,/.test(timePart)) return null;           // split shift — not representable
    let val;
    if (/^(off|closed)$/i.test(timePart)) val = 'closed';
    else {
      const t = timePart.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      if (!t) return null;
      const o = hhmm(t[1]), c = hhmm(t[2]);
      if (!o || !c) return null;
      val = collapse(o, c);
    }
    for (const tok of dayPart.split(',')) {
      const r = tok.trim().toLowerCase();
      if (r === 'ph') continue;                    // public holidays — no per-day slot
      const rng = r.match(/^([a-z]{2})-([a-z]{2})$/);
      if (rng) {
        let i = DAY_SEQ.indexOf(rng[1]), j = DAY_SEQ.indexOf(rng[2]);
        if (i < 0 || j < 0) return null;
        for (let k = 0; k < 7; k++) {              // wraps (e.g. Sa-Su, Fr-Mo)
          const idx = (i + k) % 7;
          out[OSM_DAYS[DAY_SEQ[idx]]] = val;
          if (idx === j) break;
        }
      } else if (OSM_DAYS[r]) {
        out[OSM_DAYS[r]] = val;
      } else return null;
    }
  }
  const keys = Object.keys(out);
  if (keys.length < 7) return null;                // partial week -> leave unknown
  const vals = new Set(Object.values(out));
  if (vals.size === 1) return [...vals][0];        // all days equal -> plain string
  return out;
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
  const rec = { id: p.ref || f.id || '', lat, lng };
  if (hours && typeof hours === 'object') rec.days = hours; else rec.hours = hours || '';
  out.push(rec);
}

const h24 = out.filter((r) => r.hours === '24').length;
const timed = out.filter((r) => r.hours && r.hours !== '24').length;
const perDay = out.filter((r) => r.days).length;
if (perDay) console.log(`  per-day schedules: ${perDay}`);
console.log(`${inFile}: ${feats.length} features -> ${out.length} usable`);
console.log(`  24/7: ${h24}   timed: ${timed}   no usable hours: ${noHours}`);
if (unconverted.size) {
  console.log('  OSM strings not converted (left unknown rather than guessed):');
  [...unconverted.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .forEach(([s, n]) => console.log(`     ${n}x  ${s.slice(0, 70)}`));
}
fs.writeFileSync(outFile || 'atp-hours.json', JSON.stringify(out));
console.log(`wrote ${outFile || 'atp-hours.json'}`);
