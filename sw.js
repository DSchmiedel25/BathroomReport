const CACHE_NAME = 'bathroomreport-v4';
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

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html')))
  );
});
