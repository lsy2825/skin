// Pure rules of the metrics Worker. No Cloudflare imports, so plain `node --test cf/metrics/test/*.test.mjs` loads this file.
// Promise of A4: only these 8 stage names are counted, and only as (day, stage) → count. Nothing about the sender.

export const STAGES = Object.freeze([
  "open", "first_price", "compare_open", "keep_cart", "keep_fav", "keep_alert", "cart_open", "return_7d",
]);
const STAGE_SET = new Set(STAGES);

export const MAX_BODY_BYTES = 256;     // the longest valid body {"s":"compare_open"} is 20 bytes
// Per (KST day, stage) ceiling. D1 Free's 100,000 written rows reset at 00:00 UTC = 09:00 KST, so one quota day overlaps two
// KST days: worst case 2 × 8 × 5,000 = 80,000 rows, still under the limit. Past the cap the upsert writes nothing (spam cannot
// spend the account's D1 budget) and that day's number simply stops growing. Workers Free's 100,000 requests a day are shared
// by the whole account, so heavy spam can still use those up — the beacons then fail quietly; the app is not affected.
export const STAGE_DAILY_CAP = 5000;
export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 86400000;
const KST_OFFSET_MS = 9 * 3600000;     // Asia/Seoul has no daylight saving time: always UTC+9

export function isStage(s) {
  return typeof s === "string" && STAGE_SET.has(s);   // exact: no trim, no lower-casing, no object lookup (__proto__)
}

// sendBeacon(url, string) sends text/plain;charset=UTF-8 (no CORS preflight); application/json comes from a Blob or fetch.
export function contentTypeOk(value) {
  if (typeof value !== "string") return false;
  const essence = value.split(";")[0].trim().toLowerCase();
  return essence === "text/plain" || essence === "application/json";
}

// bytes (Uint8Array) → { stage } | { error }. The body must be exactly {"s": "<one of STAGES>"}: one key, so no date or
// device detail can ride along even if a client tried.
export function parseStageBody(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { error: "empty" };
  if (bytes.length > MAX_BODY_BYTES) return { error: "size" };
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return { error: "utf8" }; }
  let o;
  try { o = JSON.parse(text); } catch { return { error: "json" }; }
  if (o === null || typeof o !== "object" || Array.isArray(o)) return { error: "shape" };
  const keys = Object.keys(o);
  if (keys.length !== 1 || keys[0] !== "s") return { error: "shape" };
  if (!isStage(o.s)) return { error: "stage" };
  return { stage: o.s };
}

// The counting day is the Korean calendar day: the phone decides "once a day" on local (KST) dates, so the server must cut
// days at 00:00 KST too. (D1 Free quotas reset at 00:00 UTC = 09:00 KST; that only matters if the cap is ever reached.)
export function kstDay(nowMs) {
  return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function dayToMs(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return new Date(ms).toISOString().slice(0, 10) === s ? ms : null;    // rejects 2026-02-30, 2026-13-01
}

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (both inclusive). Missing to = today (KST); missing from = DEFAULT_RANGE_DAYS before to.
export function dailyRange(from, to, nowMs) {
  const toStr = to == null || to === "" ? kstDay(nowMs) : to;
  const toMs = dayToMs(toStr);
  if (toMs === null) return { error: "to" };
  const fromStr = from == null || from === "" ? new Date(toMs - (DEFAULT_RANGE_DAYS - 1) * DAY_MS).toISOString().slice(0, 10) : from;
  const fromMs = dayToMs(fromStr);
  if (fromMs === null) return { error: "from" };
  if (fromMs > toMs) return { error: "order" };
  if ((toMs - fromMs) / DAY_MS + 1 > MAX_RANGE_DAYS) return { error: "span" };
  return { from: fromStr, to: toStr };
}

// ---- Cloudflare Access JWT (Cf-Access-Jwt-Assertion), verified with WebCrypto RS256 — no library, no bundler ----
// A header that is merely present proves nothing: a client can send any Cf-Access-Jwt-Assertion straight to workers.dev.

export const CLOCK_SKEW_S = 60;
const MAX_TOKEN_CHARS = 8192;
const CERTS_TTL_MS = 3600000;          // keys rotate every ~6 weeks and the previous key stays valid 7 more days
const REFETCH_MIN_MS = 60000;          // an unknown kid refetches the certs at most once a minute

// env → config, or null when not configured (then the daily view refuses everything).
export function accessConfig(env) {
  const aud = typeof env?.ACCESS_AUD === "string" ? env.ACCESS_AUD.trim() : "";
  const team = typeof env?.ACCESS_TEAM_DOMAIN === "string"
    ? env.ACCESS_TEAM_DOMAIN.trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/+$/, "") : "";
  if (!aud || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) return null;
  return { aud, issuer: `https://${team}`, certsUrl: `https://${team}/cdn-cgi/access/certs` };
}

export function newCertCache() {
  return { url: "", keys: new Map(), fetchedAt: 0, triedAt: 0, loading: null };
}

function b64urlBytes(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("b64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s) {
  const o = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b64urlBytes(s)));
  if (o === null || typeof o !== "object" || Array.isArray(o)) throw new Error("json");
  return o;
}

async function loadCerts(cfg, cache, fetchFn, nowMs) {
  const res = await fetchFn(cfg.certsUrl, { headers: { accept: "application/json" } });
  if (!res || !res.ok) throw new Error("certs");
  const body = await res.json();
  const keys = new Map();
  for (const k of Array.isArray(body?.keys) ? body.keys.slice(0, 10) : []) {
    if (!k || k.kty !== "RSA" || typeof k.kid !== "string" || typeof k.n !== "string" || typeof k.e !== "string") continue;
    if (k.alg !== undefined && k.alg !== "RS256") continue;
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    keys.set(k.kid, key);
  }
  cache.url = cfg.certsUrl; cache.keys = keys; cache.fetchedAt = nowMs;
}

// Every fetch attempt — failed ones included — waits REFETCH_MIN_MS before the next, and concurrent requests share one load,
// so a burst of forged kids or a certs outage cannot turn each daily-view request into a fetch.
async function keyFor(kid, cfg, cache, fetchFn, nowMs) {
  const stale = cache.url !== cfg.certsUrl || nowMs - cache.fetchedAt > CERTS_TTL_MS;
  const want = stale || !cache.keys.has(kid);
  if (want && !cache.loading && nowMs - cache.triedAt > REFETCH_MIN_MS) {
    cache.triedAt = nowMs;
    cache.loading = loadCerts(cfg, cache, fetchFn, nowMs).catch(() => {}).finally(() => { cache.loading = null; });
  }
  if (cache.loading) await cache.loading;
  return cache.url === cfg.certsUrl ? cache.keys.get(kid) || null : null;
}

// → true only for a token Access signed for this application. Never throws; anything odd is false (fail closed).
export async function verifyAccessJwt(token, cfg, { fetch: fetchFn, nowMs, cache }) {
  try {
    if (!cfg || typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const header = b64urlJson(parts[0]);
    const claims = b64urlJson(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
    const key = await keyFor(header.kid, cfg, cache, fetchFn, nowMs);
    if (!key) return false;
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), signed))) return false;
    const now = Math.floor(nowMs / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(cfg.aud)) return false;
    if (claims.iss !== cfg.issuer) return false;
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S <= now) return false;
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - CLOCK_SKEW_S > now)) return false;
    return true;
  } catch {
    return false;
  }
}
