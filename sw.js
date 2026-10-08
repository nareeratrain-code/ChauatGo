const CACHE_NAME = 'chauat-app-v3.3.0'; // ⭐ เปลี่ยน Version เพื่อบังคับ Update
const ASSETS = [
  '/merchant.html',
  '/merchant.css',
  '/merchant.js',
  '/admin.html',    // ⭐ เพิ่มหน้า Admin
  '/index.html',    // ⭐ เพิ่มหน้า Index
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // ⭐ ไม่ Cache ไฟล์ Firebase API
  if (e.request.url.includes('firestore.googleapis.com') || 
      e.request.url.includes('identitytoolkit.googleapis.com')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, response.clone());
          return response;
        });
      });
    }).catch(() => {
      // Fallback: ถ้าโหลดไม่ได้ ให้ลองดึงจาก Cache ของหน้านั้นๆ
      const url = new URL(e.request.url);
      const page = url.pathname.split('/').pop() || 'index.html';
      return caches.match('/' + page) || caches.match('/index.html');
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'FORCE_UPDATE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});