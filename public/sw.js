const CACHE_NAME = 'melodify-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  // Only intercept static assets and navigation, bypass API and chunks
  const u = e.request.url;
  if (!u.includes('/api') && !u.includes('/chunk') && !u.includes('youtube') && !u.includes('/search') && !u.includes('/trending') && e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then((res) => {
        return res || fetch(e.request).then((fetchRes) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, fetchRes.clone());
            return fetchRes;
          });
        });
      }).catch(() => caches.match('/index.html')) // fallback
    );
  }
});
