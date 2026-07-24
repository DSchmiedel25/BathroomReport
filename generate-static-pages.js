#!/usr/bin/env node
/*
 * BathroomReport — static SEO page generator  (v2)
 * ------------------------------------------------------------
 * Reads your *-locations.js files directly (the same globals the
 * PWA loads), and emits crawlable HTML pages, sitemap.xml and
 * robots.txt. Runs in a GitHub Action so you never touch a terminal.
 *
 * SAFETY: everything it generates lives under /guide/ (plus root
 * sitemap.xml + robots.txt). It never writes your index.html or
 * styles.css, so your live app is untouched.
 *
 * Pure Node, no dependencies:  node generate-static-pages.js
 * ------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* ============================================================
 * 1. CONFIG
 * ==========================================================*/
const CONFIG = {
  baseUrl: process.env.BASE_URL || "https://bathroomreport.app",
  appUrl: "https://bathroomreport.app",
  // Folder holding your *-locations.js files (repo root by default):
  locationsDir: process.env.LOCATIONS_DIR || ".",
  // Where output is written. In the Action this is the repo root (".").
  outDir: process.env.OUT_DIR || "./dist",
  // All generated SEO pages live under this path so nothing collides
  // with your live app at the repo root:
  sectionPath: "guide",
  // GA4 measurement ID — same property as the app, so guide→app is one funnel.
  // Set to "" to omit analytics from generated pages entirely.
  gaMeasurementId: process.env.GA_MEASUREMENT_ID || "G-P30WFPVB80",
  // Deep link into the live map, tagged so GA4 attributes the session to the
  // guide page it came from. The app reads ?loc= and zooms to that pin.
  appDeepLink: (loc) =>
    `${CONFIG.appUrl}/?loc=${encodeURIComponent(loc.id)}` +
    `&utm_source=guide&utm_medium=organic&utm_campaign=location_page` +
    `&utm_content=${encodeURIComponent(chainSlug(loc.chain))}`,
  siteName: "BathroomReport",
  siteTagline: "Find and rate clean bathrooms at the stops on your route.",
  // Pretty display names where the filename can't produce them:
  chainNameOverrides: {
    quiktrip: "QuikTrip", "pilot-flying-j": "Pilot Flying J", quikchek: "QuickChek",
    alltownfresh: "AllTownFresh", "cumberland-farms": "Cumberland Farms",
    pilot: "Pilot Flying J", loves: "Love's", maverik: "Maverik",
    speedway: "Speedway", bucees: "Buc-ee's", caseys: "Casey's",
    "byrne-dairy": "Byrne Dairy", fastrac: "Fastrac",
  },
};

/* ============================================================
 * 2. READ *-locations.js  (auto-detect, no pasting needed)
 * Each file is executed in a sandbox; any global array that looks
 * like locations is harvested. const/let/var and window.* all work.
 * ==========================================================*/
function chainFromFilename(file) {
  const stem = path.basename(file).replace(/-locations\.js$/i, "");
  if (CONFIG.chainNameOverrides[stem]) return CONFIG.chainNameOverrides[stem];
  return stem.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function looksLikeLocations(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  const keys = ["lat", "latitude", "lng", "lon", "longitude", "coords", "geo", "address", "street", "city"];
  const sample = arr.slice(0, Math.min(5, arr.length));
  const hits = sample.filter((el) => el && typeof el === "object" && keys.some((k) => k in el)).length;
  return hits >= Math.ceil(sample.length / 2);
}
function harvest(code) {
  // Rewrite top-level (column-0) declarations onto the sandbox global.
  const transformed = code.replace(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm, "globalThis.$1 =");
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop, construct: () => ({}) });
  const sandbox = {};
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  sandbox.document = noop; sandbox.L = noop; sandbox.firebase = noop; sandbox.firestore = noop;
  sandbox.console = { log() {}, warn() {}, error() {} };
  const reserved = new Set(["window", "self", "globalThis", "document", "L", "firebase", "firestore", "console"]);
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { timeout: 5000 });
  const out = [];
  for (const k of Object.keys(sandbox)) {
    if (reserved.has(k)) continue;
    if (looksLikeLocations(sandbox[k])) out.push(...sandbox[k]);
  }
  return out;
}
function readAllLocationFiles() {
  const files = fs.readdirSync(CONFIG.locationsDir)
    .filter((f) => /-locations\.js$/i.test(f)).sort();
  const all = [];
  for (const f of files) {
    const full = path.join(CONFIG.locationsDir, f);
    const fileChain = chainFromFilename(f);
    let recs = [];
    try {
      recs = harvest(fs.readFileSync(full, "utf8"));
    } catch (e) {
      console.warn(`  ! skipped ${f}: ${e.message}`);
      continue;
    }
    recs.forEach((r) => (r.__fileChain = fileChain));
    all.push(...recs);
    console.log(`  ${f}: ${recs.length} records  (chain: ${fileChain})`);
  }
  return all;
}

/* ============================================================
 * 3. NORMALIZE  (defensive — nested or flat both work)
 * ==========================================================*/
function normalize(raw) {
  const meta = raw.meta || {};                    // your real records nest here
  const addr = raw.address || {};                 // keep older nested shape working too
  const geo = raw.geo || raw.coordinates || {};
  const hrs = raw.hours_full || meta.hours_full || (String(raw.hrs) === "24" ? "24/7" : "");
  // Some records store the whole address in one string ("123 Main St, Ada, OK 74820")
  // and leave city/state empty. Split it so those pages get real titles and headings.
  const rawStreet = raw.addr || raw.street || addr.street || addr.line1 || "";
  const parsed = parseCombinedAddress(rawStreet);
  return {
    id: String(raw.id ?? raw.placeId ?? raw._id ?? meta.osm_id ?? ""),
    // The source FILE decides the chain. Per-record chain fields are inconsistent
    // across imports (some records carry none), which used to split one chain
    // across two folders — e.g. /guide/pilot/ and /guide/pilot-flying-j/.
    chain: raw.__fileChain || raw.chain || meta.chain || raw.brand || "Unknown",
    street: parsed.street || rawStreet,
    city: raw.city || meta.city || addr.city || parsed.city || "",
    state: raw.state || meta.state || addr.state || addr.region || parsed.state || "",
    zip: raw.zip || meta.zip || raw.postalCode || addr.zip || addr.postalCode || parsed.zip || "",
    lat: num(raw.lat ?? raw.latitude ?? geo.lat ?? geo.latitude),
    lng: num(raw.lng ?? raw.lon ?? raw.longitude ?? geo.lng ?? geo.longitude),
    rating: num(raw.rating ?? raw.avgRating ?? raw.score),
    ratingCount: int(raw.ratingCount ?? raw.reviewCount ?? raw.votes ?? 0),
    amenities: coerceAmenities(raw.amenities ?? meta.amenities),
    hours: hrs,
    outOfOrder: Boolean(raw.outOfOrder),
    updated: raw.lastUpdated || raw.updated || meta.updated || null,
  };
}
// A record earns an indexable page only if it has real location context.
// Coords-only records (addr_complete:false) would make thin, near-duplicate
// pages that hurt the whole section's ranking, so we hold them back.
function hasLocationContext(l) {
  // A bare brand name in the address field ("Pilot Travel Center") is not an
  // address — publishing those makes thin, near-duplicate pages. Require either
  // a real street (starts with a house number) or a city+state pair.
  const realStreet = /^\s*\d/.test(String(l.street || ""));
  return Boolean(realStreet || (l.city && l.state));
}
// "5725 Highway 58, Boron, CA 93516" -> {street, city, state, zip}
// Returns empty fields when the string isn't in that shape, so callers can fall back.
function parseCombinedAddress(s) {
  const str = String(s || "").trim();
  if (!str || !str.includes(",")) return { street: "", city: "", state: "", zip: "" };
  const m = str.match(/^(.*?),\s*([^,]+?),\s*([A-Z]{2})(?:\s+(\d{5})(?:-\d{4})?)?\s*$/);
  if (!m) return { street: "", city: "", state: "", zip: "" };
  return { street: m[1].trim(), city: m[2].trim(), state: m[3], zip: m[4] || "" };
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const int = (v) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 0);
function coerceAmenities(a) {
  if (!a) return [];
  if (Array.isArray(a)) return a.map(humanize);
  return Object.entries(a)
    .filter(([, v]) => v === true || v === "yes" || v === "confirmed" || (v && v.confirmed))
    .map(([k]) => humanize(k));
}
const humanize = (k) => String(k).replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
  .replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/* ============================================================
 * 4. HELPERS
 * ==========================================================*/
const slugify = (...p) => p.filter(Boolean).join(" ").toLowerCase().normalize("NFKD")
  .replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const chainSlug = (c) => slugify(c);
const locSlug = (l) => slugify(l.street || l.city, l.city, l.id.slice(-4));
const fullAddress = (l) => [l.street, l.city, [l.state, l.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
const ratingLabel = (r) => (r == null ? "Not yet rated" : r >= 4 ? "Clean" : r >= 3 ? "Okay" : "Rough");
const groupBy = (arr, fn) => arr.reduce((m, x) => ((m[fn(x)] ??= []).push(x), m), {});
const S = () => `${CONFIG.baseUrl}/${CONFIG.sectionPath}`;
const locUrl = (l) => `${S()}/${chainSlug(l.chain)}/${locSlug(l)}/`;
const chainUrl = (c) => `${S()}/${chainSlug(c)}/`;
const homeUrl = () => `${S()}/`;

/* ============================================================
 * 5. STRUCTURED DATA
 * ==========================================================*/
function jsonLd(loc, url) {
  const d = { "@context": "https://schema.org", "@type": "ConvenienceStore",
    name: `${loc.chain}${loc.city ? " — " + loc.city : ""}`, url,
    address: { "@type": "PostalAddress", streetAddress: loc.street || undefined,
      addressLocality: loc.city || undefined, addressRegion: loc.state || undefined,
      postalCode: loc.zip || undefined, addressCountry: "US" } };
  if (loc.lat != null && loc.lng != null)
    d.geo = { "@type": "GeoCoordinates", latitude: loc.lat, longitude: loc.lng };
  if (loc.rating != null && loc.ratingCount > 0)
    d.aggregateRating = { "@type": "AggregateRating", ratingValue: loc.rating.toFixed(1),
      reviewCount: loc.ratingCount, bestRating: 5, worstRating: 1 };
  if (loc.amenities.length)
    d.amenityFeature = loc.amenities.map((a) => ({ "@type": "LocationFeatureSpecification", name: a, value: true }));
  if (loc.hours === "24/7") d.openingHours = "Mo-Su 00:00-23:59";
  return JSON.stringify(d);
}

/* ============================================================
 * 6. STYLES  (rest-area guide-sign look; system fonts for speed)
 * ==========================================================*/
const STYLES = `
:root{--sign:#0B4F9E;--sign-dark:#073B78;--ink:#14181F;--muted:#5A6472;--paper:#FBFAF7;
--card:#FFFFFF;--line:#E7E4DC;--low:#B23A2E;--radius:14px;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:var(--sign);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:720px;margin:0 auto;padding:20px 20px 64px}
.topbar{background:var(--sign);color:#fff}
.topbar .wrap{padding:14px 20px}
.topbar a{color:#fff;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:.82rem}
.eyebrow{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:22px 0 6px;font-weight:700}
h1{font-size:1.7rem;line-height:1.15;margin:0 0 4px;letter-spacing:-.01em}
.addr{color:var(--muted);margin:0 0 20px}
.plaque{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;background:var(--sign);
color:#fff;border-radius:12px;padding:12px 20px;min-width:104px;border:3px solid #fff;box-shadow:0 0 0 2px var(--sign)}
.plaque .num{font-size:2.3rem;font-weight:800;line-height:1}
.plaque .of{font-size:.7rem;opacity:.85;letter-spacing:.1em;text-transform:uppercase;margin-top:2px}
.plaque .word{font-size:.78rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-top:6px;
padding-top:6px;border-top:1px solid rgba(255,255,255,.35);width:100%;text-align:center}
.head{display:flex;gap:20px;align-items:center;flex-wrap:wrap}
.head .meta{flex:1;min-width:200px}
.votes{color:var(--muted);font-size:.9rem;margin-top:6px}
.ooo{display:inline-block;background:#FCEBE9;color:var(--low);border:1px solid #F1C4bf;border-radius:8px;
padding:6px 12px;font-weight:700;font-size:.85rem;margin:14px 0}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0;padding:0;list-style:none}
.chips li{background:#EEF3FA;border:1px solid #D8E4F2;color:var(--sign-dark);border-radius:999px;
padding:5px 13px;font-size:.86rem;font-weight:600}
.cta{display:inline-block;background:var(--sign);color:#fff;font-weight:700;padding:13px 22px;border-radius:12px;margin:26px 0 8px}
.cta:hover{background:var(--sign-dark);text-decoration:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:22px;margin-top:22px}
.foot{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0;padding:0;list-style:none}
.grid a{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;color:var(--ink);font-weight:600}
.grid a:hover{border-color:var(--sign);text-decoration:none}
.grid small{display:block;color:var(--muted);font-weight:400}
.cityhdr{margin:26px 0 8px;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700}
@media (max-width:560px){.grid{grid-template-columns:1fr}h1{font-size:1.45rem}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
`;

/* ============================================================
 * 7. TEMPLATES
 * ==========================================================*/
// GA4 for the static guide pages. Same measurement ID as the app, so a visitor
// who lands on a guide page and taps through to the map is one session, not two.
// The click handler fires `guide_cta_click` before navigation so you can see which
// chains and pages actually drive people into the app.
function analyticsSnippet() {
  const id = CONFIG.gaMeasurementId;
  if (!id) return "";
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(id)}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${esc(id)}');
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a.cta');
    if(!a) return;
    gtag('event', 'guide_cta_click', {
      chain: document.body.dataset.chain || '',
      loc_id: document.body.dataset.locid || '',
      page_type: document.body.dataset.pagetype || ''
    });
  });
</script>`;
}

function shell({ title, desc, canonical, body, jsonLdStr, chain, locId, pageType }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(CONFIG.siteName)}">
<meta property="og:image" content="${esc(CONFIG.baseUrl)}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${esc(S())}/styles.css">
${jsonLdStr ? `<script type="application/ld+json">${jsonLdStr}</script>` : ""}
${analyticsSnippet()}
</head>
<body data-chain="${esc(chain || "")}" data-locid="${esc(locId || "")}" data-pagetype="${esc(pageType || "")}">
<header class="topbar"><div class="wrap"><a href="${esc(homeUrl())}">▸ ${esc(CONFIG.siteName)}</a></div></header>
<main class="wrap">
${body}
</main>
</body>
</html>`;
}

function locationPage(loc) {
  const url = locUrl(loc);
  const addr = fullAddress(loc);
  const title = `${loc.chain} Bathroom${loc.city ? " — " + loc.city + (loc.state ? ", " + loc.state : "") : ""} | Rating & Amenities`;
  const desc = loc.rating != null && loc.ratingCount > 0
    ? `${loc.chain}${addr ? " at " + addr : ""}: bathroom rated ${loc.rating.toFixed(1)}/5 from ${loc.ratingCount} ${loc.ratingCount === 1 ? "report" : "reports"}. ${loc.amenities.slice(0, 3).join(", ") || "See amenities and status."}`
    : `${loc.chain}${addr ? " at " + addr : ""}: bathroom info, amenities and current status. Add the first rating on ${CONFIG.siteName}.`;
  const plaque = loc.rating != null
    ? `<div class="plaque"><span class="num">${loc.rating.toFixed(1)}</span><span class="of">out of 5</span><span class="word">${ratingLabel(loc.rating)}</span></div>`
    : `<div class="plaque"><span class="num">–</span><span class="of">no ratings</span><span class="word">Be first</span></div>`;
  const body = `
<p class="eyebrow">${esc(loc.chain)} · Bathroom report</p>
<div class="head">
  ${plaque}
  <div class="meta">
    <h1>${esc(loc.chain)} Bathroom${loc.city ? " in " + esc(loc.city) : ""}</h1>
    <p class="addr">${esc(addr || "Address on file")}</p>
    ${loc.hours ? `<div class="votes">Open ${esc(loc.hours === "24/7" ? "24 hours" : loc.hours)}</div>` : ""}
    ${loc.ratingCount > 0 ? `<div class="votes">Based on ${loc.ratingCount} community ${loc.ratingCount === 1 ? "report" : "reports"}.</div>` : ""}
  </div>
</div>
${loc.outOfOrder ? `<div class="ooo">⚠ Recently reported out of order</div>` : ""}
${loc.amenities.length ? `<div class="card"><p class="eyebrow" style="margin-top:0">Amenities reported here</p>
  <ul class="chips">${loc.amenities.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
<a class="cta" href="${esc(CONFIG.appDeepLink(loc))}">Open in ${esc(CONFIG.siteName)} →</a>
<p style="color:var(--muted);font-size:.9rem;margin-top:4px">See it on the live map, add a rating, or report the current status.</p>
<div class="foot">${loc.updated ? `Last updated ${esc(String(loc.updated))}. ` : ""}Data is community-contributed and may change. ·
  <a href="${esc(chainUrl(loc.chain))}">More ${esc(loc.chain)} locations</a></div>`;
  return { url, html: shell({ title, desc, canonical: url, body, jsonLdStr: jsonLd(loc, url), chain: loc.chain, locId: loc.id, pageType: "location" }) };
}

function chainPage(chain, locs) {
  const url = chainUrl(chain);
  const title = `${chain} Bathroom Ratings by Location | ${CONFIG.siteName}`;
  const desc = `Community bathroom ratings and amenities for ${locs.length} ${chain} locations. Find clean, accessible restrooms before you stop.`;
  const byState = groupBy(locs, (l) => l.state || "Other");
  let sections = "";
  for (const st of Object.keys(byState).sort()) {
    const byCity = groupBy(byState[st], (l) => l.city || "Other");
    sections += Object.keys(byCity).sort().map((city) => {
      const links = byCity[city].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1)).map((l) => {
        const r = l.rating != null ? `${l.rating.toFixed(1)}★` : "unrated";
        return `<li><a href="${esc(locUrl(l))}">${esc(l.street || l.chain)}<small>${esc(city)}${l.state ? ", " + esc(l.state) : ""} · ${r}</small></a></li>`;
      }).join("");
      return `<h2 class="cityhdr">${esc(city)}${st !== "Other" ? ", " + esc(st) : ""}</h2><ul class="grid">${links}</ul>`;
    }).join("");
  }
  const body = `<p class="eyebrow">Chain overview</p><h1>${esc(chain)} Bathroom Ratings</h1>
<p class="addr">${locs.length} locations mapped · sorted by rating within each city.</p>
${sections}<div class="foot"><a href="${esc(homeUrl())}">← All chains</a></div>`;
  return { url, html: shell({ title, desc, canonical: url, body, chain, pageType: "chain" }) };
}

function homePage(counts) {
  const url = homeUrl();
  const title = `${CONFIG.siteName} — ${CONFIG.siteTagline}`;
  const desc = CONFIG.siteTagline + " Community ratings, amenities and out-of-order alerts across major chains.";
  const links = Object.keys(counts).sort().map((c) =>
    `<li><a href="${esc(chainUrl(c))}">${esc(c)}<small>${counts[c]} locations</small></a></li>`).join("");
  const body = `<p class="eyebrow">${esc(CONFIG.siteName)}</p><h1>${esc(CONFIG.siteTagline)}</h1>
<p class="addr">Browse by chain, or open the live map to find the nearest clean stop.</p>
<a class="cta" href="${esc(CONFIG.appUrl)}/">Open the live map →</a>
<h2 class="cityhdr">Chains</h2><ul class="grid">${links}</ul>`;
  return { url, html: shell({ title, desc, canonical: url, body, pageType: "home" }) };
}

/* ============================================================
 * 8. BUILD  (never removes anything outside /guide/)
 * ==========================================================*/
function writeFile(rel, contents) {
  const full = path.join(CONFIG.outDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}
const relFromUrl = (url) => url.replace(CONFIG.baseUrl + "/", "").replace(/\/$/, "");

function main() {
  console.log("Reading *-locations.js files...");
  const geoOk = readAllLocationFiles().map(normalize)
    .filter((l) => l.id && l.lat != null && l.lng != null);

  // Hold back coords-only records so we don't publish thin pages.
  const locations = geoOk.filter(hasLocationContext);
  const held = geoOk.filter((l) => !hasLocationContext(l));
  console.log(`\nUsable (has address/city): ${locations.length}`);
  if (held.length) {
    const byChainHeld = groupBy(held, (l) => l.chain);
    console.log(`Held back (coords only, no address): ${held.length}`);
    for (const c of Object.keys(byChainHeld).sort())
      console.log(`   ${c}: ${byChainHeld[c].length} need addresses before they get pages`);
  }
  if (!locations.length) { console.error("\nNo indexable locations — all records lack an address. Enrich them first."); process.exit(1); }

  // Clean ONLY our own section; never touch the rest of the repo.
  fs.rmSync(path.join(CONFIG.outDir, CONFIG.sectionPath), { recursive: true, force: true });

  const urls = [];
  for (const loc of locations) {
    const { url, html } = locationPage(loc);
    writeFile(path.join(relFromUrl(url), "index.html"), html);
    urls.push(url);
  }
  const byChain = groupBy(locations, (l) => l.chain);
  for (const chain of Object.keys(byChain)) {
    const { url, html } = chainPage(chain, byChain[chain]);
    writeFile(path.join(relFromUrl(url), "index.html"), html);
    urls.push(url);
  }
  const counts = Object.fromEntries(Object.entries(byChain).map(([c, l]) => [c, l.length]));
  const home = homePage(counts);
  writeFile(path.join(relFromUrl(home.url), "index.html"), home.html);
  urls.push(home.url);
  writeFile(path.join(CONFIG.sectionPath, "styles.css"), STYLES);

  // The guide's own sitemap lives in its own file. We deliberately do NOT write
  // the root sitemap.xml — the app already ships one (the homepage entry), and
  // overwriting it would drop that. Instead we publish a sitemap INDEX that points
  // at both, which is the supported way to combine them.
  writeFile(`${CONFIG.sectionPath}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}
</urlset>`);

  const today = new Date().toISOString().slice(0, 10);
  writeFile("sitemap-index.xml", `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${esc(CONFIG.baseUrl)}/sitemap.xml</loc></sitemap>
  <sitemap><loc>${esc(S())}/sitemap.xml</loc><lastmod>${today}</lastmod></sitemap>
</sitemapindex>`);

  writeFile("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${CONFIG.baseUrl}/sitemap-index.xml\n`);

  console.log(`Wrote ${urls.length} pages under /${CONFIG.sectionPath}/`);
  console.log(`  + /${CONFIG.sectionPath}/sitemap.xml (guide URLs)`);
  console.log(`  + /sitemap-index.xml (points at your existing sitemap.xml AND the guide one)`);
  console.log(`  + /robots.txt`);
  console.log(`  Your existing sitemap.xml was NOT modified.`);
}
main();
