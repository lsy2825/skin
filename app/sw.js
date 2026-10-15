// Offline cache: the app shell (code network-first, images cache-first) and map tiles. data.json / data-meta.json / home.json are not
// handled here: app.js saves a checked copy of the price file itself and says when it shows that saved copy offline.
const VER = "pc-v27";
// Pretendard's subset files are cached the first time a page needs them (the font CSS loads only the ranges in use).
// round-2 O5: the install list is what the app needs to START and to run offline. Code loaded later (commerce screens, the
// map library, large Jomi portraits) is cached the first time it is used — installing it up front undid the lazy loading.
const SHELL = ["./", "index.html", "styles.css", "icons.js", "core.js", "state/data.js", "screens/ops.js", "app.js", "gate.js", "auth.js", "config.js", "domain/pricing.js", "domain/search.js", "domain/intel.js", "domain/concern.js", "domain/stats.js", "domain/jomichat.js", "domain/jomilines.js", "domain/spec.js", "domain/sync.js", "domain/classify.js", "domain/metrics.js", "terms.js",
  "vendor/fonts/pretendard/pretendard.css", "manifest.webmanifest",
  "icons/icon-192.png", "jomi.js", "assets/jomi/expr-default-160.png",
  "assets/jomi/expr-default-96.webp", "assets/jomi/expr-welcome-96.webp", "assets/jomi/expr-curious-96.webp", "assets/jomi/expr-thinking-96.webp", "assets/jomi/expr-happy-96.webp", "assets/jomi/expr-wink-96.webp", "assets/jomi/expr-empty-96.webp", "assets/jomi/expr-sleeping-96.webp", "icons/favicon-32.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  // only THIS app's old shell caches go (pc-v*): the checked price copy (pc-data-*) stays, and so does any cache of another app
  // served from the same origin (round-2 O5: the old filter deleted every other cache)
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => /^pc-v\d+$/.test(k) && k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.origin === location.origin && /\/(data(-meta)?|home|review)\.json$/.test(u.pathname)) return;   // price files: app.js keeps its own checked copy (PRICE_SYNC_ARCHITECTURE.md); home.json: read once on a first visit, never kept (O2); review.json: always the latest build
  if (u.hostname === "api.github.com") return;   // collection-run status: live from GitHub, never from a cache (ADMIN_OPERATIONS_SPEC.md)
  // other origins (sign-in, the metrics address, anything with a user's token) are never cached; map tiles are the one exception
  if (u.origin !== location.origin && !u.hostname.endsWith("tile.openstreetmap.org")) return;
  const net = u.hostname.endsWith("tile.openstreetmap.org") || u.pathname.endsWith("app.js") || u.pathname.endsWith("core.js") || u.pathname.includes("/state/") || u.pathname.includes("/screens/") || u.pathname.endsWith("styles.css") || u.pathname.endsWith("icons.js") || u.pathname.endsWith("jomi.js") || u.pathname.endsWith("auth.js") || u.pathname.endsWith("commerce.js") || u.pathname.endsWith("config.js") || u.pathname.includes("/domain/") || u.pathname.includes("/workers/") || u.pathname.endsWith("index.html") || u.pathname.endsWith("/");
  if (net) {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VER).then((x) => x.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { if (r.ok && u.origin === location.origin) { const c = r.clone(); caches.open(VER).then((x) => x.put(e.request, c)); } return r; })));
  }
});
