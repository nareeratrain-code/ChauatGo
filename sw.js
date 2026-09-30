// Chauat Go Service Worker v1.0
const CACHE_NAME = 'chauat-go-v1';
const TILE_CACHE_NAME = 'chauat-go-tiles-v1';
const TILE_URL_PATTERN = /tile\.openstreetmap\.org/;
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(err => { console.warn('[SW] Failed to cache some assets:', err); });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter(name => name.startsWith('chauat-go-') && name !== CACHE_NAME && name !== TILE_CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Map tiles - Network-first with cache fallback
  if (TILE_URL_PATTERN.test(url.hostname)) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then((cache) => {
        return fetch(event.request).then((response) => {
          if (response.ok) { cache.put(event.request, response.clone()); }
          return response;
        }).catch(() => { return cache.match(event.request); });
      })
    );
    return;
  }

  // 2. Static assets - Cache-first
  if (STATIC_ASSETS.some(asset => url.pathname.endsWith(asset) || url.pathname === asset)) {
    event.respondWith(caches.match(event.request).then((response) => { return response || fetch(event.request); }));
    return;
  }

  // 3. Everything else - Network-first with stale-while-revalidate
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => { cache.put(event.request, responseClone); });
      }
      return response;
    }).catch(() => { return caches.match(event.request); })
  );
});
