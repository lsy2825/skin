// The admin Worker as a whole (cf/admin/src/handler.js): fail closed until Access is configured, 403 without a valid
// Cf-Access-Jwt-Assertion, the asset plus the security headers with one, ctx.access accepted, /sw.js never served, no console.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHandler, SECURITY_HEADERS } from "../src/handler.js";
import { rsaKey, publicJwk, signJwt, certsFetch, withConsoleSpy, fakeAssets, jsonc } from "./helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const BASE = "https://yoonsiljang-admin.lsy2825.workers.dev";
const TEAM = "team.cloudflareaccess.com";
const AUD = "0123456789abcdef".repeat(4);
const CERTS = `https://${TEAM}/cdn-cgi/access/certs`;
const NOW = Date.parse("2026-10-15T12:00:00Z");
const HEADERS = {
  "content-security-policy": "frame-ancestors 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

async function setup() {
  const good = await rsaKey();
  const wrong = await rsaKey();
  const fetch = certsFetch({ [CERTS]: [await publicJwk(good, "k1")] });
  const assets = fakeAssets();
  const env = { ASSETS: assets, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const nowS = Math.floor(NOW / 1000);
  const claims = { aud: [AUD], email: "admin@example.com", iss: `https://${TEAM}`, iat: nowS - 10, nbf: nowS - 10, exp: nowS + 600, type: "app", sub: "x" };
  const header = { alg: "RS256", kid: "k1", typ: "JWT" };
  const h = createHandler({ now: () => NOW, fetch });
  const token = await signJwt(good, header, claims);
  return { good, wrong, fetch, assets, env, claims, header, nowS, h, token };
}

const req = (path, { token, method = "GET" } = {}) =>
  new Request(`${BASE}${path}`, { method, headers: token === undefined ? {} : { "cf-access-jwt-assertion": token } });

function assertHeaders(res) {
  for (const [k, v] of Object.entries(HEADERS)) assert.equal(res.headers.get(k), v, k);
}

test("the four security headers are exactly the public app's (app/_headers, when that file is present)", () => {
  assert.deepEqual({ ...SECURITY_HEADERS }, HEADERS);
  const file = root + "../../app/_headers";
  if (!existsSync(file)) return;      // added by a sibling PR; once both are on main this compares the two sources
  const text = readFileSync(file, "utf8");
  for (const [k, v] of Object.entries(HEADERS)) {
    const line = text.split("\n").map((l) => l.trim()).find((l) => l.toLowerCase().startsWith(k + ":"));
    assert.ok(line, `${k} in app/_headers`);
    assert.equal(line.slice(k.length + 1).trim(), v, k);
  }
});

test("not configured → 403 for everything, even a valid token or ctx.access; no certs fetch, no asset read", async () => {
  const s = await setup();
  for (const env of [
    { ASSETS: s.assets },
    { ASSETS: s.assets, ACCESS_AUD: "", ACCESS_TEAM_DOMAIN: "" },
    { ASSETS: s.assets, ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: "" },
    { ASSETS: s.assets, ACCESS_AUD: "", ACCESS_TEAM_DOMAIN: TEAM },
    { ASSETS: s.assets, ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: "evil.example.com" },
  ]) {
    for (const path of ["/", "/index.html", "/data.json", "/app.js", "/nope"]) {
      const res = await s.h.fetch(req(path, { token: s.token }), env, { access: { aud: AUD } });
      assert.equal(res.status, 403, `${path} ${JSON.stringify(env.ACCESS_AUD)}`);
      assert.equal(await res.text(), "");
      assert.equal(res.headers.get("cache-control"), "no-store");
      assertHeaders(res);
    }
  }
  assert.equal(s.fetch.calls.length, 0);
  assert.deepEqual(s.assets.calls, []);
});

test("no header → 403, empty body, security headers on the refusal too; asset never read", async () => {
  const s = await setup();
  for (const path of ["/", "/index.html", "/data.json", "/review.json", "/icons/icon-192.png", "/nope"]) {
    const res = await s.h.fetch(req(path), s.env, undefined);
    assert.equal(res.status, 403, path);
    assert.equal(await res.text(), "");
    assertHeaders(res);
  }
  assert.deepEqual(s.assets.calls, []);
});

test("forged, expired, wrong aud/iss, alg none, unknown kid, changed payload → 403", async () => {
  const s = await setup();
  const cases = {
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
  const [head, body] = s.token.split(".");
  cases["payload changed after signing"] = `${head}.${Buffer.from(JSON.stringify({ ...s.claims, email: "attacker@example.com" })).toString("base64url")}.${s.token.split(".")[2]}`;
  cases["signature stripped"] = `${head}.${body}.`;
  for (const [name, token] of Object.entries(cases)) {
    const res = await s.h.fetch(req("/", { token }), s.env, undefined);
    assert.equal(res.status, 403, name);
    assert.equal(await res.text(), "", `${name}: no hint in the body`);
  }
  assert.deepEqual(s.assets.calls, [], "no asset read for a refused request");
  assert.ok(s.fetch.calls.length <= 2, "an unknown kid refetches at most once a minute");
});

test("valid header JWT → the asset with the security headers; HTML no-store, other files keep the router's cache-control", async () => {
  const s = await setup();
  const html = await s.h.fetch(req("/", { token: s.token }), s.env, undefined);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /윤실장/);
  assertHeaders(html);
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.equal(html.headers.get("content-type"), "text/html; charset=utf-8");
  const js = await s.h.fetch(req("/app.js", { token: s.token }), s.env, undefined);
  assert.equal(js.status, 200);
  assertHeaders(js);
  assert.equal(js.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(js.headers.get("etag"), '"x"', "the router's own headers survive");
  const json = await s.h.fetch(req("/data.json", { token: s.token }), s.env, undefined);
  assert.equal(json.status, 200);
  assert.equal(json.headers.get("content-type"), "application/json");
  const missing = await s.h.fetch(req("/nope", { token: s.token }), s.env, undefined);
  assert.equal(missing.status, 404, "not_found_handling none: the router's 404 passes through");
  assertHeaders(missing);
  const head = await s.h.fetch(req("/", { token: s.token, method: "HEAD" }), s.env, undefined);
  assert.equal(head.status, 200);
  assert.deepEqual(s.assets.calls, ["GET /", "GET /app.js", "GET /data.json", "GET /nope", "HEAD /"]);
  assert.equal(s.fetch.calls.length, 1, "certs are cached between requests");
  const one = await s.h.fetch(req("/", { token: await signJwt(s.good, s.header, { ...s.claims, aud: AUD }) }), s.env, undefined);
  assert.equal(one.status, 200, "aud as a plain string also works");
});

test("assets router throws → 503 with the security headers and no body (never Cloudflare's error page)", async () => {
  const s = await setup();
  const env = { ...s.env, ASSETS: { fetch: async () => { throw new Error("router down"); } } };
  const res = await s.h.fetch(req("/", { token: s.token }), env, undefined);
  assert.equal(res.status, 503);
  assert.equal(await res.text(), "");
  assertHeaders(res);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const refused = await s.h.fetch(req("/"), env, undefined);
  assert.equal(refused.status, 403, "the Access gate still comes first");
});

test("ctx.access with the right aud → 200 without a header; a wrong aud or no aud → 403", async () => {
  const s = await setup();
  const ok = await s.h.fetch(req("/"), s.env, { access: { aud: AUD, async getIdentity() { return { email: "a@b" }; } } });
  assert.equal(ok.status, 200);
  assertHeaders(ok);
  assert.equal(s.fetch.calls.length, 0, "no certs fetch when ctx.access already answers");
  for (const ctx of [{ access: { aud: "someone-else" } }, { access: { aud: "" } }, { access: {} }, { access: { aud: [AUD] } }, {}, undefined, null]) {
    assert.equal((await s.h.fetch(req("/"), s.env, ctx)).status, 403, JSON.stringify(ctx));
  }
  assert.deepEqual(s.assets.calls, ["GET /"]);
});

test("/sw.js → 404 with or without Access, and the asset is never read (no offline copy of admin pages)", async () => {
  const s = await setup();
  for (const [token, ctx] of [[undefined, undefined], [s.token, undefined], [undefined, { access: { aud: AUD } }]]) {
    const res = await s.h.fetch(req("/sw.js", { token }), s.env, ctx);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "");
    assertHeaders(res);
  }
  assert.equal((await s.h.fetch(req("/sw.js"), { ASSETS: s.assets }, undefined)).status, 404, "also while not configured");
  assert.deepEqual(s.assets.calls, []);
});

test("other methods with valid Access → 405; without → 403", async () => {
  const s = await setup();
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    assert.equal((await s.h.fetch(req("/", { token: s.token, method }), s.env, undefined)).status, 405, method);
    assert.equal((await s.h.fetch(req("/", { method }), s.env, undefined)).status, 403, method);
  }
  assert.deepEqual(s.assets.calls, []);
});

test("certs endpoint down → 403 (fail closed); a burst of forged kids costs one fetch a minute; rotation is picked up", async () => {
  const s = await setup();
  const down = Object.assign(async () => { down.calls.push(1); throw new Error("network"); }, { calls: [] });
  const h1 = createHandler({ now: () => NOW, fetch: down });
  for (let i = 0; i < 10; i++) assert.equal((await h1.fetch(req("/", { token: s.token }), s.env, undefined)).status, 403);
  assert.equal(down.calls.length, 1);

  let now = NOW;
  const keys = { [CERTS]: [await publicJwk(s.good, "k1")] };
  const fetch = certsFetch(keys);
  const h2 = createHandler({ now: () => now, fetch });
  const forged = await rsaKey();
  for (let i = 0; i < 20; i++) {
    assert.equal((await h2.fetch(req("/", { token: await signJwt(forged, { ...s.header, kid: "nope" + i }, s.claims) }), s.env, undefined)).status, 403);
  }
  assert.equal(fetch.calls.length, 1, "20 forged kids within a minute → 1 certs fetch");
  assert.equal((await h2.fetch(req("/", { token: s.token }), s.env, undefined)).status, 200);
  const next = await rsaKey();
  keys[CERTS] = [await publicJwk(next, "k2"), await publicJwk(s.good, "k1")];
  now += 61000;
  const claims = { ...s.claims, exp: Math.floor(now / 1000) + 600 };
  assert.equal((await h2.fetch(req("/", { token: await signJwt(next, { ...s.header, kid: "k2" }, claims) }), s.env, undefined)).status, 200);
});

test("no console output on any path (refused, served, sw.js, errors inside the verifier)", async () => {
  const s = await setup();
  const [, calls] = await withConsoleSpy(async () => {
    await s.h.fetch(req("/"), s.env, undefined);
    await s.h.fetch(req("/", { token: "x.y.z" }), s.env, undefined);
    await s.h.fetch(req("/", { token: s.token }), s.env, undefined);
    await s.h.fetch(req("/sw.js"), s.env, undefined);
    await s.h.fetch(req("/"), { ASSETS: s.assets }, undefined);
    await s.h.fetch(req("/nope", { token: s.token }), s.env, undefined);
    const down = createHandler({ now: () => NOW, fetch: async () => { throw new Error("network"); } });
    await down.fetch(req("/", { token: s.token }), s.env, undefined);
  });
  assert.deepEqual(calls, []);
});

// ---- static promises: config, source, entry module ----

test("wrangler.jsonc: same app folder, worker first, no 404 fallback, logs/traces/previews off, Access unset (fail closed)", () => {
  const cfg = jsonc(read("wrangler.jsonc"));
  assert.equal(cfg.name, "yoonsiljang-admin");
  assert.equal(cfg.main, "src/index.js");
  assert.equal(cfg.compatibility_date, "2026-10-13");
  assert.equal(cfg.preview_urls, false);
  assert.equal(cfg.logpush, false);
  assert.deepEqual(cfg.assets, { directory: "../../app", binding: "ASSETS", not_found_handling: "none", run_worker_first: true });
  const o = cfg.observability;
  assert.equal(o.enabled, false);
  assert.equal(o.logs.enabled, false);
  assert.equal(o.logs.invocation_logs, false);
  assert.equal(o.logs.persist, false);
  assert.equal(o.traces.enabled, false);
  assert.equal(o.traces.persist, false);
  assert.equal(o.issues.enabled, false);
  assert.equal(cfg.tail_consumers, undefined);
  assert.equal(cfg.streaming_tail_consumers, undefined);
  assert.equal(cfg.access, undefined, "access.dev would make every local request look authenticated");
  assert.equal(cfg.env, undefined);
  assert.equal(cfg.previews, undefined);
  assert.equal(cfg.routes, undefined);
  assert.equal(typeof cfg.vars.ACCESS_AUD, "string");
  assert.equal(typeof cfg.vars.ACCESS_TEAM_DOMAIN, "string");
  // the root config (public Worker) and this one serve the same folder
  const pub = jsonc(readFileSync(root + "../../wrangler.jsonc", "utf8"));
  assert.equal(pub.assets.directory, "./app");
  assert.equal(pub.name, "yoonsiljang");
});

test("source never touches client identity headers, cookies, the cf object or the console", () => {
  for (const f of ["src/index.js", "src/handler.js", "src/access.js"]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");   // comments may name them
    for (const banned of [/cf-connecting-ip/i, /x-forwarded-for/i, /x-real-ip/i, /true-client-ip/i, /user-agent/i,
      /cookie/i, /\.cf\b/, /console\./, /referer/i, /\.headers\.(entries|keys|values|forEach)\b/, /\[\.\.\.\s*request\.headers/, /getIdentity/]) {
      assert.equal(banned.test(code), false, `${f} matches ${banned}`);
    }
  }
  const handler = read("src/handler.js");
  assert.deepEqual([...handler.matchAll(/request\.headers\.get\("([^"]+)"\)/g)].map((m) => m[1]), ["cf-access-jwt-assertion"]);
});

test("the entry module has only a default export (workerd rejects named exports that are not handlers)", () => {
  const exports = read("src/index.js").split("\n").filter((l) => /^\s*export\b/.test(l));
  assert.deepEqual(exports, ["export default createHandler();"]);
});

test("tools/factory.sh deploys the admin Worker after the public one (public only when PUBLIC_DEPLOY=on), with the same token", () => {
  const sh = readFileSync(root + "../../tools/factory.sh", "utf8");
  const body = sh.slice(sh.indexOf("deploy() {"), sh.indexOf("\n}", sh.indexOf("deploy() {")));
  const deploys = body.split("\n").filter((l) => /\$WRANGLER deploy/.test(l));
  assert.deepEqual(deploys.map((l) => l.trim()), [
    "CLOUDFLARE_API_TOKEN=$DEPLOY_TOKEN $WRANGLER deploy", // public app, only when PUBLIC_DEPLOY=on: a failure stops the run (set -e)
    "if ! CLOUDFLARE_API_TOKEN=$DEPLOY_TOKEN $WRANGLER deploy --config cf/admin/wrangler.jsonc; then", // admin host: a warning, fatal while public hosting is paused
  ]);
  assert.match(body, /if \[ "\$\{PUBLIC_DEPLOY:-\}" = on \]; then/, "the public deploy is behind the PUBLIC_DEPLOY switch");
  assert.ok(/::warning title=Cloudflare::yoonsiljang-admin/.test(body), "GitHub Actions warning when the admin deploy fails");
  // the behaviour itself (exit code, order, token, warning) runs with a fake wrangler in tests/factory_worker.test.js
});
