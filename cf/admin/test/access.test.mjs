// The Access verifier on its own (cf/admin/src/access.js). The cases are A4's (cf/metrics/test), so the two copies stay
// behaviourally identical until they are folded into one module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessConfig, verifyAccessJwt, newCertCache, CLOCK_SKEW_S } from "../src/access.js";
import { rsaKey, publicJwk, signJwt, certsFetch } from "./helpers.mjs";

const TEAM = "team.cloudflareaccess.com";
const AUD = "0123456789abcdef".repeat(4);
const CERTS = `https://${TEAM}/cdn-cgi/access/certs`;
const NOW = Date.parse("2026-10-15T12:00:00Z");

test("Access config: empty or odd values mean not configured", () => {
  assert.equal(accessConfig({}), null);
  assert.equal(accessConfig(undefined), null);
  assert.equal(accessConfig({ ACCESS_AUD: "", ACCESS_TEAM_DOMAIN: "" }), null);
  assert.equal(accessConfig({ ACCESS_AUD: "abc", ACCESS_TEAM_DOMAIN: "" }), null);
  assert.equal(accessConfig({ ACCESS_AUD: "", ACCESS_TEAM_DOMAIN: TEAM }), null);
  assert.equal(accessConfig({ ACCESS_AUD: "abc", ACCESS_TEAM_DOMAIN: "evil.example.com" }), null);
  assert.equal(accessConfig({ ACCESS_AUD: "abc", ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com/../x" }), null);
  assert.equal(accessConfig({ ACCESS_AUD: "abc", ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com.evil.example" }), null);
  assert.equal(accessConfig({ ACCESS_AUD: 123, ACCESS_TEAM_DOMAIN: TEAM }), null);
  assert.deepEqual(accessConfig({ ACCESS_AUD: " abc ", ACCESS_TEAM_DOMAIN: "https://Team.cloudflareaccess.com/" }),
    { aud: "abc", issuer: "https://team.cloudflareaccess.com", certsUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/certs" });
});

async function setup() {
  const good = await rsaKey();
  const wrong = await rsaKey();
  const fetch = certsFetch({ [CERTS]: [await publicJwk(good, "k1")] });
  const cfg = accessConfig({ ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: TEAM });
  const nowS = Math.floor(NOW / 1000);
  const claims = { aud: [AUD], email: "admin@example.com", iss: `https://${TEAM}`, iat: nowS - 10, nbf: nowS - 10, exp: nowS + 600, type: "app", sub: "x" };
  const header = { alg: "RS256", kid: "k1", typ: "JWT" };
  const cache = newCertCache();
  const verify = (token, nowMs = NOW) => verifyAccessJwt(token, cfg, { fetch, nowMs, cache });
  return { good, wrong, fetch, cfg, claims, header, nowS, cache, verify };
}

test("a token over 8,192 characters is refused before parsing and before any certs fetch (DoS guard)", async () => {
  const s = await setup();
  let fetches = 0;
  const fetch = (...a) => { fetches++; return s.fetch(...a); };
  const cache = newCertCache();
  const big = await signJwt(s.good, s.header, { ...s.claims, pad: "x".repeat(9000) });   // validly signed, just too long
  assert.equal(await verifyAccessJwt(big, s.cfg, { fetch, nowMs: NOW, cache }), false);
  assert.equal(fetches, 0, "refused without touching the certs endpoint");
  const small = await signJwt(s.good, s.header, { ...s.claims, pad: "x".repeat(100) });
  assert.equal(await verifyAccessJwt(small, s.cfg, { fetch, nowMs: NOW, cache }), true, "the same claims under the cap verify");
  assert.equal(fetches, 1);
});

test("a token Access signed for this application verifies; aud as array or string; skew of 60 s", async () => {
  const s = await setup();
  assert.equal(await s.verify(await signJwt(s.good, s.header, s.claims)), true);
  assert.equal(await s.verify(await signJwt(s.good, s.header, { ...s.claims, aud: AUD })), true);
  assert.equal(await s.verify(await signJwt(s.good, s.header, { ...s.claims, aud: ["other", AUD] })), true);
  assert.equal(await s.verify(await signJwt(s.good, s.header, { ...s.claims, nbf: undefined })), true, "nbf is optional");
  assert.equal(await s.verify(await signJwt(s.good, s.header, { ...s.claims, exp: s.nowS - CLOCK_SKEW_S + 1 })), true, "just inside the skew");
  assert.equal(await s.verify(await signJwt(s.good, s.header, { ...s.claims, exp: s.nowS - CLOCK_SKEW_S })), false, "at the skew edge");
  assert.equal(s.fetch.calls.length, 1, "one certs fetch for all of these");
});

test("everything else is false and never throws", async () => {
  const s = await setup();
  const valid = await signJwt(s.good, s.header, s.claims);
  const [head, body] = valid.split(".");
  const cases = {
    "undefined": undefined, "null": null, "number": 42, "empty": "", "garbage": "x.y.z", "two parts": `${head}.${body}`,
    "four parts": `${valid}.x`, "too long": "a".repeat(9000), "not base64url": `${head}.${body}.!!!`,
    "header not json": `${Buffer.from("nope").toString("base64url")}.${body}.${valid.split(".")[2]}`,
    "header an array": `${Buffer.from("[1]").toString("base64url")}.${body}.${valid.split(".")[2]}`,
    "signed by a wrong key": await signJwt(s.wrong, s.header, s.claims),
    "wrong aud": await signJwt(s.good, s.header, { ...s.claims, aud: ["someone-else"] }),
    "missing aud": await signJwt(s.good, s.header, { ...s.claims, aud: undefined }),
    "wrong issuer": await signJwt(s.good, s.header, { ...s.claims, iss: "https://evil.cloudflareaccess.com" }),
    "issuer http": await signJwt(s.good, s.header, { ...s.claims, iss: `http://${TEAM}` }),
    "expired": await signJwt(s.good, s.header, { ...s.claims, exp: s.nowS - 61 }),
    "no exp": await signJwt(s.good, s.header, { ...s.claims, exp: undefined }),
    "exp a string": await signJwt(s.good, s.header, { ...s.claims, exp: String(s.nowS + 600) }),
    "not yet valid": await signJwt(s.good, s.header, { ...s.claims, nbf: s.nowS + 120 }),
    "nbf a string": await signJwt(s.good, s.header, { ...s.claims, nbf: "0" }),
    "alg none": await signJwt(s.good, { alg: "none", kid: "k1" }, s.claims),
    "alg HS256": await signJwt(s.good, { alg: "HS256", kid: "k1" }, s.claims),
    "no kid": await signJwt(s.good, { alg: "RS256" }, s.claims),
    "unknown kid": await signJwt(s.good, { ...s.header, kid: "k9" }, s.claims),
    "payload changed after signing": `${head}.${Buffer.from(JSON.stringify({ ...s.claims, email: "attacker@example.com" })).toString("base64url")}.${valid.split(".")[2]}`,
    "signature stripped": `${head}.${body}.`,
  };
  for (const [name, token] of Object.entries(cases)) assert.equal(await s.verify(token), false, name);
  assert.equal(await verifyAccessJwt(valid, null, { fetch: s.fetch, nowMs: NOW, cache: s.cache }), false, "no config");
  assert.ok(s.fetch.calls.length <= 2, "unknown kids refetch at most once a minute");
});

test("certs: cached an hour, refetched for an unknown kid at most once a minute, outage = false, rotation picked up", async () => {
  const s = await setup();
  const token = await signJwt(s.good, s.header, s.claims);
  for (let i = 0; i < 5; i++) assert.equal(await s.verify(token), true);
  assert.equal(s.fetch.calls.length, 1);
  const forged = await rsaKey();
  for (let i = 0; i < 20; i++) assert.equal(await s.verify(await signJwt(forged, { ...s.header, kid: "nope" + i }, s.claims)), false);
  assert.equal(s.fetch.calls.length, 1, "20 forged kids within a minute → no extra fetch");

  const down = Object.assign(async () => { down.calls.push(1); throw new Error("network"); }, { calls: [] });
  const cache = newCertCache();
  for (let i = 0; i < 10; i++) assert.equal(await verifyAccessJwt(token, s.cfg, { fetch: down, nowMs: NOW, cache }), false);
  assert.equal(down.calls.length, 1, "a failed fetch also waits a minute before the next try");
  assert.equal(await verifyAccessJwt(token, s.cfg, { fetch: down, nowMs: NOW + 61000, cache }), false);
  assert.equal(down.calls.length, 2);

  const next = await rsaKey();
  const keys = { [CERTS]: [await publicJwk(s.good, "k1")] };
  const fetch = certsFetch(keys);
  const c2 = newCertCache();
  assert.equal(await verifyAccessJwt(token, s.cfg, { fetch, nowMs: NOW, cache: c2 }), true);
  keys[CERTS] = [await publicJwk(next, "k2"), await publicJwk(s.good, "k1")];
  const later = NOW + 61000;
  const claims = { ...s.claims, exp: Math.floor(later / 1000) + 600 };
  assert.equal(await verifyAccessJwt(await signJwt(next, { ...s.header, kid: "k2" }, claims), s.cfg, { fetch, nowMs: later, cache: c2 }), true);
  assert.equal(fetch.calls.length, 2);
  // a certs document with odd entries: non-RSA, missing fields, foreign alg are skipped, and only the first 10 entries are
  // looked at (a huge document cannot make the Worker import hundreds of keys) — so entries after the 10th are unknown kids
  const odd = certsFetch({ [CERTS]: [{ kty: "EC", kid: "e1" }, { kty: "RSA", kid: "k3" }, { ...(await publicJwk(s.good, "k1")), alg: "RS512" },
    ...(await Promise.all(Array.from({ length: 12 }, (_, i) => publicJwk(s.good, "many" + i))))] });
  const c3 = newCertCache();
  assert.equal(await verifyAccessJwt(token, s.cfg, { fetch: odd, nowMs: NOW, cache: c3 }), false, "k1 with RS512 is skipped");
  assert.equal(await verifyAccessJwt(await signJwt(s.good, { ...s.header, kid: "many3" }, s.claims), s.cfg, { fetch: odd, nowMs: NOW, cache: c3 }), true);
  assert.equal(await verifyAccessJwt(await signJwt(s.good, { ...s.header, kid: "many9" }, s.claims), s.cfg, { fetch: odd, nowMs: NOW, cache: c3 }), false, "11th entry onwards is not imported");
  assert.deepEqual([...c3.keys.keys()], ["many0", "many1", "many2", "many3", "many4", "many5", "many6"], "first 10 entries minus the 3 odd ones");
});
