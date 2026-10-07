// ═══════════════════════════════════════════════════════════════════
//  Chauat Go Service Worker — FORCE UPDATE EDITION v3.3.0
//  ⚠️ เปลี่ยน CACHE_VERSION ทุกครั้งที่ deploy!
// ═══════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'chauat-v3.3.0'; // ← เปลี่ยนเลขทุกครั้ง!
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json'
];

// ─── Install: บังคับให้ SW ใหม่接管ทันที ───
self.addEventListener('install', event => {
  console.log('[SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => {
        console.log('[SW] Force skipWaiting');
        return self.skipWaiting();
      })
  );
});

// ─── Activate: ลบ cache เก่าทั้งหมด ───
self.addEventListener('activate', event => {
  console.log('[SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      })
  );
});

// ─── Fetch: Network-first สำหรับ HTML ───
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ข้าม Firebase, Google, unpkg
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('unpkg')) {
    return;
  }

  // HTML / navigation → Network-first ไม่ cache
  if (request.mode === 'navigate' ||
      (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .catch(() => caches.match(request).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  // Static → Cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok && request.method === 'GET') {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        if (request.destination === 'style') return new Response('', { headers: { 'Content-Type': 'text/css' } });
        if (request.destination === 'script') return new Response('', { headers: { 'Content-Type': 'application/javascript' } });
      });
    })
  );
});

// ─── Message handler ───
self.addEventListener('message', event => {
  console.log('[SW] Message:', event.data);
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'FORCE_UPDATE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.skipWaiting())
      .then(() => self.clients.claim());
  }
});