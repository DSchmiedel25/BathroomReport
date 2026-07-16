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
//   2. Add a <script src="<chain>-locations.js"></script> tag in index.html,
//      right before app.js.
//   3. Add one entry below with the chain's real brand color.
const CHAIN_REGISTRY = {
  stewarts: { name: "Stewart's Shops", color: '#a51e36', textColor: '#ffffff', dataVar: 'stewartsLocations' },
  cumberlandFarms: { name: "Cumberland Farms", color: '#009639', textColor: '#ffffff', dataVar: 'cumberlandFarmsLocations' }
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

// Theme: defaults to the phone's system light/dark setting, but a manual toggle overrides it
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  if(btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
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

const map = L.map('map', { zoomControl: false, maxZoom: 19 }).setView([42.75, -73.80], 12);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Plain marker layer group — no clustering. We tried Leaflet.markercluster for a while, but
// it turned out to be the common thread behind several distinct Android bugs (a maxZoom
// error, a zoomToShowLayer race condition, and possibly the popup-closes-immediately issue),
// so it's been removed entirely in favor of reliability. All markers just render directly.
const markerCluster = L.layerGroup();
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

  map.setView(marker.getLatLng(), 16, { animate: false });
  positionSelectedMarker(marker, false);
  marker.openPopup();
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
  document.getElementById('legendBody').classList.add('collapsed');
  document.getElementById('openNowToggle').style.display = 'none';
  document.getElementById('listViewToggle').style.display = 'none';
  document.getElementById('leaderboardToggle').style.display = 'none';
});
map.on('popupclose', () => {
  document.getElementById('locateBtn').style.display = '';
  document.getElementById('missingBtn').style.display = '';
  document.getElementById('openNowToggle').style.display = '';
  document.getElementById('listViewToggle').style.display = '';
  document.getElementById('leaderboardToggle').style.display = '';
  const wasCollapsed = localStorage.getItem('legendCollapsed') === '1';
  if(!wasCollapsed) document.getElementById('legendBody').classList.remove('collapsed');
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
  const systemPrefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (systemPrefersLight ? 'light' : 'dark'));
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
function bathroomColor(agg){
  if(!agg || agg.bathroomCount === 0) return '#8a8a8a';
  const avg = agg.bathroomSum / agg.bathroomCount;
  const rounded = Math.max(1, Math.min(5, Math.round(avg)));
  const colors = {
    1: '#e53935', // red
    2: '#fb8c00', // orange
    3: '#fdd835', // yellow
    4: '#43a047', // green
    5: '#1e88e5'  // blue
  };
  return colors[rounded];
}

// Marker size scales with zoom level so pins are easy to see and tap whether zoomed out or in
function sizesForZoom(zoom){
  if(zoom >= 15) return {unrated:22, rated:30};
  if(zoom >= 13) return {unrated:18, rated:25};
  if(zoom >= 11) return {unrated:15, rated:20};
  if(zoom >= 9)  return {unrated:12, rated:15};
  return {unrated:9, rated:11};
}

function makeIcon(id){
  const agg = ratingsCache[id] || emptyAgg();
  const myVote = (typeof myVoteCache !== 'undefined' && myVoteCache[id]) || emptyVote();
  const chain = chainFor(locationsById[id]);
  const communityRated = agg.bathroomCount > 0;
  const reviewedByMe = myVote.bathroom > 0;
  const color = bathroomColor(agg);
  const sizes = sizesForZoom(map.getZoom());
  const size = communityRated ? sizes.rated : sizes.unrated;
  // Show the rounded star number on the pin itself — not just color — so it's still
  // readable for colorblind users where red/orange/yellow/green can look similar.
  const roundedStar = communityRated ? Math.round(agg.bathroomSum / agg.bathroomCount) : null;
  const labelHtml = roundedStar
    ? `<span style="color:#fff;font-weight:800;font-size:${Math.round(size*0.5)}px;text-shadow:0 1px 2px rgba(0,0,0,.7);">${roundedStar}</span>`
    : '';

  // 5-star bathrooms get a distinctive star-shaped pin instead of circle/diamond — makes
  // the very best spots visually pop out on the map at a glance
  if(roundedStar === 5){
    const starClip = 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
    const outer = size + 5;
    return L.divIcon({
      className:'',
      html:`<div style="position:relative;width:${outer}px;height:${outer}px;filter:drop-shadow(0 0 2px rgba(0,0,0,.6));">
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:${outer}px;height:${outer}px;background:${chain.color};clip-path:${starClip};"></div>
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:${size}px;height:${size}px;background:${color};clip-path:${starClip};"></div>
              <div style="position:absolute;top:56%;left:50%;transform:translate(-50%,-50%);">${labelHtml}</div>
            </div>`,
      iconSize:[outer, outer],
      iconAnchor:[outer/2, outer/2]
    });
  }

  if(reviewedByMe){
    // Diamond shape for anything YOU'VE personally rated — same color scale, different silhouette
    const inner = Math.round(size * 0.72);
    return L.divIcon({
      className:'',
      html:`<div style="position:relative;width:${size}px;height:${size}px;">
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(45deg);background:${color};width:${inner}px;height:${inner}px;border:3px solid ${chain.color};box-shadow:0 0 3px rgba(0,0,0,.6);"></div>
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);">${labelHtml}</div>
            </div>`,
      iconSize:[size, size],
      iconAnchor:[size/2, size/2]
    });
  }

  return L.divIcon({
    className:'',
    html:`<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:3px solid ${chain.color};box-shadow:0 0 3px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;">${labelHtml}</div>`,
    iconSize:[size, size],
    iconAnchor:[size/2, size/2]
  });
}

function emptyAgg(){ return {storeSum:0, storeCount:0, bathroomSum:0, bathroomCount:0, checkinCount:0}; }
function emptyVote(){ return {store:0, bathroom:0, amenities:{}}; }
function avgStr(sum, count){ return count > 0 ? (sum/count).toFixed(1) : '—'; }
function ratingConfidenceHtml(count){
  if(!count) return '<span class="rating-confidence">Not yet rated</span>';
  const label = `${count} ${count === 1 ? 'rating' : 'ratings'}`;
  return count < 5
    ? `<span class="rating-confidence">${label}</span> <span class="early-score">Early score</span>`
    : `<span class="rating-confidence">${label}</span>`;
}

const BATHROOM_AMENITIES = [
  {key:'restroomType', label:'Restroom setup', states:['unknown','single','multiple'],
    stateLabels:{
      unknown:'Not sure',
      single:'One shared restroom',
      multiple:"Separate men's & women's restrooms"
    }},
  {key:'accessible', label:'Handicap accessible', stateIcons:{yes:'♿️'}},
  {key:'changing', label:'Changing table', stateIcons:{yes:'🚼'}},
  {key:'handDrying', label:'Hand drying', states:['unknown','paper','dryer','both'],
    stateLabels:{unknown:'Not sure', paper:'Paper towels', dryer:'Hand dryer', both:'Both'},
    stateIcons:{paper:'🧻', dryer:'💨', both:'🧻💨'}}
];
const amenityCache = {};

// Store-level features — separate from bathroom features (myVote.storeFeatures vs
// myVote.amenities), tucked inside the already-collapsed Store rating section so the
// bathroom-first flow stays exactly as quick as it was.
const STORE_FEATURES = [
  {key:'gas', label:'Gas & Diesel', stateIcons:{yes:'⛽'}},
  {key:'evCharging', label:'EV Charging', stateIcons:{yes:'⚡'}},
  {key:'indoorSeating', label:'Indoor seating', stateIcons:{yes:'🪑'}},
  {key:'wifi', label:'WiFi', stateIcons:{yes:'📶'}}
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
function renderAmenityStepHtml(myVote){
  const mine = myVote.amenities || {};
  const idx = BATHROOM_AMENITIES.findIndex(a => mine[a.key] === undefined);
  if(idx === -1){
    return `<div class="amenity-complete">🚽 That's everything — thanks for the intel!</div>`;
  }
  const a = BATHROOM_AMENITIES[idx];
  const states = a.states || ['unknown', 'yes', 'no'];
  const buttons = states.map(s =>
    `<button type="button" class="amenity-answer-btn" data-key="${a.key}" data-value="${s}">${amenityAnswerIcon(a, s)} ${amenityStateLabel(a, s)}</button>`
  ).join('');
  return `<div class="amenity-progress">Feature ${idx + 1} of ${BATHROOM_AMENITIES.length}</div>
    <div class="amenity-question-label">${a.label}</div>
    <div class="amenity-answer-row">${buttons}</div>`;
}

function amenityEditorHtml(locId, myVote){
  return `<div class="amenities-editor">
    <div class="feature-title">🚻 Bathroom features you saw</div>
    <div class="amenity-step" id="amenity-step-${locId}">${renderAmenityStepHtml(myVote)}</div>
    <div class="save-note" id="amenities-note-${locId}"></div>
  </div>`;
}

function amenitySummaryHtml(summary){
  if(!summary) return '<span class="feature-badge unconfirmed">Loading features…</span>';
  const confirmed = BATHROOM_AMENITIES.filter(a => {
    const x = summary[a.key] || {yes:0,no:0};
    return x.yes >= 2 && x.yes > x.no;
  });
  if(!confirmed.length) return '<span class="feature-badge unconfirmed">No features confirmed yet</span>';
  return confirmed.map(a => `<span class="feature-badge">${amenityAnswerIcon(a, 'yes')} ${a.label}</span>`).join('');
}

// Same "confirmed" rule as the summary badges (at least 2 yes-votes, and more yes than no),
// specifically for handicap-accessible — used both for the prominent popup badge and for
// filtering the list view.
function isConfirmedAccessible(summary){
  if(!summary || !summary.accessible) return false;
  const x = summary.accessible;
  return x.yes >= 2 && x.yes > x.no;
}

function accessibleBadgeHtml(locId){
  const summary = amenityCache[locId];
  if(!summary) return ''; // not loaded yet — attachAmenityHandlers fills this in once it is
  if(!isConfirmedAccessible(summary)) return '';
  return '<div class="accessible-badge">♿ Handicap accessible — confirmed by visitors</div>';
}

async function loadAmenitySummary(locId){
  try{
    const {db, collection, query, where, getDocs} = await fb();
    const snap = await getDocs(query(collection(db, 'votes'), where('locId', '==', locId)));
    const summary = {};
    BATHROOM_AMENITIES.forEach(a => summary[a.key] = {yes:0,no:0});
    snap.forEach(d => {
      const amenities = d.data().amenities || {};
      BATHROOM_AMENITIES.forEach(a => {
        if(amenities[a.key] === 'yes') summary[a.key].yes++;
        if(amenities[a.key] === 'no') summary[a.key].no++;
      });
    });
    amenityCache[locId] = summary;
    return summary;
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

function storeFeatureSummaryHtml(summary){
  if(!summary) return '<span class="feature-badge unconfirmed">Loading features…</span>';
  const confirmed = STORE_FEATURES.filter(a => {
    const x = summary[a.key] || {yes:0,no:0};
    return x.yes >= 2 && x.yes > x.no;
  });
  if(!confirmed.length) return '<span class="feature-badge unconfirmed">No features confirmed yet</span>';
  return confirmed.map(a => `<span class="feature-badge">${amenityAnswerIcon(a, 'yes')} ${a.label}</span>`).join('');
}

async function loadStoreFeatureSummary(locId){
  try{
    const {db, collection, query, where, getDocs} = await fb();
    const snap = await getDocs(query(collection(db, 'votes'), where('locId', '==', locId)));
    const summary = {};
    STORE_FEATURES.forEach(a => summary[a.key] = {yes:0,no:0});
    snap.forEach(d => {
      const features = d.data().storeFeatures || {};
      STORE_FEATURES.forEach(a => {
        if(features[a.key] === 'yes') summary[a.key].yes++;
        if(features[a.key] === 'no') summary[a.key].no++;
      });
    });
    storeFeatureCache[locId] = summary;
    return summary;
  }catch(e){ console.error('loadStoreFeatureSummary failed', e); return null; }
}


// Funny captions for each star level
const storeQuips = {
  1: ["Regret.", "Bold choice.", "Lost Cause.", "Keep driving.", "Ain't it."],
  2: ["It's open.", "Not their best work.", "Needs Improvement.", "Quick stop.", "Mid."],
  3: ["It'll do.", "Exactly as expected.", "Reliable Stop.", "Solid Stewart's.", "Respectable."],
  4: ["Nice surprise.", "Pretty good.", "Local Favorite.", "One of the good ones.", "Certified good."],
  5: ["I'd come back.", "Nailed it.", "Legendary.", "Destination Stewart's.", "No notes."]
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
    // Your account username automatically IS your leaderboard name — no separate step needed,
    // since Firebase Auth already guarantees usernames are unique.
    await setDoc(doc(db, 'displayNames', cred.user.uid), {
      name: clean, nameLower: clean.toLowerCase(), updatedAt: Date.now()
    }, { merge: true });
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

    // Carry over a previously-set leaderboard name, if the new account doesn't already have one
    const newNameSnap = await getDoc(doc(db, 'displayNames', newUid));
    if(!newNameSnap.exists()){
      const oldNameSnap = await getDoc(doc(db, 'displayNames', oldAnonId));
      if(oldNameSnap.exists()){
        await setDoc(doc(db, 'displayNames', newUid), oldNameSnap.data());
        await deleteDoc(doc(db, 'displayNames', oldAnonId));
      }
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

async function loadLeaderboard(){
  try{
    const {db, collection, getDocs} = await fb();

    // Count distinct locations rated per device — bathroom and store separately, plus a
    // combined "Shops rated" total (any location rated on either front)
    const votesSnap = await getDocs(collection(db, 'votes'));
    const bathroomLocsByClient = {};
    const storeLocsByClient = {};
    votesSnap.forEach(d => {
      const v = d.data();
      const cid = v.clientId;
      if(!cid) return;
      const locId = v.locId || d.id.split('_')[0];
      if(v.bathroom > 0){
        if(!bathroomLocsByClient[cid]) bathroomLocsByClient[cid] = new Set();
        bathroomLocsByClient[cid].add(locId);
      }
      if(v.store > 0){
        if(!storeLocsByClient[cid]) storeLocsByClient[cid] = new Set();
        storeLocsByClient[cid].add(locId);
      }
    });

    const namesSnap = await getDocs(collection(db, 'displayNames'));
    const namesByClient = {};
    namesSnap.forEach(d => { namesByClient[d.id] = d.data().name; });

    const blocklistSnap = await getDocs(collection(db, 'leaderboardBlocklist'));
    const blocked = new Set();
    blocklistSnap.forEach(d => blocked.add(d.id));

    // Only show devices that have actually set a name, aren't blocked, and have rated at
    // least one bathroom or store — ranked by total distinct Shops rated (combined)
    const allClientIds = new Set([...Object.keys(bathroomLocsByClient), ...Object.keys(storeLocsByClient)]);
    const ranked = Array.from(allClientIds)
      .filter(cid => namesByClient[cid] && !blocked.has(cid))
      .map(cid => {
        const bathroomSet = bathroomLocsByClient[cid] || new Set();
        const storeSet = storeLocsByClient[cid] || new Set();
        const combined = new Set([...bathroomSet, ...storeSet]);
        return {
          clientId: cid,
          name: namesByClient[cid],
          shopsCount: combined.size,
          bathroomCount: bathroomSet.size,
          storeCount: storeSet.size
        };
      })
      .sort((a, b) => b.shopsCount - a.shopsCount)
      .slice(0, 20);

    return ranked;
  }catch(e){
    console.error('loadLeaderboard failed', e);
    return null;
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
async function bumpAggregate(id, sumKey, sumDelta, countKey, countDelta){
  try{
    const {db, doc, setDoc, increment} = await fb();
    await setDoc(doc(db, 'aggregates', id), {
      [sumKey]: increment(sumDelta),
      [countKey]: increment(countDelta),
      lastUpdated: Date.now()
    }, { merge: true });
    return true;
  }catch(e){
    console.error('save agg failed', e);
    return false;
  }
}

// Check-ins — a lightweight "I've been here" that doesn't require a star rating. Counted
// once per person per location (re-checking in later just updates your timestamp, doesn't
// inflate the count).
async function hasCheckedIn(locId){
  try{
    const {db, doc, getDoc} = await fb();
    const snap = await getDoc(doc(db, 'checkins', locId + '_' + getEffectiveId()));
    return snap.exists();
  }catch(e){
    return false;
  }
}

async function checkIn(loc){
  // Deliberately no location/GPS check here — check-ins work from anywhere, unlike ratings
  // (which stay geofenced). This is meant to be a low-friction "I've been here at some point"
  // rather than a verified-visit action.
  try{
    const {db, doc, setDoc, increment} = await fb();
    const myId = getEffectiveId();
    const checkinRef = doc(db, 'checkins', loc.id + '_' + myId);
    const alreadyIn = await hasCheckedIn(loc.id);
    await setDoc(checkinRef, { locId: loc.id, clientId: myId, ts: Date.now() }, { merge: true });
    if(!alreadyIn){
      await setDoc(doc(db, 'aggregates', loc.id), { checkinCount: increment(1) }, { merge: true });
    }
    return { ok: true, alreadyIn };
  }catch(e){
    console.error('checkIn failed', e);
    return { ok: false, reason: 'Something went wrong — try again.' };
  }
}

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
    await setDoc(doc(db, 'votes', id + '_' + clientId), {
      ...data,
      clientId,
      locId: id,
      lastUpdated: Date.now()
    }, { merge: true });
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

function popupHtml(loc, agg, myVote){
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
  }
  const recency = relativeTimeFromNow(agg.lastUpdated);
  const recencyLine = recency ? `<div class="hours-line">📝 Last rated ${recency}</div>` : '';
  const chain = chainFor(loc);
  return `<div class="popup-inner" data-locid="${loc.id}">
    <div class="chain-badge" style="background:${chain.color};color:${chain.textColor};">${chain.name}</div>
    <h3>${loc.n}</h3>
    <div class="addr">${loc.addr}${loc.num ? ' &middot; Shop #' + loc.num : ''}</div>
    ${hoursLine}
    <div id="accessible-badge-${loc.id}">${accessibleBadgeHtml(loc.id)}</div>
    ${recencyLine}
    <div class="popup-actions">
      <button class="btn btn-primary directions-btn" id="directions-btn-${loc.id}" data-lat="${loc.lat}" data-lng="${loc.lng}">🧭 Directions</button>
      <button class="btn btn-secondary nav-change-btn" id="nav-change-${loc.id}" title="Change navigation app">⚙️</button>
      <button class="btn btn-secondary btn-icon-only share-btn" title="Share" data-shareurl="${shareUrl}" data-sharename="${loc.n.replace(/"/g,'&quot;')}">🔗</button>
      <button class="btn btn-danger btn-icon-only report-toggle-btn" title="Report an issue" id="report-toggle-${loc.id}">🚩</button>
    </div>
    <div class="nav-chooser" id="nav-chooser-${loc.id}" style="display:none;">
      <div class="rating-label" style="color:#333;">Open directions with:</div>
      <button class="btn btn-secondary nav-choice-btn" data-app="google">Google Maps</button>
      <button class="btn btn-secondary nav-choice-btn" data-app="waze">Waze</button>
      <button class="btn btn-secondary nav-choice-btn" data-app="apple">Apple Maps</button>
    </div>
    <div class="report-section" id="report-section-${loc.id}" style="display:none;">
      <div class="tip-input-row">
        <input type="text" class="tip-input" id="report-input-${loc.id}" maxlength="80" placeholder="What's wrong? e.g. closed, wrong address" />
        <button class="btn btn-amber tip-submit" id="report-submit-${loc.id}">Send report</button>
      </div>
      <div class="save-note" id="report-note-${loc.id}"></div>
    </div>
    <div class="checkin-row">
      <button class="btn btn-secondary checkin-btn" id="checkin-btn-${loc.id}">✅ I've been here</button>
      <span class="checkin-count">${agg.checkinCount || 0} check-in${(agg.checkinCount || 0) === 1 ? '' : 's'}</span>
      <div class="save-note" id="checkin-note-${loc.id}"></div>
    </div>
    <div class="dual-rating-row">
      <div class="rating-col">
        <span class="rating-label">🚻 Bathroom</span>
        <div class="rating-score-line"><span class="rating-score">${avgStr(agg.bathroomSum, agg.bathroomCount)}★</span> ${ratingConfidenceHtml(agg.bathroomCount)}</div>
        ${starsHtml(loc.id,'bathroom',myVote.bathroom)}
        <div class="star-quip" id="quip-bathroom-${loc.id}">${quipFor('bathroom', myVote.bathroom)}</div>
        <div class="save-note" id="note-bathroom-${loc.id}"></div>
      </div>
      <div class="rating-col">
        <span class="rating-label">🏪 Store</span>
        <div class="rating-score-line"><span class="rating-score">${avgStr(agg.storeSum, agg.storeCount)}★</span> ${ratingConfidenceHtml(agg.storeCount)}</div>
        ${starsHtml(loc.id,'store',myVote.store)}
        <div class="star-quip" id="quip-store-${loc.id}">${quipFor('store', myVote.store)}</div>
        <div class="save-note" id="note-store-${loc.id}"></div>
      </div>
    </div>
    <div class="tips-section">
      <span class="rating-label">💬 Tips from visitors</span>
      <ul class="tips-list" id="tips-list-${loc.id}"><li style="color:#999;">Loading…</li></ul>
      <div class="tip-input-row">
        <input type="text" class="tip-input" id="tip-input-${loc.id}" maxlength="${MAX_TIP_LENGTH}" placeholder="e.g. need a key, buzzer required" />
        <button class="btn btn-amber tip-submit" id="tip-submit-${loc.id}">Add</button>
      </div>
    </div>
    <div class="feature-summary"><div class="feature-title">🚻 Confirmed bathroom features</div><div class="feature-badges" id="feature-summary-${loc.id}">${amenitySummaryHtml(amenityCache[loc.id])}</div></div>
    ${amenityEditorHtml(loc.id, myVote)}
    <div id="store-toggle-${loc.id}" class="store-rating-toggle">🏪 Store details <span id="store-arrow-${loc.id}">▾</span></div>
    <div id="store-section-${loc.id}" class="store-rating-section collapsed">
      <div class="feature-summary"><div class="feature-title">🏪 Confirmed store features</div><div class="feature-badges" id="store-feature-summary-${loc.id}">${storeFeatureSummaryHtml(storeFeatureCache[loc.id])}</div></div>
      ${storeFeatureEditorHtml(loc.id, myVote)}
    </div>
  </div>`;
}

const markers = {};
const myVoteCache = {};
const loadedIds = new Set();

function addMarker(loc){
  // Start every pin with placeholder (unrated-looking) data — colors/rings fill in as real data arrives
  ratingsCache[loc.id] = ratingsCache[loc.id] || emptyAgg();
  myVoteCache[loc.id] = myVoteCache[loc.id] || emptyVote();
  const marker = L.marker([loc.lat, loc.lng], {icon: makeIcon(loc.id)});
  marker.locId = loc.id; // used by the cluster icon function to compute the cluster's average rating
  markerCluster.addLayer(marker);
  marker.bindPopup(popupHtml(loc, ratingsCache[loc.id], myVoteCache[loc.id]), {
    maxWidth: Math.min(280, window.innerWidth - 40),
    maxHeight: window.innerHeight * 0.6,
    autoPan: false,
    keepInView: false
  });
  marker.on('popupopen', () => {
    // Keep the selected pin centered horizontally and near the bottom of the
    // visible map. The popup then grows upward with maximum available room.
    requestAnimationFrame(() => positionSelectedMarker(marker, false));

    attachStarHandlers(loc);
    attachTipHandlers(loc);
    attachDirectionsHandler(loc);
    attachShareHandler(loc);
    attachReportHandler(loc);
    attachCheckinHandler(loc);
    attachStoreToggleHandler(loc);
    attachAmenityHandlers(loc);
    attachStoreFeatureHandlers(loc);
  });
  markers[loc.id] = marker;
}

// Directions — remembers the user's preferred nav app after they pick once
function buildNavUrl(app, lat, lng){
  if(app === 'waze') return `https://www.waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  if(app === 'apple') return `https://maps.apple.com/?daddr=${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function attachDirectionsHandler(loc){
  const btnOrig = document.getElementById('directions-btn-' + loc.id);
  const changeBtnOrig = document.getElementById('nav-change-' + loc.id);
  const chooser = document.getElementById('nav-chooser-' + loc.id);
  if(!btnOrig || !chooser || !changeBtnOrig) return;

  const btn = btnOrig.cloneNode(true);
  btnOrig.parentNode.replaceChild(btn, btnOrig);
  const changeBtn = changeBtnOrig.cloneNode(true);
  changeBtnOrig.parentNode.replaceChild(changeBtn, changeBtnOrig);

  const openWith = (app) => {
    window.open(buildNavUrl(app, btn.dataset.lat, btn.dataset.lng), '_blank', 'noopener');
  };

  btn.addEventListener('click', () => {
    const pref = localStorage.getItem('preferredNavApp');
    if(pref){
      openWith(pref);
    } else {
      chooser.style.display = chooser.style.display === 'none' ? 'flex' : 'none';
    }
  });

  changeBtn.addEventListener('click', () => {
    chooser.style.display = chooser.style.display === 'none' ? 'flex' : 'none';
  });

  chooser.querySelectorAll('.nav-choice-btn').forEach(choiceBtnOrig => {
    const choiceBtn = choiceBtnOrig.cloneNode(true);
    choiceBtnOrig.parentNode.replaceChild(choiceBtn, choiceBtnOrig);
    choiceBtn.addEventListener('click', () => {
      const app = choiceBtn.dataset.app;
      localStorage.setItem('preferredNavApp', app);
      chooser.style.display = 'none';
      openWith(app);
    });
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
    await addDoc(collection(db, 'reports'), {
      locId: loc.id, locName: loc.n, addr: loc.addr, reason, ts: Date.now()
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
  });
}

function attachCheckinHandler(loc){
  const btnOrig = document.getElementById('checkin-btn-' + loc.id);
  const note = document.getElementById('checkin-note-' + loc.id);
  if(!btnOrig) return;
  const btn = btnOrig.cloneNode(true);
  btnOrig.parentNode.replaceChild(btn, btnOrig);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Checking in...';
    if(note){ note.style.color = ''; note.textContent = ''; }
    try{
      const result = await checkIn(loc);
      if(result.ok){
        if(navigator.vibrate) navigator.vibrate(15);
        btn.textContent = '✅ Checked in!';
        if(note){
          note.style.color = '#2f6b3c';
          note.textContent = result.alreadyIn ? "Welcome back — you'd already checked in here before." : "You're on the map!";
        }
        // Refresh the count shown next to the button
        const agg = ratingsCache[loc.id];
        if(agg){
          agg.checkinCount = (agg.checkinCount || 0) + (result.alreadyIn ? 0 : 1);
          const countEl = document.querySelector(`.popup-inner[data-locid="${loc.id}"] .checkin-count`);
          if(countEl) countEl.textContent = `${agg.checkinCount} check-in${agg.checkinCount === 1 ? '' : 's'}`;
        }
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = "✅ I've been here";
        }, 2000);
        checkAndUnlockAchievements();
      } else {
        btn.disabled = false;
        btn.textContent = "✅ I've been here";
        if(note){ note.style.color = '#c62828'; note.textContent = result.reason; }
      }
    }catch(e){
      console.error('Check-in click handler error:', e);
      btn.disabled = false;
      btn.textContent = "✅ I've been here";
      if(note){ note.style.color = '#c62828'; note.textContent = 'Something went wrong — try again.'; }
    }
  });
}

function attachReportHandler(loc){
  const toggleBtn = document.getElementById('report-toggle-' + loc.id);
  const section = document.getElementById('report-section-' + loc.id);
  const input = document.getElementById('report-input-' + loc.id);
  const submitBtn = document.getElementById('report-submit-' + loc.id);
  const note = document.getElementById('report-note-' + loc.id);
  if(!toggleBtn || !section || !input || !submitBtn) return;

  // Clone to avoid stacking duplicate listeners on reopen
  const newToggle = toggleBtn.cloneNode(true);
  toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);
  newToggle.addEventListener('click', () => {
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
  });

  const newSubmit = submitBtn.cloneNode(true);
  submitBtn.parentNode.replaceChild(newSubmit, submitBtn);
  newSubmit.addEventListener('click', async () => {
    const reason = input.value.trim().slice(0, 80);
    if(!reason){
      if(note){ note.style.color = '#c62828'; note.textContent = 'Type what\'s wrong first.'; }
      return;
    }
    newSubmit.disabled = true;
    newSubmit.textContent = 'Sending...';

    await logReport(loc, reason);

    if(note){ note.style.color = '#2f6b3c'; note.textContent = 'Report sent — thank you!'; }
    input.value = '';
    newSubmit.disabled = false;
    newSubmit.textContent = 'Send report';
  });
}

// Fetch every pin's real ratings in the background so the map colors itself in at a glance —
// Firebase's free tier handles this fine, unlike the old sandboxed rate limit.

async function attachAmenityHandlers(loc){
  const summaryEl=document.getElementById('feature-summary-'+loc.id);
  const summary=await loadAmenitySummary(loc.id);
  if(summaryEl) summaryEl.innerHTML=amenitySummaryHtml(summary);
  const badgeEl = document.getElementById('accessible-badge-' + loc.id);
  if(badgeEl) badgeEl.innerHTML = accessibleBadgeHtml(loc.id);

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
      if(note){ note.style.color = '#c62828'; note.textContent = "📍 You need to be at this Stewart's to report its features."; }
      allBtns.forEach(b => b.disabled = false);
      return;
    }

    const myVote = myVoteCache[loc.id] || emptyVote();
    const amenities = { ...(myVote.amenities || {}), [key]: value };
    const updatedVote = { ...myVote, amenities };
    myVoteCache[loc.id] = updatedVote;

    const ok = await saveMyVote(loc.id, updatedVote);
    if(!ok){
      if(note){ note.style.color = '#c62828'; note.textContent = 'Could not save — try again.'; }
      allBtns.forEach(b => b.disabled = false);
      return;
    }

    if(note) note.textContent = '';
    if(navigator.vibrate) navigator.vibrate(10);

    // Auto-advance to the next unanswered feature (or show the completion message)
    stepEl.innerHTML = renderAmenityStepHtml(updatedVote);

    const fresh = await loadAmenitySummary(loc.id);
    if(summaryEl) summaryEl.innerHTML = amenitySummaryHtml(fresh);
  });
}

async function attachStoreFeatureHandlers(loc){
  const summaryEl=document.getElementById('store-feature-summary-'+loc.id);
  const summary=await loadStoreFeatureSummary(loc.id);
  if(summaryEl) summaryEl.innerHTML=storeFeatureSummaryHtml(summary);

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
      if(note){ note.style.color = '#c62828'; note.textContent = "📍 You need to be at this Stewart's to report its features."; }
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
    if(summaryEl) summaryEl.innerHTML = storeFeatureSummaryHtml(fresh);
  });
}

async function loadAllRatings(){
  await Promise.all(seedLocations.map(async loc => {
    const [agg, myVote] = await Promise.all([loadAggregate(loc.id), loadMyVote(loc.id)]);
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
  }));
  updateMostRecentBadge();
  updateMyProgressBadge();
  checkAndUnlockAchievements();
  maybeShowSupportPrompt();
  map.invalidateSize(); // header height just changed (badges filled in) — tell Leaflet to recalculate
}

// ============================================================
// Achievements & Bathroom Passport
// ============================================================
// Lighthearted, no XP/levels/streaks/leaderboard — just simple unlockable badges computed
// from data we already have (ratings + check-ins). Unlock records are stored per-identity
// (account UID if logged in, else this device's anonymous ID — consistent with how the rest
// of the app already treats identity) in a new 'achievements' Firestore collection, so this
// works immediately even signed-out, and syncs across devices once you log in.

const ACHIEVEMENT_DEFS = [
  { key:'firstFlush', icon:'🚽', name:'First Flush', desc:'Submit your first bathroom review',
    calc: (s) => ({ done: s.bathroomRatedCount >= 1, current: Math.min(s.bathroomRatedCount,1), total:1 }) },
  { key:'frequentFlusher', icon:'🧻', name:'Frequent Flusher', desc:'Review 10 different bathrooms',
    calc: (s) => ({ done: s.bathroomRatedCount >= 10, current: Math.min(s.bathroomRatedCount,10), total:10 }) },
  { key:'bathroomCritic', icon:'🕵️', name:'Bathroom Critic', desc:'Review 25 different bathrooms',
    calc: (s) => ({ done: s.bathroomRatedCount >= 25, current: Math.min(s.bathroomRatedCount,25), total:25 }) },
  { key:'royalFlush', icon:'👑', name:'Royal Flush', desc:'Give five different bathrooms a 5-star rating',
    calc: (s) => ({ done: s.fiveStarCount >= 5, current: Math.min(s.fiveStarCount,5), total:5 }) },
  { key:'roadWarrior', icon:'🛣️', name:'Road Warrior', desc:"Check in at 50 different Stewart's locations",
    calc: (s) => ({ done: s.checkinCount >= 50, current: Math.min(s.checkinCount,50), total:50 }) },
  { key:'hiddenGemHunter', icon:'💎', name:'Hidden Gem Hunter', desc:'Review a location that had fewer than 5 bathroom reviews at the time',
    calc: (s) => ({ done: s.hiddenGemCount >= 1, current: Math.min(s.hiddenGemCount,1), total:1 }) },
  { key:'earlyBird', icon:'☀️', name:'Early Bird', desc:'Check in before 5:00 AM',
    calc: (s) => ({ done: s.hasEarlyBirdCheckin, current: s.hasEarlyBirdCheckin ? 1 : 0, total:1 }) },
  { key:'nightOwl', icon:'🌙', name:'Night Owl', desc:'Check in after midnight',
    calc: (s) => ({ done: s.hasNightOwlCheckin, current: s.hasNightOwlCheckin ? 1 : 0, total:1 }) },
  { key:'countyCollector', icon:'🗺️', name:'County Collector', desc:'Visit locations in 10 different areas',
    calc: (s) => ({ done: s.areaCount >= 10, current: Math.min(s.areaCount,10), total:10 }) },
  { key:'stewartsLegend', icon:'🏁', name:"Stewart's Legend", desc:'Visit every location currently on the map',
    calc: (s) => ({ done: s.totalLocations > 0 && s.visitedCount >= s.totalLocations, current: s.visitedCount, total: s.totalLocations }) }
];

// We don't have real county data in locations.js, only addresses — so "County Collector"
// uses the city pulled from each address as a rough stand-in for "different areas visited"
// rather than an actual county. Swap this out if/when real county data gets added.
function getCityFromAddress(addr){
  if(!addr) return 'Unknown';
  const parts = addr.split(',').map(p => p.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

async function computeAchievementStats(){
  const bathroomRatedIds = new Set();
  const fiveStarIds = new Set();
  const storeOrBathroomRatedIds = new Set();
  let hiddenGemCount = 0;
  Object.keys(myVoteCache).forEach(id => {
    const v = myVoteCache[id];
    if(!v) return;
    if(v.bathroom > 0){ bathroomRatedIds.add(id); storeOrBathroomRatedIds.add(id); }
    if(v.store > 0) storeOrBathroomRatedIds.add(id);
    if(v.bathroom === 5) fiveStarIds.add(id);
    if(v.wasHiddenGem) hiddenGemCount++;
  });

  let checkinLocIds = new Set();
  let hasEarlyBirdCheckin = false;
  let hasNightOwlCheckin = false;
  try{
    const {db, collection, query, where, getDocs} = await fb();
    const myId = getEffectiveId();
    const q = query(collection(db, 'checkins'), where('clientId', '==', myId));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const data = d.data();
      if(data.locId) checkinLocIds.add(data.locId);
      if(data.ts){
        const hour = new Date(data.ts).getHours();
        // Non-overlapping split of the pre-dawn hours: midnight–3:59am counts as Night Owl
        // (out late), 4am–4:59am counts as Early Bird (up early before 5am).
        if(hour >= 0 && hour < 4) hasNightOwlCheckin = true;
        if(hour === 4) hasEarlyBirdCheckin = true;
      }
    });
  }catch(e){
    console.error('computeAchievementStats: checkins fetch failed (non-fatal)', e);
  }

  // "Visited" = checked in OR rated (either store or bathroom) — broader than check-ins alone
  const visitedIds = new Set([...checkinLocIds, ...storeOrBathroomRatedIds]);

  const areaSet = new Set();
  visitedIds.forEach(id => {
    const loc = seedLocations.find(l => l.id === id);
    if(loc) areaSet.add(getCityFromAddress(loc.addr));
  });

  return {
    bathroomRatedCount: bathroomRatedIds.size,
    fiveStarCount: fiveStarIds.size,
    hiddenGemCount,
    checkinCount: checkinLocIds.size,
    hasEarlyBirdCheckin,
    hasNightOwlCheckin,
    areaCount: areaSet.size,
    visitedCount: visitedIds.size,
    totalLocations: seedLocations.length
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
    <div class="passport-stat-line">${stats.visitedCount} / ${stats.totalLocations} Stewart's visited — ${pct}% complete</div>
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
      const dateStr = r.unlockedAt ? new Date(r.unlockedAt).toLocaleDateString() : null;
      const progressStr = (!r.unlocked && r.total > 1) ? `${r.current} / ${r.total}` : '';
      return `<div class="achievement-card ${r.unlocked ? 'unlocked' : 'locked'}">
        <div class="achievement-icon">${def.icon}</div>
        <div class="achievement-info">
          <div class="achievement-name">${def.name}</div>
          <div class="achievement-desc">${def.desc}</div>
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
function updateMostRecentBadge(){
  const el = document.getElementById('mostRecentBadge');
  if(!el) return;
  let mostRecentLoc = null;
  let mostRecentTs = 0;
  seedLocations.forEach(loc => {
    const agg = ratingsCache[loc.id];
    if(agg && agg.lastUpdated && agg.lastUpdated > mostRecentTs){
      mostRecentTs = agg.lastUpdated;
      mostRecentLoc = loc;
    }
  });
  if(!mostRecentLoc){
    el.textContent = '';
    el.onclick = null;
    refreshStatTicker();
    return;
  }
  el.textContent = `🕐 Most recently rated: ${mostRecentLoc.n} — ${relativeTimeFromNow(mostRecentTs)}`;
  el.onclick = () => zoomToMarker(markers[mostRecentLoc.id]);
  refreshStatTicker();
}

// Verified visit — requires being physically near a location before rating it
const VERIFY_RADIUS_MILES = 0.3;
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
          if(note){ note.style.color = '#c62828'; note.textContent = 'This device is no longer able to submit ratings.'; }
          return;
        }

        if(note) note.textContent = 'Checking you\'re nearby...';

        const verification = await verifyNearby(loc);
        if(!verification.ok){
          if(note){
            note.style.color = '#c62828';
            note.textContent = verification.reason === 'no-location'
              ? '📍 Enable location to verify you\'re at this Stewart\'s before rating.'
              : `📍 You need to be at this Stewart's to rate it (you're ${verification.distance.toFixed(1)} mi away).`;
          }
          return;
        }
        if(note){ note.style.color = ''; note.textContent = 'Saving...'; }

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

        const okAgg = await bumpAggregate(loc.id, sumKey, sumDelta, countKey, countDelta);
        const okVote = await saveMyVote(loc.id, myVote);
        if(okAgg) logActivity('rating', { sourceId: loc.id + '_' + getEffectiveId(), locId: loc.id });
        if(note) note.textContent = (okAgg && okVote) ? 'Saved ✓ — visible to everyone' : 'Save failed';
        if(okAgg && okVote) maybeShowSupportPrompt();

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

// First-time onboarding — shown once per device, dismissible
(function(){
  if(localStorage.getItem('onboardingSeen') === '1') return;
  document.getElementById('onboardingOverlay').classList.add('show');
})();
document.getElementById('onboardingClose').addEventListener('click', () => {
  localStorage.setItem('onboardingSeen', '1');
  document.getElementById('onboardingOverlay').classList.remove('show');
});
document.getElementById('infoBtn').addEventListener('click', () => {
  document.getElementById('onboardingOverlay').classList.add('show');
});

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
map.on('zoomend', () => {
  seedLocations.forEach(loc => {
    const m = markers[loc.id];
    if(m && !m.isPopupOpen()) m.setIcon(makeIcon(loc.id));
  });
});

// Open-now calculation — loc.hrs is either "24" (24hr) or "HHMM-HHMM" in 24hr time.
// Locations with no .hrs field are "unknown" and are never hidden by the open-now filter.
function isLocationOpenNow(loc){
  if(!loc.hrs) return null; // unknown — we don't have hours data for this one yet
  if(loc.hrs === '24') return true;
  const parts = loc.hrs.split('-');
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
  if(!loc.hrs) return null;
  if(loc.hrs === '24') return 'Open 24 hours';
  const parts = loc.hrs.split('-');
  if(parts.length !== 2) return null;
  const open = parseInt(parts[0], 10);
  const close = parseInt(parts[1], 10);
  if(isNaN(open) || isNaN(close)) return null;
  return `${formatTime12h(open)} – ${formatTime12h(close)}`;
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

let showOnlyOpenNow = false;

function applyFilters(){
  seedLocations.forEach(loc => {
    const m = markers[loc.id];
    if(!m) return;
    const openOk = !showOnlyOpenNow || isLocationOpenNow(loc) !== false; // null (unknown) counts as OK
    if(openOk){
      if(!markerCluster.hasLayer(m)) markerCluster.addLayer(m);
    } else {
      if(markerCluster.hasLayer(m)) markerCluster.removeLayer(m);
    }
  });
}

document.getElementById('openNowToggle').addEventListener('click', () => {
  showOnlyOpenNow = !showOnlyOpenNow;
  const btn = document.getElementById('openNowToggle');
  btn.classList.toggle('active', showOnlyOpenNow);
  btn.textContent = showOnlyOpenNow ? '🕐 Open now ✓' : '🕐 Open now';
  applyFilters();
});

// List view — sortable without adding a permanent map search bar
let currentListPosition = null;
// Bulk lookup of confirmed-accessible locations for the List view filter — one full scan
// of votes, cached for the rest of the session rather than re-querying every time the
// filter's toggled.
let accessibleLocIdsCache = null;
async function loadAccessibleLocIds(){
  if(accessibleLocIdsCache) return accessibleLocIdsCache;
  try{
    const {db, collection, getDocs} = await fb();
    const snap = await getDocs(collection(db, 'votes'));
    const tally = {};
    snap.forEach(d => {
      const v = d.data();
      if(!v.locId || !v.amenities || !v.amenities.accessible) return;
      if(!tally[v.locId]) tally[v.locId] = {yes:0, no:0};
      if(v.amenities.accessible === 'yes') tally[v.locId].yes++;
      if(v.amenities.accessible === 'no') tally[v.locId].no++;
    });
    const confirmedIds = new Set(
      Object.keys(tally).filter(id => tally[id].yes >= 2 && tally[id].yes > tally[id].no)
    );
    accessibleLocIdsCache = confirmedIds;
    return confirmedIds;
  }catch(e){
    console.error('loadAccessibleLocIds failed', e);
    return new Set();
  }
}

async function buildListView(){
  const container=document.getElementById('listViewItems');
  const mode=document.getElementById('listSort').value;
  const accessibleOnly=document.getElementById('accessibleOnly').checked;
  container.innerHTML='<div style="padding:16px;color:#999;">Loading...</div>';

  // Every list mode except explicit A–Z uses distance as either the main sort
  // or the tie-breaker after the selected criterion. Reuse a recent GPS fix first.
  if(mode!=='az' && !currentListPosition){
    if(lastKnownPos && (Date.now()-lastKnownPos.ts)<5*60*1000) currentListPosition=lastKnownPos;
    else currentListPosition=await getVerifiedPosition();
  }

  let rows=seedLocations.map(loc=>({
    loc,
    dist:currentListPosition?milesBetween(currentListPosition.lat,currentListPosition.lng,loc.lat,loc.lng):null,
    agg:ratingsCache[loc.id]||emptyAgg()
  }));

  if(accessibleOnly){
    const accessibleIds = await loadAccessibleLocIds();
    rows = rows.filter(row => accessibleIds.has(row.loc.id));
  }

  const avg=r=>r.agg.bathroomCount?r.agg.bathroomSum/r.agg.bathroomCount:0;
  const byDistanceThenName=(a,b)=>(a.dist??Infinity)-(b.dist??Infinity)||a.loc.n.localeCompare(b.loc.n);
  const byName=(a,b)=>a.loc.n.localeCompare(b.loc.n);

  if(mode==='closest') rows.sort(currentListPosition?byDistanceThenName:byName);
  else if(mode==='best') rows.sort((a,b)=>{
    const aRated=a.agg.bathroomCount>0,bRated=b.agg.bathroomCount>0;
    if(aRated!==bRated) return bRated-aRated;
    return avg(b)-avg(a)||(currentListPosition?byDistanceThenName(a,b):byName(a,b));
  });
  else if(mode==='reviewed') rows.sort((a,b)=>b.agg.bathroomCount-a.agg.bathroomCount||(currentListPosition?byDistanceThenName(a,b):byName(a,b)));
  else if(mode==='recent') rows.sort((a,b)=>{
    const aRecent=a.agg.lastUpdated||0,bRecent=b.agg.lastUpdated||0;
    if(aRecent!==bRecent) return bRecent-aRecent;
    return currentListPosition?byDistanceThenName(a,b):byName(a,b);
  });
  else if(mode==='open'){
    rows=rows.filter(row=>isLocationOpenNow(row.loc)===true);
    rows.sort(currentListPosition?byDistanceThenName:byName);
  }
  else rows.sort(byName);
  const labels={closest:'Closest',best:'Best bathrooms',reviewed:'Most reviewed',recent:'Recently reviewed',open:'Open now',az:'A–Z'};
  document.getElementById('listViewHeader').querySelector('span').textContent='All Locations — '+labels[mode];
  container.innerHTML=rows.map(({loc,dist,agg})=>{
    const open=isLocationOpenNow(loc);
    const avgText=agg.bathroomCount?`${avgStr(agg.bathroomSum,agg.bathroomCount)}★ · ${agg.bathroomCount} rating${agg.bathroomCount===1?'':'s'}`:'Not yet rated';
    return `<div class="list-item" data-locid="${loc.id}"><div class="list-item-name">${loc.n}</div><div class="list-item-addr">${loc.addr}</div><div class="list-item-meta"><span>🚻 ${avgText}</span>${dist!==null?`<span>📍 ${dist.toFixed(1)} mi</span>`:''}<span>${open===true?'🟢 Open':open===false?'🔴 Closed':'⚪ Hours unavailable'}</span></div></div>`;
  }).join('');
}
document.getElementById('listSort').addEventListener('change',buildListView);
document.getElementById('accessibleOnly').addEventListener('change',buildListView);
document.getElementById('listViewToggle').addEventListener('click',()=>{buildListView();document.getElementById('listViewPanel').classList.add('show');});
document.getElementById('listViewClose').addEventListener('click',()=>{document.getElementById('listViewPanel').classList.remove('show');suppressNextLocateClick=true;setTimeout(()=>{suppressNextLocateClick=false;},400);});

// Leaderboard panel
let activeLeaderboardTab = 'bathroom';

async function openLeaderboard(){
  document.getElementById('leaderboardPanel').classList.add('show');

  const noteEl = document.getElementById('leaderboardAccountNote');
  if(isLoggedIn()){
    const username = (window.__currentUser.email || '').split('@')[0];
    noteEl.innerHTML = `You're on the board as <b style="color:var(--amber);">${escapeHtml(username)}</b>. <button id="leaderboardPassportBtn" style="background:none;border:none;color:var(--amber);text-decoration:underline;font-size:12px;cursor:pointer;padding:0 0 0 4px;">🎫 Passport</button> · <button id="leaderboardLogoutBtn" style="background:none;border:none;color:#e57373;text-decoration:underline;font-size:12px;cursor:pointer;padding:0 0 0 4px;">Log out</button>`;
    document.getElementById('leaderboardPassportBtn').addEventListener('click', () => {
      document.getElementById('leaderboardPanel').classList.remove('show');
      document.getElementById('accountPanel').classList.add('show');
      updateAccountUI();
      checkAndUnlockAchievements();
    });
    document.getElementById('leaderboardLogoutBtn').addEventListener('click', async () => {
      await logOutAccount();
      updateAccountUI();
      loadAllRatings();
      openLeaderboard(); // refresh this panel to reflect the logged-out state
    });
  } else {
    noteEl.innerHTML = `<button class="btn btn-amber" id="leaderboardLoginPrompt" style="width:100%;">👤 Log in to appear on the leaderboard</button>`;
    document.getElementById('leaderboardLoginPrompt').addEventListener('click', () => {
      document.getElementById('leaderboardPanel').classList.remove('show');
      document.getElementById('accountPanel').classList.add('show');
      updateAccountUI();
      checkAndUnlockAchievements();
    });
  }

  const itemsEl = document.getElementById('leaderboardItems');
  itemsEl.innerHTML = '<div style="padding:16px;color:#999;">Loading...</div>';
  const ranked = await loadLeaderboard();
  if(ranked === null){
    itemsEl.innerHTML = '<div style="padding:16px;color:#999;">Could not load the leaderboard — try again.</div>';
    return;
  }
  if(ranked.length === 0){
    itemsEl.innerHTML = `<div style="padding:16px;color:#999;">No one's logged in and rated a shop yet — be the first!</div>`;
    return;
  }
  itemsEl.innerHTML = ranked.map((r, i) =>
    `<div class="leaderboard-row-wrap">
      <div class="leaderboard-row" data-clientid="${r.clientId}">
        <span class="leaderboard-rank">#${i+1}</span>
        <div class="leaderboard-main">
          <div class="leaderboard-name">${escapeHtml(r.name)}</div>
        </div>
        <span class="leaderboard-arrow" id="lb-arrow-${r.clientId}">▾</span>
      </div>
      <div class="leaderboard-breakdown" id="lb-breakdown-${r.clientId}">
        <div>🚻 ${r.bathroomCount} bathroom${r.bathroomCount === 1 ? '' : 's'} rated</div>
        <div>🏪 ${r.storeCount} store${r.storeCount === 1 ? '' : 's'} rated</div>
      </div>
    </div>`
  ).join('');
}

document.getElementById('leaderboardToggle').addEventListener('click', openLeaderboard);
document.getElementById('leaderboardClose').addEventListener('click', () => {
  document.getElementById('leaderboardPanel').classList.remove('show');
  suppressNextLocateClick = true;
  setTimeout(() => { suppressNextLocateClick = false; }, 400);
});
document.getElementById('leaderboardItems').addEventListener('click', (e) => {
  const row = e.target.closest('.leaderboard-row');
  if(!row) return;
  const clientId = row.dataset.clientid;
  const breakdown = document.getElementById('lb-breakdown-' + clientId);
  const arrow = document.getElementById('lb-arrow-' + clientId);
  if(!breakdown || !arrow) return;
  const isOpen = breakdown.classList.toggle('open');
  arrow.textContent = isOpen ? '▸' : '▾';
});

// Account panel
function updateAccountUI(){
  const loggedIn = isLoggedIn();
  document.getElementById('loggedOutView').style.display = loggedIn ? 'none' : 'block';
  document.getElementById('loggedInView').style.display = loggedIn ? 'block' : 'none';
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

document.getElementById('accountToggle').addEventListener('click', () => {
  document.getElementById('accountPanel').classList.add('show');
  updateAccountUI();
  checkAndUnlockAchievements();
});

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
function bathroomNowCard(result,fallback=false){
  const agg=ratingsCache[result.loc.id]||emptyAgg(); const open=isLocationOpenNow(result.loc);
  const distance=Number.isFinite(result.distanceMiles)?`${result.distanceMiles.toFixed(1)} mi`:'Distance unavailable';
  const duration=Number.isFinite(result.durationMinutes)?` · ${Math.round(result.durationMinutes)} min`:'';
  return `<div class="bathroom-now-card"><div class="now-title">🚽 ${fallback?'Closest location':'Closest bathroom by driving distance'}</div><b>${result.loc.n}</b><br>${distance}${duration}<br>${open===true?'🟢 Open now':open===false?'🔴 Closed now':'⚪ Hours unavailable'}<br>🚻 ${avgStr(agg.bathroomSum,agg.bathroomCount)}★ · ${agg.bathroomCount} rating${agg.bathroomCount===1?'':'s'}${fallback?'<br><small>Driving route unavailable; using straight-line distance.</small>':''}<div class="now-actions"><button class="btn btn-primary" id="bathroom-now-directions">🧭 Get Directions</button><button class="btn btn-secondary" id="bathroom-now-view">View pin</button></div></div>`;
}
let userMarker=null;
const locateBtn=document.getElementById('locateBtn'),nearestInfo=document.getElementById('nearestInfo');
let suppressNextLocateClick=false;
function showBathroomNowResult(result,fallback=false){
  nearestInfo.style.display='block'; nearestInfo.innerHTML=bathroomNowCard(result,fallback);
  document.getElementById('bathroom-now-view').onclick=()=>zoomToMarker(markers[result.loc.id]);
  document.getElementById('bathroom-now-directions').onclick=()=>{const pref=localStorage.getItem('preferredNavApp')||'google';window.open(buildNavUrl(pref,result.loc.lat,result.loc.lng),'_blank','noopener');};
  zoomToMarker(markers[result.loc.id]);
}
locateBtn.addEventListener('click',()=>{
  if(suppressNextLocateClick)return;
  if(!navigator.geolocation){nearestInfo.style.display='block';nearestInfo.textContent="Your browser doesn't support location.";return;}
  locateBtn.disabled=true;locateBtn.textContent='🚽 Finding bathroom…';nearestInfo.style.display='none';
  navigator.geolocation.getCurrentPosition(async pos=>{
    const user={lat:pos.coords.latitude,lng:pos.coords.longitude};lastKnownPos={...user,ts:Date.now()};currentListPosition=lastKnownPos;
    if(userMarker)map.removeLayer(userMarker);
    userMarker=L.marker([user.lat,user.lng],{icon:L.divIcon({className:'',html:'<div style="background:#2196f3;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.6);"></div>',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(map);
    const candidates=[...seedLocations].map(loc=>({loc,d:milesBetween(user.lat,user.lng,loc.lat,loc.lng)})).sort((a,b)=>a.d-b.d).slice(0,10).map(x=>x.loc);
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
