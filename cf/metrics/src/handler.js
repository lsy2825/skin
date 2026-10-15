// 이용 단계 집계 Worker (A4) — the request handler. src/index.js only exports it: workerd treats every named export of the
// main module as an entrypoint, so the testable pieces (createHandler, the SQL) live here. Routes:
//   POST    /v1/m        {"s":"<stage>"} from the app's navigator.sendBeacon → +1 for (KST day, stage) → 204, no body
//   OPTIONS /v1/m        CORS preflight, only for a Blob/fetch fallback (a string beacon needs none)
//   GET     /v1/m/daily  ?from=YYYY-MM-DD&to=YYYY-MM-DD → {from, to, rows:[{day, s, n}]}, only with a valid Access JWT
//   GET     /health      {"ok":true} after a 1-row read of the D1 binding (the A7 monitor's probe); nothing else in it
// Privacy: the only request headers read are origin, content-type, content-length and cf-access-jwt-assertion. The client's
// address headers, its browser name, its cookies and the request's location object are never read, stored or logged, and
// this file has no logging at all. createHandler() takes fetch/clock so node --test can run it with a fake D1.
import {
  STAGES, STAGE_DAILY_CAP, MAX_BODY_BYTES, contentTypeOk, parseStageBody, kstDay, dailyRange,
  accessConfig, verifyAccessJwt, newCertCache,
} from "./rules.js";

// Capped upsert: at the ceiling the WHERE fails and D1 writes 0 rows.
export const UPSERT_SQL =
  "INSERT INTO daily_counts (day, stage, n) VALUES (?1, ?2, 1) ON CONFLICT (day, stage) DO UPDATE SET n = n + 1 WHERE n < ?3";
// Primary-key range: a full year is at most 366 × 8 rows read.
export const SELECT_SQL = "SELECT day, stage, n FROM daily_counts WHERE day >= ?1 AND day <= ?2";

const PREFLIGHT_MAX_AGE = "7200";      // Chrome caps Access-Control-Max-Age at 2 hours

function reply(status, headers = {}, body = null) {
  return new Response(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const list = String(env?.ALLOWED_ORIGIN || "").split(/[\s,]+/).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

// Beacons are credentialed (sendBeacon always is), so a Blob fallback's preflight needs Allow-Credentials. The response has
// no body and no Set-Cookie, so allowing credentials here exposes nothing.
function corsHeaders(origin) {
  return { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" };
}

// Reads at most max bytes; null when the body is larger (or claims to be).
async function readCapped(request, max) {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(/^\d+$/.test(declared) && Number(declared) <= max)) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } catch {
    return null;                     // client went away mid-body: a quiet 413, not an uncaught exception
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

async function count(request, env, nowMs) {
  // Browsers send Origin on every POST beacon (the app's referrer policy keeps it), so a missing Origin is refused too.
  // Origin is only a filter against other websites' pages: curl can forge it. The real bound is STAGE_DAILY_CAP.
  const origin = allowedOrigin(request, env);
  if (!origin) return reply(403);
  const cors = corsHeaders(origin);
  if (!contentTypeOk(request.headers.get("content-type"))) return reply(415, cors);
  const bytes = await readCapped(request, MAX_BODY_BYTES);
  if (bytes === null) return reply(413, cors);
  const parsed = parseStageBody(bytes);
  if (!parsed.stage) return reply(400, cors);
  try {
    await env.DB.prepare(UPSERT_SQL).bind(kstDay(nowMs), parsed.stage, STAGE_DAILY_CAP).run();
  } catch {
    return reply(503, cors);         // e.g. D1 Free daily limit: the beacon is lost, nothing else happens
  }
  return reply(204, cors);
}

function preflight(request, env) {
  const origin = allowedOrigin(request, env);
  if (!origin) return reply(403);
  return reply(204, {
    ...corsHeaders(origin),
    "access-control-allow-methods": "POST",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": PREFLIGHT_MAX_AGE,
  });
}

// No CORS headers here on purpose: a page must never read the totals with an admin's Access cookie.
async function daily(request, env, deps, nowMs) {
  const cfg = accessConfig(env);
  const ok = cfg !== null && await verifyAccessJwt(request.headers.get("cf-access-jwt-assertion"), cfg,
    { fetch: deps.fetch, nowMs, cache: deps.certCache });
  if (!ok) return reply(403);
  const url = new URL(request.url);
  const range = dailyRange(url.searchParams.get("from"), url.searchParams.get("to"), nowMs);
  if (range.error) return reply(400, { "content-type": "text/plain; charset=utf-8" }, `bad ${range.error}`);
  let rows;
  try {
    rows = (await env.DB.prepare(SELECT_SQL).bind(range.from, range.to).all()).results || [];
  } catch {
    return reply(503);
  }
  const order = (s) => STAGES.indexOf(s);
  const out = rows
    .map((r) => ({ day: String(r.day), s: String(r.stage), n: Number(r.n) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : order(a.s) - order(b.s)));
  return reply(200, { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" },
    JSON.stringify({ from: range.from, to: range.to, rows: out }));
}

export function createHandler({
  fetch: fetchFn = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  certCache = newCertCache(),
} = {}) {
  const deps = { fetch: fetchFn, certCache };
  return {
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      const nowMs = now();
      if (pathname === "/v1/m") {
        if (request.method === "POST") return count(request, env, nowMs);
        if (request.method === "OPTIONS") return preflight(request, env);
        return reply(405, { allow: "POST, OPTIONS" });
      }
      if (pathname === "/v1/m/daily") {
        if (request.method === "GET") return daily(request, env, deps, nowMs);
        return reply(405, { allow: "GET" });
      }
      if (pathname === "/health" && request.method === "GET") {
        try {
          await env.DB.prepare("SELECT 1 AS ok").first();
        } catch {
          return reply(503, { "content-type": "application/json; charset=utf-8" }, '{"ok":false}');
        }
        return reply(200, { "content-type": "application/json; charset=utf-8" }, '{"ok":true}');
      }
      return reply(404);             // exact paths only: no trailing-slash redirect (a redirected beacon would be lost)
    },
  };
}
