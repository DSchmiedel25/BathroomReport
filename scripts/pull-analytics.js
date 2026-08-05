#!/usr/bin/env node
/*
 * BathroomReport — nightly analytics pull
 * ------------------------------------------------------------
 * Reads GA4 and Microsoft Clarity, merges the results into
 * analytics-data.json, and leaves it for the workflow to commit.
 * analytics.html reads that file. No credential ever reaches a browser.
 *
 * Pure Node, no dependencies — same as generate-static-pages.js. The service
 * account JWT is signed with the built-in crypto module rather than pulling in
 * googleapis, which is ~50 MB of transitive dependencies for two HTTP calls.
 *
 * Env:
 *   GA4_PROPERTY_ID    numeric property id (NOT the G- measurement id)
 *   GA4_SA_KEY         the service account JSON key, whole file, as a string
 *   CLARITY_TOKEN      Clarity Settings -> Data Export -> API token
 *
 * WHY THE FILE ACCUMULATES: Clarity's API only serves the previous 1-3 days and
 * there is no way to ask for anything older. Whatever is not captured within
 * three days is gone permanently. So this MERGES into the existing file and
 * never rewrites history. GA4 has no such limit and is re-fetched each run.
 * ------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const OUT = path.join(process.cwd(), "analytics-data.json");
const GA4_LOOKBACK_DAYS = 90;   // GA4 backfills freely; re-pull a wide window each run.

/* ============================================================
 * HTTP (promisified, tiny)
 * ==========================================================*/
function request(url, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("request timed out")));
    if (body) req.write(body);
    req.end();
  });
}

/* ============================================================
 * GOOGLE AUTH — service account JWT -> access token
 * ==========================================================*/
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function googleAccessToken(keyJson) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: keyJson.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = b64url(signer.sign(keyJson.private_key));
  const assertion = `${header}.${claim}.${sig}`;

  const res = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (res.status !== 200) throw new Error(`token exchange failed (${res.status}): ${res.body.slice(0, 300)}`);
  return JSON.parse(res.body).access_token;
}

/* ============================================================
 * GA4 DATA API
 * ==========================================================*/
async function runReport(token, propertyId, spec) {
  const res = await request(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    }
  );
  if (res.status !== 200) throw new Error(`runReport ${res.status}: ${res.body.slice(0, 400)}`);
  return JSON.parse(res.body);
}

// GA4 returns every value as a string; rows are positional against the requested headers.
const rows = (r) => (r.rows || []).map((row) => ({
  dims: (row.dimensionValues || []).map((d) => d.value),
  mets: (row.metricValues || []).map((m) => Number(m.value) || 0),
}));
const dateRange = (days) => [{ startDate: `${days}daysAgo`, endDate: "today" }];

/* Each of these is one API request. Standard properties get 200,000 tokens a day and most
 * requests cost under 10, so a nightly run of seven is roughly 0.03% of the quota. */
async function pullGA4(token, propertyId) {
  const out = {};

  // 1. Daily headline numbers. activeUsers is the unique-people number; newUsers is
  //    first-ever visits, which is NOT the same as accounts created (see sign_up below).
  const daily = await runReport(token, propertyId, {
    dateRanges: dateRange(GA4_LOOKBACK_DAYS),
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "activeUsers" }, { name: "newUsers" },
      { name: "sessions" }, { name: "screenPageViews" },
    ],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 400,
  });
  out.daily = {};
  for (const r of rows(daily)) {
    out.daily[isoDate(r.dims[0])] = {
      activeUsers: r.mets[0], newUsers: r.mets[1],
      sessions: r.mets[2], pageViews: r.mets[3],
    };
  }

  // 2. Accounts created per day. Counts the sign_up event app.js fires after the Firebase
  //    account actually exists — so abandoned and failed signups are not in here.
  const signups = await runReport(token, propertyId, {
    dateRanges: dateRange(GA4_LOOKBACK_DAYS),
    dimensions: [{ name: "date" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "sign_up" } } },
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 400,
  });
  out.signupsByDate = {};
  for (const r of rows(signups)) out.signupsByDate[isoDate(r.dims[0])] = r.mets[0];

  // 3. Where traffic came from. Source/medium rather than GA4's Default Channel Group on
  //    purpose: print media like the cards and the shirt land in "Unassigned" under the
  //    channel grouping, which hides exactly the thing we want to see.
  const sources = await runReport(token, propertyId, {
    dateRanges: dateRange(GA4_LOOKBACK_DAYS),
    dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 50,
  });
  out.sources = rows(sources).map((r) => ({
    source: r.dims[0], medium: r.dims[1], sessions: r.mets[0], users: r.mets[1],
  }));

  // 4. Campaign + content. utm_content is per card design, so this is which artwork
  //    actually gets scanned off a table.
  const campaigns = await runReport(token, propertyId, {
    dateRanges: dateRange(GA4_LOOKBACK_DAYS),
    dimensions: [{ name: "sessionCampaignName" }, { name: "sessionManualAdContent" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 50,
  });
  out.campaigns = rows(campaigns)
    .filter((r) => r.dims[0] && r.dims[0] !== "(not set)")
    .map((r) => ({ campaign: r.dims[0], content: r.dims[1] || "", sessions: r.mets[0] }));

  // 5. Events we deliberately fire: sign_up, login, share, shop_click, guide_cta_click,
  //    deeplink_open.
  const events = await runReport(token, propertyId, {
    dateRanges: dateRange(GA4_LOOKBACK_DAYS),
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 60,
  });
  const KEEP = new Set(["sign_up", "login", "share", "shop_click", "guide_cta_click", "deeplink_open"]);
  out.events = {};
  for (const r of rows(events)) if (KEEP.has(r.dims[0])) out.events[r.dims[0]] = r.mets[0];

  // 6. Guide landing pages — which SEO pages Google actually sends people to.
  const landing = await runReport(token, propertyId, {
    dateRanges: dateRange(GA4_LOOKBACK_DAYS),
    dimensions: [{ name: "landingPage" }],
    metrics: [{ name: "sessions" }],
    dimensionFilter: {
      filter: { fieldName: "landingPage", stringFilter: { matchType: "CONTAINS", value: "/guide/" } },
    },
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 25,
  });
  out.guidePages = rows(landing).map((r) => ({ page: r.dims[0], sessions: r.mets[0] }));

  /* 7. Stale /guide/ URLs. `resolved` is a custom event parameter, and GA4 will reject the
   *    query outright until it is registered under Admin -> Custom definitions. That is a
   *    setup step, not a failure, so this one is allowed to come back empty without taking
   *    the whole run down with it. */
  try {
    const stale = await runReport(token, propertyId, {
      dateRanges: dateRange(GA4_LOOKBACK_DAYS),
      dimensions: [{ name: "customEvent:resolved" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "deeplink_open" } } },
      limit: 10,
    });
    out.deeplinkResolved = {};
    for (const r of rows(stale)) out.deeplinkResolved[r.dims[0]] = r.mets[0];
  } catch (e) {
    console.warn("  ! deeplink resolved breakdown unavailable — register `resolved` under Admin → Custom definitions");
    out.deeplinkResolved = null;
  }

  return out;
}

// GA4 hands back dates as "20260803".
const isoDate = (yyyymmdd) =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/* ============================================================
 * CLARITY
 * ==========================================================*/
/* One request per run, out of the 10 per project per day the API allows. numOfDays=1 gets
 * yesterday. The other nine are left deliberately unused so there is headroom to debug by hand
 * without knocking out that night's collection. */
async function pullClarity(token) {
  const res = await request(
    "https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1",
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );
  if (res.status === 429) throw new Error("Clarity rate limit hit (10/project/day) — skipping tonight");
  if (res.status !== 200) throw new Error(`Clarity ${res.status}: ${res.body.slice(0, 300)}`);

  const payload = JSON.parse(res.body);
  // Response is an array of { metricName, information: [ {...} ] }. With no dimension
  // requested each metric has a single totals row.
  const flat = {};
  for (const m of Array.isArray(payload) ? payload : []) {
    const info = (m.information && m.information[0]) || {};
    for (const [k, v] of Object.entries(info)) {
      const n = Number(v);
      flat[`${m.metricName}.${k}`] = Number.isFinite(n) ? n : v;
    }
  }
  return flat;
}

/* ============================================================
 * MAIN
 * ==========================================================*/
function loadExisting() {
  try { return JSON.parse(fs.readFileSync(OUT, "utf8")); }
  catch (e) { return { ga4: {}, clarity: { daily: {} } }; }
}

function yesterdayIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const prev = loadExisting();
  const next = {
    generated: new Date().toISOString(),
    ga4: prev.ga4 || {},
    clarity: prev.clarity && prev.clarity.daily ? prev.clarity : { daily: {} },
    errors: [],
  };

  // ---- GA4 -------------------------------------------------
  const propertyId = process.env.GA4_PROPERTY_ID;
  const rawKey = process.env.GA4_SA_KEY;
  if (propertyId && rawKey) {
    try {
      const token = await googleAccessToken(JSON.parse(rawKey));
      next.ga4 = await pullGA4(token, propertyId);
      const days = Object.keys(next.ga4.daily || {}).length;
      console.log(`GA4: ok — ${days} days, ${next.ga4.sources.length} sources, ${next.ga4.campaigns.length} campaigns`);
    } catch (e) {
      // Keep last night's GA4 data rather than blanking the dashboard over one bad night.
      console.error("GA4 failed:", e.message);
      next.errors.push(`ga4: ${e.message}`);
    }
  } else {
    console.warn("GA4 skipped — GA4_PROPERTY_ID / GA4_SA_KEY not set");
    next.errors.push("ga4: credentials not configured");
  }

  // ---- Clarity ---------------------------------------------
  if (process.env.CLARITY_TOKEN) {
    const day = yesterdayIso();
    try {
      const snap = await pullClarity(process.env.CLARITY_TOKEN);
      /* Never overwrite a day already captured. A re-run would otherwise replace a good
       * snapshot with whatever the API feels like returning, and there is no way to get the
       * original back. */
      if (next.clarity.daily[day]) {
        console.log(`Clarity: ${day} already captured — left alone`);
      } else {
        next.clarity.daily[day] = snap;
        console.log(`Clarity: ok — captured ${day}`);
      }
    } catch (e) {
      console.error("Clarity failed:", e.message);
      next.errors.push(`clarity: ${e.message}`);
    }
  } else {
    console.warn("Clarity skipped — CLARITY_TOKEN not set");
    next.errors.push("clarity: token not configured");
  }

  // Trim Clarity history to two years so the committed file cannot grow without bound.
  const keys = Object.keys(next.clarity.daily).sort();
  if (keys.length > 730) {
    for (const k of keys.slice(0, keys.length - 730)) delete next.clarity.daily[k];
  }

  fs.writeFileSync(OUT, JSON.stringify(next, null, 2) + "\n");
  console.log(`Wrote ${OUT} (${Object.keys(next.clarity.daily).length} Clarity days retained)`);

  /* Exit 0 even on partial failure. A non-zero exit would fail the workflow and skip the
   * commit, which would throw away whatever DID come back — and for Clarity that day is then
   * unrecoverable. The errors array carries the problem through to the dashboard instead. */
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
