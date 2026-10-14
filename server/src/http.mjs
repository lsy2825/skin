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
};
export const fromDb = (e) => {
  const code = Object.keys(KNOWN).find((k) => String(e && e.message).includes(k));
  if (code) return new HttpError(KNOWN[code][0], code, KNOWN[code][1], e.detail);
  return new HttpError(500, "INTERNAL", "잠시 후 다시 시도해 주세요");
};

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
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "TOO_LARGE", "요청이 너무 커요");
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
export function rateLimiter(store, limit, windowMs) {
  return (key) => {
    const now = Date.now(), xs = (store.get(key) || []).filter((t) => now - t < windowMs);
    if (xs.length >= limit) throw new HttpError(429, "RATE_LIMITED", "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요");
    xs.push(now); store.set(key, xs);
  };
}
