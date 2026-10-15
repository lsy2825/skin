// domain/metrics.js — 단계별 익명 집계 (6.0 지시서 약속 2, B5): eight step names only, once a day per phone, return_7d
// decided on the phone, nothing but {"s":"<step>"} in the body, and nothing at all while it is off.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../app/domain/metrics.js");

const ON = { metrics: true, metricsApi: "https://m.example.test" };
// a fake phone: storage, a beacon that records what it was given, and a settable calendar day
function phone(cfg, { day = "2026-10-15", kept = null, queued = true } = {}) {
  const calls = { load: 0, save: 0 }, sent = [];
  let saved = kept;
  const io = {
    load: () => { calls.load++; return saved; },
    save: (v) => { calls.save++; saved = JSON.parse(JSON.stringify(v)); },
    beacon: (url, body) => { sent.push({ url, body }); return typeof queued === "function" ? queued() : queued; },
    today: () => day,
  };
  const m = M.make(cfg, io);
  return { m, sent, calls, kept: () => saved, setDay: (d) => { day = d; } };
}

test("the eight step names of the contract, nothing else", () => {
  assert.deepEqual(M.STAGES, ["open", "first_price", "compare_open", "keep_cart", "keep_fav", "keep_alert", "cart_open", "return_7d"]);
  const p = phone(ON);
  assert.equal(p.m.hit("search"), false);
  assert.equal(p.m.hit("__proto__"), false);
  assert.equal(p.sent.length, 0);
});

test("off (the default config, or no https address): no storage read or write, no beacon", () => {
  const offs = [undefined, {}, { metrics: false, metricsApi: "https://m.example.test" }, { metrics: true, metricsApi: "" },
    { metrics: true, metricsApi: "http://m.example.test" }, { metrics: true, metricsApi: "not a url" }, { metrics: "true", metricsApi: "https://m.example.test" },
    { metrics: true, metricsApi: "https://m.example.test/?u=1" }, { metrics: true, metricsApi: "https://user:pw@m.example.test" }];
  for (const cfg of offs) {
    const p = phone(cfg);
    assert.equal(p.m.on, false, JSON.stringify(cfg));
    p.m.opened();
    for (const s of M.STAGES) p.m.hit(s);
    assert.equal(p.m.pending("first_price"), false);
    assert.deepEqual([p.sent.length, p.calls.load, p.calls.save], [0, 0, 0], JSON.stringify(cfg));
  }
  // the shipped config.js is off
  const w = {}; new Function("window", require("node:fs").readFileSync(require("node:path").join(__dirname, "../app/config.js"), "utf8"))(w);
  assert.equal(M.endpoint(w.APP_CONFIG), null);
});

test("the day is the KST calendar date (the server's table), whatever the phone's time zone", () => {
  assert.equal(M.kstDay(Date.parse("2026-10-14T14:59:59Z")), "2026-10-14");
  assert.equal(M.kstDay(Date.parse("2026-10-14T15:00:00Z")), "2026-10-15", "00:00 KST");
  assert.equal(M.kstDay(Date.parse("2026-12-31T15:00:00Z")), "2027-01-01");
  assert.match(M.kstDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test("the phone's switch (user decision 2026-10-15): switched off = no storage read or write, no beacon; on again = sends", () => {
  let off = true; const calls = { load: 0, save: 0 }, sent = [];
  const m = M.make(ON, { load: () => { calls.load++; return null; }, save: () => { calls.save++; }, today: () => "2026-10-15",
    beacon: (u, b) => { sent.push(JSON.parse(b).s); return true; }, off: () => off });
  assert.equal(m.available, true);
  assert.equal(m.on, false);
  m.opened(); for (const s of M.STAGES) m.hit(s);
  assert.equal(m.pending("first_price"), false);
  assert.deepEqual([sent.length, calls.load, calls.save], [0, 0, 0]);
  off = false;
  assert.equal(m.on, true);
  m.hit("keep_fav");
  assert.deepEqual(sent, ["open", "keep_fav"]);
  // not set up: no switch to show
  assert.equal(M.make({}, { off: () => false }).available, false);
  // a switch that throws counts as not switched off (the operator setting decides)
  assert.equal(M.make(ON, { load: () => null, save: () => {}, today: () => "2026-10-15", beacon: () => true, off: () => { throw new Error("x"); } }).on, true);
});

test("the address: {metricsApi}/v1/m, a trailing slash or a base path kept as given", () => {
  assert.equal(M.endpoint(ON), "https://m.example.test/v1/m");
  assert.equal(M.endpoint({ metrics: true, metricsApi: "https://m.example.test/" }), "https://m.example.test/v1/m");
  assert.equal(M.endpoint({ metrics: true, metricsApi: "https://x.workers.dev/api//" }), "https://x.workers.dev/api/v1/m");
});

test("the body is only the step name — no date, id, page or device", () => {
  const p = phone(ON, { kept: { d: "2026-10-15", s: ["open"] } });
  p.m.hit("keep_cart");
  assert.deepEqual(p.sent, [{ url: "https://m.example.test/v1/m", body: '{"s":"keep_cart"}' }]);
  assert.deepEqual(Object.keys(JSON.parse(p.sent[0].body)), ["s"]);
  for (const s of M.STAGES) assert.equal(M.body(s), JSON.stringify({ s }));
});

test("each step once a day per phone; a new day sends it again", () => {
  const p = phone(ON, { kept: { d: "2026-10-15", s: ["open"] } });
  assert.equal(p.m.hit("keep_fav"), true);
  assert.equal(p.m.hit("keep_fav"), false);
  assert.equal(p.m.hit("keep_cart"), true);
  assert.equal(p.m.pending("keep_fav"), false);
  assert.equal(p.m.pending("first_price"), true);
  const saves = p.calls.save;
  p.m.hit("keep_fav"); p.m.hit("keep_cart");
  assert.equal(p.calls.save, saves, "a step already sent today writes nothing");
  assert.deepEqual(p.sent.map((x) => JSON.parse(x.body).s), ["keep_fav", "keep_cart"]);
  p.setDay("2026-10-16");
  assert.equal(p.m.pending("keep_fav"), true);
  assert.equal(p.m.hit("keep_fav"), true);
  assert.deepEqual(p.kept(), { d: "2026-10-16", s: ["return_7d", "open", "keep_fav"] }, "the new day's first step brings its open");
});

test("return_7d: decided on the phone from the last day kept — 1 to 7 days ago, never the same day or after 8", () => {
  // same day: 'open' already went. A day kept 1 day ahead (clock or time zone moved back): hold, nothing sent, nothing moved.
  // Further ahead the kept day was wrong: a new day without return_7d.
  const cases = [[null, ["open"], "2026-10-15"], ["2026-10-15", [], "2026-10-15"], ["2026-10-14", ["return_7d", "open"], "2026-10-15"],
    ["2026-10-08", ["return_7d", "open"], "2026-10-15"], ["2026-10-07", ["open"], "2026-10-15"], ["2025-10-14", ["open"], "2026-10-15"],
    ["2026-10-16", [], "2026-10-16"], ["2026-11-30", ["open"], "2026-10-15"], ["garbage", ["open"], "2026-10-15"]];
  for (const [d, want, keptAfter] of cases) {
    const p = phone(ON, { kept: d && { d, s: ["open"] } });
    p.m.opened();
    assert.deepEqual(p.sent.map((x) => JSON.parse(x.body).s), want, String(d));
    assert.equal(p.kept().d, keptAfter, String(d));
  }
  // month and year ends count calendar days
  assert.equal(M.days("2026-12-31", "2027-01-01"), 1);
  assert.equal(M.days("2026-02-28", "2026-03-07"), 7);
  // opening twice on the same day sends nothing more
  const p = phone(ON, { kept: { d: "2026-10-10", s: [] } });
  p.m.opened(); p.m.opened();
  assert.deepEqual(p.sent.map((x) => JSON.parse(x.body).s), ["return_7d", "open"]);
});

test("a tab left open overnight: the first step of the new day sends that day's open (and return_7d) first", () => {
  const p = phone(ON, { kept: { d: "2026-10-12", s: ["open", "keep_cart"] } });
  assert.equal(p.m.hit("keep_cart"), true);
  p.m.opened();
  assert.deepEqual(p.sent.map((x) => JSON.parse(x.body).s), ["return_7d", "open", "keep_cart"]);
  assert.deepEqual(p.kept(), { d: "2026-10-15", s: ["return_7d", "open", "keep_cart"] });
  // the clock moved back a day after that: nothing is counted again for the same real day
  p.setDay("2026-10-14");
  for (const s of M.STAGES) p.m.hit(s);
  assert.equal(p.m.pending("first_price"), false);
  assert.equal(p.sent.length, 3);
});

test("storage blocked or full: once per page load, never once per scroll", () => {
  const sent = [];
  const m = M.make(ON, { load: () => null, save: () => { throw new Error("QuotaExceededError"); }, today: () => "2026-10-15",
    beacon: (u, b) => { sent.push(JSON.parse(b).s); return true; } });
  for (let i = 0; i < 20; i++) if (m.pending("first_price")) m.hit("first_price");
  m.hit("cart_open"); m.hit("cart_open"); m.opened();
  assert.deepEqual(sent, ["open", "first_price", "cart_open"]);
});

test("storage that reads an old value but cannot write (full): the memory copy still holds once a day", () => {
  const sent = [];
  const m = M.make(ON, { load: () => ({ d: "2026-10-14", s: ["open"] }), save: () => {}, today: () => "2026-10-15",
    beacon: (u, b) => { sent.push(JSON.parse(b).s); return true; } });
  m.opened(); m.hit("cart_open"); m.hit("cart_open"); m.hit("compare_open"); m.opened();
  assert.deepEqual(sent, ["return_7d", "open", "cart_open", "compare_open"]);
  assert.equal(m.pending("cart_open"), false);
});

test("a return the browser did not queue is not lost: return_7d goes first and both are tried again", () => {
  let fails = 1;
  const p = phone(ON, { kept: { d: "2026-10-10", s: [] }, queued: () => !(fails-- > 0) });
  assert.equal(p.m.opened(), false);
  assert.equal(p.kept().d, "2026-10-10", "nothing kept while return_7d has not gone");
  assert.equal(p.m.opened(), true);
  assert.deepEqual(p.sent.map((x) => JSON.parse(x.body).s), ["return_7d", "return_7d", "open"]);
  // 'open' not queued: it goes before the day's next step
  let n = 0;
  const q = phone(ON, { kept: { d: "2026-10-10", s: [] }, queued: () => n++ !== 1 });
  q.m.opened(); q.m.hit("keep_cart");
  assert.deepEqual(q.sent.map((x) => JSON.parse(x.body).s), ["return_7d", "open", "open", "keep_cart"]);
  assert.deepEqual(q.kept(), { d: "2026-10-15", s: ["return_7d", "open", "keep_cart"] });
});

test("a beacon the browser did not queue is tried again later; a broken kept value counts as no visit", () => {
  let ok = false;
  const p = phone(ON, { queued: () => ok });
  assert.equal(p.m.hit("cart_open"), false);
  assert.equal(p.m.pending("cart_open"), true);
  ok = true;
  assert.equal(p.m.hit("cart_open"), true);
  assert.deepEqual(p.sent.map((x) => JSON.parse(x.body).s), ["open", "open", "cart_open"], "the day's open (not queued the first time) goes first");
  const q = phone(ON, { kept: { d: "2026-10-15", s: "open" } });
  assert.equal(q.m.hit("open"), true);
  const r = phone(ON, { kept: { d: "2026-10-15", s: ["open", "made_up"] } });
  assert.equal(r.m.hit("open"), false);
  // a beacon that throws (a bad address at runtime) is a failed send, never an app error
  const t = M.make(ON, { load: () => null, save: () => {}, today: () => "2026-10-15", beacon: () => { throw new TypeError("blocked"); } });
  assert.equal(t.hit("open"), false);
});
