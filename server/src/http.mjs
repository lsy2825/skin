// Small HTTP layer: JSON responses, typed errors, strict CORS (only listed origins; credentials by bearer token, no cookies —
// so no CSRF surface), body size limits, a tiny router.
export class HttpError extends Error {
  constructor(status, code, message, detail) { super(message || code); this.status = status; this.code = code; this.detail = detail; }
}
// every outbound call has ONE deadline that covers the headers AND the whole body (round-2 R10: the old timer stopped at the
// headers, so a body that stalled kept the request open), and a byte cap on the body. Returns a small response object:
// { ok, status, headers, json(), text() } — reading it after the deadline aborts the request and throws UPSTREAM_TIMEOUT.
const timeoutErr = (url) => new HttpError(504, "UPSTREAM_TIMEOUT", "외부 서비스가 응답하지 않아요. 잠시 후 다시 시도해 주세요", { url: String(url).replace(/\?.*$/, "") });
export function untilDeadline(p, deadline, ctl, url) {
  const left = deadline - Date.now();
  if (left <= 0) { ctl && ctl.abort(); return Promise.reject(timeoutErr(url)); }
  let tm;
  return Promise.race([p, new Promise((_, rej) => { tm = setTimeout(() => { ctl && ctl.abort(); rej(timeoutErr(url)); }, left); })]).finally(() => clearTimeout(tm));
}
export async function readCapped(body, { deadline, ctl, max, url }) {
  const reader = body.getReader(), parts = []; let n = 0;
  try {
    for (;;) {
      const { done, value } = await untilDeadline(reader.read(), deadline, ctl, url);
      if (done) break;
      n += value.byteLength;
      if (n > max) throw new HttpError(502, "UPSTREAM_TOO_LARGE", "외부 서비스 응답이 너무 커요");
      parts.push(value);
    }
  } catch (e) { reader.cancel().catch(() => {}); throw e; }
  const out = new Uint8Array(n); let i = 0; for (const x of parts) { out.set(x, i); i += x.byteLength; }
  return new TextDecoder().decode(out);
}
export async function fetchT(f, url, opts = {}, ms = 10000, maxBytes = 2_000_000) {
  const ctl = new AbortController(), deadline = Date.now() + ms;
  let r;
  try { r = await untilDeadline(f(url, { ...opts, signal: ctl.signal }), deadline, ctl, url); }
  catch (e) { throw e instanceof HttpError ? e : timeoutErr(url); }
  const stream = r.body && typeof r.body.getReader === "function";
  let cached = null;
  const text = () => cached || (cached = stream ? readCapped(r.body, { deadline, ctl, max: maxBytes, url })
    : untilDeadline(typeof r.text === "function" ? r.text() : r.json().then((j) => JSON.stringify(j)), deadline, ctl, url));
  return { ok: r.ok, status: r.status, headers: r.headers, text, json: async () => JSON.parse(await text()) };
}
export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
}
export function cors(req, origins) {
  const o = req.headers.get("origin");
  if (!o || !origins.includes(o)) return {};
  return { "access-control-allow-origin": o, "access-control-allow-headers": "authorization, content-type, idempotency-key",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-max-age": "600", vary: "origin" };
}
export async function readJson(req, max = 64 * 1024) {
  const len = +(req.headers.get("content-length") || 0);
  if (len > max) throw new HttpError(413, "TOO_LARGE", "요청이 너무 커요");
  // bytes counted while reading (round-2 R10: a body without Content-Length was read whole before its size was checked)
  let text = "";
  if (req.body && typeof req.body.getReader === "function") {
    try { text = await readCapped(req.body, { deadline: Date.now() + 15000, ctl: null, max, url: "request" }); }
    catch (e) { throw e.code === "UPSTREAM_TOO_LARGE" ? new HttpError(413, "TOO_LARGE", "요청이 너무 커요") : new HttpError(408, "REQUEST_TIMEOUT", "요청을 다 받지 못했어요"); }
  } else text = await req.text();
  if (new TextEncoder().encode(text).length > max) throw new HttpError(413, "TOO_LARGE", "요청이 너무 커요");
  try { return text ? JSON.parse(text) : {}; } catch (e) { throw new HttpError(400, "BAD_JSON", "JSON 형식이 아니에요"); }
}
export function router() {
  const routes = [];
  const add = (method, pattern, fn) => routes.push({ method, rx: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });
  return {
    get: (p, f) => add("GET", p, f), post: (p, f) => add("POST", p, f), del: (p, f) => add("DELETE", p, f),
    match(method, path) { for (const r of routes) { const m = r.method === method && r.rx.exec(path); if (m) return { fn: r.fn, params: m.groups || {} }; } return null; },
  };
}
// per-user sliding counters held by the caller (KV / Durable Object in production; a Map in tests) — abuse brake, not billing
// store: a Map (one instance — tests, local) or a shared store with hit(key, limit, windowMs) → {ok} (round-2 D4/M7: in
// production the counter lives in the database so every Workers instance counts the same requests). The Map forgets keys
// whose window passed, so it cannot grow without bound.
export function rateLimiter(store, limit, windowMs) {
  return async (key) => {
    if (store && typeof store.hit === "function") {
      const r = await store.hit(key, limit, windowMs);
      if (!r.ok) throw new HttpError(429, "RATE_LIMITED", "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요");
      return;
    }
    const now = Date.now(), xs = (store.get(key) || []).filter((t) => now - t < windowMs);
    if (xs.length >= limit) throw new HttpError(429, "RATE_LIMITED", "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요");
    xs.push(now); store.set(key, xs);
    if (store.size > 10000) for (const [k, v] of store) if (!v.length || now - v[v.length - 1] >= windowMs) store.delete(k);
  };
}
