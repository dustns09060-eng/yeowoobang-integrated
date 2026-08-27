/* V117 */
const CACHE = "yeowoobang-v152-invite-priority";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=1500",
  "./app.js?v=1520",
  "./pumasi-config.js?v=1520",
  "./supabase-auth-v107.js?v=1330",
  "./supabase-auth-v107.json?v=1200",
  "./backend-adapter-v106.js?v=1330",
  "./manifest.json",
  "./app-logo-v20.png",
  "./favicon-v20.png",
  "./icon-192-v20.png",
  "./icon-512-v20.png"
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Apps Script/Google/외부 라이브러리는 SW가 가로채지 않습니다.
  if (
    url.hostname.includes("script.google.com") ||
    url.hostname.includes("googleusercontent.com") ||
    url.hostname.includes("docs.google.com") ||
    url.hostname.includes("cdn.jsdelivr.net")
  ) {
    return;
  }

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
