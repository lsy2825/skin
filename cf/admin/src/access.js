// Cloudflare Access JWT (Cf-Access-Jwt-Assertion), verified with WebCrypto RS256 — no library, no bundler.
// SAME CODE as the Access part of cf/metrics/src/rules.js (A4): copied, not imported, because the two Workers are in
// separate PRs. Once both are on main, fold them into one shared module (e.g. cf/shared/access.js) and import it from both;
// until then, a change here must be made in cf/metrics/src/rules.js too.
// A header that is merely present proves nothing: a client can send any Cf-Access-Jwt-Assertion straight to workers.dev.

export const CLOCK_SKEW_S = 60;
const MAX_TOKEN_CHARS = 8192;
const CERTS_TTL_MS = 3600000;          // keys rotate every ~6 weeks and the previous key stays valid 7 more days
const REFETCH_MIN_MS = 60000;          // an unknown kid refetches the certs at most once a minute

// env → config, or null when not configured (then the gate refuses everything).
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
// so a burst of forged kids or a certs outage cannot turn each request into a fetch.
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
