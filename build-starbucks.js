#!/usr/bin/env node
/* Build starbucks-locations.js from the All The Places `starbucks_us` scrape.
 *
 * Same pipeline as build-dunkin.js (hours parsed by hours-osm.js against a fixed reference week,
 * output in the app's canonical record shape), with three Starbucks-specific rules:
 *
 *   1. Company-operated stores only (ownership_type "CO"). Licensed stores ("LS") are counters
 *      inside a host business — a Target, a grocery store, a hospital, an airport — whose restroom
 *      belongs to the host and whose hours are the counter's, not the building's.
 *
 *   2. The NYC and Boston metro sets (nyc-starbucks-locations.js, bos-starbucks-locations.js) stay
 *      as they are. A national store that matches one of their records is left OUT of this file,
 *      so the metro record keeps its id — and with it every rating, tip, report and /guide/ page
 *      already keyed on that id. Ids are stable forever; retiring them would orphan that data.
 *      The match: within 60 m, or within 250 m with the same house number and street name.
 *
 *   3. Split-window days ("Sa 00:00-01:00,04:30-24:00") are left UNKNOWN, not closed. The parser
 *      returns no value for a day it can't express as one window, and build-dunkin.js turns every
 *      valueless day into "closed". Here a day is only marked closed when no rule's day selector
 *      covers it at all, which is what closed means in opening_hours.
 *
 * Excluded records are written to starbucks-excluded.csv with a reason, never dropped silently.
 *
 * Usage: node build-starbucks.js path/to/starbucks_us.geojson
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const OsmHours = require('./hours-osm.js');

const SRC = process.argv[2] || 'starbucks_us.geojson';
const OUT = 'starbucks-locations.js';
const METRO_FILES = ['nyc-starbucks-locations.js', 'bos-starbucks-locations.js'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const OSM_DAYS = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };

// US bounding box, generous enough for HI and AK.
const US = { minLat: 18, maxLat: 72, minLon: -180, maxLon: -64 };

// Venue detection, adapted from build-dunkin.js: an address that is a venue NAME rather than a
// street address is inside a host site. Highway service plazas are kept (travel stops).
const PLAZA_MARKER = /\b(service plaza|travel pl(a)?z|rest area|milepost|mile ?post|mile \d|mm ?\d|mp#?\d|(north|south|east|west)bound)\b/i;
const PLAZA = /\b(turnpike|tpke|thruway|njtp|interstate \d|i-\d+|garden state pkwy)\b/i;
const AIRPORT_STRONG = /\b(int'?l airport|international airport|intl airport|airport terminal|terminal \d|concourse [a-z]\b)\b/i;
const AIRPORT_WEAK = /\b(airport|aiport)\b/i;
const MILITARY = /\b(air force base|naval station|naval exchange|marine corps base|army depot)\b/i;
const TRANSIT_STRONG = /\b(port authority|bus terminal|penn(sylvania)? station|grand central (station|terminal|at track)|amtrak)\b/i;
const TRANSIT_WEAK = /\b(ferry terminal|train station|transit center)\b/i;
const VENUE = /\b(stadium|arena|coliseum|ballpark)\b/i;
/* Enclosed malls only. A "Shopping Center" is usually a strip plaza where the store has its own
 * door and restroom — the ordinary roadside case, so it is kept (build-dunkin.js excludes it). */
const MALL = /\b(galleria|premium outlets?|food court)\b|\bmall\b(?! ?(dr|drive|rd|road|blvd|st|street|ave|way|ln|ct|pkwy|circle|loop|pl|plaza))/i;

function venueCategory(addr, city) {
  const blob = `${addr}, ${city}`;
  const hasNumber = /^\d/.test(addr.trim());
  if (PLAZA_MARKER.test(blob) || (PLAZA.test(blob) && !hasNumber)) return 'HIGHWAY_PLAZA';
  if (AIRPORT_STRONG.test(blob) || (AIRPORT_WEAK.test(blob) && !hasNumber)) return 'AIRPORT';
  if (MILITARY.test(blob)) return 'MILITARY';
  if (TRANSIT_STRONG.test(blob) || (TRANSIT_WEAK.test(blob) && !hasNumber)) return 'TRANSIT_HUB';
  if (VENUE.test(blob) && !hasNumber) return 'STADIUM_ARENA';
  if (MALL.test(blob)) return 'MALL';
  return null;
}
const EXCLUDED_VENUES = new Set(['AIRPORT', 'MILITARY', 'TRANSIT_HUB', 'STADIUM_ARENA', 'MALL']);

/* Which weekdays does any rule's day selector cover? Returns a Set of 0..6, or null when a rule
 * has a selector this reader doesn't understand (then no day is ever inferred closed). A rule with
 * no day selector ("06:00-22:00") covers every day. */
function coveredDays(raw) {
  const covered = new Set();
  for (const rule of String(raw).split(';').map(s => s.trim()).filter(Boolean)) {
    const m = rule.match(/^([A-Za-z][A-Za-z,\- ]*?)\s+(?=\d|off|closed)/i);
    if (!m) {
      if (/^\d/.test(rule)) { for (let d = 0; d < 7; d++) covered.add(d); continue; }
      return null;
    }
    for (const part of m[1].split(',').map(s => s.trim().toLowerCase())) {
      const range = part.split('-').map(s => s.trim());
      if (!range.every(t => t in OSM_DAYS)) return null;
      if (range.length === 1) { covered.add(OSM_DAYS[range[0]]); continue; }
      if (range.length !== 2) return null;
      for (let d = OSM_DAYS[range[0]], i = 0; i < 7; d = (d + 1) % 7, i++) {
        covered.add(d);
        if (d === OSM_DAYS[range[1]]) break;
      }
    }
  }
  return covered;
}

const REF_SUNDAY = new Date(Date.UTC(2026, 2, 15, 12, 0, 0)); // Sun 2026-03-15

function bakeHours(raw, lat, lng) {
  if (!raw) return { hours: null, hrs: '', seasonal: false, closedDays: 0, unknownDays: 0 };
  const out = {};
  let known = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(REF_SUNDAY.getTime() + i * 86400000);
    const v = OsmHours.todayDetail(raw, { date: d, lat, lng, solarOk: false }).value;
    if (v !== null && v !== undefined) { out[DAY_KEYS[d.getDay()]] = v; known++; }
  }
  const seasonal = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(raw);
  if (!known) return { hours: null, hrs: '', seasonal, closedDays: 0, unknownDays: 0 };

  let closedDays = 0, unknownDays = 0;
  const covered = seasonal ? null : coveredDays(raw);
  for (let i = 0; i < 7; i++) {
    const k = DAY_KEYS[i];
    if (out[k] !== undefined) continue;
    if (covered && !covered.has(i)) { out[k] = 'closed'; closedDays++; }
    else unknownDays++; // covered by a rule the parser couldn't express: unknown, never closed
  }

  const vals = DAY_KEYS.map(k => out[k]);
  const uniform = vals.every(v => v !== undefined && v === vals[0]);
  return { hours: out, hrs: uniform && vals[0] !== 'closed' ? vals[0] : '', seasonal, closedDays, unknownDays };
}

// ---- metro records, for de-duplication ------------------------------------
function loadMetro() {
  const out = [];
  for (const file of METRO_FILES) {
    if (!fs.existsSync(file)) { console.warn(`! ${file} not found — no de-duplication against it`); continue; }
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
    for (const arr of Object.values(sandbox.window)) for (const r of arr) out.push(r);
  }
  return out;
}
function metersBetween(a, b, c, d) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (c - a) * toR, dLng = (d - b) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// "600 Madison Ave" and "600 Madison Avenue" -> "600 madison". Null when there is no house number.
const streetKey = s => { const m = String(s || '').trim().toLowerCase().match(/^(\d+[a-z]?(?:-\d+)?)\s+(?:(?:w|e|n|s|west|east|north|south)\.?\s+)?([a-z0-9]+)/); return m ? m[1] + ' ' + m[2] : null; };

function metroMatch(metro, lat, lng, addr) {
  let best = null;
  const key = streetKey(addr);
  for (const m of metro) {
    const dist = metersBetween(lat, lng, m.lat, m.lng);
    if (dist > 250) continue;
    if (dist <= 60 || (key && key === streetKey(m.addr))) {
      if (!best || dist < best.dist) best = { id: m.id, dist };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
const doc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const feats = doc.features || [];
const meta = doc.dataset_attributes || {};
const collected = (meta['spider:collection_time'] || '').slice(0, 10) || null;
const metro = loadMetro();

const stats = {
  total: feats.length, licensed: 0, noCoords: 0, outOfBounds: 0, closedName: 0, metroDup: 0,
  venue: {}, kept: 0, hoursBaked: 0, hoursUnparsed: 0, uniform: 0, seasonal: 0, closedDays: 0, unknownDays: 0,
};
const excluded = [];
const records = [];
const seenId = new Set();

for (const f of feats) {
  const p = f.properties || {};
  const g = f.geometry;
  const ref = String(p.ref || '').trim();
  const addr = String(p['addr:street_address'] || '').trim();
  const city = String(p['addr:city'] || '').trim();
  const state = String(p['addr:state'] || '').trim();
  const zip = String(p['addr:postcode'] || '').trim();
  const skip = (reason, extra) => excluded.push([ref, reason, addr, city, state, extra || '']);

  if (p.ownership_type !== 'CO') { stats.licensed++; skip('LICENSED_' + (p.ownership_type || 'UNKNOWN'), p.located_in || ''); continue; }
  if (!g || !g.coordinates || g.coordinates.length < 2) { stats.noCoords++; skip('NO_COORDS'); continue; }
  const lng = Number(g.coordinates[0]);
  const lat = Number(g.coordinates[1]);
  if (!isFinite(lat) || !isFinite(lng) ||
      lat < US.minLat || lat > US.maxLat || lng < US.minLon || lng > US.maxLon) {
    stats.outOfBounds++; skip('BAD_COORDS'); continue;
  }
  if (/\bclosed\b/i.test(`${p.name || ''} ${p.branch || ''}`)) { stats.closedName++; skip('CLOSED_AT_SOURCE', p.branch); continue; }
  const cat = venueCategory(addr, city);
  if (cat && EXCLUDED_VENUES.has(cat)) { stats.venue[cat] = (stats.venue[cat] || 0) + 1; skip(cat, p.branch); continue; }
  const dup = metroMatch(metro, lat, lng, addr);
  if (dup) { stats.metroDup++; skip('SAME_AS_METRO_RECORD', `${dup.id} (${Math.round(dup.dist)} m)`); continue; }

  const id = `starbucks-${ref}`;
  if (!ref || seenId.has(id)) { skip('DUPLICATE_OR_MISSING_REF'); continue; }
  seenId.add(id);

  const raw = p.opening_hours || '';
  const baked = bakeHours(raw, lat, lng);
  if (baked.hours) stats.hoursBaked++; else if (raw) stats.hoursUnparsed++;
  if (baked.hrs) stats.uniform++;
  if (baked.seasonal) stats.seasonal++;
  stats.closedDays += baked.closedDays || 0;
  stats.unknownDays += baked.unknownDays || 0;

  // Coordinates are written at the precision the source gives — never padded.
  const rec = {
    n: 'Starbucks',
    lat,
    lng,
    addr: [addr, city, `${state} ${zip}`.trim()].filter(Boolean).join(', '),
    id,
    hrs: baked.hrs,
    chain: 'starbucks',
    metroInfo: { access: 'customer', hoursRaw: raw },
  };
  // Per-day map only when the days differ; otherwise hrs alone says it (see build-dunkin.js).
  if (baked.hours && !baked.hrs) rec.hours = baked.hours;
  rec.state = state;
  rec.meta = { chain: 'Starbucks', state, store_ref: ref, dataSource: 'alltheplaces', lastVerified: collected };
  if (cat === 'HIGHWAY_PLAZA') rec.meta.venue = 'highway_plaza';
  if (p.phone) rec.phone = String(p.phone).trim();
  records.push(rec);
}
stats.kept = records.length;

records.sort((a, b) => (a.state || '').localeCompare(b.state || '') || a.id.localeCompare(b.id));

fs.writeFileSync(OUT, `window.starbucksLocations = [\n${records.map(r => JSON.stringify(r)).join(',\n')}\n];\n`);
fs.writeFileSync('starbucks-excluded.csv',
  'ref,reason,address,city,state,detail\n' +
  excluded.map(r => r.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n');

console.log(`source            ${SRC}  (collected ${collected || '?'})`);
console.log(`features read     ${stats.total}`);
console.log(`kept              ${stats.kept}`);
console.log('excluded:');
console.log(`  licensed        ${stats.licensed}`);
console.log(`  same as metro   ${stats.metroDup}  (NYC/Boston record kept instead)`);
console.log(`  no coordinates  ${stats.noCoords}`);
console.log(`  bad coordinates ${stats.outOfBounds}`);
console.log(`  closed at source ${stats.closedName}`);
for (const k of Object.keys(stats.venue).sort()) console.log(`  ${k.toLowerCase().padEnd(15)} ${stats.venue[k]}`);
console.log('hours:');
console.log(`  baked to a day map   ${stats.hoursBaked}`);
console.log(`  present but unparsed ${stats.hoursUnparsed}  (left unknown)`);
console.log(`  same every day       ${stats.uniform}`);
console.log(`  month-scoped rules   ${stats.seasonal}`);
console.log(`  days marked closed   ${stats.closedDays}  (no rule covers the day)`);
console.log(`  days left unknown    ${stats.unknownDays}  (split windows the parser can't express)`);
console.log(`\nwrote ${OUT} and starbucks-excluded.csv`);
