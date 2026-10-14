// Price watch + Web Push (docs/PRICE_WATCH_AND_PUSH.md). Prices are collected once a week, so a notice is sent after a new
// data file is published — never described as real-time. One notice per rule per change (commerce_watch_event dedupes),
// one push per user per run (a digest), nothing during the user's quiet hours (left for the next run), and the push itself
// carries no content: the service worker shows a generic line and the app reads the notices after sign-in.
import { HttpError, fetchT } from "./http.mjs";
import Stats from "../../app/domain/stats.js";

// push services a subscription may point at (the endpoint is user-supplied: anything else would be a request forgery target)
const PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)$/;
export function checkSubscription(s) {
  let u;
  try { u = new URL(s && s.endpoint); } catch (e) { throw new HttpError(400, "BAD_SUBSCRIPTION", "알림 구독 정보가 올바르지 않아요"); }
  if (u.protocol !== "https:" || !PUSH_HOSTS.test(u.hostname)) throw new HttpError(400, "BAD_SUBSCRIPTION", "알 수 없는 알림 서비스예요");
  const k = s.keys || {};
  if (!/^[A-Za-z0-9_-]{40,120}$/.test(k.p256dh || "") || !/^[A-Za-z0-9_-]{16,40}$/.test(k.auth || "")) throw new HttpError(400, "BAD_SUBSCRIPTION", "알림 구독 키가 올바르지 않아요");
  return { endpoint: u.href, p256dh: k.p256dh, auth: k.auth };
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
// VAPID (RFC 8292): ES256 JWT for the push service's origin, signed with the server's private JWK
export async function vapidHeader(endpoint, { publicKey, privateJwk, subject }, now = Date.now()) {
  const jwk = typeof privateJwk === "string" ? JSON.parse(privateJwk) : privateJwk;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}
export async function sendPush(endpoint, vapid, { fetch: f = fetch, now } = {}) {
  const r = await fetchT(f, endpoint, { method: "POST", headers: { authorization: await vapidHeader(endpoint, vapid, now), ttl: "86400", urgency: "normal", "content-length": "0" } }, 8000);
  return { ok: r.status >= 200 && r.status < 300, gone: r.status === 404 || r.status === 410, status: r.status };
}

// KST hour inside [start, end) (wraps midnight: 22→8)
export const quiet = (hour, s, e) => s == null || e == null || s === e ? false : s < e ? hour >= s && hour < e : hour >= s || hour < e;
const kstHour = (ms) => new Date(ms + 9 * 3600000).getUTCHours();

// one rule against the current data → a notice or null. Only collected numbers; 'watch' needs a ≥5% move or a new low.
export function evaluate(rule, ctx) {
  const reg = rule.region && rule.region !== "전국" ? rule.region : "";
  const ps = ctx.prices(rule.key_id, reg).map((x) => x.p);
  if (!ps.length) return null;
  const min = Math.min(...ps), n = ps.length, med = Stats.median(ps);          // the same median as every screen (round-2 R03)
  const base = rule.baseline || {}, now = { min, median: med, n, updated: ctx.updated };
  const label = ctx.label(rule.key_id), at = `${ctx.updated} 수집 기준`;
  let msg = null;
  if (rule.kind === "target" && rule.target_krw && min <= rule.target_krw && !(base.min <= rule.target_krw)) msg = `${label}: 목표가 ${rule.target_krw.toLocaleString()}원 이하 가격이 생겼어요 (가장 낮은 ${min.toLocaleString()}원, ${at})`;
  else if (rule.kind === "newlow" && base.min && min < base.min) msg = `${label}: 지켜본 뒤 가장 낮은 가격이에요 (${base.min.toLocaleString()} → ${min.toLocaleString()}원, ${at})`;
  else if (rule.kind === "newmatch" && base.n && n > base.n) msg = `${label}: 가격이 있는 지점이 ${base.n} → ${n}곳으로 늘었어요 (${at})`;
  else if (rule.kind === "watch" && base.median && (Math.abs(med - base.median) / base.median >= 0.05 || min < base.min)) msg = `${label}: 중간값 ${base.median.toLocaleString()} → ${med.toLocaleString()}원 (${at})`;
  return { baseline: now, notice: msg && { title: label, text: msg, key: rule.key_id, data_updated: ctx.updated } };
}

export async function runWatch({ rpc, ctx, vapid, fetch: f = fetch, now = Date.now() }) {
  let after = 0, rules = 0, events = 0;
  for (;;) {
    const batch = await rpc("commerce_watch_due", { after });
    if (!batch.length) break;
    for (const r of batch) {
      rules++; after = r.id;
      const ev = evaluate(r, ctx);
      if (!ev) continue;
      if (!ev.notice) { if (!r.baseline) await rpc("commerce_watch_event", { rule_id: r.id, baseline: ev.baseline }); continue; }
      const res = await rpc("commerce_watch_event", { rule_id: r.id, event_key: `${r.kind}|${r.key_id}|${ctx.updated}`, payload: ev.notice, baseline: ev.baseline });
      if (res.new) events++;
    }
  }
  // the digest push: one per user, skipped inside quiet hours (the first rule's window; a user sets one window in the app)
  let pushed = 0, held = 0;
  const pending = vapid && vapid.privateJwk ? await rpc("commerce_push_pending", {}) : [];
  for (const u of pending) {
    const qs = u.quiet_start ?? null, qe = u.quiet_end ?? null;        // carried by commerce_push_pending (5.1 audit: no second full scan)
    if (quiet(kstHour(now), qs, qe)) { held++; continue; }
    let any = false;
    for (const s of u.subs) {
      const r = await sendPush(s.endpoint, vapid, { fetch: f, now }).catch(() => ({ ok: false }));
      await rpc("commerce_push_done", { endpoint: s.endpoint, ok: r.ok, gone: r.gone });
      any = any || r.ok;
    }
    if (any || !u.subs.length) { await rpc("commerce_push_done", { user_id: u.user_id }); if (any) pushed++; }
  }
  return { rules, events, pushed, held };
}
