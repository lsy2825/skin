// Price-alert rules (가격 알림 규칙) — plain functions with no Cloudflare imports, so node tests and the factory runner
// (notify.mjs) use the same code as the Worker. What a phone may store, KST day math, the 08-21 window and the
// once-a-week bundling decision all live here; src/worker.js only glues them to D1 and fetch.

export const KINDS = ["target", "watch", "newmatch", "expiring"];
export const MAX_RULES = 20;
export const MAX_PRICE = 100_000_000;                     // real prices are 100 – 19,000,000 won
// compare keys in app/data.json: X01–X36 (hand-made groups) and T + 7 (auto variants). Checked against data.json in tests.
export const KEY_RE = /^(X\d{2}|T[0-9A-Z]{7})$/;
// the 17 short region names data.json branches use (branches[5]); '' = 전국. Checked against data.json in tests.
export const REGIONS = ["서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
// region groups the app offers (app/app.js `const CAPITAL = ["서울", "경기", "인천"]`, its default region view '수도권';
// checked in tests). A rule with region '수도권' matches a branch in any of the three.
export const REGION_GROUPS = { 수도권: ["서울", "경기", "인천"] };
export const isRegion = (r) => typeof r === "string" && (REGIONS.includes(r) || Object.hasOwn(REGION_GROUPS, r));
// does a branch in region `branch` count for a rule/pair region `want` ('' = nationwide)?
export const regionMatch = (want, branch) => !want || (REGION_GROUPS[want] ? REGION_GROUPS[want].includes(branch) : branch === want);
export const ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const RUN_RE = /^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/;   // data meta.updated | factory day
// a day that is on the calendar ('2026-13-45' and '2026-02-30' match DAY_RE but are not), so date arithmetic never throws
export const validDay = (s) => typeof s === "string" && DAY_RE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
export const validRun = (s) => typeof s === "string" && RUN_RE.test(s) && s.split("|").every(validDay);
// the factory's own 'today' may differ from the Worker's clock by this many days (time zones, a run that crosses midnight)
export const FINISH_SLACK_DAYS = 1;
export const WEEK_DAYS = 7;
export const EXPIRING_DAYS = 3;
export const LAST_SEND_MARGIN_MIN = 15;                    // never send a push closer than this to 21:00 KST
export const TTL_MARGIN_S = 60;                            // push TTL ends this much before 21:00 (clock drift)

// ---- GET /health "capacity": no row is ever evicted, so a person must notice a full table. From the 'subs' counter and
// MAX_SUBS: 'full' at the cap (new phones get 503 FULL), 'nearly_full' from 80%, else 'ok'. Words only, no numbers.
export function capacityOf(count, max) {
  const n = Number(count) || 0;
  return n >= max ? "full" : n * 5 >= max * 4 ? "nearly_full" : "ok";
}
// factory finish older than this many KST days → GET /health "stale": true (the monitor warns)
export const STALE_DAYS = 2;

// ---- ids: 128 random bits, base64url (22 chars). The id IS the permission to change a subscription, so never log it.
export function b64u(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s) {
  const t = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}
export const newId = () => b64u(crypto.getRandomValues(new Uint8Array(16)));

// ---- KST (UTC+9, no daylight saving) — dates are kept as 'YYYY-MM-DD' text, no clock times are stored
const KST = 9 * 3600e3;
export const kstDay = (ms) => new Date(ms + KST).toISOString().slice(0, 10);
export const kstHour = (ms) => new Date(ms + KST).getUTCHours();
export function addDays(day, n) {
  const t = new Date(day + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
// whole days from day b to day a (both valid 'YYYY-MM-DD')
export const daysBetween = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
// ms until 21:00 KST today (negative after 21:00)
function msTo21(ms) {
  const k = new Date(ms + KST);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), 21) - (ms + KST);
}
// sending is allowed 08:00–21:00 KST; the Worker checks this at the start of a run AND right before every single push,
// and stops 15 minutes before 21:00 (last cron run that sends: 20:40)
export function inWindow(ms) {
  const h = kstHour(ms);
  return h >= 8 && h < 21 && msTo21(ms) >= LAST_SEND_MARGIN_MIN * 60e3;
}
// seconds left until 21:00 KST (0 after)
export const ttlUntil21 = (ms) => Math.max(0, Math.floor(msTo21(ms) / 1000));
// push TTL, computed per push from the clock at that moment: what is left until 21:00 KST minus a small margin, so a phone
// that comes online late never rings at night
export const pushTtl = (ms) => Math.max(0, ttlUntil21(ms) - TTL_MARGIN_S);

// ---- what is due for one subscription row today. weekly: watch/newmatch/target news (pend_w) at most once per 7 KST
// days. expiring: pend_x = the earliest end date of a (pair, end date) not announced yet (sql.js MARK_EXPIRING keeps the
// announced ones per pair in exp_sent, so a later date already announced never hides an earlier new one); at most one
// stand-alone expiring push a day (last_x); when the weekly bundle goes out, a pending expiring rides along in the same
// push. Ended dates are dropped. The claim queries in sql.js select exactly the rows for which this returns something
// (tests check both agree).
export function dueKinds(sub, today) {
  const weekly = sub.pend_w === 1 && (!sub.last_w || sub.last_w <= addDays(today, -WEEK_DAYS));
  const xLive = !!sub.pend_x && sub.pend_x >= today;
  const expiring = xLive && (weekly || (sub.last_x || "") < today);
  return { weekly, expiring };
}

// push service answer → what to do with the subscription
export function outcome(status) {
  if (status >= 200 && status < 300) return "sent";
  if (status >= 300 && status < 400) return "retry";       // redirects are never followed (fetch redirect: 'manual')
  if (status === 404 || status === 410) return "gone";      // the browser dropped the subscription
  if (status === 429) return "slow";                        // stop that push host for this run
  // 401/403: that subscription refuses our VAPID token. Counted against the ROW (FCM answers 403 for a subscription made
  // with another applicationServerKey, which never heals: a phone that kept an old key, or a planted subscription), so it
  // is removed after REFUSED_DROP refusals. Only strong evidence stops a whole run (src/worker.js send: configBroken).
  if (status === 401 || status === 403) return "refused";
  return "retry";                                           // 5xx, 413, network error: try again next run
}
// 5xx, a redirect, a timeout/network error: that is the push SERVICE having trouble, not this subscription. Such a failure is
// counted against the row (fails) only when the same push origin answered another push 2xx in the same run (so the service
// was up and this row is the problem); otherwise the row is released unchanged — a push-service incident of an hour must not
// delete phones. A 4xx (400, 413) is always the row's.
export const hostTrouble = (status) => status === 0 || status >= 500 || (status >= 300 && status < 400);
export const RETRY_DROP = 10;      // consecutive failures (5xx, 3xx, network) before a row is removed
export const REFUSED_DROP = 3;     // consecutive failures, the last one a 401/403, before a row is removed
// a row that never received a push (last_w and last_x empty) is removed after this many consecutive COUNTED failures (see
// hostTrouble: a push-service outage is not counted), or at its first 401/403: a planted subscription (a failing endpoint on
// an allowed host) gets a few tries, never a week of them
export const NEVER_DROP = 3;
// of SEND_LIMIT slots in one run, at most this many go to rows that failed before (fails > 0): rows that keep failing can
// take neither the expiring queue (nearest end date first) nor the weekly queue away from rows that never failed
export const FAIL_SLOTS = 10;
// a run stops early ("our VAPID setup is wrong") only when at least this many rows that DID take our pushes before
// (last_w or last_x set) and had no failure since (fails = 0) answer 401/403, and nothing in the run was sent. A planted
// subscription made with another key never took a push, so it can never stop the run.
export const ABORT_EVIDENCE = 3;

// ---- the key of the per-client subscribe rate limit: IPv4 as is; IPv6 by its /64 (one household or phone usually gets
// a whole /64, so the full address would let one client rotate through 2^64 keys). Not stored anywhere (the Rate
// Limiting binding's in-memory counter only). Anything unparsable is used as is.
export function clientKey(ip) {
  if (typeof ip !== "string" || !ip.trim()) return "no-ip";
  const s = ip.trim().toLowerCase().replace(/%.*$/, "");      // drop a zone id (fe80::1%eth0)
  if (!s.includes(":")) return s;                              // IPv4
  const v4 = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);           // IPv4 written in the last 32 bits (::ffff:1.2.3.4)
  const halves = (v4 ? s.slice(0, v4.index + 1) + "0:0" : s).split("::");
  if (halves.length > 2) return s;
  const groups = (x) => (x ? x.split(":") : []);
  const head = groups(halves[0]), tail = halves.length === 2 ? groups(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const all = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...tail];
  if (fill < 0 || all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return s;
  const n = all.map((g) => parseInt(g, 16));
  if (v4 && n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) return v4[1];   // IPv4-mapped = that IPv4 client
  return n.slice(0, 4).map((x) => x.toString(16)).join(":") + "::/64";
}

// ---- rules a phone may store: [{kind, key, max?, region?}] ≤ 20, unknown fields refused (nothing personal sneaks in).
// max is required for target, optional for expiring, dropped for watch/newmatch. region '', '전국' or missing = nationwide;
// '수도권' = 서울+경기+인천. max is compared with the clinics' listed prices (병원 표시가), the basis of the app's own alert
// engine (app/app.js watchNow, docs/ALERT_ENGINE_SPEC.md §3) — see notify.mjs.
// An empty list is valid here: PUT with [] DELETES the subscription (the phone switched everything off); POST
// /v1/push/subscribe refuses it (an empty subscription would never send).
// → { rules } normalized (sorted, duplicates merged, fixed field order) or { error: 'BAD_RULES' }
export function validateRules(input) {
  const bad = { error: "BAD_RULES" };
  if (!Array.isArray(input) || input.length > MAX_RULES) return bad;
  const out = [], seen = new Set();
  for (const x of input) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return bad;
    if (Object.keys(x).some((f) => !["kind", "key", "max", "region"].includes(f))) return bad;
    if (!KINDS.includes(x.kind) || typeof x.key !== "string" || !KEY_RE.test(x.key)) return bad;
    let region = x.region == null || x.region === "전국" ? "" : x.region;
    if (typeof region !== "string" || (region && !isRegion(region))) return bad;
    let max = x.max == null ? undefined : x.max;
    if (max !== undefined && !(Number.isInteger(max) && max >= 1 && max <= MAX_PRICE)) return bad;
    if (x.kind === "target" && max === undefined) return bad;
    if (x.kind === "watch" || x.kind === "newmatch") max = undefined;
    const r = { kind: x.kind, key: x.key };
    if (max !== undefined) r.max = max;
    if (region) r.region = region;
    const sig = JSON.stringify(r);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(r);
  }
  // one canonical order (the rules are a set): the same rules in another order are stored as the same text, so the Worker
  // can tell "nothing changed" (pending marks kept) from "a rule was removed" (src/sql.js RULES_DROPPED)
  const key = (r) => JSON.stringify(r);
  out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { rules: out };
}

// ---- factory digest entries (POST /v1/internal/digest): every field checked, so a leaked runner token can only write
// numbers about (key, region) pairs. m/n/med: this run's stats; e/s/u: expiring; g: the day the key's rows were last
// regrouped (data.json meta.recl, '' = never) — a new g re-bases the pair silently (sql.js DIGEST). → cleaned entry or null
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const optInt = (v, lo, hi) => v == null || int(v, lo, hi);
export function cleanEntry(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  if (Object.keys(e).some((f) => !["k", "r", "m", "n", "med", "e", "s", "u", "g"].includes(f))) return null;
  if (typeof e.k !== "string" || !KEY_RE.test(e.k)) return null;
  if (typeof e.r !== "string" || (e.r && !isRegion(e.r))) return null;
  if (!optInt(e.m, 0, MAX_PRICE) || !int(e.n, 0, 100000) || !optInt(e.med, 0, MAX_PRICE)) return null;
  if ((e.m == null) !== (e.n === 0) || (e.med == null) !== (e.n === 0)) return null;
  if (!optInt(e.e, 0, MAX_PRICE) || !optInt(e.s, 0, MAX_PRICE)) return null;
  if (e.u != null && !validDay(e.u)) return null;
  if ((e.e == null) !== (e.u == null)) return null;
  if (e.g != null && e.g !== "" && !validDay(e.g)) return null;
  const n = (v) => (v == null ? null : v);
  return { k: e.k, r: e.r, m: n(e.m), n: e.n, med: n(e.med), e: n(e.e), s: n(e.s), u: n(e.u), g: e.g || "" };
}
