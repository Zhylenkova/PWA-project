/* FoodSpot Service Worker v1.0 */
const CACHE = 'foodspot-v1';
const CDN_CACHE = 'foodspot-cdn-v1';
const STATIC = ['/', '/index.html', '/manifest.json', '/icons/icon-192x192.png', '/icons/icon-512x512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== CDN_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.startsWith('chrome-extension')) return;

  const url = new URL(e.request.url);
  const isCDN = ['cdn.jsdelivr.net','unpkg.com','tile.openstreetmap.org','fonts.googleapis.com','fonts.gstatic.com'].some(h => url.hostname.includes(h));

  if (isCDN) {
    e.respondWith(
      caches.open(CDN_CACHE).then(c =>
        c.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => cached);
        })
      )
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      });
      return cached || net;
    }).catch(() => caches.match('/index.html'))
  );
});
