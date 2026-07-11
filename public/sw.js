const CACHE_NAME = 'gridline-v2';
const ASSETS = [
  '/',
  '/tracker.html',
  '/dsa.html',
  '/manifest.json'
];

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Using a mapped try/catch layer to ensure optional asset failures don't halt installation
      return Promise.all(
        ASSETS.map(url => {
          return cache.add(url).catch(err => console.log(`Skipped optional asset: ${url}`));
        })
      );
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});