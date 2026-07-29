#!/usr/bin/env node
/**
 * fetch-circlek-hours.js — pull Circle K store hours from their public locator API
 * and emit the flat {lat,lng,hours} array that match-hours.js consumes.
 *
 *   node fetch-circlek-hours.js                 # walk the US grid, write ck-hours.json
 *   node fetch-circlek-hours.js --from stations.json   # parse a saved response (no network)
 *
 * The endpoint is bounding-box based and caps at `maxResults`, so we walk a grid and
 * subdivide any cell that comes back full — otherwise dense metros silently truncate.
 * Requests are serialised with a delay: this is someone else's server.
 */
const fs = require('fs');

const API = 'https://api.circlek.com/us/ngrp-store-locator/v1/stations';
const MAX = 2000;
const DELAY_MS = 400;
const STEP = 2.0;                      // starting grid cell, degrees
const MIN_STEP = 0.25;                 // stop subdividing here
const BOXES = [                        // [west, south, east, north]
  [-125, 24.5, -66.5, 49.5],           // lower 48
  [-170, 51,   -129,  72],             // Alaska
  [-161, 18,   -154,  23],             // Hawaii
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- hours parsing ------------------------------------------------------
 * Known shape: {alwaysOpen:true}. Day-schedule stores use a shape we haven't
 * seen yet, so anything unrecognised is recorded as UNKNOWN and reported —
 * never guessed. Guessing here would write wrong open/closed states.        */
const seenShapes = new Map();
function parseHours(st) {
  const oh = st.openingHours || st.openingHoursStore || null;
  if (!oh || typeof oh !== 'object') return '';
  if (oh.alwaysOpen === true) return '24';
  if (oh.alwaysOpen === false && Object.keys(oh).length === 1) return '';

  // Try a day-keyed structure: {monday:{open:"05:00",close:"23:00"}, ...} or
  // {monday:{openTime:"0500",closeTime:"2300"}} — take a weekday as representative.
  const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const key = Object.keys(oh).find((k) => DAYS.includes(k.toLowerCase()));
  if (key) {
    const d = oh[key];
    const o = d && (d.open ?? d.openTime ?? d.from ?? d.start);
    const c = d && (d.close ?? d.closeTime ?? d.to ?? d.end);
    const norm = (v) => {
      if (v == null) return null;
      const m = String(v).match(/^(\d{1,2}):?(\d{2})/);
      return m ? String(m[1]).padStart(2, '0') + m[2] : null;
    };
    const O = norm(o), C = norm(c);
    if (O && C) return O === C ? '24' : `${O}-${C}`;
  }
  const sig = JSON.stringify(oh).slice(0, 120);
  seenShapes.set(sig, (seenShapes.get(sig) || 0) + 1);
  return '';
}

/* Capture everything useful in ONE pass. The first version of this script took hours and
 * discarded the rest, which meant a second run to get data that was already on the wire.
 * The services array is the important part: NA_PUBLIC_RESTROOMS is Circle K telling us, per
 * store, that there is a public restroom — first-party and it VARIES between stores, which is
 * what makes it trustworthy (a flag present on 100% of records is a template, not a fact). */
function toRecords(stations) {
  const out = [];
  for (const st of stations) {
    const lat = Number(st.latitude), lng = Number(st.longitude);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const svc = Array.isArray(st.services) ? st.services.map(s => s && s.name).filter(Boolean) : [];
    const a = st.address || {};
    const rec = {
      id: String(st.id ?? ''), lat, lng,
      hours: parseHours(st),
      // per-day map when the week actually varies — the app prefers loc.hours over loc.hrs
      days: parseHoursPerDay(st),
      restroom: svc.includes('NA_PUBLIC_RESTROOMS') ? 'yes' : '',
      services: svc,
      phone: String(st.phoneNumber || '').trim(),
      addr: [a.street, a.city, [a.state, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      state: a.state || '',
      brand: st.publicBrand || st.brand || ''
    };
    if (!rec.days) delete rec.days;
    out.push(rec);
  }
  return out;
}

/* Returns a mon..sun map ONLY when the days genuinely differ. When every day is the same the
 * single `hours` window already says it, and a map would be noise. */
const DAY_NAMES = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_KEYS  = { monday:'mon', tuesday:'tue', wednesday:'wed', thursday:'thu',
                    friday:'fri', saturday:'sat', sunday:'sun' };
function parseHoursPerDay(st) {
  const oh = st.openingHours || st.openingHoursStore || null;
  if (!oh || typeof oh !== 'object' || oh.alwaysOpen === true) return null;
  const norm = (v) => {
    if (v == null) return null;
    const m = String(v).match(/^(\d{1,2}):?(\d{2})/);
    return m ? String(m[1]).padStart(2, '0') + m[2] : null;
  };
  const map = {};
  for (const d of DAY_NAMES) {
    const day = oh[d];
    if (!day) return null;                       // partial week -> can't build a map
    const o = norm(day.open ?? day.openTime ?? day.from);
    const c = norm(day.close ?? day.closeTime ?? day.to);
    if (!o || !c) return null;
    map[DAY_KEYS[d]] = (o === c || `${o}-${c}` === '0000-2400') ? '24' : `${o}-${c}`;
  }
  const vals = new Set(Object.values(map));
  return vals.size === 1 ? null : map;           // uniform week -> the single window covers it
}

async function fetchBox(w, s, e, n, depth = 0) {
  const url = `${API}?bottomRightLongitude=${e}&bottomRightLatitude=${s}` +
              `&topLeftLongitude=${w}&topLeftLatitude=${n}` +
              `&maxResults=${MAX}&country=US&brand=CIRCLEK,COUCHE_TARD,HOLIDAY`;
  let data;
  try {
    const res = await fetch(url, { headers: { 'accept': 'application/json' } });
    if (!res.ok) { console.warn(`  ! HTTP ${res.status} for box ${w},${s},${e},${n}`); return []; }
    data = await res.json();
  } catch (err) {
    console.warn(`  ! ${err.message} for box ${w},${s},${e},${n}`);
    return [];
  }
  const list = Array.isArray(data) ? data : (data.stations || data.results || []);
  await sleep(DELAY_MS);

  // A full response means the box was truncated — split it rather than lose stores.
  const span = Math.max(e - w, n - s);
  if (list.length >= MAX && span > MIN_STEP) {
    const mx = (w + e) / 2, my = (s + n) / 2;
    const parts = [];
    for (const [a, b, c, d] of [[w,s,mx,my],[mx,s,e,my],[w,my,mx,n],[mx,my,e,n]])
      parts.push(...await fetchBox(a, b, c, d, depth + 1));
    return parts;
  }
  return list;
}

(async () => {
  const fromIdx = process.argv.indexOf('--from');
  if (fromIdx > -1) {
    const raw = JSON.parse(fs.readFileSync(process.argv[fromIdx + 1], 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw.stations || raw.results || []);
    const recs = toRecords(list);
    console.log(`parsed ${recs.length} stations from file`);
    report(recs);
    fs.writeFileSync('ck-hours.json', JSON.stringify(recs));
    console.log('wrote ck-hours.json');
    return;
  }

  const byId = new Map();
  for (const [W, S, E, N] of BOXES) {
    for (let x = W; x < E; x += STEP) {
      for (let y = S; y < N; y += STEP) {
        const list = await fetchBox(x, y, Math.min(x + STEP, E), Math.min(y + STEP, N));
        for (const st of list) if (st && st.id != null) byId.set(String(st.id), st);
        process.stdout.write(`\r  collected ${byId.size} stations…   `);
      }
    }
  }
  console.log();
  const recs = toRecords([...byId.values()]);
  report(recs);
  fs.writeFileSync('ck-hours.json', JSON.stringify(recs));
  console.log('wrote ck-hours.json  ->  node match-hours.js circle-k-locations.js ck-hours.json');
})();

function report(recs) {
  const h24 = recs.filter((r) => r.hours === '24').length;
  const timed = recs.filter((r) => r.hours && r.hours !== '24').length;
  const none = recs.filter((r) => !r.hours).length;
  const perDay = recs.filter((r) => r.days).length;
  console.log(`  24/7: ${h24}   timed: ${timed}   no hours: ${none}   per-day schedules: ${perDay}`);
  console.log(`  public restroom confirmed: ${recs.filter((r) => r.restroom === 'yes').length}`);
  console.log(`  with phone: ${recs.filter((r) => r.phone).length}   with address: ${recs.filter((r) => r.addr).length}`);
  if (seenShapes.size) {
    console.log('  UNPARSED openingHours shapes (not guessed — report these):');
    [...seenShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .forEach(([sig, n]) => console.log(`     ${n}x  ${sig}`));
  }
}
