const CACHE = 'yeowoobang-v700-fast';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=700',
  './app.js?v=700',
  './config.json',
  './manifest.json',
  './favicon-v20.png',
  './icon-192-v20.png',
  './icon-512-v20.png',
  './app-logo-v20.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(ASSETS.map((asset) => cache.add(asset)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleusercontent.com') ||
    url.hostname.includes('docs.google.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            if (response && response.ok) {
              caches.open(CACHE).then((cache) => cache.put('./index.html', response.clone()));
            }
            return response;
          })
          .catch(() => cached || caches.match('./'));
        return cached || network;
      })
    );
    return;
  }

  // 정적 파일은 캐시를 즉시 보여주고 최신본은 백그라운드 갱신
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
