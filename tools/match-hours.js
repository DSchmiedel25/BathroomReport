#!/usr/bin/env node
/**
 * match-hours.js — fill in missing `hrs` on an existing *-locations.js file by
 * matching against a locator export.
 *
 *   node match-hours.js <chain-locations.js> <scraped.json> [--write] [--radius=120]
 *
 * The scraped JSON must be an array of objects with at least:
 *     { lat, lng, hours }        // hours: "24" for 24/7, or "H:MM-H:MM", or "" if unknown
 * Extra fields are ignored, so you can dump the locator response in raw.
 *
 * Default is a DRY RUN: it reports what would change and writes nothing.
 * Pass --write to actually update the locations file (a .bak is kept).
 *
 * Deliberate rules:
 *   - Never overwrite an existing non-empty `hrs`. Baked community corrections and
 *     verified hours outrank a locator scrape.
 *   - Only match within `radius` metres AND only when the match is unambiguous —
 *     if two locator stores are both in range, the pin is skipped and reported.
 *     Twin stores at one interchange are common and a wrong match is worse than none.
 *   - Anything not matched is listed so it can be reviewed rather than silently dropped.
 */
const fs = require('fs');

const [, , locFile, scrapeFile, ...flags] = process.argv;
if (!locFile || !scrapeFile) {
  console.error('usage: node match-hours.js <chain-locations.js> <scraped.json> [--write] [--radius=120]');
  process.exit(1);
}
const WRITE = flags.includes('--write');
const RADIUS = Number((flags.find(f => f.startsWith('--radius=')) || '--radius=120').split('=')[1]);

// ---- load the existing locations file (window.xxxLocations = [ ... ];) ----
const raw = fs.readFileSync(locFile, 'utf8');
const start = raw.indexOf('[');
const end = raw.lastIndexOf(']');
if (start < 0 || end < 0) { console.error('Could not find the array in ' + locFile); process.exit(1); }
const header = raw.slice(0, start);
const footer = raw.slice(end + 1);
let locs;
try { locs = JSON.parse(raw.slice(start, end + 1)); }
catch (e) { console.error('Could not parse locations array: ' + e.message); process.exit(1); }

const scraped = JSON.parse(fs.readFileSync(scrapeFile, 'utf8'));
if (!Array.isArray(scraped)) { console.error('Scraped file must be a JSON array.'); process.exit(1); }

// ---- normalise scraped hours into the compact format the app already uses ----
function normHours(h) {
  if (h == null) return '';
  if (typeof h === 'object') {                       // e.g. {open:"05:00",close:"23:00"}
    if (h.open && h.close) h = h.open + '-' + h.close; else return '';
  }
  const s = String(h).trim();
  if (!s) return '';
  if (/^(24\s*\/?\s*7|24\s*h(ou)?rs?|open\s*24)/i.test(s) || s === '24') return '24';
  const m = s.match(/(\d{1,2}):?(\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*[-–to]+\s*(\d{1,2}):?(\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (!m) return '';
  // IMPORTANT: the app parses hours as "HHMM-HHMM" via parseInt (see isLocationOpenNow).
  // A colon form like "05:00-23:00" parses to 5 and 23 — i.e. 00:05 to 00:23 — so the
  // output MUST be four digits with no separator.
  const to24 = (hh, mm, ap) => {
    let H = parseInt(hh, 10);
    if (ap && /p/i.test(ap) && H !== 12) H += 12;
    if (ap && /a/i.test(ap) && H === 12) H = 0;
    return String(H).padStart(2, '0') + (mm || '00');
  };
  let open = to24(m[1], m[2], m[3]), close = to24(m[4], m[5], m[6]);
  if (open === close) return '24';                   // e.g. 12am-12am
  if (close === '0000') close = '2400';              // midnight close, matching existing data
  return open + '-' + close;
}

// ---- spatial index so this stays fast on 6,000+ pins ----
const R = 6371000;
const rad = d => d * Math.PI / 180;
function metres(a, b, c, d) {
  const dLat = rad(c - a), dLng = rad(d - b);
  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const CELL = 0.02;                                   // ~2km cells
const grid = new Map();
scraped.forEach((s, i) => {
  const la = Number(s.lat), ln = Number(s.lng);
  if (!isFinite(la) || !isFinite(ln)) return;
  const k = Math.round(la / CELL) + ':' + Math.round(ln / CELL);
  if (!grid.has(k)) grid.set(k, []);
  // `days` = per-day map ({mon:"0500-1900",…}); the app prefers loc.hours over loc.hrs.
  grid.get(k).push({ i, la, ln, hrs: normHours(s.hours ?? s.hrs ?? s.openingHours), days: s.days || null });
});
function candidates(la, ln) {
  const out = [];
  const gy = Math.round(la / CELL), gx = Math.round(ln / CELL);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = grid.get((gy + dy) + ':' + (gx + dx));
    if (c) out.push(...c);
  }
  return out;
}

// ---- match ----
let filled = 0, filledDays = 0, already = 0, noMatch = 0, ambiguous = 0, matchedNoHours = 0, badFormat = 0;
const ambiguousList = [], unmatchedList = [];
for (const loc of locs) {
  const la = Number(loc.lat), ln = Number(loc.lng);
  if (!isFinite(la) || !isFinite(ln)) { noMatch++; continue; }
  const inRange = candidates(la, ln)
    .map(c => ({ ...c, d: metres(la, ln, c.la, c.ln) }))
    .filter(c => c.d <= RADIUS)
    .sort((a, b) => a.d - b.d);

  if (!inRange.length) { noMatch++; if (unmatchedList.length < 20) unmatchedList.push(loc.id); continue; }
  if (inRange.length > 1 && inRange[1].d - inRange[0].d < 40) {
    ambiguous++; if (ambiguousList.length < 20) ambiguousList.push(loc.id);
    continue;                                        // too close to call — leave it alone
  }
  const { hrs, days } = inRange[0];
  const hasExisting = (loc.hrs && String(loc.hrs).trim()) ||
                      (loc.hours && typeof loc.hours === 'object' && Object.keys(loc.hours).length);
  if (days) {
    const vals = Object.values(days);
    if (vals.length !== 7 || vals.some(v => v !== '24' && v !== 'closed' && !/^\d{4}-\d{4}$/.test(v))) {
      badFormat++; continue;
    }
    if (hasExisting) { already++; continue; }
    loc.hours = days;                 // per-day map wins over the single window
    filledDays++; filled++;
    continue;
  }
  if (!hrs) { matchedNoHours++; continue; }
  if (hrs !== '24' && !/^\d{4}-\d{4}$/.test(hrs)) { badFormat++; continue; }   // never write a shape the app can't parse
  if (hasExisting) { already++; continue; }
  loc.hrs = hrs;
  filled++;
}

console.log('locations file : ' + locFile + '  (' + locs.length + ' records)');
console.log('locator export : ' + scrapeFile + '  (' + scraped.length + ' stores)');
console.log('match radius   : ' + RADIUS + 'm\n');
console.log('  FILLED hours          : ' + filled + (filledDays ? '  (' + filledDays + ' per-day schedules)' : ''));
console.log('  already had hours     : ' + already);
console.log('  matched, no hours     : ' + matchedNoHours);
console.log('  ambiguous (skipped)   : ' + ambiguous);
console.log('  unparseable hours     : ' + badFormat);
console.log('  no match in range     : ' + noMatch);
if (ambiguousList.length) console.log('\n  sample ambiguous: ' + ambiguousList.slice(0, 5).join(', '));
if (unmatchedList.length) console.log('  sample unmatched: ' + unmatchedList.slice(0, 5).join(', '));

if (!WRITE) { console.log('\nDRY RUN — nothing written. Re-run with --write to apply.'); process.exit(0); }
fs.copyFileSync(locFile, locFile + '.bak');
const body = locs.map(o => '  ' + JSON.stringify(o)).join(',\n');
fs.writeFileSync(locFile, header + '[\n' + body + '\n]' + footer);
console.log('\nWritten. Backup at ' + locFile + '.bak');
