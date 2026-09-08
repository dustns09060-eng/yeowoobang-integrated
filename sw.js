/* V241 - 정리/캐시 안정화 */
const CACHE = "yeowoobang-v247-top3-center-more-up";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=2472",
  "./app.js?v=2472",
  "./manifest.json?v=720",
  "./app-logo-v20.png?v=430",
  "./favicon-v20.png?v=430",
  "./icon-192-v20.png?v=430",
  "./icon-512-v20.png?v=430",
  "./top3_scene_v243.jpg?v=2472",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // 외부 API/Google 리소스는 Service Worker가 가로채지 않습니다.
  if (
    url.hostname.includes("script.google.com") ||
    url.hostname.includes("googleusercontent.com") ||
    url.hostname.includes("docs.google.com") ||
    url.hostname.includes("cdn.jsdelivr.net")
  ) {
    return;
  }

  // 페이지 이동은 항상 네트워크 우선
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE).then((cache) => cache.put("./index.html", response.clone()));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // 정적 자원은 캐시 우선 + 백그라운드 갱신
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
