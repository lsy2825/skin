// The Worker's fetch handler with a fake D1 (records every SQL string and bound value).
// Done criteria of A4: stages outside the 8 are refused and nothing is written; client IP / browser / cookie / cf object
// never reach storage, the response or the console; the daily view needs a valid Cloudflare Access JWT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, UPSERT_SQL, SELECT_SQL } from "../src/handler.js";
import { STAGES } from "../src/rules.js";
import { fakeD1, CAP, rsaKey, publicJwk, signJwt, certsFetch, withConsoleSpy } from "./helpers.mjs";

const APP = "https://yoonsiljang.lsy2825.workers.dev";
const TEAM = "yoon-test.cloudflareaccess.com";
const AUD = "aud-tag-for-tests-0123456789abcdef";
const CERTS = `https://${TEAM}/cdn-cgi/access/certs`;
const NOW = Date.parse("2026-10-15T03:00:00Z");     // 2026-10-15 12:00 KST
const BASE = "https://yoonsiljang-metrics.lsy2825.workers.dev";

function envWith(db, extra = {}) {
  return { DB: db, ALLOWED_ORIGIN: APP, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ...extra };
}

function beacon(body, { origin = APP, type = "text/plain;charset=UTF-8", headers = {}, path = "/v1/m", method = "POST" } = {}) {
  const h = { ...headers };
  if (origin !== null) h.origin = origin;
  if (type !== null) h["content-type"] = type;
  return new Request(BASE + path, { method, headers: h, body: method === "GET" || method === "HEAD" ? undefined : body });
}

// Every handler call goes through the console spy; any console output fails the test.
async function call(handler, req, env) {
  const [res, logs] = await withConsoleSpy(() => handler.fetch(req, env, {}));
  assert.deepEqual(logs, [], "the Worker must not write to the console");
  return res;
}

test("all 8 stages are counted: 204, empty body, no cookie set, one capped upsert on the KST day", async () => {
  const db = fakeD1();
  const h = createHandler({ now: () => NOW });
  for (const s of STAGES) {
    const res = await call(h, beacon(JSON.stringify({ s })), envWith(db));
    assert.equal(res.status, 204, s);
    assert.equal(res.body, null);
    assert.equal(await res.text(), "");
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("access-control-allow-origin"), APP);
  }
  assert.equal(db.calls.length, 8);
  for (const [i, c] of db.calls.entries()) {
    assert.equal(c.sql, UPSERT_SQL);
    assert.deepEqual(c.args, ["2026-10-15", STAGES[i], CAP]);
  }
  await call(h, beacon('{"s":"open"}', { type: "application/json" }), envWith(db));   // Blob/fetch fallback form
  assert.equal(db.table.get("2026-10-15|open"), 2);
});

test("stages outside the 8, extra keys, wrong types, bad JSON, oversize → refused and nothing written", async () => {
  const db = fakeD1();
  const h = createHandler({ now: () => NOW });
  const bad400 = [
    '{"s":"evil"}', '{"s":"OPEN"}', '{"s":"open "}', '{"s":" open"}', '{"s":""}', '{"s":"__proto__"}', '{"s":"constructor"}',
    '{"s":"return_7d\\u0000"}', '{"s":"open","t":1}', '{"s":"open","ua":"x"}', '{"__proto__":"open"}', '{"S":"open"}', '{}',
    '{"s":1}', '{"s":null}', '{"s":true}', '{"s":["open"]}', '["open"]', '"open"', "null", "nope", '{"s":"open"', "",
  ];
  for (const b of bad400) {
    const res = await call(h, beacon(b), envWith(db));
    assert.equal(res.status, 400, b);
    assert.equal(await res.text(), "");
  }
  assert.equal((await call(h, beacon(`{"s":"open","pad":"${"x".repeat(300)}"}`), envWith(db))).status, 413);
  // a body larger than it says: stream cut at 256 bytes even without a usable Content-Length
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(" ".repeat(200))); c.enqueue(new TextEncoder().encode(" ".repeat(200) + '{"s":"open"}')); c.close(); } });
  const big = new Request(BASE + "/v1/m", { method: "POST", headers: { origin: APP, "content-type": "text/plain" }, body: stream, duplex: "half" });
  assert.equal((await call(h, big, envWith(db))).status, 413);
  assert.equal((await call(h, beacon('{"s":"open"}', { type: "application/x-www-form-urlencoded" }), envWith(db))).status, 415);
  // bytes without a type (ArrayBuffer beacon) carry no Content-Type at all (a string body would get text/plain)
  assert.equal((await call(h, beacon(new TextEncoder().encode('{"s":"open"}'), { type: null }), envWith(db))).status, 415);
  assert.equal(db.calls.length, 0, "no SQL ran for any refused request");
  assert.equal(db.table.size, 0);
});

test("IP, browser, cookie and the cf object are never read, stored, returned or logged", async () => {
  const markers = { ip: "203.0.113.77", xff: "198.51.100.23", ua: "ua-marker-ProbeUA/9.9", cookie: "cookie-marker-7f3",
    city: "city-marker-Seoul", asn: "64496" };
  const db = fakeD1();
  const h = createHandler({ now: () => NOW });
  const req = beacon('{"s":"keep_cart"}', { headers: {
    "cf-connecting-ip": markers.ip, "x-forwarded-for": `${markers.xff}, ${markers.ip}`, "x-real-ip": markers.ip,
    "true-client-ip": markers.ip, "user-agent": markers.ua, cookie: `sid=${markers.cookie}`, referer: `${APP}/?u=${markers.ip}`,
  } });
  // record which headers the Worker asks for, and trap any touch of request.cf
  const realHeaders = req.headers;
  const asked = [];
  let cfTouched = false;
  const spy = new Proxy(realHeaders, {
    get(t, prop) {
      const v = Reflect.get(t, prop, t);
      if (typeof v !== "function") return v;
      if (prop === "get" || prop === "has") return (name) => { asked.push(String(name).toLowerCase()); return v.call(t, name); };
      return (...a) => { asked.push(`<${String(prop)}>`); return v.apply(t, a); };
    },
  });
  Object.defineProperty(req, "headers", { value: spy });
  Object.defineProperty(req, "cf", { get() { cfTouched = true; return { city: markers.city, asn: Number(markers.asn), country: "KR" }; } });

  const res = await call(h, req, envWith(db));
  assert.equal(res.status, 204);
  assert.equal(cfTouched, false, "request.cf must not be read");
  assert.ok(asked.every((n) => ["origin", "content-type", "content-length"].includes(n)), `headers read: ${asked}`);

  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].args, ["2026-10-15", "keep_cart", CAP], "bound values are only day, stage and the cap");
  const stored = JSON.stringify(db.calls) + JSON.stringify([...db.table]);
  const returned = JSON.stringify([...res.headers]) + (await res.text());
  for (const [name, m] of Object.entries(markers)) {
    assert.equal(stored.includes(m), false, `${name} reached storage`);
    assert.equal(returned.includes(m), false, `${name} reached the response`);
  }
  // the only write names exactly the three columns
  assert.match(UPSERT_SQL, /^INSERT INTO daily_counts \(day, stage, n\) VALUES \(\?1, \?2, 1\)/);
  assert.match(SELECT_SQL, /^SELECT day, stage, n FROM daily_counts /);
});

test("Origin must be the app: missing, null, other sites and look-alikes are refused before anything is read", async () => {
  const db = fakeD1();
  const h = createHandler({ now: () => NOW });
  for (const origin of [null, "null", "https://evil.example", "http://yoonsiljang.lsy2825.workers.dev",
    "https://yoonsiljang.lsy2825.workers.dev.evil.example", `${APP}/`, "https://YOONSILJANG.lsy2825.workers.dev"]) {
    const res = await call(h, beacon('{"s":"open"}', { origin }), envWith(db));
    assert.equal(res.status, 403, String(origin));
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  }
  assert.equal((await call(h, beacon('{"s":"open"}'), envWith(db, { ALLOWED_ORIGIN: "" }))).status, 403, "unset = refuse all");
  const local = envWith(db, { ALLOWED_ORIGIN: `${APP}, http://localhost:8766` });
  assert.equal((await call(h, beacon('{"s":"open"}', { origin: "http://localhost:8766" }), local)).status, 204);
  assert.equal(db.calls.length, 1);
});

test("OPTIONS preflight only for the app origin; other methods and paths 405/404, never a redirect", async () => {
  const db = fakeD1();
  const h = createHandler({ now: () => NOW });
  const ok = await call(h, beacon(null, { method: "OPTIONS", type: null, headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } }), envWith(db));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), APP);
  assert.equal(ok.headers.get("access-control-allow-methods"), "POST");
  assert.equal(ok.headers.get("access-control-allow-headers"), "content-type");
  assert.equal(ok.headers.get("access-control-allow-credentials"), "true");
  assert.ok(Number(ok.headers.get("access-control-max-age")) > 0);
  assert.equal((await call(h, beacon(null, { method: "OPTIONS", type: null, origin: "https://evil.example" }), envWith(db))).status, 403);
  const get = await call(h, beacon(null, { method: "GET", type: null }), envWith(db));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST, OPTIONS");
  for (const path of ["/v1/m/", "/V1/M", "/v1/m//", "/", "/v1/metrics", "/v1/m/daily/"]) {
    const res = await call(h, beacon('{"s":"open"}', { path }), envWith(db));
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get("location"), null);
  }
  assert.equal((await call(h, beacon('{"s":"open"}', { path: "/v1/m/daily" }), envWith(db))).status, 405);
  assert.equal(db.calls.length, 0);
});

test("D1 failure (e.g. free daily limit) → 503 quietly, nothing logged", async () => {
  const h = createHandler({ now: () => NOW });
  const res = await call(h, beacon('{"s":"open"}'), envWith(fakeD1({ failWith: "D1_ERROR: exceeded free tier daily row write limit" })));
  assert.equal(res.status, 503);
  assert.equal(await res.text(), "");
});

test("per-day per-stage ceiling: the count stops at the cap", async () => {
  const db = fakeD1();
  db.table.set("2026-10-15|open", CAP);
  const h = createHandler({ now: () => NOW });
  assert.equal((await call(h, beacon('{"s":"open"}'), envWith(db))).status, 204);
  assert.equal(db.table.get("2026-10-15|open"), CAP);
});

test("the KST day decides the row: 23:59 KST and 00:00 KST land on different days", async () => {
  const db = fakeD1();
  let now = Date.parse("2026-10-15T14:59:00Z");     // 23:59 KST, 15 Oct
  const h = createHandler({ now: () => now });
  await call(h, beacon('{"s":"open"}'), envWith(db));
  now = Date.parse("2026-10-15T15:00:00Z");         // 00:00 KST, 16 Oct
  await call(h, beacon('{"s":"open"}'), envWith(db));
  assert.deepEqual(db.calls.map((c) => c.args[0]), ["2026-10-15", "2026-10-16"]);
});

// ---- GET /v1/m/daily behind Cloudflare Access ----

async function accessSetup() {
  const good = await rsaKey();
  const wrong = await rsaKey();
  const fetch = certsFetch({ [CERTS]: [await publicJwk(good, "k1")] });
  const db = fakeD1();
  db.table.set("2026-10-14|first_price", 3);
  db.table.set("2026-10-14|open", 5);
  db.table.set("2026-10-15|open", 2);
  db.table.set("2025-01-01|open", 9);     // outside the default range
  const env = envWith(db, { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
  const nowS = Math.floor(NOW / 1000);
  const claims = { aud: [AUD], email: "admin@example.com", iss: `https://${TEAM}`, iat: nowS - 10, nbf: nowS - 10, exp: nowS + 600, type: "app", sub: "x" };
  const header = { alg: "RS256", kid: "k1", typ: "JWT" };
  return { good, wrong, fetch, db, env, claims, header, nowS };
}

const daily = (token, query = "") =>
  new Request(`${BASE}/v1/m/daily${query}`, { headers: token === undefined ? {} : { "cf-access-jwt-assertion": token } });

test("daily: 200 with a valid Access JWT, rows {day, s, n} sorted by day then stage order, no CORS", async () => {
  const s = await accessSetup();
  const h = createHandler({ now: () => NOW, fetch: s.fetch });
  const res = await call(h, daily(await signJwt(s.good, s.header, s.claims)), s.env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { from: "2026-09-16", to: "2026-10-15", rows: [
    { day: "2026-10-14", s: "open", n: 5 }, { day: "2026-10-14", s: "first_price", n: 3 }, { day: "2026-10-15", s: "open", n: 2 },
  ] });
  assert.deepEqual(s.db.calls.at(-1), { sql: SELECT_SQL, args: ["2026-09-16", "2026-10-15"] });
  const one = await call(h, daily(await signJwt(s.good, s.header, { ...s.claims, aud: AUD }), "?from=2025-01-01&to=2025-01-01"), s.env);
  assert.deepEqual((await one.json()).rows, [{ day: "2025-01-01", s: "open", n: 9 }], "aud as a plain string also works");
  assert.equal((await call(h, daily(await signJwt(s.good, s.header, s.claims), "?from=2024-01-01&to=2026-10-15"), s.env)).status, 400);
  assert.equal((await call(h, daily(await signJwt(s.good, s.header, s.claims), "?from=bad"), s.env)).status, 400);
  assert.equal(s.fetch.calls.length, 1, "certs are cached between requests");
});

test("daily: 403 without Access, with a wrong key, wrong aud, wrong issuer, expired, not yet valid, alg none, unknown kid", async () => {
  const s = await accessSetup();
  const h = createHandler({ now: () => NOW, fetch: s.fetch });
  const cases = {
    "no header": undefined,
    "empty header": "",
    "garbage": "x.y.z",
    "signed by a wrong key": await signJwt(s.wrong, s.header, s.claims),
    "wrong aud": await signJwt(s.good, s.header, { ...s.claims, aud: ["someone-else"] }),
    "missing aud": await signJwt(s.good, s.header, { ...s.claims, aud: undefined }),
    "wrong issuer": await signJwt(s.good, s.header, { ...s.claims, iss: "https://evil.cloudflareaccess.com" }),
    "expired": await signJwt(s.good, s.header, { ...s.claims, exp: s.nowS - 61 }),
    "no exp": await signJwt(s.good, s.header, { ...s.claims, exp: undefined }),
    "not yet valid": await signJwt(s.good, s.header, { ...s.claims, nbf: s.nowS + 120 }),
    "alg none": await signJwt(s.good, { alg: "none", kid: "k1" }, s.claims),
    "alg HS256": await signJwt(s.good, { alg: "HS256", kid: "k1" }, s.claims),
    "unknown kid": await signJwt(s.good, { ...s.header, kid: "k9" }, s.claims),
  };
  const valid = await signJwt(s.good, s.header, s.claims);
  const [head, body] = valid.split(".");
  const forged = Buffer.from(JSON.stringify({ ...s.claims, email: "attacker@example.com" })).toString("base64url");
  cases["payload changed after signing"] = `${head}.${forged}.${valid.split(".")[2]}`;
  cases["signature stripped"] = `${head}.${body}.`;
  for (const [name, token] of Object.entries(cases)) {
    const res = await call(h, daily(token), s.env);
    assert.equal(res.status, 403, name);
    assert.equal(await res.text(), "", `${name}: no hint in the body`);
  }
  assert.ok(s.db.calls.every((c) => c.sql !== SELECT_SQL), "no read happened for a refused request");
  assert.ok(s.fetch.calls.length <= 2, "an unknown kid refetches at most once a minute");
});

test("daily: Access not configured → 403 even for a valid token, and the certs are never fetched", async () => {
  const s = await accessSetup();
  const h = createHandler({ now: () => NOW, fetch: s.fetch });
  const token = await signJwt(s.good, s.header, s.claims);
  for (const extra of [{ ACCESS_AUD: "" }, { ACCESS_TEAM_DOMAIN: "" }, { ACCESS_TEAM_DOMAIN: "evil.example.com" }]) {
    assert.equal((await call(h, daily(token), { ...s.env, ...extra })).status, 403);
  }
  assert.equal(s.fetch.calls.length, 0);
});

test("daily: certs endpoint down → 403 (fail closed), and the key is picked up after rotation", async () => {
  const s = await accessSetup();
  const down = Object.assign(async () => { down.calls.push(1); throw new Error("network"); }, { calls: [] });
  const h1 = createHandler({ now: () => NOW, fetch: down });
  assert.equal((await call(h1, daily(await signJwt(s.good, s.header, s.claims)), s.env)).status, 403);

  let now = NOW;
  const next = await rsaKey();
  const keys = { [CERTS]: [await publicJwk(s.good, "k1")] };
  const fetch = certsFetch(keys);
  const h2 = createHandler({ now: () => now, fetch });
  assert.equal((await call(h2, daily(await signJwt(s.good, s.header, s.claims)), s.env)).status, 200);
  keys[CERTS] = [await publicJwk(next, "k2"), await publicJwk(s.good, "k1")];
  now += 61000;
  const claims = { ...s.claims, exp: Math.floor(now / 1000) + 600 };
  assert.equal((await call(h2, daily(await signJwt(next, { ...s.header, kid: "k2" }, claims)), s.env)).status, 200);
});

test("the cap is in the real SQL: run UPSERT_SQL on a real SQLite table built from the migration", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_daily_counts.sql", import.meta.url), "utf8"));
  const up = db.prepare(UPSERT_SQL.replace(/\?(\d)/g, "?"));
  for (let i = 0; i < 5; i++) up.run("2026-10-15", "open", 3);
  assert.equal(db.prepare("SELECT n FROM daily_counts WHERE day = ? AND stage = ?").get("2026-10-15", "open").n, 3);
  assert.throws(() => up.run("2026-10-15", "evil", 3), /CHECK/);     // the table itself refuses an unknown stage
  const cols = db.prepare("SELECT name FROM pragma_table_info('daily_counts')").all().map((r) => r.name);
  assert.deepEqual(cols, ["day", "stage", "n"]);
});

test("health: {\"ok\":true} after touching D1, 503 {\"ok\":false} when D1 fails, nothing else in it", async () => {
  const db = fakeD1();
  const h = createHandler({ now: () => NOW });
  const r = await h.fetch(new Request("https://m.example/health", { headers: { "cf-connecting-ip": "203.0.113.9" } }), { DB: db, ALLOWED_ORIGIN: APP });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '{"ok":true}');
  assert.deepEqual(db.calls.map((c) => c.sql), ["SELECT 1 AS ok"]);
  const bad = await h.fetch(new Request("https://m.example/health"), { DB: fakeD1({ failWith: "down" }), ALLOWED_ORIGIN: APP });
  assert.equal(bad.status, 503);
  assert.equal(await bad.text(), '{"ok":false}');
});

test("certs: a burst of unknown kids or a certs outage costs one fetch a minute, not one per request", async () => {
  const s = await accessSetup();
  const fetch = certsFetch({ [CERTS]: [await publicJwk(s.good, "k1")] });
  let now = NOW;
  const h = createHandler({ now: () => now, fetch });
  const forged = await rsaKey();
  for (let i = 0; i < 20; i++) {
    const t = await signJwt(forged, { ...s.header, kid: "nope" + i }, s.claims);
    assert.equal((await call(h, daily(t), s.env)).status, 403);
  }
  assert.equal(fetch.calls.length, 1, "20 forged kids within a minute → 1 certs fetch");
  const down = Object.assign(async () => { down.calls.push(1); throw new Error("network"); }, { calls: [] });
  const h2 = createHandler({ now: () => now, fetch: down });
  for (let i = 0; i < 10; i++) assert.equal((await call(h2, daily(await signJwt(s.good, s.header, s.claims)), s.env)).status, 403);
  assert.equal(down.calls.length, 1, "a failed fetch also waits a minute before the next try");
  now += 61000;
  await call(h2, daily(await signJwt(s.good, s.header, { ...s.claims, exp: Math.floor(now / 1000) + 600 })), s.env);
  assert.equal(down.calls.length, 2);
});
