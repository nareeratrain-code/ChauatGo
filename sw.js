const CACHE_NAME = 'chauat-app-v3.9.2';

// Shell for customer, merchant, admin, rider, and boss.
// Do not list files that are not deployed. cache.addAll rejects the whole
// install when any URL 404s, and a rejected install leaves the previous
// worker (and its cache) in control forever. /merchant.css was removed;
// merchant styles live inline in merchant.html.
const ASSETS = [
  '/',
  '/index.html',
  '/locations-data.js',
  '/merchant.html',
  '/merchant.js',
  '/admin.html',
  '/admin.css',
  '/admin.js',
  '/rider.html',
  '/rider.css',
  '/rider.js',
  '/boss.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

function isFirebaseRequest(url) {
  const host = url.hostname;
  return host.includes('firebase') ||
    host.includes('firestore') ||
    host.startsWith('identitytoolkit.') ||
    host.startsWith('securetoken.') ||
    host.startsWith('firebaseinstallations.') ||
    host.startsWith('fcmregistrations.') ||
    host === 'fcm.googleapis.com' ||
    host.endsWith('firebasestorage.app');
}

function isAppCode(url, request) {
  if (request.mode === 'navigate') return true;
  return /\.(?:html|js|css|json)$/i.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // A single missing file must not block the update.
    await Promise.all(ASSETS.map(async (asset) => {
      try {
        await cache.add(asset);
      } catch (err) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const stale = keys.filter((key) => key !== CACHE_NAME);
    await Promise.all(stale.map((key) => caches.delete(key)));
    await self.clients.claim();
    // Open tabs were painted by the previous worker. Reload them once an
    // older cache was actually deleted. Navigate only after this waitUntil
    // settles — awaiting client.navigate() here deadlocks activation,
    // because the navigation waits for the worker to finish activating.
    if (!stale.length) return;
    setTimeout(() => {
      self.clients.matchAll({ type: 'window' }).then((windows) => {
        for (const client of windows) {
          if (typeof client.navigate !== 'function') continue;
          if (!client.url || client.url.indexOf('http') !== 0) continue;
          client.navigate(client.url).catch(() => {});
        }
      });
    }, 0);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // Firebase API calls stay on the network and are never written to Cache Storage.
  if (isFirebaseRequest(url)) return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js' || url.pathname === '/sw-admin.js') return;

  event.respondWith(networkFirst(request, url));
});

function freshRequest(request, url) {
  if (!isAppCode(url, request)) return request;
  return new Request(url.href, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'follow'
  });
}

async function putCache(cache, url, response) {
  if (!response || !response.ok || response.type === 'opaque' || response.type === 'opaqueredirect') return;
  let body = response.clone();
  // cache.put rejects redirected responses. Rebuild a plain 200 and drop
  // content-encoding so a decoded body is not stored as if it were gzip.
  if (response.redirected) {
    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    body = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
  }
  try {
    await cache.put(new Request(url.href, { method: 'GET' }), body);
  } catch (err) {}
}

async function matchCached(request, url) {
  const exact = await caches.match(request);
  if (exact) return exact;
  const path = await caches.match(url.origin + url.pathname);
  if (path) return path;
  if (request.mode === 'navigate' || url.pathname === '/' || /\.html$/i.test(url.pathname)) {
    if (url.pathname === '/' || url.pathname === '') {
      return (await caches.match('/index.html')) || (await caches.match('/'));
    }
    return (await caches.match(url.pathname)) || (await caches.match('/index.html'));
  }
  return undefined;
}

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(freshRequest(request, url));
    await putCache(cache, url, response);
    return response;
  } catch (err) {
    const cached = await matchCached(request, url);
    if (cached) return cached;
    return Response.error();
  }
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'FORCE_UPDATE') {
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
  }
});
