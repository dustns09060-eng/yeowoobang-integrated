/* V256-3.2 - Service Worker 응답 clone 오류/로그인 API 캐시 제외 */
const CACHE = "yeowoobang-v256-3-2";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=2501",
  "./app.js?v=25631",
  "./manifest.json?v=720",
  "./app-logo-v20.png?v=430",
  "./favicon-v20.png?v=430",
  "./icon-192-v20.png?v=430",
  "./icon-512-v20.png?v=430",
  "./top3_scene_v243.jpg?v=2501",
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
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // V256-3.2: 외부 요청/API/Supabase/Google은 SW가 절대 가로채지 않음.
  if (
    url.origin !== self.location.origin ||
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("supabase.in") ||
    url.hostname.includes("script.google.com") ||
    url.hostname.includes("googleusercontent.com") ||
    url.hostname.includes("docs.google.com") ||
    url.hostname.includes("cdn.jsdelivr.net")
  ) return;

  // 페이지 이동: network-first.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(req);
        if (response && response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put("./index.html", copy))
          );
        }
        return response;
      } catch (_) {
        return (await caches.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  // 동일 출처 정적 자원만 stale-while-revalidate.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const networkPromise = fetch(req).then((response) => {
      if (response && response.ok) {
        // body가 소비되기 전에 즉시 clone.
        const copy = response.clone();
        event.waitUntil(
          caches.open(CACHE).then((cache) => cache.put(req, copy))
        );
      }
      return response;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(networkPromise.then(() => undefined));
      return cached;
    }
    return (await networkPromise) || Response.error();
  })());
});
