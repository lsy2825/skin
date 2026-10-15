// 관리자 주소 Worker (A6) — the request handler. src/index.js only exports it: workerd treats every named export of the main
// module as an entrypoint, so the testable pieces live here. One rule for every path:
//   /sw.js                      → 404, before anything else: this host never installs the service worker, so no admin page
//                                 is ever kept as an offline copy on the phone
//   anything, no valid Access   → 403, empty body (also while ACCESS_AUD / ACCESS_TEAM_DOMAIN are "", so a deploy made
//                                 before Access is configured exposes nothing)
//   anything, valid Access      → the same file the public Worker serves (env.ASSETS), plus the security headers
// "Valid Access" = the Cf-Access-Jwt-Assertion header verifies (src/access.js) OR ctx.access.aud equals ACCESS_AUD. Cloudflare's
// docs say the static-assets router does not pass ctx.access to the Worker, so in production the header is the path that
// works; ctx.access is accepted for wrangler dev's access.dev block and for the day Cloudflare passes it through.
// Privacy: the only request header read is cf-access-jwt-assertion. Client address, browser name, cookies and the request's
// location object are never read, stored or logged, and this file has no logging at all.
import { accessConfig, verifyAccessJwt, newCertCache } from "./access.js";

// app/_headers sets these for the public Worker; a Worker-generated Response gets nothing from that file, so the same four
// values are set here (keep them identical to app/_headers).
export const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "frame-ancestors 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
});

function reply(status) {
  return new Response(null, { status, headers: { "cache-control": "no-store", ...SECURITY_HEADERS } });
}

// A copy of the asset response with the security headers; HTML is never cached (the admin screen must not outlive the login).
function withHeaders(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  if (/^text\/html\b/i.test(headers.get("content-type") || "")) headers.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function createHandler({
  fetch: fetchFn = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  certCache = newCertCache(),
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const { pathname } = new URL(request.url);
      if (pathname === "/sw.js") return reply(404);
      const cfg = accessConfig(env);
      if (cfg === null) return reply(403);                 // not configured: nothing is served to anyone
      const viaCtx = typeof ctx?.access?.aud === "string" && ctx.access.aud === cfg.aud;
      const ok = viaCtx || await verifyAccessJwt(request.headers.get("cf-access-jwt-assertion"), cfg,
        { fetch: fetchFn, nowMs: now(), cache: certCache });
      if (!ok) return reply(403);
      if (request.method !== "GET" && request.method !== "HEAD") return reply(405);
      let res;
      try {
        res = await env.ASSETS.fetch(request);
      } catch {
        return reply(503);                                // the assets router failed: an empty answer with the headers, not Cloudflare's error page
      }
      return withHeaders(res);
    },
  };
}
