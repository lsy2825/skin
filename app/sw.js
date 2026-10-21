// Offline cache: the app shell (code network-first, images cache-first) and map tiles. data.json / data-meta.json / home.json are not
// handled here: app.js saves a checked copy of the price file itself and says when it shows that saved copy offline.
const VER = "pc-v32";   // v32: screens/branch.js and screens/me.js join the install list (app.js split 3-5·3-6; v31: about.js, concern.js, map.js — 3-2~3-4)
// Pretendard's subset files are cached the first time a page needs them (the font CSS loads only the ranges in use).
// round-2 O5: the install list is what the app needs to START and to run offline. Code loaded later (commerce screens, the
// map library, large Jomi portraits) is cached the first time it is used — installing it up front undid the lazy loading.
const SHELL = ["./", "index.html", "styles.css", "icons.js", "core.js", "state/data.js", "screens/ops.js", "screens/about.js", "screens/concern.js", "screens/map.js", "screens/branch.js", "screens/me.js", "app.js", "gate.js", "auth.js", "config.js", "domain/pricing.js", "domain/search.js", "domain/intel.js", "domain/concern.js", "domain/stats.js", "domain/jomichat.js", "domain/jomilines.js", "domain/spec.js", "domain/sync.js", "domain/classify.js", "domain/metrics.js", "domain/push.js", "terms.js",
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
  // other origins (sign-in, the metrics address, the alerts address, anything with a user's token) are never cached; map tiles are the one exception
  if (u.origin !== location.origin && !u.hostname.endsWith("tile.openstreetmap.org")) return;
  const net = u.hostname.endsWith("tile.openstreetmap.org") || u.pathname.endsWith("app.js") || u.pathname.endsWith("core.js") || u.pathname.includes("/state/") || u.pathname.includes("/screens/") || u.pathname.endsWith("styles.css") || u.pathname.endsWith("icons.js") || u.pathname.endsWith("jomi.js") || u.pathname.endsWith("auth.js") || u.pathname.endsWith("commerce.js") || u.pathname.endsWith("config.js") || u.pathname.includes("/domain/") || u.pathname.includes("/workers/") || u.pathname.endsWith("index.html") || u.pathname.endsWith("/");
  if (net) {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VER).then((x) => x.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { if (r.ok && u.origin === location.origin) { const c = r.clone(); caches.open(VER).then((x) => x.put(e.request, c)); } return r; })));
  }
});
// Web push (6.0 contract 1, B6): the server sends an EMPTY push, so the text shown is always this fixed line — never anything from a
// payload, even if one arrives (a leaked key must not be able to put its own words or links on a phone). One tag so repeats collapse.
const PUSH_TITLE = "관심 시술 가격이 바뀌었어요";
const PUSH_BODY = "관심 탭에서 확인해 보세요";
self.addEventListener("push", (e) => {
  // waitUntil is required: a userVisibleOnly push that shows nothing makes Chrome post its own generic notice instead
  e.waitUntil(self.registration.showNotification(PUSH_TITLE, { body: PUSH_BODY, tag: "pc-push", icon: "icons/icon-192.png", badge: "icons/favicon-32.png", data: { url: "./#saved" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  // the target is fixed to the saved tab inside this app's scope — never a URL from the notification or the payload.
  // An open window is told to go there by message (WindowClient.navigate support on Safari is uncertain) and focused.
  // Both ways open the top bar's bell panel there (2026-10-20): the notification says nothing, the panel says
  // which alert it was — a fixed mark (panel: true / '?bell=1'), which app.js takes off the address once the panel is open
  const scope = self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    const w = ws.find((c) => typeof c.url === "string" && c.url.startsWith(scope));
    if (w) { w.postMessage({ type: "nav", to: "saved", panel: true }); return w.focus(); }
    return self.clients.openWindow(new URL("./#saved?bell=1", scope).href);
  }));
});
// No pushsubscriptionchange handler on purpose: the worker cannot read the subscription id the app keeps in localStorage, so it
// cannot tell the server which row to replace — the app re-checks and re-sends its subscription on its next start.
