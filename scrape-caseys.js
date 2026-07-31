#!/usr/bin/env node
/**
 * scrape-caseys.js — full Casey's location pull via their own store locator API.
 *
 * Strategy: flood fill, not blind grid.
 *   1. Seed the queue with every store we already know (caseys_merged.json).
 *   2. Query the API around each seed. Every store that comes back becomes a
 *      new seed if we haven't queried near it yet.
 *   3. Add a coarse background grid over the 19-state footprint so isolated
 *      clusters with zero known stores still get found.
 *   4. Stop when the queue drains. Dedupe by store number throughout.
 *
 * This visits ~3k points instead of ~10k for a naive grid, and it self-corrects:
 * a new store next to a known one is found automatically.
 *
 * Usage:
 *   node scrape-caseys.js --sitemap          # list every store from the sitemap
 *   node scrape-caseys.js --pages            # fetch each store page for coords
 *   node scrape-caseys.js --introspect       # ask the API to describe itself
 *   node scrape-caseys.js --discover         # dig the query out of the site's JS
 *   node scrape-caseys.js --probe            # one request, dump raw JSON, exit
 *   node scrape-caseys.js                    # full run
 *   node scrape-caseys.js --limit 50         # stop after 50 queries (smoke test)
 *
 * Requires Node 20+ (native fetch). No dependencies.
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const ENDPOINT = "https://www.caseys.com/api/graphql";
const SEARCH_RADIUS_MI = 50;   // radius asked of the API per query
const COVER_RADIUS_MI = 30;    // how much of that we trust as "covered"
const CONCURRENCY = 3;         // be polite — this is their production API
const DELAY_MS = 350;          // between requests per worker
const MAX_RETRIES = 3;

const SEEDS_FILE = path.join(__dirname, "caseys_merged.json");
const OUT_FILE = path.join(__dirname, "caseys_full.json");
const CHECKPOINT = path.join(__dirname, ".caseys-checkpoint.json");

// Footprint bounding box (19 states, generous margins)
const BBOX = { minLat: 29.0, maxLat: 49.2, minLng: -104.5, maxLng: -81.5 };
const GRID_SPACING_MI = 55;

const args = process.argv.slice(2);
const PROBE = args.includes("--probe");
const INTROSPECT = args.includes("--introspect");
const DISCOVER = args.includes("--discover");
const SITEMAP = args.includes("--sitemap");
const PAGES = args.includes("--pages");
const LIMIT = args.includes("--limit")
  ? parseInt(args[args.indexOf("--limit") + 1], 10)
  : Infinity;

// ---------------------------------------------------------------------------
// >>> ADAPTER — THE ONLY PART YOU MAY NEED TO EDIT <<<
//
// I could not verify Casey's exact GraphQL schema without hitting their API,
// so treat the query below as a first guess. To get the real one:
//
//   1. Open https://www.caseys.com/store-locator in Chrome
//   2. DevTools > Network > filter "graphql"
//   3. Search a zip code
//   4. Right-click the request > Copy > Copy as fetch
//   5. Paste the `query` string and variable names into QUERY / buildVariables
//   6. Run `node scrape-caseys.js --probe` and adjust normalizeStore() to match
//      the field names in the dumped response
//
// Everything below the adapter is schema-agnostic and won't need changes.
// ---------------------------------------------------------------------------

const QUERY = `
  query StoreLocator($lat: Float!, $lng: Float!, $radius: Int!) {
    stores(latitude: $lat, longitude: $lng, radius: $radius) {
      items {
        storeNumber
        name
        latitude
        longitude
        address { street city state zipcode }
        phone
        hours { day open close }
        services
      }
    }
  }
`;

function buildVariables(lat, lng) {
  return { lat, lng, radius: SEARCH_RADIUS_MI };
}

/** Pull the store array out of whatever shape the response has. */
function extractStores(json) {
  return json?.data?.stores?.items ?? json?.data?.stores ?? [];
}

/** Map one API store object into the BathroomReport record shape. */
function normalizeStore(s) {
  const a = s.address ?? s;
  const num = String(s.storeNumber ?? s.number ?? s.id ?? "").trim();
  if (!num) return null;

  const lat = Number(s.latitude ?? s.lat);
  const lng = Number(s.longitude ?? s.lng ?? s.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;

  return {
    id: `caseys-${num.padStart(4, "0")}`,
    chain: "caseys",
    store_number: num.padStart(4, "0"),
    name: "Casey's",
    lat: round6(lat),
    lng: round6(lng),
    address: a.street ?? a.address1 ?? a.line1 ?? null,
    city: a.city ?? null,
    state: (a.state ?? a.stateCode ?? "").toUpperCase().slice(0, 2) || null,
    zip: String(a.zipcode ?? a.zip ?? a.postalCode ?? "").split("-")[0] || null,
    phone: s.phone ?? s.phoneNumber ?? null,
    hours: formatHours(s.hours),
    website: s.url ?? s.website ?? null,
    has_fuel: hasService(s, /fuel|gas/i),
    has_diesel: hasService(s, /diesel/i),
    has_car_wash: hasService(s, /car ?wash/i),
    sells_alcohol: hasService(s, /alcohol|beer|liquor|wine/i),
    source: `caseys-api:${new Date().toISOString().slice(0, 10)}`,
    needs_enrichment: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers (schema-agnostic from here down)
// ---------------------------------------------------------------------------

const round6 = (n) => Math.round(n * 1e6) / 1e6;

function hasService(store, re) {
  const svc = store.services ?? store.amenities ?? [];
  const list = Array.isArray(svc) ? svc : Object.keys(svc).filter((k) => svc[k]);
  return list.some((x) => re.test(typeof x === "string" ? x : x?.name ?? ""));
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function formatHours(h) {
  if (!h) return null;
  if (typeof h === "string") return h;
  if (!Array.isArray(h) || !h.length) return null;
  const opens = new Set(h.map((d) => `${d.open}-${d.close}`));
  if (opens.size === 1) {
    const [only] = opens;
    if (only === "00:00-00:00" || only === "00:00-24:00") return "24/7";
    return `Mo-Su ${only}`;
  }
  return h.map((d, i) => `${DAYS[i] ?? d.day} ${d.open}-${d.close}`).join("; ");
}

function haversineMi(a, b) {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function queryCaseys(lat, lng) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: QUERY,
          variables: buildVariables(lat, lng),
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      if (json.errors) {
        throw new Error(
          "GraphQL error: " + JSON.stringify(json.errors).slice(0, 400)
        );
      }
      return json;
    } catch (e) {
      lastErr = e;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.caseys.com",
  Referer: "https://www.caseys.com/store-locator",
};

/** POST JSON and never blow up on an HTML error page — report it instead. */
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const ctype = res.headers.get("content-type") ?? "";

  if (!ctype.includes("json")) {
    const err = new Error(`Non-JSON response (HTTP ${res.status})`);
    err.diagnostic =
      `  status       : ${res.status} ${res.statusText}\n` +
      `  content-type : ${ctype}\n` +
      `  server       : ${res.headers.get("server") ?? "-"}\n` +
      `  cf-ray       : ${res.headers.get("cf-ray") ?? "-"}\n` +
      `  body (600ch) :\n${text.slice(0, 600)}`;
    throw err;
  }
  return JSON.parse(text);
}

async function getText(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Discovery: figure out the schema without a browser
// ---------------------------------------------------------------------------

const INTROSPECTION = `
{
  __schema {
    queryType {
      fields {
        name
        args { name type { name kind ofType { name kind } } }
        type { name kind ofType { name kind } }
      }
    }
  }
}`;

function typeName(t) {
  if (!t) return "?";
  return t.name ?? typeName(t.ofType) + (t.kind === "LIST" ? "[]" : "");
}

async function introspect() {
  console.log("Asking the endpoint to describe itself...\n");
  let json;
  try {
    json = await postJSON(ENDPOINT, { query: INTROSPECTION });
  } catch (e) {
    console.log(`${e.message}\n${e.diagnostic ?? ""}`);
    console.log(
      "\n--> The API is behind a bot filter or the path is wrong.\n" +
      "    Next: node scrape-caseys.js --sitemap"
    );
    return;
  }

  if (json.errors || !json.data?.__schema) {
    console.log("Introspection is disabled or blocked. Raw response:\n");
    console.log(JSON.stringify(json, null, 2).slice(0, 3000));
    console.log("\n--> Try: node scrape-caseys.js --discover");
    return;
  }

  const fields = json.data.__schema.queryType.fields;
  const hits = fields.filter((f) =>
    /store|location|find|near|shop|site/i.test(f.name)
  );

  console.log(`${fields.length} root query fields; ${hits.length} look relevant:\n`);
  for (const f of hits) {
    const a = f.args.map((x) => `${x.name}: ${typeName(x.type)}`).join(", ");
    console.log(`  ${f.name}(${a}) -> ${typeName(f.type)}`);
  }
  console.log("\nAll root fields:");
  console.log("  " + fields.map((f) => f.name).join(", "));
}

async function discover() {
  const page = "https://www.caseys.com/store-locator";
  console.log(`Fetching ${page} and scanning its JS for the query...\n`);

  const html = await getText(page);

  const bundles = [...new Set(
    [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) =>
      m[1].startsWith("http") ? m[1] : new URL(m[1], page).href
    )
  )];
  console.log(`${bundles.length} script bundles found. Scanning...\n`);

  const wanted = /(query|mutation)\s+\w*(Store|Location|Finder)\w*[\s\S]{0,900}?\}/gi;
  let found = 0;

  for (const url of bundles.slice(0, 40)) {
    let js = "";
    try {
      js = await (await fetch(url)).text();
    } catch { continue; }
    if (!/store/i.test(js) || !/query/i.test(js)) continue;

    for (const m of js.matchAll(wanted)) {
      console.log(`--- from ${url.split("/").pop()} ---`);
      console.log(m[0].slice(0, 900).replace(/\\n/g, "\n"));
      console.log();
      if (++found >= 8) return;
    }
  }
  if (!found) console.log("Nothing matched. Paste me the page URL you searched and I'll adapt.");
}

// ---------------------------------------------------------------------------
// Sitemap route — no API needed. Casey's publishes every store page, and the
// URL itself encodes state, city, street and store number:
//   /general-store/ky-paducah/5425-cairo-road/4464
// ---------------------------------------------------------------------------

const SITEMAP_ROOT = "https://www.caseys.com/sitemap.xml";
const SITEMAP_FILE = path.join(__dirname, "caseys_sitemap.json");
const STORE_URL_RE =
  /https:\/\/www\.caseys\.com\/general-store\/([a-z]{2})-([^/]+)\/([^/]+)\/(\d+)/gi;

const titleCase = (s) =>
  s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function collectSitemapUrls() {
  const seen = new Map();
  const queue = [SITEMAP_ROOT];
  const visited = new Set();

  while (queue.length) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    let xml;
    try {
      xml = await getText(url);
    } catch (e) {
      console.warn(`  ! ${e.message}`);
      continue;
    }

    for (const m of xml.matchAll(STORE_URL_RE)) {
      const [full, st, city, street, num] = m;
      if (!seen.has(num)) {
        seen.set(num, {
          store_number: num.padStart(4, "0"),
          state: st.toUpperCase(),
          city: titleCase(city),
          address: titleCase(street),
          url: full,
        });
      }
    }

    // follow nested sitemaps
    for (const m of xml.matchAll(/<loc>\s*([^<]+\.xml[^<]*)\s*<\/loc>/gi)) {
      const child = m[1].trim();
      if (!visited.has(child)) queue.push(child);
    }
    console.log(`  scanned ${url.split("/").pop()} — ${seen.size} stores so far`);
  }
  return [...seen.values()];
}

async function sitemap() {
  console.log(`Crawling ${SITEMAP_ROOT}...\n`);
  const stores = await collectSitemapUrls();

  if (!stores.length) {
    console.log("No store URLs found. The sitemap may be split differently.");
    return;
  }

  fs.writeFileSync(SITEMAP_FILE, JSON.stringify(stores, null, 1));

  const byState = {};
  stores.forEach((s) => (byState[s.state] = (byState[s.state] ?? 0) + 1));

  console.log(`\n${"=".repeat(52)}`);
  console.log(`  stores in sitemap : ${stores.length}`);
  console.log(`  vs reported 2,944 : ${(stores.length / 2944 * 100).toFixed(1)}%`);
  console.log(`  states            : ${Object.keys(byState).length}`);
  console.log(`${"=".repeat(52)}`);
  Object.entries(byState)
    .sort((a, b) => b[1] - a[1])
    .forEach(([st, n]) => console.log(`    ${st}  ${n}`));

  if (fs.existsSync(SEEDS_FILE)) {
    const known = new Set(
      JSON.parse(fs.readFileSync(SEEDS_FILE, "utf8"))
        .map((k) => k.store_number)
        .filter(Boolean)
    );
    const fresh = stores.filter((s) => !known.has(s.store_number));
    console.log(`\n  not in caseys_merged.json: ${fresh.length}`);
  }
  console.log(`\nWrote ${path.basename(SITEMAP_FILE)}. Next: --pages`);
}

/** Pull coordinates + hours from a store page's JSON-LD block. */
function parseStorePage(html, base) {
  const rec = { ...base };
  for (const m of html.matchAll(
    /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi
  )) {
    let ld;
    try { ld = JSON.parse(m[1].trim()); } catch { continue; }
    for (const node of [].concat(ld["@graph"] ?? ld)) {
      if (!node?.geo && !node?.address) continue;
      if (node.geo) {
        rec.lat = round6(Number(node.geo.latitude));
        rec.lng = round6(Number(node.geo.longitude));
      }
      if (node.address) {
        rec.address = node.address.streetAddress ?? rec.address;
        rec.city = node.address.addressLocality ?? rec.city;
        rec.state = (node.address.addressRegion ?? rec.state).toUpperCase();
        rec.zip = String(node.address.postalCode ?? "").split("-")[0] || null;
      }
      rec.phone = node.telephone ?? rec.phone ?? null;
      if (node.openingHours) {
        rec.hours = [].concat(node.openingHours).join("; ");
      }
    }
  }
  if (!rec.lat) {
    const m = html.match(/"latitude"\s*:\s*"?(-?\d+\.\d+)"?[\s\S]{0,120}?"longitude"\s*:\s*"?(-?\d+\.\d+)"?/i);
    if (m) { rec.lat = round6(+m[1]); rec.lng = round6(+m[2]); }
  }
  return rec;
}

async function pages() {
  if (!fs.existsSync(SITEMAP_FILE)) {
    console.log("Run --sitemap first."); return;
  }
  const list = JSON.parse(fs.readFileSync(SITEMAP_FILE, "utf8"));
  const out = fs.existsSync(CHECKPOINT)
    ? JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"))
    : {};
  const todo = list.filter((s) => !out[s.store_number]).slice(0, LIMIT);
  console.log(`${list.length} stores, ${todo.length} to fetch.\n`);

  let done = 0;
  const queue = [...todo];

  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      try {
        out[s.store_number] = parseStorePage(await getText(s.url), s);
      } catch (e) {
        console.warn(`  ! ${s.store_number}: ${e.message}`);
      }
      if (++done % 50 === 0) {
        console.log(`  ${done}/${todo.length}`);
        fs.writeFileSync(CHECKPOINT, JSON.stringify(out));
      }
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const all = Object.values(out).map((s) => ({
    id: `caseys-${s.store_number}`,
    chain: "caseys",
    store_number: s.store_number,
    name: "Casey's",
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    address: s.address ?? null,
    city: s.city ?? null,
    state: s.state ?? null,
    zip: s.zip ?? null,
    phone: s.phone ?? null,
    hours: s.hours ?? null,
    website: s.url,
    source: `caseys-sitemap:${new Date().toISOString().slice(0, 10)}`,
    needs_enrichment: !s.lat,
  })).sort((a, b) => a.store_number.localeCompare(b.store_number));

  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 1));
  if (fs.existsSync(CHECKPOINT)) fs.unlinkSync(CHECKPOINT);
  report(all, done);
}

// ---------------------------------------------------------------------------
// Probe mode
// ---------------------------------------------------------------------------

async function probe() {
  console.log("Probing endpoint with a query near Ankeny, IA (HQ)...\n");
  const json = await queryCaseys(41.7296, -93.6058);
  console.log(JSON.stringify(json, null, 2).slice(0, 4000));
  const stores = extractStores(json);
  console.log(`\n--- extractStores() found ${stores.length} store(s)`);
  if (stores.length) {
    console.log("--- first store, normalized:");
    console.log(JSON.stringify(normalizeStore(stores[0]), null, 2));
  }
}

// ---------------------------------------------------------------------------
// Main crawl
// ---------------------------------------------------------------------------

function buildGrid() {
  const pts = [];
  const latStep = GRID_SPACING_MI / 69;
  for (let lat = BBOX.minLat; lat <= BBOX.maxLat; lat += latStep) {
    const lngStep =
      GRID_SPACING_MI / (69 * Math.cos((lat * Math.PI) / 180));
    for (let lng = BBOX.minLng; lng <= BBOX.maxLng; lng += lngStep) {
      pts.push({ lat: round6(lat), lng: round6(lng) });
    }
  }
  return pts;
}

function loadSeeds() {
  if (!fs.existsSync(SEEDS_FILE)) {
    console.warn(`! ${path.basename(SEEDS_FILE)} not found — grid only.`);
    return [];
  }
  return JSON.parse(fs.readFileSync(SEEDS_FILE, "utf8"))
    .filter((r) => isFinite(r.lat) && isFinite(r.lng))
    .map((r) => ({ lat: r.lat, lng: r.lng }));
}

async function main() {
  if (INTROSPECT) return introspect();
  if (SITEMAP) return sitemap();
  if (PAGES) return pages();
  if (DISCOVER) return discover();
  if (PROBE) return probe();

  const stores = new Map();      // store_number -> record
  const queried = [];            // points already searched
  let queue = [];

  // resume if a previous run was interrupted
  if (fs.existsSync(CHECKPOINT)) {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    cp.stores.forEach((s) => stores.set(s.store_number, s));
    queried.push(...cp.queried);
    queue = cp.queue;
    console.log(
      `Resuming: ${stores.size} stores, ${queried.length} points done, ` +
      `${queue.length} queued.`
    );
  } else {
    const seeds = loadSeeds();
    const grid = buildGrid();
    queue = [...seeds, ...grid];
    console.log(`${seeds.length} known-store seeds + ${grid.length} grid points.`);
  }

  const covered = (p) =>
    queried.some((q) => haversineMi(p, q) < COVER_RADIUS_MI);

  let done = 0;
  let newSinceLog = 0;

  async function worker() {
    while (queue.length && done < LIMIT) {
      const pt = queue.shift();
      if (!pt || covered(pt)) continue;
      queried.push(pt);
      done++;

      let found = [];
      try {
        found = extractStores(await queryCaseys(pt.lat, pt.lng));
      } catch (e) {
        console.warn(`  ! ${pt.lat},${pt.lng}: ${e.message}`);
        await sleep(DELAY_MS);
        continue;
      }

      for (const raw of found) {
        const rec = normalizeStore(raw);
        if (!rec) continue;
        if (!stores.has(rec.store_number)) {
          stores.set(rec.store_number, rec);
          newSinceLog++;
          // newly discovered store becomes a search seed
          if (!covered(rec)) queue.push({ lat: rec.lat, lng: rec.lng });
        }
      }

      if (done % 25 === 0) {
        console.log(
          `  ${done} queries | ${stores.size} stores (+${newSinceLog}) | ` +
          `${queue.length} queued`
        );
        newSinceLog = 0;
        fs.writeFileSync(
          CHECKPOINT,
          JSON.stringify({ stores: [...stores.values()], queried, queue })
        );
      }

      await sleep(DELAY_MS);
    }
  }

  console.log(`\nCrawling with ${CONCURRENCY} workers...\n`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const all = [...stores.values()].sort((a, b) =>
    a.store_number.localeCompare(b.store_number)
  );
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 1));
  if (fs.existsSync(CHECKPOINT)) fs.unlinkSync(CHECKPOINT);

  report(all, done);
}

function report(all, queries) {
  const byState = {};
  let noAddr = 0;
  for (const s of all) {
    byState[s.state ?? "??"] = (byState[s.state ?? "??"] ?? 0) + 1;
    if (!s.address || !s.city || !s.state || !s.zip) noAddr++;
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`  queries made      : ${queries}`);
  console.log(`  stores found      : ${all.length}`);
  console.log(`  vs. reported 2,944: ${(all.length / 2944 * 100).toFixed(1)}%`);
  console.log(`  incomplete address: ${noAddr}`);
  console.log(`  states            : ${Object.keys(byState).length}`);
  console.log(`${"=".repeat(52)}`);
  Object.entries(byState)
    .sort((a, b) => b[1] - a[1])
    .forEach(([st, n]) => console.log(`    ${st}  ${n}`));

  if (fs.existsSync(SEEDS_FILE)) {
    const known = JSON.parse(fs.readFileSync(SEEDS_FILE, "utf8"));
    const nums = new Set(all.map((s) => s.store_number));
    const missed = known.filter(
      (k) => k.store_number && !nums.has(k.store_number)
    );
    console.log(
      `\n  sanity check: ${missed.length} of the known store numbers were ` +
      `NOT returned by the API.`
    );
    if (missed.length > 5) {
      console.log("  ^ that's high — likely a coverage gap, inspect before use.");
    }
  }
  console.log(`\nWrote ${path.basename(OUT_FILE)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
