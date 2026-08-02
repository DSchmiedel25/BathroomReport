#!/usr/bin/env node
/*
 * fetch-public-toilets.js — pull `amenity=toilets` from Overpass, one state at a time.
 *
 * A single nationwide query times out on the public instance: the area filter alone has to walk
 * every node in the country before any tag matching happens. Per-state queries each finish well
 * inside the timeout, and a failure costs one state rather than the whole run.
 *
 * RESUMABLE ON PURPOSE. A state whose JSON already exists is skipped, so a run that dies at
 * Wyoming can be restarted without re-fetching the forty states before it. Delete a state's file
 * to force a refresh.
 *
 * Overpass is free infrastructure run on donated hardware and it WILL rate-limit or ban an
 * inconsiderate client. The delay below is not a formality — leave it alone, and prefer running
 * this once overnight over running it repeatedly.
 *
 * USAGE  node fetch-public-toilets.js            # all states
 *        node fetch-public-toilets.js NY MA CA   # just these
 *        node fetch-public-toilets.js --count    # sizes only, downloads nothing
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OSM_DIR = 'osm-data';
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const DELAY_MS = 8000;      // between states — deliberately generous
const BACKOFF_MS = 60000;   // first wait after a throttle; doubles on the second
const MAX_RETRIES = 2;      // per state, on 429/504 only
const TIMEOUT_S = 300;      // server-side query budget

const ALL_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const args = process.argv.slice(2);
const COUNT_ONLY = args.includes('--count');
const states = args.filter(a => /^[A-Z]{2}$/.test(a));
const targets = states.length ? states : ALL_STATES;

/* `nwr` covers nodes, ways and relations — a park restroom is often a building footprint rather
 * than a point, and `out center` collapses those to a usable coordinate.
 *
 * Access is filtered server-side so the excluded nodes never cross the wire. Blank access is
 * KEPT: most toilet nodes carry no access tag at all, and treating absence as private would
 * discard the bulk of the dataset. */
function query(st, countOnly) {
  return `[out:json][timeout:${TIMEOUT_S}];
area["ISO3166-2"="US-${st}"][admin_level=4]->.a;
nwr["amenity"="toilets"]["access"!~"^(private|customers|permit|no)$"](area.a);
out ${countOnly ? 'count' : 'center tags'};`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* One POST, with a real retry on the two statuses that mean "come back later".
 *
 * 429 is an explicit rate limit and 504 is a gateway timeout, but on a small state a 504 is
 * almost always the same thing wearing a different hat — Delaware does not take five minutes to
 * answer, it was refused a slot. Both are worth one patient retry; anything else is a genuine
 * failure and is reported as one.
 *
 * The earlier version printed "backing off 60s, then retrying once" and then threw immediately
 * after sleeping, so the message described a retry that never happened and every throttled
 * state landed in the failed list needing a manual re-run. */
async function askOverpass(st, countOnly, attempt = 1) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass asks clients to identify themselves; an anonymous heavy client is the
      // first thing an admin blocks.
      'User-Agent': 'BathroomReport/1.0 (+https://bathroomreport.app)',
    },
    body: 'data=' + encodeURIComponent(query(st, countOnly)),
  });

  if ((res.status === 429 || res.status === 504) && attempt <= MAX_RETRIES) {
    const wait = BACKOFF_MS * attempt;   // 60s, then 120s
    console.log(`  ${st}  ${res.status} — waiting ${wait / 1000}s, then retry ${attempt} of ${MAX_RETRIES}`);
    await sleep(wait);
    return askOverpass(st, countOnly, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}${attempt > 1 ? ` after ${attempt - 1} retr${attempt === 2 ? 'y' : 'ies'}` : ''}`);
  return res.json();
}

async function run() {
  fs.mkdirSync(OSM_DIR, { recursive: true });
  let fetched = 0, skipped = 0, failed = [];

  for (const st of targets) {
    const out = path.join(OSM_DIR, `public-toilets-${st}.json`);
    if (!COUNT_ONLY && fs.existsSync(out)) {
      console.log(`  ${st}  already present — skipped`);
      skipped++;
      continue;
    }

    try {
      const json = await askOverpass(st, COUNT_ONLY);

      if (COUNT_ONLY) {
        const t = (json.elements && json.elements[0] && json.elements[0].tags) || {};
        console.log(`  ${st}  ${String(t.total || 0).padStart(6)} element(s)`);
      } else {
        fs.writeFileSync(out, JSON.stringify(json));
        console.log(`  ${st}  ${String((json.elements || []).length).padStart(6)} element(s)  → ${out}`);
        fetched++;
      }
    } catch (e) {
      console.warn(`  ${st}  FAILED: ${e.message}`);
      failed.push(st);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nfetched ${fetched}, skipped ${skipped}, failed ${failed.length}`);
  if (failed.length) console.log(`retry with:  node fetch-public-toilets.js ${failed.join(' ')}`);
  if (!COUNT_ONLY && fetched) console.log('next:  node build-public-toilets.js');
}

run();
