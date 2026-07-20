const CACHE_NAME = 'bathroomreport-v55';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './shell.css',
  './logo.png',
  './icon-x.png',
  './icon-cashapp.png',
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
          .catch(() => cache.match(event.request).then(c => c || cache.match('./index.html')))
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
          .catch(() => cached || caches.match('./index.html'));
        return cached || networkFetch;
      })
    )
  );
});
