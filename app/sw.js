// Offline cache: the app shell is cache-first, data.json and map tiles are network-first (fall back to the last copy).
const VER = "pc-v10";
// Pretendard's subset files are cached the first time a page needs them (the font CSS loads only the ranges in use)
const SHELL = ["./", "index.html", "styles.css", "icons.js", "app.js", "gate.js", "auth.js", "config.js", "domain/pricing.js", "domain/search.js", "domain/intel.js", "domain/concern.js",
  "vendor/fonts/pretendard/pretendard.css", "manifest.webmanifest", "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "icons/icon-192.png", "jomi.js", "assets/jomi/jomi-face-96.webp", "assets/jomi/jomi-face-160.png", "assets/jomi/jomi-portrait-360.webp", "icons/favicon-32.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const net = u.pathname.endsWith("data.json") || u.hostname.endsWith("tile.openstreetmap.org") || u.pathname.endsWith("app.js") || u.pathname.endsWith("styles.css") || u.pathname.endsWith("icons.js") || u.pathname.endsWith("jomi.js") || u.pathname.endsWith("auth.js") || u.pathname.endsWith("config.js") || u.pathname.includes("/domain/") || u.pathname.endsWith("index.html") || u.pathname.endsWith("/");
  if (net) {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VER).then((x) => x.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { if (r.ok && u.origin === location.origin) { const c = r.clone(); caches.open(VER).then((x) => x.put(e.request, c)); } return r; })));
  }
});
