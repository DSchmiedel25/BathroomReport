#!/usr/bin/env node
/* Build dunkin-locations.js from the All The Places `dunkin_us` scrape.
 *
 * Hours are parsed with hours-osm.js — the same module the public-restroom
 * sets use — evaluated once per weekday so the result is a baked `hours` map
 * in the app's canonical vocabulary ("24" | "HHMM-HHMM" | "closed" | absent).
 * Nothing here reimplements opening_hours parsing; a second parser would drift
 * from the first.
 *
 * Excluded, with counts printed at the end:
 *   - records with no coordinates (upstream has not geocoded them yet)
 *   - coordinates outside the US bounding box (corrupt upstream data)
 *   - names flagged closed at source
 *   - airport / mall / military / stadium venue units, which are kiosks inside
 *     a host site rather than stores with their own restroom
 *
 * Highway service plazas are KEPT: they are travel stops, which is the app's
 * core case, and they read as venue-like only because their address is a
 * milepost rather than a street number.
 *
 * Usage: node build-dunkin.js path/to/dunkin_us.geojson
 */
'use strict';

const fs = require('fs');
const path = require('path');
const OsmHours = require('./hours-osm.js');

const SRC = process.argv[2] || 'dunkin_us_1.geojson';
const OUT = 'dunkin-locations.js';
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// US bounding box, generous enough for HI and AK.
const US = { minLat: 18, maxLat: 72, minLon: -180, maxLon: -64 };

/* Venue detection. A store whose address is a venue NAME rather than a street
 * address is inside a host site. Street-name keywords ("Airport Rd", "Mall Dr",
 * "Turnpike St") are ordinary roadside stores and must not match — an earlier
 * naive keyword pass flagged 286 records, most of them wrongly. */
const PLAZA_MARKER = /\b(service plaza|travel pl(a)?z|rest area|milepost|mile ?post|mile \d|mm ?\d|mp#?\d|(north|south|east|west)bound)\b/i;
const PLAZA = /\b(turnpike|tpke|thruway|njtp|interstate \d|i-\d+|garden state pkwy)\b/i;
const AIRPORT_STRONG = /\b(int'?l airport|international airport|intl airport|airport terminal|terminal \d|concourse [a-z]\b|sky harbor|love field airport|logan (int|air)|logal international|o'hare airport|laguardia airport|jfk (intl|airport)|dulles international|dulles intl|bwi airport|tf green airport|houston hobby airport|reagan (national|airport)|ronald reagan airport|midway int'?l airport|midway airport)\b/i;
const AIRPORT_WEAK = /\b(airport|aiport)\b/i;
const MILITARY = /\b(air force base|naval station|naval exchange|marine corps base|army depot|hanscom|mayport naval)\b/i;
const TRANSIT = /\b(ferry terminal|port authority|bus terminal|penn station|train station|amtrak)\b/i;
const VENUE = /\b(metlife stadium|fleet cent(er|re)|legends way|coliseum|ballpark)\b/i;
const MALL = /\b(galleria|premium outlets?|food court)\b|\b(mall|shopping ctr|shopping center)\b(?! ?(dr|drive|rd|road|blvd|st|street|ave|way|ln|ct|pkwy|circle|loop))/i;

function venueCategory(addr, city) {
  const blob = `${addr}, ${city}`;
  const hasNumber = /^\d/.test(addr.trim());
  if (PLAZA_MARKER.test(blob) || (PLAZA.test(blob) && !hasNumber)) return 'HIGHWAY_PLAZA';
  if (AIRPORT_STRONG.test(blob) || (AIRPORT_WEAK.test(blob) && !hasNumber)) return 'AIRPORT';
  if (MILITARY.test(blob)) return 'MILITARY';
  if (TRANSIT.test(blob)) return 'TRANSIT_HUB';
  if (VENUE.test(blob)) return 'STADIUM_ARENA';
  if (MALL.test(blob)) return 'MALL';
  return null;
}
const EXCLUDED_VENUES = new Set(['AIRPORT', 'MILITARY', 'TRANSIT_HUB', 'STADIUM_ARENA', 'MALL']);

/* Evaluate an opening_hours string for each weekday. Uses a fixed reference
 * week so the output does not depend on the day the bake happens to run.
 * Month-scoped rules are resolved against that week, so a seasonal value bakes
 * to whatever it means in mid-March — noted in the summary, not silently. */
const REF_SUNDAY = new Date(Date.UTC(2026, 2, 15, 12, 0, 0)); // Sun 2026-03-15

function bakeHours(raw, lat, lng) {
  if (!raw) return { hours: null, hrs: '', seasonal: false };
  const out = {};
  let known = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(REF_SUNDAY.getTime() + i * 86400000);
    // getDay() on this Date must equal i for the parser to select the right rule.
    const v = OsmHours.todayDetail(raw, { date: d, lat, lng, solarOk: false }).value;
    if (v !== null && v !== undefined) { out[DAY_KEYS[d.getDay()]] = v; known++; }
  }
  const seasonal = /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(raw);
  if (!known) return { hours: null, hrs: '', seasonal, closedDays: 0 };

  /* A day no rule matched is CLOSED, not unknown — that is what opening_hours
   * means when the value carries day selectors ("Mo-Fr 06:30-18:00" is shut on
   * the weekend). Only safe because we got here with at least one day parsed,
   * which rules out a parse failure, and because no value in this feed is
   * month-scoped (a seasonal gap would be out-of-season, not closed). */
  let closedDays = 0;
  if (!seasonal) {
    for (const k of DAY_KEYS) {
      if (out[k] === undefined) { out[k] = 'closed'; closedDays++; }
    }
  }

  // Every day the same and all seven present -> the single-window form is enough.
  const vals = DAY_KEYS.map(k => out[k]);
  const uniform = vals.every(v => v !== undefined && v === vals[0]);
  return {
    hours: out,
    hrs: uniform && vals[0] !== 'closed' ? vals[0] : '',
    seasonal,
    closedDays,
  };
}

// ---------------------------------------------------------------------------
const doc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const feats = doc.features || [];
const meta = doc.dataset_attributes || {};

const stats = {
  total: feats.length, noCoords: 0, outOfBounds: 0, closedName: 0,
  venue: {}, kept: 0, hoursBaked: 0, hoursUnparsed: 0, uniform: 0, seasonal: 0, closedDays: 0,
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

  if (!g || !g.coordinates || g.coordinates.length < 2) {
    stats.noCoords++; excluded.push([ref, 'NO_COORDS', addr, city, state]); continue;
  }
  const lng = Number(g.coordinates[0]);
  const lat = Number(g.coordinates[1]);
  if (!isFinite(lat) || !isFinite(lng) ||
      lat < US.minLat || lat > US.maxLat || lng < US.minLon || lng > US.maxLon) {
    stats.outOfBounds++; excluded.push([ref, 'BAD_COORDS', addr, city, state]); continue;
  }
  if (/\bclosed\b/i.test(String(p.name || ''))) {
    stats.closedName++; excluded.push([ref, 'CLOSED_AT_SOURCE', addr, city, state]); continue;
  }
  const cat = venueCategory(addr, city);
  if (cat && EXCLUDED_VENUES.has(cat)) {
    stats.venue[cat] = (stats.venue[cat] || 0) + 1;
    excluded.push([ref, cat, addr, city, state]);
    continue;
  }

  const id = `dunkin-${ref}`;
  if (seenId.has(id)) { excluded.push([ref, 'DUPLICATE_REF', addr, city, state]); continue; }
  seenId.add(id);

  const raw = p.opening_hours || '';
  const baked = bakeHours(raw, lat, lng);
  if (baked.hours) stats.hoursBaked++; else if (raw) stats.hoursUnparsed++;
  if (baked.hrs) stats.uniform++;
  if (baked.seasonal) stats.seasonal++;
  stats.closedDays += baked.closedDays || 0;

  const rec = {
    n: "Dunkin'",
    lat: Number(lat.toFixed(7)),
    lng: Number(lng.toFixed(7)),
    addr: [addr, city, `${state} ${zip}`.trim()].filter(Boolean).join(', '),
    id,
    hrs: baked.hrs,
    chain: 'dunkin',
    metroInfo: { access: 'customer', hoursRaw: raw },
  };
  /* The per-day map is only carried when the days actually differ. When every
   * day is the same window, hrs says it in a tenth of the bytes and
   * todayHrsString falls through to it — this drops ~1.3MB off the file, which
   * the service worker caches on every phone. */
  if (baked.hours && !baked.hrs) rec.hours = baked.hours;
  rec.state = state;
  /* meta.state is read by app.js (the state-name lookup at 4337); city and zip
   * are not read anywhere and are recoverable from addr, so they are left out. */
  rec.meta = {
    chain: "Dunkin'",
    state,
    store_ref: ref,
    // hours_full is deliberately absent: metroInfo.hoursRaw already holds the
    // verbatim OSM string and that is the field the popup reads.
    dataSource: 'alltheplaces',
    lastVerified: (meta['spider:collection_time'] || '').slice(0, 10) || null,
  };
  if (cat === 'HIGHWAY_PLAZA') rec.meta.venue = 'highway_plaza';
  if (p.phone) rec.phone = String(p.phone).trim();

  records.push(rec);
}
stats.kept = records.length;

records.sort((a, b) => (a.state || '').localeCompare(b.state || '') ||
                       (a.meta.city || '').localeCompare(b.meta.city || '') ||
                       a.id.localeCompare(b.id));

const body = records.map(r => JSON.stringify(r)).join(',\n');
fs.writeFileSync(OUT, `window.dunkinLocations = [\n${body}\n];\n`);

fs.writeFileSync('dunkin-excluded.csv',
  'ref,reason,address,city,state\n' +
  excluded.map(r => r.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n');

console.log(`source            ${SRC}  (collected ${(meta['spider:collection_time'] || '?').slice(0, 10)})`);
console.log(`features read     ${stats.total}`);
console.log(`kept              ${stats.kept}`);
console.log('excluded:');
console.log(`  no coordinates  ${stats.noCoords}`);
console.log(`  bad coordinates ${stats.outOfBounds}`);
console.log(`  closed at source${String(stats.closedName).padStart(4)}`);
for (const k of Object.keys(stats.venue).sort()) {
  console.log(`  ${k.toLowerCase().padEnd(15)} ${stats.venue[k]}`);
}
console.log('hours:');
console.log(`  baked to a day map   ${stats.hoursBaked}`);
console.log(`  present but unparsed ${stats.hoursUnparsed}  (left unknown on purpose)`);
console.log(`  same every day       ${stats.uniform}  (also get the single hrs window)`);
console.log(`  month-scoped rules   ${stats.seasonal}  (baked against a mid-March reference week)`);
console.log(`  days marked closed   ${stats.closedDays}  (weekdays no rule covered)`);
console.log(`\nwrote ${OUT} and dunkin-excluded.csv`);
