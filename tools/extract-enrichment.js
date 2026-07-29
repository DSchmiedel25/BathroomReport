#!/usr/bin/env node
/**
 * extract-enrichment.js — pull every useful field out of an All the Places spider file
 * and archive it keyed by coordinates, so future work is a lookup instead of a re-scrape.
 *
 *   node extract-enrichment.js <spider.geojson> <chain> <out.json>
 *
 * ATP publishes weekly and older builds aren't always retrievable, so the archive is the
 * durable copy. Fields are stored raw (OSM key names) rather than mapped to app features —
 * mapping is a product decision that can change; the source data shouldn't have to be
 * re-fetched when it does.
 */
const fs = require('fs');
const [, , inFile, chain, outFile] = process.argv;
if (!inFile || !chain) { console.error('usage: node extract-enrichment.js <spider.geojson> <chain> [out.json]'); process.exit(1); }

const KEEP = [
  'toilets', 'toilets:wheelchair', 'wheelchair', 'changing_table',
  'fuel:electricity', 'fuel:diesel', 'fuel:HGV_diesel', 'fuel:propane', 'fuel:kerosene',
  'fuel:e85', 'fuel:adblue', 'fuel:gasoline', 'fuel:octane_87', 'fuel:octane_88',
  'fuel:octane_89', 'fuel:octane_91',
  'atm', 'car_wash', 'hgv', 'shower', 'showers', 'internet_access', 'delivery',
  'sells:alcohol', 'phone', 'email', 'website', 'opening_hours',
  'addr:street_address', 'addr:city', 'addr:state', 'addr:postcode',
];

const j = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const feats = j.features || j;
const out = [];
const fieldCounts = {};
for (const f of feats) {
  const p = f.properties || {};
  const c = (f.geometry || {}).coordinates;
  if (!Array.isArray(c)) continue;
  const rec = { ref: p.ref || null, lat: Number(c[1]), lng: Number(c[0]) };
  let any = false;
  for (const k of KEEP) {
    if (p[k] === undefined || p[k] === null || p[k] === '') continue;
    rec[k] = p[k];
    fieldCounts[k] = (fieldCounts[k] || 0) + 1;
    if (!['addr:street_address','addr:city','addr:state','addr:postcode'].includes(k)) any = true;
  }
  if (any) out.push(rec);
}
const meta = {
  chain,
  source: 'alltheplaces',
  spider: (j.dataset_attributes || {})['@spider'] || null,
  collected: (j.dataset_attributes || {})['spider:collection_time'] || null,
  archived: new Date().toISOString().slice(0, 10),
  license: 'CC0-1.0',
  records: out.length,
  fields: fieldCounts,
};
fs.writeFileSync(outFile || `${chain}-enrichment.json`, JSON.stringify({ meta, records: out }));
console.log(`${chain}: ${out.length} records archived`);
console.log('  ' + Object.entries(fieldCounts).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`${k}:${v}`).join('  '));
