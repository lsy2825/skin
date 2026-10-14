// Small HTTP layer: JSON responses, typed errors, strict CORS (only listed origins; credentials by bearer token, no cookies —
// so no CSRF surface), body size limits, a tiny router.
export class HttpError extends Error {
  constructor(status, code, message, detail) { super(message || code); this.status = status; this.code = code; this.detail = detail; }
}
// database / provider error codes → HTTP status and a user-safe Korean message (no stack traces, no SQL)
const KNOWN = {
  INSUFFICIENT_CREDITS: [402, "크레딧이 부족해요"], AMOUNT_MISMATCH: [409, "결제 금액이 주문과 달라요"], CURRENCY_MISMATCH: [409, "통화가 주문과 달라요"],
  ORDER_ALREADY_PAID: [409, "이미 결제된 주문이에요"], ORDER_NOT_FOUND: [404, "주문을 찾지 못했어요"], PRODUCT_NOT_FOR_SALE: [400, "판매 중인 상품이 아니에요"],
  IDEMPOTENCY_CONFLICT: [409, "같은 요청 키로 다른 주문을 만들 수 없어요"], PAYMENT_NOT_DONE: [409, "결제가 끝나지 않았어요"], CHANNEL_MISMATCH: [409, "결제 수단이 주문과 달라요"],
  ORDER_NOT_PAYABLE: [409, "결제할 수 없는 주문 상태예요"], FEATURE_NOT_AVAILABLE: [400, "지금 쓸 수 없는 기능이에요"], JOB_RELEASED: [409, "작업이 취소돼 크레딧을 돌려드렸어요"],
  NO_DELIVERABLE: [422, "결과를 만들지 못했어요"], CREDITS_ALREADY_SPENT: [409, "이미 쓴 크레딧이 있어 자동 환불할 수 없어요(고객센터 확인)"],
  REFUND_AMOUNT_INVALID: [400, "환불 금액이 올바르지 않아요"], NO_WATCH_ENTITLEMENT: [402, "가격 지켜보기 이용권이 필요해요"], TOO_MANY_RULES: [429, "지켜보기 규칙은 50개까지예요"],
  BAD_REQUEST: [400, "요청 형식이 올바르지 않아요"], WOULD_GO_NEGATIVE: [409, "잔액이 0보다 작아질 수 없어요"], PAYMENT_NOT_FOUND: [404, "결제를 찾지 못했어요"],
  REPORT_NOT_FOUND: [404, "보고서를 찾지 못했어요"], SESSION_FULL: [409, "이 세션의 질문 5개를 다 썼어요"],
  TOO_MANY_SUBSCRIPTIONS: [429, "알림 기기는 10개까지예요"], JOB_NOT_FOUND: [404, "작업을 찾지 못했어요"],
  TURN_IN_PROGRESS: [409, "같은 질문을 처리하고 있어요"], VERSION_CONFLICT: [409, "다른 곳에서 먼저 바뀌었어요. 새로 불러와 다시 고쳐 주세요"], FEATURE_NOT_SOLD: [403, "지금은 판매하지 않는 기능이에요"],
};
export const fromDb = (e) => {
  if (e instanceof HttpError) return e;
  const code = Object.keys(KNOWN).find((k) => String(e && e.message).includes(k));
  if (code) return new HttpError(KNOWN[code][0], code, KNOWN[code][1], e.detail);
  return new HttpError(500, "INTERNAL", "잠시 후 다시 시도해 주세요");
};

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
// the database-backed store (fixed windows, one row per key and window)
export const dbRateStore = (rpc) => ({ hit: (key, limit, windowMs) => rpc("commerce_rate_hit", { key, limit, window_seconds: Math.ceil(windowMs / 1000) }).catch(() => ({ ok: true })) });
