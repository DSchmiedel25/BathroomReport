/* Tiles live apart from the app cache and are NOT versioned with it. Bumping CACHE_NAME on a
 * nightly bake would otherwise discard every tile the person had accumulated — the one thing
 * here that is expensive to reacquire and never goes stale.
 *
 * The cap is a rough guard, not a budget: roughly 3,000 tiles is a few hundred MB at most and
 * covers a lot of driving, and browsers evict the whole origin long before that becomes a
 * problem. Without any cap a cross-country trip would grow it without limit. */
const TILE_CACHE = 'bathroomreport-tiles-v1';
const TILE_MAX = 3000;
let _trimQueued = false;
function trimTiles(){
  /* Debounced: a single pan fires dozens of tile requests and counting keys on every one would
   * be more expensive than the caching it guards. */
  if(_trimQueued) return;
  _trimQueued = true;
  setTimeout(() => {
    _trimQueued = false;
    caches.open(TILE_CACHE).then(cache => cache.keys().then(keys => {
      if(keys.length <= TILE_MAX) return;
      /* Oldest first — cache.keys() returns insertion order, so the front of the list is the
       * least recently ADDED. Not true LRU, but a tile you cached a thousand tiles ago is a
       * fair thing to drop and this costs one pass. */
      return Promise.all(keys.slice(0, keys.length - TILE_MAX).map(k => cache.delete(k)));
    })).catch(() => {});
  }, 5000);
}

const CACHE_NAME = 'bathroomreport-v309';

// CORE SHELL ONLY — deliberately does NOT precache the chain data files.
// Precaching all ~5.6 MB of location data forced a full re-download on every cache
// bump, and the nightly bake bumps the cache most nights. The fetch handler below
// already caches data files (stale-while-revalidate) the first time they're used,
// so repeat visits stay instant without shipping the whole fleet on every install.
// Bonus: this list no longer drifts out of date when chains are added or renamed.
// (Real offline support, when built, should be an opt-in download — see roadmap.)
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './shell.css',
  './logo.png',
  './icon-x.png',
  './icon-cashapp.png',
  './firebase.js',
  './app.js',
  // Vendored map plugins. Same-origin now, so they can be precached — as unpkg URLs they were
  // cross-origin and the shell could never be genuinely offline-capable.
  './leaflet-doubletapdrag.js',
  './leaflet-doubletapdragzoom.js',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  // Cache each file independently rather than cache.addAll (which fails the ENTIRE
  // install if even one URL 404s — this is exactly what happened when locations.js
  // was renamed during the multi-chain refactor, silently breaking every update since).
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(APP_SHELL.map(url =>
        cache.add(url).catch(err => console.warn('sw precache skipped (not fatal):', url, err))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    /* Spare the tile cache. This filter used to delete every cache whose name was not the current
     * one, which would have wiped the tiles on the very next deploy — the exact thing they are
     * kept in a separate bucket to avoid. */
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME && key !== TILE_CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  /* MAP TILES — cache-first, in their own bucket.
   *
   * Tiles are cross-origin so the same-origin guard below would skip them, which is why the map
   * went grey with no signal even though the pins and the app shell survived. A tile never
   * changes once rendered, so cache-first is correct and there is nothing to revalidate.
   *
   * This is the FREE half of offline maps: wherever you have already looked keeps working. It
   * does not let you download a region before leaving — that needs a UI, a size estimate and
   * storage management, and is a separate feature.
   *
   * Separate cache name so the nightly app-cache bump does not throw away tiles that are still
   * perfectly good, and so the cap below can evict tiles without touching the shell. */
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url.href)){
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(hit => {
          if(hit) return hit;
          return fetch(event.request).then(res => {
            /* Opaque responses (status 0) are cached deliberately: tiles are served without
             * CORS headers, so this is the only form they come in. They cost more quota than
             * they should, which is what the cap is for. */
            if(res && (res.status === 200 || res.type === 'opaque')){
              cache.put(event.request, res.clone());
              trimTiles();
            }
            return res;
          }).catch(() => hit || Response.error());
        })
      )
    );
    return;
  }

  if(url.origin !== self.location.origin) return;

  const path = url.pathname;

  // CODE + SHELL → network-first. The app's own code (app.js, the stylesheets, firebase.js)
  // and every navigation always try the network first, so a new deploy takes effect on the
  // very next load instead of waiting for a cache cycle. Falls back to cache when offline.
  // This is what prevents stale old code (e.g. a removed bulk read) from lingering.
  const isCodeShell = event.request.mode === 'navigate'
    || path === '/'
    || /\/(index\.html|app\.js|shell\.css|styles\.css|firebase\.js)$/.test(path);

  if(isCodeShell){
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        fetch(event.request)
          .then(response => {
            if(response && response.status === 200) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cache.match(event.request).then(c => {
            if(c) return c;
            // Only a NAVIGATION may fall back to the shell. Serving index.html in answer to a
            // failed app.js or shell.css request produced an HTTP 200 full of HTML, so the
            // browser reported success and then failed to parse it — a blank or half-built page
            // with no useful error. A real network error is the honest answer, and the caller
            // (or the user's reload) can act on it.
            if(event.request.mode === 'navigate') return cache.match('./index.html');
            return Response.error();
          }))
      )
    );
    return;
  }

  // EVERYTHING ELSE (big chain-data JS, images, manifest) → stale-while-revalidate: serve the
  // cached copy instantly so repeat visits don't re-download ~1 MB of data, and refresh it in
  // the background for next time.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const networkFetch = fetch(event.request)
          .then(response => {
            if(response && response.status === 200) cache.put(event.request, response.clone());
            return response;
          })
          /* Do NOT fall back to the app shell here. This branch serves data files, images and the
           * manifest — handing any of them index.html produces an HTTP 200 full of HTML that the
           * browser reports as a success and then fails to parse, and cache poisoning behaviour
           * on top. A real network error is the honest answer.
           *
           * I fixed the code-shell branch above for exactly this and reported PWA-01 done while
           * leaving this one, which is the branch that actually serves the 40 location datasets. */
          .catch(() => cached || Response.error());
        return cached || networkFetch;
      })
    )
  );
});
