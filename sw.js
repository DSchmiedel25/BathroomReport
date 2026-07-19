const CACHE_NAME = 'bathroomreport-v11';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './firebase.js',
  './stewarts-locations.js',
  './cumberland-farms-locations.js',
  './wawa-locations.js',
  './fastrac-locations.js',
  './alltownfresh-locations.js',
  './byrne-dairy-locations.js',
  './parkers-locations.js',
  './sheetz-locations.js',
  './racetrac-locations.js',
  './app.js',
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
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;

  // Stale-while-revalidate: serve the cached copy immediately when we have one (so
  // repeat visits don't re-download ~1 MB of chain data every load), and refresh that
  // copy from the network in the background so the *next* load is up to date. On a cache
  // miss we go to the network and cache the result; if the network is unreachable we fall
  // back to index.html so navigations still work offline. The cache is versioned
  // (CACHE_NAME), so bump the version on any deploy to force fresh files through.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const networkFetch = fetch(event.request)
          .then(response => {
            if(response && response.status === 200){
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => cached || caches.match('./index.html'));
        // Cached hit → instant response now, revalidation continues in the background.
        // Cached miss → wait for the network (with the offline fallback above).
        return cached || networkFetch;
      })
    )
  );
});
