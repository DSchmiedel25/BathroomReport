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

function toRecords(stations) {
  const out = [];
  for (const st of stations) {
    const lat = Number(st.latitude), lng = Number(st.longitude);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    out.push({ id: String(st.id ?? ''), lat, lng, hours: parseHours(st) });
  }
  return out;
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
  console.log(`  24/7: ${h24}   timed: ${timed}   no hours: ${none}`);
  if (seenShapes.size) {
    console.log('  UNPARSED openingHours shapes (not guessed — report these):');
    [...seenShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .forEach(([sig, n]) => console.log(`     ${n}x  ${sig}`));
  }
}
