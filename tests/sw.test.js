// app/sw.js — 웹 푸시 (6.0 지시서 약속 1, B6): the push shows one fixed line whatever arrives, a tap opens only this app's
// saved tab — with the top bar's bell panel open (a fixed mark, 2026-10-20) — and the install list names only files that exist
// (one missing file makes the whole install fail).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP = path.join(__dirname, "../app");
const SRC = fs.readFileSync(path.join(APP, "sw.js"), "utf8");
const TITLE = "관심 시술 가격이 바뀌었어요";
// objects made inside the vm come from another realm: compare them as plain JSON
const plain = (v) => JSON.parse(JSON.stringify(v));

// a fake service worker global: records handlers, notifications, window messages and opened URLs
function worker({ windows = [] } = {}) {
  const on = {}, shown = [], opened = [], matched = [];
  const clients = windows.map((url) => ({ url, msgs: [], focused: 0,
    postMessage(m) { this.msgs.push(plain(m)); }, focus() { this.focused++; return Promise.resolve(this); } }));
  const self = {
    addEventListener: (t, f) => { on[t] = f; },
    skipWaiting: () => Promise.resolve(),
    caches: { open: async () => ({ addAll: async () => {}, put: async () => {} }), keys: async () => [], delete: async () => true, match: async () => undefined },
    location: new URL("https://app.test/sw.js"),
    fetch: async () => { throw new Error("no network in tests"); },
    URL,
    registration: { scope: "https://app.test/", showNotification(title, opts) { const p = Promise.resolve(); shown.push({ title, opts: plain(opts), p }); return p; } },
    clients: {
      matchAll: async (o) => { matched.push(plain(o)); return clients; },
      openWindow: async (u) => { opened.push(u); return null; },
      claim: async () => {},
    },
  };
  self.self = self;
  const ctx = vm.createContext(self);
  vm.runInContext(SRC, ctx, { filename: "sw.js" });
  const top = plain(vm.runInContext("({ VER, SHELL })", ctx));   // top-level consts live in the context's script scope
  return { on, shown, opened, matched, clients, ...top };
}

function push(w, data) {
  const waited = [];
  w.on.push({ data, waitUntil: (p) => waited.push(p) });
  return waited;
}

async function click(w, data = { url: "./#saved" }) {
  const waited = [], note = { data, closed: 0, close() { this.closed++; } };
  w.on.notificationclick({ notification: note, waitUntil: (p) => waited.push(p) });
  assert.equal(waited.length, 1, "notificationclick must hand its work to waitUntil");
  await waited[0];
  return note;
}

test("handlers: install/activate/fetch still register, plus push and notificationclick — no pushsubscriptionchange", () => {
  const w = worker();
  for (const t of ["install", "activate", "fetch", "push", "notificationclick"]) assert.equal(typeof w.on[t], "function", t);
  // the worker cannot read the subscription id kept in localStorage, so it must not try to re-subscribe over the network
  assert.equal(w.on.pushsubscriptionchange, undefined);
});

test("push: always the fixed title, tag pc-push, the promise goes to waitUntil, any payload is ignored", () => {
  const seen = [];
  for (const data of [null, undefined, { text: () => "광고", json: () => ({ title: "광고", body: "광고", url: "https://evil.test/" }) }]) {
    const w = worker();
    const waited = push(w, data);
    assert.equal(w.shown.length, 1);
    const n = w.shown[0];
    assert.equal(waited.length, 1, "showNotification must be passed to e.waitUntil");
    assert.equal(waited[0], n.p);
    assert.equal(n.title, TITLE);
    assert.equal(n.opts.tag, "pc-push");
    assert.deepEqual(n.opts.data, { url: "./#saved" });
    assert.ok(!JSON.stringify(n).includes("광고") && !JSON.stringify(n).includes("evil"), "payload text leaked into the notification");
    seen.push(JSON.stringify({ title: n.title, opts: n.opts }));
  }
  assert.equal(new Set(seen).size, 1, "the notification must be identical with or without a payload");
  // the icons it names are real files
  const n = worker(); push(n, null);
  for (const f of [n.shown[0].opts.icon, n.shown[0].opts.badge]) assert.ok(fs.existsSync(path.join(APP, f)), f);
});

test("notificationclick with the app open: close, tell that window to go to saved with the bell panel, focus it — no new window", async () => {
  const w = worker({ windows: ["https://other.test/", "https://app.test.evil.test/", "https://app.test/#home"] });
  const note = await click(w, { url: "https://evil.test/" });
  assert.equal(note.closed, 1);
  assert.deepEqual(w.matched, [{ type: "window", includeUncontrolled: true }]);
  const [other, lookalike, app] = w.clients;
  assert.deepEqual(app.msgs, [{ type: "nav", to: "saved", panel: true }]);
  assert.equal(app.focused, 1);
  for (const c of [other, lookalike]) assert.deepEqual([c.msgs.length, c.focused], [0, 0], c.url);
  assert.deepEqual(w.opened, []);
});

test("notificationclick with no app window: open exactly the saved tab with the bell panel mark in scope, never a URL from the notification", async () => {
  for (const windows of [[], ["https://other.test/app/"]]) {
    const w = worker({ windows });
    const note = await click(w, { url: "https://evil.test/" });
    assert.equal(note.closed, 1);
    assert.deepEqual(w.opened, ["https://app.test/#saved?bell=1"]);
    assert.deepEqual(w.clients.map((c) => c.msgs.length + c.focused), windows.map(() => 0));
  }
});

test("VER is a pc-v<number> from 28 on (the push handlers) and every SHELL file exists under app/ (one missing file breaks install)", () => {
  const w = worker();
  // a change to a cache-first file (gate.js, the SHELL list) needs a new VER; the exact number is not pinned here
  assert.match(w.VER, /^pc-v\d+$/);
  assert.ok(+w.VER.slice(4) >= 28, w.VER);
  assert.ok(w.SHELL.includes("domain/push.js"));
  assert.equal(w.SHELL.indexOf("domain/push.js"), w.SHELL.indexOf("domain/metrics.js") + 1);
  assert.equal(new Set(w.SHELL).size, w.SHELL.length, "duplicate SHELL entry");
  for (const f of w.SHELL) {
    if (f === "./") continue;
    // domain/push.js is being written in parallel (B6, app side); until it lands only its place in SHELL is checked above
    assert.ok(fs.existsSync(path.join(APP, f)), `SHELL names a missing file: ${f}`);
  }
});

test("fetch still leaves other origins (the alerts address) and non-GET requests to the network", () => {
  const w = worker();
  for (const req of [{ url: "https://alerts.example.test/v1/sub", method: "POST" }, { url: "https://alerts.example.test/v1/sub", method: "GET" },
    { url: "https://app.test/index.html", method: "POST" }]) {
    let responded = 0;
    w.on.fetch({ request: req, respondWith: () => { responded++; } });
    assert.equal(responded, 0, `${req.method} ${req.url}`);
  }
});
