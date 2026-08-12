// ---- Perf instrumentation (Pass A) ----------------------------------------
// Only active with ?debug=1 in the URL — zero cost for normal users. Logs timing
// marks to the console so real devices can report where startup time goes.
const PERF_DEBUG = (() => { try{ return new URLSearchParams(location.search).has('debug'); }catch(e){ return false; } })();

/* One place every GA4 event goes through.
 *
 * gtag is loaded from index.html, but it is the first thing an ad blocker removes and it is
 * absent entirely on any page that forgot the snippet. Every call site would otherwise need its
 * own `typeof gtag === 'function'` guard — the deeplink_open block had one, which is why it
 * failed silently for months rather than throwing something anybody would have noticed. This
 * wrapper carries the guard once, and mirrors the same event into Clarity so a session recording
 * can be filtered by what the person actually did, not just where they went.
 *
 * Fire-and-forget by design: analytics must never be able to break a signup or a share. */
function track(name, params){
  const p = params || {};
  try{ if(typeof gtag === 'function') gtag('event', name, p); }catch(e){}
  try{
    if(typeof window.clarity === 'function'){
      window.clarity('event', name);
      // Clarity tags are strings and are what its recording filters search on.
      Object.keys(p).forEach(k => {
        const v = p[k];
        if(v !== undefined && v !== null && v !== '') window.clarity('set', k, String(v));
      });
    }
  }catch(e){}
}

/* Outbound clicks to the Fourthwall shop. GA4 cannot follow anyone across to another domain,
 * so a shirt sale is never attributable here — but "how many people left for the shop, and from
 * which entry point" is, and that is the number that says whether the merch links are worth the
 * space they take up. Delegated so it covers the settings sheet, the support page, and anything
 * added later without another listener. */
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href*="fourthwall.com"]');
  if(!a) return;
  let campaign = '';
  try{ campaign = new URL(a.href).searchParams.get('utm_campaign') || ''; }catch(err){}
  track('shop_click', { link_url: a.href, placement: campaign || 'unknown' });
}, true);

function perfMark(label){
  if(!PERF_DEBUG) return;
  try{ console.log('[perf] ' + label + ' @ ' + Math.round(performance.now()) + 'ms'); }catch(e){}
}
perfMark('app.js execute start');

// Location data is loaded from one file per chain (e.g. stewarts-locations.js),
// each of which sets a single global array — window.stewartsLocations, etc.
// Nothing in those files needs to say which chain it belongs to; the file
// itself is the chain. This registry is what ties a chain's data file to its
// display name and brand color, and merges everything into one seedLocations
// list the rest of the app already knows how to use.
//
// TO ADD A NEW CHAIN:
//   1. Create <chain>-locations.js with `window.<chain>Locations = [...]`
//      (same shape as stewarts-locations.js — n/lat/lng/addr/id/hrs).
//   2. Add a <script src="<chain>-locations.js"></script> tag in index.html's
//      <head>, alongside the other chain data files, before app.js loads.
//   3. Add one entry below with the chain's real brand color.
/* Colours are the real brand colour wherever it works. Four are shifted because they collided
 * with a chain that operates in the same places (measured in CIE Lab, co-visibility computed
 * from the actual location data, not guessed):
 *   sheetz   brand red was 10.8 from Circle K's, both PA/OH/VA — Circle K is co-visible with
 *            38 chains and had nowhere to move, so Sheetz took the shift
 *   speedway was 8.2 from Sheetz red, same states
 *   parkers  brand blue was 7.1 from interstate rest-area blue; the brand also uses orange
 *   *Public  civic restrooms are grey — not a brand, shouldn't look like one
 * Colour is never the only cue: every row and popup carries the name. */
const CHAIN_REGISTRY = {
  stewarts: { name: "Stewart's Shops", color: '#581E1C', textColor: '#ffffff', dataVar: 'stewartsLocations' },
  cumberlandFarms: { name: "Cumberland Farms", color: '#8DBB39', textColor: '#ffffff', dataVar: 'cumberlandFarmsLocations' },
  wawa: { name: "Wawa", color: '#BD2C34', textColor: '#ffffff', dataVar: 'wawaLocations' },
  fastrac: { name: "Fastrac", color: '#D72E20', textColor: '#ffffff', dataVar: 'fastracLocations' },
  alltownFresh: { name: "Alltown Fresh", color: '#215056', textColor: '#ffffff', dataVar: 'alltownFreshLocations' },
  byrneDairy: { name: "Byrne Dairy", color: '#34191B', textColor: '#ffffff', dataVar: 'byrneDairyLocations' },
  parkers: { name: "Parker's", color: '#285DA5', textColor: '#ffffff', dataVar: 'parkersLocations' },
  sheetz: { name: "Sheetz", color: '#CB3135', textColor: '#ffffff', dataVar: 'sheetzLocations' },
  racetrac: { name: "RaceTrac", color: '#D03A2B', textColor: '#ffffff', dataVar: 'racetracLocations' },
  pilotFlyingJ: { name: "Pilot Flying J", color: '#BE2B34', textColor: '#ffffff', dataVar: 'pilotLocations' },
  maverik: { name: "Maverik", color: '#B82B35', textColor: '#ffffff', dataVar: 'maverikLocations' },
  quiktrip: { name: "QuikTrip", color: '#D43139', textColor: '#ffffff', dataVar: 'quiktripLocations' },
  loves: { name: "Love's", color: '#FAE14C', textColor: '#1c1c1e', dataVar: 'lovesLocations' },
  bucees: { name: "Buc-ee's", color: '#FCF254', textColor: '#1c1c1e', dataVar: 'buceesLocations' },
  caseys: { name: "Casey's", color: '#EA3624', textColor: '#ffffff', dataVar: 'caseysLocations' },
  kwiktrip: { name: "Kwik Trip", color: '#BF3538', textColor: '#ffffff', dataVar: 'kwiktripLocations' },
  royalFarms: { name: "Royal Farms", color: '#163C9F', textColor: '#ffffff', dataVar: 'royalFarmsLocations' },
  rutters: { name: "Rutter's", color: '#DDD64F', textColor: '#1c1c1e', dataVar: 'ruttersLocations' },
  speedway: { name: "Speedway", color: '#D83234', textColor: '#ffffff', dataVar: 'speedwayLocations' },
  // National / regional expansion chains. These stay hidden from the legend and Pit Stops
  // filter until their matching data file is uploaded (see chainHasData below), so a chain
  // "turns on" automatically the moment window.<dataVar> is populated — no code change needed.
  // Each file must set the exact global named in dataVar (e.g. circle-k-locations.js -> window.circleKLocations).
  circleK: { name: "Circle K", color: '#DB4233', textColor: '#ffffff', dataVar: 'circleKLocations' },
  travelCentersOfAmerica: { name: "TravelCenters of America", color: '#2B65A5', textColor: '#ffffff', dataVar: 'travelCentersOfAmericaLocations' },
  holiday: { name: "Holiday", color: '#DB4433', textColor: '#ffffff', dataVar: 'holidayLocations' },
  jacksons: { name: "Jacksons", color: '#C32D2A', textColor: '#ffffff', dataVar: 'jacksonsLocations' },
  plaidPantry: { name: "Plaid Pantry", color: '#B7294A', textColor: '#ffffff', dataVar: 'plaidPantryLocations' },
  getgo: { name: "GetGo", color: '#071C4F', textColor: '#ffffff', dataVar: 'getgoLocations' },
  quickChek: { name: "QuickChek", color: '#003da5', textColor: '#ffffff', dataVar: 'quickChekLocations' },
  townPump: { name: "Town Pump", color: '#8a1f2b', textColor: '#ffffff', dataVar: 'townPumpLocations' },
  restarea: { name: "Rest Area", color: '#1976d2', textColor: '#ffffff', dataVar: 'restareaLocations' },
  nycDunkin: { name: "Dunkin'", color: '#ff6e0c', textColor: '#ffffff', dataVar: 'nycDunkinLocations', group: 'metro', metro: 'NYC', layer: 'customer' },
  nycStarbucks: { name: 'Starbucks', color: '#00704a', textColor: '#ffffff', dataVar: 'nycStarbucksLocations', group: 'metro', metro: 'NYC', layer: 'customer' },
  nycGregorys: { name: 'Gregorys Coffee', color: '#1a1a1a', textColor: '#ffffff', dataVar: 'nycGregorysLocations', group: 'metro', metro: 'NYC', layer: 'customer' },
  /* All four public-restroom sets are configured IDENTICALLY — no group, layer:'public', same
   * name — so they share one filter row, one bucket, one zoom gate, one popup, and one question
   * list. nycPublic and bosPublic used to carry group:'metro', a flag that means "city café
   * layer" and was applied only because those two cities were where public restrooms happened
   * to exist first. That accident split identical places across two drawer switches, two zoom
   * gates and two popups the moment restrooms went nationwide. */
  nycPublic: { name: 'Public restroom', color: '#6b7280', textColor: '#ffffff', dataVar: 'nycPublicLocations', layer: 'public', shape: 'diamond' },
  bosTatte: { name: 'Tatte Bakery', color: '#b5651d', textColor: '#ffffff', dataVar: 'bosTatteLocations', group: 'metro', metro: 'Boston', layer: 'customer' },
  bosDunkin: { name: "Dunkin'", color: '#ff6e0c', textColor: '#ffffff', dataVar: 'bosDunkinLocations', group: 'metro', metro: 'Boston', layer: 'customer' },
  bosStarbucks: { name: 'Starbucks', color: '#00704a', textColor: '#ffffff', dataVar: 'bosStarbucksLocations', group: 'metro', metro: 'Boston', layer: 'customer' },
  bosPavement: { name: 'Pavement Coffeehouse', color: '#00695c', textColor: '#ffffff', dataVar: 'bosPavementLocations', group: 'metro', metro: 'Boston', layer: 'customer' },
  bosFlour: { name: 'Flour Bakery', color: '#c8506e', textColor: '#ffffff', dataVar: 'bosFlourLocations', group: 'metro', metro: 'Boston', layer: 'customer' },
  bosNero: { name: 'Caffè Nero', color: '#3e2723', textColor: '#ffffff', dataVar: 'bosNeroLocations', group: 'metro', metro: 'Boston', layer: 'customer' },
  bosPublic: { name: 'Public restroom', color: '#6b7280', textColor: '#ffffff', dataVar: 'bosPublicLocations', layer: 'public', shape: 'diamond' },
  // Statewide public restrooms (parks, trailheads, small towns). Same treatment as the
  // city sets, but NOT group:'metro' — 60% of these are rural, so tying them to a metro
  // would hide most of them behind the city zoom/jump behaviour.
  nyPublic: { name: 'Public restroom', color: '#6b7280', textColor: '#ffffff', dataVar: 'nyPublicLocations', layer: 'public', shape: 'diamond' },
  /* Nationwide public restrooms — parks, plazas, trailheads, municipal facilities. ONE registry
   * entry for all ten region files, because every region file appends to the same global array
   * rather than declaring its own. Ten entries would put ten identical "Public restroom" rows in
   * the chain filter, each covering a part of the country the reader cannot see and has no way
   * to reason about.
   *
   * Deliberately NOT group:'metro'. Most of these are outside the covered cities, and the metro
   * group ties a chain to the foot-mode city layer, which would hide them everywhere else. */
  usPublic: { name: 'Public restroom', color: '#6b7280', textColor: '#ffffff', dataVar: 'usPublicLocations', layer: 'public', shape: 'diamond' }
};
const DEFAULT_CHAIN_KEY = 'stewarts';

// A registered chain only counts as "live" once its data file has loaded and has at least one
// location. Registry entries can therefore be pre-wired ahead of their data; they stay invisible
// in the legend and Pit Stops filter until window.<dataVar> is a non-empty array.
function chainHasData(key){
  const dv = CHAIN_REGISTRY[key] && CHAIN_REGISTRY[key].dataVar;
  return !!dv && Array.isArray(window[dv]) && window[dv].length > 0;
}

/* THE public-restroom predicate. Every behaviour that treats a public restroom differently from
 * a store routes through this one test, so the four data sets (NYC, Boston, NY state,
 * nationwide) cannot drift apart again: popup choice, question list, drawer bucket, zoom gate
 * and foot-mode visibility all ask the same question of the same flag. */
function isPublicRestroomChain(key){
  return !!(CHAIN_REGISTRY[key] && CHAIN_REGISTRY[key].layer === 'public');
}

function chainFor(loc){
  return CHAIN_REGISTRY[(loc && loc.chain) || DEFAULT_CHAIN_KEY] || CHAIN_REGISTRY[DEFAULT_CHAIN_KEY];
}

// Merge every chain's data file into one flat list, stamping each location
// with its chain key (unless a location already sets its own — lets one file
// hold a mixed bag later on if that's ever useful).
let seedLocations = [];
Object.keys(CHAIN_REGISTRY).forEach(chainKey => {
  const source = window[CHAIN_REGISTRY[chainKey].dataVar] || [];
  source.forEach(loc => { if(!loc.chain) loc.chain = chainKey; });
  seedLocations = seedLocations.concat(source);
});

const locationsById = {};
seedLocations.forEach(loc => { locationsById[loc.id] = loc; });
perfMark('location data merged (' + seedLocations.length + ' locations)');

// Total location count shown in the menu (hamburger) drawer footer, above the version.
/* A FUNCTION now, for two reasons that arrived together with the nationwide data:
 *
 * 1. "Pit stops" was everything-not-metro, which was true while non-metro meant gas stations.
 *    With 61,788 public restrooms outside the metro group, that line would have read
 *    "Pit stops: 90,000" — off by a factor of three, in the one place the app states its own
 *    coverage. Public restrooms get their own line, counted by the same bucket the drawer's
 *    group switches use, so the numbers and the switches can never describe different worlds.
 *
 * 2. Region files arrive AFTER startup. A count computed once at parse time goes stale the
 *    moment the first region loads, so ingestPublicRegion re-calls this. The per-metro café
 *    lines survive via each chain's metro tag — public restrooms no longer carry one. */
function updateDrawerLocCount(){
  const el = document.getElementById('drawerLocCount');
  if(!el) return;
  /* Three lines, no per-city breakdown. The NYC/Boston lines earned their place while those
   * cities held the app's only public restrooms; with restrooms moved to their own line, the
   * city numbers shrank to café counts — trivia in the one place the app states its coverage,
   * and an implicit claim that two cities are special in a nationwide app. City cafés roll into
   * one line; the registry's per-chain metro tags stay, so a breakdown can return if metro
   * coverage ever becomes a story worth telling again. */
  /* Regions are fetched on demand, so seedLocations holds only what has been panned near. The
   * footer is the one place the app states its coverage, and stating "28,074 locations mapped"
   * when the data files ship 84,079 is simply wrong — it describes this session's download
   * history rather than the map.
   *
   * The manifest already carries a per-region count, written by build-public-toilets.js, so the
   * unloaded remainder is knowable without fetching anything. */
  let pit = 0, pub = 0, cafe = 0;
  seedLocations.forEach(l => {
    const key = l.chain || DEFAULT_CHAIN_KEY;
    const bucket = chainBucket(key);
    if(bucket === 'public'){ pub++; return; }
    if(bucket === 'city'){ cafe++; return; }
    pit++;
  });
  pub += pendingPublicCount();
  const total = pit + pub + cafe;
  const lines = [`Pit stops: ${pit.toLocaleString()}`,
    `Public restrooms: ${pub.toLocaleString()}`,
    `Coffee shops: ${cafe.toLocaleString()}`];
  el.innerHTML = `${total.toLocaleString()} locations mapped` +
    `<span class="d-count-breakdown">${lines.join('<br>')}</span>`;
}
/* Records in regions that have not been downloaded in this session. Counted from the manifest
 * rather than fetched — 18 MB of location files to make a footer accurate would be an absurd
 * trade, and the number is baked at build time precisely so it can be read cheaply.
 *
 * A region already loaded is excluded, or its records would be counted twice: once in
 * seedLocations and once here. */
function pendingPublicCount(){
  try{
    const manifest = window.publicToiletManifest;
    if(!Array.isArray(manifest)) return 0;
    return manifest.reduce((n, e) =>
      n + ((publicRegionState[e.region] === 'loaded') ? 0 : (e.count || 0)), 0);
  }catch(e){ return 0; }
}

/* Deferred to the next tick ON PURPOSE. chainBucket reads TRAVEL_CENTER_KEYS, a `const`
 * declared a few hundred lines below — function declarations hoist but consts do not, so a
 * synchronous call here dies in the temporal dead zone and takes the whole script with it.
 * setTimeout(0) runs after the full script has evaluated, when every const exists. */
setTimeout(updateDrawerLocCount, 0);

// Theme: defaults to the phone's system light/dark setting, but a manual toggle overrides it
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  if(btn){
    /* The row reads "Dark mode", so the switch is ON when the theme IS dark. It previously said
     * "Appearance" and lit up for LIGHT — a switch whose label named a category rather than a
     * state, so there was no way to tell what "on" meant without flipping it. Naming the state
     * is what makes the switch answerable at a glance.
     *
     * Note the polarity: this is deliberately the inverse of what it used to be. */
    const isDark = theme !== 'light';
    btn.classList.toggle('on', isDark);
    btn.setAttribute('aria-pressed', String(isDark));
  }
  if(typeof setMapTilesForTheme === 'function') setMapTilesForTheme(theme);
  /* The second theme control (the account sheet's Light/Dark pair) is gone — one setting, one
   * switch, nothing to mirror. */
}
document.getElementById('themeToggle').addEventListener('click', () => {
  if(!isLoggedIn()) return;                       // gated: anonymous keeps the default theme
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  applyTheme(next);
});

// (The old always-rendered legend was replaced by the chain key — see the Chain key module
// further down, which renders the same swatches as tappable filter rows.)

const map = L.map('map', {
  zoomControl: false,
  maxZoom: 19,
  // One-handed zoom (double-tap + drag up/down, Google Maps style) via the DoubleTapDragZoom
  // plugin. The option is simply ignored if the plugin script failed to load, so the map still
  // works normally without it.
  doubleTapDragZoom: 'center',
  doubleTapDragZoomOptions: { reverse: true }   // drag DOWN = zoom in (Google Maps direction)
}).setView([42.65123, -73.75176], 12);
// Zoom buttons removed — pinch and double-tap-drag cover zooming, and the rail stays clear.

// Marker clustering (re-added, Option A: clustering owns all markers; the old viewport
// add/remove culling was removed so the two systems can't fight — that conflict was the likely
// cause of the earlier Android races). Guardrails against the bugs seen last time:
//  - maxZoom set explicitly to match the map/tile maxZoom (fixes the old "maxZoom error")
//  - disableClusteringAtZoom: at close zoom pins render individually, skipping the spiderfy /
//    zoomToShowLayer code paths that caused races
//  - spiderfy disabled and animations off for stability on older devices
const markerCluster = L.markerClusterGroup({
  maxClusterRadius: 55,
  disableClusteringAtZoom: 16,
  spiderfyOnMaxZoom: false,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true,
  animate: true,              // clusters expand/collapse with a modern animation
  animateAddingMarkers: false, // ...but don't animate bulk marker adds (that part is heavy)
  removeOutsideVisibleBounds: true,   // the plugin does its own viewport culling internally
  maxZoom: 19
});
map.addLayer(markerCluster);

function positionSelectedMarker(marker, animate = false){
  if(!marker) return;

  const mapEl = map.getContainer();
  const mapRect = mapEl.getBoundingClientRect();
  const markerPoint = map.latLngToContainerPoint(marker.getLatLng());

  // Use the actually visible viewport, then subtract the header/map top.
  // This avoids positioning the pin too low on phones with a tall header
  // or browser controls taking up part of the screen.
  const viewportHeight = window.visualViewport
    ? window.visualViewport.height
    : window.innerHeight;

  const visibleMapBottom = Math.min(mapRect.bottom, viewportHeight);
  const visibleMapHeight = Math.max(1, visibleMapBottom - mapRect.top);

  // Keep the selected pin within a horizontal safe zone from 55% to 60%.
  // Pins already inside that range do not move left or right.
  const minX = mapRect.width * 0.55;
  const maxX = mapRect.width * 0.60;
  const desiredX = Math.max(minX, Math.min(markerPoint.x, maxX));

  // Position the pin at 86% down the actually visible map area,
  // while retaining a small bottom safety margin.
  const desiredY = Math.min(
    visibleMapHeight * 0.86,
    visibleMapHeight - 48
  );

  const offsetX = markerPoint.x - desiredX;
  const offsetY = markerPoint.y - desiredY;

  if(Math.abs(offsetX) > 1 || Math.abs(offsetY) > 1){
    map.panBy([offsetX, offsetY], { animate });
  }
}

function zoomToMarker(marker){
  if(!marker) return;

  // The marker's chain may currently be hidden by the Places filter (e.g. Bathroom Now
  // or a search result pointing at a location outside the selected chains). Force it
  // visible for this one lookup rather than silently failing to open — the normal filter
  // reasserts itself next time applyFilters() runs (e.g. any checkbox change).
  if(!markerCluster.hasLayer(marker)) markerCluster.addLayer(marker);

  // With clustering, a marker may be inside a cluster bubble at the current zoom — opening its
  // popup then would show nothing (the old "popup closes immediately" symptom). disableClustering-
  // AtZoom is 16, so we zoom to 16 FIRST (which declusters this marker), then open the popup once
  // it's individually on the map. Using the map's own 'moveend' (one-shot) avoids the plugin's
  // zoomToShowLayer race that caused trouble before.
  const openWhenReady = () => {
    marker.openPopup();
    positionSelectedMarker(marker, false);
  };
  map.setView(marker.getLatLng(), 16, { animate: false });
  // setView fires moveend synchronously here; open on the next tick so the cluster has settled.
  setTimeout(openWhenReady, 0);
}

// Register the service worker — required by Android/Chrome for "Add to Home Screen" to
// actually offer full app-like installation (not just a bookmark shortcut)
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => {
      console.error('Service worker registration failed (site still works fine without it):', e);
    });
  });
}

// Safety net: recalculate map size whenever the viewport or layout might have changed
window.addEventListener('resize', () => map.invalidateSize());
window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 200));
setTimeout(() => map.invalidateSize(), 300); // catch any late layout shifts right after load

// Hide the floating buttons while a popup is open so they never overlap its content
map.on('popupopen', () => {
  document.getElementById('locateBtn').style.display = 'none';
  document.getElementById('nearestInfo').style.display = 'none';
  document.getElementById('missingBtn').style.display = 'none';
  document.getElementById('missingPanel').classList.remove('show');
  document.getElementById('topLeftControls').style.display = 'none';
  document.getElementById('openNowToggle').style.display = 'none';
  document.getElementById('listViewToggle').style.display = 'none';
  /* The passport entry is a sheet row now, not a drawer button. Guarded because these
   * hide/show routines chain several unguarded lookups — one null throws and silently abandons
   * every line after it. */
  document.getElementById('ssPassportRow')?.style.setProperty('display', 'none');
  document.getElementById('whereAmIBtn').style.display = 'none';
});
map.on('popupclose', () => {
  // Clear per-visit question state so reopening any pin computes a fresh visit (a new set of
  // up-to-4, including "not sure" trickle-back). Only one popup is open at a time, so clearing
  // all of it here is safe.
  for(const k in visitQuestions) delete visitQuestions[k];
  for(const k in visitCursor) delete visitCursor[k];
  document.getElementById('locateBtn').style.display = '';
  document.getElementById('missingBtn').style.display = '';
  document.getElementById('topLeftControls').style.display = '';
  document.getElementById('openNowToggle').style.display = '';
  document.getElementById('listViewToggle').style.display = '';
  document.getElementById('ssPassportRow')?.style.removeProperty('display');
  document.getElementById('whereAmIBtn').style.display = '';
});

// Two tile sources now: satellite imagery for light mode, street map (with a CSS invert
// trick) for dark mode. OpenStreetMap doesn't offer imagery itself, so satellite comes from
// Esri's free, no-API-key World Imagery service — long-established and widely used, though
// it is a second external dependency worth keeping in mind if tiles ever fail to load.
// Single tile source (the one we know reliably works) — dark mode is done with a CSS
// color-invert trick on the tile layer itself, rather than depending on a second external
// tile server. (We tried Esri satellite imagery for light mode, but it turned out to have
// the same reliability problem as the CARTO dark tiles did earlier — Esri increasingly
// requires a developer account/API key for consistent free access.)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

function setMapTilesForTheme(theme){
  const mapEl = document.getElementById('map');
  if(theme === 'light'){
    mapEl.classList.remove('dark-map-tiles');
  } else {
    mapEl.classList.add('dark-map-tiles');
  }
}

// Now that map + tiles exist, apply the actual initial theme (this triggers the right tile set too)
(function(){
  const saved = localStorage.getItem('theme');
  applyTheme(saved || 'light');   // Light mode is the default for first-time visitors
})();

let ratingsCache = {};

function starsHtml(id, type, current){
  let s = '<span class="stars" data-id="'+id+'" data-type="'+type+'">';
  for(let i=1;i<=5;i++){
    s += '<span class="'+(i<=current?'filled':'')+'" data-val="'+i+'">★</span>';
  }
  s += '</span>';
  return s;
}

// Color the dot itself by the bathroom average, matching star-rating tiers 1-5
// Marker size scales with zoom level so pins are easy to see and tap whether zoomed out or in
function sizesForZoom(zoom){
  if(zoom >= 15) return {unrated:22, rated:30};
  if(zoom >= 13) return {unrated:18, rated:25};
  if(zoom >= 11) return {unrated:15, rated:20};
  if(zoom >= 9)  return {unrated:12, rated:15};
  return {unrated:9, rated:11};
}

// Icon descriptors are shared, not per-marker: a pin's look depends only on its chain
// (color + shape) and the current zoom size bucket, so ~20 chains x 5 size buckets covers
// every marker on the map. Previously every makeIcon() call built a fresh L.divIcon —
// ~9,000 identical allocations per zoom change — which was a main contributor to memory
// churn / iOS Safari reloads. Leaflet builds a separate DOM element per marker from the
// shared descriptor, so in-place tweaks like resizeOpenMarkerIcon stay safe.
// NOTE: if pins ever encode per-location state again (e.g. the v2 rating-colored centers),
// add that state to the cache key (e.g. a rating bucket) — do NOT go back to per-id icons.
const _iconCache = {};
function makeIcon(id){
  const loc = locationsById[id];
  const chainKey = (loc && loc.chain) || DEFAULT_CHAIN_KEY;
  const chain = chainFor(loc);
  const size = sizesForZoom(map.getZoom()).rated; // one uniform size per zoom level
  const cacheKey = chainKey + '|' + size;
  let icon = _iconCache[cacheKey];
  if(!icon){
    icon = L.divIcon({
      className:'',
      html:`<div style="${pinShapeStyle(chain, size)}"></div>`,
      iconSize:[size, size],
      iconAnchor:[size/2, size/2]
    });
    _iconCache[cacheKey] = icon;
  }
  return icon;
}

// Pin shape is the between-layer axis: color still tells you the brand, shape tells you the
// kind of place. circle = pit stop (default), diamond = metro/public, square = customer chain.
// A registry entry with no `shape` renders as a circle, so existing chains are unchanged.
// circle/square/diamond keep the white ring + drop shadow; triangle uses clip-path, which
// clips a normal border/box-shadow, so it swaps to a shape-following drop-shadow and no ring.
function pinShapeStyle(chain, size){
  const base = `background:${chain.color};width:${size}px;height:${size}px;`;
  const ring = 'border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,.6);';
  switch(chain.shape){
    case 'square':   return base + ring + 'border-radius:3px;';
    case 'diamond':  return base + ring + 'border-radius:3px;transform:rotate(45deg);';
    case 'triangle': return base + 'clip-path:polygon(50% 0,100% 100%,0 100%);filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));';
    default:         return base + ring + 'border-radius:50%;';
  }
}

function emptyAgg(){ return {bathroomSum:0, bathroomCount:0}; }
/* safe joins bathroom as a rating. Zero means unanswered, exactly as it does for the other,
 * so nothing downstream needs a new "unset" convention. */
function emptyVote(){ return {store:0, bathroom:0, safe:0, amenities:{}, storeFeatures:{}, amenityMeta:{}}; }
// Resize a marker whose popup is OPEN without calling setIcon(): swapping the icon element
// out from under an open popup can break/close it on some mobile browsers, so instead we
// mutate the existing icon element's size in place. Keeps the selected pin in sync with the
// zoom level (otherwise it stays frozen at whatever size it was when the popup opened).
function resizeOpenMarkerIcon(marker){
  const el = marker && marker._icon;
  if(!el) return;
  const size = sizesForZoom(map.getZoom()).rated;
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.marginLeft = (-size / 2) + 'px';
  el.style.marginTop = (-size / 2) + 'px';
  const dot = el.firstElementChild;
  if(dot){ dot.style.width = size + 'px'; dot.style.height = size + 'px'; }
}
function avgStr(sum, count){ return count > 0 ? (sum/count).toFixed(1) : '—'; }
function ratingConfidenceHtml(count){
  if(!count) return '<span class="rating-confidence">Not yet rated</span>';
  const label = `${count} ${count === 1 ? 'rating' : 'ratings'}`;
  return count < 5
    ? `<span class="rating-confidence">${label}</span> <span class="early-score">Early score</span>`
    : `<span class="rating-confidence">${label}</span>`;
}

// A community feature is "confirmed" when at least CONFIRM_THRESHOLD different people voted yes
// AND yes outnumber no. The same bar applies symmetrically to "confirmed no". One constant so the
// threshold is tuned in a single place (badges, filters, priority engine, and the bake tool all
// use it). Raised to 3 in v2.6 for stronger trust.
/* Single source of truth for "when was the data last updated".
 *
 * This used to be typed by hand in three places — the version stamp in the drawer, the
 * onboarding panel, and the FAQ — which is exactly why they drifted apart (July 14 / July 21 /
 * actually July 30). Set this ONE value on each release; everything that shows a date reads it.
 * Format is YYYY-MM-DD so it sorts and can't be misread. */
const BUILD_DATE = '2026-08-03';

// "2026-07-30" -> "July 30, 2026" for prose. Parsed as UTC parts rather than new Date(str) so it
// can't shift a day backwards for users west of GMT.
function buildDateLong(){
  const [y, m, d] = BUILD_DATE.split('-').map(Number);
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return MONTHS[m - 1] + ' ' + d + ', ' + y;
}

// Fill every element that displays the data date, so none can go stale independently.
function stampBuildDate(){
  const long = buildDateLong();
  document.querySelectorAll('.onboardingUpdated').forEach(el => {
    el.textContent = 'Location data updated: ' + long;
  });
  document.querySelectorAll('.hiw-updated').forEach(el => {
    el.textContent = 'Location data last updated: ' + long;
  });
  const v = document.querySelector('.d-version');
  if(v && v.dataset.version) v.textContent = v.dataset.version + ' \u00b7 ' + BUILD_DATE;
}

/* ============================================================
 * Firestore document ids
 * ============================================================
 * Firestore treats '/' as a path separator, so doc(db,'votes','node/123_uid') resolves to the
 * three-segment path votes/node/123_uid and THROWS — doc() requires an even segment count.
 * 6,595 location ids (23.5% of the map) were OSM-derived and contained a slash, so every
 * rating, aggregate read, tip and admin override silently failed for them: Speedway entirely,
 * plus every metro and public-restroom chain. Each call site was wrapped in try/catch returning
 * an empty value, so nothing surfaced to the user or the console.
 *
 * The data files now carry the safe form and preserve the original in meta.srcId. This helper
 * stays as the boundary guard anyway, because:
 *   - previously shared links still carry the raw form (?loc=node%2F123)
 *   - reports / outOfOrder / missingReports / activity store locId as a FIELD, with slashes,
 *     and those writes succeeded (auto-id addDoc), so old docs must stay resolvable
 *   - a future import can reintroduce slashed ids
 *
 * There is deliberately NO inverse. It cannot be written correctly: 39 ids contain two slashes
 * (merged records like node/A+node/B) and one contains a genuine double underscore
 * (gp/ChIJTzsjNj5744kRK__m7xpIOck), so no single replace rule reconstructs both. Use
 * meta.srcId, which is exact. */
/* The interstate travel-center chains. ONE definition, shared by chainBucket() and the Truck
 * Stop Hero achievement. Three separate lists used to exist with three different contents:
 * the achievement's omitted travelCentersOfAmerica, and a third (since removed) still named
 * 'pilot', which has never been a CHAIN_REGISTRY key. Keys here must exist in CHAIN_REGISTRY —
 * tools/audit-ui.js enforces that. */
const TRAVEL_CENTER_KEYS = new Set(['pilotFlyingJ', 'loves', 'bucees', 'travelCentersOfAmerica']);

function fsId(id){
  return String(id == null ? '' : id).replace(/\//g, '__');
}

const CONFIRM_THRESHOLD = 3;
function isConfirmedYes(x){ return !!x && x.yes >= CONFIRM_THRESHOLD && x.yes > x.no; }
function isConfirmedNo(x){  return !!x && x.no  >= CONFIRM_THRESHOLD && x.no  > x.yes; }

/* ---------- Reported, but not yet confirmed ----------
 * A third state between "nobody knows" and "the community agrees".
 *
 * Until now an answer was invisible until three people gave the same one. At a location with a
 * single rating that means the first person's answer is stored, correct, and shown to nobody —
 * possibly for years. The question also keeps being asked, which is right, but the asker gets
 * no sign their answer landed.
 *
 * So one vote is enough to DISPLAY, and three is still what it takes to be CONFIRMED. The
 * badge says which it is, because "one person said so" and "several people agree" are
 * different claims and the reader deserves to know which they are looking at.
 *
 * Deliberately NOT a change to amenitySettled: the question keeps being served until the real
 * threshold, so showing early costs no data. */
function isReportedYes(x){ return !!x && x.yes >= 1 && x.yes > x.no && !isConfirmedYes(x); }
function isReportedNo(x){  return !!x && x.no  >= 1 && x.no  > x.yes && !isConfirmedNo(x); }

/* The leading state for a multi-state amenity that has votes but has not confirmed. Same tie
 * rule as confirmedState — a 1-1 split is not a report, it is a disagreement. */
function reportedState(a, x){
  if(!isMultiState(a) || !x) return null;
  if(confirmedState(a, x)) return null;
  let best = null, bestN = 0, tied = false;
  for(const st of a.states){
    if(st === 'unknown') continue;
    const n = x[st] || 0;
    if(n > bestN){ best = st; bestN = n; tied = false; }
    else if(n === bestN && n > 0){ tied = true; }
  }
  return (!tied && bestN >= 1) ? best : null;
}

/* ---------- Multi-state amenities ----------
 * Most amenities answer yes/no. restroomType answers single/multiple instead, and every
 * confirmation path here was written against {yes,no} only — so its votes tallied to nothing,
 * isConfirmedYes could never fire, and the question never displayed and never retired.
 * Multi-state counts now sit on the same cell ({yes:0,no:0,single:5,multiple:1}), so nothing
 * boolean changes; these two helpers are the only readers that look past yes/no. */
function isMultiState(a){ return !!(a && a.states && !a.states.includes('yes')); }

// The winning state, or null if nothing has confirmed yet. Same bar as isConfirmedYes: at
// threshold AND strictly ahead of every sibling, so a genuine 5-5 split stays unconfirmed
// rather than silently resolving to whichever state was declared first.
function confirmedState(a, x){
  if(!isMultiState(a) || !x) return null;
  let best = null, bestN = 0, tied = false;
  for(const s of a.states){
    if(s === 'unknown') continue;
    const n = x[s] || 0;
    if(n > bestN){ best = s; bestN = n; tied = false; }
    else if(n === bestN && n > 0){ tied = true; }
  }
  return (!tied && bestN >= CONFIRM_THRESHOLD) ? best : null;
}

// ---------- Voting priority engine (v2.6) ----------
// Usefulness tiers drive which unconfirmed questions surface first. Higher number = higher
// priority. gas is intentionally absent (OSM-known, never asked). Anything not listed defaults
// to LOW.
const AMENITY_TIER = {
  hasRestroom: 4,                                               // CRITICAL — asked first where doubted
  accessible: 3, changing: 3,                                   // HIGH
  indoorSeating: 2, wifi: 2, restroomType: 2, grabAndGo: 2, hotFood: 2, evCharging: 2, // MEDIUM
  /* Below restroomType on purpose. Stall count is what tells someone whether they can lock the
   * door behind them; gendered signage is useful context but rarely changes the decision, and
   * only four questions are served per visit — a second MEDIUM here would crowd out changing
   * tables or accessibility. */
  airPump: 1, shower: 1, genderSplit: 1                         // LOW
};
const QUESTIONS_PER_VISIT = 4;

// Combined bathroom+store definition for a key.
function amenityDefFor(key){
  return BATHROOM_AMENITIES.find(a => a.key === key) || STORE_FEATURES.find(a => a.key === key);
}
function isBathroomKey(key){ return BATHROOM_AMENITIES.some(a => a.key === key); }

// Is this amenity already settled for this location (so we never ask it)?
//  - community-confirmed (live votes >= threshold, or baked conf) → settled
//  - gas that OSM knows → settled (the gas exception: trusted, never asked)
// OSM-verified NON-gas amenities are NOT settled — they stay askable so visitors can promote
// them from teal (verified, no star) to a starred green/red answer badge (confirmed by visitors).
function amenitySettled(loc, key, summary){
  const conf = (loc && loc.conf) || {};
  const osm  = (loc && loc.osm) || {};
  const ov = amenityOverrideCache[loc && loc.id];
  if(ov && ov[key] && ov[key] !== 'unknown') return true;  // admin set it — authoritative
  if(key === 'gas') return true;                      // never asked
  if(conf[key]) return true;                          // baked community confirmation
  // Multi-state settles on its own rule — isConfirmedYes/No below can never fire for it, which
  // is why this question was re-served to everyone on every visit no matter how many answered.
  const def = amenityDefFor(key);
  if(isMultiState(def)) return confirmedState(def, summary && summary[key]) !== null;
  if(isConfirmedYes(summary && summary[key])) return true;  // live community confirmation
  if(isConfirmedNo(summary && summary[key])) return true;   // community-confirmed absent — stop asking
  return false;
}

// Score an unconfirmed amenity: base tier + near-threshold boost (at exactly 2 yes, one vote from
// confirming, bump up one tier).
function amenityPriority(key, summary){
  let score = AMENITY_TIER[key] || 1;
  const x = summary && summary[key];
  if(x && x.yes === (CONFIRM_THRESHOLD - 1) && x.yes > x.no) score += 1;  // near-threshold boost
  return score;
}

// Build this visit's question list from the combined pool. Three groups, driven by this person's
// per-amenity not-sure history (amenityMeta[key].notSure):
//   • retired  (notSure >= 2)      → never shown again to this person
//   • resurface (notSure === 1)    → eligible, but AT MOST ONE comes back per visit
//   • fresh    (notSure 0/absent)  → normal
// A question is also excluded if it's settled (confirmed / gas) or the person already gave a real
// yes/no answer. Result: up to 1 resurfaced + fill to QUESTIONS_PER_VISIT with fresh, ranked by
// priority. (1 resurface max even when no fresh remain.)
const NOT_SURE_RETIRE = 2;
/* Keys the person has asked to answer again, per location, for this session only.
 *
 * Declared HERE rather than beside its click handler because pickVisitQuestions reads it and
 * runs first — a `const` read before its declaration throws, and that is the exact bug that
 * broke every popup in v2.38. Module state goes above the first thing that touches it. */
const reopenedKeys = {};

function pickVisitQuestions(loc, myVote){
  const summary = { ...(amenityCache[loc.id] || {}), ...(storeFeatureCache[loc.id] || {}) };
  const mine = { ...(myVote.amenities || {}), ...(myVote.storeFeatures || {}) };
  const meta = myVote.amenityMeta || {};
  // Metro locations (Dunkin, Starbucks, public restrooms, …) get bathroom questions only —
  // store/gas-station features (EV charging, air pump, showers, …) are never asked there.
  /* Bathroom-only questions anywhere there is no store: the metro cafés AND every public
   * restroom set. Before this, the test was metro-only, so a visitor at a NY-state or
   * nationwide public restroom was asked about EV charging and hot food at a park toilet
   * block — questions that can never have a true answer there. */
  const restroomOnly = chainFor(loc).group === 'metro' || isPublicRestroomChain(loc.chain);
  const allKeys = (restroomOnly ? BATHROOM_AMENITIES : [...BATHROOM_AMENITIES, ...STORE_FEATURES]).map(a => a.key);

  const eligible = allKeys.filter(key => {
    // "Is there a public restroom?" is targeted, not universal — see restroomDoubted.
    if(key === 'hasRestroom' && !restroomDoubted(loc)) return false;
    if(amenitySettled(loc, key, summary)) return false;                 // confirmed / gas
    /* A key you asked to change is eligible again even though you have answered it. Session-only
     * and deliberately not persisted: it reopens the question without touching the stored value,
     * so if you never answer, nothing changed. */
    const reopened = (reopenedKeys[loc.id] && reopenedKeys[loc.id].has(key));
    const ans = mine[key];
    if(!reopened && (ans === 'yes' || ans === 'no' || (ans && ans !== 'unknown'))) return false; // answered for real
    const ns = (meta[key] && meta[key].notSure) || 0;
    if(ns >= NOT_SURE_RETIRE) return false;                             // retired for this person
    return true;
  });

  const byPriority = (a, b) => amenityPriority(b, summary) - amenityPriority(a, summary);
  const fresh     = eligible.filter(k => !((meta[k] && meta[k].notSure) >= 1)).sort(byPriority);
  const resurface = eligible.filter(k =>  ((meta[k] && meta[k].notSure) >= 1)).sort(byPriority);

  const list = [];
  if(resurface.length) list.push(resurface[0]);          // at most one previously-not-sure'd
  for(const k of fresh){ if(list.length >= QUESTIONS_PER_VISIT) break; list.push(k); }
  return list.slice(0, QUESTIONS_PER_VISIT);
}

const BATHROOM_AMENITIES = [
  /* Two questions, because "single vs multiple" was silently answering two of them at once.
   * Stall count and gendered separation are independent: a place can be one unisex room with
   * one toilet, one unisex room with stalls, two single-occupancy rooms marked Men and Women,
   * or two multi-stall rooms. The old states ('Single' / "Men's & women's") straddled both
   * axes, so two of those four layouts had no correct answer, and a reader learned nothing
   * about the thing that actually matters for washing up: whether you can lock the door.
   *
   * restroomType keeps its key and its stored values, so no migration — 'single' meant one
   * lockable room under either wording. It now asks ONLY about stalls. genderSplit is new and
   * deliberately boolean, which means its values ('yes'/'no') are already inside the value
   * enum in firestore.rules and COUNTED_ANSWERS in functions/index.js — only the key
   * allowlists needed touching, in the three places check 15 enforces. */
  /* Layout — what you walk into.
   *
   * This used to ask "one toilet, or multiple stalls?", which had no correct answer at the
   * commonest convenience-store layout in the country: two separate one-holers. Each room has
   * one toilet, so "single stall" is wrong; there is no shared room with partitions, so
   * "multiple stalls" is wrong too. The question conflated PRIVACY with COUNT.
   *
   * Three states separate them. Both stored values keep their exact meaning — 'single' always
   * meant one lockable toilet and 'multiple' always meant partitions in a shared room — so
   * every existing answer survives and only the third value is new. 'multiPrivate' is spelled
   * out rather than reusing 'multiple' precisely so the two cannot be confused in stored data.
   *
   * Ordered by how often you meet them, not by logic: most convenience stores are a single
   * private room, and the first option should be the one most people are about to tap. */
  {key:'restroomType', label:'Restroom layout',
    question:'What is the setup?',
    states:['unknown','single','multiPrivate','multiple'],
    stateLabels:{
      unknown:'Not sure',
      single:'Single private restroom',
      multiPrivate:'Multiple private restrooms',
      multiple:'Multi-stall restroom'
    },
    stateHints:{
      single:'One toilet, locking door',
      multiPrivate:'Separate locking rooms',
      multiple:'Shared room with stalls'
    }},
  /* The label is what a reader sees on the badge, so it has to state the FACT rather than name
   * the question. "Restroom rooms" described neither — it was a leftover from when this asked
   * how many rooms there were, which is now the layout question's job. */
  {key:'genderSplit', label:'Open to',
    question:"Who can use it?",
    /* Multi-state rather than boolean, because a boolean only DISPLAYS in the affirmative:
     * communityConfirmedBadges returns '' unless isConfirmedYes fires, so a confirmed NO — one
     * shared unisex restroom — would render nothing and look identical to "nobody has answered
     * yet". That is the answer most worth surfacing, since a single shared room is the one you
     * can lock behind you.
     *
     * The values are 'single' and 'multiple', reused deliberately rather than inventing
     * 'shared'/'split': those two are already in the value enum in firestore.rules and in
     * COUNTED_ANSWERS in functions/index.js, so this stays a client-only change. Read as a room
     * count the words are literal — one room, or more than one. */
    states:['unknown','single','multiple'],
    stateLabels:{
      unknown:'Not sure',
      single:'Anyone',
      multiple:"Men's & women's"
    }},
  {key:'accessible', label:'Wheelchair accessible', stateIcons:{yes:'♿️'}},
  /* The one amenity whose ABSENCE is worth a badge — see showNegative in
   * communityConfirmedBadges. Add the flag to another key only if a reader would otherwise
   * assume the thing is there. */
  {key:'changing', label:'Changing table', showNegative:true, stateIcons:{yes:'<svg class="ico" aria-hidden="true"><use href="#i-changing"></use></svg>'}},
  /* Asked ONLY where the operator's own data doesn't list a public restroom (see
   * restroomDoubted). This is the one question that can prune the map: every other amenity adds
   * detail to a pin already assumed valid, while this one lets people tell us a pin shouldn't
   * exist. Confirmed-no hides it, at the same CONFIRM_THRESHOLD as everything else. */
  {key:'hasRestroom', label:'Public restroom', question:'Is there a public restroom here?',
    stateIcons:{yes:'<svg class="ico" aria-hidden="true"><use href="#i-restroom"></use></svg>'}}
];
const amenityCache = {};

// Store-level features — separate from bathroom features (myVote.storeFeatures vs
// myVote.amenities), tucked inside the already-collapsed Store rating section so the
// bathroom-first flow stays exactly as quick as it was.
const STORE_FEATURES = [
  {key:'evCharging', label:'EV Charging', stateIcons:{yes:'<svg class="ico" aria-hidden="true"><use href="#i-ev"></use></svg>'}},
  {key:'airPump', label:'Air pump', stateIcons:{yes:'<svg class="ico" aria-hidden="true"><use href="#i-air"></use></svg>'}},
  {key:'shower', label:'Showers', stateIcons:{yes:'<svg class="ico" aria-hidden="true"><use href="#i-shower"></use></svg>'}},
  {key:'indoorSeating', label:'Indoor seating', stateIcons:{yes:'<svg class="ico" aria-hidden="true"><use href="#i-seating"></use></svg>'}},
  {key:'wifi', label:'WiFi', stateIcons:{yes:'<svg class="ico" aria-hidden="true"><use href="#i-wifi"></use></svg>'}},
  {key:'grabAndGo', label:'Grab & go snacks', stateIcons:{yes:'<svg class="ico" aria-hidden="true"><use href="#i-grabgo"></use></svg>'}},
  {key:'hotFood', label:'Hot food', stateIcons:{yes:'<svg class="ico" aria-hidden="true"><use href="#i-hotfood"></use></svg>'}}
];
const storeFeatureCache = {};

// Cycles through whichever states this amenity defines (most are Not sure/Yes/No, but
// Restroom type instead cycles Not sure/Single-person/Multiple stalls)
function amenityStateLabel(a, val){
  const labels = a.stateLabels || {unknown:'Not sure', yes:'Yes', no:'No'};
  return labels[val] || 'Not sure';
}

// Icons for each possible answer value across all amenities (both yes/no and the
// restroom-type single/multiple states)
/* Answer marks, drawn rather than emoji so they sit at the same weight as everything else on
 * the card. 'unknown' is the same help mark used wherever the app says it does not know. */
const AMENITY_ANSWER_ICONS = {
  yes: `<svg class="ico" aria-hidden="true"><use href="#i-check"></use></svg>`,
  no: `<svg class="ico" aria-hidden="true"><use href="#i-ban"></use></svg>`,
  unknown: `<svg class="ico" aria-hidden="true"><use href="#i-help"></use></svg>`,
  single: `<svg class="ico" aria-hidden="true"><use href="#i-lock"></use></svg>`,
  multiple: `<svg class="ico" aria-hidden="true"><use href="#i-restroom"></use></svg>`,
  /* Added with the third layout state. Without it amenityButtonIcon fell through to its '•'
   * fallback, so the new option rendered a bare bullet next to two properly iconed ones — which
   * reads as a rendering fault rather than a choice. Two locks side by side: the same lock as
   * "single private", twice, which is exactly what the option means. */
  multiPrivate: `<svg class="ico" aria-hidden="true"><use href="#i-locks"></use></svg>`
};

function amenityAnswerIcon(a, val){
  if(a.stateIcons && a.stateIcons[val]) return a.stateIcons[val];
  return AMENITY_ANSWER_ICONS[val] || '•';
}

/* The ANSWER BUTTONS deliberately ignore stateIcons and always use the generic mark.
 *
 * amenityAnswerIcon prefers the amenity's own glyph, which is right on a badge — "♿ Wheelchair
 * accessible ⭐" names the feature. On a Yes/No button it is wrong: the row asked "Wheelchair
 * accessible?" and then labelled the affirmative with a wheelchair, so both buttons showed a
 * subject glyph and neither showed an answer. A check and a circle-slash read as yes and no
 * without being read at all, which is the point of a three-tap flow.
 *
 * Multi-state answers ('single' / 'multiple') are unaffected — they have no stateIcons and were
 * already falling through to this same set. */
/* A rejected write and a dropped connection produced the same sentence, and they are not the
 * same problem: one needs a rules deploy and the other needs a signal. saveMyVote already logs
 * the Firestore error code — this surfaces the part that changes what you should do about it.
 *
 * Written for the person holding the phone, not the person who wrote the rules: "this answer
 * was not accepted" is actionable (report it, try a different answer), "check your connection"
 * is actionable, and "try again" is not. */
function saveFailureNote(err){
  const e = err || lastSaveError;
  const code = e && (e.code || e.message || '');
  if(/permission-denied|PERMISSION_DENIED/.test(code)) return 'That answer was not accepted — please report it.';
  if(/unavailable|network|offline|deadline/i.test(code))  return 'Could not save — check your connection.';
  return 'Could not save — nothing was recorded.';
}

function amenityButtonIcon(val){
  return AMENITY_ANSWER_ICONS[val] || '•';
}

// Renders whichever single question comes next (the first one this person hasn't answered
// yet), or a friendly completion message once every feature has an answer on record.
// Per-popup visit state: the ordered list of question keys chosen for this visit (computed once
// on open so it stays stable as the person answers), and how far through it they are.
const visitQuestions = {};
const visitCursor = {};

// ===================== ADMIN-AUTHORITATIVE AMENITIES =====================
// admins/{uid} can set a store's amenities directly; the answer is authoritative and shows live
// for everyone. Stored in amenityOverrides/{storeId}; positive answers are merged into loc.conf at
// read time so every existing "confirmed" display path shows them with no extra plumbing.
const amenityOverrideCache = {};   // locId -> { accessible:'yes', changing:'no', ... }
const ADMIN_AMENITY_KEYS = ['accessible','changing','evCharging','airPump','shower','indoorSeating','wifi','grabAndGo','hotFood'];

async function loadAmenityOverride(loc){
  try{
    const {db, doc, getDoc} = await fb();
    const safeId = fsId(loc.id);
    const snap = await getDoc(doc(db, 'amenityOverrides', safeId));
    const ov = snap.exists() ? (snap.data() || {}) : {};
    amenityOverrideCache[loc.id] = ov;
    loc.conf = loc.conf || {};
    for(const k in ov){ if(ov[k] === 'yes') loc.conf[k] = true; }  // positive → shows as confirmed
    return ov;
  }catch(e){ amenityOverrideCache[loc.id] = amenityOverrideCache[loc.id] || {}; return {}; }
}

async function saveAmenityOverride(locId, key, val){
  if(!isMapAdmin()) return false;
  try{
    const {db, doc, setDoc} = await fb();
    const safeId = fsId(locId);
    await setDoc(doc(db, 'amenityOverrides', safeId), { [key]: val }, { merge: true });
    return true;
  }catch(e){ return false; }
}

// Admin-only panel: each feature with Yes / No / — (clear). Only rendered when isMapAdmin().
function adminAmenityPanelHtml(loc){
  const ov = amenityOverrideCache[loc.id] || {};
  /* Multi-state amenities are excluded because this panel only emits yes/no/clear, which cannot
   * express 'single' or 'multiple' — tested with isMultiState rather than by naming keys, so a
   * future multi-state amenity can't quietly appear here with two buttons that mean nothing.
   * hasRestroom is excluded for a different reason: its job is the confirmed-NO case that prunes
   * a pin off the map, and that belongs to the report queue in FlushPanel, where the claim
   * arrives with a reporter attached and a moderation trail. It was also never in
   * ADMIN_AMENITY_KEYS, so the panel was rendering a control the rest of the admin path did not
   * recognise. */
  const feats = [...BATHROOM_AMENITIES.filter(a => !isMultiState(a) && a.key !== 'hasRestroom'), ...STORE_FEATURES];
  const rows = feats.map(a => {
    const cur = ov[a.key] || '';
    const btn = (val, label) => `<button type="button" class="admin-am-btn" data-key="${a.key}" data-val="${val}" style="padding:3px 9px;margin-left:4px;border-radius:6px;border:1px solid ${cur===val?'#2ea1aa':'#2a2e35'};background:${cur===val?'#0e2f33':'#1b1e23'};color:#f6f8fa;font-size:12px;cursor:pointer;">${label}</button>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0;font-size:13px;color:#f6f8fa;"><span>${a.question || a.label}</span><span>${btn('yes','Yes')}${btn('no','No')}${btn('unknown','—')}</span></div>`;
  }).join('');
  // Collapsible so a long popup isn't dominated by admin controls. Open by default, and the
  // choice is remembered — mid-audit it stays open, otherwise it tucks away.
  const collapsed = localStorage.getItem('adminAmCollapsed') === '1';
  return `<div class="admin-amenity-panel" id="admin-am-${loc.id}" style="margin:8px 0;border:1px solid #2a2e35;border-radius:10px;background:#141619;overflow:hidden;">
    <button type="button" id="admin-am-head-${loc.id}" aria-expanded="${!collapsed}"
      style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px;background:transparent;border:0;font-weight:600;font-size:13px;color:#2ea1aa;cursor:pointer;text-align:left;">
      <span>Set amenities (admin) — applied live</span><span id="admin-am-arrow-${loc.id}">${collapsed ? '▸' : '▾'}</span>
    </button>
    <div id="admin-am-body-${loc.id}" style="padding:0 10px 10px;${collapsed ? 'display:none;' : ''}">
      ${rows}
      <div class="save-note" id="admin-am-note-${loc.id}" style="font-size:12px;margin-top:4px;"></div>
    </div>
  </div>`;
}

function attachAdminAmenityHandlers(loc){
  if(!isMapAdmin()) return;
  const panel = document.getElementById('admin-am-' + loc.id);
  if(!panel) return;
  const head = document.getElementById('admin-am-head-' + loc.id);
  const body = document.getElementById('admin-am-body-' + loc.id);
  const arrow = document.getElementById('admin-am-arrow-' + loc.id);
  if(head && body){
    head.addEventListener('click', () => {
      const collapse = body.style.display !== 'none';
      body.style.display = collapse ? 'none' : '';
      if(arrow) arrow.textContent = collapse ? '▸' : '▾';
      head.setAttribute('aria-expanded', String(!collapse));
      localStorage.setItem('adminAmCollapsed', collapse ? '1' : '0');
    });
  }
  panel.querySelectorAll('.admin-am-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key, val = btn.dataset.val;
      const note = document.getElementById('admin-am-note-' + loc.id);
      if(note){ note.textContent = 'Saving…'; note.style.color = ''; }
      const ok = await saveAmenityOverride(loc.id, key, val);
      if(!ok){ if(note){ note.textContent = "Couldn't save — try again."; note.style.color = '#e53935'; } return; }
      amenityOverrideCache[loc.id] = { ...(amenityOverrideCache[loc.id] || {}), [key]: val };
      loc.conf = loc.conf || {};
      if(val === 'yes') loc.conf[key] = true; else delete loc.conf[key];
      // highlight the chosen button in this row
      panel.querySelectorAll(`.admin-am-btn[data-key="${key}"]`).forEach(b => {
        const on = b.dataset.val === val;
        b.style.borderColor = on ? '#2ea1aa' : '#2a2e35';
        b.style.background  = on ? '#0e2f33' : '#1b1e23';
      });
      if(typeof refreshCommunityBlock === 'function') refreshCommunityBlock(loc);  // badge appears/disappears now
      if(note){ note.textContent = '✓ Saved — live on the map'; note.style.color = '#2e7d32'; }
    });
  });
}

function renderAmenityStepHtml(myVote, locId){
  // Compute the visit's question list once, on first render for this popup instance.
  if(locId != null && !visitQuestions[locId]){
    const loc = locationsById[locId];
    visitQuestions[locId] = loc ? pickVisitQuestions(loc, myVote) : [];
    visitCursor[locId] = 0;
  }
  const list = (locId != null && visitQuestions[locId]) || [];
  const cursor = (locId != null && visitCursor[locId]) || 0;

  if(cursor >= list.length){
    return `<div class="amenity-complete">${ico('check')} That's everything — thanks for the intel!</div>`;
  }
  const a = amenityDefFor(list[cursor]);
  if(!a){ return `<div class="amenity-complete">${ico('check')} That's everything — thanks for the intel!</div>`; }
  const states = a.states || ['unknown', 'yes', 'no'];
  const buttons = states.map(s =>
    /* Three layout options are hard to tell apart from their names alone — "Multiple private
     * restrooms" and "Multi-stall restroom" are one word different and mean opposite things.
     * The hint is what makes them distinguishable at a glance while someone is standing in the
     * doorway. Only rendered where a hint exists, so the yes/no amenities are unaffected. */
    `<button type="button" class="amenity-answer-btn ans-${s}${(a.stateHints && a.stateHints[s]) ? ' has-hint' : ''}" data-key="${a.key}" data-value="${s}">`
      + `<span class="aab-main">${amenityButtonIcon(s)} ${amenityStateLabel(a, s)}</span>`
      + ((a.stateHints && a.stateHints[s]) ? `<span class="aab-hint">${escapeHtml(a.stateHints[s])}</span>` : '')
      + `</button>`
  ).join('');
  return `<div class="amenity-progress">Question ${cursor + 1} of ${list.length}</div>
    <div class="amenity-question-label">${a.question || a.label}</div>
    <div class="amenity-answer-row">${buttons}</div>`;
}

/* ---------- Your own answers, and a way to change them ----------
 *
 * Answering an amenity used to be a one-way door. pickVisitQuestions filters out anything you
 * have personally answered, so the question never came back — and until three people agreed,
 * your answer was not displayed either. A mistaken tap was permanent and invisible, fixable
 * only in the Firestore console.
 *
 * That is also inconsistent with ratings, which show your stars filled in and let you change
 * them whenever you like. This closes the gap: what you said, shown back to you, tappable.
 *
 * Three jobs at once — correct a mistake, confirm your answer registered at all, and update a
 * place that has been renovated. */
function myAnswersHtml(loc, myVote){
  const mine = (myVote && myVote.amenities) || {};
  const mineStore = (myVote && myVote.storeFeatures) || {};
  const rows = [];
  const add = (defs, source) => defs.forEach(a => {
    const val = source[a.key];
    if(!val || val === 'unknown') return;          // "not sure" is not an answer to show back
    const label = isMultiState(a)
      ? amenityStateLabel(a, val)
      : `${a.label}: ${val === 'yes' ? 'Yes' : 'No'}`;
    rows.push(`<button type="button" class="my-answer" data-reopen="${a.key}" data-locid="${loc.id}">
      <span class="ma-what">${escapeHtml(label)}</span>
      <span class="ma-change">change</span>
    </button>`);
  });
  add(BATHROOM_AMENITIES, mine);
  add(STORE_FEATURES, mineStore);
  if(!rows.length) return '';
  return `<div class="my-answers">
    <div class="ma-head">You said</div>
    <div class="ma-rows">${rows.join('')}</div>
  </div>`;
}

/* Reopening does NOT delete anything.
 *
 * The first version cleared your stored answer immediately so the question became eligible
 * again. That was wrong in a way that only shows up on the road: ANSWERING is geofenced to a
 * few hundred metres, and clearing was not. Tap "change" at home and your answer is gone with
 * no way to replace it until you drive back — the app quietly destroyed data you could not
 * restore.
 *
 * So "change" now only marks the question as one you want asked again. Your stored answer stays
 * exactly where it is until you pick a new one, and the normal answer path overwrites it — the
 * same path, with the same geofence. Change your mind and walk away, and nothing happened.
 *
 * This is how the star ratings already behave: your stars stay filled and tapping a different
 * one replaces the value. There was no reason for amenities to be more destructive. */
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-reopen]');
  if(!btn) return;
  const loc = locationsById[btn.dataset.locid];
  if(!loc) return;
  const key = btn.dataset.reopen;
  (reopenedKeys[loc.id] = reopenedKeys[loc.id] || new Set()).add(key);
  /* Force a fresh pick so the newly-eligible key is actually offered — visitQuestions is cached
   * per location and would otherwise hold the list from before. */
  delete visitQuestions[loc.id]; delete visitCursor[loc.id];
  refreshVoteViews(loc);
  const step = document.getElementById('amenity-step-' + loc.id);
  if(step) step.scrollIntoView({ block:'nearest', behavior:'smooth' });
});

/* Every view that reads myVoteCache, redrawn together.
 *
 * There are three of them and they were being updated in three different places, which is how
 * the question and the YOU SAID list came to disagree. Adding a fourth reader means adding it
 * here, once. */
function refreshVoteViews(loc){
  if(!loc || !loc.id) return;
  const myVote = myVoteCache[loc.id] || emptyVote();
  const step = document.getElementById('amenity-step-' + loc.id);
  if(step) step.innerHTML = renderAmenityStepHtml(myVote, loc.id);
  const mine = document.getElementById('my-answers-' + loc.id);
  if(mine) mine.innerHTML = myAnswersHtml(loc, myVote);
}

function amenityEditorHtml(locId, myVote){
  return `<div class="amenities-editor">
    ${plate('Help out')}
    <div class="amenity-step" id="amenity-step-${locId}">${renderAmenityStepHtml(myVote, locId)}</div>
    <div class="save-note" id="amenities-note-${locId}"></div>
    <div id="my-answers-${locId}">${myAnswersHtml(locationsById[locId] || {id:locId}, myVote)}</div>
  </div>`;
}

// Badges for features OSM verifies but the community hasn't confirmed yet. `skip` lets the
// caller exclude a key that's already shown elsewhere (e.g. accessible has its own big badge).
function osmVerifiedBadges(loc, featureDefs, communitySummary, skip){
  const osm = (loc && loc.osm) || {};
  const conf = (loc && loc.conf) || {};
  return featureDefs.filter(a => {
    if(skip && skip.includes(a.key)) return false;
    if(!osm[a.key]) return false;
    if(conf[a.key]) return false;   // community-baked confirmation wins (shown green elsewhere)
    const x = communitySummary && communitySummary[a.key];
    const communityConfirmed = isConfirmedYes(x);   // don't duplicate a confirmed badge
    return !communityConfirmed;
  }).map(a => `<span class="feature-badge verified">${amenityAnswerIcon(a, 'yes')} ${a.label}</span>`).join('');
}

// Community-confirmed badges for a given feature list (amber ⭐). Excludes any keys in `skip`.
// Refresh the unified "What visitors say" block and collapse it when empty. Call after any
// vote save or summary load, since a new confirmation may have just crossed the threshold.
function refreshCommunityBlock(loc){
  const el = document.getElementById('community-summary-' + loc.id);
  if(!el) return;
  el.innerHTML = communitySummaryHtml(loc);
  const section = document.getElementById('community-section-' + loc.id);
  if(section) section.classList.toggle('is-empty', !communitySectionHasContent(loc));
}

function communityConfirmedBadges(loc, featureDefs, summary, skip){
  const conf = (loc && loc.conf) || {};
  return featureDefs.map(a => {
    if(skip && skip.includes(a.key)) return '';
    const x = (summary && summary[a.key]) || {yes:0,no:0};
    if(isMultiState(a)){
      // Multi-state badges name the ANSWER ("Single"), not the amenity — "Restroom setup ⭐"
      // would tell the reader nothing about which setup was confirmed. loc.conf is not consulted
      // here: it stores key -> 1 and cannot carry a state, and the offline bake deliberately
      // skips this amenity, so live votes are the only source.
      const st = confirmedState(a, x);
      if(st) return `<span class="feature-badge community">${amenityAnswerIcon(a, st)} ${escapeHtml(amenityStateLabel(a, st))} <svg class="ico ico-fill" aria-hidden="true"><use href="#i-star"></use></svg></span>`;
      /* Reported: shown, but marked as one person's word rather than a confirmation. The count
       * is included because "1 report" and "2 reports" are meaningfully different levels of
       * confidence and hiding the difference would flatten them. */
      const rep = reportedState(a, x);
      if(rep){
        const n = x[rep] || 0;
        return `<span class="feature-badge reported">${amenityAnswerIcon(a, rep)} ${escapeHtml(amenityStateLabel(a, rep))} <em>${n} report${n === 1 ? '' : 's'}</em></span>`;
      }
      return '';
    }
    if(!(isConfirmedYes(x) || conf[a.key])){
      /* A confirmed NO is a real answer and was being thrown away here — three people agreeing
       * there is no changing table produced exactly the same empty string as nobody having
       * answered at all. For a parent, "confirmed: no changing table" is the whole point of
       * checking before driving over, and the same holds for showers at a truck stop.
       *
       * Ordered after the positive checks on purpose: an admin override or a baked confirmation
       * (conf[a.key]) is authoritative and wins over community votes, so a negative can never
       * contradict one. accessible and hasRestroom never reach this branch — both are in the
       * caller's `skip` list, the first because it has its own prominent badge and the second
       * because a confirmed no prunes the pin entirely, which makes a badge on it a
       * contradiction. */
      /* A confirmed NO is only worth a badge for amenities someone would otherwise ASSUME are
       * there, or would drive over specifically hoping for. That is a short list, so it is
       * opt-in via showNegative rather than blanket.
       *
       * Showers are the case that makes the rule: almost no convenience store has them, so
       * "Showers: No" states the reader's own default assumption back at them and pushes the
       * badges that carry information further down. The same goes for EV charging and air
       * pumps. A changing table is the opposite — plausible anywhere, and a parent checks
       * before leaving rather than after arriving, which is the whole reason the negative is
       * worth as much as the positive.
       *
       * Known trade-off: at a truck stop, where showers ARE expected, a confirmed no genuinely
       * informs. Making that chain-dependent means threading the chain group through here for
       * one amenity, which is not worth it yet — revisit if truck-stop traffic warrants it. */
      if(isConfirmedNo(x) && a.showNegative){
        return `<span class="feature-badge community-no">${AMENITY_ANSWER_ICONS.no} ${escapeHtml(a.label)}: No <svg class="ico ico-fill" aria-hidden="true"><use href="#i-star"></use></svg></span>`;
      }
      /* Reported but not confirmed. Same rule as the multi-state branch above: one vote is
       * enough to show, three is still what "confirmed" means, and the badge says which.
       * Negatives follow showNegative here too — an unconfirmed "no changing table" from one
       * person is exactly the kind of claim that should be visible AND clearly provisional. */
      if(isReportedYes(x)){
        const n = x.yes || 0;
        return `<span class="feature-badge reported">${amenityAnswerIcon(a, 'yes')} ${escapeHtml(a.label)} <em>${n} report${n === 1 ? '' : 's'}</em></span>`;
      }
      if(isReportedNo(x) && a.showNegative){
        const n = x.no || 0;
        return `<span class="feature-badge reported reported-no">${AMENITY_ANSWER_ICONS.no} ${escapeHtml(a.label)}: No <em>${n} report${n === 1 ? '' : 's'}</em></span>`;
      }
      return '';
    }
    return `<span class="feature-badge community">${amenityAnswerIcon(a, 'yes')} ${a.label} <svg class="ico ico-fill" aria-hidden="true"><use href="#i-star"></use></svg></span>`;
  }).join('');
}

/* The unified "✅ Confirmed by visitors" block: bathroom + store community confirmations together
 * in one flat row (icons distinguish them; no internal split). Empty → returns '' so the whole
 * block collapses.
 *
 * Two exclusions, for different reasons:
 *   accessible  — has its own prominent badge higher up; a second one is duplication.
 *   hasRestroom — asymmetric by design. Its job is the confirmed-NO case, which prunes the pin
 *                 from the map. Confirmed YES already does its work by removing the "not listed
 *                 as having a public restroom" doubt line; a "Public restroom ⭐" badge on top of
 *                 that says nothing, since every pin here is a bathroom to begin with. */
function communitySummaryHtml(loc){
  const bSummary = amenityCache[loc.id];
  const sSummary = storeFeatureCache[loc.id];
  return communityConfirmedBadges(loc, BATHROOM_AMENITIES, bSummary, ['accessible', 'hasRestroom'])
       + communityConfirmedBadges(loc, STORE_FEATURES, sSummary);
}
function communitySectionHasContent(loc){ return communitySummaryHtml(loc) !== ''; }

/* The two READ-ONLY feature blocks, extracted so both the signed-in and signed-out popup
 * branches can render the identical markup (same element ids, so attachAmenityHandlers
 * refreshes them either way).
 *
 * These were inside the isLoggedIn() branch, which meant a logged-out visitor saw only the
 * sign-in hint — no "What visitors say", no OSM bathroom features. Since the pitch is
 * "no account needed", that is what most first-time visitors saw: changing tables and
 * restroom type were in the data and confirmed, and simply never rendered for them.
 * aggregates/ and amenityOverrides/ are both `allow read: if true`, and fetchCommunityDoc()
 * on popupopen was never auth-gated, so the data was already arriving — only the markup
 * was withheld. Writing still requires sign-in; nothing below is a write path. */
function communityBlockHtml(loc){
  return `<div class="community-section${communitySectionHasContent(loc) ? '' : ' is-empty'}" id="community-section-${loc.id}">
      ${plate('What visitors say')}
      <div class="feature-badges" id="community-summary-${loc.id}">${communitySummaryHtml(loc)}</div>
    </div>`;
}
function osmFeatureBlockHtml(loc){
  return `<div class="feature-summary osm-bathroom-section${osmBathroomHasContent(loc) ? '' : ' is-empty'}">${plate('Bathroom features')}<div class="feature-badges" id="feature-summary-${loc.id}">${amenitySummaryHtml(amenityCache[loc.id], loc)}</div></div>`;
}
/* Tips are `allow read: if true` as well. Logged-out visitors get the list without the
 * compose row — "need a key, buzzer required" is exactly the kind of thing worth seeing
 * before you drive somewhere, and it costs nothing to show. */
function tipsSectionHtml(loc, canWrite){
  return `<div class="tips-section">
      ${plate('Tips')}
      <ul class="tips-list" id="tips-list-${loc.id}"><li style="color:#999;">Loading…</li></ul>
      ${canWrite ? `<div class="tip-input-row">
        <input type="text" class="tip-input" id="tip-input-${loc.id}" maxlength="${MAX_TIP_LENGTH}" placeholder="e.g. need a key, buzzer required" />
        <button class="btn btn-amber tip-submit" id="tip-submit-${loc.id}">Add</button>
      </div>` : ''}
    </div>`;
}

function amenitySummaryHtml(summary, loc){
  // OSM-verified bathroom badges only — community confirmations now live in the unified
  // "What visitors say" block above. Same two exclusions as that block: 'accessible' has its
  // own prominent badge, and 'hasRestroom' says nothing useful in the affirmative.
  const verified = osmVerifiedBadges(loc, BATHROOM_AMENITIES, summary, ['accessible', 'hasRestroom']);
  if(!summary && !verified) return '<span class="feature-badge unconfirmed">Loading features…</span>';
  if(!verified) return '<span class="feature-badge unconfirmed">Nothing verified yet</span>';
  return verified;
}

// Same "confirmed" rule as the summary badges (at least 2 yes-votes, and more yes than no),
// specifically for wheelchair accessibility — used both for the prominent popup badge and for
// filtering the list view.
function isConfirmedAccessible(summary){
  if(!summary || !summary.accessible) return false;
  const x = summary.accessible;
  return isConfirmedYes(x);
}

// Compact head-row ♿ indicator (sits next to the chain badge / gas icon so accessibility is
// visible at a glance without scrolling to the feature badges). Mirrors accessibleBadgeHtml's
// signal priority: community confirmation (green) outranks OSM-verified (teal). Empty when unknown.
function accessIndicatorHtml(locId){
  const loc = locationsById[locId];
  if(!loc) return '';
  const summary = amenityCache[locId];
  const communityYes = (summary && isConfirmedAccessible(summary)) || (loc.conf && loc.conf.accessible);
  const osmYes = (loc.osm && loc.osm.accessible) || loc.wheelchair === 'yes' || loc.wheelchair === 'designated';
  // OSM wheelchair=limited: partially step-free (tight turns, assistance may be needed).
  // Deliberately NOT folded into "accessible" — someone who needs step-free access and finds
  // a door they can't use is worse off than someone who was told it was uncertain.
  const limited = isAccessLimited(loc);
  if(!communityYes && !osmYes && !limited) return '';
  if(!communityYes && !osmYes && limited){
    const t = 'Limited step-free access — verified';
    return `<span class="access-indicator limited" title="${t}" aria-label="${t}">♿</span>`;
  }
  const cls = communityYes ? 'access-indicator community' : 'access-indicator verified';
  const title = communityYes ? 'Wheelchair accessible — confirmed by visitors' : 'Wheelchair accessible — verified';
  return `<span class="${cls}" title="${title}" aria-label="${title}">♿</span>`;
}

// Some public restrooms (park comfort stations especially) only open for part of the year.
// Sources flag them as seasonal but almost never say WHICH months, so this is shown as a
// caveat and deliberately does NOT drive open/closed — inventing a season would be a guess.
function seasonalNoteHtml(loc){
  return (loc && loc.seasonal)
    ? '<div class="hours-line seasonal-note">⚠️ Seasonal — may be closed in winter</div>'
    : '';
}

/* Access is ONE three-state answer for every location: public, customer, or unknown.
 *
 * PUBLIC is the default and carries no flag. A convenience store, a travel plaza, a rest area —
 * you walk in. Assuming otherwise would bury 27,000 usable restrooms behind a caveat nobody
 * needs.
 *
 * CUSTOMER and UNKNOWN are the exceptions, and only those are worth surfacing:
 *   customer  the operator's data says so (metro cafes, where you buy something first)
 *   unknown   the source described this place and did NOT evidence a restroom — 353 Circle K
 *             stores whose own API lists air and ATM but omits the restroom it lists for the
 *             other 5,950, and 651 rest-area polygons and bare points with no facility tags.
 *             Those are not "we forgot to look", they are "we looked and found nothing".
 *
 * Read from wherever the source put it. metroInfo.access came from the metro imports and
 * osm.restroomUnconfirmed from the chain ones; unifying them in the DATA would mean rewriting
 * thousands of records to say what this function can derive. One reader, no migration. */
/* Attribution for the most recent rating.
 *
 * Free: lastRatedBy is written by the aggregate Cloud Function into a document the popup already
 * fetches, so no extra read. Absent on every aggregate written before that function ships, and on
 * ratings from before usernames existed — so this renders nothing rather than "by undefined".
 * Escaped because it is user-chosen text. */
function ratedByHtml(agg){
  const who = agg && typeof agg.lastRatedBy === 'string' ? agg.lastRatedBy.trim() : '';
  return who ? ` by ${escapeHtml(who.slice(0, 40))}` : '';
}

function accessState(loc){
  const mi = (loc && loc.metroInfo) || null;
  if(mi && mi.access === 'customer') return 'customer';
  if(mi && mi.access === 'public')   return 'public';
  if(mi && !mi.access)               return 'unknown';   // metro import with the tag absent
  if(loc && loc.osm && loc.osm.restroomUnconfirmed) return 'unknown';
  return 'public';
}

// Kept as a thin wrapper: Bathroom Now deprioritises unknowns rather than dropping them. The
// asymmetry matters — getting hours wrong costs a locked door, but sending someone somewhere
// they aren't welcome is worse for exactly the people who rely on this most.
function accessKnown(loc){
  return accessState(loc) !== 'unknown';
}

/* Is this a location where "is there even a restroom?" is worth asking?
 *
 * Only where the operator's own data describes the store and doesn't list a public restroom.
 * Asking it everywhere would be noise and would train people to dismiss it. Scoped to
 * osm.restroomUnconfirmed — 320 Circle K stores at present.
 *
 * Note this is a different question from access-unknown: for the OSM statewide sets a human
 * already confirmed a toilet exists, and what's missing is who may use it. */
function restroomDoubted(loc){
  if(!(loc && loc.osm && loc.osm.restroomUnconfirmed)) return false;
  /* Never ask a question the data already answers. amenitySettled() covers admin overrides and
   * community votes, but it knows nothing about the SOURCE data — so a positive claim there has
   * to be checked here. No record carries both signals today (verified: 1,032 doubted, 0 of them
   * claiming a toilet), but that is a property of the current imports rather than a rule, and the
   * next import could set both on one record. */
  if(loc.osm.restroomConfirmed) return false;                 // the operator's own data says yes
  if((loc.meta || {}).toilets === 'yes') return false;        // OSM survey says yes
  return true;
}

/* The community has said, at CONFIRM_THRESHOLD strength, that there is no public restroom here.
 * Hidden from the map and from Bathroom Now — but the record stays, so nothing is destroyed and
 * a future re-import can't resurrect it. Same shape as a confirmed-closed location. */
function isConfirmedNoRestroom(loc){
  if(!loc) return false;
  const s = amenityCache[loc.id];
  // A live confirmed YES wins over everything, so a stale baked "no" can be overturned by the
  // community without waiting for the next bake.
  if(s && isConfirmedYes(s.hasRestroom)) return false;
  if(s && isConfirmedNo(s.hasRestroom)) return true;
  // Otherwise fall back to the BAKED value. bake-confirmed.js writes loc.confNo from the vote
  // export, so this works on page load for every pin. The live cache is only populated for
  // locations whose popup has been opened — relying on it alone (the v2.6.0 bug) meant the hide
  // silently did nothing until you tapped the pin, which is the one moment it doesn't matter.
  return !!(loc.confNo && loc.confNo.hasRestroom);
}

/* Does the operator actually say there's a public restroom here?
 *
 * Circle K's API lists a services array per store, and NA_PUBLIC_RESTROOMS appears on 4,583 of
 * them and not on 320 others that DO list other services. That variation is what makes it
 * trustworthy — a flag present on every record would be a template, not a fact.
 *
 * Absence still isn't proof of absence, so `restroomUnconfirmed` never hides a pin or claims
 * there's no toilet. It only tells Bathroom Now to prefer somewhere the operator vouches for. */
function restroomUnconfirmed(loc){
  return !!(loc && loc.osm && loc.osm.restroomUnconfirmed);
}

// A location is a confident Bathroom Now recommendation when we know who may use it AND
// nobody has told us the restroom might not be there.
function goodRecommendation(loc){
  return accessKnown(loc) && !restroomUnconfirmed(loc);
}

// True when the only accessibility signal is OSM's "limited" — partial step-free access.
function isAccessLimited(loc){
  return !!(loc && ((loc.osm && loc.osm.accessibleLimited) || loc.wheelchair === 'limited'));
}

function accessibleBadgeHtml(locId){
  // Community confirmations are the strongest signal and win when present.
  const summary = amenityCache[locId];
  if(summary && isConfirmedAccessible(summary)){
    return `<div class="accessible-badge">♿ Wheelchair accessible — confirmed by visitors</div>`;
  }
  const loc = locationsById[locId];
  // Baked community confirmation (from a prior votes bake) also counts as visitor-confirmed.
  if(loc && loc.conf && loc.conf.accessible){
    return `<div class="accessible-badge">♿ Wheelchair accessible — confirmed by visitors</div>`;
  }
  // Fall back to accessibility data baked into the location files (sourced from
  // OpenStreetMap wheelchair / toilets:wheelchair tags at bake time).
  const osmAccessible = loc && ((loc.osm && loc.osm.accessible) || loc.wheelchair === 'yes' || loc.wheelchair === 'designated');
  if(osmAccessible){
    return `<div class="accessible-badge">♿ Wheelchair accessible — verified</div>`;
  }
  if(isAccessLimited(loc)){
    return `<div class="accessible-badge access-limited">♿ Limited step-free access — verified</div>`;
  }
  return '';
}

// Community data now comes from ONE aggregate-doc read per popup open (the Cloud Function
// maintains per-amenity answer tallies in aggregates/{locId}.amen). Constant cost regardless of
// how many people voted — replaces the old scan of every vote doc at the location (2 queries).
// A short TTL lets the popup's separate sub-loads (ratings, amenities, store features) share a
// single fetch; post-vote refreshes within the TTL render the optimistic local bump instead.
const communityFetchCache = {};   // locId -> { ts, promise }
const COMMUNITY_TTL_MS = 15000;
function fetchCommunityDoc(locId){
  const hit = communityFetchCache[locId];
  const now = Date.now();
  if(hit && now - hit.ts < COMMUNITY_TTL_MS) return hit.promise;
  const promise = (async () => {
    let data = {};
    try{
      const {db, doc, getDoc} = await fb();
      const snap = await getDoc(doc(db, 'aggregates', fsId(locId)));
      data = snap.exists() ? (snap.data() || {}) : {};
    }catch(e){ console.error('community doc load failed', e); }
    const amen = data.amen || {};
    const build = defs => {
      const s = {};
      defs.forEach(a => {
        const c = amen[a.key] || {};
        const cell = { yes: c.yes > 0 ? c.yes : 0, no: c.no > 0 ? c.no : 0 };
        // Multi-state amenities carry per-state counts alongside yes/no on the same cell.
        // Dropping them here was the second half of the bug: even once the function started
        // writing them, the client would have thrown them away on read.
        if(isMultiState(a)) a.states.forEach(st => {
          if(st !== 'unknown') cell[st] = c[st] > 0 ? c[st] : 0;
        });
        s[a.key] = cell;
      });
      return s;
    };
    amenityCache[locId] = build(BATHROOM_AMENITIES);
    storeFeatureCache[locId] = build(STORE_FEATURES);
    return data;
  })();
  communityFetchCache[locId] = { ts: now, promise };
  return promise;
}

async function loadAmenitySummary(locId){
  try{
    await fetchCommunityDoc(locId);
    return amenityCache[locId];
  }catch(e){ console.error('loadAmenitySummary failed', e); return null; }
}

// ---- Store features — same one-at-a-time pattern, entirely separate data (myVote.storeFeatures) ----

function renderStoreFeatureStepHtml(myVote){
  const mine = myVote.storeFeatures || {};
  const idx = STORE_FEATURES.findIndex(a => mine[a.key] === undefined);
  if(idx === -1){
    return `<div class="amenity-complete">${ico('check')} That's everything — thanks for the intel!</div>`;
  }
  const a = STORE_FEATURES[idx];
  const states = a.states || ['unknown', 'yes', 'no'];
  const buttons = states.map(s =>
    `<button type="button" class="store-feature-answer-btn" data-key="${a.key}" data-value="${s}">${amenityAnswerIcon(a, s)} ${amenityStateLabel(a, s)}</button>`
  ).join('');
  return `<div class="amenity-progress">Feature ${idx + 1} of ${STORE_FEATURES.length}</div>
    <div class="amenity-question-label">${a.question || a.label}</div>
    <div class="amenity-answer-row">${buttons}</div>`;
}

function storeFeatureEditorHtml(locId, myVote){
  return `<div class="amenities-editor">
    ${plate('Store features')}
    <div class="store-feature-step" id="store-feature-step-${locId}">${renderStoreFeatureStepHtml(myVote)}</div>
    <div class="save-note" id="store-feature-note-${locId}"></div>
  </div>`;
}

// Store features render as a compact icon row in the popup head (beside the store name) rather
// than a labelled section. Gas in particular was never votable — OSM-known, display-only — so a
// whole section for it read as clutter. Selection rule is unchanged: OSM-verified only, since
// community-confirmed features already appear in the "What visitors say" block.
// Every icon carries title + aria-label — an icon must never be the only cue.
function storeFeatureIconsHtml(loc, summary){
  const osm = (loc && loc.osm) || {};
  const conf = (loc && loc.conf) || {};
  const pill = (glyph, label) =>
    `<span class="store-icon" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" role="img">${glyph}</span>`;
  const out = [];
  if(osm.gas) out.push(pill(ico('fuel'), 'Gas station'));
  STORE_FEATURES.forEach(a => {
    if(!osm[a.key]) return;
    if(conf[a.key]) return;
    if(isConfirmedYes(summary && summary[a.key])) return;
    out.push(pill(amenityAnswerIcon(a, 'yes'), a.label + ' — verified'));
  });
  return out.join('');
}

function refreshStoreIcons(loc){
  const el = document.getElementById('store-icons-' + loc.id);
  if(el) el.innerHTML = storeFeatureIconsHtml(loc, storeFeatureCache[loc.id]);
}
// Same, for the OSM bathroom-features section. The exclusions must match amenitySummaryHtml
// exactly, or the section reports content it will not render and shows up empty.
function osmBathroomHasContent(loc){
  return osmVerifiedBadges(loc, BATHROOM_AMENITIES, amenityCache[loc.id], ['accessible', 'hasRestroom']) !== '';
}

async function loadStoreFeatureSummary(locId){
  try{
    await fetchCommunityDoc(locId);
    return storeFeatureCache[locId];
  }catch(e){ console.error('loadStoreFeatureSummary failed', e); return null; }
}


// Funny captions for each star level
const storeQuips = {
  1: ["Regret.", "Bold choice.", "Lost Cause.", "Keep driving.", "Ain't it."],
  2: ["It's open.", "Not their best work.", "Needs Improvement.", "Quick stop.", "Mid."],
  3: ["It'll do.", "Exactly as expected.", "Reliable Stop.", "Solid rest stop.", "Respectable."],
  4: ["Nice surprise.", "Pretty good.", "Local Favorite.", "One of the good ones.", "Certified good."],
  5: ["I'd come back.", "Nailed it.", "Legendary.", "Destination Stop.", "No notes."]
};
const bathroomQuips = {
  1: ["Thoughts and prayers.", "Character building.", "Hazard Zone.", "Use the woods.", "Absolutely not."],
  2: ["Proceed carefully.", "I've seen worse.", "Brave Soul.", "Bring sanitizer.", "Risky."],
  3: ["No complaints.", "Serviceable.", "Job Done.", "It'll work.", "We survived."],
  4: ["Surprisingly civilized.", "I'd recommend it.", "First Class.", "Surprisingly clean.", "Certified clean."],
  5: ["A modern masterpiece.", "Hall of Fame.", "Royal Flush.", "Worth the stop.", "Peak restroom."]
};
/* Safety reads differently from the other two: the low end is somebody telling the next person
 * not to stop, so it stays plain rather than playful. "Thoughts and prayers" is funny about a
 * dirty toilet and not about feeling unsafe. */
const safeQuips = {
  1: ["Trust your instincts.", "Time to leave.", "Didn't feel safe.", "Keep driving.", "Hard pass."],
  2: ["Stay alert.", "A little sketchy.", "Watch your surroundings.", "Not very comfortable.", "Better in daylight."],
  3: ["Felt okay.", "Average vibes.", "Nothing unusual.", "No major concerns.", "About what you'd expect."],
  4: ["Felt safe.", "Comfortable stop.", "Well maintained.", "I'd stop again.", "Good atmosphere."],
  5: ["Safe and welcoming.", "Peace of mind.", "Couldn't ask for better.", "Top-tier stop.", "Exceptionally comfortable."]
};
const QUIP_SETS = { store: storeQuips, bathroom: bathroomQuips, safe: safeQuips };
function quipFor(type, val){
  if(!val) return 'Tap to rate';
  const set = QUIP_SETS[type];
  const options = set && set[val];
  if(!options) return '';
  return options[Math.floor(Math.random() * options.length)];
}

/* ---------- Connectivity ----------
 *
 * navigator.onLine cannot be trusted on its own. It reports whether a network INTERFACE exists,
 * not whether anything answers — and on iOS it commonly stays true in airplane mode, which is
 * exactly the case this app cares about. Every offline behaviour hung off that flag and so none
 * of them fired.
 *
 * What is trustworthy is what actually happened. So connectivity is tracked from OUTCOMES: a
 * request that completed means online, a request that failed to reach the network means offline.
 * navigator.onLine is still used, but only in the direction it is reliable — when it says false
 * it is telling the truth.
 *
 * A probe runs on demand rather than on a timer, because polling a server every few seconds to
 * discover something the next real request will tell you is a battery cost for no information —
 * and battery is not free to someone stopped in a dead zone.
 */
let _netOk = true;
let _netProbeAt = 0;

function isOffline(){ return _netOk === false; }

function markNet(ok){
  if(_netOk === ok) return;
  _netOk = ok;
  syncOfflineBar();
}

/* A tiny same-origin request. HEAD on a file the service worker will not answer from cache, with
 * a cache-buster, so a success genuinely means the network replied rather than the cache did. */
async function probeNet(){
  if(navigator.onLine === false){ markNet(false); return false; }
  const now = Date.now();
  if(now - _netProbeAt < 10000) return _netOk;     // do not hammer it
  _netProbeAt = now;
  try{
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    await fetch('./manifest.webmanifest?probe=' + now, { method:'HEAD', cache:'no-store', signal: ctl.signal });
    clearTimeout(t);
    markNet(true);
    return true;
  }catch(e){ markNet(false); return false; }
}

function syncOfflineBar(){
  const bar = document.getElementById('offlineBar');
  if(!bar) return;
  bar.hidden = !isOffline();
}

/* The events are still worth listening to — 'offline' is reliable when it fires, and 'online'
 * is a good moment to check whether it is actually true. */
window.addEventListener('offline', () => markNet(false));
window.addEventListener('online', () => probeNet());
/* Coming back to the app is the other moment worth re-checking: a phone that was in a dead zone
 * has usually moved by the time it is unlocked again. */
document.addEventListener('visibilitychange', () => { if(!document.hidden) probeNet(); });
probeNet();

// Wait for the Firebase module script (loaded separately) to finish initializing
async function fb(){
  while(!window.__fb){
    await new Promise(r => setTimeout(r, 20));
  }
  return window.__fb;
}

// A per-browser anonymous ID so "your" vote can be found again on this device
function getClientId(){
  let id = localStorage.getItem('stewarts_client_id');
  if(!id){
    id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('stewarts_client_id', id);
  }
  return id;
}

// The "effective" identity used everywhere data gets saved: your logged-in account if you're
// logged in, otherwise the same anonymous per-device ID as before. This is what lets logging
// in make your ratings/name follow you across devices instead of being stuck to one phone.
function getEffectiveId(){
  return (window.__currentUser && window.__currentUser.uid) || getClientId();
}
function isLoggedIn(){
  return !!(window.__currentUser && window.__currentUser.uid);
}

// Turns a plain username into the fake email Firebase's login system needs internally —
// nobody ever sees this, it's just how we get "username + password" out of a system built
// around email addresses.
/* The name to show for the signed-in user.
 *
 * usernameToEmail() LOWERCASES what you typed to build the synthetic auth address, and every
 * reader recovered the name from that address — so "Dave" was stored as dave@stewarts-map.local
 * and came back as "dave", with the account panel then shouting it as "DAVE". Three
 * presentations, none of them what anyone chose.
 *
 * Firebase Auth has displayName for exactly this. It is set at sign-up with the original casing
 * and preferred everywhere. The email local part remains the fallback for accounts created before
 * this existed — including the first one. */
function displayNameFor(user){
  const u = user || window.__currentUser;
  if(!u) return '';
  const dn = typeof u.displayName === 'string' ? u.displayName.trim() : '';
  if(dn) return dn.slice(0, 40);
  return u.email ? String(u.email).split('@')[0].slice(0, 40) : '';
}

function usernameToEmail(username){
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  return clean + '@stewarts-map.local';
}

/* Basic shape check, mirroring looksLikeEmail() in functions/index.js. Whether an address is
 * DELIVERABLE cannot be decided here — that is what the confirmation link is for. This only
 * catches a typo before the account is created around it. */
function looksLikeEmail(e){
  return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

/* Store a recovery address and send its confirmation link.
 *
 * Shared by signup and the account panel. Returns a reason rather than throwing, because both
 * callers show it inline. */
async function saveRecoveryEmail(email){
  try{
    const {functions, httpsCallable} = await fb();
    await httpsCallable(functions, 'setRecoveryEmail')({ email });
    return { ok: true };
  }catch(e){
    const code = (e && e.code) || '';
    if(code.includes('resource-exhausted')) return { ok: false, reason: 'Just sent one — give it a minute.' };
    if(code.includes('invalid-argument')) return { ok: false, reason: "That doesn't look like an email address." };
    console.error('saveRecoveryEmail failed', code, e);
    return { ok: false, reason: "Couldn't send the confirmation email — try again later." };
  }
}

async function signUpAccount(username, password, email){
  const clean = username.trim();
  if(clean.length < 3) return { ok: false, reason: 'Username needs to be at least 3 characters.' };
  /* The input carries maxlength=20, but that is client-side and bypassable, and the votes rule
   * caps username at 40. A longer one would make EVERY rating that account ever writes fail the
   * rules with nothing shown to the user — the same silent-rejection shape as the wasHiddenGem
   * bug. Enforce it here, where it can say so. */
  if(clean.length > 20) return { ok: false, reason: 'Username can be at most 20 characters.' };
  if(!/^[a-zA-Z0-9_]+$/.test(clean)) return { ok: false, reason: 'Letters, numbers, and underscores only.' };
  if(password.length < 6) return { ok: false, reason: 'Password needs to be at least 6 characters.' };
  if(!looksLikeEmail(String(email || '').trim())) return { ok: false, reason: 'Enter an email address so you can recover this account.' };
  try{
    const {auth, createUserWithEmailAndPassword, updateProfile, db, doc, setDoc} = await fb();
    const oldAnonId = getClientId(); // capture before login changes what getEffectiveId() returns
    const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(clean), password);
    /* Preserve the casing the person actually typed. The auth address is lowercased by
     * usernameToEmail because it has to be a stable lookup key; displayName is what gets shown.
     *
     * onAuthStateChanged has already fired by this point and cached the user object with a null
     * displayName. The SDK mutates that same object, so the cache SHOULD pick it up — but the
     * first vote or activity entry a new account writes happens seconds later, and if the cache
     * were stale that entry would be stamped with the lowercase fallback and keep it forever,
     * because the name is copied at write time. Reassigning explicitly costs one line and
     * removes the question.
     *
     * Non-fatal: an account without a displayName falls back to the address, which is the old
     * behaviour rather than a broken one. */
    try{
      await updateProfile(cred.user, { displayName: clean });
      window.__currentUser = cred.user;
    }catch(e){ console.warn('could not set display name (non-fatal)', e && e.code); }
    await migrateAnonymousDataToAccount(oldAnonId, cred.user.uid, clean);

    /* Recovery email last, and non-fatal. The account exists and is usable by this point; a
     * send failure means an unconfirmed address, not a failed signup. Telling somebody their
     * signup failed after it actually succeeded would be the worse outcome. */
    const rec = await saveRecoveryEmail(String(email).trim().toLowerCase());
    /* Counted here rather than at form submit, so a failed or abandoned signup never inflates it.
     * This is the growth number the analytics board reports a daily and weekly delta on. It will
     * always sit slightly under the true total in the Firebase console — blockers and consent
     * refusals eat some — so treat it as a trend, not a headcount. */
    track('sign_up', { method: 'username', recovery_email_sent: rec.ok });
    return { ok: true, emailSent: rec.ok, emailReason: rec.reason };
  }catch(e){
    if(e.code === 'auth/email-already-in-use') return { ok: false, reason: 'That username is already taken.' };
    console.error('signUpAccount failed', e);
    return { ok: false, reason: 'Something went wrong — try again.' };
  }
}

async function logInAccount(username, password){
  const clean = username.trim();
  try{
    const {auth, signInWithEmailAndPassword} = await fb();
    const oldAnonId = getClientId();
    const cred = await signInWithEmailAndPassword(auth, usernameToEmail(clean), password);
    await migrateAnonymousDataToAccount(oldAnonId, cred.user.uid, clean);
    // Returning logins vs. new signups is the difference between an audience and a churn rate.
    track('login', { method: 'username' });
    return { ok: true };
  }catch(e){
    if(e.code === 'auth/invalid-credential' || e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password'){
      return { ok: false, reason: 'Wrong username or password.' };
    }
    console.error('logInAccount failed', e);
    return { ok: false, reason: 'Something went wrong — try again.' };
  }
}

/* Ask for a reset link.
 *
 * ALWAYS resolves ok, whatever happened server-side — no such username, no recovery address, an
 * unverified one, rate limited. Usernames appear publicly on ratings and the leaderboard, so a
 * response that distinguished "no such account" from "sent" would turn this into a way to test
 * which of those names has a live account behind it. The message below says "if" for that
 * reason, and it is not a hedge. */
async function requestPasswordReset(username){
  try{
    const {functions, httpsCallable} = await fb();
    await httpsCallable(functions, 'requestPasswordReset')({ username });
  }catch(e){
    console.error('requestPasswordReset failed', e && e.code);
  }
  return { ok: true };
}

/* What the account panel shows about recovery: none / unverified / verified.
 * One read of the person's own document, only when the panel is opened. */
async function recoveryStatus(){
  try{
    const u = window.__currentUser; if(!u) return null;
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'recovery', u.uid));
    if(!snap.exists()) return { email: null, verified: false };
    const d = snap.data() || {};
    return { email: d.email || null, verified: d.verified === true };
  }catch(e){ return null; }
}

async function logOutAccount(){
  const {auth, signOut} = await fb();
  await signOut(auth);
}

// One-time migration: folds this device's existing anonymous ratings/name into the new
// account, so signing up doesn't wipe out history you already built up on this device.
async function migrateAnonymousDataToAccount(oldAnonId, newUid, username){
  if(oldAnonId === newUid) return; // nothing to migrate (shouldn't normally happen)
  // Each phase (votes, achievements) is isolated: one failure must never abort the rest.
  // Previously a single try/catch wrapped everything, and two writes that the security
  // rules always deny — deleting old anonymous vote docs (their clientId can't match the
  // new uid) and the retired checkins collection (all writes blocked) — threw on the first
  // legacy doc and silently cancelled the achievements transfer too.
  let fbApi;
  try{ fbApi = await fb(); }catch(e){ console.error('migrate: firebase unavailable', e); return; }
  const {db, doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs} = fbApi;

  /* Copy each vote this device made over to the new account, then REMOVE the original so the
   * aggregate trigger counts one physical rating once. Leaving both docs in place inflated the
   * public average permanently — one rating became two the moment someone signed up.
   *
   * In practice this loop finds nothing today: the votes rule requires signedIn() via
   * ownedByCaller() AND pins the doc id to request.auth.uid, so a vote keyed to a device id can
   * never have been created. The copy-and-delete is here so that if anonymous rating is ever
   * enabled, the migration is correct from the first day rather than quietly double-counting.
   *
   * Delete only AFTER a confirmed copy, and only per-document, so a failure can never destroy a
   * rating it did not successfully move. A delete denied by rules (the caller is now the new uid,
   * while the old doc's clientId is the device id) is logged and skipped, not treated as fatal. */
  try{
    const votesSnap = await getDocs(query(collection(db, 'votes'), where('clientId', '==', oldAnonId)));
    let copied = 0, removed = 0;
    for(const voteDoc of votesSnap.docs){
      try{
        const data = voteDoc.data();
        const locId = data.locId;
        if(!locId) continue;
        await setDoc(doc(db, 'votes', fsId(locId) + '_' + newUid), { ...data, clientId: newUid }, { merge: true });
        copied++;
        try{
          await deleteDoc(voteDoc.ref);
          removed++;
        }catch(delErr){
          // The copy succeeded, so no rating is lost — but both docs now exist and the trigger
          // will count both. Surfaced loudly because it is the exact double-count this guards.
          console.warn('migrate: original vote could not be removed — aggregate may double-count',
                       voteDoc.id, delErr && delErr.code);
        }
      }catch(e){ console.warn('migrate: vote copy skipped', voteDoc.id, e && e.code); }
    }
    if(copied) console.log('migrate: ' + copied + ' vote(s) copied, ' + removed + ' original(s) removed');
  }catch(e){
    /* Expected now, and not an error. `votes` reads are owner-scoped, and this query filters by a
     * DEVICE id rather than the caller's uid, so it is not provably within the rule and Firestore
     * denies the list. That is fine: the create rule requires signedIn() and pins the doc id to
     * request.auth.uid, so a vote keyed to a device id cannot exist to be migrated. Logged at
     * debug volume so it does not read as a failure on every signup. */
    if(e && e.code === 'permission-denied') console.log('migrate: no device-scoped votes to migrate (expected)');
    else console.error('migrate: votes phase failed (continuing)', e);
  }

  // (The old check-ins migration was removed: the checkins collection is retired and its
  // rules block all writes, so the copy could never succeed — it only threw and aborted.)

  // Carry over any achievement progress already earned on this device, merging into
  // whatever (if anything) the new account already has rather than overwriting it.
  try{
    const oldAchievementsSnap = await getDoc(doc(db, 'achievements', oldAnonId));
    if(oldAchievementsSnap.exists()){
      const oldAchievements = oldAchievementsSnap.data().achievements || {};
      const newAchievementsSnap = await getDoc(doc(db, 'achievements', newUid));
      const newAchievements = newAchievementsSnap.exists() ? (newAchievementsSnap.data().achievements || {}) : {};
      const merged = { ...oldAchievements };
      // Anything the new account already unlocked takes priority over the old device's record
      Object.keys(newAchievements).forEach(k => {
        if(newAchievements[k] && newAchievements[k].unlocked) merged[k] = newAchievements[k];
      });
      await setDoc(doc(db, 'achievements', newUid), { achievements: merged }, { merge: true });
      // Best-effort cleanup of the old anonymous doc; the rules only allow deleting your
      // own uid's doc, so this is expected to fail for device-id docs — that's fine.
      try{ await deleteDoc(doc(db, 'achievements', oldAnonId)); }catch(e){}
    }
  }catch(e){ console.error('migrate: achievements phase failed (continuing)', e); }
}

// Checked once per page load — if a moderator blocked this device in FlushPanel, further ratings/tips are refused
let deviceIsBlocked = false;
async function checkIfBlocked(){
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'blockedDevices', getEffectiveId()));
    deviceIsBlocked = snap.exists();
  }catch(e){
    deviceIsBlocked = false; // fail open — don't block anyone due to a network hiccup
  }
}
checkIfBlocked();
// Firebase Auth resolves whether you're logged in asynchronously — if it turns out you WERE
// logged in (session remembered from before), re-check/reload anything identity-dependent
// that may have already run against the wrong (anonymous) fallback ID.
// Admin-awareness for the map. admins/{uid} is readable ONLY by admins (per the rules), so a
// successful read means you're an admin; a denied read (thrown) means you're not. This lets the
// map show admin-only affordances. Authority itself is still enforced server-side, never here.
window.__isAdmin = false;
async function refreshAdminFlag(){
  window.__isAdmin = false;
  const u = window.__currentUser;
  if(!u || !u.uid) return;
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'admins', u.uid));
    window.__isAdmin = snap.exists() && snap.data().enabled !== false;
  }catch(e){ window.__isAdmin = false; }
}
function isMapAdmin(){ return !!window.__isAdmin; }

window.addEventListener('authStateReady', () => {
  checkIfBlocked();
  refreshAdminFlag();
  if(typeof loadAllRatings === 'function') loadAllRatings();
  if(typeof updateAccountUI === 'function') updateAccountUI();
  if(typeof loadTravelModeFromAccount === 'function') loadTravelModeFromAccount();
  // Same moment, same precedence: a synced preference wins over whatever this device had.
  if(typeof loadStripPicksFromAccount === 'function') loadStripPicksFromAccount();
});

// Shared (public) aggregate — visible to everyone who opens this map
async function loadAggregate(id){
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'aggregates', fsId(id)));
    if(!snap.exists()) return emptyAgg();
    return { ...emptyAgg(), ...snap.data() };
  }catch(e){
    console.error('load agg failed', e);
    return emptyAgg();
  }
}

// Atomically nudge the shared counters by a delta — safe even if others are rating at the same time
// Personal record of your own vote (per-account if logged in, per-device otherwise)
async function loadMyVote(id){
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'votes', fsId(id) + '_' + getEffectiveId()));
    if(!snap.exists()) return emptyVote();
    return { ...emptyVote(), ...snap.data() };
  }catch(e){
    console.error('loadMyVote failed', id, e && (e.code || e.message));
    return emptyVote();
  }
}
/* What the users/{uid} mirror actually needs to store.
 *
 * The mirror existed to make loadAllRatings one read instead of a query. It was storing the WHOLE
 * vote payload, which repeats four fields in every single entry:
 *   clientId     identical in all of them — it is the document owner
 *   locId        it IS the map key
 *   username     identical in all of them
 *   lastUpdated  no reader ever looks at it
 *
 * Dropping them cuts an entry by about 36%, and the document is rewritten WHOLE on every rating,
 * so this reduces the write cost of every future rating too — not just the eventual ceiling.
 *
 * Consumers, checked: loadAllRatings spreads the entry over emptyVote() and so needs store,
 * bathroom, amenities, storeFeatures and amenityMeta; computeAchievementStats reads ratedAt and
 * wasHiddenGem. Nothing reads the four dropped fields from here. */
function mirrorEntry(payload){
  const { clientId, locId, username, lastUpdated, ...keep } = payload || {};
  return keep;
}

/* Past this many rated locations, stop mirroring rather than fail.
 *
 * A Firestore document is capped at 1 MiB. At the trimmed size that is roughly 3,900 locations —
 * far off for one person, but the failure mode matters: the write starts throwing, the catch
 * swallows it, and the mirror silently stops updating while still being READ, so it would serve
 * a stale ratings map forever. Stopping deliberately falls back to the per-vote query, which is
 * slower and correct. */
const MIRROR_MAX_LOCATIONS = 2500;

let lastSaveError = null;   // set by saveMyVote on failure; read by saveFailureNote
async function saveMyVote(id, data){
  lastSaveError = null;
  try{
    const {db, doc, setDoc} = await fb();
    const clientId = getEffectiveId();
    const existing = myVoteCache[id] || {};
    const payload = { ...data, clientId, locId: id, lastUpdated: Date.now() };
    // Username on the vote lets the leaderboard Cloud Function credit ratings to a display name
    // without a separate lookup. Only logged-in users can rate, so this is always present.
    // Sliced to 40 to match the votes rule. An account created before the length check above
    // could otherwise have every rating rejected, silently.
    const uname = displayNameFor();
    if(uname) payload.username = uname;
    // First bathroom rating gets an immutable ratedAt — drives the time-based achievements.
    if(data.bathroom > 0 && !existing.ratedAt){
      payload.ratedAt = Date.now();
      if(myVoteCache[id]) myVoteCache[id].ratedAt = payload.ratedAt;
    }
    markNet(true);   // it landed, so the connection is real
    await setDoc(doc(db, 'votes', fsId(id) + '_' + clientId), payload, { merge: true });
    // Mirror this rating into the user's OWN profile doc (users/{uid}) so the Passport and the
    // whole "my ratings" load cost ONE read no matter how many ratings they have. The votes doc
    // above stays the source of truth for the aggregate Cloud Function. Logged-in only (the rules
    // require it, and only logged-in users can rate). Non-critical: if this write is ever denied
    // (e.g. rules not deployed yet) the app just falls back to the per-vote query on load.
    if(isLoggedIn()){
      try{
        await setDoc(doc(db, 'users', clientId),
          { uid: clientId, username: uname || '', lastUpdated: Date.now(),
            ratings: { [id]: mirrorEntry(payload) } },
          { merge: true });
      }catch(e){ /* non-critical */ }
    }
    return true;
  }catch(e){
    /* Log it. This catch used to discard the error, which is why a rules rejection was invisible:
     * the UI said "Save failed" and the console said nothing. wasHiddenGem was missing from the
     * votes allowlist for weeks and every first-ever rating at a fresh location was being denied
     * with a permission-denied nobody could see. A rejected write is not routine. */
    console.error('saveMyVote failed', id, e && (e.code || e.message), e);
    /* A write that could not reach Firestore is the most reliable offline signal there is —
     * better than any probe, because it is the actual thing the person was trying to do.
     * 'unavailable' is Firestore's code for "no connection"; a rules rejection is not. */
    if(e && /unavailable|deadline|network/i.test(e.code || e.message || '')) markNet(false);
    else if(e && e.code === 'permission-denied') markNet(true);   // reached the server, was refused
    /* Kept so the caller can say WHY. saveMyVote returns a boolean by design — every call site
     * only cares whether to roll back — but the popup message should distinguish "the server
     * refused this value" from "you are offline", and those are the same boolean. */
    lastSaveError = e;
    return false;
  }
}

// Short community tips ("need a key", "buzzer required", etc.) — shared, max 50 chars each
const MAX_TIP_LENGTH = 50;
/* Tips live in tips/{locId}/entries/{entryId}, one document per tip, owned by its author.
 *
 * They used to be a single shared `tips` string array per location, which could not be secured:
 * Firestore rules cannot iterate a list, so append-only was approximated by comparing SIZE, and
 * any signed-in user could rewrite or reorder every existing tip as long as the array did not
 * shrink. Per-document ownership makes that impossible.
 *
 * Reads cover BOTH shapes so tips written under the old one keep showing without a migration
 * step. The legacy array is now admin-write-only, so it can only shrink from here; once it is
 * confirmed empty the legacy read below can go, saving one read per popup. */
async function loadTips(id){
  const out = [];
  const {db, doc, getDoc, collection, getDocs} = await fb();
  // legacy: the shared array, if this location still has one
  try{
    const snap = await getDoc(doc(db, 'tips', fsId(id)));
    if(snap.exists()){
      (snap.data().tips || []).forEach(t => {
        if(typeof t === 'string' && t) out.push({ text: t, ts: 0 });
      });
    }
  }catch(e){ console.error('loadTips legacy failed', id, e && (e.code || e.message)); }
  // current: one document per tip
  try{
    const snap = await getDocs(collection(db, 'tips', fsId(id), 'entries'));
    snap.forEach(d => {
      const r = d.data();
      if(r && typeof r.text === 'string' && r.text) out.push({ text: r.text, ts: r.ts || 0, id: d.id });
    });
  }catch(e){ console.error('loadTips entries failed', id, e && (e.code || e.message)); }
  // Oldest first so the newest sit at the bottom, as before. Legacy entries carry ts 0 and
  // therefore stay above anything written since the change, which is the right order for them.
  out.sort((a, b) => a.ts - b.ts);
  return out.slice(-8).map(t => t.text);   // show up to the 8 most recent
}
async function addTip(id, text){
  try{
    const {db, collection, addDoc} = await fb();
    const uid = (window.__currentUser && window.__currentUser.uid) || null;
    if(!uid) return false;                 // the rules require an owner; fail rather than 403
    await addDoc(collection(db, 'tips', fsId(id), 'entries'), {
      text, uid, ts: Date.now()
    });
    logActivity('tip', { locId: id, text });
    markTipWritten(id);
    return true;
  }catch(e){
    console.error('addTip failed', id, e && (e.code || e.message));
    return false;
  }
}

// ---- Community hours reporting -------------------------------------------------
// Reduce a user-entered window to the app's canonical form ("24" or "HHMM-HHMM"). Mirrors the
// server-side canonOne in the recomputeHourStatus Cloud Function so honest reports agree exactly.
// Overnight (close earlier than open) stays a single entry, e.g. "2200-0200".
function canonHrsOne(str){
  if(typeof str !== 'string') return null;
  const t = str.trim();
  if(/^(24|24\/7|24h)$/i.test(t)) return '24';
  const m = t.match(/^(\d{1,2}):?(\d{2})\s*-\s*(\d{1,2}):?(\d{2})$/);
  if(!m) return null;
  let o = String(+m[1]).padStart(2,'0') + m[2];
  let c = String(+m[3]).padStart(2,'0') + m[4];
  /* Valid clock times only. The old pattern ([01]\d|2[0-4])[0-5]\d also accepted 2401-2459,
   * which are not times — 2400 is the single legal "24" value and means midnight. A community
   * report of "24:30" would have canonicalised cleanly and then been compared against a real
   * clock by isLocationOpenNow, which reads the first two digits as the hour: 24:30 parses as
   * 2430, so a store would have looked closed from 23:59 until the following midnight. */
  const VALID_HHMM = /^(([01]\d|2[0-3])[0-5]\d|2400)$/;
  if(!VALID_HHMM.test(o) || !VALID_HHMM.test(c)) return null;
  if(c === '0000') c = '2400';
  if(o === '0000' && c === '2400') return '24';   // full midnight-to-midnight span
  return o === c ? '24' : o + '-' + c;
}
// Write the caller's own hours report. Doc id = uid enforces one report per user per store; the
// recomputeHourStatus Cloud Function turns two agreeing eligible reports into verified hours.
// Fields are exactly the five the security rules allow — nothing else.
// Half-hour dropdown options (00 and 30 only) — reliable on iOS where <input type=time step>
// is ignored. value is 24h "HH:MM" so canonHrsOne parses it unchanged; label is 12-hour.
function halfHourOptions(sel){
  let out = '<option value="">--</option>';
  for(let mins = 0; mins < 24*60; mins += 30){
    const h = Math.floor(mins/60), m = mins%60;
    const val = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
    const h12 = ((h + 11) % 12) + 1, period = h < 12 ? 'AM' : 'PM';
    const label = h12 + ':' + String(m).padStart(2,'0') + ' ' + period;
    out += `<option value="${val}"${val === sel ? ' selected' : ''}>${label}</option>`;
  }
  return out;
}
async function saveHoursReport(locId, value, kind){
  if(!isLoggedIn()) return false;
  try{
    const {db, doc, setDoc} = await fb();
    const uid = window.__currentUser.uid;
    // Location ids can contain '/' (OSM ids like way/123) which is illegal in a Firestore doc
    // path, so slug it to '__' here. fetch-and-bake-hours reverses it when matching records.
    const safeId = fsId(locId);
    await setDoc(doc(db, 'hourReports', safeId, 'submissions', uid),
      { uid, value, kind, submittedAt: Date.now(), schemaVersion: 1 });
    markHoursReported(locId);
    return true;
  }catch(e){ return false; }
}
// Track the distinct stores this device has reported hours for — feeds the Hours Hero achievement
// (client-trusted, like the other achievement stats).
/* Tips you have written, kept the same way hours reported already are: a local set of location
 * ids, deduped so writing three tips at one stop counts once.
 *
 * Local rather than a Firestore query on purpose — the alternative is reading every tip entry
 * you own across 84,000 locations to display one number in a footer, and the tips collection has
 * no per-user index. This mirrors how every other contribution stat in the app is derived, which
 * also means it carries the same caveat: it is per-device until an account syncs it. */
function markTipWritten(locId){
  try{
    const k = 'br_tips_written';
    const set = new Set(JSON.parse(localStorage.getItem(k) || '[]'));
    set.add(locId);
    localStorage.setItem(k, JSON.stringify([...set]));
  }catch(e){}
}
function countTipsWritten(){
  try{ return new Set(JSON.parse(localStorage.getItem('br_tips_written') || '[]')).size; }
  catch(e){ return 0; }
}

/* Everything you have done to FIX the map, as one running total: hours reported, problems
 * flagged, and locations added. Three separate stores because each was built for its own
 * purpose; summed here because to a reader they are one thing — corrections made. */
function countImprovements(){
  const size = (key) => { try{ return new Set(JSON.parse(localStorage.getItem(key) || '[]')).size; }catch(e){ return 0; } };
  /* br_reports_made, not reportedLocations. The latter is the open-report UI hint and now
   * expires after 30 days; reading it here would make the footer's IMPROVE total shrink over
   * time for someone who had done nothing at all.
   *
   * Anyone upgrading has a populated reportedLocations and an empty lifetime store, so the
   * lifetime store is seeded from it once rather than starting everyone back at zero. */
  seedLifetimeReports();
  return size('br_hours_reported') + size('br_reports_made') + size('br_locations_added');
}

/* One-time migration for anyone who reported before the lifetime store existed. Keyed like the
 * schema purge above so it runs once, not on every load. */
function seedLifetimeReports(){
  try{
    if(localStorage.getItem('br_reports_seeded') === '1') return;
    const raw = JSON.parse(localStorage.getItem(REPORTED_KEY) || '{}');
    const ids = Array.isArray(raw) ? raw : Object.keys(raw);
    if(ids.length){
      const set = new Set(JSON.parse(localStorage.getItem('br_reports_made') || '[]'));
      ids.forEach(id => set.add(id));
      localStorage.setItem('br_reports_made', JSON.stringify([...set]));
    }
    localStorage.setItem('br_reports_seeded', '1');
  }catch(e){}
}

function markLocationAdded(locId){
  try{
    const k = 'br_locations_added';
    const set = new Set(JSON.parse(localStorage.getItem(k) || '[]'));
    set.add(locId || ('pending-' + Date.now()));
    localStorage.setItem(k, JSON.stringify([...set]));
  }catch(e){}
}

function markHoursReported(locId){
  try{
    const k = 'br_hours_reported';
    const set = new Set(JSON.parse(localStorage.getItem(k) || '[]'));
    set.add(locId);
    localStorage.setItem(k, JSON.stringify([...set]));
  }catch(e){}
}

// Weekly recap — lightweight activity log, just enough to show "X new this week"
/* The activity log carries the rater's handle so the header ticker can credit them without a
 * second read. It is the same chosen handle the vote carries, not an email — sign-up converts a
 * handle to a synthetic @stewarts-map.local address purely because Firebase Auth wants an email
 * format. Optional: an entry written without one still validates and simply goes uncredited. */
async function logActivity(type, extra){
  try{
    const {db, collection, addDoc} = await fb();
    const uname = displayNameFor();
    await addDoc(collection(db, 'activity'), {
      type, ts: Date.now(), ...(extra || {}), ...(uname ? { username: uname } : {})
    });
  }catch(e){
    // non-critical — recap will just undercount slightly if this fails
  }
}

async function loadWeeklyRecap(){
  try{
    const {db, collection, query, where, getDocs, doc, getDoc} = await fb();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const q = query(collection(db, 'activity'), where('ts', '>=', cutoff));
    const snap = await getDocs(q);

    // Live-verify each entry against the actual current votes/tips data, rather than
    // trusting the activity log's raw count — this way, if a review or tip gets deleted
    // (individually, or via a location reset), it stops counting immediately instead of
    // needing an admin to run a separate cleanup step.
    const checks = [];
    snap.forEach(d => {
      const item = d.data();
      if(item.deleted === true) return;
      if(item.type === 'rating' && item.sourceId){
        /* Trusted without re-reading the vote. That read required permission to see OTHER
         * people's vote documents, and a vote carries the raw uid, the location and the
         * timestamp — so a publicly readable `votes` collection let anyone reconstruct where a
         * named person had been. The collection is now owner-only, and recomputeBathroomAggregate
         * deletes the activity entry when its vote is deleted, so the log stays honest without
         * every client being able to audit it. */
        checks.push(Promise.resolve('rating'));
      } else if(item.type === 'tip' && item.locId && typeof item.text === 'string'){
        /* Trusted, like the rating branch above.
         *
         * This used to re-read tips/{locId} and look for the text in the `tips` array — which
         * stopped working the moment RB-02 moved tips into a per-entry subcollection: a new tip
         * is not in the legacy array, so every one of them failed the check and would have
         * counted as zero. Reading the subcollection instead would be a second read PER ENTRY,
         * which is what got this feature disabled in the first place.
         *
         * Instead the log is kept honest at the point of deletion: FlushPanel removes the
         * matching activity entry when an admin removes a tip, and the aggregate function does
         * the same when a vote is deleted. One query for the week, no per-entry reads. */
        checks.push(Promise.resolve('tip'));
      }
      // Entries missing the fields needed to verify them (e.g. logged before this check
      // existed) are silently skipped rather than counted as either — safer than risking
      // a stale/incorrect count.
    });

    const results = await Promise.all(checks);
    let ratings = 0, tips = 0;
    results.forEach(r => { if(r === 'rating') ratings++; else if(r === 'tip') tips++; });

    const el = document.getElementById('weeklyRecap');
    if(el){
      if(ratings === 0 && tips === 0){
        el.textContent = '';
      } else {
        el.textContent = `This week: ${ratings} new rating${ratings===1?'':'s'}, ${tips} new tip${tips===1?'':'s'}`;
      }
      refreshStatTicker();
    }
  }catch(e){
    // silently skip — recap is a nice-to-have, not critical
  }
  map.invalidateSize(); // header height may have just changed
}

// The rating section content. In the OOO HARD phase the star rating is suppressed entirely and
// replaced by the ⚠️ status + "It's working now" button. In soft/none phases the normal rating
// shows; a quiet "Report out of order" link sits under the stars (soft phase also shows an FYI).
/* ============================================================================
 *  Rating dimensions — one control, asked one at a time
 * ============================================================================
 * Three separate star rows would be three things to ignore. Instead the existing rating block
 * cycles: it asks whichever dimension this person has not answered here yet, with Skip to move
 * on. Someone who stops three times answers all three and never sees a form.
 *
 * There is deliberately no separate cleanliness question. The overall bathroom rating already
 * IS the cleanliness signal — its own quips say "Bring sanitizer" and "Certified clean" — so a
 * second question would collect the same judgement twice and make both weaker by splitting the
 * votes between them.
 *
 * What a split would have bought is decay: overall never goes stale, cleanliness does. That is
 * solved instead by giving the overall rating an AGE, using the bathroomRecent window the
 * aggregate already writes. Same honesty, one fewer thing to ask.
 *
 * Order: overall first because it is the number the app has always collected and the one most
 * people will give; safe second because it changes slowly and one answer lasts.
 */
const RATING_DIMS = [
  { key:'bathroom', plate:'Rate this bathroom', q:'How would you rate it overall?' },
  { key:'safe',     plate:'Did you feel safe?', q:'Lighting, the walk to it, who else was around.' },
];

/* Which question to show. The first unanswered one, or — once all three are answered — the
 * overall row as it has always looked, because at that point there is nothing to ask and a
 * cycling control with nothing left to cycle to is just confusing. */
/* Which question is on screen, per location, for this session.
 *
 * This used to be derived — "the first one you have not answered" — which is right for the
 * first look and wrong the moment someone wants to go BACK. Swiping between the two questions
 * only makes sense if the block remembers where you are, so the view is now explicit state and
 * the derivation is just its starting value. */
const ratingView = {};
function ratingDimIndex(loc, myVote){
  if(ratingView[loc.id] != null) return ratingView[loc.id];
  const skipped = ratingSkips[loc.id] || {};
  const i = RATING_DIMS.findIndex(d => !myVote[d.key] && !skipped[d.key]);
  return i < 0 ? 0 : i;
}
function ratingDimFor(loc, myVote){ return RATING_DIMS[ratingDimIndex(loc, myVote)]; }

/* Move to another question. Wraps, because with two of them "next" and "previous" are the same
 * gesture and stopping at an end would make the second swipe feel broken. */
function ratingGoTo(loc, i){
  const n = RATING_DIMS.length;
  ratingView[loc.id] = ((i % n) + n) % n;
  refreshRatingSection(loc);
}

/* Skips are per-location and per-session only, never persisted: someone who skips "did you feel
 * safe" today should be asked again next month, because the answer may have changed and because
 * a permanent skip is a decision nobody knowingly made. */
const ratingSkips = {};

function ratingSectionInnerHtml(loc, agg, myVote){
  const status = oooStatus(oooCache[loc.id]);
  if(status.phase === 'hard'){
    return oooHardHtml(loc, status);
  }
  const softNote = status.phase === 'soft'
    ? `<div class="ooo-soft-note">${ico('warning')} Reported out of order ${relativeTimeFromNow(status.since)} — might be working now.</div>`
    : '';
  const dim = ratingDimFor(loc, myVote);
  const k = dim.key;
  const answered = RATING_DIMS.filter(d => myVote[d.key]).length;
  /* The score line only makes sense for a dimension that HAS a score. Overall always does;
   * clean and safe show their own average once anyone has answered, and their count, so the
   * number on screen is never detached from how many people stand behind it. */
  const sum = agg[k + 'Sum'] || 0, count = agg[k + 'Count'] || 0;
  /* "No ratings yet" is only true if nobody has rated — including you.
   *
   * Offline, your own vote comes from Firestore's cache while the community aggregate often does
   * not, so the card claimed nobody had rated while showing your four filled stars directly
   * underneath. Saying the count is unknown is honest; saying it is zero is not. */
  const mineHere = myVote[k] > 0;
  const scoreLine = count
    ? `<div class="rating-score-line"><span class="rating-score">${avgStr(sum, count)}★</span> ${ratingConfidenceHtml(count)}</div>`
    : `<div class="rating-score-line rating-score-none">${
        mineHere ? 'Your rating' + (isOffline() ? ' \u00b7 totals unavailable offline' : '')
                 : (k === 'bathroom' ? 'No ratings yet' : 'Nobody has answered this yet')}</div>`;
  /* Skip is only offered while there is somewhere to skip TO. On the last unanswered dimension
   * it would be a button that appears to do nothing. */
  const remaining = RATING_DIMS.filter(d => !myVote[d.key] && !(ratingSkips[loc.id] || {})[d.key]).length;
  /* Declared BEFORE anything that reads it.
   *
   * This sat four lines below the skip button that uses it, and `const` has a temporal dead
   * zone — so ratingSectionInnerHtml threw on every single call, which meant every popup on the
   * map failed to render. `node --check` cannot see it (the syntax is valid) and neither can a
   * grep for the right patterns, because every pattern WAS right; only the order was wrong. */
  const idx = ratingDimIndex(loc, myVote);
  /* Shown whenever there is another question to move to, answered or not — it is now a
   * navigation control, not an escape hatch, so hiding it once everything is answered would
   * strand someone on whichever question they happened to land on. */
  const skipBtn = RATING_DIMS.length > 1
    ? `<button type="button" class="rate-skip" data-rate-go="${idx + 1}" data-locid="${loc.id}">${
        myVote[k] ? RATING_DIMS[(idx + 1) % RATING_DIMS.length].plate : 'Skip'} &rsaquo;</button>`
    : '';
  /* The dots do three jobs: show how many questions there are, show which one you are on, and
   * act as the discoverable version of the swipe. A gesture with no visible control is a
   * feature only the person who built it knows about. */
  const progress = `<span class="rate-progress">${
    RATING_DIMS.map((d, i) => `<button type="button" class="${i === idx ? 'here' : ''}${myVote[d.key] ? ' on' : ''}"`
      + ` data-rate-go="${i}" data-locid="${loc.id}"`
      + ` aria-label="${escapeHtml(d.plate)}${myVote[d.key] ? ', answered' : ''}"`
      + ` aria-current="${i === idx}"></button>`).join('')}</span>`;

  return `${plate(dim.plate)}
      <div class="rate-head">${progress}${skipBtn}</div>
      ${scoreLine}
      <div class="rate-stack" id="ratestack-${k}-${loc.id}" data-rate-swipe="${loc.id}">
        ${starsHtml(loc.id, k, myVote[k])}
        <div class="star-quip" id="quip-${k}-${loc.id}">${myVote[k] ? quipFor(k, myVote[k]) : escapeHtml(dim.q)}</div>
        <div class="rate-flash" id="flash-${k}-${loc.id}" aria-live="polite"></div>
      </div>
      <div class="save-note" id="note-${k}-${loc.id}"></div>
      ${softNote}
      <button type="button" class="ooo-report-link" id="ooo-report-${loc.id}">${ico('warning')} Report out of order</button>`;
}

// The hard-phase readout: no stars, a clear notice, and an "It's working now" clear button. A
// re-report ("still broken") button is offered too (GPS-gated) so persistent outages escalate.
function oooHardHtml(loc, status){
  return `<div class="ooo-hard">
      <div class="ooo-hard-title">${ico('warning')} Reported out of order</div>
      <div class="ooo-hard-sub">Reported ${relativeTimeFromNow(status.since)}. Rating hidden until it's confirmed working.</div>
      <button type="button" class="btn btn-primary ooo-working-btn" id="ooo-working-${loc.id}">✓ It's working now</button>
      <button type="button" class="ooo-report-link" id="ooo-stillbroken-${loc.id}">Still broken — report again</button>
      <div class="save-note" id="ooo-note-${loc.id}"></div>
    </div>`;
}

/* The "can I actually use this?" answer.
 *
 * Only the exceptions get a badge. Public is the default for every location, and stamping
 * "✅ Public restroom" on 27,000 pins would turn the one line that matters into wallpaper —
 * a badge everything carries tells you nothing.
 *
 * `force` keeps the metro popup's existing behaviour, where access leads the card and the
 * positive case is worth stating because those chains vary. */
function accessBadge(loc, force){
  const a = accessState(loc);
  if(a === 'customer') return `<div class="access-badge access-customer">${ico('lock')} Customers only</div>`;
  if(a === 'unknown'){
    /* THREE unknowns, and wording them the same would misinform in two directions.
     *
     * 1. Metro entry with no access tag — a human confirmed a toilet EXISTS; what's missing is
     *    who may use it. Calling that "unconfirmed" would be wrong about a demonstrably real
     *    civic toilet.
     *
     * 2. A STORE the source described without listing a restroom — 353 Circle Ks whose own API
     *    lists air and ATM but omits the restroom it lists for the other 5,950. A staffed
     *    convenience store almost certainly has one, so lead optimistic and let a visitor settle
     *    it. "Probably" is honest here.
     *
     * 3. A rest area that is a bare OSM point, an untagged polygon, or a picnic area — 671 of
     *    them. "Probably" would be a lie: plenty are a pull-off with a bench and a bin. Someone
     *    leaving the interstate on that promise is the exact failure this app exists to prevent,
     *    so this one stays hedged. */
    /* Facility hedge FIRST — the metroInfo early-return below it made this dead code for the
     * nationwide set, whose records all carry metroInfo.
     *
     * Scoped to REST AREAS, because 'polygon' means opposite things in the two datasets that
     * use it. For a rest area it marks an untagged polygon that may be a pull-off with a bench
     * — doubt. For a nationwide public restroom it marks a drawn toilet BUILDING — a way tagged
     * amenity=toilets, which is stronger evidence than a bare node, not weaker. Hedging those
     * 30,000 records with "may be a pull-off only" would have cast doubt on exactly the
     * best-mapped entries. 'portable' is honest for any dataset: a chemical unit is a chemical
     * unit wherever it stands. */
    const facility = (loc && loc.meta && loc.meta.facility) || '';
    if(loc && loc.chain === 'restarea'
       && (facility === 'bare' || facility === 'polygon' || facility === 'picnic'))
      return `<div class="access-badge access-unknown">${ico('help')} Unconfirmed — may be a pull-off only</div>`;
    if(facility === 'portable')
      return `<div class="access-badge access-unknown">${ico('help')} Portable unit — basic facilities</div>`;
    if(loc && loc.metroInfo)
      return `<div class="access-badge access-unknown">${ico('help')} Access unknown</div>`;
    return `<div class="access-badge access-unknown">${ico('help')} Probably — nobody's confirmed yet</div>`;
  }
  return force ? `<div class="access-badge access-public">${ico('check')} Public restroom</div>` : '';
}
function metroAccessBadge(loc){ return accessBadge(loc, true); }

// Metro (city) popup — for non-gas-station locations. Leads with access, shows accessibility and
// hours (hours are DISPLAYED as text, never computed into an open/closed status, since OSM hours
// aren't in our parseable format). Reuses the same element IDs as the pit-stop popup so the shared
// directions / share / report / rating / tip handlers attach unchanged. Store-amenity sections are
// omitted (there's no convenience store); their attach handlers no-op safely via safeAttach().
/* ============================================================================
 *  Answer strip — the facts that decide the stop, above the scroll line
 * ============================================================================
 * Everything that answers "should I stop here" used to sit below the fold of a popup that gives
 * no indication there is anything to scroll to. Adding more sections made that worse. This is
 * one pinned row directly under the name: someone who never scrolls still gets an answer.
 *
 * ONE KIND OF FACT PER CELL, and every cell names its own dimension. An earlier draft mixed a
 * rating, a count and a yes/no in one row with the labels carrying recency instead of the
 * subject — "OK" with nothing to attach it to. The label is the dimension; the value is the
 * answer; anything else goes in the badge rows below.
 *
 * Cleanliness and Feels safe are deliberately absent: they do not exist yet as vote fields, and
 * a cell that can never populate is worse than one fewer cell. They slot in here when they do.
 */
const STRIP_FACTS = {
  overall: {
    label: 'Overall',
    read(loc, agg){
      if(!agg || !agg.bathroomCount) return null;
      return { v: avgStr(agg.bathroomSum, agg.bathroomCount) + '\u2605',
               meta: String(agg.bathroomCount), tone: '' };
    }
  },
  safe: {
    label: 'Feels safe',
    read(loc, agg){
      /* Its own count, not the overall one. Somebody who has rated a place four times overall
       * and answered the safety question once should see "1" here — a number borrowed from a
       * different question would overstate how much anyone actually knows about this. */
      const sum = (agg && agg.safeSum) || 0, count = (agg && agg.safeCount) || 0;
      if(!count) return null;
      const avg = sum / count;
      /* Tone at the low end only. A 4.6 does not need colouring — the number says it — but
       * somebody scanning for a reason NOT to stop should not have to read the digits to find
       * one, and that is the whole job of this row. */
      return { v: avgStr(sum, count) + '\u2605', meta: String(count),
               tone: avg <= 2.5 ? 'bad' : (avg >= 4 ? 'ok' : '') };
    }
  },
  stalls: {
    /* Community-only, permanently. OSM records no usable stall count: capacity appears on 76 of
     * 74,456 imported records and toilets:num_chambers on 15, and toilets:position describes
     * seated-vs-urinal rather than how many. Useful once voted — it is the privacy question,
     * whether you can lock the door behind you — but it can never be seeded, so it is available
     * and never a default. */
    /* "Stalls: 1" was the label naming one possible answer and the value contradicting it — a
     * place with a single toilet has no stalls at all. "Toilets: One" states the thing being
     * counted and answers it in the same words the question uses. */
    label: 'Layout',
    read(loc){
      const def = BATHROOM_AMENITIES.find(a => a.key === 'restroomType');
      const votes = (amenityCache[loc.id] || {}).restroomType;
      /* Three layouts, three answers. "Several" for two private rooms and "Stalls" for a shared
       * room are different facts, and collapsing them back into one word here would undo the
       * whole point of splitting the question. */
      const short = { single:'Private', multiPrivate:'Several', multiple:'Stalls' };
      const st = confirmedState(def, votes);
      if(st) return { v: short[st] || '—', meta: '\u2605', tone: '' };
      const rep = reportedState(def, votes);
      if(rep) return { v: short[rep] || '—', meta: String((votes || {})[rep] || 1), tone: '' };
      return null;
    }
  },
  rooms: {
    label: 'Who',
    read(loc){
      /* Community answer first — three people who were there outrank a tag. */
      const def = BATHROOM_AMENITIES.find(a => a.key === 'genderSplit');
      const votes = (amenityCache[loc.id] || {}).genderSplit;
      const st = confirmedState(def, votes);
      if(st) return { v: st === 'single' ? 'Anyone' : "M/W", meta: '\u2605', tone: '' };
      /* Reported outranks the OSM seed: one person who was actually there beats a tag. */
      const rep = reportedState(def, votes);
      if(rep) return { v: rep === 'single' ? 'Anyone' : "M/W", meta: String((votes || {})[rep] || 1), tone: '' };
      /* Then the OSM seed. meta.osmGender was written by build-public-toilets.js from unisex=yes
       * (shared) and male=yes AND female=yes (separate), and stores the same 'single'/'multiple'
       * values genderSplit votes do — 7,782 answers that shipped with the data and were read
       * nowhere. Marked 'osm' rather than with a star, because the star means people confirmed
       * it and this did not. A lone male=yes or female=yes is deliberately NOT seeded: 5,168
       * records have exactly one, which usually means the other room simply was not mapped, and
       * guessing "separate" from half a pair would be inventing an answer. */
      const seed = loc.meta && loc.meta.osmGender;
      if(seed === 'single' || seed === 'multiple'){
        return { v: seed === 'single' ? 'Anyone' : "M/W", meta: 'osm', tone: '' };
      }
      return null;
    }
  },
  changing: { label: 'Changing', read: (loc) => stripYesNo(loc, 'changing') },
  accessible: {
    label: 'Accessible',
    read(loc){
      /* isConfirmedAccessible takes a SUMMARY; isConfirmedNotAccessible takes a LOC. Passing a
       * loc to the first silently returns false for every location — it would have read
       * summary.accessible off the wrong object and found nothing, so this cell would have shown
       * "No" or blank and never "Yes". Mirrors the existing badge's priority: a community
       * confirmation or a baked/OSM positive all count as yes. */
      if(isConfirmedNotAccessible(loc)) return { v: 'No', meta: '\u2605', tone: 'bad' };
      const yes = isConfirmedAccessible(amenityCache[loc.id])
        || (loc.conf && loc.conf.accessible)
        || (loc.osm && loc.osm.accessible)
        || loc.wheelchair === 'yes' || loc.wheelchair === 'designated';
      if(yes) return { v: 'Yes', meta: '\u2605', tone: 'ok' };
      return null;
    }
  },
  showers: { label: 'Showers', read: (loc) => stripYesNo(loc, 'shower', 'storeFeatures') },
  hours: {
    label: 'Open',
    read(loc){
      const open = isLocationOpenNow(loc);
      if(open === null) return null;
      const txt = formatHrsDisplay(loc);
      return { v: open ? (txt === 'Open 24 hours' ? '24h' : 'Open') : 'Closed',
               meta: '', tone: open ? 'ok' : 'bad' };
    }
  },
  fee: {
    /* "Fee: Free" says there is a fee and then says there is not. The label is the question —
     * what does it cost — and the value answers it. */
    label: 'Cost',
    read(loc){
      const f = loc.metroInfo && loc.metroInfo.fee;
      if(!f) return null;
      return { v: f === 'free' ? 'Free' : 'Paid', meta: '', tone: f === 'free' ? 'ok' : '' };
    }
  },
};

/* Shared reader for the plain yes/no amenities. Returns null rather than "unknown" — an
 * unanswered fact has no business taking a cell from one that IS answered. */
function stripYesNo(loc, key, field){
  const summary = (field === 'storeFeatures' ? storeFeatureCache : amenityCache)[loc.id] || {};
  const x = summary[key] || { yes:0, no:0 };
  const conf = (loc.conf || {});
  if(isConfirmedYes(x) || conf[key]) return { v: 'Yes', meta: '\u2605', tone: 'ok' };
  if(isConfirmedNo(x))               return { v: 'No',  meta: '\u2605', tone: 'bad' };
  /* Same three tiers as the badges below. A card that shows "Changing table · 1 report" in the
   * badge row and a blank cell in the strip above it is contradicting itself about the same
   * fact. The star is reserved for confirmed; a report says how many. */
  if(isReportedYes(x)) return { v: 'Yes', meta: x.yes + '', tone: '' };
  if(isReportedNo(x))  return { v: 'No',  meta: x.no + '',  tone: '' };
  return null;
}

/* The person's three, or a sensible default.
 * Defaults are the three most decision-relevant facts that ACTUALLY EXIST today. Unknown keys
 * are dropped rather than rendered blank, so a stored preference naming a fact that was later
 * removed degrades to a shorter strip instead of an empty cell. */
/* Chosen by measured coverage, not by what sounds most useful.
 *
 * The first draft was overall / stalls / changing, and two of those three are the emptiest
 * fields on the map: Overall needs a rating (community-only), Stalls needs three people to
 * agree on a multi-state question that OSM has no tag for at all — capacity appears on 76 of
 * 74,456 imported records. A new visitor would have opened a random location and seen one
 * populated cell at best, which teaches that the strip is broken rather than that the data is
 * thin.
 *
 * Coverage across all 84,079 locations today:
 *      Open        19,577  23.3%   baked hours
 *      Accessible   7,792   9.3%   conf + osm + legacy wheelchair
 *      Rooms        7,782   9.3%   osm seed
 *      Fee          5,365   6.4%   imported
 *      Changing     1,405   1.7%
 *      Overall / Stalls / Showers  0%  — no source but votes
 *
 * Open and Accessible lead because they populate. Overall keeps the third slot despite being
 * vote-only: it is the number people came for, and a strip with no rating on it reads as a
 * different app. Stalls stays available and never default. */
/* Safety replaces Accessible in the default three. Accessible is better covered today (9.3% vs
 * nothing, since safety starts empty), but it is also already stated by its own badge lower on
 * the card, whereas a safety score appears nowhere else. Overall and Open stay: Open is the
 * best-covered fact on the map at 23%, and Overall is the number people came for. */
const STRIP_DEFAULT = ['hours', 'overall', 'safe'];
function stripPicks(){
  try{
    const raw = JSON.parse(localStorage.getItem('br_strip_picks') || 'null');
    if(Array.isArray(raw) && raw.length){
      const clean = raw.filter(k => STRIP_FACTS[k]).slice(0, 3);
      if(clean.length) return clean;
    }
  }catch(e){}
  return STRIP_DEFAULT;
}

/* Save + sync, mirroring travelMode exactly: localStorage is the source of truth so the strip
 * works signed out, and the account copy follows you across devices when signed in.
 *
 * The account write is best-effort and silent on failure — which matters right now, because the
 * DEPLOYED rules still cap settings/{uid} to travelMode alone. Until firestore.rules is pushed,
 * this write is rejected and the local pref carries on working. That is the correct failure:
 * the feature degrades to per-device rather than breaking. */
function saveStripPicks(picks){
  const clean = (picks || []).filter(k => STRIP_FACTS[k]).slice(0, 3);
  try{ localStorage.setItem('br_strip_picks', JSON.stringify(clean)); }catch(e){}
  saveStripPicksToAccount(clean);
  return clean;
}
async function saveStripPicksToAccount(picks){
  if(!isLoggedIn()) return;
  try{
    const {db, doc, setDoc} = await fb();
    await setDoc(doc(db, 'settings', getEffectiveId()), { stripPicks: picks }, { merge: true });
  }catch(e){ /* ignore — local pref is already saved */ }
}
async function loadStripPicksFromAccount(){
  if(!isLoggedIn()) return;
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'settings', getEffectiveId()));
    if(!snap.exists()) return;
    const raw = snap.data().stripPicks;
    if(!Array.isArray(raw) || !raw.length) return;
    const clean = raw.filter(k => STRIP_FACTS[k]).slice(0, 3);
    if(!clean.length) return;
    // The synced choice wins on login, then is mirrored locally — same precedence as travelMode.
    try{ localStorage.setItem('br_strip_picks', JSON.stringify(clean)); }catch(e){}
    if(typeof applyFilters === 'function') refreshOpenPopupStrip();
  }catch(e){}
}

/* An open popup shows a strip built from the OLD picks until it is reopened. Rebuilding just
 * that node is cheaper and less disruptive than closing and reopening the popup under someone. */
function refreshOpenPopupStrip(){
  document.querySelectorAll('.popup-inner[data-locid]').forEach(inner => {
    const id = inner.dataset.locid;
    const loc = locationsById[id];
    const old = inner.querySelector('.answer-strip');
    if(!loc || !old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = stripHtml(loc, ratingsCache[id]);
    const fresh = tmp.firstElementChild;
    if(fresh) old.replaceWith(fresh);
  });
}

function stripHtml(loc, agg){
  const picks = stripPicks();
  const cells = picks.map(k => {
    const def = STRIP_FACTS[k];
    if(!def) return null;
    let got = null;
    try{ got = def.read(loc, agg); }catch(e){ got = null; }
    return { k, label: def.label, got };
  }).filter(Boolean);

  /* Nothing known at all -> the strip stops being three empty cells and becomes the ask. This
   * is most of the 84,000 locations on day one, so it has to read as an invitation rather than
   * a broken row. */
  if(!cells.some(c => c.got)){
    return `<div class="answer-strip is-empty"><span>Nothing reported yet \u2014 be the first</span></div>`;
  }
  return `<div class="answer-strip">` + cells.map(c => {
    const g = c.got;
    const v = g ? escapeHtml(g.v) : '\u2014';
    const meta = g && g.meta ? ' \u00b7 ' + escapeHtml(g.meta) : '';
    return `<div class="as-cell${g ? '' : ' as-blank'}">`
      + `<span class="as-v${g && g.tone ? ' as-' + g.tone : ''}">${v}</span>`
      + `<span class="as-k">${escapeHtml(c.label)}${meta}</span></div>`;
  }).join('') + `</div>`;
}

function metroPopupHtml(loc, agg, myVote){
  const shareUrl = `${location.origin}${location.pathname}?loc=${encodeURIComponent(loc.id)}`;
  const chain = chainFor(loc);
  const raw = (loc.metroInfo && loc.metroInfo.hoursRaw) || '';
  const hoursLine = raw
    ? `<div class="hours-line">${ico('clock')} ${escapeHtml(raw)}</div>`
    : `<div class="hours-line">${ico('clock')} Hours unknown — know them? Report hours below.</div>`;
  /* The same community hours flow the pit-stop popup has, not the old "tap Report below"
   * detour into the problem-report form. Hours sent that way arrived as free text in a
   * moderation queue; this path feeds the hourReports pipeline, where two travelers agreeing
   * makes it official with no admin in the loop. The handler already attaches by element id
   * for every popup, so sharing the markup is the entire change. */
  const hoursReport = hoursReportBlockHtml(loc, raw);
  const recency = agg ? relativeTimeFromNow(agg.lastRatedAt || agg.lastUpdated) : '';
  const recencyLine = recency ? `<div class="hours-line">${ico('pencil')} Last rated ${recency}${ratedByHtml(agg)}</div>` : '';
  const seasonalLine = seasonalNoteHtml(loc);
  // A doubted store shows the caveat until the community settles it either way.
  // The access badge above now carries this — one statement per fact, not two lines saying the
  // same thing in different words.
  const restroomDoubtLine = '';
  return `<div class="popup-inner" data-locid="${loc.id}">
    <div class="popup-head-row">
      <div class="chain-badge" style="background:${chain.color};color:${chain.textColor};">${escapeHtml(chain.name)}</div>
    </div>
    ${stripHtml(loc, agg)}
    <div class="addr addr-title">${escapeHtml(loc.addr || '')}</div>
    ${metroAccessBadge(loc)}
    ${(loc.metroInfo && loc.metroInfo.fee) ? `<div class="hours-line">${loc.metroInfo.fee === 'free' ? `${ico('check')} Free to use` : `${ico('help')} Paid / fee`}</div>` : ''}
    ${(loc.metroInfo && loc.metroInfo.disposal) ? `<div class="hours-line">${ico('restroom')} Basic facilities (portable / chemical unit)</div>` : ''}
    ${hoursLine}
    ${hoursReport}
    ${seasonalLine}
    ${restroomDoubtLine}
    ${recencyLine}
    <div id="accessible-badge-${loc.id}">${accessibleBadgeHtml(loc.id)}</div>
    <div class="popup-actions">
      <button class="btn btn-primary directions-btn" id="directions-btn-${loc.id}" data-lat="${loc.lat}" data-lng="${loc.lng}">${ico('compass','ico-lg')} Directions</button>
    </div>
    <!-- Metro was left on the old three-abreast row. Its share button was icon-only, so the new
         "Copied" feedback would have overflowed a control sized for one glyph, and Report — now a
         labelled pill — sat in a row built for icons. -->
    <div class="popup-subactions">
      <button class="share-btn" data-shareurl="${shareUrl}" data-sharename="${(loc.n||'').replace(/"/g,'&quot;')}">${ico('link')} Share</button>
      ${reportButtonHtml(loc)}
    </div>
    <div class="report-section" id="report-section-${loc.id}" style="display:none;">
      <div class="report-heading">Report a problem with this listing</div>
      <div class="report-cats" id="report-cats-${loc.id}">
        <button type="button" class="report-cat-btn" data-reason="Permanently closed">${ico('ban')} Permanently closed</button>
        <button type="button" class="report-cat-btn" data-reason="Wrong address / location">${ico('pin')} Wrong address</button>
        <button type="button" class="report-cat-btn" data-reason="Wrong hours">${ico('clock')} Wrong hours</button>
        <button type="button" class="report-cat-btn" data-reason="Not a real location">${ico('help')} Not a real location</button>
        <button type="button" class="report-cat-btn" data-reason="__other__">${ico('pencil')} Other</button>
      </div>
      <div class="report-other-row" id="report-other-row-${loc.id}" style="display:none;">
        <input type="text" class="tip-input" id="report-input-${loc.id}" maxlength="80" placeholder="Briefly describe the problem" />
        <button class="btn btn-amber tip-submit" id="report-submit-${loc.id}">Send</button>
      </div>
      <div class="save-note" id="report-note-${loc.id}"></div>
    </div>
    ${isLoggedIn() ? `<div class="rating-col single-rating" id="rating-section-${loc.id}">
      ${ratingSectionInnerHtml(loc, agg, myVote)}
    </div>
    ${communityBlockHtml(loc)}
    ${tipsSectionHtml(loc, true)}
    ${amenityEditorHtml(loc.id, myVote)}
    ${osmFeatureBlockHtml(loc)}` : `${communityBlockHtml(loc)}
    ${osmFeatureBlockHtml(loc)}
    ${tipsSectionHtml(loc, false)}
    <div class="popup-signin-hint">${ico('lock')} Sign in to rate this bathroom, add tips, or report an issue.</div>`}
  </div>`;
}

/* Reference into the sprite in index.html. Every icon in one place, so a shape can be redrawn
 * once and every use follows. */
/* Build-consistency check.
 *
 * app.js, index.html and the stylesheets have to be uploaded together, and when they are not the
 * result is silent: the icon helper emits <use href="#i-compass"> against a sprite that is not in
 * an older index.html, so every icon renders as empty space with no console error and no layout
 * break. A popup looks subtly wrong rather than obviously broken, and the only visible symptom is
 * a version stamp nobody thinks to check.
 *
 * BUILD is bumped alongside the stamp in index.html. If they disagree, or the sprite is missing,
 * say so where it will actually be seen instead of leaving it to be discovered by eye. */
const BUILD = 'v2.48.3';
(function checkBuild(){
  try{
    const stamped = document.querySelector('.d-version')?.dataset.version || '(none)';
    const sprite = !!document.querySelector('#i-compass');
    if(stamped === BUILD && sprite) return;
    const why = [];
    if(stamped !== BUILD) why.push(`index.html is ${stamped}, app.js is ${BUILD}`);
    if(!sprite) why.push('the icon sprite is missing from index.html, so icons will render blank');
    console.error('[BathroomReport] Files are out of step — ' + why.join('; ') +
      '. Upload index.html, app.js, styles.css, shell.css and sw.js together.');
    // Visible to an admin on the page itself, not only in a console nobody has open on a phone.
    window.addEventListener('DOMContentLoaded', () => {
      const bar = document.createElement('div');
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#c62828;' +
        'color:#fff;font:600 12px/1.4 system-ui,sans-serif;padding:8px 12px;text-align:center;' +
        'padding-bottom:calc(8px + env(safe-area-inset-bottom));';
      bar.textContent = 'Build mismatch: ' + why.join('; ') + '. Tap to dismiss.';
      bar.addEventListener('click', () => bar.remove());
      document.body.appendChild(bar);
    });
  }catch(e){ /* a diagnostic must never be the thing that breaks the page */ }
})();

function ico(name, cls){
  return `<svg class="ico${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}
// A section heading. Structure carried by type, not by a picture.
function plate(label){
  return `<div class="plate"><span>${label}</span><i></i></div>`;
}

/* The community hours-report flow, shared by BOTH popups.
 *
 * It lived inline in the pit-stop popup only, which meant routing public restrooms to the
 * restroom popup would have removed the one crowdsourcing flow they need most — a park
 * restroom's hours are exactly the blank this exists to fill, and the screenshot that
 * prompted this work showed it doing that job at a NY public restroom. Offered only where
 * hours are unknown; correcting wrong hours stays in Report-a-problem. */
function hoursReportBlockHtml(loc, hoursText){
  if(hoursText || !isLoggedIn()) return '';
  return `
    <button type="button" class="btn btn-secondary hours-report-toggle" id="hours-report-toggle-${loc.id}" style="margin:6px 0;width:100%;">${ico('clock')} Report hours</button>
    <div class="hours-report-section" id="hours-report-section-${loc.id}" style="display:none;background:#141619;border:1px solid #2a2e35;border-radius:10px;padding:10px;margin-bottom:6px;">
      <div style="font-weight:600;font-size:14px;margin-bottom:8px;color:#f6f8fa;">${isMapAdmin() ? "You're an admin — the hours you set are applied to the map right away." : "What hours is this store open? Two travelers agreeing makes it official."}</div>
      <div id="hours-mode-${loc.id}">
        <button type="button" data-mode="24" style="display:block;width:100%;text-align:left;padding:10px 12px;margin:4px 0;background:#1b1e23;color:#f6f8fa;border:1px solid #2a2e35;border-radius:8px;font-size:14px;cursor:pointer;">${ico('clock')} Open 24 hours</button>
        <button type="button" data-mode="same" style="display:block;width:100%;text-align:left;padding:10px 12px;margin:4px 0;background:#1b1e23;color:#f6f8fa;border:1px solid #2a2e35;border-radius:8px;font-size:14px;cursor:pointer;">${ico('clock')} Same hours every day</button>
        <button type="button" data-mode="sunday" style="display:block;width:100%;text-align:left;padding:10px 12px;margin:4px 0;background:#1b1e23;color:#f6f8fa;border:1px solid #2a2e35;border-radius:8px;font-size:14px;cursor:pointer;">${ico('calendar')} Sunday is different</button>
      </div>
      <div id="hours-same-${loc.id}" style="display:none;margin-top:8px;align-items:center;gap:10px;color:#f6f8fa;font-size:13px;">
        <label>Open <select id="hr-open-${loc.id}" style="font-size:16px;background:#1b1e23;color:#f6f8fa;border:1px solid #2a2e35;border-radius:6px;padding:4px 6px;">${halfHourOptions()}</select></label>
        <label>Close <select id="hr-close-${loc.id}" style="font-size:16px;background:#1b1e23;color:#f6f8fa;border:1px solid #2a2e35;border-radius:6px;padding:4px 6px;">${halfHourOptions()}</select></label>
      </div>
      <div id="hours-sunday-${loc.id}" style="display:none;margin-top:8px;color:#f6f8fa;font-size:13px;">
        <div style="display:flex;align-items:center;gap:6px;margin:4px 0;"><span style="width:60px;">Mon–Sat</span><select id="hr-ms-o-${loc.id}" style="font-size:16px;background:#1b1e23;color:#f6f8fa;border:1px solid #2a2e35;border-radius:6px;padding:4px 6px;">${halfHourOptions()}</select> – <select id="hr-ms-c-${loc.id}" style="font-size:16px;background:#1b1e23;color:#f6f8fa;border:1px solid #2a2e35;border-radius:6px;padding:4px 6px;">${halfHourOptions()}</select></div>
        <div style="display:flex;align-items:center;gap:6px;margin:4px 0;"><span style="width:60px;">Sunday</span><select id="hr-su-o-${loc.id}" style="font-size:16px;background:#1b1e23;color:#f6f8fa;border:1px solid #2a2e35;border-radius:6px;padding:4px 6px;">${halfHourOptions()}</select> – <select id="hr-su-c-${loc.id}" style="font-size:16px;background:#1b1e23;color:#f6f8fa;border:1px solid #2a2e35;border-radius:6px;padding:4px 6px;">${halfHourOptions()}</select></div>
      </div>
      <button type="button" class="btn btn-amber hours-submit" id="hours-submit-${loc.id}" style="display:none;margin-top:8px;">Send hours</button>
      <div class="save-note" id="hours-note-${loc.id}" style="margin-top:6px;"></div>
    </div>`;
}

function popupHtml(loc, agg, myVote){
  /* The "metro" popup is really the RESTROOM popup: leads with access, shows hours as text,
   * omits the store sections. It is the right popup for every public restroom, not only the two
   * metro sets — before this test widened, a park restroom in Albany or Denver rendered the
   * pit-stop popup, complete with store-feature framing built for gas stations. */
  if(chainFor(loc).group === 'metro' || isPublicRestroomChain(loc.chain)) return metroPopupHtml(loc, agg, myVote);
  const shareUrl = `${location.origin}${location.pathname}?loc=${encodeURIComponent(loc.id)}`;
  const hoursText = formatHrsDisplay(loc);
  const openStatus = isLocationOpenNow(loc);
  // "Today" only where the week actually varies — on a single all-week window it's noise.
  const hoursPrefix = (hasPerDayHours(loc) && hoursText !== 'Open 24 hours') ? 'Today ' : '';
  /* Open status leads.
   *
   * It was a small coloured word trailing the hours, at the same weight as the address and the
   * last-rated note. It is the single most important fact on the card — somebody standing outside
   * at 11pm needs it before anything else — so it gets its own line and the loudest type in the
   * block. Three channels carry it (dot, colour, word), so it survives greyscale and colour
   * blindness alike.
   *
   * Unknown stays visibly unknown, and is never rendered as closed. */
  let hoursLine = '';
  if(hoursText){
    const cls = openStatus === true ? 'status-open' : openStatus === false ? 'status-shut' : 'status-maybe';
    const word = openStatus === true ? 'Open now' : openStatus === false ? 'Closed now' : 'Hours listed';
    hoursLine = `<div class="status-line ${cls}">
      <span class="status-dot" aria-hidden="true"></span>
      <span class="status-word">${word}</span>
      <span class="status-hours">${hoursPrefix}${hoursText}</span>
    </div>`;
  } else {
    hoursLine = `<div class="status-line status-maybe">
      <span class="status-dot" aria-hidden="true"></span>
      <span class="status-word">Hours unknown</span>
      <span class="status-hours">Know them? Report hours below.</span>
    </div>`;
  }
  const recency = relativeTimeFromNow(agg.lastRatedAt || agg.lastUpdated);
  const recencyLine = recency ? `<div class="hours-line">${ico('pencil')} Last rated ${recency}${ratedByHtml(agg)}</div>` : '';
  hoursLine += seasonalNoteHtml(loc);
  if(restroomDoubted(loc) && !(loc.conf && loc.conf.hasRestroom)
     && !isConfirmedYes((amenityCache[loc.id]||{}).hasRestroom)){
    hoursLine += `<div class="hours-line restroom-doubt">${ico('help')} Not listed as having a public restroom — can you confirm?</div>`;
  }
  const chain = chainFor(loc);
  // Report hours is offered ONLY where hours are unknown — it fills blanks. Correcting wrong
  // hours stays in the Report-a-problem flow ("Wrong hours").
  const hoursReportHtml = hoursReportBlockHtml(loc, hoursText);
  return `<div class="popup-inner" data-locid="${loc.id}">
    <div class="popup-head-row">
      <div class="chain-badge" style="background:${chain.color};color:${chain.textColor};">${chain.name}</div>
      <span class="store-icons" id="store-icons-${loc.id}">${storeFeatureIconsHtml(loc, storeFeatureCache[loc.id])}</span>
    </div>
    ${stripHtml(loc, agg)}
    <div class="addr addr-title">${escapeHtml(loc.addr)}${loc.num ? ' &middot; Shop #' + escapeHtml(loc.num) : ''}</div>
    ${accessBadge(loc)}
    ${hoursLine}
    <div id="accessible-badge-${loc.id}">${accessibleBadgeHtml(loc.id)}</div>
    ${recencyLine}
    ${hoursReportHtml}
    ${isMapAdmin() ? adminAmenityPanelHtml(loc) : ''}
    <div class="popup-actions">
      <button class="btn btn-primary directions-btn" id="directions-btn-${loc.id}" data-lat="${loc.lat}" data-lng="${loc.lng}">${ico('compass','ico-lg')} Directions</button>
    </div>
    <!-- Directions is what most people opened this card for, so it stands alone. Share and Report
         sat beside it at equal weight, turning one obvious choice and two occasional ones into
         three co-equal ones. -->
    <div class="popup-subactions">
      <button class="share-btn" data-shareurl="${shareUrl}" data-sharename="${loc.n.replace(/"/g,'&quot;')}">${ico('link')} Share</button>
      ${reportButtonHtml(loc)}
    </div>
    <div class="report-section" id="report-section-${loc.id}" style="display:none;">
      <div class="report-heading">Report a problem with this listing</div>
      <div class="report-cats" id="report-cats-${loc.id}">
        <button type="button" class="report-cat-btn" data-reason="Permanently closed">${ico('ban')} Permanently closed</button>
        <button type="button" class="report-cat-btn" data-reason="Wrong address / location">${ico('pin')} Wrong address</button>
        <button type="button" class="report-cat-btn" data-reason="Wrong hours">${ico('clock')} Wrong hours</button>
        <button type="button" class="report-cat-btn" data-reason="Not a real location">${ico('help')} Not a real location</button>
        <button type="button" class="report-cat-btn" data-reason="__other__">${ico('pencil')} Other</button>
      </div>
      <div class="report-other-row" id="report-other-row-${loc.id}" style="display:none;">
        <input type="text" class="tip-input" id="report-input-${loc.id}" maxlength="80" placeholder="Briefly describe the problem" />
        <button class="btn btn-amber tip-submit" id="report-submit-${loc.id}">Send</button>
      </div>
      <div class="save-note" id="report-note-${loc.id}"></div>
    </div>
    ${isLoggedIn() ? `<div class="rating-col single-rating" id="rating-section-${loc.id}">
      ${ratingSectionInnerHtml(loc, agg, myVote)}
    </div>
    ${communityBlockHtml(loc)}
    ${tipsSectionHtml(loc, true)}
    ${amenityEditorHtml(loc.id, myVote)}
    ${osmFeatureBlockHtml(loc)}
` : `${communityBlockHtml(loc)}
    ${osmFeatureBlockHtml(loc)}
    ${tipsSectionHtml(loc, false)}
    <div class="popup-signin-hint">${ico('lock')} Sign in to rate this bathroom, add tips, or report an issue.</div>`}
  </div>`;
}

const markers = {};
// Keep a separate list of every marker. The ID-keyed `markers` object is useful for lookups,
// but it can only retain one marker per ID. Filtering the complete list guarantees that
// every pin is removed when its chain is disabled, even if bad imported data ever contains
// a duplicate ID.
const allLocationMarkers = [];
const myVoteCache = {};
const loadedIds = new Set();

function addMarker(loc){
  // Start every pin with placeholder (unrated-looking) data — colors/rings fill in as real data arrives
  ratingsCache[loc.id] = ratingsCache[loc.id] || emptyAgg();
  myVoteCache[loc.id] = myVoteCache[loc.id] || emptyVote();
  const marker = L.marker([loc.lat, loc.lng], {icon: makeIcon(loc.id)});
  marker.locId = loc.id; // used by the cluster icon function to compute the cluster's average rating
  marker.chainKey = loc.chain || DEFAULT_CHAIN_KEY;
  marker.locationData = loc;
  allLocationMarkers.push(marker);
  // Not added to the map here on purpose: applyFilters() is the single authority on which
  // pins are on the map. It renders only markers within the current viewport (plus the
  // chain and open-now filters), so the ~3,000 off-screen pins stay out of the DOM. This
  // is the main win for load speed and map responsiveness as the dataset grows nationally.
  // Lazy content: Leaflet accepts a function evaluated on open. Building the full popup HTML
  // for all 5,500+ locations at startup cost real CPU and ~megabytes of strings; now each
  // popup renders only when its pin is actually tapped (popupopen refreshes it again anyway).
  marker.bindPopup(() => popupHtml(loc, ratingsCache[loc.id], myVoteCache[loc.id]), {
    maxWidth: Math.min(280, window.innerWidth - 40),
    maxHeight: window.innerHeight * 0.6,
    autoPan: false,
    keepInView: false
  });
  marker.on('popupopen', async () => {
    // Keep the selected pin centered horizontally and near the bottom of the
    // visible map. The popup then grows upward with maximum available room.
    requestAnimationFrame(() => positionSelectedMarker(marker, false));

    // On-demand: load just THIS location's aggregate (replaces the old bulk read of every
    // aggregate). One getDoc per opened popup, then refresh the popup content once.
    try{
      // Shared fetch: ratings + amenity tallies + store-feature tallies all come from this one
      // aggregate-doc read (fetchCommunityDoc also fills amenityCache/storeFeatureCache).
      const [data] = await Promise.all([ fetchCommunityDoc(loc.id), loadAmenityOverride(loc) ]);
      if(data && Object.keys(data).length){
        ratingsCache[loc.id] = { ...emptyAgg(), ...data };
        if(marker.isPopupOpen()) marker.setPopupContent(popupHtml(loc, ratingsCache[loc.id], myVoteCache[loc.id]));
      }
    }catch(e){ /* non-fatal — popup shows the placeholder rating until next open */ }

    // Each handler runs independently — a thrown error in one must not stop the rest.
    const safeAttach = (fn) => {
      try{ fn(loc); }catch(e){ console.error(`${fn.name} failed for ${loc.id}:`, e); }
    };
    safeAttach(attachStarHandlers);
    safeAttach(attachTipHandlers);
    safeAttach(attachDirectionsHandler);
    safeAttach(attachShareHandler);
    safeAttach(attachReportHandler);
    safeAttach(attachHoursReportHandler);
    safeAttach(attachAmenityHandlers);
    safeAttach(attachStoreFeatureHandlers);
    safeAttach(attachAdminAmenityHandlers);
    safeAttach(attachOooHandlers);
  });
  markers[loc.id] = marker;
}

// Directions — remembers the user's preferred nav app after they pick once.
// "On foot" requests walking directions where the nav app's URL supports it:
// Apple (dirflg=w) and Google (travelmode=walking). Waze is driving-only — no walking
// mode exists in its URL scheme, so foot mode there still opens a drive route.
function buildNavUrl(app, lat, lng){
  const walking = travelMode === 'foot';
  if(app === 'waze') return `https://www.waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  if(app === 'apple') return `https://maps.apple.com/?daddr=${lat},${lng}${walking ? '&dirflg=w' : ''}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${walking ? '&travelmode=walking' : ''}`;
}

// Best default when the user hasn't explicitly chosen: Apple Maps on Apple hardware
// (iPhone/iPad/Mac — iPadOS 13+ reports as "Macintosh", so also check touch points),
// Google Maps everywhere else. Lets logged-out users get the right app with zero setup.
function deviceDefaultNavApp(){
  const ua = navigator.userAgent || '';
  const isApple = /iPhone|iPad|iPod/.test(ua)
    || /Macintosh/.test(ua)
    || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  return isApple ? 'apple' : 'google';
}
// The nav app to actually open: an explicit saved preference wins; otherwise the device default.
function resolveNavApp(){
  return localStorage.getItem('preferredNavApp') || deviceDefaultNavApp();
}

function attachDirectionsHandler(loc){
  const btnOrig = document.getElementById('directions-btn-' + loc.id);
  if(!btnOrig) return;

  const btn = btnOrig.cloneNode(true);
  btnOrig.parentNode.replaceChild(btn, btnOrig);

  btn.addEventListener('click', () => {
    // Opens with the user's saved maps-app preference (set in the drawer), else the device
    // default (Apple on Apple hardware, Google elsewhere). The per-popup gear picker was removed.
    window.open(buildNavUrl(resolveNavApp(), btn.dataset.lat, btn.dataset.lng), '_blank', 'noopener');
  });
}

function attachShareHandler(loc){
  const btn = document.querySelector(`.popup-inner[data-locid="${loc.id}"] .share-btn`);
  if(!btn) return;
  const newBtn = btn.cloneNode(true); // avoid stacking duplicate listeners across reopens
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', async () => {
    const url = newBtn.dataset.shareurl;
    const name = newBtn.dataset.sharename;
    if(navigator.share){
      try{
        await navigator.share({ title: `${name} — BathroomReport`, url });
        /* Only after the sheet resolves. A rejected promise means they backed out, and counting
         * that as a share would make the number meaningless. iOS does not tell us which app they
         * picked, so `method` is as granular as this can get. */
        track('share', { method: 'native', chain: name, loc_id: loc.id });
      }catch(e){ /* user cancelled the share sheet — no action needed */ }
    } else if(navigator.clipboard){
      try{
        await navigator.clipboard.writeText(url);
        track('share', { method: 'clipboard', chain: name, loc_id: loc.id });
        /* innerHTML, not textContent: the button now holds an <svg> and a label, and assigning
         * textContent would delete both and leave a bare glyph where the control had been. */
        const restore = newBtn.innerHTML;
        newBtn.innerHTML = `${ico('check')} Copied`;
        setTimeout(() => { newBtn.innerHTML = restore; }, 2000);
      }catch(e){ /* clipboard blocked — nothing we can do silently */ }
    }
  });
}

/* One live report per person per location.
 *
 * The popup used to hide the category buttons after a send, which lasted exactly as long as the
 * popup stayed open — reopening it gave the buttons back, and addDoc() happily wrote another
 * document. Nothing server-side objected, so one person could fill the queue with the same
 * complaint about the same store.
 *
 * The id is now derived from the location and the reporter, and the write is a create, which
 * Firestore refuses when the document already exists. The rules require that shape too, so the
 * limit holds whatever the client does. Resolving or dismissing in FlushPanel archives the
 * report and deletes the live doc, which is what frees the slot for a fresh one. */
function reportDocId(locId, uid){ return fsId(locId) + '_' + uid; }

/* The flag button, or the pending state where this person already has a live report here.
 * Both popups render it through this so the two stay in step. */
function reportPendingHtml(loc){
  return `<span class="report-pending" id="report-pending-${loc.id}" title="Your report is with a moderator" role="status">${ico('flag')} Reported</span>`;
}
function reportButtonHtml(loc){
  if(!isLoggedIn()) return '';
  if(hasReportedLocally(loc.id)) return reportPendingHtml(loc);
  /* Sits in the quiet sub-action row now, so it inherits that styling rather than btn-danger —
   * reporting a problem is a normal, welcome thing to do, not a destructive action. */
  return `<button class="report-toggle-btn" aria-label="Report a problem with this location" id="report-toggle-${loc.id}">${ico('flag')} Report</button>`;
}

/* Local memory of what this person has already reported. UI hint only — it decides whether the
 * popup offers the flag button or says "under review", and it is deliberately NOT the thing that
 * enforces the limit. Clearing site data resets it; the create then fails on the server and the
 * popup corrects itself. */
const REPORTED_KEY = 'reportedLocations';

/* One-time purge of entries written by a broken build.
 *
 * v2.15.1 and earlier treated EVERY permission-denied as "you already reported this", and marked
 * the location locally on the way out. Reports were being refused for an unrelated reason (the
 * rules require numeric coordinates; 19 of the 40 chain files store them as strings), so people
 * ended up with locations flagged as reported that Firestore had never accepted — the popup
 * showed "🚩 Reported" over nothing, and there was no way to clear it from a phone.
 *
 * The flag is a UI hint with no authority — the server decides whether a report exists — so
 * discarding it costs nothing. Anyone with a genuine open report sees the pending state return
 * the next time they open that popup and the create is refused as a real duplicate.
 *
 * Keyed by schema version rather than app version so it runs exactly once, not on every release. */
/* Bumped to 3 to clear flags written before the TTL existed. Those entries have no expiry
 * recorded against them in any meaningful sense — they were written by a build that intended
 * them to be permanent — so ageing them out individually would keep them for another 30 days
 * from whenever they happened to be written. One purge is cleaner, and the seed above preserves
 * them in the lifetime count first. */
const REPORTED_SCHEMA = 3;
(function purgeStaleReportFlags(){
  try{
    if(Number(localStorage.getItem('reportedLocationsSchema')) === REPORTED_SCHEMA) return;
    // Preserve the contribution history before discarding the open-report hints.
    if(typeof seedLifetimeReports === 'function') seedLifetimeReports();
    localStorage.removeItem(REPORTED_KEY);
    localStorage.setItem('reportedLocationsSchema', String(REPORTED_SCHEMA));
  }catch(e){ /* private mode — nothing was stored to begin with */ }
})();

function reportedLocal(){
  try{ return JSON.parse(localStorage.getItem(REPORTED_KEY) || '{}') || {}; }catch(e){ return {}; }
}
/* Reports go stale. The flag answers "do I have an OPEN report here", and nothing ever cleared
 * it — so a location reported once said "Reported" forever, and the person could never flag it
 * again when the problem came back. The timestamp was already being written and never read.
 *
 * Thirty days: long enough that a report still in the queue keeps its state, short enough that
 * a location whose problem returned months later can be reported again. The flag has no
 * authority either way — if a duplicate really is open, the server refuses the create and the
 * popup puts the pending state back, which is what the purge comment above already relies on. */
const REPORT_FLAG_TTL = 30 * 24 * 60 * 60 * 1000;
function hasReportedLocally(locId){
  const at = reportedLocal()[locId];
  if(!at) return false;
  if(typeof at === 'number' && Date.now() - at > REPORT_FLAG_TTL){
    markReportedLocally(locId, false);      // expire lazily, on the read that noticed
    return false;
  }
  return true;
}
function markReportedLocally(locId, on){
  try{
    const m = reportedLocal();
    if(on) m[locId] = Date.now(); else delete m[locId];
    localStorage.setItem(REPORTED_KEY, JSON.stringify(m));
    /* Counted separately and permanently. The store above is "what is open right now" and has to
     * expire; the creed's IMPROVE number is "what have I ever contributed" and must not. Reusing
     * one store for both meant the footer total would quietly fall as flags aged out — someone
     * would watch their contribution count go DOWN for doing nothing. */
    if(on) bumpLifetimeReports(locId);
  }catch(e){ /* private mode / quota — the server limit still holds, so this is cosmetic */ }
}
function bumpLifetimeReports(locId){
  try{
    const k = 'br_reports_made';
    const set = new Set(JSON.parse(localStorage.getItem(k) || '[]'));
    set.add(locId);
    localStorage.setItem(k, JSON.stringify([...set]));
  }catch(e){}
}

/* Is this person muted from reporting right now?
 *
 * Read at SUBMIT time, never on page load. Almost nobody reports in a given session, and a
 * per-load check would spend a document read on every visitor to catch the rare muted one.
 * reporters/{uid} only exists for people who have been marked for spam or muted by hand, so for
 * everyone else this is a miss on a document that was never created.
 *
 * Fails OPEN. A network blip must not silently discard a good report; the worst case is one
 * report from a muted person landing in a queue that is being reviewed by hand anyway. */
async function reportMuteState(uid){
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'reporters', uid));
    if(!snap.exists()) return { muted: false };
    const d = snap.data() || {};
    const until = typeof d.mutedUntil === 'number' ? d.mutedUntil : 0;
    // 0 with a mute on record means indefinite; otherwise it is an expiry.
    const muted = d.muted === true ? (until === 0 || until > Date.now()) : false;
    return { muted, until };
  }catch(e){ return { muted: false }; }
}

/* Count an attempt made while muted.
 *
 * Client-written, so treat it as a signal rather than evidence: it counts the person who keeps
 * tapping the button, not one who bypasses the app. The rules let an owner increment this single
 * field and nothing else on their own record. Best-effort — a failure here must not change what
 * the reporter sees, since the whole point is that a muted submit looks identical to a real one. */
async function countBlockedAttempt(uid){
  try{
    const {db, doc, setDoc, increment} = await fb();
    await setDoc(doc(db, 'reporters', uid), { blockedAttempts: increment(1) }, { merge: true });
  }catch(e){ /* deliberately silent */ }
}

// Report a wrong/closed/incorrect pin — logs to Firestore (visible in FlushPanel) AND opens an email
async function logReport(loc, reason){
  try{
    const uid = (window.__currentUser && window.__currentUser.uid) || '';
    if(!uid) return false;   // the flag button only renders for signed-in people

    /* A muted person sees exactly what a successful reporter sees. Telling them would teach a
     * spammer to make a fresh account; the cost is that a false positive is invisible to them,
     * which is why blockedAttempts is surfaced in FlushPanel for you to notice instead. */
    const mute = await reportMuteState(uid);
    if(mute.muted){
      await countBlockedAttempt(uid);
      markReportedLocally(loc.id, true);   // keep the fiction consistent when the popup reopens
      return true;
    }

    const {db, doc, setDoc} = await fb();
    const chainKey = loc.chain || DEFAULT_CHAIN_KEY;
    // Capture enough to identify and fix the exact stop from FlushPanel — including
    // coordinates, which pin down the location even when the street address is blank
    // (many imported stops have no address yet). None of these are moderator-only
    // fields, so the write still satisfies the reports create rules.
    /* Coordinates are coerced, not passed through.
     *
     * 19 of the 40 chain data files store lat/lng as STRINGS ("42.702557") and 21 as numbers —
     * an artifact of the different sources they were imported from. The rules validate the range,
     * which requires a number, so sending the raw value refused every report from those 19 chains
     * with permission-denied.
     *
     * Number() on a decimal string is exact — no precision is invented or lost. Anything that
     * does not parse to a real point on Earth is omitted entirely rather than sent as NaN, since
     * the rules accept a report with no coordinates but not one with nonsense in them. */
    const nLat = Number(loc.lat), nLng = Number(loc.lng);
    const coordsOk = Number.isFinite(nLat) && Number.isFinite(nLng)
      && Math.abs(nLat) <= 90 && Math.abs(nLng) <= 180;

    /* reporterName is denormalised on purpose. FlushPanel shows who reported without a lookup per
     * card, and it is the handle the person chose to be known by — the raw uid stays on the doc
     * for identity, but a moderator should be reading a name.
     *
     * Named reportDoc rather than payload: tools/audit-ui.js finds every field written onto a
     * VOTE by scanning for `payload.<field> =`, so a second variable of that name here made
     * lat/lng look like vote fields the rules reject.
     *
     * Built up rather than declared in one literal because the rules distinguish ABSENT from
     * null: `boundedStrOrAbsent` passes when a key is missing and fails when it is present
     * holding null, so an optional field with no value has to be left out, not set to null. */
    const reportDoc = {
      locId: loc.id,
      locName: loc.n,
      chainKey: chainKey,
      chain: (CHAIN_REGISTRY[chainKey] || {}).name || chainKey,
      reporterId: uid,
      reason: reason,
      ts: Date.now()
    };
    const addIf = (k, v) => { if(v !== null && v !== undefined && v !== '') reportDoc[k] = v; };
    addIf('addr', loc.addr);
    addIf('storeNumber', loc.storeNumber ?? loc.num);
    addIf('city', loc.city ?? (loc.address && loc.address.city));
    addIf('state', loc.state ?? (loc.address && loc.address.state));
    addIf('reporterName', displayNameFor());
    if(coordsOk){ reportDoc.lat = nLat; reportDoc.lng = nLng; }

    await setDoc(doc(db, 'reports', reportDocId(loc.id, uid)), reportDoc, { merge: false });
    markReportedLocally(loc.id, true);
    return true;
  }catch(e){
    /* A rules rejection is NOT necessarily a duplicate.
     *
     * This used to map every permission-denied to "you've already reported this one", which is
     * only one of the reasons Firestore refuses a create — a field the allowlist does not accept,
     * a document id the rules reconstruct differently, a mute, a rules version older than the
     * client all produce the identical code. Reporting them all as a duplicate hid genuine
     * breakage behind a reassuring message.
     *
     * A duplicate is now established by looking: if a report from this person really does exist
     * at this location, say so. Otherwise surface the code, because a rejection nobody can see is
     * a rejection nobody can fix. */
    const code = (e && e.code) || 'unknown';
    if(code === 'permission-denied'){
      try{
        const {db, doc, getDoc} = await fb();
        const uid2 = (window.__currentUser && window.__currentUser.uid) || '';
        const existing = await getDoc(doc(db, 'reports', reportDocId(loc.id, uid2)));
        if(existing.exists()){
          markReportedLocally(loc.id, true);
          return 'duplicate';
        }
      }catch(e2){ /* can't read it either — fall through and report the original refusal */ }
    }
    console.error('logReport rejected:', code, e);
    return { error: code, message: (e && e.message) || '' };
  }
}

async function logMissingLocation(description, coords){
  try{
    const {db, collection, addDoc} = await fb();
    const docData = { description, ts: Date.now() };
    if(coords){ docData.lat = coords.lat; docData.lng = coords.lng; }
    await addDoc(collection(db, 'missingReports'), docData);
    return true;
  }catch(e){
    console.error('logMissingLocation failed:', e);
    return false;
  }
}

function attachStoreToggleHandler(loc){
  const toggleOrig = document.getElementById('store-toggle-' + loc.id);
  if(!toggleOrig) return;
  const toggle = toggleOrig.cloneNode(true);
  toggleOrig.parentNode.replaceChild(toggle, toggleOrig);
  toggle.addEventListener('click', () => {
    const section = document.getElementById('store-section-' + loc.id);
    const arrow = document.getElementById('store-arrow-' + loc.id);
    if(!section || !arrow) return;
    const collapsed = section.classList.toggle('collapsed');
    arrow.textContent = collapsed ? '▾' : '▸';
    if(!collapsed){
      // The popup scrolls internally (max-height:56vh) and this toggle sits near the
      // bottom — without this, the revealed content lands below the visible area and
      // looks like the tap did nothing.
      requestAnimationFrame(() => section.scrollIntoView({block:'nearest', behavior:'smooth'}));
    }
  });
}

function attachReportHandler(loc){
  const toggleBtn = document.getElementById('report-toggle-' + loc.id);
  const section = document.getElementById('report-section-' + loc.id);
  const cats = document.getElementById('report-cats-' + loc.id);
  const otherRow = document.getElementById('report-other-row-' + loc.id);
  const input = document.getElementById('report-input-' + loc.id);
  const submitBtn = document.getElementById('report-submit-' + loc.id);
  const note = document.getElementById('report-note-' + loc.id);
  if(!toggleBtn || !section || !cats) return;

  // Clone to avoid stacking duplicate listeners on reopen
  const newToggle = toggleBtn.cloneNode(true);
  toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);
  newToggle.addEventListener('click', () => {
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
  });

  const send = async (reason) => {
    if(note){ note.style.color=''; note.textContent = 'Sending…'; }
    // true = filed, 'duplicate' = one is already open here, {error} = refused, with the reason.
    const sent = await logReport(loc, reason);
    const ok = sent === true || sent === 'duplicate';
    if(note){
      note.style.color = ok ? '#2f6b3c' : '#c62828';
      if(sent === 'duplicate'){
        note.textContent = "You've already reported this one — it's still being reviewed.";
      } else if(sent === true){
        note.textContent = 'Report sent — thank you!';
      } else if(sent && sent.error === 'permission-denied'){
        /* Named plainly rather than dressed up as a connection problem. This is a server-side
         * refusal, and sending the reader to check their wifi is the wrong place to look. */
        note.textContent = "Couldn't send — the server refused this write (permission-denied). Not a connection problem.";
      } else if(sent && sent.error === 'unavailable'){
        note.textContent = "Couldn't send — you appear to be offline. Try again in a moment.";
      } else {
        note.textContent = "Couldn't send" + (sent && sent.error ? " (" + sent.error + ")" : "") + " — please try again.";
      }
    }
    if(ok){
      newCats.style.display='none';
      if(otherRow) otherRow.style.display='none';
      // Replace the flag button with the pending state, so closing and reopening the popup shows
      // the same thing rather than re-offering a report that cannot be filed.
      const flag = document.getElementById('report-toggle-' + loc.id);
      if(flag) flag.outerHTML = reportPendingHtml(loc);
    }
  };

  // Category buttons: a tap sends immediately, except "Other" which reveals the free-text row.
  const newCats = cats.cloneNode(true);
  cats.parentNode.replaceChild(newCats, cats);
  newCats.addEventListener('click', (e) => {
    const btn = e.target.closest('.report-cat-btn');
    if(!btn) return;
    const reason = btn.dataset.reason;
    if(reason === '__other__'){
      if(otherRow){ otherRow.style.display = 'flex'; if(input) input.focus(); }
      return;
    }
    send(reason);
  });

  if(submitBtn){
    const newSubmit = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmit, submitBtn);
    newSubmit.addEventListener('click', async () => {
      const reason = ((input && input.value) || '').trim().slice(0, 80);
      if(!reason){ if(note){ note.style.color = '#c62828'; note.textContent = 'Briefly describe the problem first.'; } return; }
      newSubmit.disabled = true; newSubmit.textContent = 'Sending…';
      await send(reason);
      if(input) input.value = '';
      newSubmit.disabled = false; newSubmit.textContent = 'Send';
    });
  }
}

// Community hours picker: toggle open, pick a mode, submit a canonical value. Logged-in only;
// anonymous taps get a sign-in nudge. Mirrors the report-section clone-to-avoid-dupes pattern.
function attachHoursReportHandler(loc){
  const toggle  = document.getElementById('hours-report-toggle-' + loc.id);
  const section = document.getElementById('hours-report-section-' + loc.id);
  if(!toggle || !section) return;
  const modeRow   = document.getElementById('hours-mode-' + loc.id);
  const sameRow   = document.getElementById('hours-same-' + loc.id);
  const sundayRow = document.getElementById('hours-sunday-' + loc.id);
  const submit    = document.getElementById('hours-submit-' + loc.id);
  const note      = document.getElementById('hours-note-' + loc.id);
  let mode = null;
  const setNote = (msg, err) => { if(note){ note.style.color = err ? '#c62828' : '#2f6b3c'; note.textContent = msg || ''; } };

  const newToggle = toggle.cloneNode(true);
  toggle.parentNode.replaceChild(newToggle, toggle);
  newToggle.addEventListener('click', () => {
    if(!isLoggedIn()){
      section.style.display = 'block';
      if(modeRow) modeRow.style.display = 'none';
      setNote('Sign in to report hours — it keeps reports honest (two travelers must agree).', false);
      if(note) note.style.color = '';
      return;
    }
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
  });

  // Clone the Send button FIRST and keep a reference to the element that's actually in the DOM.
  // (The old bug: the mode handler flipped display on the pre-clone node, so the visible clone
  // never un-hid — Send appeared to be missing.)
  let ns = null;
  if(submit){ ns = submit.cloneNode(true); submit.parentNode.replaceChild(ns, submit); }

  // Shared submit path — used by the Send button AND by tapping "Open 24 hours".
  const doSubmit = async (value, kind) => {
    if(ns){ ns.disabled = true; ns.style.display = 'block'; ns.style.width = '100%'; ns.textContent = 'Sending…'; }
    setNote('Sending…', false); if(note) note.style.color = '';
    const ok = await saveHoursReport(loc.id, value, kind);
    if(ns) ns.disabled = false;
    if(ok){
      if(ns){ ns.textContent = '✓ Submitted!'; ns.style.background = '#2e7d32'; ns.style.borderColor = '#2e7d32'; ns.style.color = '#fff'; }
      setNote("Thanks — we'll confirm once another traveler agrees.", false);
      setTimeout(() => {
        if(section) section.style.display = 'none';
        if(ns){ ns.textContent = 'Send hours'; ns.style.background = ''; ns.style.borderColor = ''; ns.style.color = ''; ns.style.display = 'none'; }
        if(newToggle){ newToggle.textContent = '✓ Hours submitted'; newToggle.disabled = true; }
      }, 1500);
    } else {
      if(ns) ns.textContent = 'Send hours';
      setNote("Couldn't send — check your connection and try again.", true);
    }
  };

  if(modeRow){
    const nm = modeRow.cloneNode(true);
    modeRow.parentNode.replaceChild(nm, modeRow);
    nm.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]'); if(!b) return;
      mode = b.dataset.mode;
      setNote('');
      // highlight the chosen mode
      nm.querySelectorAll('[data-mode]').forEach(x => { const on = x === b;
        x.style.background = on ? '#0e2f33' : '#1b1e23'; x.style.borderColor = on ? '#2ea1aa' : '#2a2e35'; });
      if(mode === '24'){
        // Unambiguous — submit immediately, no second tap needed.
        if(sameRow) sameRow.style.display = 'none';
        if(sundayRow) sundayRow.style.display = 'none';
        doSubmit('24', 'single');
        return;
      }
      if(sameRow) sameRow.style.display = (mode === 'same') ? 'flex' : 'none';
      if(sundayRow) sundayRow.style.display = (mode === 'sunday') ? 'block' : 'none';
      if(ns){ ns.style.display = 'block'; ns.style.width = '100%'; }   // reveal the REAL in-DOM button
    });
  }

  if(ns){
    ns.addEventListener('click', () => {
      let value = null, kind = null;
      if(mode === 'same'){
        const o = (document.getElementById('hr-open-'  + loc.id) || {}).value;
        const c = (document.getElementById('hr-close-' + loc.id) || {}).value;
        if(!o || !c){ setNote('Pick both an open and a close time.', true); return; }
        value = canonHrsOne(o + '-' + c); kind = 'single';
        if(!value){ setNote("Those times didn't look right.", true); return; }
      } else if(mode === 'sunday'){
        const mo = (document.getElementById('hr-ms-o-' + loc.id) || {}).value;
        const mc = (document.getElementById('hr-ms-c-' + loc.id) || {}).value;
        const so = (document.getElementById('hr-su-o-' + loc.id) || {}).value;
        const sc = (document.getElementById('hr-su-c-' + loc.id) || {}).value;
        if(!mo || !mc || !so || !sc){ setNote('Pick open & close for both Mon–Sat and Sunday.', true); return; }
        const ms = canonHrsOne(mo + '-' + mc), su = canonHrsOne(so + '-' + sc);
        if(!ms || !su){ setNote("Those times didn't look right.", true); return; }
        value = { mon:ms, tue:ms, wed:ms, thu:ms, fri:ms, sat:ms, sun:su }; kind = 'perday';
      } else { setNote('Pick how the hours work first.', true); return; }
      doSubmit(value, kind);
    });
  }
}

// Out-of-order: reads status on open and re-renders the rating section, then wires the report /
// "it's working" / re-report actions. All three are GPS-gated (verifyNearby); the report action
// also confirms first so it isn't tapped casually.
async function attachOooHandlers(loc){
  await loadOoo(loc.id);
  const section = document.getElementById('rating-section-' + loc.id);
  if(section){
    section.innerHTML = ratingSectionInnerHtml(loc, ratingsCache[loc.id] || emptyAgg(), myVoteCache[loc.id] || emptyVote());
    // Stars were re-rendered — re-bind their handlers (unless suppressed in the hard phase).
    if(oooStatus(oooCache[loc.id]).phase !== 'hard') safeAttachStar(loc);
  }
  wireOoo(loc);
}

// Best-effort re-bind of star handlers after a rating-section re-render.
function safeAttachStar(loc){ try{ attachStarHandlers(loc); }catch(e){} }

function wireOoo(loc){
  const noteId = 'ooo-note-' + loc.id;
  const setNote = (msg, err) => { const n = document.getElementById(noteId) || document.getElementById('note-bathroom-' + loc.id); if(n){ n.style.color = err ? '#c62828' : ''; n.textContent = msg || ''; } };
  const gatedWrite = async (writeFn, confirmMsg) => {
    if(confirmMsg && !window.confirm(confirmMsg)) return;
    setNote(nearbyWaitNote());
    const v = await verifyNearby(loc, { allowAdmin: true });
    if(!v.ok){ setNote(verifyFailMessage(v), true); return; }
    try{ await writeFn(); }catch(e){ setNote('Could not save — try again.', true); return; }
    await loadOoo(loc.id);
    const section = document.getElementById('rating-section-' + loc.id);
    if(section){
      section.innerHTML = ratingSectionInnerHtml(loc, ratingsCache[loc.id] || emptyAgg(), myVoteCache[loc.id] || emptyVote());
      if(oooStatus(oooCache[loc.id]).phase !== 'hard') safeAttachStar(loc);
      wireOoo(loc);   // re-bind after the swap
    }
    if(navigator.vibrate) navigator.vibrate(10);
  };

  const reportBtn = document.getElementById('ooo-report-' + loc.id);
  if(reportBtn) reportBtn.addEventListener('click', () =>
    gatedWrite(() => reportOutOfOrder(loc), 'Report this bathroom as out of order? This hides its rating and warns other visitors.'));

  const stillBtn = document.getElementById('ooo-stillbroken-' + loc.id);
  if(stillBtn) stillBtn.addEventListener('click', () =>
    gatedWrite(() => reportOutOfOrder(loc), 'Report that this bathroom is still out of order?'));

  const workingBtn = document.getElementById('ooo-working-' + loc.id);
  if(workingBtn) workingBtn.addEventListener('click', () =>
    gatedWrite(() => clearOutOfOrder(loc), null));
}

// Fetch every pin's real ratings in the background so the map colors itself in at a glance —
// Firebase's free tier handles this fine, unlike the old sandboxed rate limit.

async function attachAmenityHandlers(loc){
  const summaryEl=document.getElementById('feature-summary-'+loc.id);
  const summary=await loadAmenitySummary(loc.id);
  if(summaryEl) summaryEl.innerHTML=amenitySummaryHtml(summary, loc);
  refreshCommunityBlock(loc);
  const osmB = document.querySelector(`.popup-inner[data-locid="${loc.id}"] .osm-bathroom-section`);
  if(osmB) osmB.classList.toggle('is-empty', !osmBathroomHasContent(loc));
  const badgeEl = document.getElementById('accessible-badge-' + loc.id);
  if(badgeEl) badgeEl.innerHTML = accessibleBadgeHtml(loc.id);

  // Make sure THIS person's saved answers are loaded before we compute the visit's question list,
  // so we never re-ask something they've already answered (e.g. right after a page refresh, before
  // the bulk vote load has landed). Recompute the visit list against the fresh vote.
  try{
    const saved = await loadMyVote(loc.id);
    if(saved){
      myVoteCache[loc.id] = { ...emptyVote(), ...saved };
      delete visitQuestions[loc.id]; delete visitCursor[loc.id];   // force a fresh, correct pick
      /* BOTH halves, or they contradict each other.
       *
       * This refreshed the vote from the server and redrew only the question. The YOU SAID list
       * kept whatever was rendered when the popup was built, so a card could show "What is the
       * setup?" and "Multi-stall restroom" at the same time — the question saying the answer is
       * unknown and the list saying it is known, from the same object, one of them minutes out
       * of date. Anything that replaces myVoteCache has to redraw everything reading it. */
      refreshVoteViews(loc);
    }
  }catch(e){ /* non-fatal — fall back to whatever's cached */ }

  const stepOrig = document.getElementById('amenity-step-' + loc.id);
  if(!stepOrig) return;
  const stepEl = stepOrig.cloneNode(true);
  stepOrig.parentNode.replaceChild(stepEl, stepOrig);

  // One delegated listener handles every step — since we only ever update stepEl's
  // innerHTML (never replace stepEl itself), this same listener keeps working as the
  // question changes underneath it.
  stepEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.amenity-answer-btn');
    if(!btn) return;
    const key = btn.dataset.key;
    const value = btn.dataset.value;
    const note = document.getElementById('amenities-note-' + loc.id);
    const allBtns = stepEl.querySelectorAll('.amenity-answer-btn');

    allBtns.forEach(b => b.disabled = true);
    if(note){ note.style.color=''; note.textContent = nearbyWaitNote(); }

    const verification = await verifyNearby(loc, { allowAdmin: true });
    if(!verification.ok){
      if(note){ note.style.color = '#c62828'; note.textContent = verifyFailMessage(verification); }
      allBtns.forEach(b => b.disabled = false);
      return;
    }

    const myVote = myVoteCache[loc.id] || emptyVote();
    const bathroom = isBathroomKey(key);
    const updatedVote = { ...myVote };
    const meta = { ...(myVote.amenityMeta || {}) };

    if(value === 'unknown'){
      // "Not sure" — do NOT persist an answer (the amenity stays unconfirmed and askable). Bump
      // this person's consecutive not-sure counter; at NOT_SURE_RETIRE it's retired for them.
      const prev = (meta[key] && meta[key].notSure) || 0;
      meta[key] = { notSure: prev + 1 };
      updatedVote.amenityMeta = meta;
    } else {
      // A real answer — record it in the right field and reset the not-sure counter (the "2 must
      // be consecutive" rule: a real answer breaks the streak).
      if(bathroom){
        updatedVote.amenities = { ...(myVote.amenities || {}), [key]: value };
      } else {
        updatedVote.storeFeatures = { ...(myVote.storeFeatures || {}), [key]: value };
      }
      if(meta[key]){ meta[key] = { notSure: 0 }; updatedVote.amenityMeta = meta; }
      // Optimistic local tally: the server-side aggregate updates a beat later (Cloud Function),
      // so bump the cached counts now so this answer shows in the confirmed block immediately.
      const cache = bathroom ? amenityCache : storeFeatureCache;
      const s = cache[loc.id] = cache[loc.id] || {};
      const cell = s[key] = s[key] || { yes: 0, no: 0 };
      const prevAns = bathroom ? (myVote.amenities || {})[key] : (myVote.storeFeatures || {})[key];
      // Keyed by the answer value rather than hardcoding yes/no, so changing 'single' to
      // 'multiple' moves the count the same way changing 'yes' to 'no' always has.
      if(prevAns && cell[prevAns] > 0) cell[prevAns]--;
      if(value) cell[value] = (cell[value] || 0) + 1;
    }
    /* Snapshot before committing optimistically. The cached vote and the local tally bump above
     * were applied before the write and never undone on failure, so a rejected answer left the
     * confirmed-by-visitors block showing a count the server never accepted — and the next write
     * for this location would carry the phantom answer along with it. */
    const prevVote = myVoteCache[loc.id];
    const prevCache = JSON.parse(JSON.stringify(bathroom ? (amenityCache[loc.id] || {}) : (storeFeatureCache[loc.id] || {})));
    myVoteCache[loc.id] = updatedVote;

    const ok = await saveMyVote(loc.id, updatedVote);
    if(!ok){
      if(prevVote === undefined) delete myVoteCache[loc.id];
      else myVoteCache[loc.id] = prevVote;
      if(bathroom) amenityCache[loc.id] = prevCache;
      else storeFeatureCache[loc.id] = prevCache;
      if(note){ note.style.color = '#c62828'; note.textContent = saveFailureNote(); }
      allBtns.forEach(b => b.disabled = false);
      return;
    }

    if(note) note.textContent = '';
    if(navigator.vibrate) navigator.vibrate(10);

    // Advance through this visit's question list, then re-render (next question or the thanks note).
    if(visitCursor[loc.id] != null) visitCursor[loc.id] += 1;
    stepEl.innerHTML = renderAmenityStepHtml(updatedVote, loc.id);

    // Refresh whichever summary this answer could affect.
    if(bathroom){
      const fresh = await loadAmenitySummary(loc.id);
      if(summaryEl) summaryEl.innerHTML = amenitySummaryHtml(fresh, loc);
    } else {
      await loadStoreFeatureSummary(loc.id);
      refreshStoreIcons(loc);
    }
    refreshCommunityBlock(loc);   // a just-cast vote may have crossed the confirm threshold
  });
}

async function attachStoreFeatureHandlers(loc){
  await loadStoreFeatureSummary(loc.id);
  refreshStoreIcons(loc);
  refreshCommunityBlock(loc);

  const stepOrig = document.getElementById('store-feature-step-' + loc.id);
  if(!stepOrig) return;
  const stepEl = stepOrig.cloneNode(true);
  stepOrig.parentNode.replaceChild(stepEl, stepOrig);

  stepEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.store-feature-answer-btn');
    if(!btn) return;
    const key = btn.dataset.key;
    const value = btn.dataset.value;
    const note = document.getElementById('store-feature-note-' + loc.id);
    const allBtns = stepEl.querySelectorAll('.store-feature-answer-btn');

    allBtns.forEach(b => b.disabled = true);
    if(note){ note.style.color=''; note.textContent = nearbyWaitNote(); }

    const verification = await verifyNearby(loc, { allowAdmin: true });
    if(!verification.ok){
      if(note){ note.style.color = '#c62828'; note.textContent = verifyFailMessage(verification); }
      allBtns.forEach(b => b.disabled = false);
      return;
    }

    const myVote = myVoteCache[loc.id] || emptyVote();
    const storeFeatures = { ...(myVote.storeFeatures || {}), [key]: value };
    const updatedVote = { ...myVote, storeFeatures };
    /* Snapshot before committing optimistically. The cached vote and the local tally bump above
     * were applied before the write and never undone on failure, so a rejected answer left the
     * confirmed-by-visitors block showing a count the server never accepted — and the next write
     * for this location would carry the phantom answer along with it. */
    const prevVote = myVoteCache[loc.id];
    const prevCache = JSON.parse(JSON.stringify(storeFeatureCache[loc.id] || {}));   // this handler is store-features only
    myVoteCache[loc.id] = updatedVote;

    const ok = await saveMyVote(loc.id, updatedVote);
    if(!ok){
      if(prevVote === undefined) delete myVoteCache[loc.id];
      else myVoteCache[loc.id] = prevVote;
      storeFeatureCache[loc.id] = prevCache;

      if(note){ note.style.color = '#c62828'; note.textContent = saveFailureNote(); }
      allBtns.forEach(b => b.disabled = false);
      return;
    }

    if(note) note.textContent = '';
    if(navigator.vibrate) navigator.vibrate(10);

    stepEl.innerHTML = renderStoreFeatureStepHtml(updatedVote);

    await loadStoreFeatureSummary(loc.id);
    refreshStoreIcons(loc);
  });
}

let _appliedVoteLocIds = new Set();

let _ratingsRunToken = 0;
async function loadAllRatings(){
  // Loads only THIS user's own votes (a handful of docs). Community ratings are NOT bulk-read
  // anymore — that was thousands of reads on every load and after every auth change. Each
  // location's aggregate now loads on demand when its popup opens (one getDoc per open).
  // Run token: several paths trigger this near-simultaneously (authStateReady fires alongside
  // the explicit calls in the login/signup/logout handlers). Only the NEWEST run applies its
  // results to markers/badges; superseded runs stop after their reads. Prevents the double
  // full-application pass the perf baseline showed at startup.
  const _runToken = ++_ratingsRunToken;
  const {db, collection, getDocs, query, where, doc, getDoc, setDoc} = await fb();

  const voteByLoc = {};
  const uid = getEffectiveId();
  try{
    let usedProfileDoc = false;
    // Fast path: ONE read of the user's own profile doc returns all their ratings at once.
    if(isLoggedIn()){
      const uSnap = await getDoc(doc(db, 'users', uid));
      if(uSnap.exists() && uSnap.data().ratings){
        const ratings = uSnap.data().ratings;
        Object.keys(ratings).forEach(locId => { voteByLoc[locId] = { ...emptyVote(), ...ratings[locId] }; });
        usedProfileDoc = true;
      }
    }
    // Fallback: users who rated before the profile doc existed. Read the per-vote docs once, then
    // backfill the profile doc so their NEXT load is a single read.
    if(!usedProfileDoc){
      const mineSnap = await getDocs(query(collection(db, 'votes'), where('clientId', '==', uid)));
      const ratings = {};
      mineSnap.forEach(d => {
        const v = d.data();
        const locId = v.locId || d.id.split('_')[0];
        voteByLoc[locId] = { ...emptyVote(), ...v };
        ratings[locId] = v;
      });
      if(isLoggedIn() && Object.keys(ratings).length){
        // Capped to 40 like every other username write — the users rule bounds it the same way,
        // and this one is swallowed by its own catch, so an over-long name would silently drop
        // the whole one-read backfill and quietly cost a query on every load.
        const uname = displayNameFor();
        // Trim every entry, and skip the mirror entirely past the cap — a document that cannot be
        // written would otherwise keep serving whatever it last held.
        const trimmed = {};
        for(const k of Object.keys(ratings)) trimmed[k] = mirrorEntry(ratings[k]);
        if(Object.keys(trimmed).length <= MIRROR_MAX_LOCATIONS){
          try{ await setDoc(doc(db, 'users', uid), { uid, username: uname, lastUpdated: Date.now(), ratings: trimmed }, { merge: true }); }catch(e){}
        }
      }
    }
  }catch(e){ console.error('my ratings load failed', e); }

  if(_runToken !== _ratingsRunToken) return; // a newer auth state superseded this run

  // Only touch markers whose personal rating state actually changed. The old version rewrote
  // popup HTML and icons for every location after authentication (13,000+ marker mutations),
  // which could exhaust Mobile Safari and make iOS reload the page. Include IDs from the prior
  // identity so logging out or switching accounts correctly clears the old user's rated pins.
  const currentVoteIds = new Set(Object.keys(voteByLoc));
  const changedVoteIds = new Set([..._appliedVoteLocIds, ...currentVoteIds]);
  changedVoteIds.forEach(id => {
    const loc = locationsById[id];
    if(!loc) return;
    const agg = ratingsCache[id] || emptyAgg();
    const myVote = voteByLoc[id] || emptyVote();
    ratingsCache[id] = agg;
    myVoteCache[id] = myVote;
    loadedIds.add(id);
    const marker = markers[id];
    if(marker){
      if(!marker.isPopupOpen()) marker.setIcon(makeIcon(id));
      marker.setPopupContent(popupHtml(loc, agg, myVote));
      if(marker.isPopupOpen()) attachStarHandlers(loc);
    }
  });
  _appliedVoteLocIds = currentVoteIds;
  updateMostRecentBadge();
  updateMyProgressBadge();
  checkAndUnlockAchievements();
  maybeShowSupportPrompt();
  map.invalidateSize(); // header height just changed (badges filled in) — tell Leaflet to recalculate
  perfMark('my ratings applied');
}

// ============================================================
// Achievements & Bathroom Passport
// ============================================================
// Lighthearted, no XP, levels, or streaks — just simple unlockable badges computed
// from data we already have (ratings + check-ins). Unlock records are stored per-identity
// (account UID if logged in, else this device's anonymous ID — consistent with how the rest
// of the app already treats identity) in a new 'achievements' Firestore collection, so this
// works immediately even signed-out, and syncs across devices once you log in.

// Tiered ("leveled") achievement progress: one rolling bar through ascending milestones.
// Reveals after the first milestone, rolls toward the next unreached one, "done" at the top.
function tierProgress(count, tiers){
  const top = tiers[tiers.length - 1];
  let total = top;
  for(const t of tiers){ if(count < t){ total = t; break; } }
  return { done: count >= top, current: Math.min(count, total), total, revealed: count >= tiers[0] };
}
/* ============================================================================
 *  Achievements
 * ============================================================================
 * Rebuilt. Three things were wrong with the previous set and none of them were "too easy":
 *
 *   1. Sixteen of thirty-five stamps paid for the same behaviour — rating volume.
 *   2. Ten paid for a PARTICULAR ANSWER: six for five-star ratings, four for one-star. An
 *      achievement that names a rating value as its goal will change how people rate, and
 *      "give twenty-five 1-star ratings" is a bounty on bad reviews in an app whose entire
 *      value is honest ones. All ten are gone, replaced by Full Range, which can only be
 *      earned by rating across the whole spectrum.
 *   3. Tips, corrections and safety answers — three of the four verbs in the app's own
 *      tagline — had no stamps at all, despite being tracked.
 *
 * RETIRED stamps stay in this list with `retired:true`. Anyone holding one keeps it, dated,
 * and nobody new can earn it. Deleting them would silently take a trophy off a passport for
 * something the holder did nothing wrong to earn.
 */
/* How many stamps a person can actually still get. Retired ones are excluded from every
 * denominator: "4 / 47" would count ten trophies nobody can earn. */
const ACHIEVEMENT_DEFS = [
  // ---------- Rate: volume ----------
  { key:'firstFlush', icon:'🚽', name:'First Flush', desc:'Rate your first bathroom',
    calc:s=>({done:s.bathroomRatedCount>=1,current:Math.min(s.bathroomRatedCount,1),total:1})},
  { key:'gettingStarted', icon:'🧻', name:'Getting Started', desc:'Rate 10 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=10,current:Math.min(s.bathroomRatedCount,10),total:10})},
  { key:'regular', icon:'🚻', name:'Regular', desc:'Rate 50 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=50,current:Math.min(s.bathroomRatedCount,50),total:50})},
  { key:'centuryClub', icon:'💯', name:'Century Club', desc:'Rate 100 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=100,current:Math.min(s.bathroomRatedCount,100),total:100})},
  { key:'hallOfFame', icon:'🏛️', name:'Hall of Fame', desc:'Rate 500 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=500,current:Math.min(s.bathroomRatedCount,500),total:500})},

  // ---------- Rate: honesty ----------
  { key:'fullRange', icon:'🎚️', name:'Full Range', desc:'Give a rating at every level, 1 star through 5',
    calc:s=>({done:s.starLevels>=5,current:Math.min(s.starLevels||0,5),total:5})},
  { key:'secondLook', icon:'🔁', name:'Second Look', desc:'Change a rating you left before',
    calc:s=>({done:s.changedCount>=1,current:Math.min(s.changedCount||0,1),total:1})},

  // ---------- Share: tips ----------
  { key:'firstWord', icon:'💬', name:'First Word', desc:'Write your first tip',
    calc:s=>({done:s.tipsWrittenCount>=1,current:Math.min(s.tipsWrittenCount||0,1),total:1})},
  { key:'localGuide', icon:'🗒️', name:'Local Guide', desc:'Write 10 tips',
    calc:s=>({done:s.tipsWrittenCount>=10,current:Math.min(s.tipsWrittenCount||0,10),total:10})},
  { key:'storyteller', icon:'📖', name:'Storyteller', desc:'Write 50 tips',
    calc:s=>({done:s.tipsWrittenCount>=50,current:Math.min(s.tipsWrittenCount||0,50),total:50})},

  // ---------- Improve: fixing the map ----------
  { key:'fixer', icon:'🔧', name:'Fixer', desc:'Make your first correction — hours, a report, or a new place',
    calc:s=>({done:s.improvementCount>=1,current:Math.min(s.improvementCount||0,1),total:1})},
  { key:'caretaker', icon:'🧰', name:'Caretaker', desc:'Make 10 corrections',
    calc:s=>({done:s.improvementCount>=10,current:Math.min(s.improvementCount||0,10),total:10})},
  { key:'accessibilityScout', icon:'♿', name:'Accessibility Scout', desc:'Answer the accessibility question at 10 stops',
    calc:s=>({done:s.accessibleAnsweredCount>=10,current:Math.min(s.accessibleAnsweredCount,10),total:10})},
  { key:'hoursHero', icon:'🕰️', name:'Hours Hero', desc:'Report hours at stores to help other travelers',
    hidden:true, tiers:[1,5,10,25,50,100],
    calc:s=>tierProgress(s.hoursAddedCount||0, [1,5,10,25,50,100])},

  // ---------- Safety ----------
  { key:'lookout', icon:'👀', name:'Lookout', desc:'Answer “did you feel safe” at 10 stops',
    calc:s=>({done:s.safeAnsweredCount>=10,current:Math.min(s.safeAnsweredCount||0,10),total:10})},
  { key:'guardian', icon:'🛡️', name:'Guardian', desc:'Answer “did you feel safe” at 50 stops',
    calc:s=>({done:s.safeAnsweredCount>=50,current:Math.min(s.safeAnsweredCount||0,50),total:50})},

  // ---------- Find: geography ----------
  { key:'cityHopper', icon:'🏙️', name:'City Hopper', desc:'Rate bathrooms in 15 different cities',
    calc:s=>({done:s.cityCount>=15,current:Math.min(s.cityCount,15),total:15})},
  { key:'roadWarrior', icon:'🛣️', name:'Road Warrior', desc:'Rate bathrooms in 10 different states',
    calc:s=>({done:s.stateCount>=10,current:Math.min(s.stateCount,10),total:10})},
  { key:'nationwide', icon:'🗺️', name:'Nationwide', desc:'Rate bathrooms in 25 different states',
    calc:s=>({done:s.stateCount>=25,current:Math.min(s.stateCount,25),total:25})},
  { key:'crossCountry', icon:'✈️', name:'Cross-Country', desc:'Rate two bathrooms 1,000+ miles apart',
    calc:s=>({done:s.maxMilesApart>=1000,current:Math.min(Math.round(s.maxMilesApart),1000),total:1000})},
  { key:'transcontinental', icon:'🌎', name:'Transcontinental', desc:'Rate two bathrooms 2,500+ miles apart',
    calc:s=>({done:s.maxMilesApart>=2500,current:Math.min(Math.round(s.maxMilesApart),2500),total:2500})},
  { key:'vacationMode', icon:'🧳', name:'Vacation Mode', desc:'Rate bathrooms in 5 states within one week',
    hidden:true, calc:s=>({done:s.maxStatesIn7Days>=5,current:Math.min(s.maxStatesIn7Days,5),total:5})},

  // ---------- Find: chains ----------
  { key:'chainExplorer', icon:'🧭', name:'Chain Explorer', desc:'Rate at least one location at 15 different chains',
    calc:s=>({done:s.chainCount>=15,current:Math.min(s.chainCount,15),total:15})},
  { key:'brandLoyalist', icon:'🏷️', name:'Brand Loyalist', desc:'Rate 10 locations of a single chain',
    calc:s=>({done:s.maxOneChain>=10,current:Math.min(s.maxOneChain,10),total:10})},
  { key:'brandDevotee', icon:'💛', name:'Brand Devotee', desc:'Rate 25 locations of a single chain',
    calc:s=>({done:s.maxOneChain>=25,current:Math.min(s.maxOneChain,25),total:25})},
  { key:'truckStopHero', icon:'🚛', name:'Truck Stop Hero', desc:'Rate 25 travel plazas',
    calc:s=>({done:s.travelPlazaCount>=25,current:Math.min(s.travelPlazaCount,25),total:25})},

  // ---------- Discovery ----------
  { key:'trailblazer', icon:'💎', name:'Trailblazer', desc:'Be the first person ever to rate a location',
    calc:s=>({done:s.firstEverCount>=1,current:Math.min(s.firstEverCount||0,1),total:1})},
  { key:'pathfinder', icon:'🧩', name:'Pathfinder', desc:'Be the first to rate 25 locations',
    calc:s=>({done:s.firstEverCount>=25,current:Math.min(s.firstEverCount||0,25),total:25})},

  // ---------- Cadence ----------
  { key:'marathon', icon:'🏃', name:'Marathon', desc:'Rate 5 bathrooms in a single day',
    calc:s=>({done:s.maxInOneDay>=5,current:Math.min(s.maxInOneDay,5),total:5})},
  { key:'streak', icon:'🔥', name:'Streak', desc:'Rate 3 days in a row',
    calc:s=>({done:s.maxStreak>=3,current:Math.min(s.maxStreak,3),total:3})},
  { key:'onFire', icon:'🌋', name:'On Fire', desc:'Rate 7 days in a row',
    calc:s=>({done:s.maxStreak>=7,current:Math.min(s.maxStreak,7),total:7})},
  { key:'weekendWarrior', icon:'📅', name:'Weekend Warrior', desc:'Rate on 5 weekend days',
    calc:s=>({done:s.weekendCount>=5,current:Math.min(s.weekendCount,5),total:5})},

  // ---------- Seasonal ----------
  { key:'winterWarrior', icon:'❄️', name:'Winter Warrior', desc:'Rate 10 bathrooms in December–February',
    hidden:true, calc:s=>({done:s.winterCount>=10,current:Math.min(s.winterCount||0,10),total:10})},
  { key:'summerRoadTrip', icon:'🌞', name:'Summer Road Trip', desc:'Rate 10 bathrooms in June–August',
    hidden:true, calc:s=>({done:s.summerCount>=10,current:Math.min(s.summerCount||0,10),total:10})},

  // ---------- Flavour ----------
  { key:'earlyBird', icon:'🌅', name:'Early Bird', desc:'Rate before 5:00 AM',
    calc:s=>({done:s.hasEarlyBird,current:s.hasEarlyBird?1:0,total:1})},
  { key:'nightOwl', icon:'🦉', name:'Night Owl', desc:'Rate between midnight and 4:00 AM',
    calc:s=>({done:s.hasNightOwl,current:s.hasNightOwl?1:0,total:1})},
  { key:'fourSeasons', icon:'🍂', name:'Four Seasons', desc:'Rate in all four seasons — takes a year',
    hidden:true, calc:s=>({done:s.seasonCount>=4,current:Math.min(s.seasonCount||0,4),total:4})},

  /* ---------- Retired ----------
   * No longer obtainable. Kept so holders keep them: the passport reads stored unlocks, so a
   * deleted definition would quietly erase an earned stamp. `retired` hides them from "still to
   * earn" without hiding them from the people who have them. */
  { key:'halfCentury', icon:'🎯', name:'Half Century', desc:'Rate 50 bathrooms', retired:true,
    calc:s=>({done:false,current:0,total:50})},
  { key:'explorerElite', icon:'🎓', name:'Explorer Elite', desc:'Rate 250 bathrooms', retired:true,
    calc:s=>({done:false,current:0,total:250})},
  { key:'bathroomLegend', icon:'👑', name:'Bathroom Legend', desc:'Rate 500 bathrooms', retired:true,
    calc:s=>({done:false,current:0,total:500})},
  { key:'critic', icon:'⭐', name:'Critic', desc:'Give a 5-star rating', retired:true,
    calc:s=>({done:false,current:0,total:1})},
  { key:'perfectionist', icon:'✨', name:'Perfectionist', desc:'Give ten 5-star ratings', retired:true,
    calc:s=>({done:false,current:0,total:10})},
  { key:'cleanFreak', icon:'🧼', name:'Clean Freak', desc:'Give twenty-five 5-star ratings', retired:true,
    calc:s=>({done:false,current:0,total:25})},
  { key:'toughCrowd', icon:'💢', name:'Tough Crowd', desc:'Give a 1-star rating', retired:true,
    calc:s=>({done:false,current:0,total:1})},
  { key:'ironStomach', icon:'🤢', name:'Iron Stomach', desc:'Give twenty-five 1-star ratings', retired:true,
    calc:s=>({done:false,current:0,total:25})},
  { key:'hiddenGemHunter', icon:'💠', name:'Hidden Gem Hunter', desc:'Rate a spot that had fewer than 5 reviews', retired:true,
    calc:s=>({done:false,current:0,total:1})},
  { key:'gemCollector', icon:'🔷', name:'Gem Collector', desc:'Rate 5 hidden gems', retired:true,
    calc:s=>({done:false,current:0,total:5})},
];

/* The back of a stamp.
 *
 * An earned stamp showed icon, name and date, and put its criterion in a `title` attribute —
 * a hover tooltip, which does nothing at all on a phone. So the moment you earned something,
 * the app stopped telling you what you had done for it.
 *
 * A tile is about 78px across, which at legible size is roughly 50 characters. Several
 * descriptions run past that ("Make your first correction — hours, a report, or a new place"
 * is 60), so the back gets its own terse line rather than a truncated one. Kept as a map
 * rather than a field on each def so the definitions stay about the RULES. */
const STAMP_SHORT = {
  firstFlush:'1 rating', gettingStarted:'10 ratings', regular:'50 ratings',
  centuryClub:'100 ratings', hallOfFame:'500 ratings',
  fullRange:'Every star, 1–5', secondLook:'Changed a rating',
  firstWord:'1 tip', localGuide:'10 tips', storyteller:'50 tips',
  fixer:'1 correction', caretaker:'10 corrections',
  accessibilityScout:'Access at 10 stops', hoursHero:'Hours reported',
  lookout:'Safety at 10 stops', guardian:'Safety at 50 stops',
  cityHopper:'15 cities', roadWarrior:'10 states', nationwide:'25 states',
  crossCountry:'1,000 mi apart', transcontinental:'2,500 mi apart',
  vacationMode:'5 states in a week',
  chainExplorer:'15 chains', brandLoyalist:'10 of one chain',
  brandDevotee:'25 of one chain', truckStopHero:'25 travel plazas',
  trailblazer:'First ever to rate', pathfinder:'First at 25 places',
  marathon:'5 in one day', streak:'3 days running', onFire:'7 days running',
  weekendWarrior:'5 weekend days',
  winterWarrior:'10 in winter', summerRoadTrip:'10 in summer',
  earlyBird:'Before 5 AM', nightOwl:'After midnight', fourSeasons:'All four seasons',
  // retired
  halfCentury:'50 ratings', explorerElite:'250 ratings', bathroomLegend:'500 ratings',
  critic:'A 5-star rating', perfectionist:'Ten 5-stars', cleanFreak:'Twenty-five 5-stars',
  toughCrowd:'A 1-star rating', ironStomach:'Twenty-five 1-stars',
  hiddenGemHunter:'Under 5 reviews', gemCollector:'5 hidden gems',
};
function stampShort(def){ return STAMP_SHORT[def.key] || def.desc; }

/* Tap a stamp to turn it over.
 *
 * Delegated from the document because the grid is rebuilt on every passport render, so binding
 * per tile would leak listeners and miss any stamp earned since the last bind.
 *
 * Only one is face-down at a time. A wall of turned-over stamps is a wall of text with no
 * trophies left in it, and the front is the thing worth looking at. */
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-stamp]');
  if(!btn) return;
  const wasOpen = btn.getAttribute('aria-pressed') === 'true';
  document.querySelectorAll('[data-stamp][aria-pressed="true"]')
    .forEach(el => el.setAttribute('aria-pressed', 'false'));
  btn.setAttribute('aria-pressed', String(!wasOpen));
  if(!wasOpen && navigator.vibrate) navigator.vibrate(8);
});


/* The four verbs from the lockup — FIND. RATE. SHARE. IMPROVE. — used as the structure of the
 * passport, the same way they label the numbers in the settings footer.
 *
 * Thirty-seven stamps in one flat grid is a wall, and nothing in it tells you what any of them
 * are FOR. Grouped, the passport answers a question it could not answer before: which kind of
 * contributor are you, and where are the gaps.
 *
 * RATE holds sixteen of the thirty-seven, which is lopsided but true — rating is the core act
 * and everything about volume, honesty, cadence and timing belongs to it. The alternative was
 * inventing groups to even the columns out, which would be a nicer chart and a worse map of
 * what the app is.
 *
 * Safety sits under SHARE rather than RATE: you are telling the next person whether to stop,
 * which is the same job a tip does. */
const STAMP_GROUPS = [
  { id:'find',    label:'Find',    blurb:'Places you have been' },
  { id:'rate',    label:'Rate',    blurb:'Bathrooms you have judged' },
  { id:'share',   label:'Share',   blurb:'What you have told others' },
  { id:'improve', label:'Improve', blurb:'The map you have fixed' },
];
const STAMP_GROUP_OF = {
  cityHopper:'find', roadWarrior:'find', nationwide:'find', crossCountry:'find',
  transcontinental:'find', vacationMode:'find', chainExplorer:'find', brandLoyalist:'find',
  brandDevotee:'find', truckStopHero:'find', trailblazer:'find', pathfinder:'find',

  firstFlush:'rate', gettingStarted:'rate', regular:'rate', centuryClub:'rate', hallOfFame:'rate',
  fullRange:'rate', secondLook:'rate', marathon:'rate', streak:'rate', onFire:'rate',
  weekendWarrior:'rate', winterWarrior:'rate', summerRoadTrip:'rate', earlyBird:'rate',
  nightOwl:'rate', fourSeasons:'rate',

  firstWord:'share', localGuide:'share', storyteller:'share', lookout:'share', guardian:'share',

  fixer:'improve', caretaker:'improve', accessibilityScout:'improve', hoursHero:'improve',

  /* Retired stamps keep a group so they sit with their own kind rather than in a bin at the
   * bottom — a Clean Freak stamp is still a rating stamp. */
  halfCentury:'rate', explorerElite:'rate', bathroomLegend:'rate', critic:'rate',
  perfectionist:'rate', cleanFreak:'rate', toughCrowd:'rate', ironStomach:'rate',
  hiddenGemHunter:'find', gemCollector:'find',
};
function stampGroup(def){ return STAMP_GROUP_OF[def.key] || 'rate'; }

const OBTAINABLE_COUNT = ACHIEVEMENT_DEFS.filter(d => !d.retired).length;

// We don't have real county data in locations.js, only addresses — so "County Collector"
// uses the city pulled from each address as a rough stand-in for "different areas visited"
// rather than an actual county. Swap this out if/when real county data gets added.
function getCityFromAddress(addr){
  if(!addr) return 'Unknown';
  const parts = addr.split(',').map(p => p.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

/* Prefer the state the data already carries.
 *
 * stateFromAddr parses "…, Albany, NY 12205" out of an address string, which works for the
 * chain datasets and fails completely for public restrooms: all 56,005 of them have an EMPTY
 * address, because OSM toilet nodes rarely carry one. What they do have is meta.state, written
 * by build-public-toilets.js from the state file each record came out of — 100% populated, and
 * read nowhere until now.
 *
 * So every geography achievement silently ignored two thirds of the map. Not because a region
 * had not downloaded — because the parser was looking in the only field these records leave
 * blank. */
/* A tiny local record of WHERE each rated location was.
 *
 * A vote stores only a locId. Resolving that to a state or a chain needs the location record,
 * and public restrooms live in region files that load on demand — so opening your passport
 * after driving somewhere else silently dropped every rating outside the loaded regions from
 * the geography and chain achievements.
 *
 * The fix is that at the moment of rating, the record IS loaded: you tapped its pin. So the two
 * fields those achievements need get copied then, keyed by locId, and the achievements read
 * this when the location itself is unavailable. No server change, no rules change, and no
 * 18 MB download to count your own history.
 *
 * Older ratings backfill themselves the next time their region happens to load. */
const RATED_META_KEY = 'br_rated_meta';
function ratedMeta(){
  try{ return JSON.parse(localStorage.getItem(RATED_META_KEY) || '{}') || {}; }catch(e){ return {}; }
}
function rememberRatedMeta(loc){
  if(!loc || !loc.id) return;
  try{
    const m = ratedMeta();
    const st = stateOf(loc);
    const entry = {};
    if(st) entry.s = st;
    if(loc.chain) entry.c = loc.chain;
    if(typeof loc.lat === 'number' && typeof loc.lng === 'number'){ entry.y = loc.lat; entry.x = loc.lng; }
    const city = (typeof getCityFromAddress === 'function') ? getCityFromAddress(loc.addr) : '';
    if(city) entry.t = city;
    if(!Object.keys(entry).length) return;
    m[loc.id] = entry;
    localStorage.setItem(RATED_META_KEY, JSON.stringify(m));
  }catch(e){ /* private mode — achievements degrade to loaded-only, as before */ }
}

function stateOf(loc){
  if(!loc) return null;
  if(loc.meta && loc.meta.state) return loc.meta.state;
  return stateFromAddr(loc.addr);
}
function stateFromAddr(addr){
  if(!addr) return null;
  let m = addr.match(/\b([A-Z]{2})\b\s*\d{5}/);
  if(m) return m[1];
  const parts = addr.split(',').map(p=>p.trim());
  m = (parts[parts.length-1]||'').match(/\b([A-Z]{2})\b/);
  return m ? m[1] : null;
}
function longestConsecutiveDayStreak(dayKeySet){
  const days = [...dayKeySet].map(x=>{const d=new Date(x);d.setHours(0,0,0,0);return d.getTime();}).sort((a,b)=>a-b);
  if(!days.length) return 0;
  let best=1, run=1;
  for(let i=1;i<days.length;i++){
    const diff = Math.round((days[i]-days[i-1])/864e5);
    if(diff===1){ run++; best=Math.max(best,run); }
    else if(diff>1){ run=1; }
  }
  return best;
}
// Achievements derive entirely from your own votes (already in myVoteCache) joined with the
// bundled location data — states, chains, cities, coordinates, and each rating's ratedAt.
// No check-in reads, no extra queries: zero Firestore reads beyond the Passport's votes load.
async function computeAchievementStats(){
  /* TWO lists, because a rating and the place it was left have different availability.
   *
   * `rated` used to be the only one, and it dropped any vote whose location was not in
   * seedLocations — which holds only what has been DOWNLOADED this session. Public restrooms
   * load region by region, so someone who rated eleven places and came back without panning to
   * those regions saw a passport claiming one rating. Their own history, hidden by a caching
   * detail.
   *
   * The vote itself carries everything a COUNT needs. Only the geographic and per-chain
   * achievements need the location record, and those degrade honestly: an unloaded region
   * cannot contribute a state or a chain, but it can no longer erase the rating as well.
   *
   * locationsById rather than seedLocations.find — the latter is a linear scan of 84,000
   * records run once per vote. */
  const meta = ratedMeta();
  const ratedAll = [];      // every rating
  const rated = [];         // every rating we can place on a map, loaded or remembered
  Object.keys(myVoteCache).forEach(id => {
    const v = myVoteCache[id];
    if(!v || !(v.bathroom > 0)) return;
    const entry = { bathroom: v.bathroom, ratedAt: v.ratedAt || null, wasHiddenGem: !!v.wasHiddenGem,
                    wasFirst: !!v.wasFirst, wasChanged: !!v.wasChanged, safe: v.safe || 0 };
    ratedAll.push(entry);
    /* The live record if its region is loaded; otherwise the snapshot taken when it was rated.
     * The snapshot carries only what the achievements need, which is why it can be kept for
     * every rating without becoming a second copy of the map. */
    const live = locationsById[id];
    const m = meta[id];
    if(live) rated.push({ ...entry, loc: live });
    else if(m) rated.push({ ...entry, loc: {
      id, addr: '', chain: m.c, lat: m.y, lng: m.x,
      meta: m.s ? { state: m.s } : {}, _city: m.t } });
  });

  const bathroomRatedCount = ratedAll.length;
  const fiveStarCount = ratedAll.filter(r => r.bathroom === 5).length;
  const oneStarCount  = ratedAll.filter(r => r.bathroom === 1).length;
  const hiddenGemCount = ratedAll.filter(r => r.wasHiddenGem).length;
  const firstEverCount = ratedAll.filter(r => r.wasFirst).length;
  const changedCount   = ratedAll.filter(r => r.wasChanged).length;
  /* Full Range: how many of the five star levels you have ever used. Rewards rating across the
   * spectrum, which is the opposite of what a "give 25 one-star ratings" stamp rewards. */
  const starLevels = new Set(ratedAll.map(r => r.bathroom).filter(n => n >= 1 && n <= 5)).size;
  /* Safety answers, counted from the votes rather than a local store so they survive a new
   * device the same way ratings do. */
  const safeAnsweredCount = Object.values(myVoteCache).filter(v => v && v.safe > 0).length;

  const states = new Set(), cities = new Set(), chainCounts = {};
  rated.forEach(r => {
    const st = stateOf(r.loc); if(st) states.add(st);
    /* _city is the remembered value for a location whose record is not loaded; the parser
     * would return nothing from the empty address on a snapshot. */
    const city = r.loc._city || getCityFromAddress(r.loc.addr);
    if(city) cities.add(city);
    const ck = r.loc.chain || DEFAULT_CHAIN_KEY;
    chainCounts[ck] = (chainCounts[ck] || 0) + 1;
  });
  const maxOneChain = Object.values(chainCounts).reduce((m,n)=>Math.max(m,n), 0);

  let hasEarlyBird=false, hasNightOwl=false, hasWinter=false, hasSummer=false;
  let winterCount=0, summerCount=0;
  const seasons = new Set();
  const weekendDays = new Set(), dayCounts = {}, dayKeys = new Set();
  rated.forEach(r => {
    if(!r.ratedAt) return;                       // time-based stats need a ratedAt timestamp
    const d = new Date(r.ratedAt), h = d.getHours(), dow = d.getDay(), key = d.toDateString(), mo = d.getMonth();
    if(h < 5) hasEarlyBird = true;
    if(h >= 0 && h < 4) hasNightOwl = true;
    seasons.add(mo <= 1 || mo === 11 ? 'w' : mo <= 4 ? 'sp' : mo <= 7 ? 'su' : 'f');
    if(mo === 11 || mo === 0 || mo === 1){ hasWinter = true; winterCount++; }   // Dec–Feb
    if(mo >= 5 && mo <= 7){ hasSummer = true; summerCount++; }   // Jun–Aug
    if(dow === 0 || dow === 6) weekendDays.add(key);
    dayCounts[key] = (dayCounts[key] || 0) + 1;
    dayKeys.add(key);
  });
  const maxInOneDay = Object.values(dayCounts).reduce((m,n)=>Math.max(m,n), 0);

  let maxMilesApart = 0;                          // farthest-apart pair (n = your own ratings)
  for(let i=0;i<rated.length;i++)
    for(let j=i+1;j<rated.length;j++){
      const d = milesBetween(rated[i].loc.lat, rated[i].loc.lng, rated[j].loc.lat, rated[j].loc.lng);
      if(d > maxMilesApart) maxMilesApart = d;
    }

  // How many of your ratings include a definitive accessibility answer (yes/no) — powers the
  // Accessibility Scout badge, which nudges people at the app's biggest data gap.
  const accessibleAnsweredCount = Object.values(myVoteCache).filter(v =>
    v && v.amenities && (v.amenities.accessible === 'yes' || v.amenities.accessible === 'no')
  ).length;

  // Truck Stop Hero — ratings at the big interstate travel-center chains. Uses the single
  // canonical set; the local copy this replaced omitted travelCentersOfAmerica, so rating a TA
  // never counted toward the achievement.
  const travelPlazaCount = rated.filter(r => TRAVEL_CENTER_KEYS.has(r.loc.chain)).length;

  // Vacation Mode — most distinct states rated within any single 7-day window.
  const stateDated = rated
    .filter(r => r.ratedAt && stateOf(r.loc))
    .map(r => ({ t: r.ratedAt, st: stateOf(r.loc) }))
    .sort((a, b) => a.t - b.t);
  let maxStatesIn7Days = 0;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  for(let i = 0; i < stateDated.length; i++){
    const w = new Set();
    for(let j = i; j < stateDated.length && stateDated[j].t - stateDated[i].t <= WEEK_MS; j++) w.add(stateDated[j].st);
    if(w.size > maxStatesIn7Days) maxStatesIn7Days = w.size;
  }

  return {
    bathroomRatedCount, fiveStarCount, oneStarCount, hiddenGemCount, accessibleAnsweredCount,
    stateCount: states.size, cityCount: cities.size,
    chainCount: Object.keys(chainCounts).length, maxOneChain,
    totalChains: Object.keys(CHAIN_REGISTRY).length,
    hasEarlyBird, hasNightOwl, hasWinter, hasSummer, weekendCount: weekendDays.size,
    winterCount, summerCount, seasonCount: seasons.size,
    firstEverCount, changedCount, starLevels, safeAnsweredCount,
    travelPlazaCount, maxStatesIn7Days,
    maxInOneDay, maxStreak: longestConsecutiveDayStreak(dayKeys), maxMilesApart,
    visitedCount: bathroomRatedCount, totalLocations: seedLocations.length,
    // Hours Hero: distinct stores this device has reported hours for (client-trusted, like the
    // other achievement stats). Populated by markHoursReported() on each successful report.
    hoursAddedCount: (() => { try { return new Set(JSON.parse(localStorage.getItem('br_hours_reported') || '[]')).size; } catch(e){ return 0; } })(),
    // SHARE and IMPROVE in the footer creed. Derived here so the footer, the passport and any
    // future achievement all read the same number rather than each computing its own.
    tipsWrittenCount: countTipsWritten(),
    improvementCount: countImprovements()
  };
}

async function loadStoredAchievements(){
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'achievements', getEffectiveId()));
    return snap.exists() ? (snap.data().achievements || {}) : {};
  }catch(e){
    console.error('loadStoredAchievements failed (non-fatal)', e);
    return {};
  }
}

async function saveStoredAchievements(achievements){
  try{
    const {db, doc, setDoc} = await fb();
    await setDoc(doc(db, 'achievements', getEffectiveId()), { achievements }, { merge: true });
  }catch(e){
    console.error('saveStoredAchievements failed (non-fatal)', e);
  }
}

// ---- Leaderboard ("Top Reviewers") — 2 reads total: the top-10 doc + your own userStats doc.
// Both maintained server-side by the Cloud Function, so cost is constant regardless of user count.
let _leaderboardLoaded = false;
/* NOTE (audit 2026-07-30): #leaderboardList does not exist in index.html, so this returns
 * immediately and the leaderboard never renders. The whole path is inert by design for now —
 * no Cloud Function writes the `leaderboard` collection either (see firestore.rules). Kept
 * rather than deleted because Community/leaderboard is a planned feature and this is the
 * working reader; the missing piece is the UI. The same applies to updateMyProgressBadge()
 * and the support-prompt overlay below. */
async function loadLeaderboard(){
  const listEl = document.getElementById('leaderboardList');
  const youEl = document.getElementById('leaderboardYou');
  if(!listEl) return;
  if(_leaderboardLoaded) return;           // once per session
  _leaderboardLoaded = true;
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'leaderboard', 'top'));   // 1 read: whole board
    const top = (snap.exists() && Array.isArray(snap.data().top)) ? snap.data().top : [];
    if(!top.length){
      listEl.innerHTML = '<div class="lb-empty">No ratings yet — be the first to make the board.</div>';
      if(youEl) youEl.textContent = '';
      return;
    }
    const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
    const myUid = getEffectiveId();
    listEl.innerHTML = top.map((e, i) => {
      const mine = e.uid === myUid ? ' lb-mine' : '';
      const n = esc(e.username || 'anon');
      const cnt = e.count === 1 ? '1 rating' : `${e.count} ratings`;
      return `<div class="lb-row${mine}"><span class="lb-rank">${medal(i)}</span><span class="lb-name">${n}</span><span class="lb-count">${cnt}</span></div>`;
    }).join('');

    // Your own rank line — only if logged in and NOT already visible in the top 10.
    if(youEl){
      youEl.textContent = '';
      if(isLoggedIn() && !top.some(e => e.uid === myUid)){
        try{
          const meSnap = await getDoc(doc(db, 'userStats', myUid));   // 1 read: your rank
          if(meSnap.exists()){
            const me = meSnap.data();
            if(me && me.count > 0){
              const cnt = me.count === 1 ? '1 rating' : `${me.count} ratings`;
              youEl.innerHTML = `<div class="lb-row lb-mine lb-you"><span class="lb-rank">You</span><span class="lb-name">${esc(me.username||'')}</span><span class="lb-count">${cnt}</span></div>`;
            }
          }
        }catch(e){/* your-rank is a nice-to-have; skip on failure */}
      }
    }
  }catch(e){
    _leaderboardLoaded = false;   // allow retry
    if(listEl) listEl.innerHTML = '<div class="lb-empty">Leaderboard unavailable right now.</div>';
  }
}

function showAchievementToast(def){
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `<div class="achievement-toast-icon">${def.icon}</div><div><div class="achievement-toast-title">Achievement unlocked!</div><div class="achievement-toast-name">${def.name}</div></div>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

async function checkAndUnlockAchievements(){
  const stats = await computeAchievementStats();
  const stored = await loadStoredAchievements();
  let changed = false;
  const results = {};

  ACHIEVEMENT_DEFS.forEach(def => {
    const calc = def.calc(stats);
    const prior = stored[def.key];
    const wasUnlocked = !!(prior && prior.unlocked);
    let unlockedAt = prior && prior.unlockedAt;

    if(calc.done && !wasUnlocked){
      unlockedAt = Date.now();
      stored[def.key] = { unlocked: true, unlockedAt };
      changed = true;
      showAchievementToast(def);
    } else if(!stored[def.key]){
      stored[def.key] = { unlocked: calc.done };
    }

    results[def.key] = { ...def, unlocked: calc.done, unlockedAt: calc.done ? unlockedAt : null, current: calc.current, total: calc.total, revealed: calc.revealed };
  });

  if(changed) await saveStoredAchievements(stored);
  renderBathroomPassport(stats, results);
  return { results, stats };
}

function renderBathroomPassport(stats, results){
  const container = document.getElementById('bathroomPassportBody');
  if(!container) return;
  const pct = stats.totalLocations > 0 ? ((stats.visitedCount / stats.totalLocations) * 100).toFixed(1) : '0.0';
  const unlockedCount = Object.values(results).filter(r => r.unlocked).length;
  /* Published for the settings sheet's header chip. Computed here anyway, and reaching into this
   * function's locals from outside would be worse than handing the number over deliberately. */
  ssStampCount = unlockedCount;
  ssCreedStats = {
    rated: stats.bathroomRatedCount,
    tips:  stats.tipsWrittenCount,
    fixes: stats.improvementCount,
  };
  /* The card's reverse. Filled from the same stats object the front and the achievements use,
   * so the two faces can never disagree about the same number. */
  const setBack = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  setBack('pbRated',  stats.bathroomRatedCount);
  setBack('pbStates', stats.stateCount);
  setBack('pbCities', stats.cityCount);
  setBack('pbChains', stats.chainCount);
  setBack('pbStreak', stats.maxStreak);
  setBack('pbMiles',  Math.round(stats.maxMilesApart));
  const note = document.getElementById('pbNote');
  if(note){
    /* One line that reads like a sentence rather than a seventh tile — and it says nothing at
     * all until there is something true to say, since "0 states, 0 miles" is a worse greeting
     * for a new account than silence. */
    note.textContent = stats.bathroomRatedCount === 0
      ? 'Rate your first bathroom and it will show up here.'
      : `${unlockedCount} of ${OBTAINABLE_COUNT} stamps collected.`;
  }
  if(typeof ssSyncIdentity === 'function' && !document.getElementById('settingsSheet')?.hidden) ssSyncIdentity();

  /* Progress is stamps collected, not percent of the map.
   *
   * It used to show visited/totalLocations, which is a share of 28,074 — that reads "0.0%
   * complete" after three ratings and will keep reading 0.0% for years. Technically true, and a
   * discouraging first thing to see in your own passport. Stamps are finite and finishable, so
   * they are the number worth putting at the top; the map count stays below as context. */
  const stampPct = OBTAINABLE_COUNT ? (unlockedCount / OBTAINABLE_COUNT) * 100 : 0;
  const issued = (() => {
    const u = window.__currentUser;
    const t = u && u.metadata && u.metadata.creationTime ? new Date(u.metadata.creationTime) : null;
    return t && !isNaN(t) ? t.toLocaleDateString(undefined, { month:'short', year:'numeric' }) : '—';
  })();

  const setTxt = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  setTxt('dpName', displayNameFor() || 'You');
  setTxt('dpIssued', issued);
  setTxt('dpStamps', `${unlockedCount} / ${OBTAINABLE_COUNT}`);
  setTxt('dpRated', stats.bathroomRatedCount);

  /* The bar is a seam on the card, above the flip strip — progress belongs to the document, not
   * to a block floating between the card and the stamps. What used to sit here repeated STAMPS
   * 4/35 from the card immediately below it, and reintroduced "places visited · 0.0%" — the
   * number dropped from the headline for being discouraging — as a footnote. */
  const bar = document.getElementById('dpProgress');
  const fill = document.getElementById('dpProgressFill');
  if(fill) fill.style.width = Math.min(100, stampPct) + '%';
  if(bar){
    bar.setAttribute('aria-valuenow', String(Math.round(stampPct)));
    // Screen readers get the counts, since the bar alone conveys nothing to them.
    bar.setAttribute('aria-valuetext', `${unlockedCount} of ${OBTAINABLE_COUNT} stamps collected`);
  }
  container.innerHTML = '';

  const listEl = document.getElementById('achievementsList');
  if(listEl){
    /* Order: earned first, in the order you earned them, then the ones you are closest to.
     *
     * The list was in a fixed thematic order — milestones, chains, geography, dedication,
     * data-help, hidden. That order tells you how the set was DESIGNED, which is of no use to
     * someone opening their own passport: what they earned last is buried in the middle, and the
     * one they are two ratings away from is indistinguishable from the one needing five hundred.
     *
     *   1. unlocked, oldest first — reads as a history of what you have done
     *   2. locked, by how close you are — the next one to chase is at the top of what is left
     *   3. still-hidden trophies last, since a masked card sorts on nothing meaningful
     *
     * Achievements unlocked before unlockedAt was recorded have no date. They sort as oldest,
     * which is true: they were earned before we started keeping track. */
    const ordered = ACHIEVEMENT_DEFS.slice().sort((a, b) => {
      const ra = results[a.key], rb = results[b.key];
      const tiered = (d, r) => Array.isArray(d.tiers) && r.revealed;
      const secretA = a.hidden && !ra.unlocked && !tiered(a, ra);
      const secretB = b.hidden && !rb.unlocked && !tiered(b, rb);

      const rank = (r, secret) => r.unlocked ? 0 : (secret ? 2 : 1);
      const diff = rank(ra, secretA) - rank(rb, secretB);
      if(diff !== 0) return diff;

      if(ra.unlocked && rb.unlocked) return (ra.unlockedAt || 0) - (rb.unlockedAt || 0);

      if(!secretA && !secretB){
        // Fraction complete, descending. total can be 1 for a binary achievement, which lands at
        // 0 and sorts below anything with real partial progress — correct: you have not started.
        const frac = (r) => (r.total > 0 ? (r.current || 0) / r.total : 0);
        const f = frac(rb) - frac(ra);
        if(f !== 0) return f;
      }
      // Stable tail: fall back to the designed order so the list never reshuffles arbitrarily.
      return ACHIEVEMENT_DEFS.indexOf(a) - ACHIEVEMENT_DEFS.indexOf(b);
    });

    /* Earned achievements render as STAMPS, locked ones stay as rows.
     *
     * The two are not the same kind of thing. An earned one is a trophy — you already know what
     * it was for, and what you want is to see it. A locked one is an instruction: a stamp reading
     * "GEM COLLECTOR" tells you nothing about how to get it, and the description is the entire
     * point of showing it at all.
     *
     * Eight stamps fit where three rows did, so the earned ones stop being a scroll. The order
     * computed above still holds within each group. */
    const earned = ordered.filter(d => results[d.key].unlocked);
    const rest   = ordered.filter(d => !results[d.key].unlocked);

    // Deterministic tilt from the key, not the index: a stamp must not jump to a new angle
    // because an earlier one was unlocked. Real stamps land where they land and stay.
    const tilt = (key) => {
      let h = 0;
      for(let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
      return (((h % 100) / 100) * 5 - 2.5).toFixed(2);   // -2.5deg … +2.5deg
    };

    const stampHtml = (def) => {
      const r = results[def.key];
      const d = r.unlockedAt ? new Date(r.unlockedAt) : null;
      // Short date in a document hand: "22 JUL 26", not "7/22/2026".
      const dateStr = d ? d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' }).toUpperCase() : '';
      /* A button, not a div: it is tappable, so it has to be reachable by keyboard and
       * announced as a control. aria-label carries the whole thing for a screen reader, which
       * never sees the flip at all. */
      return `<button type="button" class="stamp${def.retired ? ' stamp-retired' : ''}" style="--tilt:${tilt(def.key)}deg"
        data-stamp="${def.key}" aria-pressed="false"
        aria-label="${escapeHtml(def.name)} — ${escapeHtml(stampShort(def))}${dateStr ? ', earned ' + dateStr : ''}${def.retired ? ', retired' : ''}">
        <span class="stamp-face stamp-front">
          <span class="stamp-ico" aria-hidden="true">${def.icon}</span>
          <span class="stamp-name">${escapeHtml(def.name)}</span>
          ${dateStr ? `<span class="stamp-date">${dateStr}</span>` : ''}
        </span>
        <span class="stamp-face stamp-back">
          <span class="stamp-how">${escapeHtml(stampShort(def))}</span>
          ${def.retired ? '<span class="stamp-tag">retired</span>' : ''}
        </span>
      </button>`;
    };

    /* Retired stamps are unobtainable, so listing them under "Still to earn" would be an
     * instruction nobody can follow. They still render as earned for anyone holding one. */
    const rowHtml = (def) => {
      const r = results[def.key];
      // A tiered achievement (Hours Hero) reveals after its first milestone and then shows a
      // rolling bar, unlike binary hidden trophies which stay masked until fully earned.
      const tiered = Array.isArray(def.tiers);
      const secret = def.hidden && !(tiered && r.revealed);
      const icon = secret ? '❓' : def.icon;
      const name = secret ? 'Hidden Trophy' : def.name;
      const desc = secret ? 'Keep exploring to reveal this one.' : def.desc;
      const progressStr = (!secret && r.total > 1) ? `${r.current} / ${r.total}` : '';
      return `<div class="achievement-card locked${secret ? ' hidden-trophy' : ''}">
        <div class="achievement-icon">${icon}</div>
        <div class="achievement-info">
          <div class="achievement-name">${escapeHtml(name)}</div>
          <div class="achievement-desc">${escapeHtml(desc)}</div>
          ${progressStr ? `<div class="achievement-progress">${progressStr}</div>` : ''}
        </div>
      </div>`;
    };

    /* The stamps you hold stay together, directly under the card.
     *
     * An earlier pass split them into the four verb sections, which put the collection in four
     * piles and buried the reward under the roadmap. A passport is a page of stamps; that IS
     * the thing worth looking at, and it should read as one wall.
     *
     * The verbs group what is LEFT, which is where grouping actually helps — it turns a list of
     * thirty-odd unearned trophies into "you have done nothing under SHARE", which is a far
     * more useful thing to learn than the alphabetical order they used to sit in. */
    const sections = STAMP_GROUPS.map(g => {
      const mine = earned.filter(d => stampGroup(d) === g.id);
      const left = rest.filter(d => stampGroup(d) === g.id && !d.retired);
      if(!left.length) return '';
      /* The count still reports the whole group, earned included — "1/12" is the useful number
       * even in a section that only lists the eleven you have not got. */
      return `<div class="stamp-group">
        <div class="sg-head">
          <span class="sg-verb">${g.label}</span>
          <span class="sg-blurb">${escapeHtml(g.blurb)}</span>
          <span class="sg-count">${mine.length}/${mine.length + left.length}</span>
        </div>
        <div class="sg-left">${left.map(rowHtml).join('')}</div>
      </div>`;
    }).join('');

    listEl.innerHTML =
      (earned.length ? `<div class="stamp-grid">${earned.map(stampHtml).join('')}</div>` : '')
      + (sections ? `<div class="plate stamp-todo"><span>${earned.length ? 'Still to earn' : 'Collect your first'}</span><i></i></div>${sections}` : '');
  }
}

// Simple personal progress — how many of the total locations you've rated, no tiers/gamification
function updateMyProgressBadge(){
  const el = document.getElementById('myProgressBadge');
  if(!el) return;
  let count = 0;
  for(const id in myVoteCache){
    const v = myVoteCache[id];
    if(v && (v.store > 0 || v.bathroom > 0)) count++;
  }
  const total = seedLocations.length;
  const remaining = total - count;
  el.textContent = count === 0
    ? `📍 0 of ${total} Shops rated — ${total} to go`
    : `📍 ${count} of ${total} Shops rated — ${remaining} to go`;
  refreshStatTicker();
}

// Auto-rotating ticker — cycles through whichever stat pills currently have content, one at
// a time, instead of requiring a manual horizontal swipe to see them all.
let statTickerIndex = 0;
let statTickerInterval = null;
function refreshStatTicker(){
  const pills = ['myProgressBadge', 'weeklyRecap', 'mostRecentBadge']
    .map(id => document.getElementById(id))
    .filter(el => el && el.textContent.trim() !== '');
  pills.forEach(el => el.classList.remove('ticker-active'));
  const row = document.getElementById('statPillRow');
  // Tells the CSS to show one at a time. Set here rather than in the markup so a failure to run
  // this leaves every pill visible instead of hiding the lot.
  if(row) row.classList.toggle('ticking', pills.length > 0);
  if(pills.length === 0) return;
  if(statTickerIndex >= pills.length) statTickerIndex = 0;
  pills[statTickerIndex].classList.add('ticker-active');

  if(statTickerInterval) clearInterval(statTickerInterval);
  if(pills.length > 1){
    statTickerInterval = setInterval(() => {
      const activePills = ['myProgressBadge', 'weeklyRecap', 'mostRecentBadge']
        .map(id => document.getElementById(id))
        .filter(el => el && el.textContent.trim() !== '');
      if(activePills.length === 0) return;
      activePills.forEach(el => el.classList.remove('ticker-active'));
      statTickerIndex = (statTickerIndex + 1) % activePills.length;
      activePills[statTickerIndex].classList.add('ticker-active');
    }, 4000);
  }
}

// Highlights whichever location was rated most recently, anywhere on the map
// Shows the genuinely most-recently-rated location ANYWHERE (not just pins loaded this session).
// One cheap query — activity where type=='rating', newest first, limit 1 — so it reflects real
// site-wide activity on page load and signals the app is alive. Cached for the session.
let _mostRecentLoaded = false;
async function updateMostRecentBadge(){
  const el = document.getElementById('mostRecentBadge');
  if(!el || _mostRecentLoaded) return;
  try{
    const {db, collection, query, where, orderBy, limit, getDocs} = await fb();
    let rec = null;
    try{
      // Fast path: ordered query (needs a composite index type+ts).
      const snap = await getDocs(query(
        collection(db, 'activity'),
        where('type', '==', 'rating'),
        orderBy('ts', 'desc'),
        limit(1)
      ));
      snap.forEach(d => rec = d.data());
    }catch(indexErr){
      // Fallback: no composite index — fetch rating activity unordered and pick newest client-side.
      // Slightly more reads, but works with no manual index setup.
      const snap2 = await getDocs(query(collection(db, 'activity'), where('type', '==', 'rating')));
      let newest = null;
      snap2.forEach(d => {
        const v = d.data();
        if(v && v.ts && (!newest || v.ts > newest.ts)) newest = v;
      });
      rec = newest;
    }
    if(!rec || !rec.locId){ el.textContent = ''; refreshStatTicker(); return; }
    const loc = locationsById[rec.locId];
    /* Brand and town, not the street.
     *
     * This read the location NAME, which for most records is a street — "Watervliet Shaker Rd,
     * Colonie" tells a stranger nothing. A chain they recognise in a town they know does, and it
     * is the pairing that says whether this is worth a tap. City/state come from the record where
     * present, otherwise from the address, which is formatted "123 Main St, Albany, NY 12205". */
    const chainName = loc && CHAIN_REGISTRY[loc.chain] ? CHAIN_REGISTRY[loc.chain].name : null;
    const place = (() => {
      if(!loc) return '';
      const city = loc.city ?? (loc.address && loc.address.city);
      const st = loc.state ?? (loc.address && loc.address.state);
      if(city && st) return `${city}, ${st}`;
      const parts = String(loc.addr || '').split(',').map(x => x.trim()).filter(Boolean);
      // "…, Albany, NY 12205" -> "Albany, NY". Drop any trailing ZIP.
      if(parts.length >= 3) return `${parts[parts.length - 2]}, ${parts[parts.length - 1].replace(/\s*\d{5}(-\d{4})?$/, '')}`;
      return '';
    })();
    const headline = [chainName || (loc && loc.n) || 'a bathroom', place].filter(Boolean).join(' · ');
    /* innerHTML, so the arrow can be an svg. The arrow appears ONLY when the tap actually goes
     * somewhere — the marker has to be on the map for zoomToMarker to work — so it is a promise
     * rather than decoration. escapeHtml because a location name is data, not markup. */
    const tappable = !!(loc && markers[loc.id]);
    /* Credit the rater. logActivity has always written `username` onto the entry — its own
     * comment says it does so "so the header ticker can credit them without a second read" —
     * but nothing here ever read it back, so every rating in the ticker was anonymous while the
     * handle sat unused on the document.
     *
     * Optional by design: entries written before sign-in existed, or by someone who never chose
     * a handle, carry no username and simply read as they did before rather than showing a
     * placeholder. */
    const who = rec.username ? String(rec.username).slice(0, 40) : '';
    const credit = who ? `${escapeHtml(who)} rated` : 'Just rated:';
    el.innerHTML = `${credit} ${escapeHtml(headline)} — ${relativeTimeFromNow(rec.ts)}`
      + (tappable ? ` ${ico('arrow')}` : '');
    el.classList.toggle('is-tappable', tappable);
    _mostRecentLoaded = true;   // lock only after a real, successful write
    if(loc && markers[loc.id]) el.onclick = () => zoomToMarker(markers[loc.id]);
    refreshStatTicker();
  }catch(e){
    // Ordered query needs a composite index (type + ts); if it's missing or the query fails,
    // just leave the badge empty rather than break the ticker. (Create the index in the Firebase
    // console link that appears in the console error, one-time.)
    _mostRecentLoaded = false;   // allow a retry next call
    el.textContent = '';
    refreshStatTicker();
  }
}

/* Verified visit — you must be at a location to rate it.
 *
 * This used to be one flat 0.3 miles with no recorded reason. Measured against the real dataset,
 * 0.3 leaves 26.6% of locations with at least one OTHER pin inside the radius (37 others at the
 * worst spot in Manhattan), so a quarter of the map could be rated from across the street. But
 * tightening it blindly is worse: GPS indoors is bad, and a 100m error standing inside a store
 * with a metal roof is ordinary, so a tight fixed radius tells someone they are not at a place
 * they are visibly standing in.
 *
 * So scale it to how good the fix actually is. The browser already reports accuracy in metres —
 * it costs nothing to read, and it is the difference between "we know where you are" and "we
 * think you are somewhere in this neighbourhood".
 *
 *   accuracy <= 107m   ->  0.1 mi (161m), tight enough to tell neighbouring stores apart
 *   107m to 322m       ->  accuracy x 1.5, scaling with how uncertain the fix is
 *   worse, or absent   ->  0.3 mi (483m), exactly the previous behaviour
 *
 * 107m is where accuracy x 1.5 first exceeds the 0.1 mi floor; 322m is where it hits the 0.3
 * ceiling. Neither is a chosen number — they fall out of the floor, the ceiling and the
 * multiplier, which are the three things actually worth arguing about.
 *
 * The ceiling stays at 0.3 deliberately: beyond that the geofence stops meaning anything, and
 * "your GPS is too poor to confirm you are here" is a more honest answer than a rating attached
 * to the wrong building. */
const VERIFY_RADIUS_MILES = 0.3;          // ceiling, and the fallback when accuracy is unknown
const VERIFY_RADIUS_MIN_MILES = 0.1;      // floor for a good fix
const METRES_PER_MILE = 1609.34;

function verifyRadiusMiles(accuracyMetres){
  if(typeof accuracyMetres !== 'number' || !isFinite(accuracyMetres) || accuracyMetres <= 0)
    return VERIFY_RADIUS_MILES;
  const scaled = (accuracyMetres * 1.5) / METRES_PER_MILE;
  return Math.min(VERIFY_RADIUS_MILES, Math.max(VERIFY_RADIUS_MIN_MILES, scaled));
}

// ---------- Out of order — two-phase lifecycle (v2.6) ----------
// State is DERIVED from the out-of-order report timestamps for a location, so it decays on its own
// with no server cron. Given the list of report timestamps (ms) within the current cycle:
//   • Hard phase: rating suppressed, ⚠️ marker, Bathroom Now skips. Lasts 12h from the newest
//     report — but 24h once 2+ reports pile up in the active window (persistently broken).
//   • Soft phase: everything normal again, just an FYI note. From end-of-hard until 24h.
//   • Cleared: past 24h from the newest report.
// 24h hard is the cap (a 3rd+ report only resets the clock, never extends beyond 24h).
const OOO_HARD_MS      = 12 * 3600 * 1000;
const OOO_HARD_MAX_MS  = 24 * 3600 * 1000;
const OOO_TOTAL_MS     = 24 * 3600 * 1000;

// reports: array of {ts} (or ms numbers). Returns {phase:'hard'|'soft'|'none', since, reportCount, hardMs}.
function oooStatus(reports, now){
  now = now || Date.now();
  const ts = (reports || []).map(r => (typeof r === 'number' ? r : r.ts)).filter(Boolean);
  if(!ts.length) return { phase: 'none', reportCount: 0 };
  // Only reports within the total window count toward the current cycle.
  const active = ts.filter(t => now - t < OOO_TOTAL_MS).sort((a, b) => b - a);
  if(!active.length) return { phase: 'none', reportCount: 0 };
  const newest = active[0];
  const age = now - newest;
  const hardMs = active.length >= 2 ? OOO_HARD_MAX_MS : OOO_HARD_MS;   // escalation
  let phase = 'soft';
  if(age < hardMs) phase = 'hard';
  else if(age >= OOO_TOTAL_MS) phase = 'none';
  return { phase, since: newest, reportCount: active.length, hardMs };
}

// Lazy per-popup read of a location's out-of-order reports (mirrors the aggregate read pattern —
// one query when a pin's popup opens, cached). "Cleared" reports (cleared:true) are ignored, so an
// "It's working now" tap ends the cycle without waiting for the 24h timer.
/* Which out-of-order reports are still live, given every document for one location.
 *
 * One clear used to cancel EVERYONE's reports. Three people report a broken bathroom, one account
 * taps "it's working now", and all three vanish — with nothing stopping the same account doing it
 * again the moment they are re-filed.
 *
 * The rules cannot fix this. They cannot tell whether someone is present, whether the restroom is
 * genuinely restored, or whose report is whose. So the authority model lives here, and it is
 * deliberately asymmetric:
 *
 *   YOUR OWN report        one clear from you cancels it. You are withdrawing your own
 *                          statement, which needs nobody else's agreement.
 *   SOMEONE ELSE'S report  cancelling it takes as many DISTINCT clearers as there are
 *                          outstanding reporters. One account cannot overrule three people.
 *
 * Server-derived consensus is the better long-term answer. This is the part that works without
 * one, and it removes the "a single account suppresses everything" case entirely.
 *
 * Shared by the popup and by Bathroom Now's filter. Those were two separate implementations of
 * the same rule, and only one of them got fixed the first time. */
function resolveOooReports(rows){
  // A future timestamp cannot be trusted: the whole lifecycle is derived from them, and documents
  // written before the rules clamped ts are still out there. 60s absorbs ordinary clock skew.
  const notFuture = (t) => typeof t === 'number' && t <= Date.now() + 60000;
  const reportsBy = new Map();   // reporterId -> newest report ts
  const clearsBy  = new Map();   // reporterId -> newest clear ts
  for(const r of (rows || [])){
    if(!r || !notFuture(r.ts)) continue;
    const who = typeof r.reporterId === 'string' && r.reporterId ? r.reporterId : '(anon)';
    const bucket = r.cleared ? clearsBy : reportsBy;
    if(!bucket.has(who) || r.ts > bucket.get(who)) bucket.set(who, r.ts);
  }
  const outstanding = [...reportsBy.keys()].filter(k => {
    const c = clearsBy.get(k);
    return !(c && c >= reportsBy.get(k));
  }).length;
  const live = [];
  for(const [who, ts] of reportsBy){
    const ownClear = clearsBy.get(who);
    if(ownClear && ownClear >= ts) continue;                 // withdrawn by its author
    // The author's own clear never counts toward overruling anyone else.
    const overrules = [...clearsBy.entries()].filter(([k, t]) => k !== who && t >= ts).length;
    if(overrules >= outstanding) continue;
    live.push(ts);
  }
  return live;
}

const oooCache = {};
async function loadOoo(locId){
  try{
    const {db, collection, query, where, getDocs} = await fb();
    const snap = await getDocs(query(collection(db, 'outOfOrder'), where('locId', '==', locId)));
    // The authority rule and the future-timestamp guard both live in resolveOooReports,
    // so the popup and Bathroom Now cannot drift apart again.
    const live = resolveOooReports(Array.from(snap.docs, d => d.data() || {}));
    oooCache[locId] = live;
    return live;
  }catch(e){ console.error('loadOoo failed', e); return []; }
}

async function reportOutOfOrder(loc){
  const {db, collection, addDoc} = await fb();
  await addDoc(collection(db, 'outOfOrder'), {
    locId: loc.id, locName: loc.n, lat: loc.lat, lng: loc.lng,
    reporterId: (window.__currentUser && window.__currentUser.uid) || getClientId(),
    ts: Date.now(), cleared: false
  });
}

async function clearOutOfOrder(loc){
  const {db, collection, addDoc} = await fb();
  // A "cleared" marker with the current time — loadOoo drops any report at/older than it.
  await addDoc(collection(db, 'outOfOrder'), {
    locId: loc.id, reporterId: (window.__currentUser && window.__currentUser.uid) || getClientId(),
    ts: Date.now(), cleared: true
  });
}
let lastKnownPos = null; // cached briefly so every star tap doesn't re-prompt GPS

/* What to say while the position is being taken.
 *
 * Offline this can take half a minute, because there is no network assistance to speed up a GPS
 * fix. "Checking you're nearby…" with no further explanation reads as a hang, and someone in a
 * dead zone with 19% battery will assume the app is broken and close it — losing the answer
 * they were about to give. Naming the wait costs nothing and buys the patience it needs. */
function nearbyWaitNote(){
  return isOffline()
    ? "Checking you're nearby… this takes longer with no signal"
    : "Checking you're nearby…";
}

function getVerifiedPosition(){
  const now = Date.now();
  if(lastKnownPos && (now - lastKnownPos.ts) < 5 * 60 * 1000){
    return Promise.resolve(lastKnownPos);
  }
  return new Promise((resolve) => {
    if(!navigator.geolocation){ resolve(null); return; }
    const onOk = (pos) => {
      // accuracy is metres, 68% confidence, and the browser gives it for free. Keeping it lets
      // verifyNearby scale the geofence to how good the fix actually is.
      lastKnownPos = { lat: pos.coords.latitude, lng: pos.coords.longitude,
                       accuracy: (typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null),
                       ts: Date.now() };
      resolve(lastKnownPos);
    };
    /* Offline needs longer, and needs a second attempt.
     *
     * GPS itself works fine with no signal — satellites do not care. What disappears is the
     * network assistance that normally makes a fix nearly instant, so a cold start can take
     * thirty seconds or more. A 10-second high-accuracy timeout therefore fails almost every
     * time in a dead zone, and the failure blocks the write before the offline queue can ever
     * hold it. The queue was useless behind a gate that could not open.
     *
     * So: offline gets a longer window, and a high-accuracy miss falls back to a coarse fix
     * rather than giving up. A coarse fix is enough — verifyNearby already widens the radius to
     * match the accuracy it is given, so a poor position is handled honestly rather than
     * treated as no position at all. */
    const offline = isOffline();
    navigator.geolocation.getCurrentPosition(
      onOk,
      () => {
        if(!offline){ resolve(null); return; }
        navigator.geolocation.getCurrentPosition(onOk, () => resolve(null),
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 15 * 60 * 1000 });
      },
      { enableHighAccuracy: true, timeout: offline ? 30000 : 10000 }
    );
  });
}

/* Why the check failed, in the user's terms.
 *
 * "You need to be at this stop" is wrong and infuriating when someone is standing inside the
 * building — which happens, because GPS indoors is bad. If the fix is too coarse to place them,
 * say THAT instead: the remedy is stepping outside, not walking closer. Your tester hit this at
 * a Cumberland Farms and there was no way to tell the two cases apart. */
function verifyFailMessage(v){
  if(!v || v.reason === 'no-location')
    return '📍 Turn on location to confirm you are here.';
  if(typeof v.accuracy === 'number' && v.accuracy > 150 && v.distance <= 0.5)
    return '📍 Your location is only accurate to about ' + Math.round(v.accuracy) +
           'm right now — step outside and try again.';
  return '📍 You need to be at this stop to do that.';
}

async function verifyNearby(loc, opts){
  opts = opts || {};
  /* Admins answer from anywhere.
   *
   * The geofence exists so a rating means "I was there", and that reasoning does not change for
   * an admin — what changes is that an admin correcting bad data already knows the place and
   * cannot always drive back to prove it. The alternative was the amenityOverrides path, which
   * writes to a different collection, does not trigger the aggregate recompute, and renders no
   * badge at all. One narrow exemption is less machinery and less to go wrong than a parallel
   * authority system.
   *
   * OPT-IN PER CALLER, and deliberately not granted to the star rating. Correcting "this has two
   * private restrooms" is stating a fact you know; giving it four stars from ninety miles away
   * is inventing an opinion about a visit that did not happen. The exemption covers facts —
   * amenities, hours, out-of-order — and stops there.
   *
   * The vote is otherwise completely ordinary: same document, same rules, same recompute, and it
   * counts as ONE report like anyone else's until other people agree. No special badge, because
   * an admin who was there last week is exactly as reliable as anyone else who was.
   *
   * Worth being clear that this is a CLIENT-side gate and always was — the rules never checked
   * position, so anyone determined could already bypass it. This does not weaken a defence; it
   * makes an existing one skippable for the account that maintains the data. */
  if(opts.allowAdmin && window.__isAdmin) return { ok: true, admin: true, distance: 0, radius: 0, accuracy: 0 };
  const pos = await getVerifiedPosition();
  if(!pos) return { ok: false, reason: 'no-location' };
  const dist = milesBetween(pos.lat, pos.lng, loc.lat, loc.lng);
  const radius = verifyRadiusMiles(pos.accuracy);
  // `radius` and `accuracy` come back so the caller can say WHICH failure this was: too far, or
  // a fix too poor to tell. Those need different wording — one is "go closer", the other is
  // "step outside".
  return { ok: dist <= radius, distance: dist, radius, accuracy: pos.accuracy };
}

// Transient rating messages (checking / distance errors) are shown OVER the star row via a
// .rate-flash overlay, so the popup card never changes height. Error messages auto-fade back
// to the stars after a few seconds.
const _rateFlashTimers = {};
function showFlash(locId, type, msg, autohideMs, isError){
  const el = document.getElementById('flash-' + type + '-' + locId);
  if(!el) return;
  clearTimeout(_rateFlashTimers[type + locId]);
  el.textContent = msg;
  el.classList.toggle('err', !!isError);
  el.classList.add('show');
  if(autohideMs > 0){
    _rateFlashTimers[type + locId] = setTimeout(() => el.classList.remove('show'), autohideMs);
  }
}
function hideFlash(locId, type){
  const el = document.getElementById('flash-' + type + '-' + locId);
  if(!el) return;
  clearTimeout(_rateFlashTimers[type + locId]);
  el.classList.remove('show');
}

/* Redraw the rating block in place and rebind, so answering one dimension advances to the next
 * without closing and reopening the popup under someone. Only this block is replaced — the rest
 * of the card, including anything the person has scrolled to, stays exactly where it was. */
function refreshRatingSection(loc){
  const host = document.getElementById('rating-section-' + loc.id);
  if(!host) return;
  const agg = ratingsCache[loc.id] || { bathroomSum:0, bathroomCount:0 };
  const myVote = myVoteCache[loc.id] || emptyVote();
  host.innerHTML = ratingSectionInnerHtml(loc, agg, myVote);
  attachStarHandlers(loc);
  if(typeof wireOoo === 'function') wireOoo(loc);
  /* The strip carries the overall score, so it has to follow a rating too — otherwise the
   * number at the top of the card disagrees with the one just given. */
  if(typeof refreshOpenPopupStrip === 'function') refreshOpenPopupStrip();
}

/* Moving between questions never records anything — there is deliberately no "no opinion" vote,
 * because declining to answer is an absence of data, not data. */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rate-go]');
  if(!btn) return;
  const loc = locationsById[btn.dataset.locid];
  if(!loc) return;
  ratingGoTo(loc, Number(btn.dataset.rateGo));
});

/* Swipe between the questions.
 *
 * The hard part is that this element is FULL of tap targets — five stars, and a tap must not be
 * read as a tiny swipe. So: a movement threshold before anything counts, an axis lock so the
 * popup can still be scrolled vertically through this block, and the whole thing is passive
 * until the axis is known, which keeps the scroll smooth.
 *
 * The stars are left entirely alone. Their click handler fires on click, and a click only
 * happens when the pointer did not travel far, so the two cannot both trigger. */
(function(){
  const MIN = 40;                 // px before a drag is a swipe rather than a wobbly tap
  let id = null, x0 = 0, y0 = 0, axis = null;

  document.addEventListener('touchstart', (e) => {
    const host = e.target.closest && e.target.closest('[data-rate-swipe]');
    if(!host){ id = null; return; }
    id = host.dataset.rateSwipe;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; axis = null;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if(!id) return;
    const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
    if(axis === null){
      if(Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    // Vertical: hand it back to the popup's own scrolling and stop watching.
    if(axis === 'y'){ id = null; return; }
    if(e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if(!id || axis !== 'x') { id = null; return; }
    const loc = locationsById[id];
    const dx = (e.changedTouches[0] || {}).clientX - x0;
    id = null; axis = null;
    if(!loc || Math.abs(dx) < MIN) return;
    // Left goes forward, matching every other pager on a phone.
    ratingGoTo(loc, ratingDimIndex(loc, myVoteCache[loc.id] || emptyVote()) + (dx < 0 ? 1 : -1));
  });
})();

function attachStarHandlers(loc){
  const popupEl = document.querySelector(`.popup-inner[data-locid="${loc.id}"]`);
  if(!popupEl) return;
  popupEl.querySelectorAll('.stars').forEach(starGroup => {
    const type = starGroup.dataset.type;
    starGroup.querySelectorAll('span').forEach(starEl => {
      starEl.addEventListener('click', async () => {
        const val = parseInt(starEl.dataset.val);
        if(navigator.vibrate) navigator.vibrate(15);
        const note = document.getElementById('note-' + type + '-' + loc.id);

        if(deviceIsBlocked){
          showFlash(loc.id, type, 'This device is no longer able to submit ratings.', 4000, true);
          return;
        }

        showFlash(loc.id, type, 'Checking you\'re nearby…', 0, false);

        /* No admin bypass here on purpose: a star rating is a claim about a visit, and an admin
         * ninety miles away has not made one. Facts get the exemption; opinions do not. */
        const verification = await verifyNearby(loc);
        if(!verification.ok){
          /* Three outcomes, not two. Telling someone standing inside the building that they are
           * "0.1 mi away" is both wrong and unhelpful; if the fix is that coarse, the remedy is
           * stepping outside. Distance is still shown when it IS the reason, because knowing you
           * are 4 miles off is actionable. */
          const poorFix = typeof verification.accuracy === 'number'
            && verification.accuracy > 150 && verification.distance <= 0.5;
          const msg = verification.reason === 'no-location'
            ? '📍 Enable location to verify you\'re at this Bathroom before rating.'
            : poorFix
              ? `📍 Your location is only accurate to about ${Math.round(verification.accuracy)}m right now — step outside and try again.`
              : `📍 You need to be at this Bathroom to rate it (you're ${verification.distance.toFixed(1)} mi away).`;
          showFlash(loc.id, type, msg, 4000, true);
          return;
        }
        hideFlash(loc.id, type);
        if(note){ note.style.color = ''; note.textContent = 'Saving…'; }

        const agg = ratingsCache[loc.id] || emptyAgg();
        const myVote = myVoteCache[loc.id] || emptyVote();
        const prevVal = myVote[type];

        const sumKey = type + 'Sum';
        const countKey = type + 'Count';
        const sumDelta = val - prevVal;
        const countDelta = prevVal > 0 ? 0 : 1;

        // Hidden Gem Hunter achievement — capture at the moment of first rating whether the
        // community bathroom count was still under 5, since that fact can't be reconstructed
        // later once more reviews come in.
        /* Trailblazer needs FIRST-EVER, not "fewer than five". Almost every location on the map
         * has zero ratings, so the old test fired on essentially every rating and made Hidden
         * Gem Hunter a duplicate of First Flush. wasFirst is captured alongside rather than
         * replacing wasHiddenGem, so anyone already holding the old stamp keeps it. */
        if(type === 'bathroom' && prevVal === 0 && (agg.bathroomCount || 0) === 0){
          myVote.wasFirst = true;
        }
        /* Second Look: this rating replaced one you had already left. Only true on a genuine
         * change of mind — re-submitting the same number does not count. */
        if(type === 'bathroom' && prevVal > 0 && prevVal !== val){
          myVote.wasChanged = true;
        }
        if(type === 'bathroom' && prevVal === 0 && (agg.bathroomCount || 0) < 5){
          myVote.wasHiddenGem = true;
        }

        /* Snapshot before the optimistic update so a rejected write can be undone.
         *
         * The bump below is applied BEFORE the write and used to have no rollback: a rejected
         * rating left the new average on screen, the stars filled, and myVoteCache holding a
         * value that was never stored — which then fed the achievement counters. The user saw
         * "Save failed" next to a rating that looked saved. */
        const rollback = {
          sum: agg[sumKey], count: agg[countKey],
          vote: myVote[type], hiddenGem: myVote.wasHiddenGem,
        };

        // Update local view optimistically so it feels instant
        agg[sumKey] += sumDelta;
        agg[countKey] += countDelta;
        myVote[type] = val;
        ratingsCache[loc.id] = agg;
        myVoteCache[loc.id] = myVote;

        // repaint stars immediately
        starGroup.querySelectorAll('span').forEach((s,i) => {
          s.classList.toggle('filled', (i+1) <= val);
        });

        // update the funny caption immediately
        const quipEl = document.getElementById('quip-' + type + '-' + loc.id);
        if(quipEl) quipEl.textContent = quipFor(type, val);

        // Aggregate totals are recomputed server-side by the recomputeBathroomAggregate Cloud
        // Function, which reacts to this vote write — the client only writes the vote. The
        // on-screen average was already updated optimistically above.
        const okVote = await saveMyVote(loc.id, myVote);
        if(!okVote){
          // Undo the optimistic update. Leaving it would show an average and a star row that no
          // server ever accepted, and wasHiddenGem would persist into the achievement stats.
          agg[sumKey] = rollback.sum;
          agg[countKey] = rollback.count;
          myVote[type] = rollback.vote;
          if(rollback.hiddenGem === undefined) delete myVote.wasHiddenGem;
          else myVote.wasHiddenGem = rollback.hiddenGem;
          ratingsCache[loc.id] = agg;
          myVoteCache[loc.id] = myVote;
          starGroup.querySelectorAll('span').forEach((s,i) => {
            s.classList.toggle('filled', (i+1) <= (rollback.vote || 0));
          });
          const qEl = document.getElementById('quip-' + type + '-' + loc.id);
          if(qEl) qEl.textContent = quipFor(type, rollback.vote);
        }
        /* Only the overall score is an "activity": the recap and the header ticker count
         * ratings, and logging clean and safe there would treble the numbers a person sees for
         * what was, to them, one visit. */
        /* Captured here because this is the one moment the location is guaranteed loaded. */
        if(okVote) rememberRatedMeta(loc);
        if(okVote && type === 'bathroom') logActivity('rating', { sourceId: loc.id + '_' + getEffectiveId(), locId: loc.id });
        if(note) note.textContent = okVote ? 'Saved ✓ — visible to everyone' : 'Save failed — nothing was recorded';
        if(okVote) maybeShowSupportPrompt();
        /* Advance to the next question, after a beat so the tick and the saved note are seen.
         * Redrawing instantly would make a successful save look like the control had reset. */
        if(okVote && RATING_DIMS.some(d => d.key === type)){
          /* Move to whatever is still unanswered, or stay put if nothing is. Advancing blindly
           * would bounce someone off a question they had just deliberately swiped back to. */
          setTimeout(() => {
            const v = myVoteCache[loc.id] || emptyVote();
            const next = RATING_DIMS.findIndex(d => !v[d.key]);
            if(next >= 0) ratingGoTo(loc, next); else refreshRatingSection(loc);
          }, 900);
        }

        // refresh the label text with new average
        const labelEl = starGroup.parentElement.querySelector('.rating-label');
        if(labelEl){
          const sum = agg[sumKey], count = agg[countKey];
          const niceType = type === 'store' ? 'Store' : '🚻 Bathroom';
          labelEl.innerHTML = `${niceType} — ${avgStr(sum,count)}★ ${ratingConfidenceHtml(count)}`;
        }

        if(markers[loc.id]) markers[loc.id].setIcon(makeIcon(loc.id));
        updateMyProgressBadge();
        checkAndUnlockAchievements();
      });
    });
  });
}

function renderTipsList(loc, tips){
  const listEl = document.getElementById('tips-list-' + loc.id);
  if(!listEl) return;
  if(!tips || tips.length === 0){
    // "Be the first" is an invitation to do something a signed-out visitor has no control for.
    listEl.innerHTML = isLoggedIn()
      ? '<li style="color:#999;">No tips yet — be the first!</li>'
      : '<li style="color:#999;">No tips yet.</li>';
    return;
  }
  listEl.innerHTML = tips.map(t => `<li><svg class="ico" aria-hidden="true"><use href="#i-bulb"></use></svg> ${escapeHtml(t)}</li>`).join('');
}

/* Escape for BOTH text content and attribute values.
 *
 * The old implementation set textContent and read innerHTML back, which escapes < > and & but
 * leaves quotes alone, because quotes are not special in text content. That made it unsafe the
 * moment anyone used it inside an attribute — and two records in the current data carry a double
 * quote ("John \"Chuck\" Erreca Northbound Rest Area"), so it was one refactor away from
 * mattering. Explicit replacement covers every context.
 *
 * Names and addresses come from OSM and ATP, where they are user-editable, so this is escaping
 * untrusted input even though today's data happens to contain no markup. */
function escapeHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function attachTipHandlers(loc){
  const listEl = document.getElementById('tips-list-' + loc.id);
  const inputEl = document.getElementById('tip-input-' + loc.id);
  const submitEl = document.getElementById('tip-submit-' + loc.id);
  /* Only the LIST is required now. Logged-out popups render the tips list without the compose
   * row, so requiring the input and button here would have left them stuck on "Loading…" —
   * the same withheld-read problem as the feature blocks, one layer down. */
  if(!listEl) return;

  // Load existing tips fresh each time the popup opens
  const tips = await loadTips(loc.id);
  renderTipsList(loc, tips);

  if(!inputEl || !submitEl) return;   // read-only (signed-out) popup — nothing to bind

  // Avoid stacking duplicate listeners if the popup is reopened
  if(submitEl.dataset.bound === '1') return;
  submitEl.dataset.bound = '1';

  const submit = async () => {
    const text = inputEl.value.trim().slice(0, MAX_TIP_LENGTH);
    if(!text) return;
    if(deviceIsBlocked) return; // silently no-op — blocked devices don't get an explanation here
    submitEl.disabled = true;
    submitEl.textContent = '...';
    const ok = await addTip(loc.id, text);
    if(ok){
      const current = await loadTips(loc.id);
      renderTipsList(loc, current);
      inputEl.value = '';
    }
    submitEl.disabled = false;
    submitEl.textContent = 'Add';
  };

  submitEl.addEventListener('click', submit);
  inputEl.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') submit();
  });
}

// Load all seed locations — this is now instant since no storage calls happen until a pin is tapped
seedLocations.forEach(loc => addMarker(loc));
perfMark('markers created (' + allLocationMarkers.length + ')');
stampBuildDate();   // keeps the drawer stamp, onboarding, and FAQ dates identical
// This direct call is a RACE SAFETY NET, not redundancy: firebase.js (a module, early in
// index.html) can finish auth init and fire 'authStateReady' during the ~half second the
// browser spends parsing the location data files BEFORE app.js runs and registers its
// listener — a missed event would mean ratings never load this session. When both paths do
// run, the run token in loadAllRatings makes only the newest apply, so there's no double
// application (the waste the old code had) — just one spare read in the rare overlap.
loadAllRatings();
// loadOverrides();  // DISABLED to cut Firestore reads — admin fixes are now baked into the
//                   *-locations.js files (weekly, via fetch-and-bake.js) instead of read live
//                   from the overrides collection on every load. Re-enable this call to
//                   restore instant live overrides.
/* Re-enabled. It was disabled for read cost, and that cost is gone: it used to run one query for
 * the week and then a document read PER ENTRY to verify each one. Both verifications are now
 * handled where the deletion happens, so this is a single query. */
loadWeeklyRecap();

// One-time support prompt — shown after this identity has rated five different locations.
// The permanent support link remains available in the Account panel.
function reviewedLocationCount(){
  return Object.values(myVoteCache).filter(vote =>
    vote && ((vote.bathroom || 0) > 0 || (vote.store || 0) > 0)
  ).length;
}

function closeSupportPrompt(){
  const overlay = document.getElementById('supportPromptOverlay');
  if(!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
}

function maybeShowSupportPrompt(){
  if(localStorage.getItem('supportPromptShown') === '1') return;
  if(reviewedLocationCount() < 5) return;

  const overlay = document.getElementById('supportPromptOverlay');
  if(!overlay) return;

  // Mark it before opening so it never becomes a repeated interruption.
  localStorage.setItem('supportPromptShown', '1');
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
}

document.getElementById('supportPromptLater')?.addEventListener('click', closeSupportPrompt);
document.getElementById('supportPromptLink')?.addEventListener('click', closeSupportPrompt);
document.getElementById('supportPromptOverlay')?.addEventListener('click', (event) => {
  if(event.target.id === 'supportPromptOverlay') closeSupportPrompt();
});

/* Onboarding — one screen whose only job is the location prompt.
 *
 * Asking for location HERE rather than on first use of Bathroom Now matters: a permission
 * dialog that appears the instant you tap a button feels like an interruption, and browsers
 * remember a denial. Asked once, with a sentence saying why, it is a question rather than an
 * ambush — and if the answer is no, the map still works.
 *
 * The travel-mode choice moved to Settings. It was being asked before anyone had tapped a pin,
 * about a feature they had not met, and it already existed in two places. */
function openOnboarding(){
  const ov = document.getElementById('onboardingOverlay');
  if(ov) ov.classList.add('show');
}
function closeOnboarding(){
  localStorage.setItem('onboardingSeen', '1');
  document.getElementById('onboardingOverlay')?.classList.remove('show');
}

if(localStorage.getItem('onboardingSeen') !== '1') openOnboarding();
document.getElementById('onboardingInfoBtn')?.addEventListener('click', openOnboarding);
document.getElementById('onboardingClose')?.addEventListener('click', closeOnboarding);

document.getElementById('onboardingLocate')?.addEventListener('click', () => {
  const btn = document.getElementById('onboardingLocate');
  const sub = document.getElementById('onboardingSub');
  if(!navigator.geolocation){
    /* No API at all — nothing to prompt for, so do not pretend. Straight to the map. */
    closeOnboarding();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Waiting for permission\u2026';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      /* Centre on them before dismissing. Closing first would show the default view for a beat
       * and then jump, which reads as the app losing its place. */
      try{ map.setView([pos.coords.latitude, pos.coords.longitude], 14, { animate:false }); }catch(e){}
      if(typeof setUserLocationMarker === 'function'){
        try{ setUserLocationMarker(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); }catch(e){}
      }
      closeOnboarding();
    },
    (err) => {
      /* A denial is a real answer, not a failure. Say what it means, change the button into the
       * way out, and never re-prompt — the browser would refuse a second ask anyway, so a retry
       * button would be a control that does nothing. */
      btn.disabled = false;
      btn.textContent = 'Show me the map';
      btn.classList.add('ob-go-secondary');
      btn.onclick = closeOnboarding;
      if(sub) sub.textContent = err && err.code === 1
        ? 'No problem \u2014 the map works without it. You can turn location on later in your browser settings.'
        : 'Could not get your location just now. The map still works; pan to where you are.';
      document.getElementById('onboardingClose')?.classList.add('is-gone');
    },
    { enableHighAccuracy:true, timeout:10000, maximumAge:60000 }
  );
});

// ("How it works" opens the info page — wired in index.html's chrome script)

// If this page was opened via a shared link or a /guide/ SEO page (?loc=xyz),
// jump straight to that pin. We also report the arrival to GA4 and then scrub the
// tracking params out of the URL, so a refresh or a re-share doesn't carry UTMs
// around and the address bar stays clean.
/* Two kinds of tagged arrival land here:
 *
 *   ?loc=<id>              a shared link or a /guide/ SEO page pointing at one pin
 *   ?utm_* with no loc     a campaign entry point — the QR on a printed card, for one
 *
 * This block used to return the moment `loc` was absent, so a campaign arrival fired no event
 * AND kept its utm_* params sitting in the address bar. That second part is the real bug: the
 * printed cards carry ?utm_campaign=card_v2, so anyone who scanned one and then shared the URL
 * they landed on passed the card campaign along to whoever they sent it to, and every one of
 * those arrivals counted as another card scan.
 *
 * GA4's automatic page_view carries the campaign on its own either way. The explicit event is
 * here because a named event can be counted directly rather than inferred from a session
 * dimension, and because gtag is the first thing an ad blocker removes.
 */
(function(){
  const params = new URLSearchParams(window.location.search);
  // A link shared before the id rename carries the raw form (?loc=node%2F123). Normalise it so
  // those links keep resolving; meta.srcId holds the original if it is ever needed.
  const rawTarget = params.get('loc');
  const targetId = rawTarget ? fsId(rawTarget) : rawTarget;
  const hasUtm = Array.from(params.keys()).some(k => k.startsWith('utm_'));
  if(!targetId && !hasUtm) return;

  // Attribution: where did this arrival come from? ("guide" = an SEO page,
  // absent on a ?loc= link = someone shared it directly.)
  const source   = params.get('utm_source')   || 'direct_share';
  const medium   = params.get('utm_medium')   || '';
  const campaign = params.get('utm_campaign') || '';

  if(targetId){
    const target = seedLocations.find(l => l.id === targetId);
    const found = Boolean(target && markers[targetId]);
    if(found) zoomToMarker(markers[targetId]);

    track('deeplink_open', {
      loc_id: targetId,
      chain: (target && target.n) || '',
      source: source,
      campaign: campaign,
      // false = the link pointed at a pin we no longer have (renamed/removed id),
      // which is the signal that a stale /guide/ page is still in Google's index.
      resolved: found
    });
  } else {
    // A tagged arrival that names no location: the campaign itself is the whole signal.
    track('campaign_arrival', { source: source, medium: medium, campaign: campaign });
  }

  /* Strip loc + any utm_* so the URL is shareable and refresh-safe.
   *
   * Deliberately deferred to load rather than done here. gtag's library is fetched async and
   * reads document.location when it gets around to processing the queued config() — so
   * rewriting the URL mid-app.js can beat it to that read and cost GA4 the campaign outright,
   * which is the opposite of the point. Waiting for load is invisible to the user and removes
   * the race. replaceState leaves no extra history entry.
   */
  const strip = () => {
    const cur = new URLSearchParams(location.search);
    const keep = new URLSearchParams();
    cur.forEach((v, k) => {
      if(k !== 'loc' && !k.startsWith('utm_')) keep.append(k, v);
    });
    const qs = keep.toString();
    history.replaceState({}, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  };
  if(document.readyState === 'complete') strip();
  else window.addEventListener('load', strip, { once: true });
})();

// Resize every pin whenever the zoom level changes
let lastMetroZoomOk = null;
let lastRestZoomOk = null;
let _lastIconSize = sizesForZoom(map.getZoom()).rated; // markers were just built at this bucket
map.on('zoomend', () => {
  // Icons only change when the zoom crosses a size bucket (sizesForZoom has 5 buckets).
  // Zooming within a bucket used to re-set the icon on all ~9,000 markers for no visual
  // change at all; now the whole loop is skipped unless the bucket actually changed.
  const iconSize = sizesForZoom(map.getZoom()).rated;
  if(iconSize !== _lastIconSize){
    _lastIconSize = iconSize;
    seedLocations.forEach(loc => {
      const m = markers[loc.id];
      if(!m) return;
      if(m.isPopupOpen()) resizeOpenMarkerIcon(m); // resize in place; never swap icon on an open popup
      else m.setIcon(makeIcon(loc.id));
    });
  }
  // Metro + rest-area zoom gates: only re-run the membership filter when crossing a threshold, not
  // on every zoom step — applyFilters iterates all markers, so this keeps zooming cheap.
  const metroZoomOk = map.getZoom() >= METRO_MIN_ZOOM;
  const restZoomOk = map.getZoom() >= REST_MIN_ZOOM;
  if(metroZoomOk !== lastMetroZoomOk || restZoomOk !== lastRestZoomOk){
    lastMetroZoomOk = metroZoomOk;
    lastRestZoomOk = restZoomOk;
    applyFilters();
  }
});

// Day keys aligned to Date.getDay() (0=Sunday). A location may carry per-day hours
// (loc.hours, set by an admin correction) which take precedence over the single
// loc.hrs window. Each day's value is "24", "HHMM-HHMM", "closed", or missing (unknown).
const HRS_DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];
// A location may carry per-day hours (loc.hours) which take precedence over the single
// loc.hrs window. Each day's value is "24", "HHMM-HHMM", "closed", or missing (unknown).
function todayHrsString(loc){
  if(loc && loc.hours && typeof loc.hours === 'object' && Object.keys(loc.hours).length){
    const v = loc.hours[HRS_DAY_KEYS[new Date().getDay()]];
    return (v === undefined || v === null) ? null : v;
  }
  return (loc && loc.hrs != null) ? loc.hrs : null;
}

/* How far away a location can be before we stop claiming to know whether it's open.
 *
 * A store's hours are in ITS local time, but the comparison below uses the DEVICE clock. Looking
 * at a New York store from California, "Closed now" was computed three hours early — silently,
 * and on the app's primary question. No record carries a timezone, so the honest fix is to stop
 * asserting a verdict once the device clock stops being a reasonable proxy.
 *
 * 150 miles keeps every normal use intact — Bathroom Now, the nearest list, and browsing your own
 * area are all well inside it — while removing the coast-to-coast error. A zone boundary can sit
 * inside 150 miles, so this isn't a guarantee; it caps a possible error at roughly an hour instead
 * of three, and only where the app was already guessing. */
const OPEN_NOW_CONFIDENT_MILES = 150;

// True when the device clock is a fair stand-in for the location's local time. With no position
// fix we have nothing better to go on, so the device clock stays the best available guess rather
// than blanking the verdict for every first-time visitor.
function openNowConfident(loc){
  if(!lastKnownPos) return true;
  return milesBetween(lastKnownPos.lat, lastKnownPos.lng, Number(loc.lat), Number(loc.lng))
         <= OPEN_NOW_CONFIDENT_MILES;
}

// Open-now calculation — effective hours string is "24", "HHMM-HHMM", "closed", or unknown.
// Locations with no known hours are "unknown" and are never hidden by the open-now filter.
function isLocationOpenNow(loc){
  const hrs = todayHrsString(loc);
  if(!hrs) return null; // unknown — we don't have hours data for this one yet
  // 'closed' and '24' hold in every timezone, so they stay definite at any distance.
  if(hrs === 'closed') return false;
  if(hrs === '24') return true;
  const parts = hrs.split('-');
  if(parts.length !== 2) return null;
  const open = parseInt(parts[0], 10);
  const close = parseInt(parts[1], 10);
  if(isNaN(open) || isNaN(close)) return null;
  // Only a timed window depends on which clock we read, so only it needs the distance guard.
  if(!openNowConfident(loc)) return null;
  const now = new Date();
  const nowVal = now.getHours() * 100 + now.getMinutes();
  if(close > open){
    return nowVal >= open && nowVal < close;
  } else {
    // overnight closing (e.g. closes 1am) — open spans midnight
    return nowVal >= open || nowVal < close;
  }
}

// Turns "0430-2400" into "4:30 AM – 12:00 AM", or "24" into "Open 24 hours"
function formatTime12h(hhmm){
  if(hhmm === 2400) hhmm = 0; // midnight, displayed as 12:00 AM
  const h = Math.floor(hhmm / 100);
  const m = hhmm % 100;
  const period = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if(h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}

// True when a location carries a per-day schedule rather than one all-week window.
// Callers use this to label the displayed hours as TODAY's — without that label the same
// line silently means something different depending on the day it's read, which is
// misleading for anyone planning ahead rather than going right now.
function hasPerDayHours(loc){
  return !!(loc && loc.hours && typeof loc.hours === 'object' && Object.keys(loc.hours).length);
}

function formatHrsDisplay(loc){
  const hrs = todayHrsString(loc);
  if(!hrs) return null;
  if(hrs === 'closed') return 'Closed today';
  if(hrs === '24') return 'Open 24 hours';
  const parts = hrs.split('-');
  if(parts.length !== 2) return null;
  const open = parseInt(parts[0], 10);
  const close = parseInt(parts[1], 10);
  if(isNaN(open) || isNaN(close)) return null;
  return `${formatTime12h(open)} – ${formatTime12h(close)}`;
}

// Admin corrections (hours, address, coordinates, phone) live in the Firestore
// `overrides` collection and are merged over the built-in location data at load, so a
// fix made in FlushPanel shows up without a redeploy. Best-effort: if this fails, the
// static data still works. Reads are public per the security rules.
async function loadOverrides(){
  try{
    const {db, collection, getDocs} = await fb();
    const snap = await getDocs(collection(db, 'overrides'));
    let coordsMoved = false;
    snap.forEach(docSnap => {
      const loc = locationsById[docSnap.id];
      if(!loc) return; // an override for a location we don't ship — ignore safely
      if(applyOverrideToLocation(loc, docSnap.data() || {})) coordsMoved = true;
    });
    // If any pin moved, re-evaluate which markers are in view.
    if(coordsMoved && typeof applyFilters === 'function') applyFilters();
  }catch(e){ /* overrides are optional; keep the static data */ }
}

// Merge one override document onto its location record (in place) and refresh its
// marker/popup. Returns true if the coordinates changed (so the pin was moved).
function applyOverrideToLocation(loc, data){
  // Permanent removal flag (bad data / not-a-real-location / permanently closed). If live
  // overrides are enabled, this pulls the marker off the map immediately; the bake step deletes
  // the record for good.
  if(data.remove === true || data.hidden === true){
    loc._removed = true;
    const m = markers[loc.id];
    if(m){ try{ markerCluster.removeLayer(m); }catch(e){} delete markers[loc.id]; }
    return false;
  }
  ['hrs','addr','city','state','zipCode','phone'].forEach(f => {
    if(data[f] !== undefined) loc[f] = data[f];
  });
  if(data.hours !== undefined) loc.hours = data.hours;   // per-day hours map ({} clears it)
  if(data.locName !== undefined) loc.n = data.locName;   // corrected display name
  let coordsMoved = false;
  if(typeof data.lat === 'number' && typeof data.lng === 'number'){
    coordsMoved = (data.lat !== loc.lat || data.lng !== loc.lng);
    loc.lat = data.lat; loc.lng = data.lng;
  }
  const marker = markers[loc.id];
  if(marker){
    if(coordsMoved) marker.setLatLng([loc.lat, loc.lng]);
    if(marker.getPopup()) marker.setPopupContent(popupHtml(loc, ratingsCache[loc.id], myVoteCache[loc.id]));
  }
  return coordsMoved;
}

// "2 days ago" style formatting for showing when a location was last rated
function relativeTimeFromNow(ts){
  if(!ts) return null;
  const diffMs = Date.now() - ts;
  if(diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return `${mins} minute${mins===1?'':'s'} ago`;
  const hours = Math.floor(mins / 60);
  if(hours < 24) return `${hours} hour${hours===1?'':'s'} ago`;
  const days = Math.floor(hours / 24);
  if(days < 30) return `${days} day${days===1?'':'s'} ago`;
  const months = Math.floor(days / 30);
  if(months < 12) return `${months} month${months===1?'':'s'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years===1?'':'s'} ago`;
}

let showAllLocations = false; // map hides confirmed-closed by default; the ☰ "Show all" toggle flips this
let hideInaccessible = false;  // opt-in: when true, hide only pins CONFIRMED not wheelchair-accessible

// A location counts as "confirmed not accessible" only when there's a negative signal AND no
// positive one. Unknown/untagged locations are never hidden — absence of data is not evidence of
// inaccessibility. All signals are baked (zero Firestore reads), so this is safe to run over every
// visible pin in applyFilters.
function isConfirmedNotAccessible(loc){
  const yes = (loc.conf && loc.conf.accessible)
    || (loc.osm && loc.osm.accessible)
    || loc.wheelchair === 'yes' || loc.wheelchair === 'designated';
  if(yes) return false;                                   // any positive confirmation keeps it visible
  // "limited" is not a confirmed no — hiding it would remove an option that may well work,
  // so it survives the filter while never being labelled fully accessible.
  if(isAccessLimited(loc)) return false;
  const no = (loc.confNo && loc.confNo.accessible)        // community-confirmed no
    || (loc.osm && loc.osm.accessibleNo)                  // OSM wheelchair=no
    || loc.wheelchair === 'no';                           // legacy baked no
  return !!no;
}

// How far beyond the visible map edges to still render pins, as a fraction of the
// viewport, so a small pan doesn't leave blank areas while new pins load in.
const MARKER_VIEWPORT_PAD = 0.3;

let _filterRunToken = 0;
function applyFilters(){
  // Process marker membership in small animation-frame batches. Authentication can change many
  // saved chain filters at once; doing thousands of MarkerCluster add/remove operations in one
  // synchronous burst can trigger iOS Safari's page-reload/crash behavior.
  const runToken = ++_filterRunToken;
  /* Time-budgeted batching instead of a fixed count.
   *
   * A fixed 350 meant 27,307 markers took 78 animation frames — roughly 1.25s of pure frame
   * scheduling before counting any actual work, and the number went stale as the dataset grew.
   * Working to a time budget adapts: a fast phone does thousands per frame, a slow one does
   * fewer and stays responsive, and it never needs retuning when more locations land.
   *
   * BATCH_CAP still bounds each frame. The original 350 existed because thousands of
   * synchronous MarkerCluster add/remove calls could trigger iOS Safari's reload behaviour;
   * the cap keeps that protection while letting capable devices go faster. */
  const FRAME_BUDGET_MS = 8;     // leaves room in a 16ms frame for rendering
  const BATCH_CAP = 2000;        // hard ceiling per frame, iOS safety
  const BATCH_MIN = 200;         // always make progress even on a slow frame

  // Viewport-first ordering: at ~23,000 locations a full pass takes 65+ animation frames
  // (2+ seconds), and in file order the user's own area could be processed LAST. Partition
  // the indices so markers in (or within half a screen of) the current view are handled in
  // the first batches — nearby pins appear near-instantly and the rest fill in behind.
  // Raw lat/lng compares, no allocations per marker. If the map isn't ready, natural order.
  let order = null;
  let nearCount = null;              // how many markers are in or near the viewport
  try{
    const b = map.getBounds();
    const latPad = (b.getNorth() - b.getSouth()) * 0.5;
    const lngPad = (b.getEast() - b.getWest()) * 0.5;
    const south = b.getSouth() - latPad, north = b.getNorth() + latPad;
    const west  = b.getWest()  - lngPad, east  = b.getEast()  + lngPad;
    const near = [], far = [];
    for(let i = 0; i < allLocationMarkers.length; i++){
      const loc = allLocationMarkers[i].locationData;
      if(loc && loc.lat >= south && loc.lat <= north && loc.lng >= west && loc.lng <= east) near.push(i);
      else far.push(i);
    }
    order = near.concat(far);
    nearCount = near.length;
  }catch(e){ /* map not ready — natural order is still correct, just not prioritized */ }

  let index = 0;

  function processBatch(){
    if(runToken !== _filterRunToken) return; // a newer filter pass superseded this one
    const started = (performance && performance.now) ? performance.now() : Date.now();
    const hardStop = Math.min(index + BATCH_CAP, allLocationMarkers.length);
    const softStop = Math.min(index + BATCH_MIN, allLocationMarkers.length);
    for(; index < hardStop; index++){
      // Yield once the frame budget is spent, but never before BATCH_MIN so a slow frame
      // can't stall progress entirely.
      if(index >= softStop && ((performance && performance.now) ? performance.now() : Date.now()) - started > FRAME_BUDGET_MS) break;
      const m = allLocationMarkers[order ? order[index] : index];
      if(!m) continue; // marker added after this pass's order snapshot — next pass covers it
      const loc = m.locationData;
      if(!loc) continue;
      const openOk = showAllLocations || isLocationOpenNow(loc) !== false;
      // Community said at full threshold there's no public restroom here. Hidden like a
      // confirmed-closed location: the record survives, the pin doesn't.
      const restroomOk = showAllLocations || !isConfirmedNoRestroom(loc);
      const accessOk = !hideInaccessible || !isConfirmedNotAccessible(loc);
      const chainOk = activeChains.has(m.chainKey || DEFAULT_CHAIN_KEY);
      const isMetroLoc = groupOf(m.chainKey || DEFAULT_CHAIN_KEY) === 'metro';
      const isRestLoc = (m.chainKey || DEFAULT_CHAIN_KEY) === 'restarea';
      const zoomOk = (!isMetroLoc || map.getZoom() >= METRO_MIN_ZOOM)
                  && (!isRestLoc || map.getZoom() >= REST_MIN_ZOOM);
      const popupOpen = m.isPopupOpen && m.isPopupOpen();
      if((openOk && restroomOk && accessOk && chainOk && zoomOk) || popupOpen){
        if(!markerCluster.hasLayer(m)) markerCluster.addLayer(m);
      } else if(markerCluster.hasLayer(m)){
        markerCluster.removeLayer(m);
      }
    }
    // Report interactivity when the pins the user can actually SEE are placed, not when the
    // whole country has been processed. Viewport-first ordering puts those in the first frames;
    // the old mark fired ~1.9s later while filling in states nobody is looking at, which
    // measured completion and called it interactivity.
    if(!_mapInteractiveMarked && nearCount != null && index >= nearCount){
      _mapInteractiveMarked = true;
      perfMark('map interactive (' + nearCount + ' pins in view)');
    }
    if(index < allLocationMarkers.length){ requestAnimationFrame(processBatch); }
    else {
      if(!_mapInteractiveMarked){ _mapInteractiveMarked = true; perfMark('map interactive'); }
      if(!_firstFilterPassDone){ _firstFilterPassDone = true; perfMark('all ' + allLocationMarkers.length + ' markers filtered'); }
    }
  }

  requestAnimationFrame(processBatch);
}
let _firstFilterPassDone = false;
let _mapInteractiveMarked = false;

// Clustering now handles which pins render as you pan/zoom (removeOutsideVisibleBounds), so
// applyFilters no longer needs to run on every map move — it runs only when a FILTER changes
// (chain checkboxes, open-now, accessible). This is a big win: no more iterating every marker on
// each pan, and it removes the applyFilters-on-popup-open path that contributed to the earlier
// "popup closes immediately" race.


// Chain filter — lets people show/hide pins per chain when more than one is registered.
// Selection persists across visits via localStorage, stored as a DENY-list (which chains
// are turned off) rather than an allow-list. That way, a chain added later (like Wawa)
// defaults to visible even if someone had already saved a preference before it existed —
// an allow-list would silently hide any chain missing from an old saved selection.
let disabledChains = new Set();
(function(){
  const saved = localStorage.getItem('disabledChains');
  if(!saved) return;
  try{
    const savedArr = JSON.parse(saved);
    if(Array.isArray(savedArr)) disabledChains = new Set(savedArr);
  }catch(e){ /* malformed saved value — keep default of nothing disabled */ }
})();

// Travel mode — the one layer control shown to EVERYONE (logged in or not). It is the core
// "on the road vs on foot" choice, not a personalization. 'road' shows pit stops only (clean
// highway view); 'foot' adds the city/metro restrooms on top. State is set by the onboarding
// preset + current-metro detection (a later step) and can be changed here. Stored for everyone.
let travelMode = 'road';
(function(){ const s = localStorage.getItem('travelMode'); if(s === 'road' || s === 'foot') travelMode = s; })();
function saveTravelMode(){ localStorage.setItem('travelMode', travelMode); }
// A registry entry with group:'metro' belongs to the city layer; anything else is a pit stop.
function groupOf(key){ return (CHAIN_REGISTRY[key] && CHAIN_REGISTRY[key].group) || 'pitstop'; }
function metroKeys(){ return Object.keys(CHAIN_REGISTRY).filter(k => CHAIN_REGISTRY[k].group === 'metro'); }

/* selectedMetro / METRO_BOUNDS / metroAt / insideAnyMetro / maybeAutoSetTravelMode /
 * metroCenter and the city-jump pills were removed together: the Metros tree they fed is long
 * gone, auto mode-switching had already been removed, and two covered-city buttons in a
 * nationwide app advertised NYC and Boston as though they were the coverage. The stored
 * selectedMetro localStorage key is left in place — one entry, clearing it tells nobody
 * anything. */

// Account sync for travel mode (3c). Signed-in users get their choice persisted to their own
// settings doc so it follows them across devices. Signed-out users keep the localStorage value.
// Reads/writes are owner-only (see the settings/{uid} rule); failures fall back to the local pref.
async function loadTravelModeFromAccount(){
  if(!isLoggedIn()) return;
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'settings', getEffectiveId()));
    if(snap.exists()){
      const m = snap.data().travelMode;
      if(m === 'road' || m === 'foot'){
        travelMode = m;                              // the synced choice wins on login
        saveTravelMode();                            // mirror locally
        localStorage.setItem('travelModeChosen', '1'); // it's an explicit choice — auto-detect defers
        renderLayers();
        applyFilters();
      }
    }
  }catch(e){ /* offline or denied — keep the local pref */ }
}
async function saveTravelModeToAccount(){
  if(!isLoggedIn()) return;
  try{
    const {db, doc, setDoc} = await fb();
    await setDoc(doc(db, 'settings', getEffectiveId()), { travelMode }, { merge: true });
  }catch(e){ /* ignore — local pref is already saved */ }
}

// Metro pins only render at city-level zoom or closer. Below this (highway/regional view),
// the map stays pit-stops-only regardless of mode — keeps the road-trip view clean and avoids
// dumping ~1,400 dense city pins into a zoomed-out map.
const METRO_MIN_ZOOM = 12;
// Rest areas are highway features: gate them like metro pins, but at a lower zoom so they appear
// at regional/route level (not on the whole-country view, where ~1,400 pins would be clutter).
const REST_MIN_ZOOM = 8;

// Travel mode is a DIRECTIONS preference only — it picks driving vs walking in the handoff
// to the maps app (see buildNavUrl). It deliberately does NOT filter which locations show:
// hiding every gas station because someone is on foot removed options they might still want,
// and the chain/group toggles are the right tool for choosing what appears.
function modeAllows(loc){
  return true;
}

function getActiveChains(){
  // Chain filtering is PUBLIC (part of the core restroom-finding experience — the map key
  // is the filter). The deny-list persists locally for everyone, signed in or not.
  return new Set(Object.keys(CHAIN_REGISTRY).filter(k => !disabledChains.has(k)));
}
let activeChains = getActiveChains();

// Re-apply chain visibility whenever auth state changes: recompute the active set, refresh the
// filter checkboxes, show the control only when signed in, and repaint the map. Called from
// updateAccountUI() (which fires on every login/logout).
function syncChainFilterToAuth(){
  activeChains = getActiveChains();
  renderLayers();
  if(typeof renderChainKey === 'function') renderChainKey();
  if(typeof renderNavPref === 'function') renderNavPref();
  applyFilters();
}

function saveDisabledChains(){
  localStorage.setItem('disabledChains', JSON.stringify(Array.from(disabledChains)));
}

// (The road-bucket drawer filter was removed — the chain key on the map is now the single
// filter surface, with per-chain rows for everything currently renderable. The TRAVEL_KEYS
// constant that lived here went with it; it had drifted to contain 'pilot', which is not a
// CHAIN_REGISTRY key — the canonical key is 'pilotFlyingJ'. Use TRAVEL_CENTER_KEYS.)


// ---- Travel mode toggle (on the road / on foot) ------------------------------------------
// The one open control: shown to everyone, but only once a metro layer actually exists in the
// registry (group:'metro'). Until then the drawer is unchanged. 'road' = pit stops only; 'foot'
// = pit stops + city restrooms. The per-chain and per-city checkboxes below it stay a signed-in
// refinement (gated), same as the chain filter has always been.
function renderLayers(){
  const metros = metroKeys();
  const hasMetros = metros.length > 0;
  const modePref = document.getElementById('travelModePref');
  if(modePref) modePref.style.display = hasMetros ? '' : 'none';
  if(!hasMetros) return;

  const sel = document.getElementById('travelModeSelect');
  if(sel && sel.value !== travelMode) sel.value = travelMode;

  /* The "Covered — tap to jump" pills are gone: two buttons, NYC and Boston, presented as the
   * app's coverage — no longer true with public restrooms in all 51 jurisdictions. On foot now
   * means walkable restrooms anywhere. (The per-city Metros tree went earlier for the same
   * underlying reason.) */
}

// Mode dropdown — everyone. Road ⟷ foot picks DRIVING vs WALKING directions, nothing else;
// the map shows the same pins either way. A manual pick syncs to the account.
document.getElementById('travelModeSelect')?.addEventListener('change', (e) => {
  travelMode = (e.target.value === 'foot') ? 'foot' : 'road';
  localStorage.setItem('travelModeChosen', '1');
  saveTravelMode(); saveTravelModeToAccount(); renderLayers(); applyFilters();
});

// ============================================================
// Chain key — the map key IS the chain filter
// ============================================================
// A pill at the top-left expands into a panel: the hide-closed toggle on top, then one
// tappable row per chain with at least one location in (or within half a screen of) the
// current view, then a nested "All chains" drawer for everything else. Tapping a row
// toggles that chain through the same disabledChains deny-list the map has always used,
// so selections persist across visits and across map movement — a chain deselected here
// stays deselected while you pan away, and reappears still-deselected when you pan back.
// Public to everyone: finding (or hiding) a chain is core restroom-finding, not a perk.

// Is this chain drawable on the map RIGHT NOW (zoom gates + travel mode + data loaded)?
// The in-area list only offers chains the map could actually show, so the key never
// contradicts the map.
function chainRenderableNow(key){
  if(!chainHasData(key)) return false;
  const g = groupOf(key);
  /* Travel mode does NOT filter the map. It briefly did — On foot hid every drive-to chain —
   * but hiding real open restrooms from someone because of how they arrived is the app working
   * against its one job: a person walking past a Casey's still needs to know its bathroom is
   * there. Mode now does exactly what its name says and nothing else: buildNavUrl requests
   * walking or driving directions. (An older comment already stated this design; the filtering
   * here contradicted it.) Zoom gates are density control and stay. */
  if(g === 'metro' && map.getZoom() < METRO_MIN_ZOOM) return false;
  if((key === 'restarea' || isPublicRestroomChain(key)) && map.getZoom() < REST_MIN_ZOOM) return false;
  return true;
}

// Which chains have at least one location within the padded viewport? One flat pass over
// seedLocations (~23k raw compares, well under a frame) with an early skip per found chain.
function chainsInViewport(){
  let south, north, west, east;
  try{
    const b = map.getBounds();
    const latPad = (b.getNorth() - b.getSouth()) * 0.5;
    const lngPad = (b.getEast() - b.getWest()) * 0.5;
    south = b.getSouth() - latPad; north = b.getNorth() + latPad;
    west  = b.getWest()  - lngPad; east  = b.getEast()  + lngPad;
  }catch(e){ return null; } // map not ready yet
  const found = new Set();
  for(let i = 0; i < seedLocations.length; i++){
    const loc = seedLocations[i];
    const k = loc.chain || DEFAULT_CHAIN_KEY;
    if(found.has(k)) continue;
    if(loc.lat >= south && loc.lat <= north && loc.lng >= west && loc.lng <= east) found.add(k);
  }
  return found;
}

// Two renderings of the same row. Signed in: a real switch you can tap. Signed out: a plain
// legend entry — not a button, no checkmark, nothing that invites a tap it can't honour.
// (Deliberately no toast/popup on tap; a single quiet line at the panel foot does the telling.)
/* One row per DISPLAY NAME, not per registry key.
 *
 * Several chains exist once per metro — nycDunkin + bosDunkin, nycStarbucks + bosStarbucks,
 * nycPublic + bosPublic — and each pair shares a display name, so the list showed
 * "Public restroom" twice with no way to tell them apart. A user doesn't care that the data
 * is split by city; they want one switch.
 *
 * Grouping by name rather than de-duplicating by hand means a chain added to a third city
 * can never reintroduce the problem: the renderer resolves it instead of relying on someone
 * remembering to keep names unique. */
function groupKeysByName(keys){
  const byName = new Map();
  for(const k of keys){
    const nm = (CHAIN_REGISTRY[k] || {}).name || k;
    if(!byName.has(nm)) byName.set(nm, []);
    byName.get(nm).push(k);
  }
  if(window.__brDebug){
    for(const [nm, ks] of byName) if(ks.length > 1)
      console.warn('[chain key] display name "' + nm + '" shared by: ' + ks.join(', ') + ' — merged into one row');
  }
  return byName;
}

// A merged row is "on" unless every chain behind it is off, so a half-on state reads as on
// rather than silently hiding pins the user thinks are showing.
function chainKeyRowHtml(keys, readOnly){
  const list = Array.isArray(keys) ? keys : [keys];
  const c = CHAIN_REGISTRY[list[0]];
  if(!c) return '';
  const off = list.every(k => disabledChains.has(k));
  const dot = `<span class="ck-dot" style="background:${c.color}"></span>`;
  const name = `<span class="ck-name">${escapeHtml(c.name)}</span>`;
  if(readOnly){
    return `<div class="ck-row ck-legend">${dot}${name}</div>`;
  }
  return `<button type="button" class="ck-row${off ? ' ck-off' : ''}" data-chain="${list.join(',')}" role="switch" aria-checked="${!off}">${dot}${name}<span class="ck-mark" aria-hidden="true">✓</span></button>`;
}

// Which of the four All-chains groups a chain belongs to. Registry-driven where the registry
// already knows (group:'metro' = city layer); only the travel/public sets are hand-kept.
// (TRAVEL_CENTER_KEYS is defined once, near CHAIN_REGISTRY, and shared with the achievements.)
function chainBucket(key){
  if(groupOf(key) === 'metro') return 'city';
  /* layer:'public' rather than a hand-kept key list — nycPublic and bosPublic were reachable
   * only via their metro group before, so dropping that group from them without this change
   * would have silently filed 2,500 public restrooms under "Gas & convenience". */
  if(key === 'restarea' || isPublicRestroomChain(key)) return 'public';
  if(TRAVEL_CENTER_KEYS.has(key)) return 'travel';
  return 'gas';
}
/* icon and text are separate so the drawer can render the icon inside the same fixed-width
   .d-ico slot the static rows use — emoji advance widths differ, so an inline "emoji label"
   would start its text at a different x than Passport / FAQ / Preferences above it. */
/* No icons: these rows are rendered INTO the drawer, which is text-only, and a picture beside
 * "Gas & convenience" says nothing the label doesn't. */
const CK_GROUPS = [
  { id: 'gas',    label: 'Gas & convenience' },
  { id: 'travel', label: 'Travel centers' },
  { id: 'public', label: 'Public restrooms' },
  /* "Coffee shops", not "City & metro". The group holds exactly seven things — Dunkin',
   * Starbucks, Caffè Nero, Tatte, Pavement, Flour and Gregorys — and every one of them is a
   * coffee shop or a bakery-café. "City & metro" described the internal reason they were
   * grouped (they came from the two metro datasets) rather than what they ARE, which is the
   * only thing the person reading the row cares about. */
  { id: 'city',   label: 'Coffee shops' }
];

// Rebuilds are cheap but not free — skip the DOM write when nothing changed (same chains,
// same on/off states). The signature covers both lists plus the count in the pill.
let _chainKeySig = '';
function renderChainKey(){
  const areaList = document.getElementById('chainKeyAreaList');
  const allList = document.getElementById('chainKeyAllList');
  const countEl = document.getElementById('chainKeyCount');
  if(!areaList || !allList) return;

  const readOnly = !isLoggedIn();
  const inView = chainsInViewport();
  const areaKeys = Object.keys(CHAIN_REGISTRY)
    .filter(k => chainRenderableNow(k) && inView && inView.has(k))
    .sort((a, b) => CHAIN_REGISTRY[a].name.localeCompare(CHAIN_REGISTRY[b].name));
  const allKeys = Object.keys(CHAIN_REGISTRY)
    .filter(k => chainHasData(k))
    .sort((a, b) => CHAIN_REGISTRY[a].name.localeCompare(CHAIN_REGISTRY[b].name));

  // Login state is part of the signature: signing in must flip legend → switches immediately.
  // Zoom and travel mode change the empty-state wording, so they belong in the signature —
  // otherwise the advice goes stale while the user zooms.
  // Zoom still shapes the empty-state advice; travel mode no longer changes what renders.
  const emptyCtx = areaKeys.length ? '' : ('|z' + map.getZoom());
  const sig = areaKeys.join(',') + '|' + allKeys.join(',') + '|' +
              [...disabledChains].sort().join(',') + '|' + (readOnly ? 'ro' : 'rw') + emptyCtx;
  if(sig === _chainKeySig) return;
  _chainKeySig = sig;

  areaList.innerHTML = areaKeys.length
    ? [...groupKeysByName(areaKeys).values()].map(ks => chainKeyRowHtml(ks, readOnly)).join('')
    : chainKeyEmptyHtml(inView);

  // The drawer holds four GROUP toggles, not individual places. Coarse control lives here;
  // the map key does per-place. Turning a group ON clears every disabled chain inside it,
  // which makes the drawer the recovery path when a place you switched off is no longer in
  // your viewport (switch off Sheetz in PA, drive to NY, and it's not in the key to find).
  allList.innerHTML = CK_GROUPS.map(g => {
    const keys = allKeys.filter(k => chainBucket(k) === g.id);
    if(!keys.length) return '';
    const on = !keys.every(k => disabledChains.has(k));

    if(readOnly){
      const mappedRO = keys.reduce((n, k) => n + ((window[CHAIN_REGISTRY[k].dataVar] || []).length), 0);
      const shownRO = groupKeysByName(keys).size;
      return `<div class="d-toggle ck-grouprow d-gated">` +
             `<span class="ss-main"><span class="ss-lab">${escapeHtml(g.label)}</span>` +
             `<span class="ss-desc">${mappedRO.toLocaleString()} mapped &middot; ${shownRO} chain${shownRO === 1 ? '' : 's'}</span></span>` +
             `<span class="d-switch"><b></b></span></div>`;
    }
    /* Reuses the settings switch rather than the map key's checkmark: a checkmark reads as
     * "selected", and the question here is shown or hidden.
     *
     * The count is the point of the row. "Gas & convenience" alone says nothing about what
     * turning it off costs you; "20,380 mapped · 23 chains" does, and it is the difference
     * between a switch you can reason about and one you flip to find out. */
    const mapped = keys.reduce((n, k) => n + ((window[CHAIN_REGISTRY[k].dataVar] || []).length), 0);
    /* Count what the next screen actually LISTS, which is names, not registry keys.
     *
     * groupKeysByName merges chains sharing a display name — the NYC and Boston copies of
     * Dunkin' and Starbucks are separate keys, and the four public-restroom sets all render as
     * "Public restroom". So the row promised 9 chains and opened onto 7 rows, and 5 onto 2.
     * A count that disagrees with the list one tap away is worse than no count. */
    const shown = groupKeysByName(keys).size;
    const sub = `${mapped.toLocaleString()} mapped &middot; ${shown} chain${shown === 1 ? '' : 's'}`;
    /* TWO hit areas in one row, the way a phone's own settings do it: the switch turns the whole
     * group on or off, and anything else opens the list of chains inside it. A row that only
     * navigated would bury the common action one level down; a row that only toggled would
     * leave no way to reach an individual chain. */
    return `<div class="d-toggle ck-grouprow${on ? ' on' : ''}" data-groupkeys="${keys.join(',')}" data-group="${g.id}">` +
      `<button type="button" class="ck-groupopen" data-ss-chains="${g.id}" data-group-label="${escapeHtml(g.label)}">` +
        `<span class="ss-main"><span class="ss-lab">${escapeHtml(g.label)}</span>` +
        `<span class="ss-desc">${sub}</span></span>` +
        `<svg class="ss-chev" viewBox="0 0 8 14" fill="none" aria-hidden="true"><path d="M1 1l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>` +
      `</button>` +
      `<button type="button" class="ck-groupsw" data-groupkeys="${keys.join(',')}" role="switch" aria-checked="${on}"` +
        ` aria-label="${escapeHtml(g.label)}, all ${keys.length} on the map"><span class="d-switch"><b></b></span></button>` +
      `</div>`;
  }).join('');

  if(countEl) countEl.textContent = areaKeys.length ? String(areaKeys.length) : '';
  const note = document.getElementById('chainKeySigninNote');
  if(note) note.hidden = !readOnly;
  updateChainKeyScrollHint();
}

// An empty list has three very different causes, and the advice for each is the opposite of
// the others. Telling someone to zoom OUT when the pins are hidden by a zoom-IN gate (the
// old blanket message) sends them further from what they're looking for.
function chainKeyEmptyHtml(inView){
  const msg = (text) => `<div class="ck-empty">${text}</div>`;
  const present = inView ? [...inView].filter(k => chainHasData(k)) : [];
  if(!present.length){
    // Genuinely nothing mapped nearby — here zooming out is the right advice.
    return msg('No mapped places in this area yet — try zooming out, or tap 📍 We Missed One?');
  }

  const z = map.getZoom();
  const zoomBlocked = [];
  // The metro group holds only the city café chains now that public restrooms left it.
  if(present.some(k => groupOf(k) === 'metro') && z < METRO_MIN_ZOOM) zoomBlocked.push('city caf\u00e9s');
  if(present.some(k => chainBucket(k) === 'public') && z < REST_MIN_ZOOM) zoomBlocked.push('public restrooms');
  if(zoomBlocked.length){
    return msg('🔍 Zoom in to see ' + zoomBlocked.join(' and ') + ' around here.');
  }

  return msg('Nothing mapped at this zoom yet — try zooming out, or tap 📍 We Missed One?');
}

// Fade + half-cut row only when the in-area list actually overflows — an affordance that lies
// when there's nothing to scroll is worse than none.
function updateChainKeyScrollHint(){
  const wrap = document.getElementById('chainKeyScrollWrap');
  const list = document.getElementById('chainKeyAreaList');
  if(!wrap || !list) return;
  wrap.classList.toggle('has-more', list.scrollHeight > list.clientHeight + 2);
}

/* Drawer group toggle. Returns false when it handled the tap.
 *
 * Turning a group ON clears every disabled chain inside it rather than merely un-disabling
 * the group, which makes it a reset for that category. That is deliberate: it's the only way
 * back for a place you switched off somewhere you're no longer standing, since the map key
 * only lists what's currently around you. The cost is that turning a group on discards
 * per-place choices within it, which is what "turn this whole category on" should mean. */
function onChainKeyGroupTap(e){
  if(!isLoggedIn()) return true;               // signed out these are a legend, not controls
  /* Only the switch half toggles. Without this the whole row still fired, so opening the chain
   * list would ALSO flip the entire group off on the way in — a destructive side effect of a
   * navigation tap. */
  const sw = e.target.closest('.ck-groupsw');
  if(!sw) return true;
  const row = sw;
  if(!row) return true;
  const keys = String(row.dataset.groupkeys || '').split(',').filter(k => CHAIN_REGISTRY[k]);
  if(!keys.length) return false;
  const before = new Set(disabledChains);
  const turningOff = !keys.every(k => disabledChains.has(k));
  keys.forEach(k => turningOff ? disabledChains.add(k) : disabledChains.delete(k));
  activeChains = getActiveChains();
  if(activeChains.size === 0){                 // never blank the whole map
    disabledChains = before;
    activeChains = getActiveChains();
  }
  saveDisabledChains();
  renderChainKey();
  applyFilters();
  /* The row on the previous screen states the count, so it has to follow a group toggle —
   * otherwise backing out shows a number that contradicts the switches just changed. */
  if(typeof ssSyncValues === 'function') ssSyncValues();
  // Turning the public-restroom layer on is the trigger for its first download — without this
  // nothing would arrive until the next pan, so the toggle would look broken for a moment.
  if(typeof maybeLoadPublicRegions === 'function') maybeLoadPublicRegions();
  if(navigator.vibrate) navigator.vibrate(5);
  return false;
}

function onChainKeyRowTap(e){
  if(!isLoggedIn()) return;              // signed out the rows are a legend, not controls
  const row = e.target.closest('.ck-row');
  if(!row) return;
  // A row can stand for several registry keys (same display name in different metros).
  const keys = String(row.dataset.chain || '').split(',').filter(k => CHAIN_REGISTRY[k]);
  if(!keys.length) return;
  const before = new Set(disabledChains);
  // Turning the row off means all of them off; on means all on — never leave a mixed state,
  // which would show as "on" while some pins stayed hidden.
  const turningOff = !keys.every(k => disabledChains.has(k));
  keys.forEach(k => turningOff ? disabledChains.add(k) : disabledChains.delete(k));
  activeChains = getActiveChains();
  // Never allow the whole map to blank out — if nothing is left active, revert this toggle.
  if(activeChains.size === 0){
    disabledChains = before;
    activeChains = getActiveChains();
  }
  saveDisabledChains();
  renderChainKey();
  applyFilters();
  /* The row on the previous screen states the count, so it has to follow a group toggle —
   * otherwise backing out shows a number that contradicts the switches just changed. */
  if(typeof ssSyncValues === 'function') ssSyncValues();
  // Turning the public-restroom layer on is the trigger for its first download — without this
  // nothing would arrive until the next pan, so the toggle would look broken for a moment.
  if(typeof maybeLoadPublicRegions === 'function') maybeLoadPublicRegions();
  if(navigator.vibrate) navigator.vibrate(5);
}

(function(){
  const pill = document.getElementById('chainKeyPill');
  const panel = document.getElementById('chainKeyPanel');
  const allList = document.getElementById('chainKeyAllList');
  if(!pill || !panel) return;

  pill.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    pill.setAttribute('aria-expanded', String(open));
    const arrow = document.getElementById('chainKeyArrow');
    if(arrow) arrow.textContent = open ? '▴' : '▾';
    if(open) renderChainKey(); // fresh list the moment it opens
  });

  document.getElementById('chainKeyAreaList')?.addEventListener('click', onChainKeyRowTap);
  // The full list now lives in the hamburger drawer ("All chains") but shares the same rows,
  // state and handler — it's the safety net for a chain that's off or outside the viewport.
  // Group headers collapse; chain rows toggle.
  allList?.addEventListener('click', (e) => {
    if(onChainKeyGroupTap(e) !== false) onChainKeyRowTap(e);
  });

  // The in-area list follows the map. moveend fires once per settled pan/zoom (zooms end
  // with a moveend too), never continuously during a drag — the performance contract.
  map.on('moveend', renderChainKey);
  map.on('moveend', maybeLoadPublicRegions);
  /* Deferred, NOT called synchronously — the same temporal-dead-zone trap as the drawer count.
   * maybeLoadPublicRegions reads publicRegionState, a `const` declared a few lines below this
   * IIFE; the function itself hoists but the const does not, so a synchronous call here threw
   * ReferenceError, halted top-level execution, and took out everything declared after it —
   * the All-places drawer toggle stopped binding, and since the const then never initialized,
   * every subsequent moveend threw too and no region ever loaded. setTimeout(0) runs after the
   * whole script has evaluated, when every const exists. */
  setTimeout(maybeLoadPublicRegions, 0);
})();


/* ============================================================================
 *  Nationwide public restrooms — on-demand region loading
 * ============================================================================
 * 61,788 records in ten files, 18 MB in total. None of it is in index.html, and that is the
 * whole design: eager-loading even one region would more than double what every visitor
 * downloads before the map draws, for a layer most of them never turn on.
 *
 * Only public-toilets-manifest.js ships up front (46 KB). It carries, per region, the file
 * name, the record count, the byte size, and the set of occupied quarter-degree grid cells.
 * Cells rather than a bounding box because a box cannot describe a state that is not a
 * rectangle — California's bounds reach far enough east to contain Las Vegas, so a bbox test
 * had a Nevada viewport pulling 2.9 MB from the wrong side of the border.
 */
const publicRegionState = {};        // region -> 'loading' | 'loaded' | 'failed'

/* Every cell the current viewport touches, padded by half a screen so a region starts loading
 * just before it is needed rather than the instant a pin should already be visible.
 *
 * Takes the grid size directly: all ten regions are built at the same resolution, so this is
 * computed ONCE per pan and tested against each region, not rebuilt ten times. */
function viewportCells(g){
  const latOff = Math.ceil(90 / g), lngOff = Math.ceil(180 / g), stride = Math.round(360 / g) + 2;
  const b = map.getBounds();
  const latPad = (b.getNorth() - b.getSouth()) * 0.5;
  const lngPad = (b.getEast() - b.getWest()) * 0.5;
  const south = b.getSouth() - latPad, north = b.getNorth() + latPad;
  const west = b.getWest() - lngPad,  east = b.getEast() + lngPad;
  /* A zoomed-out view can span the continent, and walking every quarter-degree cell in it would
   * be tens of thousands of iterations on every pan, so wide views bail.
   *
   * The cap is 2,500 because it must clear REST_MIN_ZOOM on every screen. The layer renders
   * from zoom 8, so the loader has to be willing to load there too — and a desktop window at
   * zoom 8 is 2,172 padded cells. The original cap of 400 opened a dead band (zoom 8 anywhere,
   * 8–9 on desktop) where pins were permitted but data was silently never fetched: Tampa and
   * LA at metro zoom showed nothing, with no error and no request. Measured cells by zoom,
   * desktop/phone: z8 2172/612 · z9 568/166 · z10 155/49. Above the cap now means genuinely
   * continental (z7 desktop is ~8,700), where the zoom gate hides the layer anyway. 2,500 Set
   * inserts per settled pan is trivial. */
  const cellSpan = ((north - south) / g + 1) * ((east - west) / g + 1);
  if(cellSpan > 2500) return null;
  const out = new Set();
  for(let la = Math.floor(south / g); la <= Math.floor(north / g); la++)
    for(let ln = Math.floor(west / g); ln <= Math.floor(east / g); ln++)
      out.add((la + latOff) * stride + (ln + lngOff));
  return out;
}

/* Metered and slow connections get a deliberate opt-out. The layer being on is consent to the
 * feature, not to a multi-megabyte download on a capped plan in the middle of a road trip —
 * which is exactly the situation this app exists for. */
function connectionIsConstrained(){
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if(!c) return false;
  return c.saveData === true || ['slow-2g', '2g'].includes(c.effectiveType);
}

function loadPublicRegion(entry){
  if(publicRegionState[entry.region]) return;
  publicRegionState[entry.region] = 'loading';
  /* A plain <script> tag, not fetch+eval: the region files are executable JS that push onto a
   * global, the browser streams and parses them off the main thread far better than a manual
   * eval would, and the service worker can cache them like any other asset. */
  const s = document.createElement('script');
  s.src = entry.file;
  s.async = true;
  s.onload = () => {
    publicRegionState[entry.region] = 'loaded';
    ingestPublicRegion(entry);
  };
  s.onerror = () => {
    // Left as 'failed' rather than cleared, so a flaky connection can't turn one bad fetch into
    // a retry on every single pan.
    publicRegionState[entry.region] = 'failed';
    console.warn('public region failed to load:', entry.file);
  };
  document.head.appendChild(s);
}

/* Merge newly-arrived records into the structures built at startup.
 *
 * seedLocations and locationsById are populated once, synchronously, at script parse time —
 * anything arriving later is invisible to the app without this: no marker, no search result, no
 * count. Only the records this file added are walked, using the marker array's length as the
 * high-water mark, so a second region does not re-index the first. */
function ingestPublicRegion(entry){
  const source = window.usPublicLocations || [];
  const added = [];
  for(const loc of source){
    if(locationsById[loc.id]) continue;      // already indexed by an earlier region or the seed
    if(!loc.chain) loc.chain = 'usPublic';
    locationsById[loc.id] = loc;
    seedLocations.push(loc);
    added.push(loc);
  }
  if(!added.length) return;
  added.forEach(loc => addMarker(loc));
  // addMarker deliberately does not touch the map; applyFilters is the single authority on what
  // is rendered, and it already batches across frames with viewport-first ordering, so several
  // thousand new pins fill in progressively instead of freezing the map.
  applyFilters();
  renderChainKey();
  updateDrawerLocCount();   // the footer count claims coverage — keep it true as regions land
  perfMark(`public region ${entry.region} ingested (${added.length} locations)`);
}

function maybeLoadPublicRegions(){
  const manifest = window.publicToiletManifest;
  if(!Array.isArray(manifest) || !manifest.length) return;
  if(disabledChains.has('usPublic')) return;        // layer is off — download nothing
  if(connectionIsConstrained()) return;
  if(typeof map === 'undefined' || !map.getBounds) return;
  // Nothing left to consider once every region has been tried — skip the geometry entirely.
  if(manifest.every(e => publicRegionState[e.region])) return;

  const cells = viewportCells(manifest[0].grid);
  if(!cells) return;                                // zoomed too far out to mean anything
  for(const entry of manifest){
    if(publicRegionState[entry.region]) continue;
    if(entry.cells.some(c => cells.has(c))) loadPublicRegion(entry);
  }
}

/* The Preferences collapse is gone. Three switches behind a disclosure — one of them Appearance,
 * which is the single thing most people open this drawer to change — cost a tap for no benefit
 * once the SETTINGS heading says what they are. The stored prefsCollapsed key is simply left; it
 * is one localStorage entry and removing it would break nothing but tell nobody anything. */

// Drawer "All chains" — holds the grouped full list moved out of the map key.
(function(){
  const toggle = document.getElementById('allChainsToggle');
  const body = document.getElementById('chainKeyAllList');
  const arrow = document.getElementById('allChainsArrow');
  if(!toggle || !body || !arrow) return;
  const setCollapsed = (collapsed) => {
    body.classList.toggle('collapsed', collapsed);
    arrow.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    // It is a real <button> now, so its state has to be announced, not just drawn.
    toggle.setAttribute('aria-expanded', String(!collapsed));
    localStorage.setItem('allChainsCollapsed', collapsed ? '1' : '0');
  };
  const saved = localStorage.getItem('allChainsCollapsed');
  setCollapsed(saved === null ? true : saved === '1');
  toggle.addEventListener('click', () => setCollapsed(!body.classList.contains('collapsed')));
})();

applyAuthVisibility();
renderChainKey();
renderLayers();
applyFilters();


// Directions-app preference (drawer, signed-in only). The highlighted button reflects the app
// that will actually open — the explicit saved choice, or the device default when none is set.
function renderNavPref(){
  const sel = document.getElementById('navAppSelect');
  if(!sel) return;
  sel.value = resolveNavApp();   // reflect the active app (explicit choice or device default)
}
document.getElementById('navAppSelect')?.addEventListener('change', (e) => {
  localStorage.setItem('preferredNavApp', e.target.value);
  renderNavPref();
});
renderNavPref();

// Closed-locations filter — a left pill on the map. On by default → the map hides
// confirmed-closed spots (open + unknown-hours stay visible). Tapping it off shows
// everything, including confirmed-closed. Drives the same `showAllLocations` state.
// The label itself changes with the state so on/off is unambiguous.
// Hide-closed now lives in the drawer's Preferences as a switch, matching the accessibility
// toggle beside it. Same `showAllLocations` state; on = confirmed-closed hidden (the default).
(function(){
  const t = document.getElementById('openNowToggle');
  if(!t) return;
  const sync = () => {
    const filtering = !showAllLocations;
    t.classList.toggle('on', filtering);
    t.setAttribute('aria-pressed', String(filtering));
  };
  sync();
  window.syncOpenNowToggle = sync;
  t.addEventListener('click', () => {
    if(!isLoggedIn()) return;                     // gated: anonymous keeps the defaults
    showAllLocations = !showAllLocations;
    sync();
    applyFilters();
  });
})();

// Accessibility filter — a drawer switch. Off by default. When on, hides ONLY pins confirmed
// not wheelchair-accessible (community-confirmed no, OSM wheelchair=no, or legacy baked no).
// Locations with unknown accessibility always stay visible, since they may well be accessible.
(function(){
  const t = document.getElementById('accessibleToggle');
  if(!t) return;
  const sync = () => {
    t.classList.toggle('on', hideInaccessible);
    t.setAttribute('aria-pressed', String(hideInaccessible));
  };
  sync();
  window.syncAccessibleToggle = sync;
  t.addEventListener('click', () => {
    if(!isLoggedIn()) return;                     // gated: anonymous keeps the defaults
    hideInaccessible = !hideInaccessible;
    sync();
    applyFilters();
  });
})();

// List view — sortable without adding a permanent map search bar
let currentListPosition = null;
// (accessible-scan removed — the List is distance-only and reads nothing)

const NEAREST_COUNT = 10; // List shows only the closest few — a quick launcher into the map
async function buildListView(){
  const container = document.getElementById('listViewItems');
  container.innerHTML = '<div style="padding:16px;color:#999;">Finding your location…</div>';

  // Nearest-first, so it needs the user's location. Reuse a recent fix, else request one.
  if(!currentListPosition){
    if(lastKnownPos && (Date.now()-lastKnownPos.ts) < 5*60*1000) currentListPosition = lastKnownPos;
    else currentListPosition = await getVerifiedPosition();
  }
  if(!currentListPosition){
    container.innerHTML = '<div style="padding:22px 18px;color:#c7d5e2;text-align:center;line-height:1.5;">📍 Turn on location to see the bathrooms closest to you.</div>';
    return;
  }
  setUserLocationMarker(currentListPosition.lat, currentListPosition.lng);

  // Distance-only + capped: no ratings, no reads to build. Details load when a pin is opened.
  const nearest = seedLocations
    .filter(loc => modeAllows(loc) && !isConfirmedNoRestroom(loc)
                && activeChains.has(loc.chain || DEFAULT_CHAIN_KEY))
    .map(loc => ({ loc, dist: milesBetween(currentListPosition.lat, currentListPosition.lng, loc.lat, loc.lng) }))
    .sort((a,b) => a.dist - b.dist)
    .slice(0, NEAREST_COUNT);

  document.getElementById('listViewHeader').querySelector('span').textContent = 'Closest bathrooms';
  container.innerHTML = nearest.map(({loc,dist}) => {
    const open = isLocationOpenNow(loc);
    /* null covers two different things and they must not read the same. Either we have no hours
     * at all, or we have hours but the location is too far away for the device clock to judge
     * them (see OPEN_NOW_CONFIDENT_MILES). Saying "Hours unavailable" when the hours are right
     * there would be a worse answer than the one this change removes. */
    const status = open===true ? '🟢 Open'
      : open===false ? '🔴 Closed'
      : (todayHrsString(loc) ? '🕐 ' + formatHrsDisplay(loc) : '⚪ Hours unavailable');
    /* The chain, which the list never showed.
     *
     * Rows rendered loc.n only — the LOCATION name ("Watervliet Shaker Rd, Colonie"). "Stewart's
     * Shops" and "Cumberland Farms" appeared purely because that happens to be the name field on
     * those records, so the list looked inconsistent when it was actually uniform. Scanning for a
     * brand you trust is half of what this list is for.
     *
     * Same brand-coloured chip the popup uses. Omitted entirely where there is no chain — public
     * restrooms and metro entries — rather than shown empty. */
    const ch = CHAIN_REGISTRY[loc.chain || ''];
    const chainChip = ch
      ? `<span class="list-item-chain" style="background:${ch.color};color:${ch.textColor};">${escapeHtml(ch.name)}</span>`
      : '';
    /* Chain, then address. The location NAME is dropped: for most records loc.n is a street
     * ("Watervliet Shaker Rd, Colonie") and loc.addr is the same street with a number on it, so
     * the row said the same thing twice and pushed the distance further down.
     *
     * The address is the primary line now — it is the part that tells two nearby Stewart's apart,
     * which is the only job the name was doing. Where a record has no address, the name is the
     * fallback rather than leaving the row with nothing but a chip. */
    const primary = loc.addr || loc.n || '';
    return `<div class="list-item" data-locid="${loc.id}">${chainChip}<div class="list-item-name">${escapeHtml(primary)}</div><div class="list-item-meta"><span>📍 ${dist.toFixed(1)} mi</span><span>${status}</span></div></div>`;
  }).join('');
}
document.getElementById('listViewToggle').addEventListener('click',()=>{buildListView();document.getElementById('listViewPanel').classList.add('show');document.body.classList.add('list-open');});
document.getElementById('listViewClose').addEventListener('click',()=>{document.getElementById('listViewPanel').classList.remove('show');document.body.classList.remove('list-open');suppressNextLocateClick=true;setTimeout(()=>{suppressNextLocateClick=false;},400);});

// Account panel
/* accountPanelMode is gone. It tracked which of two views the shared panel was showing; there is
 * one view now, and which FACE is showing lives on the .flipped class where the CSS can see it. */

// Signed-out shaping of the drawer + key, in one place so every auth change agrees:
//  • Passport is a signed-in feature — hide the entry rather than teasing it.
//  • Preferences are gated; anonymous users keep the defaults (confirmed-closed hidden).
//  • The chain key re-renders as a read-only legend.
function applyAuthVisibility(){
  const loggedIn = isLoggedIn();

  // NB: a class, not style.display — the row's own rule sets display:flex, which an inline
  // style cannot beat. The .is-hidden rule carries !important to match.
  const passport = document.getElementById('ssPassportRow');
  if(passport) passport.classList.toggle('is-hidden', !loggedIn);

  /* Two map controls that do nothing useful signed out.
   *
   * "Add a place" opens a form whose submit requires an account, so it was an invitation to
   * fill something in and then be told no. The Filter pill was worse: signed out its rows are
   * a legend rather than switches — by its own comment, "a legend, not controls" — so it looked
   * like a filter, opened like a filter, and could not filter.
   *
   * Both are hidden rather than disabled. A disabled control still occupies the corner of a map
   * and still asks to be understood; the honest version of a control you cannot use is its
   * absence, and the onboarding already says an account unlocks filtering. */
  const addPlace = document.getElementById('missingBtn');
  if(addPlace) addPlace.classList.toggle('is-gone', !loggedIn);
  const filterPill = document.getElementById('chainKey');
  if(filterPill) filterPill.classList.toggle('is-gone', !loggedIn);
  /* Close the panel on the way out, or signing out while it is open leaves an orphaned popover
   * floating over the map with no control attached to it. */
  if(!loggedIn) document.getElementById('chainKeyPanel')?.classList.remove('open');

  ['openNowToggle', 'accessibleToggle', 'themeToggle'].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    el.disabled = !loggedIn;
    el.classList.toggle('d-gated', !loggedIn);
  });
  const gateNote = document.getElementById('prefsGateNote');
  if(gateNote) gateNote.hidden = loggedIn;

  // Signing out returns the map to the anonymous defaults, so nobody is stranded with a
  // filter they can no longer reach.
  if(!loggedIn){
    let changed = false;
    if(showAllLocations){ showAllLocations = false; changed = true; }
    if(hideInaccessible){ hideInaccessible = false; changed = true; }
    if(typeof window.syncOpenNowToggle === 'function') window.syncOpenNowToggle();
    if(typeof window.syncAccessibleToggle === 'function') window.syncAccessibleToggle();
    if(changed) applyFilters();
  }

  renderChainKey();
}

function updateAccountUI(){
  const loggedIn = isLoggedIn();
  applyAuthVisibility();
  document.getElementById('loggedOutView').style.display = loggedIn ? 'none' : 'block';
  document.getElementById('loggedInView').style.display = loggedIn ? 'block' : 'none';
  const _cb = document.getElementById('communityBanner');
  if(_cb) _cb.style.display = loggedIn ? 'none' : '';   // banner is logged-out only
  document.body.classList.toggle('logged-in', loggedIn);   // gates signed-in-only UI (theme toggle, etc.)
  syncChainFilterToAuth();                                  // logged-out shows all chains; logged-in restores the filter
  const accountBtn = document.getElementById('accountToggle');
  if(loggedIn){
    // Show the name as chosen. This used to uppercase it, which turned "Dave" into "DAVE" —
    // a third rendering of the same name. Never shows the raw address or uid.
    if(accountBtn) accountBtn.textContent = '👤 ' + displayNameFor();
  } else if(accountBtn){
    accountBtn.textContent = '👤 Log In';
  }
  const syncNote = document.getElementById('passportSyncNote');
  if(syncNote) syncNote.style.display = loggedIn ? 'none' : 'block';
}

/* One panel. Account and Passport were two modes of the same element, switched between; they are
 * now one view whose card flips. `mode` no longer picks a view — it only decides which FACE is
 * showing when the panel opens, so the drawer's Passport row lands on the passport and the avatar
 * lands wherever you left it.
 *
 * Always opens on the front for the passport route: arriving on the back of a card you asked to
 * see the front of would be disorienting. */
function openAccountPanel(mode){
  const panel = document.getElementById('accountPanel');
  panel.classList.add('show');
  updateAccountUI();

  const title = document.getElementById('accountHeaderTitle');
  if(title) title.textContent = isLoggedIn() ? 'Bathroom Passport' : 'Account';

  if(isLoggedIn()){
    renderAccountSheet();
    /* Always open on the front. Without this the card keeps whichever face it was left on, so
     * reopening the passport could land you on the stats reverse with no explanation. No height
     * call any more — the grid sizes both faces on its own. */
    flipCardTo(false);
  } else {
    // Reopening always lands on Sign Up: anyone with an account is normally already signed in,
    // so the person looking at this panel is usually here for the first time.
    setAuthMode('signup');
  }
}

/* ssMoveControls is gone. It reparented the map and preference controls out of the drawer on
 * startup; with the drawer deleted there was nothing to move, and the function would have
 * quietly succeeded at moving nothing. Those controls are authored directly into the sheet's
 * markup now — same ids, same classes, same handlers.
 */

/* ssSetTab is gone with the tabs. The sheet is one scroll now — see the ordering note in
 * index.html — so there is no pane to show or hide and no selected state to track. */

function ssSyncIdentity(){
  const name = document.getElementById('ssName'), sub = document.getElementById('ssSub');
  const av = document.getElementById('ssAvatar'), stamp = document.getElementById('ssStamp');
  const signOut = document.getElementById('ssSignOut'), signIn = document.getElementById('ssSignIn');
  const gate = document.getElementById('prefsGateNote');   // the drawer's own note, moved in
  const inA = isLoggedIn();
  const who = inA ? displayNameFor() : '';
  if(name) name.textContent = inA ? who : 'Not signed in';
  if(sub)  sub.textContent  = inA ? 'Synced across your devices' : 'Sign in to sync across devices';
  if(av)   av.textContent   = inA ? (who.trim()[0] || '·').toUpperCase() : '·';
  if(signOut) signOut.hidden = !inA;
  if(signIn)  signIn.hidden  = inA;
  /* Signed out, the account tab offered a passport with no stamps, a recovery email for no
   * account, and a password change for a password that does not exist — three rows that can
   * only disappoint, above the one row that actually helps. They and their headings now travel
   * with the session. */
  /* ssPlateYou / ssPlateSecurity / ssPlateSession are gone from the markup: the first because
   * the identity row absorbed the passport, the other two because they were empty headings
   * padding a gap above About. Left in this list they would be harmless (the loop guards on
   * null) but misleading — a reader would look for sections that no longer exist. */
  ['ssPlateRecovery','acctEmailRow','acctEmailNote',
   'acctPasswordRow','acctPasswordNote'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.hidden = !inA;
  });
  /* The real gate note travelled in with the switches it explains, so there is one message, not
   * a copy in each place that could drift from the other. */
  if(gate) gate.hidden = inA;
  /* FIND. RATE. SHARE. IMPROVE. — the tagline labelling the numbers that were already in this
   * footer. Rendered here rather than authored in markup because three of the four are the
   * person's own totals and change as they use the app. */
  const creed = document.getElementById('ssCreed');
  if(creed){
    const n = (x) => (x == null ? '—' : Number(x).toLocaleString());
    const rows = [
      /* Same correction as the footer: what the app HOLDS, not what this session downloaded. */
      [n(seedLocations.length + pendingPublicCount()), 'Find', 'on the map'],
      [n(ssCreedStats.rated),   'Rate',    'you rated'],
      [n(ssCreedStats.tips),    'Share',   'tips written'],
      [n(ssCreedStats.fixes),   'Improve', 'reports made'],
    ];
    creed.innerHTML = rows.map(([v, w, d]) =>
      `<div class="ss-creed-item"><b>${v}</b><span>${w}</span><em>${d}</em></div>`).join('');
  }
  const v = document.getElementById('ssVersion');
  /* Name only. The version and date live in the .d-version span beside this one — which the
   * build-consistency audit reads — and the location count is already the headline of the block
   * directly above. Setting all three here printed the version twice and the count twice in a
   * single line. */
  if(v) v.textContent = 'Bathroom Report';
  /* Only shown once the passport has actually been rendered and reported a count — the sheet
   * can be opened before that has ever happened, and an invented zero would read as "you have
   * earned nothing" rather than "not counted yet". */
  /* The stamp count now rides on the passport row as its value, rather than as a chip in a
   * header that no longer exists. Same element id, same guard: hidden until the passport has
   * actually rendered and reported a count, because an invented zero reads as "you have earned
   * nothing" rather than "not counted yet". */
  if(stamp){
    if(inA && ssStampCount != null){ stamp.hidden = false; stamp.textContent = ssStampCount + ' stamps'; }
    else stamp.hidden = true;
  }
}

/* Open and close are asymmetric on purpose.
 *
 * Opening: unhide FIRST, then add .ss-in on the next frame. Both in one go and the browser
 * computes only the final state — the element goes from display:none straight to its resting
 * transform with nothing to interpolate, and the sheet blinks into place exactly as if there
 * were no animation at all. The frame gap is what gives the transition a starting point.
 *
 * Closing: drop .ss-in, then hide only once the transition has finished, so the panel is seen
 * travelling back to the edge it came from instead of vanishing mid-air. */
/* ---- settings sheet state ----
 * Declared here, together, because all three were previously introduced inside a block that was
 * later deleted, leaving them as implicit globals. Two of the three still appeared to work;
 * ssCloseToken did not, and failed in a way nothing would have reported: ++undefined is NaN, and
 * NaN never equals itself, so the close guard `token !== ssCloseToken` was true on every call and
 * the teardown returned early every single time. The sheet would have opened and never closed.
 */
let ssCloseToken = 0;                                  // invalidates in-flight teardowns
let ssStampCount = null;                               // set by renderBathroomPassport
let ssCreedStats = { rated:null, tips:null, fixes:null };  // ditto; null so an unrendered menu shows —

/* aria-modal="true" is a PROMISE that focus cannot leave the sheet. Declaring it without
 * trapping is worse than not declaring it: a screen reader tells the user the rest of the page
 * is inert, and then Tab walks them straight out onto a map they were told was unavailable.
 * The drawer this replaced made no such claim, so this is a defect introduced with the dialog
 * role, not a pre-existing one. */
const SS_FOCUSABLE = 'a[href],button:not([disabled]),select,input,[tabindex]:not([tabindex="-1"])';
let ssLastFocus = null;

function ssTrapTab(e){
  if(e.key !== 'Tab') return;
  const sheet = document.getElementById('settingsSheet');
  if(!sheet || sheet.hidden) return;
  const items = [...sheet.querySelectorAll(SS_FOCUSABLE)]
    .filter(el => !el.hasAttribute('hidden') && el.offsetParent !== null);
  if(!items.length) return;
  const first = items[0], last = items[items.length - 1];
  // Wrap at both ends, and catch the case where focus has escaped already.
  if(e.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))){
    e.preventDefault(); last.focus();
  } else if(!e.shiftKey && document.activeElement === last){
    e.preventDefault(); first.focus();
  }
}

function openSettingsSheet(){
  const sheet = document.getElementById('settingsSheet');
  if(!sheet) return;
  /* Fill the email row.
   *
   * renderAccountRecovery was only ever called by renderAccountSheet, which runs when the
   * PASSPORT panel opens. The email row moved into settings and its filler did not follow, so
   * the row sat at its "Loading…" placeholder forever — a spinner for a request nobody had
   * made. Safe to call on every open: it is idempotent, it bails when the elements are absent,
   * and it does nothing at all when signed out. */
  if(isLoggedIn() && typeof renderAccountRecovery === 'function') renderAccountRecovery();
  ssCloseToken++;                            // invalidate any in-flight teardown
  ssLastFocus = document.activeElement;      // so Escape returns you where you were
  document.addEventListener('keydown', ssTrapTab, true);
  /* The map behind keeps scrolling under the sheet on iOS without this, which reads as the
   * page coming apart underneath your thumb. */
  document.body.style.overflow = 'hidden';
  ssSyncIdentity();
  ssSyncValues();
  sheet.hidden = false;
  sheet.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => sheet.classList.add('ss-in'));
  document.getElementById('ssClose')?.focus({ preventScroll:true });
}
/* `after` runs once the panel is actually hidden, not when the close is requested.
 *
 * The passport is a bottom sheet at z-index 1500 covering only the lower part of the screen,
 * and this panel takes 300ms to leave. Opening one immediately after asking the other to close
 * put both on screen at once, with settings visible above and behind the passport — two panels
 * arguing about which one you are looking at. */
function closeSettingsSheet(after){
  const sheet = document.getElementById('settingsSheet');
  if(!sheet || sheet.hidden){ if(after) after(); return; }
  const panel = sheet.querySelector('.ss-panel');
  sheet.classList.remove('ss-in');
  sheet.setAttribute('aria-hidden', 'true');
  panel.style.transform = '';          // clear any drag offset so the class drives the exit
  /* Generation counter, because the teardown is asynchronous and the user is not.
   *
   * Close, then reopen inside 400ms, and the previous close's backstop timer still fires and
   * hides the sheet the user just reopened — it looks like the app slamming the panel shut for
   * no reason, and it is reachable with an ordinary double-tap. Every open bumps the token, and
   * a teardown only acts if it still owns the current one. */
  /* Unwind the stack first. Closing the sheet from a sub-screen would otherwise leave that
   * screen flagged open, so the next visit would land on it instead of the root. */
  while(ssStack.length){
    const id = ssStack.pop();
    const el = document.getElementById(id);
    if(el){ el.classList.remove('in'); el.hidden = true; }
  }
  document.removeEventListener('keydown', ssTrapTab, true);
  document.body.style.overflow = '';
  /* Focus goes back to whatever opened the sheet — almost always the hamburger. Leaving it on a
   * button that just slid off screen strands keyboard and screen-reader users at the top of the
   * document with no idea where they are. */
  if(ssLastFocus && document.contains(ssLastFocus)) ssLastFocus.focus({ preventScroll:true });
  ssLastFocus = null;
  const token = ++ssCloseToken;
  let ran = false;
  const done = () => {
    if(token !== ssCloseToken) return;      // superseded by a reopen
    if(ran) return;                          // transitionend AND the backstop both fire
    ran = true;
    sheet.hidden = true;
    panel.removeEventListener('transitionend', done);
    if(after) after();
  };
  panel.addEventListener('transitionend', done);
  /* A backstop, because transitionend never fires if the transition was suppressed — reduced
   * motion, or a browser that skips animations on a hidden tab. Without it the sheet would
   * stay open forever in exactly the setups least able to report it. */
  setTimeout(done, 400);
}

/* Swipe LEFT to dismiss, matching the edge the panel arrives from. This was a downward drag on
 * the grabber when the panel was a bottom sheet; leaving it vertical would mean the panel came
 * from one edge and was pushed back toward another.
 *
 * The whole panel drags rather than a handle, because a left-edge panel has no grabber to aim
 * at — and a horizontal drag cannot be confused with the vertical scroll of the list inside it,
 * which is what made a handle necessary before. */
(function(){
  const sheet = document.getElementById('settingsSheet');
  if(!sheet) return;
  const panel = sheet.querySelector('.ss-panel');
  if(!panel) return;
  let startX = null, startY = null, dx = 0, axis = null;

  const start = e => {
    const t = e.touches ? e.touches[0] : e;
    startX = t.clientX; startY = t.clientY; dx = 0; axis = null;
  };
  const move = e => {
    if(startX == null) return;
    const t = e.touches ? e.touches[0] : e;
    const mx = t.clientX - startX, my = t.clientY - startY;
    /* Decide the axis once, on the first meaningful movement, and stick to it. Without this a
     * mostly-vertical scroll with a little sideways drift would start dragging the panel and
     * fight the list underneath. */
    if(axis === null){
      if(Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if(axis === 'x') sheet.classList.add('ss-drag');
    }
    if(axis !== 'x') return;                 // vertical: leave the scroll alone
    dx = Math.min(0, mx);                    // leftward only; it has nowhere to go right
    panel.style.transform = `translateX(${dx}px)`;
    if(e.cancelable) e.preventDefault();
  };
  const end = () => {
    if(startX == null) return;
    const wasX = axis === 'x';
    sheet.classList.remove('ss-drag');
    startX = null; startY = null; axis = null;
    if(!wasX) return;
    /* Past a quarter of the panel's width it closes; short of that it springs back. Scaled
     * rather than a fixed pixel count so it feels the same on a small phone and a tablet. */
    if(Math.abs(dx) > Math.min(140, panel.offsetWidth * 0.25)){ closeSettingsSheet(); }
    else { panel.style.transform = ''; }
  };

  panel.addEventListener('touchstart', start, {passive:true});
  panel.addEventListener('touchmove', move, {passive:false});
  panel.addEventListener('touchend', end);
  panel.addEventListener('touchcancel', end);
})();

/* The drawer closes itself: 'openSettings' is in the NAVIGATES allowlist in index.html, which is
 * where that decision belongs — a control that takes you somewhere opts IN to closing. */
/* Runs after the document has parsed, so both the source controls and the sheet's slots exist.
 * Deferred by a tick rather than called inline for the same reason the drawer count is: this
 * file is one long script and the elements below it are not there yet when this line runs. */
/* #openSettings was a drawer row and went with the drawer. The hamburger opens the sheet now,
 * wired in the inline block in index.html. */
/* ============================================================================
 *  Settings navigation stack
 * ============================================================================
 * Push/pop with a real history entry per screen, so the phone's own back gesture and the
 * browser back button both pop — a settings stack that ignores them is the fastest way to
 * strand someone on a sub-screen with no way out but a force-quit.
 *
 * The two choice screens drive the ORIGINAL <select> elements rather than replacing them: a
 * pick sets .value and dispatches a real 'change' event, so every handler already bound in this
 * file runs untouched, including the account sync. There is no second code path to keep in step.
 */
let ssStack = [];

function ssShowScreen(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('in'));   // a frame, or there is nothing to animate from
  ssStack.push(id);
  ssSyncScreen(id);
  history.pushState({ ss:id }, '');
  const back = el.querySelector('[data-ss-back]');
  if(back) back.focus({ preventScroll:true });
}

function ssPopScreen(){
  const id = ssStack.pop();
  if(!id) return;
  const el = document.getElementById(id);
  if(!el) return;
  el.classList.remove('in');
  const done = () => { if(!el.classList.contains('in')) el.hidden = true; };
  el.addEventListener('transitionend', done, { once:true });
  setTimeout(done, 400);          // transitions can be suppressed; never leave it half-open
}

/* ---------- Location card screen ----------
 * Order matters here in a way it does not on the other screens, so this is a LIST with a drag
 * handle rather than a set of chips. Pointer events, not HTML5 drag-and-drop: dragstart never
 * fires on touch, so the native API would work on a laptop and be dead on a phone.
 *
 * The list does not re-render mid-drag — rows are translated and the array commits once on
 * release. Re-rendering on every move rebuilds the node under the finger and drops the pointer
 * capture, which is how drag lists come apart on mobile.
 */
const SS_GRIP = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
let ssLayoutPicks = null;      // working copy while the screen is open

/* A representative location so the preview shows real shapes rather than every cell blank.
 * Prefers one the person can actually see — a strip previewed from a location with no data at
 * all would teach nothing about the choice being made. */
function ssPreviewLoc(){
  const best = seedLocations.find(l => ratingsCache[l.id] && ratingsCache[l.id].bathroomCount)
    || seedLocations[0];
  return best || null;
}

function ssRenderLayout(){
  const prev = document.getElementById('ssLayoutPreview');
  const list = document.getElementById('ssLayoutPicked');
  const pool = document.getElementById('ssLayoutPool');
  if(!prev || !list || !pool) return;
  if(!ssLayoutPicks) ssLayoutPicks = stripPicks().slice();

  const loc = ssPreviewLoc();
  prev.innerHTML = loc
    ? stripHtml(loc, ratingsCache[loc.id])
    : '<div class="answer-strip is-empty"><span>No locations loaded yet</span></div>';

  list.innerHTML = ssLayoutPicks.map((k, i) =>
    `<div class="ss-row ss-drag-row" data-ss-row="${k}">
       <span class="ss-ord">${i + 1}</span>
       <span class="ss-main"><span class="ss-lab">${escapeHtml(STRIP_FACTS[k].label)}</span></span>
       <button class="ss-grip" data-ss-grip="${k}" aria-label="Reorder ${escapeHtml(STRIP_FACTS[k].label)}, position ${i + 1} of ${ssLayoutPicks.length}. Use arrow keys to move.">${SS_GRIP}</button>
       <button class="ss-rm" data-ss-rm="${k}" aria-label="Remove ${escapeHtml(STRIP_FACTS[k].label)}">&minus;</button>
     </div>`).join('')
    || '<div class="ss-row"><span class="ss-main"><span class="ss-lab ss-muted">Nothing selected yet</span></span></div>';

  pool.innerHTML = Object.keys(STRIP_FACTS).filter(k => ssLayoutPicks.indexOf(k) < 0).map(k =>
    `<div class="ss-row">
       <span class="ss-main"><span class="ss-lab">${escapeHtml(STRIP_FACTS[k].label)}</span></span>
       <button class="ss-add" data-ss-add="${k}" aria-label="Add ${escapeHtml(STRIP_FACTS[k].label)}">+</button>
     </div>`).join('')
    || '<div class="ss-row"><span class="ss-main"><span class="ss-lab ss-muted">All of them are showing</span></span></div>';
}

/* Committed on every change rather than on leaving the screen: there is no Save button, so
 * "back" must not be the thing that persists — someone who swipes away or closes the app
 * mid-edit should keep what they chose, not lose it. */
function ssCommitLayout(){
  ssLayoutPicks = saveStripPicks(ssLayoutPicks);
  ssRenderLayout();
  ssSyncValues();
  refreshOpenPopupStrip();
}

/* ---------- Chains within a group ----------
 * Reuses chainKeyRowHtml, so the rows here are the same element, same data-chain attribute and
 * same handler the map key uses. A parallel implementation would be a second place for the
 * on/off state to be read and written, and those two drift. */
let ssChainsGroup = null;

function ssRenderChains(){
  const list = document.getElementById('ssChainsList');
  const title = document.getElementById('ssChainsTitle');
  const hint = document.getElementById('ssChainsHint');
  if(!list || !ssChainsGroup) return;
  const g = CK_GROUPS.find(x => x.id === ssChainsGroup);
  const keys = Object.keys(CHAIN_REGISTRY)
    .filter(k => chainHasData(k) && chainBucket(k) === ssChainsGroup)
    .sort((a, b) => CHAIN_REGISTRY[a].name.localeCompare(CHAIN_REGISTRY[b].name));
  if(title) title.textContent = g ? g.label : 'Chains';
  const on = keys.filter(k => !disabledChains.has(k)).length;
  if(hint) hint.textContent = keys.length
    ? `${on} of ${keys.length} showing. Turning the group off on the previous screen turns off all of them.`
    : 'Nothing in this group yet.';
  const readOnly = !isLoggedIn();
  /* groupKeysByName so chains sharing a display name — the NYC and Boston copies of Dunkin,
   * and the four public-restroom sets — appear once, exactly as they do in the map key. */
  list.innerHTML = keys.length
    ? [...groupKeysByName(keys).values()].map(ks => chainKeyRowHtml(ks, readOnly)).join('')
    : '<div class="ss-row"><span class="ss-main"><span class="ss-lab ss-muted">Nothing here</span></span></div>';
}

/* Every sub-screen reflects live state on entry, because it can be opened at any time and the
 * value may have changed since it was last seen — from another device, or from the map. */
function ssSyncScreen(id){
  if(id === 'ssScreenAround' || id === 'ssScreenNav'){
    const selId = id === 'ssScreenAround' ? 'travelModeSelect' : 'navAppSelect';
    const sel = document.getElementById(selId);
    if(!sel) return;
    document.querySelectorAll('[data-ss-set="' + selId + '"]').forEach(btn => {
      btn.classList.toggle('sel', btn.dataset.ssVal === sel.value);
    });
  }
  if(id === 'ssScreenPlaces' && typeof renderChainKey === 'function') renderChainKey();
  if(id === 'ssScreenLayout'){ ssLayoutPicks = stripPicks().slice(); ssRenderLayout(); }
  if(id === 'ssScreenChains') ssRenderChains();
}

/* The root rows carry the current value, so you can read every setting without opening one. */
function ssSyncValues(){
  const t = document.getElementById('travelModeSelect');
  const tv = document.getElementById('ssAroundVal');
  if(t && tv) tv.textContent = t.options[t.selectedIndex] ? t.options[t.selectedIndex].text : '';
  const n = document.getElementById('navAppSelect');
  const nv = document.getElementById('ssNavVal');
  if(n && nv) nv.textContent = n.options[n.selectedIndex] ? n.options[n.selectedIndex].text : '';
  const lv = document.getElementById('ssLayoutVal');
  if(lv) lv.textContent = stripPicks().map(k => STRIP_FACTS[k] ? STRIP_FACTS[k].label : '').filter(Boolean).join(' · ');
  const pv = document.getElementById('ssPlacesVal');
  if(pv){
    /* Every chain that has data, everywhere — not the four types, and not what happens to be in
     * the viewport. This row answers "how much of the map am I showing", and the honest unit is
     * the thing you can actually switch off: a chain. Turning a whole type off moves this by
     * however many chains it held, which is the point.
     *
     * The bug was never the unit. It was that nothing recomputed this after a toggle, so the
     * number stayed at whatever it read when the panel opened. */
    const all = Object.keys(CHAIN_REGISTRY).filter(chainHasData);
    const on = all.filter(k => !disabledChains.has(k));
    pv.textContent = on.length === all.length ? 'All ' + all.length : on.length + ' of ' + all.length;
  }
}

document.addEventListener('click', (e) => {
  const chains = e.target.closest('[data-ss-chains]');
  if(chains){ ssChainsGroup = chains.dataset.ssChains; ssShowScreen('ssScreenChains'); return; }
  const go = e.target.closest('[data-ss-go]');
  if(go){ ssShowScreen(go.dataset.ssGo); return; }
  if(e.target.closest('[data-ss-back]')){ history.back(); return; }
  const set = e.target.closest('[data-ss-set]');
  if(set){
    const sel = document.getElementById(set.dataset.ssSet);
    if(sel && sel.value !== set.dataset.ssVal){
      sel.value = set.dataset.ssVal;
      // A real event, not a direct call — this is what keeps the existing handler the only one.
      sel.dispatchEvent(new Event('change', { bubbles:true }));
    }
    ssSyncScreen(ssStack[ssStack.length - 1]);
    ssSyncValues();
    /* Chosen means done. Making someone then press back is a second step for a decision they
     * have already made — but leave the tick visible for a beat so the choice registers. */
    setTimeout(() => { if(ssStack.length) history.back(); }, 180);
  }
});

/* Add / remove / drag for the Location card screen. Delegated from the screen node so the rows
 * can be re-rendered freely without rebinding anything. */
(function(){
  const list = () => document.getElementById('ssLayoutPicked');
  let rows = [], el = null, from = 0, to = 0, startY = 0, rowH = 0;

  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-ss-add]');
    const rm  = e.target.closest('[data-ss-rm]');
    const note = document.getElementById('ssLayoutNote');
    if(add){
      if(!ssLayoutPicks) ssLayoutPicks = stripPicks().slice();
      if(ssLayoutPicks.length === 3){
        const gone = ssLayoutPicks.pop();          // the bottom one, which is what the hint promises
        if(note) note.textContent = 'Replaced ' + STRIP_FACTS[gone].label + ' — three is the limit.';
      } else if(note){ note.textContent = 'Tap to add. Adding a fourth replaces the one at the bottom.'; }
      ssLayoutPicks.push(add.dataset.ssAdd);
      ssCommitLayout();
      return;
    }
    if(rm){
      if(!ssLayoutPicks) ssLayoutPicks = stripPicks().slice();
      ssLayoutPicks = ssLayoutPicks.filter(k => k !== rm.dataset.ssRm);
      ssCommitLayout();
    }
  });

  document.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-ss-grip]');
    if(!g || !list()) return;
    e.preventDefault();                              // or the screen scrolls with the finger
    rows = [...list().querySelectorAll('.ss-drag-row')];
    el = rows.find(r => r.dataset.ssRow === g.dataset.ssGrip);
    if(!el) return;
    from = to = rows.indexOf(el);
    rowH = el.offsetHeight; startY = e.clientY;
    list().classList.add('is-dragging');
    el.classList.add('is-drag');
    if(g.setPointerCapture) g.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => {
    if(!el) return;
    e.preventDefault();
    const dy = e.clientY - startY;
    el.style.transform = 'translateY(' + dy + 'px)';
    /* Rounding at the midpoint swaps as the boundary is crossed, rather than waiting until the
     * neighbouring row is fully cleared. */
    const next = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / rowH)));
    if(next !== to){
      to = next;
      rows.forEach((r, i) => {
        if(r === el) return;
        let shift = 0;
        if(from < to && i > from && i <= to) shift = -rowH;
        else if(from > to && i >= to && i < from) shift = rowH;
        r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
      });
    }
  });
  const endDrag = () => {
    if(!el) return;
    if(list()) list().classList.remove('is-dragging');
    rows.forEach(r => { r.style.transform = ''; r.classList.remove('is-drag'); });
    if(to !== from && ssLayoutPicks){
      const [moved] = ssLayoutPicks.splice(from, 1);
      ssLayoutPicks.splice(to, 0, moved);
    }
    el = null;
    ssCommitLayout();                                // commit once, at the end
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  /* Keyboard equivalent. A handle you can focus but not use is worse than no handle, and this
   * is the one list in settings where order is the whole point. */
  document.addEventListener('keydown', (e) => {
    const g = e.target.closest && e.target.closest('[data-ss-grip]');
    if(!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    if(!ssLayoutPicks) ssLayoutPicks = stripPicks().slice();
    const i = ssLayoutPicks.indexOf(g.dataset.ssGrip);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if(i < 0 || j < 0 || j >= ssLayoutPicks.length) return;
    const t = ssLayoutPicks[i]; ssLayoutPicks[i] = ssLayoutPicks[j]; ssLayoutPicks[j] = t;
    ssCommitLayout();
    // Focus follows the row, or the next press moves whatever landed here instead.
    const moved = document.querySelector('[data-ss-grip="' + g.dataset.ssGrip + '"]');
    if(moved) moved.focus();
  });
})();

/* The chain rows are the map key's own rows, so they get the map key's own handler. After it
 * runs, both this screen and the Places screen behind it are re-rendered — the group switch and
 * the "N of M showing" line are derived from the same state that just changed. */
document.getElementById('ssChainsList')?.addEventListener('click', (e) => {
  if(!e.target.closest('.ck-row')) return;
  onChainKeyRowTap(e);
  ssRenderChains();
  if(typeof renderChainKey === 'function') renderChainKey();
  ssSyncValues();
});

window.addEventListener('popstate', () => {
  if(ssStack.length) ssPopScreen();
});

document.getElementById('ssClose')?.addEventListener('click', closeSettingsSheet);
document.getElementById('ssScrim')?.addEventListener('click', closeSettingsSheet);
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && !document.getElementById('settingsSheet')?.hidden) closeSettingsSheet();
});
/* The identity block and the passport row were merged: both opened the passport, so there was
 * no reason for two. The single row is wired below. */
document.getElementById('ssPassportRow')?.addEventListener('click', () => {
  closeSettingsSheet(() => openAccountPanel('passport'));
});
/* Rows that take you somewhere close the sheet behind them — the same rule the drawer's
 * NAVIGATES allowlist encoded. Switches and disclosures deliberately do not, so toggling a
 * filter or opening All places leaves you where you are. */
document.getElementById('infoBtn')?.addEventListener('click', () => closeSettingsSheet());
document.getElementById('ssSignIn')?.addEventListener('click', () => {
  closeSettingsSheet(() => openAccountPanel('account'));
});
/* Delegates to the existing logOutBtn rather than calling logOutAccount() directly: that handler
 * also resets the leaderboard cache, refreshes the account UI and reloads ratings. A second
 * sign-out path that did only half of it would look identical and quietly leave stale state. */
document.getElementById('ssSignOut')?.addEventListener('click', () => {
  closeSettingsSheet();
  document.getElementById('logOutBtn')?.click();
});

/* The drawer's Passport button is gone; the sheet's row carries the same job and is wired
 * above, alongside the other rows that navigate. */

document.getElementById('accountToggle').addEventListener('click', () => openAccountPanel('account'));

document.getElementById('accountClose').addEventListener('click', () => {
  document.getElementById('accountPanel').classList.remove('show');
  suppressNextLocateClick = true;
  setTimeout(() => { suppressNextLocateClick = false; }, 400);
});

/* Which of the two jobs the logged-out panel is doing.
 *
 * Both action buttons stay in the DOM under their original ids, with their original handlers —
 * only visibility moves. Nothing about how a signup or a login actually runs is touched here,
 * which is the whole reason it is done this way.
 */
function setAuthMode(mode){
  const signup = mode !== 'login';
  const segUp = document.getElementById('authModeSignUp');
  const segIn = document.getElementById('authModeLogIn');
  if(!segUp || !segIn) return;

  segUp.setAttribute('aria-pressed', String(signup));
  segIn.setAttribute('aria-pressed', String(!signup));

  document.getElementById('authEmailBlock').style.display = signup ? '' : 'none';
  document.getElementById('authSignUpBtn').style.display  = signup ? '' : 'none';
  document.getElementById('authLogInBtn').style.display   = signup ? 'none' : '';
  // Only meaningful against an existing account, so it belongs to the log-in side.
  document.getElementById('authForgotBtn').style.display  = signup ? 'none' : '';

  /* Password managers have to be told which of the two this is. With one autocomplete value
   * serving both, a manager offers to overwrite a saved credential on a signup and to create a
   * second one on a login. */
  const pw = document.getElementById('authPassword');
  if(pw){
    pw.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    pw.placeholder = signup ? 'at least 6 characters' : 'your password';
  }

  // A failed login must not leave its error sitting over the signup form, where it reads as a
  // complaint about something the person has not done yet.
  const note = document.getElementById('authNote');
  if(note) note.textContent = '';
}
document.getElementById('authModeSignUp').addEventListener('click', () => setAuthMode('signup'));
document.getElementById('authModeLogIn').addEventListener('click', () => setAuthMode('login'));
setAuthMode('signup');

document.getElementById('authForgotBtn').addEventListener('click', async () => {
  const username = document.getElementById('authUsername').value.trim();
  const note = document.getElementById('authNote');
  const btn = document.getElementById('authForgotBtn');
  if(!username){
    note.style.color = '#e57373';
    note.textContent = 'Type your username above first.';
    return;
  }
  btn.disabled = true;
  note.style.color = '#999';
  note.textContent = 'Checking…';
  await requestPasswordReset(username);
  /* Deliberately says "if". The server cannot distinguish outcomes here without revealing
   * whether that username has an account behind it — usernames are public on ratings and the
   * leaderboard, so that would be a real leak. Wording matches what the server actually knows. */
  note.style.color = '#4caf50';
  note.textContent = 'If that account has a confirmed email, a reset link is on its way.';
  btn.disabled = false;
});

document.getElementById('authSignUpBtn').addEventListener('click', async () => {
  const username = document.getElementById('authUsername').value;
  const password = document.getElementById('authPassword').value;
  const note = document.getElementById('authNote');
  const btn = document.getElementById('authSignUpBtn');
  btn.disabled = true;
  note.style.color = '#999';
  note.textContent = 'Creating your account...';
  const email = document.getElementById('authEmail').value;
  const result = await signUpAccount(username, password, email);
  if(result.ok){
    /* The account exists either way — the recovery email is sent after it is created and is
     * deliberately non-fatal. Saying "created" and nothing else would leave somebody quietly
     * unrecoverable behind a success message, so a failed send is named and points somewhere. */
    note.style.color = result.emailSent ? '#4caf50' : '#f59e0b';
    note.textContent = result.emailSent
      ? "Account created — check your email to confirm it."
      : "Account created, but " + (result.emailReason || "the confirmation email didn't send.")
        + " You can add it from Account settings.";
    updateAccountUI();
    loadAllRatings();
    // Close the panel so the map is usable immediately — but ONLY on a clean run. If the
    // confirmation mail failed there is something to read and act on, and closing over it would
    // leave the account quietly unrecoverable behind a success message.
    // Guarded: if the user opened Passport in the meantime, leave their panel alone.
    if(result.emailSent) setTimeout(() => {
      document.getElementById('accountPanel')?.classList.remove('show');
      note.textContent = '';
    }, 1600);
  } else {
    note.style.color = '#e57373';
    note.textContent = result.reason;
  }
  btn.disabled = false;
});

document.getElementById('authLogInBtn').addEventListener('click', async () => {
  const username = document.getElementById('authUsername').value;
  const password = document.getElementById('authPassword').value;
  const note = document.getElementById('authNote');
  const btn = document.getElementById('authLogInBtn');
  btn.disabled = true;
  note.style.color = '#999';
  note.textContent = 'Logging in...';
  const result = await logInAccount(username, password);
  if(result.ok){
    note.style.color = '#4caf50';
    note.textContent = 'Logged in!';
    _leaderboardLoaded = false;   // re-fetch so the board reflects the logged-in user
    updateAccountUI();
    loadAllRatings();
    // Success needs no further reading — close the panel so the map is usable immediately.
    // Guarded: if the user opened Passport in the meantime, leave their panel alone.
    setTimeout(() => {
      document.getElementById('accountPanel')?.classList.remove('show');
      note.textContent = '';
    }, 900);
  } else {
    note.style.color = '#e57373';
    note.textContent = result.reason;
  }
  btn.disabled = false;
});

/* ---------- Account sheet ----------
 * Everything here reads from state the app already holds — the ratings loaded at sign-in, the
 * auth user object, one document for the recovery address. Opening the sheet costs a single
 * Firestore read, and only when signed in. */

/* renderAccountIdentity and renderAccountStats are gone with the elements they filled.
 *
 * The avatar/name/member-since block and the three-number stats strip both duplicated the front
 * of the card, which now carries the holder name, the issue date, the stamp count and the rating
 * count in larger type. acctInitials went with the avatar. Anything still wanting those numbers
 * reads them from checkAndUnlockAchievements, which is what fills the data page. */

/* Recovery address: value plus a state that is never colour alone — the chip's word says it too.
 * Three real states, and "not set" is the one that matters, because that account cannot be
 * recovered at all. */
async function renderAccountRecovery(){
  const valEl = document.getElementById('acctEmailValue');
  const chipEl = document.getElementById('acctEmailChip');
  if(!valEl || !chipEl) return;
  const st = await recoveryStatus();
  chipEl.className = 'acct-chip';
  if(!st){
    valEl.textContent = "Couldn't load";
    chipEl.classList.add('none'); chipEl.textContent = 'Unknown';
  } else if(!st.email){
    valEl.textContent = 'Add one so you can reset your password';
    chipEl.classList.add('none'); chipEl.textContent = 'Not set';
  } else if(st.verified){
    valEl.textContent = st.email;
    chipEl.classList.add('ok'); chipEl.textContent = '✓ Confirmed';
  } else {
    valEl.textContent = st.email;
    chipEl.classList.add('wait'); chipEl.textContent = 'Check inbox';
  }
}

function renderAccountSheet(){
  if(!isLoggedIn()) return;
  /* checkAndUnlockAchievements computes the stats AND calls renderBathroomPassport, which is
   * what fills the data page on the front of the card. One call covers the whole front face. */
  checkAndUnlockAchievements();
  renderAccountRecovery();   // async; the chip shows its loading state meanwhile
}

/* The passport flip.
 *
 * What the back holds has changed: it used to be Email / Change password / Theme, which meant
 * real settings were hidden behind a gesture most people never perform. Those moved to the
 * settings sheet, and the reverse now carries the card's own record — rated, states, towns,
 * chains, streak, distance. Nothing on the back is a control, so the turn hides nothing anyone
 * needs to find.
 *
 * No height measuring any more. The old version wrote a pixel height onto the scene on every
 * open and every turn, which is why removing that code once made the card collapse to a sliver.
 * Both faces now share a CSS grid cell, so the scene is as tall as the taller face for free.
 *
 * The hidden face is still made INERT: backface-visibility hides it visually but leaves it in
 * the tab order and the accessibility tree, so a screen reader would read both sides. */
const flipScene = document.getElementById('flipScene');
const flipFront = document.getElementById('flipFront');
const flipBack  = document.getElementById('flipBack');

function flipShowingBack(){ return !!flipScene && flipScene.classList.contains('flipped'); }

function flipSync(){
  if(!flipScene || !flipFront || !flipBack) return;
  const back = flipShowingBack();
  const hidden = back ? flipFront : flipBack;
  const shown  = back ? flipBack : flipFront;
  hidden.setAttribute('inert', ''); hidden.setAttribute('aria-hidden', 'true');
  shown.removeAttribute('inert'); shown.removeAttribute('aria-hidden');
  const toBack = document.getElementById('flipToBack');
  if(toBack) toBack.setAttribute('aria-expanded', String(back));
  const title = document.getElementById('accountHeaderTitle');
  if(title && isLoggedIn()) title.textContent = back ? 'Your record' : 'Bathroom Passport';
}

function flipCardTo(back){
  if(!flipScene) return;
  flipScene.classList.toggle('flipped', back);
  flipSync();
}

function toggleFlip(){
  const next = !flipShowingBack();
  flipCardTo(next);
  // Focus follows the face, or it stays on a button that just turned away.
  const t = document.getElementById(next ? 'flipToFront' : 'flipToBack');
  if(t) t.focus({ preventScroll:true });
}

document.getElementById('flipToBack')?.addEventListener('click', e => { e.stopPropagation(); toggleFlip(); });
document.getElementById('flipToFront')?.addEventListener('click', e => { e.stopPropagation(); toggleFlip(); });
/* Tapping the card turns it too — the bar is the signpost, not the only way in. The back holds
 * no controls now, so there is nothing to exclude from this. */
document.getElementById('flipCard')?.addEventListener('click', () => toggleFlip());
flipSync();

/* Add or change the recovery address. A prompt rather than an inline form: this is a rare,
 * one-line action, and a field that sits in the sheet permanently would be visual weight spent
 * on something most people touch once. */
document.getElementById('acctEmailRow')?.addEventListener('click', async () => {
  const note = document.getElementById('acctEmailNote');
  const st = await recoveryStatus();
  const entered = window.prompt(
    st && st.email ? 'Change your recovery email:' : 'Email address for password resets:',
    (st && st.email) || ''
  );
  if(entered === null) return;                       // cancelled
  const email = entered.trim();
  if(!email) return;
  if(st && st.email === email.toLowerCase() && st.verified){
    note.style.color = 'var(--muted)';
    note.textContent = "That address is already confirmed.";
    return;
  }
  note.style.color = 'var(--muted)';
  note.textContent = 'Sending…';
  const res = await saveRecoveryEmail(email.toLowerCase());
  note.style.color = res.ok ? '#4ad07a' : '#f08a86';
  note.textContent = res.ok ? 'Confirmation sent — check your inbox.' : res.reason;
  if(res.ok) renderAccountRecovery();
});

/* Change password reuses the reset flow rather than asking for a new one in the sheet. The link
 * goes to the confirmed address, which means a stolen phone with an unlocked session still
 * cannot change the password — worth the extra step. */
document.getElementById('acctPasswordRow')?.addEventListener('click', async () => {
  const note = document.getElementById('acctPasswordNote');
  const st = await recoveryStatus();
  if(!st || !st.email || !st.verified){
    note.style.color = '#f0a93a';
    note.textContent = 'Confirm a recovery email first — that is where the link goes.';
    return;
  }
  note.style.color = 'var(--muted)';
  note.textContent = 'Sending…';
  await requestPasswordReset(displayNameFor() || '');
  note.style.color = '#4ad07a';
  note.textContent = 'Link sent to ' + st.email + '.';
});

/* The Light/Dark segmented pair is gone with the flip-back. There is now exactly ONE theme
 * control — the themeToggle switch, moved into the settings sheet — which removes the older
 * problem of two controls for one setting having to keep each other in step. */

document.getElementById('logOutBtn').addEventListener('click', async () => {
  await logOutAccount();
  _leaderboardLoaded = false;   // re-fetch; drops the "you" row
  updateAccountUI();
  loadAllRatings();
  document.getElementById('authNote').textContent = '';
  document.getElementById('authUsername').value = '';
  document.getElementById('authPassword').value = '';
});

document.getElementById('listViewItems').addEventListener('click', (e) => {
  const item = e.target.closest('.list-item');
  if(!item) return;
  e.preventDefault();
  const locId = item.dataset.locid;
  const marker = markers[locId];
  // Delay hiding the panel until after this click event fully finishes — hiding it
  // synchronously here can cause Android Chrome to "ghost click" through to whatever
  // sits underneath at the same screen coordinates (e.g. the Where am I? button).
  setTimeout(() => {
    document.getElementById('listViewPanel').classList.remove('show');
    document.body.classList.remove('list-open');
    suppressNextLocateClick = true;
    setTimeout(() => { suppressNextLocateClick = false; }, 400);
    if(marker) zoomToMarker(marker);
  }, 50);
});

// Bathroom Now — choose the best nearby open option by routed distance (walking or driving, per mode)
function milesBetween(lat1,lng1,lat2,lng2){const toRad=d=>d*Math.PI/180,R=3958.8,dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1),a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function fetchWithTimeout(url,ms=9000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);return fetch(url,{signal:controller.signal}).finally(()=>clearTimeout(timer));}
/* Mode-aware routing. On foot the CAR profile is wrong twice over: the minutes shown are drive
 * minutes, and the route itself obeys one-ways and highway ramps a walker can ignore while
 * missing the footpaths a walker would take — the ranking can genuinely pick the wrong
 * "closest".
 *
 * Two servers because the OSRM demo instance only hosts the car graph — putting /walking/ in
 * its URL still routes by car, silently. FOSSGIS runs true per-profile instances (the same ones
 * openstreetmap.org's own directions use), so foot mode goes there. Road mode stays on the
 * proven demo server rather than moving both, so a FOSSGIS outage cannot take down the common
 * case. The path's /driving/ segment on the foot instance is OSRM URL convention: the INSTANCE
 * fixes the profile and the segment is ignored. */
async function getRoutedOptions(user,candidates){
  const walking = travelMode === 'foot';
  const base = walking
    ? 'https://routing.openstreetmap.de/routed-foot'
    : 'https://router.project-osrm.org';
  const coords=[`${user.lng},${user.lat}`,...candidates.map(x=>`${x.lng},${x.lat}`)].join(';');
  const url=`${base}/table/v1/driving/${coords}?sources=0&annotations=distance,duration`;
  const response=await fetchWithTimeout(url,9000); if(!response.ok) throw new Error('Routing unavailable');
  const data=await response.json();
  return candidates.map((loc,i)=>({loc,distanceMiles:data.distances?.[0]?.[i+1]/1609.344,durationMinutes:data.durations?.[0]?.[i+1]/60})).filter(x=>Number.isFinite(x.distanceMiles));
}
// Compact "3 days ago" style relative time for the Bathroom Now card — shares
// relativeTimeFromNow with the pin popup so both surfaces always agree.
function bathroomNowCard(result,fallback=false){
  const agg=ratingsCache[result.loc.id]||emptyAgg(); const open=isLocationOpenNow(result.loc);
  // Driving distance is trustworthy; the straight-line fallback is not (5 mi as-the-crow can be 40 by road),
  // so in fallback mode we label it plainly and drop the false precision instead of showing it like a road distance.
  let distance;
  if(!Number.isFinite(result.distanceMiles)){
    distance = 'Distance unavailable';
  }else if(fallback){
    distance = `~${result.distanceMiles.toFixed(1)} mi straight-line`;
  }else{
    distance = `${result.distanceMiles.toFixed(1)} mi`;
  }
  const duration=(!fallback && Number.isFinite(result.durationMinutes))?` · ${Math.round(result.durationMinutes)} min`:'';
  // "Last rated" shows only when the aggregate actually carries a timestamp — no field, no line (never fabricated).
  const ratedWhen = agg.bathroomCount>0 ? relativeTimeFromNow(agg.lastRatedAt || agg.lastUpdated) : '';
  const lastRatedNote = ratedWhen ? ` · rated ${ratedWhen}` : '';
  const hoursMissingNote=open===null?'<br><small>No hours listed for this store — tap "View pin" then 🚩 to send them in.</small>':'';
  // If we had to fall back to a spot whose access isn't recorded, say so up front rather than
  // letting someone discover it at the door.
  // (Bathroom Now never offers a confirmed-no location, so only the doubted state needs saying.)
  const accessNote = !accessKnown(result.loc)
    ? '<br><small>❔ We can\'t confirm this one is open to the public.</small>'
    : (restroomUnconfirmed(result.loc)
        ? '<br><small>❔ This store doesn\'t list a public restroom.</small>'
        : '');
  const outsideSelection=!activeChains.has(result.loc.chain || DEFAULT_CHAIN_KEY);
  const chainNote=outsideSelection?`<div class="nearest-alert">Nothing close by in your selected chains, so this ${escapeHtml((CHAIN_REGISTRY[result.loc.chain]||{}).name||'nearby')} location is shown instead.</div>`:'';
  // Filled chain pill so you can see which brand this is at a glance, colored from the registry.
  const chain=CHAIN_REGISTRY[result.loc.chain]||{};
  const chainBadge=chain.name?`<div class="now-chain-badge" style="background:${chain.color};color:${chain.textColor};">${escapeHtml(chain.name)}</div>`:'';
  return `<div class="bathroom-now-card"><button class="bathroom-now-close" id="bathroom-now-close" title="Close">✕</button><div class="now-title">🚽 ${fallback?'Closest location':(travelMode==='foot'?'Closest bathroom by walking distance':'Closest bathroom by driving distance')}</div>${chainNote}${chainBadge}<b>${escapeHtml(result.loc.n)}</b><br>${distance}${duration}<br>${open===true?'🟢 Open now':open===false?'🔴 Closed now':'⚪ Hours unavailable'}<br>🚻 ${avgStr(agg.bathroomSum,agg.bathroomCount)}★ · ${agg.bathroomCount} rating${agg.bathroomCount===1?'':'s'}${lastRatedNote}${hoursMissingNote}${accessNote}<div class="now-actions"><button class="btn btn-primary" id="bathroom-now-directions">🧭 Get Directions</button><button class="btn btn-secondary" id="bathroom-now-view">Details</button></div></div>`;
}
// For Bathroom Now: drop any of the top-4 nearest candidates that are in the HARD out-of-order
// phase, in a SINGLE batched query (Firestore `in` takes up to 10 ids, so 4 = one read cost).
// Candidates past the top 4 are left untouched. Fails open — on any error, returns the list as-is.
async function filterOutHardOoo(candidates){
  try{
    const topN = candidates.slice(0, 4);
    const ids = topN.map(l => l.id);
    if(!ids.length) return candidates;
    const {db, collection, query, where, getDocs} = await fb();
    const snap = await getDocs(query(collection(db, 'outOfOrder'), where('locId', 'in', ids)));
    const byLoc = {};
    snap.forEach(d => { const r = d.data(); (byLoc[r.locId] = byLoc[r.locId] || []).push(r); });
    const hardSet = new Set();
    for(const id of ids){
      // Same authority rule as the popup — see resolveOooReports. This used to be a second,
      // simpler implementation, so a single account could still suppress reports here even after
      // the popup was fixed.
      const live = resolveOooReports(byLoc[id] || []);
      if(oooStatus(live).phase === 'hard') hardSet.add(id);
    }
    if(!hardSet.size) return candidates;
    const kept = candidates.filter(l => !hardSet.has(l.id));
    return kept.length ? kept : candidates;   // never dead-end
  }catch(e){ console.error('filterOutHardOoo failed', e); return candidates; }
}
let userMarker=null;
const whereAmIBtn=document.getElementById('whereAmIBtn');
const locateBtn=document.getElementById('locateBtn'),nearestInfo=document.getElementById('nearestInfo');
/* The button's resting label, in one place. It is reset after every outcome — success, denial,
 * timeout, error — and each of those reset it to its own hardcoded string, so changing the markup
 * silently lasted until the first tap. */
const LOCATE_LABEL = 'Find me the closest bathroom';

function setUserLocationMarker(lat, lng){
  if(userMarker) map.removeLayer(userMarker);
  userMarker=L.marker([lat,lng],{
    icon:L.divIcon({
      className:'',
      html:'<div class="user-location-dot"><span></span></div>',
      iconSize:[26,26],
      iconAnchor:[13,13]
    }),
    zIndexOffset:1000
  }).addTo(map);
  return userMarker;
}

whereAmIBtn.addEventListener('click',()=>{
  if(!navigator.geolocation){
    nearestInfo.style.display='block';
    nearestInfo.textContent="Your browser doesn't support location.";
    return;
  }
  const original=whereAmIBtn.innerHTML;
  whereAmIBtn.disabled=true;
  whereAmIBtn.innerHTML='<span class="location-spinner" aria-hidden="true"></span><span>Locating…</span>';
  navigator.geolocation.getCurrentPosition(pos=>{
    const lat=pos.coords.latitude, lng=pos.coords.longitude;
    lastKnownPos={lat,lng,ts:Date.now()};
    currentListPosition=lastKnownPos;
    setUserLocationMarker(lat,lng);
    map.setView([lat,lng],16,{animate:true});
    whereAmIBtn.disabled=false;
    whereAmIBtn.innerHTML=original;
  },err=>{
    whereAmIBtn.disabled=false;
    whereAmIBtn.innerHTML=original;
    nearestInfo.style.display='block';
    nearestInfo.textContent=err.code===1
      ? 'Location access was denied. Enable location permission for this site.'
      : 'Could not get your location. Check your connection and location settings.';
  },{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
});
let suppressNextLocateClick=false;
function showBathroomNowResult(result,fallback=false){
  nearestInfo.style.display='block'; nearestInfo.innerHTML=bathroomNowCard(result,fallback);
  document.getElementById('bathroom-now-close').onclick=()=>{ nearestInfo.style.display='none'; };
  document.getElementById('bathroom-now-view').onclick=()=>{
    nearestInfo.style.display='none';                 // dismiss the overlay first, or the pin's popup opens hidden behind it
    const m=markers[result.loc.id];
    if(m) zoomToMarker(m);
    else map.setView([result.loc.lat,result.loc.lng],16,{animate:false});  // marker not built yet — center the map anyway
  };
  document.getElementById('bathroom-now-directions').onclick=()=>{window.open(buildNavUrl(resolveNavApp(),result.loc.lat,result.loc.lng),'_blank','noopener');};
  // Center the map on the result, but DON'T auto-open its pin popup — the Bathroom Now card is the
  // primary readout (it carries the "nothing selected nearby" callout). Opening the popup on top
  // duplicated the info and buried the card. "View pin" still opens the full popup on demand.
  map.setView([result.loc.lat, result.loc.lng], 16, { animate: false });
}
locateBtn.addEventListener('click',()=>{
  if(suppressNextLocateClick)return;
  if(!navigator.geolocation){nearestInfo.style.display='block';nearestInfo.textContent="Your browser doesn't support location.";return;}
  locateBtn.disabled=true;locateBtn.textContent='Finding the closest…';nearestInfo.style.display='none';
  navigator.geolocation.getCurrentPosition(async pos=>{
    const user={lat:pos.coords.latitude,lng:pos.coords.longitude};lastKnownPos={...user,ts:Date.now()};currentListPosition=lastKnownPos;
    setUserLocationMarker(user.lat,user.lng);
    // Prefer the selected chains, but don't strand someone far from their nearest pick —
    // if nothing selected is within reasonable reach, widen to every chain (still open-only)
    // so the closest real option wins instead. On foot the leash is much shorter: widening to
    // an unselected chain 20 miles away is a rescue by car and an insult on foot — past a
    // mile and a half, showing a farther option from the chains they DID pick is the honest
    // answer, and the card's access notes do the rest.
    const CHAIN_FALLBACK_MILES = travelMode === 'foot' ? 1.5 : 20;
    // Bathroom Now ignores travel mode on purpose: it's the emergency button, so the closest
    // usable bathroom wins even if it's a city/metro spot (e.g. a Dunkin) while in road mode.
    const notClosed = (loc) => isLocationOpenNow(loc) !== false && !isConfirmedNoRestroom(loc);
    const inSelection = (loc) => activeChains.has(loc.chain || DEFAULT_CHAIN_KEY);
    const nearestMiles = (list) => list.reduce((min,loc) => {
      const d = milesBetween(user.lat, user.lng, loc.lat, loc.lng);
      return d < min ? d : min;
    }, Infinity);
    // Relax one constraint at a time, and only when nothing acceptable is within reach.
    // Access-unknown spots come before abandoning the user's chain selection, because an
    // untagged public toilet nearby beats a chain they didn't pick 30 miles away.
    let eligible = seedLocations.filter(loc => inSelection(loc) && notClosed(loc) && goodRecommendation(loc));
    if(nearestMiles(eligible) > CHAIN_FALLBACK_MILES){
      eligible = seedLocations.filter(loc => inSelection(loc) && notClosed(loc));
    }
    if(nearestMiles(eligible) > CHAIN_FALLBACK_MILES){
      eligible = seedLocations.filter(loc => notClosed(loc) && goodRecommendation(loc));
    }
    if(nearestMiles(eligible) > CHAIN_FALLBACK_MILES){
      eligible = seedLocations.filter(notClosed);
    }
    let candidates=eligible.map(loc=>({loc,d:milesBetween(user.lat,user.lng,loc.lat,loc.lng)})).sort((a,b)=>a.d-b.d).slice(0,10).map(x=>x.loc);
    if(!candidates.length){
      locateBtn.disabled=false;locateBtn.textContent=LOCATE_LABEL;
      nearestInfo.style.display='block';
      nearestInfo.textContent='No open bathrooms found nearby right now.';
      return;
    }
    // Don't route someone to a bathroom that's actively flagged out of order. Check the 4 closest
    // in a single batched query and drop any in the HARD phase (soft-phase ones are fine — "might
    // be working now"). Falls through to the next closest survivor. If the check fails or all 4 are
    // flagged (extremely unlikely), we keep the original list rather than dead-end.
    candidates = await filterOutHardOoo(candidates);
    if(!candidates.length){
      locateBtn.disabled=false;locateBtn.textContent=LOCATE_LABEL;
      nearestInfo.style.display='block';
      nearestInfo.textContent='No open bathrooms found nearby right now.';
      return;
    }
    try{
      const options=await getRoutedOptions(user,candidates);
      options.sort((a,b)=>{const rank=x=>isLocationOpenNow(x.loc)===true?0:isLocationOpenNow(x.loc)===null?1:2;return rank(a)-rank(b)||a.distanceMiles-b.distanceMiles;});
      if(!options.length)throw new Error('No routes');showBathroomNowResult(options[0],false);
    }catch(e){
      const loc=candidates[0];showBathroomNowResult({loc,distanceMiles:milesBetween(user.lat,user.lng,loc.lat,loc.lng),durationMinutes:null},true);
    }finally{locateBtn.disabled=false;locateBtn.textContent=LOCATE_LABEL;}
  },err=>{locateBtn.disabled=false;locateBtn.textContent=LOCATE_LABEL;nearestInfo.style.display='block';nearestInfo.textContent=err.code===1?'Location access was denied. Enable location permission for this site to use Bathroom Now.':'Could not get your location. Check your connection and location settings.';},{enableHighAccuracy:true,timeout:10000});
});

// Missing-location reporting — logs straight to Firestore (visible in FlushPanel), no email needed
const missingBtn = document.getElementById('missingBtn');
const missingPanel = document.getElementById('missingPanel');
const missingInput = document.getElementById('missingInput');
const missingSubmit = document.getElementById('missingSubmit');
const missingNote = document.getElementById('missingNote');
const missingUseLocationBtn = document.getElementById('missingUseLocationBtn');
// The panel had no dismiss of its own — only the button that opened it, which is one control
// doing two jobs and reads as stuck.
document.getElementById('missingClose')?.addEventListener('click', () => {
  document.getElementById('missingPanel')?.classList.remove('show');
});
let capturedMissingCoords = null;

missingBtn.addEventListener('click', () => {
  missingPanel.classList.toggle('show');
  if(missingPanel.classList.contains('show')) missingInput.focus();
});

missingUseLocationBtn.addEventListener('click', () => {
  if(!navigator.geolocation){
    missingNote.style.color = '#c62828';
    missingNote.textContent = "Your browser doesn't support location.";
    return;
  }
  missingUseLocationBtn.disabled = true;
  missingUseLocationBtn.innerHTML = `${ico('locate')} Getting your location…`;
  navigator.geolocation.getCurrentPosition((pos) => {
    capturedMissingCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    missingUseLocationBtn.innerHTML = `${ico('check')} Location attached`;
    missingInput.placeholder = 'Optional — add a note (e.g. "behind the gas pumps")';
    missingUseLocationBtn.disabled = false;
  }, () => {
    missingUseLocationBtn.innerHTML = `${ico('locate')} Use my current location`;
    missingUseLocationBtn.disabled = false;
    missingNote.style.color = '#c62828';
    missingNote.textContent = 'Could not get your location — check permissions.';
  }, { enableHighAccuracy: true, timeout: 10000 });
});

async function submitMissingLocation(){
  const description = missingInput.value.trim();
  if(!description && !capturedMissingCoords){
    missingNote.style.color = '#c62828';
    missingNote.textContent = 'Type an address, or use your current location.';
    return;
  }
  missingSubmit.disabled = true;
  missingSubmit.innerHTML = 'Sending…';
  const finalDescription = description || '(no description — location only)';
  const ok = await logMissingLocation(finalDescription, capturedMissingCoords);
  missingNote.style.color = ok ? '#2f6b3c' : '#c62828';
  missingNote.textContent = ok ? 'Thanks — sent!' : 'Something went wrong, try again.';
  if(ok){
    /* Counted only on a confirmed write, never on the attempt — the footer's IMPROVE number is a
     * record of what you actually contributed, and a failed submit that still incremented it
     * would quietly inflate every total from then on. */
    markLocationAdded(finalDescription);
    missingInput.value = '';
    missingInput.placeholder = 'Address or cross streets';
    capturedMissingCoords = null;
    missingUseLocationBtn.innerHTML = `${ico('locate')} Use my current location`;
    setTimeout(() => {
      missingPanel.classList.remove('show');
      missingNote.textContent = '';
    }, 1500);
  }
  missingSubmit.disabled = false;
  missingSubmit.innerHTML = `${ico('send')} Send it in`;
}

missingSubmit.addEventListener('click', submitMissingLocation);
missingInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter') submitMissingLocation();
});

// "Add to Home Screen" suggestion — one-tap install where the browser allows it,
// platform instructions where it doesn't (iOS has no install API), shown once.
(function(){
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  const alreadyDismissed = localStorage.getItem('hideInstallBanner') === '1';

  // Capture the browser's install offer even before the banner logic runs — Chrome fires
  // beforeinstallprompt exactly once, early, and only over HTTPS with a valid manifest+SW.
  // Holding the event lets our own Install button trigger the native dialog on tap.
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();                       // keep Chrome's mini-infobar from double-prompting
    deferredInstall = e;
    if(isStandalone || alreadyDismissed) return;
    const btn = document.getElementById('installNow');
    const msgEl = document.getElementById('installMsg');
    if(btn){
      btn.hidden = false;
      if(msgEl) msgEl.innerHTML = 'Get <b>Bathroom Report</b> as an app — one tap, no store.';
    }
  });

  if(isStandalone || alreadyDismissed) return;

  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
  const isAndroid = /Android/.test(ua);

  const msgEl = document.getElementById('installMsg');
  if(isIOS){
    msgEl.innerHTML = 'Add this to your <b>Home Screen</b>: tap the Share icon (⬆️ box with arrow) at the bottom of Safari, then tap <b>"Add to Home Screen."</b>';
  } else if(isAndroid){
    msgEl.innerHTML = 'Add this to your <b>Home Screen</b>: tap the ⋮ menu (top-right in Chrome), then tap <b>"Add to Home screen"</b> or <b>"Install app."</b>';
  } else {
    msgEl.innerHTML = 'On your phone, look for <b>"Add to Home Screen"</b> or <b>"Install"</b> in your browser\'s menu for one-tap access next time.';
  }

  setTimeout(() => {
    document.getElementById('installBanner').classList.add('show');
  }, 1500);

  document.getElementById('installNow')?.addEventListener('click', async () => {
    if(!deferredInstall) return;
    deferredInstall.prompt();                 // the native install dialog
    const choice = await deferredInstall.userChoice;
    deferredInstall = null;                   // the event is single-use
    document.getElementById('installBanner').classList.remove('show');
    // Accepted: the app is installing — never show the banner again. Dismissed the native
    // dialog: keep our banner eligible for a future visit rather than nagging now.
    if(choice && choice.outcome === 'accepted') localStorage.setItem('hideInstallBanner', '1');
  });

  document.getElementById('installClose').addEventListener('click', () => {
    document.getElementById('installBanner').classList.remove('show');
    localStorage.setItem('hideInstallBanner', '1');
  });
})();
