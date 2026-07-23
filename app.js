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
const CHAIN_REGISTRY = {
  stewarts: { name: "Stewart's Shops", color: '#5b3a8f', textColor: '#ffffff', dataVar: 'stewartsLocations' },
  cumberlandFarms: { name: "Cumberland Farms", color: '#009639', textColor: '#ffffff', dataVar: 'cumberlandFarmsLocations' },
  wawa: { name: "Wawa", color: '#00b3b3', textColor: '#ffffff', dataVar: 'wawaLocations' },
  fastrac: { name: "Fastrac", color: '#0088cc', textColor: '#ffffff', dataVar: 'fastracLocations' },
  alltownFresh: { name: "Alltown Fresh", color: '#6d8c3a', textColor: '#ffffff', dataVar: 'alltownFreshLocations' },
  byrneDairy: { name: "Byrne Dairy", color: '#8a6d1a', textColor: '#ffffff', dataVar: 'byrneDairyLocations' },
  parkers: { name: "Parker's", color: '#1565c0', textColor: '#ffffff', dataVar: 'parkersLocations' },
  sheetz: { name: "Sheetz", color: '#ee3124', textColor: '#ffffff', dataVar: 'sheetzLocations' },
  racetrac: { name: "RaceTrac", color: '#00205b', textColor: '#ffffff', dataVar: 'racetracLocations' },
  pilotFlyingJ: { name: "Pilot Flying J", color: '#fdb913', textColor: '#1c1c1e', dataVar: 'pilotLocations' },
  maverik: { name: "Maverik", color: '#b30086', textColor: '#ffffff', dataVar: 'maverikLocations' },
  quiktrip: { name: "QuikTrip", color: '#e8590c', textColor: '#ffffff', dataVar: 'quiktripLocations' },
  loves: { name: "Love's", color: '#8e44ad', textColor: '#ffffff', dataVar: 'lovesLocations' },
  bucees: { name: "Buc-ee's", color: '#ffd200', textColor: '#1c1c1e', dataVar: 'buceesLocations' },
  caseys: { name: "Casey's", color: '#d81b60', textColor: '#ffffff', dataVar: 'caseysLocations' },
  kwiktrip: { name: "Kwik Trip", color: '#3f51b5', textColor: '#ffffff', dataVar: 'kwiktripLocations' },
  royalFarms: { name: "Royal Farms", color: '#33691e', textColor: '#ffffff', dataVar: 'royalFarmsLocations' },
  rutters: { name: "Rutter's", color: '#4e342e', textColor: '#ffffff', dataVar: 'ruttersLocations' },
  nycDunkin: { name: "Dunkin'", color: '#ff6e0c', textColor: '#ffffff', dataVar: 'nycDunkinLocations', group: 'metro', metro: 'NYC', layer: 'customer' },
  nycStarbucks: { name: 'Starbucks', color: '#00704a', textColor: '#ffffff', dataVar: 'nycStarbucksLocations', group: 'metro', metro: 'NYC', layer: 'customer' },
  nycPublic: { name: 'Public restroom', color: '#0057b8', textColor: '#ffffff', dataVar: 'nycPublicLocations', group: 'metro', metro: 'NYC', layer: 'public', shape: 'diamond' }
};
const DEFAULT_CHAIN_KEY = 'stewarts';

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

// Total location count shown in the menu (hamburger) drawer footer, above the version —
// total first, then a breakdown: pit stops and each covered metro separately.
(function(){
  const el = document.getElementById('drawerLocCount');
  if(!el) return;
  const pit = seedLocations.filter(l => groupOf(l.chain || DEFAULT_CHAIN_KEY) !== 'metro').length;
  const byCity = {};
  seedLocations.forEach(l => {
    const c = CHAIN_REGISTRY[l.chain || DEFAULT_CHAIN_KEY];
    if(c && c.group === 'metro'){ const m = c.metro || 'Other'; byCity[m] = (byCity[m] || 0) + 1; }
  });
  const lines = [`🛣️ Pit stops: ${pit.toLocaleString()}`,
    ...Object.keys(byCity).map(m => `🏙️ ${escapeHtml(m)}: ${byCity[m].toLocaleString()}`)];
  el.innerHTML = `${seedLocations.length.toLocaleString()} locations mapped` +
    `<span class="d-count-breakdown">${lines.join('<br>')}</span>`;
})();

// Theme: defaults to the phone's system light/dark setting, but a manual toggle overrides it
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  if(btn){
    const ic = btn.querySelector('.theme-ico');
    if(ic) ic.textContent = theme === 'light' ? '☀️' : '🌙';
    const lbl = btn.querySelector('.theme-label');
    if(lbl) lbl.textContent = theme === 'light' ? 'Light mode' : 'Dark mode';
    btn.classList.toggle('on', theme === 'light');
  }
  if(typeof setMapTilesForTheme === 'function') setMapTilesForTheme(theme);
}
document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  applyTheme(next);
});

// Collapsible legend — defaults to collapsed on repeat visits to save screen space, remembers choice
(function(){
  const toggle = document.getElementById('legendToggle');
  const body = document.getElementById('legendBody');
  const arrow = document.getElementById('legendArrow');

  // Pins are colored by store brand (not community rating), so the key lists chains.
  if(body){
    body.innerHTML = Object.keys(CHAIN_REGISTRY).map(k => {
      const c = CHAIN_REGISTRY[k];
      return `<div><span class="dot" style="background:${c.color}"></span>${c.name}</div>`;
    }).join('');
  }

  function setCollapsed(collapsed){
    body.classList.toggle('collapsed', collapsed);
    arrow.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    localStorage.setItem('legendCollapsed', collapsed ? '1' : '0');
  }

  const saved = localStorage.getItem('legendCollapsed');
  setCollapsed(saved === null ? false : saved === '1'); // expanded by default on first visit

  toggle.addEventListener('click', () => {
    setCollapsed(!body.classList.contains('collapsed'));
  });
})();

const map = L.map('map', {
  zoomControl: false,
  maxZoom: 19,
  // One-handed zoom (double-tap + drag up/down, Google Maps style) via the DoubleTapDragZoom
  // plugin. The option is simply ignored if the plugin script failed to load, so the map still
  // works normally without it.
  doubleTapDragZoom: 'center',
  doubleTapDragZoomOptions: { reverse: true }   // drag DOWN = zoom in (Google Maps direction)
}).setView([42.65123, -73.75176], 12);
L.control.zoom({ position: 'bottomright' }).addTo(map);

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

  // The marker's chain may currently be hidden by the Chains filter (e.g. Bathroom Now
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
  document.getElementById('passportToggle').style.display = 'none';
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
  document.getElementById('passportToggle').style.display = '';
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

function makeIcon(id){
  // Pins are colored by store brand only. They no longer encode community rating, so the
  // map never has to load aggregate data just to draw pins (that's what caused reads to
  // scale with the dataset and spike on zoom-out). Rating is shown in the popup, loaded
  // for a single location when its pin is opened.
  const chain = chainFor(locationsById[id]);
  const sizes = sizesForZoom(map.getZoom());
  const size = sizes.rated; // one uniform size per zoom level
  return L.divIcon({
    className:'',
    html:`<div style="${pinShapeStyle(chain, size)}"></div>`,
    iconSize:[size, size],
    iconAnchor:[size/2, size/2]
  });
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
function emptyVote(){ return {store:0, bathroom:0, amenities:{}, storeFeatures:{}, amenityMeta:{}}; }
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
const CONFIRM_THRESHOLD = 3;
function isConfirmedYes(x){ return !!x && x.yes >= CONFIRM_THRESHOLD && x.yes > x.no; }
function isConfirmedNo(x){  return !!x && x.no  >= CONFIRM_THRESHOLD && x.no  > x.yes; }

// ---------- Voting priority engine (v2.6) ----------
// Usefulness tiers drive which unconfirmed questions surface first. Higher number = higher
// priority. gas is intentionally absent (OSM-known, never asked). Anything not listed defaults
// to LOW.
const AMENITY_TIER = {
  accessible: 3, changing: 3,                                   // HIGH
  indoorSeating: 2, wifi: 2, restroomType: 2, grabAndGo: 2, hotFood: 2, evCharging: 2, // MEDIUM
  airPump: 1, shower: 1                                         // LOW
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
// them from teal (verified) to amber (confirmed by visitors).
function amenitySettled(loc, key, summary){
  const conf = (loc && loc.conf) || {};
  const osm  = (loc && loc.osm) || {};
  if(key === 'gas') return true;                      // never asked
  if(conf[key]) return true;                          // baked community confirmation
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
function pickVisitQuestions(loc, myVote){
  const summary = { ...(amenityCache[loc.id] || {}), ...(storeFeatureCache[loc.id] || {}) };
  const mine = { ...(myVote.amenities || {}), ...(myVote.storeFeatures || {}) };
  const meta = myVote.amenityMeta || {};
  // Metro locations (Dunkin, Starbucks, public restrooms, …) get bathroom questions only —
  // store/gas-station features (EV charging, air pump, showers, …) are never asked there.
  const isMetro = chainFor(loc).group === 'metro';
  const allKeys = (isMetro ? BATHROOM_AMENITIES : [...BATHROOM_AMENITIES, ...STORE_FEATURES]).map(a => a.key);

  const eligible = allKeys.filter(key => {
    if(amenitySettled(loc, key, summary)) return false;                 // confirmed / gas
    const ans = mine[key];
    if(ans === 'yes' || ans === 'no' || (ans && ans !== 'unknown')) return false; // answered for real
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
  {key:'restroomType', label:'Restroom setup', states:['unknown','single','multiple'],
    stateLabels:{
      unknown:'Not sure',
      single:'Single',
      multiple:"Men's & women's"
    }},
  {key:'accessible', label:'Handicap accessible', stateIcons:{yes:'♿️'}},
  {key:'changing', label:'Changing table', stateIcons:{yes:'🚼'}}
];
const amenityCache = {};

// Store-level features — separate from bathroom features (myVote.storeFeatures vs
// myVote.amenities), tucked inside the already-collapsed Store rating section so the
// bathroom-first flow stays exactly as quick as it was.
const STORE_FEATURES = [
  {key:'evCharging', label:'EV Charging', stateIcons:{yes:'⚡'}},
  {key:'airPump', label:'Air pump', stateIcons:{yes:'🛞'}},
  {key:'shower', label:'Showers', stateIcons:{yes:'🚿'}},
  {key:'indoorSeating', label:'Indoor seating', stateIcons:{yes:'🪑'}},
  {key:'wifi', label:'WiFi', stateIcons:{yes:'📶'}},
  {key:'grabAndGo', label:'Grab & go snacks', stateIcons:{yes:'🥤'}},
  {key:'hotFood', label:'Hot food', stateIcons:{yes:'🍔'}}
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
const AMENITY_ANSWER_ICONS = {yes:'✅', no:'❌', unknown:'🤷', single:'🚪', multiple:'🚻'};

function amenityAnswerIcon(a, val){
  if(a.stateIcons && a.stateIcons[val]) return a.stateIcons[val];
  return AMENITY_ANSWER_ICONS[val] || '•';
}

// Renders whichever single question comes next (the first one this person hasn't answered
// yet), or a friendly completion message once every feature has an answer on record.
// Per-popup visit state: the ordered list of question keys chosen for this visit (computed once
// on open so it stays stable as the person answers), and how far through it they are.
const visitQuestions = {};
const visitCursor = {};

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
    return `<div class="amenity-complete">🚽 That's everything — thanks for the intel!</div>`;
  }
  const a = amenityDefFor(list[cursor]);
  if(!a){ return `<div class="amenity-complete">🚽 That's everything — thanks for the intel!</div>`; }
  const states = a.states || ['unknown', 'yes', 'no'];
  const buttons = states.map(s =>
    `<button type="button" class="amenity-answer-btn" data-key="${a.key}" data-value="${s}">${amenityAnswerIcon(a, s)} ${amenityStateLabel(a, s)}</button>`
  ).join('');
  return `<div class="amenity-progress">Question ${cursor + 1} of ${list.length}</div>
    <div class="amenity-question-label">${a.label}</div>
    <div class="amenity-answer-row">${buttons}</div>`;
}

function amenityEditorHtml(locId, myVote){
  return `<div class="amenities-editor">
    <div class="feature-title">✅ Confirm what you saw</div>
    <div class="amenity-step" id="amenity-step-${locId}">${renderAmenityStepHtml(myVote, locId)}</div>
    <div class="save-note" id="amenities-note-${locId}"></div>
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
// Refresh the unified "Confirmed by visitors" block and collapse it when empty. Call after any
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
  return featureDefs.filter(a => {
    if(skip && skip.includes(a.key)) return false;
    const x = summary && summary[a.key] || {yes:0,no:0};
    return isConfirmedYes(x) || conf[a.key];
  }).map(a => `<span class="feature-badge community">${amenityAnswerIcon(a, 'yes')} ${a.label} ⭐</span>`).join('');
}

// The unified "✅ Confirmed by visitors" block: bathroom + store community confirmations together
// in one flat row (icons distinguish them; no internal split). Empty → returns '' so the whole
// block collapses. 'accessible' is excluded because it has its own prominent badge.
function communitySummaryHtml(loc){
  const bSummary = amenityCache[loc.id];
  const sSummary = storeFeatureCache[loc.id];
  return communityConfirmedBadges(loc, BATHROOM_AMENITIES, bSummary, ['accessible'])
       + communityConfirmedBadges(loc, STORE_FEATURES, sSummary);
}
function communitySectionHasContent(loc){ return communitySummaryHtml(loc) !== ''; }

function amenitySummaryHtml(summary, loc){
  // OSM-verified bathroom badges only — community confirmations now live in the unified
  // "Confirmed by visitors" block above. 'accessible' has its own prominent badge.
  const verified = osmVerifiedBadges(loc, BATHROOM_AMENITIES, summary, ['accessible']);
  if(!summary && !verified) return '<span class="feature-badge unconfirmed">Loading features…</span>';
  if(!verified) return '<span class="feature-badge unconfirmed">Nothing verified yet</span>';
  return verified;
}

// Same "confirmed" rule as the summary badges (at least 2 yes-votes, and more yes than no),
// specifically for handicap-accessible — used both for the prominent popup badge and for
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
  if(!communityYes && !osmYes) return '';
  const cls = communityYes ? 'access-indicator community' : 'access-indicator verified';
  const title = communityYes ? 'Wheelchair accessible — confirmed by visitors' : 'Wheelchair accessible — verified';
  return `<span class="${cls}" title="${title}" aria-label="${title}">♿</span>`;
}

function accessibleBadgeHtml(locId){
  // Community confirmations are the strongest signal and win when present.
  const summary = amenityCache[locId];
  if(summary && isConfirmedAccessible(summary)){
    return '<div class="accessible-badge">♿ Handicap accessible — confirmed by visitors</div>';
  }
  const loc = locationsById[locId];
  // Baked community confirmation (from a prior votes bake) also counts as visitor-confirmed.
  if(loc && loc.conf && loc.conf.accessible){
    return '<div class="accessible-badge">♿ Handicap accessible — confirmed by visitors</div>';
  }
  // Fall back to accessibility data baked into the location files (sourced from
  // OpenStreetMap wheelchair / toilets:wheelchair tags at bake time).
  const osmAccessible = loc && ((loc.osm && loc.osm.accessible) || loc.wheelchair === 'yes' || loc.wheelchair === 'designated');
  if(osmAccessible){
    return '<div class="accessible-badge">♿ Wheelchair accessible — verified</div>';
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
      const snap = await getDoc(doc(db, 'aggregates', locId));
      data = snap.exists() ? (snap.data() || {}) : {};
    }catch(e){ console.error('community doc load failed', e); }
    const amen = data.amen || {};
    const build = defs => {
      const s = {};
      defs.forEach(a => {
        const c = amen[a.key] || {};
        s[a.key] = { yes: c.yes > 0 ? c.yes : 0, no: c.no > 0 ? c.no : 0 };
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
    return `<div class="amenity-complete">🏪 That's everything — thanks for the intel!</div>`;
  }
  const a = STORE_FEATURES[idx];
  const states = a.states || ['unknown', 'yes', 'no'];
  const buttons = states.map(s =>
    `<button type="button" class="store-feature-answer-btn" data-key="${a.key}" data-value="${s}">${amenityAnswerIcon(a, s)} ${amenityStateLabel(a, s)}</button>`
  ).join('');
  return `<div class="amenity-progress">Feature ${idx + 1} of ${STORE_FEATURES.length}</div>
    <div class="amenity-question-label">${a.label}</div>
    <div class="amenity-answer-row">${buttons}</div>`;
}

function storeFeatureEditorHtml(locId, myVote){
  return `<div class="amenities-editor">
    <div class="feature-title">🏪 Store features you saw</div>
    <div class="store-feature-step" id="store-feature-step-${locId}">${renderStoreFeatureStepHtml(myVote)}</div>
    <div class="save-note" id="store-feature-note-${locId}"></div>
  </div>`;
}

// True if a location has any OSM-VERIFIED store feature to show (community confirmations now
// live in the unified block, so they no longer count toward showing this OSM section).
function storeSectionHasContent(loc){
  if(loc && loc.osm && loc.osm.gas) return true;   // gas alone is enough to show the section
  return osmVerifiedBadges(loc, STORE_FEATURES, storeFeatureCache[loc.id]) !== '';
}
// Same, for the OSM bathroom-features section (excluding accessible, which has its own badge).
function osmBathroomHasContent(loc){
  return osmVerifiedBadges(loc, BATHROOM_AMENITIES, amenityCache[loc.id], ['accessible']) !== '';
}

function storeFeatureSummaryHtml(summary, loc){
  // OSM-verified store badges only — community confirmations live in the unified block above.
  // Gas is display-only (OSM-known, never voted on): show it as a quiet teal badge up front.
  const gasBadge = (loc && loc.osm && loc.osm.gas)
    ? '<span class="feature-badge verified">⛽ Gas</span>' : '';
  const verified = gasBadge + osmVerifiedBadges(loc, STORE_FEATURES, summary);
  if(!summary && !verified) return '<span class="feature-badge unconfirmed">Loading features…</span>';
  if(!verified) return '<span class="feature-badge unconfirmed">Nothing verified yet</span>';
  return verified;
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
function quipFor(type, val){
  if(!val) return 'Tap to rate';
  const options = (type === 'store' ? storeQuips : bathroomQuips)[val];
  if(!options) return '';
  return options[Math.floor(Math.random() * options.length)];
}

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
function usernameToEmail(username){
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  return clean + '@stewarts-map.local';
}

async function signUpAccount(username, password){
  const clean = username.trim();
  if(clean.length < 3) return { ok: false, reason: 'Username needs to be at least 3 characters.' };
  if(!/^[a-zA-Z0-9_]+$/.test(clean)) return { ok: false, reason: 'Letters, numbers, and underscores only.' };
  if(password.length < 6) return { ok: false, reason: 'Password needs to be at least 6 characters.' };
  try{
    const {auth, createUserWithEmailAndPassword, db, doc, setDoc} = await fb();
    const oldAnonId = getClientId(); // capture before login changes what getEffectiveId() returns
    const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(clean), password);
    await migrateAnonymousDataToAccount(oldAnonId, cred.user.uid, clean);
    return { ok: true };
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
    return { ok: true };
  }catch(e){
    if(e.code === 'auth/invalid-credential' || e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password'){
      return { ok: false, reason: 'Wrong username or password.' };
    }
    console.error('logInAccount failed', e);
    return { ok: false, reason: 'Something went wrong — try again.' };
  }
}

async function logOutAccount(){
  const {auth, signOut} = await fb();
  await signOut(auth);
}

// One-time migration: folds this device's existing anonymous ratings/name into the new
// account, so signing up doesn't wipe out history you already built up on this device.
async function migrateAnonymousDataToAccount(oldAnonId, newUid, username){
  if(oldAnonId === newUid) return; // nothing to migrate (shouldn't normally happen)
  try{
    const {db, doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs} = await fb();

    // Move each vote this device made over to the new account
    const votesQuery = query(collection(db, 'votes'), where('clientId', '==', oldAnonId));
    const votesSnap = await getDocs(votesQuery);
    for(const voteDoc of votesSnap.docs){
      const data = voteDoc.data();
      const locId = data.locId;
      if(!locId) continue;
      await setDoc(doc(db, 'votes', locId + '_' + newUid), { ...data, clientId: newUid }, { merge: true });
      await deleteDoc(voteDoc.ref);
    }

    // Move check-ins over too — Bathroom Passport and several achievements (Road Warrior,
    // Early Bird, Night Owl) depend on check-in history, which would otherwise be silently
    // orphaned under the old anonymous ID after signing up.
    const checkinsQuery = query(collection(db, 'checkins'), where('clientId', '==', oldAnonId));
    const checkinsSnap = await getDocs(checkinsQuery);
    for(const checkinDoc of checkinsSnap.docs){
      const data = checkinDoc.data();
      const locId = data.locId;
      if(!locId) continue;
      await setDoc(doc(db, 'checkins', locId + '_' + newUid), { ...data, clientId: newUid }, { merge: true });
      await deleteDoc(checkinDoc.ref);
    }

    // Carry over any achievement progress already earned on this device, merging into
    // whatever (if anything) the new account already has rather than overwriting it
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
      await deleteDoc(doc(db, 'achievements', oldAnonId));
    }
  }catch(e){
    console.error('migrateAnonymousDataToAccount failed (non-fatal):', e);
  }
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
window.addEventListener('authStateReady', () => {
  checkIfBlocked();
  if(typeof loadAllRatings === 'function') loadAllRatings();
  if(typeof updateAccountUI === 'function') updateAccountUI();
  if(typeof loadTravelModeFromAccount === 'function') loadTravelModeFromAccount();
});

// Shared (public) aggregate — visible to everyone who opens this map
async function loadAggregate(id){
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'aggregates', id));
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
    const snap = await getDoc(doc(db, 'votes', id + '_' + getEffectiveId()));
    if(!snap.exists()) return emptyVote();
    return { ...emptyVote(), ...snap.data() };
  }catch(e){
    return emptyVote();
  }
}
async function saveMyVote(id, data){
  try{
    const {db, doc, setDoc} = await fb();
    const clientId = getEffectiveId();
    const existing = myVoteCache[id] || {};
    const payload = { ...data, clientId, locId: id, lastUpdated: Date.now() };
    // Username on the vote lets the leaderboard Cloud Function credit ratings to a display name
    // without a separate lookup. Only logged-in users can rate, so this is always present.
    const uname = (window.__currentUser && window.__currentUser.email)
      ? window.__currentUser.email.split('@')[0] : '';
    if(uname) payload.username = uname;
    // First bathroom rating gets an immutable ratedAt — drives the time-based achievements.
    if(data.bathroom > 0 && !existing.ratedAt){
      payload.ratedAt = Date.now();
      if(myVoteCache[id]) myVoteCache[id].ratedAt = payload.ratedAt;
    }
    await setDoc(doc(db, 'votes', id + '_' + clientId), payload, { merge: true });
    // Mirror this rating into the user's OWN profile doc (users/{uid}) so the Passport and the
    // whole "my ratings" load cost ONE read no matter how many ratings they have. The votes doc
    // above stays the source of truth for the aggregate Cloud Function. Logged-in only (the rules
    // require it, and only logged-in users can rate). Non-critical: if this write is ever denied
    // (e.g. rules not deployed yet) the app just falls back to the per-vote query on load.
    if(isLoggedIn()){
      try{
        await setDoc(doc(db, 'users', clientId),
          { uid: clientId, username: uname || '', lastUpdated: Date.now(), ratings: { [id]: payload } },
          { merge: true });
      }catch(e){ /* non-critical */ }
    }
    return true;
  }catch(e){
    return false;
  }
}

// Short community tips ("need a key", "buzzer required", etc.) — shared, max 50 chars each
const MAX_TIP_LENGTH = 50;
async function loadTips(id){
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'tips', id));
    if(!snap.exists()) return [];
    return (snap.data().tips || []).slice(-8); // show up to the 8 most recent
  }catch(e){
    return [];
  }
}
async function addTip(id, text){
  try{
    const {db, doc, setDoc, arrayUnion} = await fb();
    await setDoc(doc(db, 'tips', id), { tips: arrayUnion(text) }, { merge: true });
    logActivity('tip', { locId: id, text });
    return true;
  }catch(e){
    return false;
  }
}

// Weekly recap — lightweight activity log, just enough to show "X new this week"
async function logActivity(type, extra){
  try{
    const {db, collection, addDoc} = await fb();
    await addDoc(collection(db, 'activity'), { type, ts: Date.now(), ...(extra || {}) });
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
        checks.push(
          getDoc(doc(db, 'votes', item.sourceId))
            .then(vSnap => vSnap.exists() ? 'rating' : null)
            .catch(() => null)
        );
      } else if(item.type === 'tip' && item.locId && typeof item.text === 'string'){
        checks.push(
          getDoc(doc(db, 'tips', item.locId))
            .then(tSnap => {
              const tips = tSnap.exists() && Array.isArray(tSnap.data().tips) ? tSnap.data().tips : [];
              return tips.includes(item.text) ? 'tip' : null;
            })
            .catch(() => null)
        );
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
        el.textContent = `📈 This week: ${ratings} new rating${ratings===1?'':'s'}, ${tips} new tip${tips===1?'':'s'}`;
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
function ratingSectionInnerHtml(loc, agg, myVote){
  const status = oooStatus(oooCache[loc.id]);
  if(status.phase === 'hard'){
    return oooHardHtml(loc, status);
  }
  const softNote = status.phase === 'soft'
    ? `<div class="ooo-soft-note">⚠️ Reported out of order ${relativeTimeFromNow(status.since)} — might be working now.</div>`
    : '';
  return `<span class="rating-label">🚻 Rate this bathroom</span>
      <div class="rating-score-line"><span class="rating-score">${avgStr(agg.bathroomSum, agg.bathroomCount)}★</span> ${ratingConfidenceHtml(agg.bathroomCount)}</div>
      <div class="rate-stack" id="ratestack-bathroom-${loc.id}">
        ${starsHtml(loc.id,'bathroom',myVote.bathroom)}
        <div class="star-quip" id="quip-bathroom-${loc.id}">${quipFor('bathroom', myVote.bathroom)}</div>
        <div class="rate-flash" id="flash-bathroom-${loc.id}" aria-live="polite"></div>
      </div>
      <div class="save-note" id="note-bathroom-${loc.id}"></div>
      ${softNote}
      <button type="button" class="ooo-report-link" id="ooo-report-${loc.id}">⚠️ Report out of order</button>`;
}

// The hard-phase readout: no stars, a clear notice, and an "It's working now" clear button. A
// re-report ("still broken") button is offered too (GPS-gated) so persistent outages escalate.
function oooHardHtml(loc, status){
  return `<div class="ooo-hard">
      <div class="ooo-hard-title">⚠️ Reported out of order</div>
      <div class="ooo-hard-sub">Reported ${relativeTimeFromNow(status.since)}. Rating hidden until it's confirmed working.</div>
      <button type="button" class="btn btn-primary ooo-working-btn" id="ooo-working-${loc.id}">✓ It's working now</button>
      <button type="button" class="ooo-report-link" id="ooo-stillbroken-${loc.id}">Still broken — report again</button>
      <div class="save-note" id="ooo-note-${loc.id}"></div>
    </div>`;
}

// Access badge for metro locations — the "can I actually use this?" answer, shown first.
// Customer chains (Dunkin/Starbucks) default to "customers only"; civic toilets are "public".
function metroAccessBadge(loc){
  const a = (loc.metroInfo && loc.metroInfo.access) || '';
  if(a === 'customer') return '<div class="access-badge access-customer">🔑 Customers only</div>';
  if(a === 'public')   return '<div class="access-badge access-public">✅ Public restroom</div>';
  return '<div class="access-badge access-unknown">❔ Access unknown</div>';
}

// Metro (city) popup — for non-gas-station locations. Leads with access, shows accessibility and
// hours (hours are DISPLAYED as text, never computed into an open/closed status, since OSM hours
// aren't in our parseable format). Reuses the same element IDs as the pit-stop popup so the shared
// directions / share / report / rating / tip handlers attach unchanged. Store-amenity sections are
// omitted (there's no convenience store); their attach handlers no-op safely via safeAttach().
function metroPopupHtml(loc, agg, myVote){
  const shareUrl = `${location.origin}${location.pathname}?loc=${encodeURIComponent(loc.id)}`;
  const chain = chainFor(loc);
  const raw = (loc.metroInfo && loc.metroInfo.hoursRaw) || '';
  const hoursLine = raw
    ? `<div class="hours-line">🕐 ${escapeHtml(raw)}</div>`
    : `<div class="hours-line">🕐 Hours not listed yet — know them? Tap 🚩 below to send them in.</div>`;
  return `<div class="popup-inner" data-locid="${loc.id}">
    <div class="popup-head-row">
      <div class="chain-badge" style="background:${chain.color};color:${chain.textColor};">${escapeHtml(chain.name)}</div>
    </div>
    <div class="addr addr-title">${escapeHtml(loc.addr || '')}</div>
    ${metroAccessBadge(loc)}
    ${(loc.metroInfo && loc.metroInfo.fee) ? `<div class="hours-line">${loc.metroInfo.fee === 'free' ? '✅ Free to use' : '💰 Paid / fee'}</div>` : ''}
    ${(loc.metroInfo && loc.metroInfo.disposal) ? `<div class="hours-line">🚻 Basic facilities (portable / chemical unit)</div>` : ''}
    ${hoursLine}
    <div id="accessible-badge-${loc.id}">${accessibleBadgeHtml(loc.id)}</div>
    <div class="popup-actions">
      <button class="btn btn-primary directions-btn" id="directions-btn-${loc.id}" data-lat="${loc.lat}" data-lng="${loc.lng}">🧭 Directions</button>
      <button class="btn btn-secondary btn-icon-only share-btn" title="Share" data-shareurl="${shareUrl}" data-sharename="${(loc.n||'').replace(/"/g,'&quot;')}">🔗</button>
      <button class="btn btn-danger btn-icon-only report-toggle-btn" title="Report an issue" id="report-toggle-${loc.id}">🚩</button>
    </div>
    <div class="report-section" id="report-section-${loc.id}" style="display:none;">
      <div class="report-heading">Report a problem with this listing</div>
      <div class="report-cats" id="report-cats-${loc.id}">
        <button type="button" class="report-cat-btn" data-reason="Permanently closed">🚫 Permanently closed</button>
        <button type="button" class="report-cat-btn" data-reason="Wrong address / location">📍 Wrong address</button>
        <button type="button" class="report-cat-btn" data-reason="Wrong hours">🕐 Wrong hours</button>
        <button type="button" class="report-cat-btn" data-reason="Not a real location">❓ Not a real location</button>
        <button type="button" class="report-cat-btn" data-reason="__other__">✏️ Other</button>
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
    <div class="community-section${communitySectionHasContent(loc) ? '' : ' is-empty'}" id="community-section-${loc.id}">
      <div class="feature-title">✅ Confirmed by visitors</div>
      <div class="feature-badges" id="community-summary-${loc.id}">${communitySummaryHtml(loc)}</div>
    </div>
    <div class="tips-section">
      <span class="rating-label">💬 Tips from visitors</span>
      <ul class="tips-list" id="tips-list-${loc.id}"><li style="color:#999;">Loading…</li></ul>
      <div class="tip-input-row">
        <input type="text" class="tip-input" id="tip-input-${loc.id}" maxlength="${MAX_TIP_LENGTH}" placeholder="e.g. need a key, buzzer required" />
        <button class="btn btn-amber tip-submit" id="tip-submit-${loc.id}">Add</button>
      </div>
    </div>
    ${amenityEditorHtml(loc.id, myVote)}
    <div class="feature-summary osm-bathroom-section${osmBathroomHasContent(loc) ? '' : ' is-empty'}"><div class="feature-title">🚻 Bathroom features</div><div class="feature-badges" id="feature-summary-${loc.id}">${amenitySummaryHtml(amenityCache[loc.id], loc)}</div></div>` : `<div class="popup-signin-hint">🔒 Sign in to rate this bathroom and see visitor tips.</div>`}
  </div>`;
}

function popupHtml(loc, agg, myVote){
  if(chainFor(loc).group === 'metro') return metroPopupHtml(loc, agg, myVote);
  const shareUrl = `${location.origin}${location.pathname}?loc=${encodeURIComponent(loc.id)}`;
  const hoursText = formatHrsDisplay(loc);
  const openStatus = isLocationOpenNow(loc);
  let hoursLine = '';
  if(hoursText){
    const statusHtml = openStatus === true
      ? '<span style="color:#2e7d32;font-weight:700;">Open now</span>'
      : openStatus === false
        ? '<span style="color:#c62828;font-weight:700;">Closed now</span>'
        : '';
    hoursLine = `<div class="hours-line">🕐 ${hoursText}${statusHtml ? ' · ' + statusHtml : ''}</div>`;
  } else {
    hoursLine = `<div class="hours-line">🕐 Hours not listed for this store yet — know them? Tap 🚩 below to send them in.</div>`;
  }
  const recency = relativeTimeFromNow(agg.lastRatedAt || agg.lastUpdated);
  const recencyLine = recency ? `<div class="hours-line">📝 Last rated ${recency}</div>` : '';
  const chain = chainFor(loc);
  return `<div class="popup-inner" data-locid="${loc.id}">
    <div class="popup-head-row">
      <div class="chain-badge" style="background:${chain.color};color:${chain.textColor};">${chain.name}</div>
    </div>
    <div class="addr addr-title">${loc.addr}${loc.num ? ' &middot; Shop #' + loc.num : ''}</div>
    ${hoursLine}
    <div id="accessible-badge-${loc.id}">${accessibleBadgeHtml(loc.id)}</div>
    ${recencyLine}
    <div class="popup-actions">
      <button class="btn btn-primary directions-btn" id="directions-btn-${loc.id}" data-lat="${loc.lat}" data-lng="${loc.lng}">🧭 Directions</button>
      <button class="btn btn-secondary btn-icon-only share-btn" title="Share" data-shareurl="${shareUrl}" data-sharename="${loc.n.replace(/"/g,'&quot;')}">🔗</button>
      <button class="btn btn-danger btn-icon-only report-toggle-btn" title="Report an issue" id="report-toggle-${loc.id}">🚩</button>
    </div>
    <div class="report-section" id="report-section-${loc.id}" style="display:none;">
      <div class="report-heading">Report a problem with this listing</div>
      <div class="report-cats" id="report-cats-${loc.id}">
        <button type="button" class="report-cat-btn" data-reason="Permanently closed">🚫 Permanently closed</button>
        <button type="button" class="report-cat-btn" data-reason="Wrong address / location">📍 Wrong address</button>
        <button type="button" class="report-cat-btn" data-reason="Wrong hours">🕐 Wrong hours</button>
        <button type="button" class="report-cat-btn" data-reason="Not a real location">❓ Not a real location</button>
        <button type="button" class="report-cat-btn" data-reason="__other__">✏️ Other</button>
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
    <div class="community-section${communitySectionHasContent(loc) ? '' : ' is-empty'}" id="community-section-${loc.id}">
      <div class="feature-title">✅ Confirmed by visitors</div>
      <div class="feature-badges" id="community-summary-${loc.id}">${communitySummaryHtml(loc)}</div>
    </div>
    <div class="tips-section">
      <span class="rating-label">💬 Tips from visitors</span>
      <ul class="tips-list" id="tips-list-${loc.id}"><li style="color:#999;">Loading…</li></ul>
      <div class="tip-input-row">
        <input type="text" class="tip-input" id="tip-input-${loc.id}" maxlength="${MAX_TIP_LENGTH}" placeholder="e.g. need a key, buzzer required" />
        <button class="btn btn-amber tip-submit" id="tip-submit-${loc.id}">Add</button>
      </div>
    </div>
    ${amenityEditorHtml(loc.id, myVote)}
    <div class="feature-summary osm-bathroom-section${osmBathroomHasContent(loc) ? '' : ' is-empty'}"><div class="feature-title">🚻 Bathroom features</div><div class="feature-badges" id="feature-summary-${loc.id}">${amenitySummaryHtml(amenityCache[loc.id], loc)}</div></div>
    <div class="store-section${storeSectionHasContent(loc) ? '' : ' is-empty'}">
      <div class="store-section-head">🏪 Store amenities</div>
      <div class="feature-summary"><div class="feature-badges" id="store-feature-summary-${loc.id}">${storeFeatureSummaryHtml(storeFeatureCache[loc.id], loc)}</div></div>
    </div>` : `<div class="popup-signin-hint">🔒 Sign in to rate this bathroom and see visitor tips.</div>`}
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
      const data = await fetchCommunityDoc(loc.id);
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
    safeAttach(attachAmenityHandlers);
    safeAttach(attachStoreFeatureHandlers);
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
      }catch(e){ /* user cancelled the share sheet — no action needed */ }
    } else if(navigator.clipboard){
      try{
        await navigator.clipboard.writeText(url);
        newBtn.textContent = '✅';
        setTimeout(() => { newBtn.textContent = '🔗'; }, 2000);
      }catch(e){ /* clipboard blocked — nothing we can do silently */ }
    }
  });
}

// Report a wrong/closed/incorrect pin — logs to Firestore (visible in FlushPanel) AND opens an email
async function logReport(loc, reason){
  try{
    const {db, collection, addDoc} = await fb();
    const chainKey = loc.chain || DEFAULT_CHAIN_KEY;
    // Capture enough to identify and fix the exact stop from FlushPanel — including
    // coordinates, which pin down the location even when the street address is blank
    // (many imported stops have no address yet). None of these are moderator-only
    // fields, so the write still satisfies the reports create rules.
    await addDoc(collection(db, 'reports'), {
      locId: loc.id,
      locName: loc.n,
      addr: loc.addr || null,
      chainKey: chainKey,
      chain: (CHAIN_REGISTRY[chainKey] || {}).name || chainKey,
      storeNumber: (loc.storeNumber ?? loc.num) ?? null,
      city: (loc.city ?? (loc.address && loc.address.city)) ?? null,
      state: (loc.state ?? (loc.address && loc.address.state)) ?? null,
      lat: loc.lat,
      lng: loc.lng,
      reporterId: (window.__currentUser && window.__currentUser.uid) || getClientId(),
      reason: reason,
      ts: Date.now()
    });
    return true;
  }catch(e){
    return false;
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
    const sent = await logReport(loc, reason);
    if(note){
      note.style.color = sent ? '#2f6b3c' : '#c62828';
      note.textContent = sent ? 'Report sent — thank you!' : "Couldn't send — check your connection and try again.";
    }
    if(sent){ newCats.style.display='none'; if(otherRow) otherRow.style.display='none'; }
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
    setNote("Checking you're nearby…");
    const v = await verifyNearby(loc);
    if(!v.ok){ setNote('📍 You need to be at this stop to do that.', true); return; }
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
      const stepReset = document.getElementById('amenity-step-' + loc.id);
      if(stepReset) stepReset.innerHTML = renderAmenityStepHtml(myVoteCache[loc.id], loc.id);
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
    if(note){ note.style.color=''; note.textContent = "Checking you're nearby…"; }

    const verification = await verifyNearby(loc);
    if(!verification.ok){
      if(note){ note.style.color = '#c62828'; note.textContent = "📍 You need to be at this stop to report its features."; }
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
      if(prevAns === 'yes' && cell.yes > 0) cell.yes--;
      if(prevAns === 'no'  && cell.no  > 0) cell.no--;
      if(value === 'yes') cell.yes++;
      if(value === 'no')  cell.no++;
    }
    myVoteCache[loc.id] = updatedVote;

    const ok = await saveMyVote(loc.id, updatedVote);
    if(!ok){
      if(note){ note.style.color = '#c62828'; note.textContent = 'Could not save — try again.'; }
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
      const freshStore = await loadStoreFeatureSummary(loc.id);
      const storeEl = document.getElementById('store-feature-summary-' + loc.id);
      if(storeEl){
        storeEl.innerHTML = storeFeatureSummaryHtml(freshStore, loc);
        const section = storeEl.closest('.store-section');
        if(section) section.classList.toggle('is-empty', !storeEl.querySelector('.feature-badge:not(.unconfirmed)'));
      }
    }
    refreshCommunityBlock(loc);   // a just-cast vote may have crossed the confirm threshold
  });
}

async function attachStoreFeatureHandlers(loc){
  const summaryEl=document.getElementById('store-feature-summary-'+loc.id);
  const summary=await loadStoreFeatureSummary(loc.id);
  if(summaryEl){
    summaryEl.innerHTML=storeFeatureSummaryHtml(summary, loc);
    refreshCommunityBlock(loc);
    // Collapse the whole "🏪 Store" section when nothing is confirmed or verified, so an empty
    // section never shows a lonely header.
    const section = summaryEl.closest('.store-section');
    if(section){
      const hasReal = summaryEl.querySelector('.feature-badge:not(.unconfirmed)');
      section.classList.toggle('is-empty', !hasReal);
    }
  }

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
    if(note){ note.style.color=''; note.textContent = "Checking you're nearby…"; }

    const verification = await verifyNearby(loc);
    if(!verification.ok){
      if(note){ note.style.color = '#c62828'; note.textContent = "📍 You need to be at this stop to report its features."; }
      allBtns.forEach(b => b.disabled = false);
      return;
    }

    const myVote = myVoteCache[loc.id] || emptyVote();
    const storeFeatures = { ...(myVote.storeFeatures || {}), [key]: value };
    const updatedVote = { ...myVote, storeFeatures };
    myVoteCache[loc.id] = updatedVote;

    const ok = await saveMyVote(loc.id, updatedVote);
    if(!ok){
      if(note){ note.style.color = '#c62828'; note.textContent = 'Could not save — try again.'; }
      allBtns.forEach(b => b.disabled = false);
      return;
    }

    if(note) note.textContent = '';
    if(navigator.vibrate) navigator.vibrate(10);

    stepEl.innerHTML = renderStoreFeatureStepHtml(updatedVote);

    const fresh = await loadStoreFeatureSummary(loc.id);
    if(summaryEl) summaryEl.innerHTML = storeFeatureSummaryHtml(fresh, loc);
  });
}

async function loadAllRatings(){
  // Loads only THIS user's own votes (a handful of docs). Community ratings are NOT bulk-read
  // anymore — that was thousands of reads on every load and after every auth change. Each
  // location's aggregate now loads on demand when its popup opens (one getDoc per open).
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
        const uname = (window.__currentUser && window.__currentUser.email) ? window.__currentUser.email.split('@')[0] : '';
        try{ await setDoc(doc(db, 'users', uid), { uid, username: uname, lastUpdated: Date.now(), ratings }, { merge: true }); }catch(e){}
      }
    }
  }catch(e){ console.error('my ratings load failed', e); }

  seedLocations.forEach(loc => {
    const agg = ratingsCache[loc.id] || emptyAgg();
    const myVote = voteByLoc[loc.id] || emptyVote();
    ratingsCache[loc.id] = agg;
    myVoteCache[loc.id] = myVote;
    loadedIds.add(loc.id);
    const marker = markers[loc.id];
    if(marker){
      // Never swap the icon out from under a currently-open popup — replacing the marker's
      // underlying DOM element while its popup is open is a known way to silently break/close
      // that popup on some browsers (this was very likely the cause of pins "showing briefly
      // and disappearing" on Android). Content updates are safe; icon updates wait until closed.
      if(!marker.isPopupOpen()){
        marker.setIcon(makeIcon(loc.id));
      }
      marker.setPopupContent(popupHtml(loc, agg, myVote));
      if(marker.isPopupOpen()) attachStarHandlers(loc);
    }
  });
  updateMostRecentBadge();
  updateMyProgressBadge();
  checkAndUnlockAchievements();
  maybeShowSupportPrompt();
  map.invalidateSize(); // header height just changed (badges filled in) — tell Leaflet to recalculate
}

// ============================================================
// Achievements & Bathroom Passport
// ============================================================
// Lighthearted, no XP, levels, or streaks — just simple unlockable badges computed
// from data we already have (ratings + check-ins). Unlock records are stored per-identity
// (account UID if logged in, else this device's anonymous ID — consistent with how the rest
// of the app already treats identity) in a new 'achievements' Firestore collection, so this
// works immediately even signed-out, and syncs across devices once you log in.

const ACHIEVEMENT_DEFS = [
  { key:'firstFlush', icon:'🚽', name:'First Flush', desc:'Rate your first bathroom',
    calc:s=>({done:s.bathroomRatedCount>=1,current:Math.min(s.bathroomRatedCount,1),total:1})},
  { key:'gettingStarted', icon:'🧻', name:'Getting Started', desc:'Rate 10 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=10,current:Math.min(s.bathroomRatedCount,10),total:10})},
  { key:'regular', icon:'🚻', name:'Regular', desc:'Rate 25 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=25,current:Math.min(s.bathroomRatedCount,25),total:25})},
  { key:'halfCentury', icon:'🎯', name:'Half Century', desc:'Rate 50 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=50,current:Math.min(s.bathroomRatedCount,50),total:50})},
  { key:'centuryClub', icon:'💯', name:'Century Club', desc:'Rate 100 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=100,current:Math.min(s.bathroomRatedCount,100),total:100})},
  { key:'explorerElite', icon:'🎓', name:'Explorer Elite', desc:'Rate 250 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=250,current:Math.min(s.bathroomRatedCount,250),total:250})},
  { key:'bathroomLegend', icon:'👑', name:'Bathroom Legend', desc:'Rate 500 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=500,current:Math.min(s.bathroomRatedCount,500),total:500})},
  { key:'hallOfFame', icon:'🏆', name:'Hall of Fame', desc:'Rate 1,000 bathrooms',
    calc:s=>({done:s.bathroomRatedCount>=1000,current:Math.min(s.bathroomRatedCount,1000),total:1000})},
  { key:'chainExplorer', icon:'🏪', name:'Chain Explorer', desc:'Rate at least one of every chain on the map',
    calc:s=>({done:s.totalChains>0&&s.chainCount>=s.totalChains,current:s.chainCount,total:s.totalChains||1})},
  { key:'brandLoyalist', icon:'🏷️', name:'Brand Loyalist', desc:'Rate 10 locations of a single chain',
    calc:s=>({done:s.maxOneChain>=10,current:Math.min(s.maxOneChain,10),total:10})},
  { key:'brandDevotee', icon:'🎖️', name:'Brand Devotee', desc:'Rate 25 locations of a single chain',
    calc:s=>({done:s.maxOneChain>=25,current:Math.min(s.maxOneChain,25),total:25})},
  { key:'truckStopHero', icon:'🚛', name:'Truck Stop Hero', desc:"Rate 25 travel-center stops (Pilot Flying J, Love's, Buc-ee's)",
    calc:s=>({done:s.travelPlazaCount>=25,current:Math.min(s.travelPlazaCount,25),total:25})},
  { key:'hiddenGemHunter', icon:'💎', name:'Hidden Gem Hunter', desc:'Rate a spot that had fewer than 5 reviews',
    calc:s=>({done:s.hiddenGemCount>=1,current:Math.min(s.hiddenGemCount,1),total:1})},
  { key:'gemCollector', icon:'💠', name:'Gem Collector', desc:'Rate 5 hidden gems',
    calc:s=>({done:s.hiddenGemCount>=5,current:Math.min(s.hiddenGemCount,5),total:5})},
  { key:'cityHopper', icon:'🌆', name:'City Hopper', desc:'Rate bathrooms in 15 different cities',
    calc:s=>({done:s.cityCount>=15,current:Math.min(s.cityCount,15),total:15})},
  { key:'roadWarrior', icon:'🛣️', name:'Road Warrior', desc:'Rate bathrooms in 10 different states',
    calc:s=>({done:s.stateCount>=10,current:Math.min(s.stateCount,10),total:10})},
  { key:'nationwide', icon:'🗺️', name:'Nationwide', desc:'Rate bathrooms in 25 different states',
    calc:s=>({done:s.stateCount>=25,current:Math.min(s.stateCount,25),total:25})},
  { key:'crossCountry', icon:'🧭', name:'Cross-Country', desc:'Rate two bathrooms 1,000+ miles apart',
    calc:s=>({done:s.maxMilesApart>=1000,current:Math.min(Math.round(s.maxMilesApart),1000),total:1000})},
  { key:'transcontinental', icon:'🌎', name:'Transcontinental', desc:'Rate two bathrooms 2,500+ miles apart',
    calc:s=>({done:s.maxMilesApart>=2500,current:Math.min(Math.round(s.maxMilesApart),2500),total:2500})},
  { key:'marathon', icon:'🏃', name:'Marathon', desc:'Rate 5 bathrooms in a single day',
    calc:s=>({done:s.maxInOneDay>=5,current:Math.min(s.maxInOneDay,5),total:5})},
  { key:'streak', icon:'🔥', name:'Streak', desc:'Rate 3 days in a row',
    calc:s=>({done:s.maxStreak>=3,current:Math.min(s.maxStreak,3),total:3})},
  { key:'onFire', icon:'⚡', name:'On Fire', desc:'Rate 7 days in a row',
    calc:s=>({done:s.maxStreak>=7,current:Math.min(s.maxStreak,7),total:7})},
  { key:'weekendWarrior', icon:'📅', name:'Weekend Warrior', desc:'Rate on 5 weekend days',
    calc:s=>({done:s.weekendCount>=5,current:Math.min(s.weekendCount,5),total:5})},
  { key:'earlyBird', icon:'☀️', name:'Early Bird', desc:'Rate before 5:00 AM',
    calc:s=>({done:s.hasEarlyBird,current:s.hasEarlyBird?1:0,total:1})},
  { key:'nightOwl', icon:'🌙', name:'Night Owl', desc:'Rate between midnight and 4:00 AM',
    calc:s=>({done:s.hasNightOwl,current:s.hasNightOwl?1:0,total:1})},
  { key:'accessibilityScout', icon:'♿', name:'Accessibility Scout', desc:'Answer the accessibility question at 10 stops',
    calc:s=>({done:s.accessibleAnsweredCount>=10,current:Math.min(s.accessibleAnsweredCount,10),total:10})},
  // ---- Hidden trophies (masked until unlocked) ----
  { key:'critic', icon:'⭐', name:'Critic', desc:'Give a 5-star rating', hidden:true,
    calc:s=>({done:s.fiveStarCount>=1,current:Math.min(s.fiveStarCount,1),total:1})},
  { key:'perfectionist', icon:'✨', name:'Perfectionist', desc:'Give ten 5-star ratings', hidden:true,
    calc:s=>({done:s.fiveStarCount>=10,current:Math.min(s.fiveStarCount,10),total:10})},
  { key:'cleanFreak', icon:'🧼', name:'Clean Freak', desc:'Give twenty-five 5-star ratings', hidden:true,
    calc:s=>({done:s.fiveStarCount>=25,current:Math.min(s.fiveStarCount,25),total:25})},
  { key:'toughCrowd', icon:'💢', name:'Tough Crowd', desc:'Give a 1-star rating', hidden:true,
    calc:s=>({done:s.oneStarCount>=1,current:Math.min(s.oneStarCount,1),total:1})},
  { key:'ironStomach', icon:'👃', name:'Iron Stomach', desc:'Give twenty-five 1-star ratings', hidden:true,
    calc:s=>({done:s.oneStarCount>=25,current:Math.min(s.oneStarCount,25),total:25})},
  { key:'winterWarrior', icon:'❄️', name:'Winter Warrior', desc:'Rate a bathroom in December–February', hidden:true,
    calc:s=>({done:s.hasWinter,current:s.hasWinter?1:0,total:1})},
  { key:'summerRoadTrip', icon:'🌞', name:'Summer Road Trip', desc:'Rate a bathroom in June–August', hidden:true,
    calc:s=>({done:s.hasSummer,current:s.hasSummer?1:0,total:1})},
  { key:'vacationMode', icon:'🧳', name:'Vacation Mode', desc:'Rate bathrooms in 5 states within one week', hidden:true,
    calc:s=>({done:s.maxStatesIn7Days>=5,current:Math.min(s.maxStatesIn7Days,5),total:5})}
];

// We don't have real county data in locations.js, only addresses — so "County Collector"
// uses the city pulled from each address as a rough stand-in for "different areas visited"
// rather than an actual county. Swap this out if/when real county data gets added.
function getCityFromAddress(addr){
  if(!addr) return 'Unknown';
  const parts = addr.split(',').map(p => p.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
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
  const rated = [];
  Object.keys(myVoteCache).forEach(id => {
    const v = myVoteCache[id];
    if(!v || !(v.bathroom > 0)) return;
    const loc = seedLocations.find(l => l.id === id);
    if(!loc) return;
    rated.push({ loc, bathroom: v.bathroom, ratedAt: v.ratedAt || null, wasHiddenGem: !!v.wasHiddenGem });
  });

  const bathroomRatedCount = rated.length;
  const fiveStarCount = rated.filter(r => r.bathroom === 5).length;
  const oneStarCount  = rated.filter(r => r.bathroom === 1).length;
  const hiddenGemCount = rated.filter(r => r.wasHiddenGem).length;

  const states = new Set(), cities = new Set(), chainCounts = {};
  rated.forEach(r => {
    const st = stateFromAddr(r.loc.addr); if(st) states.add(st);
    cities.add(getCityFromAddress(r.loc.addr));
    const ck = r.loc.chain || DEFAULT_CHAIN_KEY;
    chainCounts[ck] = (chainCounts[ck] || 0) + 1;
  });
  const maxOneChain = Object.values(chainCounts).reduce((m,n)=>Math.max(m,n), 0);

  let hasEarlyBird=false, hasNightOwl=false, hasWinter=false, hasSummer=false;
  const weekendDays = new Set(), dayCounts = {}, dayKeys = new Set();
  rated.forEach(r => {
    if(!r.ratedAt) return;                       // time-based stats need a ratedAt timestamp
    const d = new Date(r.ratedAt), h = d.getHours(), dow = d.getDay(), key = d.toDateString(), mo = d.getMonth();
    if(h < 5) hasEarlyBird = true;
    if(h >= 0 && h < 4) hasNightOwl = true;
    if(mo === 11 || mo === 0 || mo === 1) hasWinter = true;   // Dec–Feb
    if(mo >= 5 && mo <= 7) hasSummer = true;                   // Jun–Aug
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

  // Truck Stop Hero — ratings at the big interstate travel-center chains.
  const TRAVEL_CENTER_CHAINS = new Set(['pilotFlyingJ','loves','bucees']);
  const travelPlazaCount = rated.filter(r => TRAVEL_CENTER_CHAINS.has(r.loc.chain)).length;

  // Vacation Mode — most distinct states rated within any single 7-day window.
  const stateDated = rated
    .filter(r => r.ratedAt && stateFromAddr(r.loc.addr))
    .map(r => ({ t: r.ratedAt, st: stateFromAddr(r.loc.addr) }))
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
    travelPlazaCount, maxStatesIn7Days,
    maxInOneDay, maxStreak: longestConsecutiveDayStreak(dayKeys), maxMilesApart,
    visitedCount: bathroomRatedCount, totalLocations: seedLocations.length
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

    results[def.key] = { ...def, unlocked: calc.done, unlockedAt: calc.done ? unlockedAt : null, current: calc.current, total: calc.total };
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

  container.innerHTML = `
    <div class="passport-stat-line">${stats.visitedCount} / ${stats.totalLocations} Shops visited — ${pct}% complete</div>
    <div class="passport-progress-bar"><div class="passport-progress-fill" style="width:${Math.min(100,pct)}%;"></div></div>
    <div class="passport-mini-stats">
      <div>🚻 ${stats.bathroomRatedCount} bathrooms reviewed</div>
      <div>🏆 ${unlockedCount} / ${ACHIEVEMENT_DEFS.length} achievements unlocked</div>
    </div>
  `;

  const listEl = document.getElementById('achievementsList');
  if(listEl){
    listEl.innerHTML = ACHIEVEMENT_DEFS.map(def => {
      const r = results[def.key];
      const secret = def.hidden && !r.unlocked;   // hidden trophy, not yet earned → mask its details
      const icon = secret ? '❓' : def.icon;
      const name = secret ? 'Hidden Trophy' : def.name;
      const desc = secret ? 'Keep exploring to reveal this one.' : def.desc;
      const dateStr = r.unlockedAt ? new Date(r.unlockedAt).toLocaleDateString() : null;
      const progressStr = (!secret && !r.unlocked && r.total > 1) ? `${r.current} / ${r.total}` : '';
      return `<div class="achievement-card ${r.unlocked ? 'unlocked' : 'locked'}${secret ? ' hidden-trophy' : ''}">
        <div class="achievement-icon">${icon}</div>
        <div class="achievement-info">
          <div class="achievement-name">${name}</div>
          <div class="achievement-desc">${desc}</div>
          ${r.unlocked
            ? `<div class="achievement-date">Unlocked ${dateStr}</div>`
            : (progressStr ? `<div class="achievement-progress">${progressStr}</div>` : '')}
        </div>
      </div>`;
    }).join('');
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
  _mostRecentLoaded = true;
  try{
    const {db, collection, query, where, orderBy, limit, getDocs} = await fb();
    const snap = await getDocs(query(
      collection(db, 'activity'),
      where('type', '==', 'rating'),
      orderBy('ts', 'desc'),
      limit(1)
    ));
    let rec = null;
    snap.forEach(d => rec = d.data());
    if(!rec || !rec.locId){ el.textContent = ''; refreshStatTicker(); return; }
    const loc = locationsById[rec.locId];
    const name = (loc && loc.n) || 'a bathroom';
    el.textContent = `🕐 Most recently rated: ${name} — ${relativeTimeFromNow(rec.ts)}`;
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

// Verified visit — requires being physically near a location before rating it
const VERIFY_RADIUS_MILES = 0.3;

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
const oooCache = {};
async function loadOoo(locId){
  try{
    const {db, collection, query, where, getDocs} = await fb();
    const snap = await getDocs(query(collection(db, 'outOfOrder'), where('locId', '==', locId)));
    const reports = [];
    let clearedAfter = 0;
    snap.forEach(d => {
      const r = d.data();
      if(r.cleared){ if(r.ts > clearedAfter) clearedAfter = r.ts; }
      else reports.push(r.ts);
    });
    // Drop any report at/older than the most recent "it's working now" — that tap ends the cycle.
    const live = reports.filter(t => t > clearedAfter);
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

function getVerifiedPosition(){
  const now = Date.now();
  if(lastKnownPos && (now - lastKnownPos.ts) < 5 * 60 * 1000){
    return Promise.resolve(lastKnownPos);
  }
  return new Promise((resolve) => {
    if(!navigator.geolocation){ resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lastKnownPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() };
        maybeAutoSetTravelMode(lastKnownPos.lat, lastKnownPos.lng);
        resolve(lastKnownPos);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

async function verifyNearby(loc){
  const pos = await getVerifiedPosition();
  if(!pos) return { ok: false, reason: 'no-location' };
  const dist = milesBetween(pos.lat, pos.lng, loc.lat, loc.lng);
  return { ok: dist <= VERIFY_RADIUS_MILES, distance: dist };
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

        const verification = await verifyNearby(loc);
        if(!verification.ok){
          const msg = verification.reason === 'no-location'
            ? '📍 Enable location to verify you\'re at this Bathroom before rating.'
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
        if(type === 'bathroom' && prevVal === 0 && (agg.bathroomCount || 0) < 5){
          myVote.wasHiddenGem = true;
        }

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
        if(okVote) logActivity('rating', { sourceId: loc.id + '_' + getEffectiveId(), locId: loc.id });
        if(note) note.textContent = okVote ? 'Saved ✓ — visible to everyone' : 'Save failed';
        if(okVote) maybeShowSupportPrompt();

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
    listEl.innerHTML = '<li style="color:#999;">No tips yet — be the first!</li>';
    return;
  }
  listEl.innerHTML = tips.map(t => `<li>💡 ${escapeHtml(t)}</li>`).join('');
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function attachTipHandlers(loc){
  const listEl = document.getElementById('tips-list-' + loc.id);
  const inputEl = document.getElementById('tip-input-' + loc.id);
  const submitEl = document.getElementById('tip-submit-' + loc.id);
  if(!listEl || !inputEl || !submitEl) return;

  // Load existing tips fresh each time the popup opens
  const tips = await loadTips(loc.id);
  renderTipsList(loc, tips);

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
loadAllRatings();
// loadOverrides();  // DISABLED to cut Firestore reads — admin fixes are now baked into the
//                   *-locations.js files (weekly, via fetch-and-bake.js) instead of read live
//                   from the overrides collection on every load. Re-enable this call to
//                   restore instant live overrides.
// loadWeeklyRecap();  // disabled — its stat pill is hidden in the redesign (was wasting reads/load)

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

// Onboarding overlay — the quick welcome/tour. Shown once per device on first run, and
// re-openable anytime via the header ℹ️ button. The road/foot choice appears only when a metro
// layer exists; otherwise it stays hidden and onboarding is unchanged.
function openOnboarding(){
  const ov = document.getElementById('onboardingOverlay');
  if(ov) ov.classList.add('show');
  const mode = document.getElementById('onboardingMode');
  if(!mode) return;
  if(metroKeys().length > 0){
    mode.style.display = '';
    // Read the stored value directly (travelMode the variable may not be initialized this early).
    const cur = localStorage.getItem('travelMode') === 'foot' ? 'foot' : 'road';
    mode.querySelectorAll('.onboardingModeBtn').forEach(b =>
      b.classList.toggle('selected', b.dataset.mode === cur));
  } else {
    mode.style.display = 'none';
  }
}
// First run: show it once per device.
if(localStorage.getItem('onboardingSeen') !== '1') openOnboarding();
// Header ℹ️ button re-opens the tour anytime.
document.getElementById('onboardingInfoBtn')?.addEventListener('click', openOnboarding);
document.getElementById('onboardingClose').addEventListener('click', () => {
  localStorage.setItem('onboardingSeen', '1');
  document.getElementById('onboardingOverlay').classList.remove('show');
});
// Onboarding road/foot choice — sets the travel mode's starting state (later refined by location).
document.querySelectorAll('.onboardingModeBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    travelMode = (btn.dataset.mode === 'foot') ? 'foot' : 'road';
    saveTravelMode();
    saveTravelModeToAccount();
    localStorage.setItem('travelModeChosen', '1');
    document.querySelectorAll('.onboardingModeBtn').forEach(b => b.classList.toggle('selected', b === btn));
    renderLayers();
    applyFilters();
  });
});
// ("How it works" opens the info page — wired in index.html's chrome script)

// If this page was opened via a shared link (?loc=xyz), jump straight to that pin
(function(){
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get('loc');
  if(!targetId) return;
  const target = seedLocations.find(l => l.id === targetId);
  if(target && markers[targetId]){
    zoomToMarker(markers[targetId]);
  }
})();

// Resize every pin whenever the zoom level changes
let lastMetroZoomOk = null;
map.on('zoomend', () => {
  seedLocations.forEach(loc => {
    const m = markers[loc.id];
    if(!m) return;
    if(m.isPopupOpen()) resizeOpenMarkerIcon(m); // resize in place; never swap icon on an open popup
    else m.setIcon(makeIcon(loc.id));
  });
  // Metro zoom gate: only re-run the membership filter when crossing the threshold, not on
  // every zoom step — applyFilters iterates all markers, so this keeps zooming cheap.
  const metroZoomOk = map.getZoom() >= METRO_MIN_ZOOM;
  if(metroZoomOk !== lastMetroZoomOk){
    lastMetroZoomOk = metroZoomOk;
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

// Open-now calculation — effective hours string is "24", "HHMM-HHMM", "closed", or unknown.
// Locations with no known hours are "unknown" and are never hidden by the open-now filter.
// Computed in the visitor's local time; stores show their own local hours, which is fine
// for a regionally-focused map.
function isLocationOpenNow(loc){
  const hrs = todayHrsString(loc);
  if(!hrs) return null; // unknown — we don't have hours data for this one yet
  if(hrs === 'closed') return false;
  if(hrs === '24') return true;
  const parts = hrs.split('-');
  if(parts.length !== 2) return null;
  const open = parseInt(parts[0], 10);
  const close = parseInt(parts[1], 10);
  if(isNaN(open) || isNaN(close)) return null;
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
  const no = (loc.confNo && loc.confNo.accessible)        // community-confirmed no
    || (loc.osm && loc.osm.accessibleNo)                  // OSM wheelchair=no
    || loc.wheelchair === 'no';                           // legacy baked no
  return !!no;
}

// How far beyond the visible map edges to still render pins, as a fraction of the
// viewport, so a small pan doesn't leave blank areas while new pins load in.
const MARKER_VIEWPORT_PAD = 0.3;

function applyFilters(){
  // Filter the actual marker instances rather than looking them up again by location ID.
  // This prevents stray pins when imported data has duplicate IDs or a marker lookup is
  // overwritten: every marker that was created is always evaluated and removed as needed.
  //
  // A pin is shown only when it passes the chain + open-now filters AND is inside the
  // padded viewport. Off-screen pins stay out of the DOM, which is what keeps the map fast
  // with thousands of locations loaded. A pin whose popup is currently open is always kept
  // (e.g. a Bathroom Now / list result centered on a pin that a filter would otherwise hide)
  // so opening it never immediately closes it on the resulting map move.
  // Clustering owns viewport culling now (removeOutsideVisibleBounds), so applyFilters only
  // decides membership by the chain / open-now / accessible filters — no bounds check here. A pin
  // with an open popup is always kept so opening it never immediately removes it.
  allLocationMarkers.forEach(m => {
    const loc = m.locationData;
    if(!loc) return;
    const openOk = showAllLocations || isLocationOpenNow(loc) !== false; // hide only confirmed-closed; unknown stays visible
    const accessOk = !hideInaccessible || !isConfirmedNotAccessible(loc); // hide only confirmed-inaccessible; unknown stays visible
    const chainOk = activeChains.has(m.chainKey || DEFAULT_CHAIN_KEY);
    // Modes: "On the road" shows EVERYTHING; "On foot" shows ONLY metro/city locations.
    // Metro pins are additionally zoom-gated (>= METRO_MIN_ZOOM) in any mode so a zoomed-out
    // map never floods with dense city pins.
    const isMetroLoc = groupOf(m.chainKey || DEFAULT_CHAIN_KEY) === 'metro';
    const zoomOk = !isMetroLoc || map.getZoom() >= METRO_MIN_ZOOM;
    const modeOk = travelMode === 'foot' ? isMetroLoc : true;
    const layerOk = zoomOk && modeOk;
    const popupOpen = m.isPopupOpen && m.isPopupOpen();
    if((openOk && accessOk && chainOk && layerOk) || popupOpen){
      if(!markerCluster.hasLayer(m)) markerCluster.addLayer(m);
    } else {
      if(markerCluster.hasLayer(m)) markerCluster.removeLayer(m);
    }
  });
}

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

// The one city whose options show in the Metros tree. Picked via the jump pills (or auto-set
// from location); other cities' pins/checkbox states are untouched, just not shown.
let selectedMetro = localStorage.getItem('selectedMetro') || null;
function setSelectedMetro(city, manual){
  selectedMetro = city;
  if(manual) localStorage.setItem('selectedMetro', city);
}

// Metro boundaries for location auto-detect. Each entry is a bounding box for a covered metro
// AREA (use the metro area, not just city limits). Empty until a metro is added with its bounds,
// so auto-detect is inert today. A polygon test can replace the bbox later if more precision is
// needed.
const METRO_BOUNDS = {
  NYC: { minLat: 40.49, maxLat: 40.92, minLng: -74.27, maxLng: -73.68 },
};
function insideAnyMetro(lat, lng){
  return metroAt(lat, lng) !== null;
}
// Which covered metro (if any) contains this point — returns the city name or null.
function metroAt(lat, lng){
  for(const city of Object.keys(METRO_BOUNDS)){
    const b = METRO_BOUNDS[city];
    if(lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) return city;
  }
  return null;
}
// Auto-set travel mode from location: when the user is inside a covered metro and hasn't chosen a
// mode themselves, switch to "on foot" (which adds the city layer on top of pit stops — nothing
// disappears). Runs at most once per session, never overrides a manual choice, and never
// force-reverts to road when they leave. It only sets the starting state, as agreed.
let autoModeApplied = false;
function maybeAutoSetTravelMode(lat, lng){
  if(metroKeys().length === 0) return;                          // no city layer exists yet
  const city = metroAt(lat, lng);
  if(!city) return;                                             // only act inside a covered metro
  // Auto-select the metro you're standing in so the drawer's tree and pill match your city.
  // A manually pinned city (tapped pill, saved to localStorage) always wins over location.
  if(!localStorage.getItem('selectedMetro') && selectedMetro !== city){
    setSelectedMetro(city, false);
    renderLayers();
  }
  if(autoModeApplied) return;
  if(localStorage.getItem('travelModeChosen') === '1') return; // user already chose — respect it
  autoModeApplied = true;
  if(travelMode !== 'foot'){
    travelMode = 'foot';
    saveTravelMode();
    renderLayers();
    applyFilters();
  }
}

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

// Shared with List: does the travel mode allow this location right now?
// "On the road" allows everything; "On foot" allows only metro/city locations.
function modeAllows(loc){
  return travelMode === 'foot' ? groupOf(loc.chain || DEFAULT_CHAIN_KEY) === 'metro' : true;
}

function getActiveChains(){
  // Chain filtering is a signed-in feature. Logged-out users always see every chain
  // (the saved disable list is ignored until they log in), so nothing is hidden by default.
  if(!isLoggedIn()) return new Set(Object.keys(CHAIN_REGISTRY));
  return new Set(Object.keys(CHAIN_REGISTRY).filter(k => !disabledChains.has(k)));
}
let activeChains = getActiveChains();

// Re-apply chain visibility whenever auth state changes: recompute the active set, refresh the
// filter checkboxes, show the control only when signed in, and repaint the map. Called from
// updateAccountUI() (which fires on every login/logout).
function syncChainFilterToAuth(){
  activeChains = getActiveChains();
  renderChainFilter();
  renderLayers();
  const cf = document.getElementById('chainFilter');
  if(cf){
    const multiChain = Object.keys(CHAIN_REGISTRY).length >= 2;
    cf.style.display = (isLoggedIn() && multiChain && travelMode !== 'foot') ? '' : 'none';
  }
  if(typeof renderNavPref === 'function') renderNavPref();
  applyFilters();
}

function saveDisabledChains(){
  localStorage.setItem('disabledChains', JSON.stringify(Array.from(disabledChains)));
}

function renderChainFilter(){
  const wrap = document.getElementById('chainFilter');
  const body = document.getElementById('chainFilterBody');
  if(!wrap || !body) return;
  const chainKeys = Object.keys(CHAIN_REGISTRY).filter(k => (CHAIN_REGISTRY[k].group || 'pitstop') !== 'metro');
  if(chainKeys.length < 2){
    // Only one chain registered — nothing meaningful to filter, so hide the control entirely
    wrap.style.display = 'none';
    return;
  }
  const allOn = chainKeys.every(k => activeChains.has(k));
  const allBtn = `<button type="button" class="chain-all-btn" id="chainSelectAll"${allOn?' disabled':''}>${allOn?'✓ All chains shown':'Select all chains'}</button>`;
  body.innerHTML = allBtn + chainKeys.map(key => {
    const chain = CHAIN_REGISTRY[key];
    const checked = activeChains.has(key) ? 'checked' : '';
    return `<label class="chain-filter-row">
      <input type="checkbox" class="chain-filter-checkbox" data-chain="${key}" ${checked}>
      <span class="dot" style="background:${chain.color}"></span>${escapeHtml(chain.name)}
    </label>`;
  }).join('');
}

// "Select all chains" — re-enable every chain at once (clears the disable list).
document.getElementById('chainFilterBody')?.addEventListener('click', (e) => {
  if(!e.target.closest('#chainSelectAll')) return;
  disabledChains.clear();
  activeChains = getActiveChains();
  saveDisabledChains();
  renderChainFilter();
  applyFilters();
});

// Shared by the per-chain checkboxes (under Pitstops) and the per-city public/customer checkboxes
// (under Metros) — both are entries in CHAIN_REGISTRY toggled through the same disabledChains list.
function onSubLayerCheckboxChange(e){
  const cb = e.target.closest('.chain-filter-checkbox');
  if(!cb) return;
  const key = cb.dataset.chain;
  if(cb.checked) disabledChains.delete(key); else disabledChains.add(key);
  activeChains = getActiveChains();
  // Never allow every registered layer to be switched off at once — that would just blank the map
  if(activeChains.size === 0){
    disabledChains.delete(key);
    activeChains = getActiveChains();
    cb.checked = true;
  }
  saveDisabledChains();
  renderChainFilter();
  renderLayers();
  applyFilters();
}
document.getElementById('chainFilterBody')?.addEventListener('change', onSubLayerCheckboxChange);
document.getElementById('metroFilterBody')?.addEventListener('change', onSubLayerCheckboxChange);

// ---- Travel mode toggle (on the road / on foot) ------------------------------------------
// The one open control: shown to everyone, but only once a metro layer actually exists in the
// registry (group:'metro'). Until then the drawer is unchanged. 'road' = pit stops only; 'foot'
// = pit stops + city restrooms. The per-chain and per-city checkboxes below it stay a signed-in
// refinement (gated), same as the chain filter has always been.
function renderLayers(){
  const metros = metroKeys();
  const hasMetros = metros.length > 0;
  const modePref = document.getElementById('travelModePref');
  const mFilter = document.getElementById('metroFilter');
  if(modePref) modePref.style.display = hasMetros ? '' : 'none';
  // Drawer sections follow the mode: "On the road" shows the pit-stop Chains list; "On foot"
  // shows the city tree instead (pit stops are hidden on foot, so their filter would be noise).
  const cf = document.getElementById('chainFilter');
  if(cf) cf.style.display = (isLoggedIn() && Object.keys(CHAIN_REGISTRY).some(k => groupOf(k) !== 'metro') && travelMode !== 'foot') ? '' : 'none';
  // Metros section shows in BOTH modes (collapsed by default): road mode renders metro pins too,
  // so their toggles must stay reachable — kept as their own section rather than mixed into the
  // pit-stop Chains list, so the two layers stay legible.
  if(mFilter) mFilter.style.display = (hasMetros && isLoggedIn()) ? '' : 'none';
  if(!hasMetros) return;

  const sel = document.getElementById('travelModeSelect');
  if(sel && sel.value !== travelMode) sel.value = travelMode;

  // "On foot" shows city locations only — the pills both jump the map AND pick which city's
  // options appear in the Metros tree below (only the chosen city is shown, never all of them).
  const cov = document.getElementById('travelModeCoverage');
  const cities = [...new Set(metros.map(k => CHAIN_REGISTRY[k].metro || 'Other'))];
  if(!cities.includes(selectedMetro)) selectedMetro = cities[0];
  if(cov){
    if(travelMode === 'foot'){
      cov.innerHTML = `🏙️ Covered — tap to jump: ` +
        cities.map(c => `<button type="button" class="d-city-jump${c === selectedMetro ? ' sel' : ''}" data-city="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join(' ');
      cov.style.display = '';
    } else {
      cov.style.display = 'none';
    }
  }

  // City detail (per-metro public/customer checkboxes) — a signed-in refinement, gated like chains.
  const body = document.getElementById('metroFilterBody');
  if(!body) return;
  if(!isLoggedIn()){ body.innerHTML = ''; return; }
  const byCity = {};
  metros.forEach(k => {
    const c = CHAIN_REGISTRY[k];
    const city = c.metro || 'Other';
    (byCity[city] = byCity[city] || []).push(k);
  });
  // Only the selected city's options are listed — the pills above are the city switcher, so
  // no per-city group labels are needed here.
  const showKeys = byCity[selectedMetro] || [];
  body.innerHTML = `<div class="metro-city">` + showKeys.map(key => {
    const c = CHAIN_REGISTRY[key];
    const checked = activeChains.has(key) ? 'checked' : '';
    return `<label class="chain-filter-row">
      <input type="checkbox" class="chain-filter-checkbox" data-chain="${key}" ${checked}>
      <span class="dot" style="background:${c.color}"></span>${escapeHtml(c.name)}
    </label>`;
  }).join('') + `</div>`;
}

// Mode dropdown — everyone. Picks road ⟷ foot, which shows/hides the city layer.
// A manual pick counts as an explicit choice (auto-detect defers) and syncs to the account.
document.getElementById('travelModeSelect')?.addEventListener('change', (e) => {
  travelMode = (e.target.value === 'foot') ? 'foot' : 'road';
  localStorage.setItem('travelModeChosen', '1');
  saveTravelMode(); saveTravelModeToAccount(); renderLayers(); applyFilters();
});

// City jump: tapping a covered city centers the map there at street level and closes the drawer.
// Center comes from METRO_BOUNDS when defined, else the average of that metro's locations.
function metroCenter(city){
  const b = METRO_BOUNDS[city];
  if(b) return [(b.minLat + b.maxLat) / 2, (b.minLng + b.maxLng) / 2];
  const keys = metroKeys().filter(k => (CHAIN_REGISTRY[k].metro || 'Other') === city);
  const locs = seedLocations.filter(l => keys.includes(l.chain));
  if(!locs.length) return null;
  return [locs.reduce((s,l)=>s+l.lat,0)/locs.length, locs.reduce((s,l)=>s+l.lng,0)/locs.length];
}
document.getElementById('travelModeCoverage')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.d-city-jump');
  if(!btn) return;
  setSelectedMetro(btn.dataset.city, true);   // this city's options now fill the Metros tree
  renderLayers();
  const c = metroCenter(btn.dataset.city);
  if(!c) return;
  map.setView(c, Math.max(METRO_MIN_ZOOM + 1, 13), {animate: true});
  document.getElementById('drawerClose')?.click();
});

// Collapsible Metros panel — same remembered-collapse pattern as the Chains filter, so the
// city checkbox tree isn't permanently stuck open in the drawer.
(function(){
  const toggle = document.getElementById('metroFilterToggle');
  const body = document.getElementById('metroFilterBody');
  const arrow = document.getElementById('metroFilterArrow');
  if(!toggle || !body || !arrow) return;
  function setCollapsed(collapsed){
    body.classList.toggle('collapsed', collapsed);
    toggle.classList.toggle('collapsed-toggle', collapsed);
    arrow.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    localStorage.setItem('metroFilterCollapsed', collapsed ? '1' : '0');
  }
  const saved = localStorage.getItem('metroFilterCollapsed');
  setCollapsed(saved === null ? true : saved === '1'); // collapsed by default — expand on demand
  toggle.addEventListener('click', () => setCollapsed(!body.classList.contains('collapsed')));
})();

// Collapsible chain filter panel — same remembered-collapse pattern as the legend
(function(){
  const toggle = document.getElementById('chainFilterToggle');
  const body = document.getElementById('chainFilterBody');
  const arrow = document.getElementById('chainFilterArrow');
  if(!toggle || !body || !arrow) return;

  function setCollapsed(collapsed){
    body.classList.toggle('collapsed', collapsed);
    arrow.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    localStorage.setItem('chainFilterCollapsed', collapsed ? '1' : '0');
  }

  const saved = localStorage.getItem('chainFilterCollapsed');
  setCollapsed(saved === null ? false : saved === '1'); // expanded by default in the drawer

  toggle.addEventListener('click', () => {
    setCollapsed(!body.classList.contains('collapsed'));
  });
})();
renderChainFilter();
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
(function(){
  const t = document.getElementById('openNowToggle');
  if(!t) return;
  const sync = () => {
    const filtering = !showAllLocations;          // filtering = confirmed-closed hidden
    t.classList.toggle('active', filtering);
    t.setAttribute('aria-pressed', String(filtering));
    t.textContent = filtering ? '🚫 Hiding closed' : '👁 Showing all';
  };
  sync();
  t.addEventListener('click', () => {
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
  t.addEventListener('click', () => {
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
    .filter(loc => modeAllows(loc) && activeChains.has(loc.chain || DEFAULT_CHAIN_KEY))
    .map(loc => ({ loc, dist: milesBetween(currentListPosition.lat, currentListPosition.lng, loc.lat, loc.lng) }))
    .sort((a,b) => a.dist - b.dist)
    .slice(0, NEAREST_COUNT);

  document.getElementById('listViewHeader').querySelector('span').textContent = 'Closest bathrooms';
  container.innerHTML = nearest.map(({loc,dist}) => {
    const open = isLocationOpenNow(loc);
    const status = open===true ? '🟢 Open' : open===false ? '🔴 Closed' : '⚪ Hours unavailable';
    return `<div class="list-item" data-locid="${loc.id}"><div class="list-item-name">${loc.n}</div><div class="list-item-addr">${loc.addr}</div><div class="list-item-meta"><span>📍 ${dist.toFixed(1)} mi</span><span>${status}</span></div></div>`;
  }).join('');
}
document.getElementById('listViewToggle').addEventListener('click',()=>{buildListView();document.getElementById('listViewPanel').classList.add('show');document.body.classList.add('list-open');});
document.getElementById('listViewClose').addEventListener('click',()=>{document.getElementById('listViewPanel').classList.remove('show');document.body.classList.remove('list-open');suppressNextLocateClick=true;setTimeout(()=>{suppressNextLocateClick=false;},400);});

// Account panel
// Which view the shared panel is currently showing ('account' | 'passport'). Auth-state changes
// re-run updateAccountUI with no argument; defaulting to this keeps the current view intact.
let accountPanelMode = 'account';

function updateAccountUI(passportMode){
  if(passportMode === undefined) passportMode = (accountPanelMode === 'passport');
  const loggedIn = isLoggedIn();
  // In passport mode both auth sections stay hidden — the panel is showing the Passport view.
  if(passportMode){
    document.getElementById('loggedOutView').style.display = 'none';
    document.getElementById('loggedInView').style.display = 'none';
  } else {
    document.getElementById('loggedOutView').style.display = loggedIn ? 'none' : 'block';
    document.getElementById('loggedInView').style.display = loggedIn ? 'block' : 'none';
  }
  const _cb = document.getElementById('communityBanner');
  if(_cb) _cb.style.display = loggedIn ? 'none' : '';   // banner is logged-out only
  document.body.classList.toggle('logged-in', loggedIn);   // gates signed-in-only UI (theme toggle, etc.)
  syncChainFilterToAuth();                                  // logged-out shows all chains; logged-in restores the filter
  const accountBtn = document.getElementById('accountToggle');
  if(loggedIn){
    const email = window.__currentUser.email || '';
    const username = email.split('@')[0]; // never show the raw email/UID anywhere in the UI
    document.getElementById('loggedInUsername').textContent = username;
    if(accountBtn) accountBtn.textContent = '👤 ' + username;
  } else if(accountBtn){
    accountBtn.textContent = '👤 Log In';
  }
  const syncNote = document.getElementById('passportSyncNote');
  if(syncNote) syncNote.style.display = loggedIn ? 'none' : 'block';
}

// The account panel doubles as the Passport panel — but as two distinct VIEWS, not one long
// scroll. Opening via 👤 shows only the auth section; opening via 🎫 shows only the
// Passport/achievements (with the sign-in nudge handled by passportSyncNote when logged out).
function openAccountPanel(mode){
  accountPanelMode = mode === 'passport' ? 'passport' : 'account';
  const panel = document.getElementById('accountPanel');
  panel.classList.add('show');
  const isPassport = mode === 'passport';
  const title = document.querySelector('#accountHeader span');
  if(title) title.textContent = isPassport ? '🎫 Bathroom Passport' : '👤 Account';
  const loggedOut = document.getElementById('loggedOutView');
  const loggedIn = document.getElementById('loggedInView');
  const passport = document.getElementById('passportSection');
  if(passport) passport.style.display = isPassport ? '' : 'none';
  // Auth sections: shown in account mode (updateAccountUI decides which of the two), hidden in
  // passport mode. Inline '' lets updateAccountUI's own display logic take over in account mode.
  if(loggedOut) loggedOut.style.display = isPassport ? 'none' : '';
  if(loggedIn) loggedIn.style.display = isPassport ? 'none' : '';
  updateAccountUI(isPassport);
  checkAndUnlockAchievements();
  if(isPassport){
    loadLeaderboard();
    requestAnimationFrame(() => {
      const p = document.getElementById('passportSection');
      if(p) p.scrollIntoView({ block: 'start' });
    });
  }
}

document.getElementById('passportToggle').addEventListener('click', () => openAccountPanel('passport'));

document.getElementById('accountToggle').addEventListener('click', () => openAccountPanel('account'));

document.getElementById('accountClose').addEventListener('click', () => {
  document.getElementById('accountPanel').classList.remove('show');
  suppressNextLocateClick = true;
  setTimeout(() => { suppressNextLocateClick = false; }, 400);
});

document.getElementById('authSignUpBtn').addEventListener('click', async () => {
  const username = document.getElementById('authUsername').value;
  const password = document.getElementById('authPassword').value;
  const note = document.getElementById('authNote');
  const btn = document.getElementById('authSignUpBtn');
  btn.disabled = true;
  note.style.color = '#999';
  note.textContent = 'Creating your account...';
  const result = await signUpAccount(username, password);
  if(result.ok){
    note.style.color = '#4caf50';
    note.textContent = 'Account created! You\'re logged in.';
    updateAccountUI();
    loadAllRatings();
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
  } else {
    note.style.color = '#e57373';
    note.textContent = result.reason;
  }
  btn.disabled = false;
});

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

// Bathroom Now — choose the best nearby open store by actual driving distance
function milesBetween(lat1,lng1,lat2,lng2){const toRad=d=>d*Math.PI/180,R=3958.8,dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1),a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function fetchWithTimeout(url,ms=9000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);return fetch(url,{signal:controller.signal}).finally(()=>clearTimeout(timer));}
async function getDrivingOptions(user,candidates){
  const coords=[`${user.lng},${user.lat}`,...candidates.map(x=>`${x.lng},${x.lat}`)].join(';');
  const url=`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=distance,duration`;
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
  const outsideSelection=!activeChains.has(result.loc.chain || DEFAULT_CHAIN_KEY);
  const chainNote=outsideSelection?`<div class="nearest-alert">Nothing close by in your selected chains, so this ${escapeHtml((CHAIN_REGISTRY[result.loc.chain]||{}).name||'nearby')} location is shown instead.</div>`:'';
  // Filled chain pill so you can see which brand this is at a glance, colored from the registry.
  const chain=CHAIN_REGISTRY[result.loc.chain]||{};
  const chainBadge=chain.name?`<div class="now-chain-badge" style="background:${chain.color};color:${chain.textColor};">${escapeHtml(chain.name)}</div>`:'';
  return `<div class="bathroom-now-card"><button class="bathroom-now-close" id="bathroom-now-close" title="Close">✕</button><div class="now-title">🚽 ${fallback?'Closest location':'Closest bathroom by driving distance'}</div>${chainNote}${chainBadge}<b>${result.loc.n}</b><br>${distance}${duration}<br>${open===true?'🟢 Open now':open===false?'🔴 Closed now':'⚪ Hours unavailable'}<br>🚻 ${avgStr(agg.bathroomSum,agg.bathroomCount)}★ · ${agg.bathroomCount} rating${agg.bathroomCount===1?'':'s'}${lastRatedNote}${hoursMissingNote}<div class="now-actions"><button class="btn btn-primary" id="bathroom-now-directions">🧭 Get Directions</button><button class="btn btn-secondary" id="bathroom-now-view">Details</button></div></div>`;
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
      const rows = byLoc[id] || [];
      let clearedAfter = 0; const reports = [];
      rows.forEach(r => { if(r.cleared){ if(r.ts > clearedAfter) clearedAfter = r.ts; } else reports.push(r.ts); });
      const live = reports.filter(t => t > clearedAfter);
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
    maybeAutoSetTravelMode(lat,lng);
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
  locateBtn.disabled=true;locateBtn.textContent='🚽 Finding bathroom…';nearestInfo.style.display='none';
  navigator.geolocation.getCurrentPosition(async pos=>{
    const user={lat:pos.coords.latitude,lng:pos.coords.longitude};lastKnownPos={...user,ts:Date.now()};currentListPosition=lastKnownPos;
    setUserLocationMarker(user.lat,user.lng);
    // Prefer the selected chains, but don't strand someone far from their nearest pick —
    // if nothing selected is within a reasonable driving distance, widen to every chain
    // (still open-only) so the closest real option wins instead.
    const CHAIN_FALLBACK_MILES = 20;
    // Bathroom Now ignores travel mode on purpose: it's the emergency button, so the closest
    // usable bathroom wins even if it's a city/metro spot (e.g. a Dunkin) while in road mode.
    let eligible = seedLocations.filter(loc =>
      activeChains.has(loc.chain || DEFAULT_CHAIN_KEY) && isLocationOpenNow(loc) !== false
    );
    const nearestSelectedMiles = eligible.reduce((min,loc) => {
      const d = milesBetween(user.lat, user.lng, loc.lat, loc.lng);
      return d < min ? d : min;
    }, Infinity);
    if(nearestSelectedMiles > CHAIN_FALLBACK_MILES){
      eligible = seedLocations.filter(loc => isLocationOpenNow(loc) !== false);
    }
    let candidates=eligible.map(loc=>({loc,d:milesBetween(user.lat,user.lng,loc.lat,loc.lng)})).sort((a,b)=>a.d-b.d).slice(0,10).map(x=>x.loc);
    if(!candidates.length){
      locateBtn.disabled=false;locateBtn.textContent='🚽 Bathroom Now';
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
      locateBtn.disabled=false;locateBtn.textContent='🚽 Bathroom Now';
      nearestInfo.style.display='block';
      nearestInfo.textContent='No open bathrooms found nearby right now.';
      return;
    }
    try{
      const options=await getDrivingOptions(user,candidates);
      options.sort((a,b)=>{const rank=x=>isLocationOpenNow(x.loc)===true?0:isLocationOpenNow(x.loc)===null?1:2;return rank(a)-rank(b)||a.distanceMiles-b.distanceMiles;});
      if(!options.length)throw new Error('No routes');showBathroomNowResult(options[0],false);
    }catch(e){
      const loc=candidates[0];showBathroomNowResult({loc,distanceMiles:milesBetween(user.lat,user.lng,loc.lat,loc.lng),durationMinutes:null},true);
    }finally{locateBtn.disabled=false;locateBtn.textContent='🚽 Bathroom Now';}
  },err=>{locateBtn.disabled=false;locateBtn.textContent='🚽 Bathroom Now';nearestInfo.style.display='block';nearestInfo.textContent=err.code===1?'Location access was denied. Enable location permission for this site to use Bathroom Now.':'Could not get your location. Check your connection and location settings.';},{enableHighAccuracy:true,timeout:10000});
});

// Missing-location reporting — logs straight to Firestore (visible in FlushPanel), no email needed
const missingBtn = document.getElementById('missingBtn');
const missingPanel = document.getElementById('missingPanel');
const missingInput = document.getElementById('missingInput');
const missingSubmit = document.getElementById('missingSubmit');
const missingNote = document.getElementById('missingNote');
const missingUseLocationBtn = document.getElementById('missingUseLocationBtn');
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
  missingUseLocationBtn.textContent = '📍 Getting your location...';
  navigator.geolocation.getCurrentPosition((pos) => {
    capturedMissingCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    missingUseLocationBtn.textContent = '✅ Location attached';
    missingInput.placeholder = 'Optional — add a note (e.g. "behind the gas pumps")';
    missingUseLocationBtn.disabled = false;
  }, () => {
    missingUseLocationBtn.textContent = '📍 Use my current location instead';
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
  missingSubmit.textContent = '...';
  const finalDescription = description || '(no description — location only)';
  const ok = await logMissingLocation(finalDescription, capturedMissingCoords);
  missingNote.style.color = ok ? '#2f6b3c' : '#c62828';
  missingNote.textContent = ok ? 'Thanks — sent!' : 'Something went wrong, try again.';
  if(ok){
    missingInput.value = '';
    missingInput.placeholder = 'Address or cross streets';
    capturedMissingCoords = null;
    missingUseLocationBtn.textContent = '📍 Use my current location instead';
    setTimeout(() => {
      missingPanel.classList.remove('show');
      missingNote.textContent = '';
    }, 1500);
  }
  missingSubmit.disabled = false;
  missingSubmit.textContent = 'Send';
}

missingSubmit.addEventListener('click', submitMissingLocation);
missingInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter') submitMissingLocation();
});

// "Add to Home Screen" suggestion — different instructions per platform, shown once
(function(){
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  const alreadyDismissed = localStorage.getItem('hideInstallBanner') === '1';

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

  document.getElementById('installClose').addEventListener('click', () => {
    document.getElementById('installBanner').classList.remove('show');
    localStorage.setItem('hideInstallBanner', '1');
  });
})();
