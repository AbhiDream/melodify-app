const CACHE_NAME = 'melodify-v3';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon.png'];

// On install, cache core assets and immediately activate
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

// On activate, delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: only cache static navigation pages, pass everything else through
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Pass ALL API calls and dynamic routes straight to network — never cache them
  const passThrough = ['/search', '/trending', '/chunk', '/api', '/info', '/health'];
  if (passThrough.some(p => url.pathname.startsWith(p))) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.ok) {
          caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
        }
        return res;
      });
    }).catch(() => caches.match('/index.html'))
  );
});
