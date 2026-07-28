#!/usr/bin/env node
// bake-confirmed.js — promote community-confirmed amenities into the static location files.
//
// Reads votes-summary.json (from export-votes.js) and, for every location where the community
// has confirmed a feature (>= MIN_YES yes-votes AND yes > no — the SAME rule the app uses live),
// writes it into loc.conf on that record. This is AUTHORITATIVE and idempotent: it recomputes the
// full confirmed set each run, so a feature that has since dropped below threshold is removed.
//
// loc.conf is kept SEPARATE from loc.osm on purpose:
//   loc.osm  -> teal  "verified" badges (OpenStreetMap-sourced)
//   loc.conf -> green "confirmed by visitors" badges (community-sourced, stronger signal)
// The app still reads live votes on top of this, so new confirmations appear before the next bake;
// loc.conf just makes confirmed features instant on popup-open and permanent if votes are ever pruned.
//
// Usage:
//   node bake-confirmed.js votes-summary.json <chain-locations.js> [<chain-locations.js> ...]
//   node bake-confirmed.js votes-summary.json *-locations.js

const fs = require('fs');
const MIN_YES = 2;

const [, , summaryPath, ...locPaths] = process.argv;
if (!summaryPath || !locPaths.length) {
  console.error('Usage: node bake-confirmed.js votes-summary.json <chain-locations.js> [more...]');
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')).locations || {};

function confirmedSet(group) {
  const out = {};
  for (const [key, t] of Object.entries(group || {})) {
    if (t.yes >= MIN_YES && t.yes > t.no) out[key] = 1;
  }
  return out;
}

// Mirror of confirmedSet for "confirmed NO" (>= MIN_YES no-votes AND no > yes). Drives filters
// like the accessibility toggle; never rendered as a badge.
function confirmedNoSet(group) {
  const out = {};
  for (const [key, t] of Object.entries(group || {})) {
    if (t.no >= MIN_YES && t.no > t.yes) out[key] = 1;
  }
  return out;
}

let totalConf = 0, totalLocsTouched = 0;
for (const locPath of locPaths) {
  const src = fs.readFileSync(locPath, 'utf8');
  const s = src.indexOf('['), e = src.lastIndexOf(']');
  const header = src.slice(0, s);
  const arr = JSON.parse(src.slice(s, e + 1));

  let touched = 0, confCount = 0;
  for (const loc of arr) {
    const rec = summary[loc.id];
    // recompute authoritative conf; merge amenity + store-feature confirmations into one map
    const conf   = rec ? { ...confirmedSet(rec.amenities),   ...confirmedSet(rec.storeFeatures) }   : {};
    const confNo = rec ? { ...confirmedNoSet(rec.amenities), ...confirmedNoSet(rec.storeFeatures) } : {};
    if (Object.keys(conf).length)   { loc.conf = conf; touched++; confCount += Object.keys(conf).length; }
    else if (loc.conf)   delete loc.conf;      // fell below threshold since last bake — clear it
    if (Object.keys(confNo).length)  loc.confNo = confNo;
    else if (loc.confNo) delete loc.confNo;
  }
  // One record per line — same format as the other two bake writers (readable git diffs).
  fs.writeFileSync(locPath, header + '[\n' + arr.map(r => JSON.stringify(r)).join(',\n') + '\n];\n');
  totalConf += confCount; totalLocsTouched += touched;
  console.log(`${locPath}: ${touched} locations with confirmed features (${confCount} confirmations)`);
}
console.log(`\nTotal: ${totalConf} community confirmations baked across ${totalLocsTouched} locations.`);
