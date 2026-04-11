const CACHE_NAME = 'melodify-v1';
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
  if (!e.request.url.includes('/api') && !e.request.url.includes('/chunk') && !e.request.url.includes('youtube') && e.request.method === 'GET') {
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
