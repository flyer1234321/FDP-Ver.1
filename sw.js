const CACHE = 'fdp-v13';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(['./', './index.html', './manifest.json', './icon.svg']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(networkResponse => {
      const clone = networkResponse.clone();
      caches.open(CACHE).then(cache => cache.put(e.request, clone));
      return networkResponse;
    }).catch(() => {
      return caches.match(e.request);
    })
  );
});

