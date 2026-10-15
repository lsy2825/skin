// Test helpers: a D1-shaped wrapper over node:sqlite (Node 22+) running the real migration, a fake push service, and
// a request helper for the Worker. The wrapper records every bound value so tests can prove nothing IP/UA-like is stored.
import { readFileSync } from "node:fs";
import { webcrypto as wc } from "node:crypto";
import { format, inspect } from "node:util";
import { b64u } from "../src/rules.js";

let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch { sqlite = null; }
export const HAS_SQLITE = !!sqlite;
export const SKIP_SQL = HAS_SQLITE ? false : "node:sqlite needs Node 22+ (cf-alerts.yml runs Node 22)";

const MIGRATION = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");

export function makeDb() {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(MIGRATION);
  const binds = [], sqls = [];
  const exec = (sql, args) => {
    sqls.push(sql);
    const st = db.prepare(sql);
    if (/^\s*SELECT/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      const results = st.all(...args).map((r) => ({ ...r }));
      const changes = /^\s*SELECT/i.test(sql) ? 0 : db.prepare("SELECT changes() AS c").get().c;
      return { results, meta: { changes }, success: true };
    }
    const r = st.run(...args);
    return { results: [], meta: { changes: Number(r.changes) }, success: true };
  };
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => { binds.push(...a); return stmt(sql, a); },
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    first: async (col) => { const r = exec(sql, args).results[0]; return r === undefined ? null : col ? r[col] : r; },
  });
  return {
    raw: db, binds, sqls,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec("BEGIN");
      try { const out = list.map((s) => exec(s.sql, s.args)); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    rows: (sql, ...a) => db.prepare(sql).all(...a).map((r) => ({ ...r })),
  };
}

export async function vapidKeys() {
  const pair = await wc.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64u(new Uint8Array(await wc.subtle.exportKey("raw", pair.publicKey)));
  const { kty, crv, x, y, d } = await wc.subtle.exportKey("jwk", pair.privateKey);
  return { pub, jwk: JSON.stringify({ kty, crv, x, y, d }), publicKey: pair.publicKey };
}

export const SECRET_VALUE = "f".repeat(43);
export function makeEnv(db, extra = {}) {
  return {
    DB: db, ALLOWED_ORIGIN: "https://yoonsiljang.lsy2825.workers.dev", DEV_ORIGINS: "", VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_JWK: "",
    VAPID_SUBJECT: "https://yoonsiljang.lsy2825.workers.dev", ALERTS_SECRET: SECRET_VALUE, MAX_SUBS: "50000", ...extra,
  };
}

let n = 0;
export function subscription(host = "fcm.googleapis.com", path) {
  n++;
  return { endpoint: `https://${host}/${path || "fcm/send/dev" + n}`, expirationTime: null, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
}

// call the Worker like a phone/the factory would. headers default to a browser on the app origin.
export async function call(worker, env, method, path, body, { headers = {}, now, raw } = {}) {
  const h = { origin: "https://yoonsiljang.lsy2825.workers.dev", ...headers };
  if (body !== undefined && !h["content-type"]) h["content-type"] = "application/json";
  for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
  const req = new Request("https://yoonsiljang-alerts.lsy2825.workers.dev" + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, { waitUntil() {} }, now);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

// a fake push service: status per endpoint (default 201), records every request
export function pushService(statusFor = () => 201) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const s = statusFor(url, calls.length);
    if (s === "throw") throw new Error("network down");
    return new Response(null, { status: s });
  };
  return { f, calls };
}

// ms for a KST wall-clock time
export const kst = (iso) => Date.parse(iso + "+09:00");

// capture everything written through console.* while fn runs (privacy tests: logs must carry counts only). Objects are
// rendered the way a log viewer expands them (util.format/inspect, hidden fields, deep): Headers, Request, Error (message
// and stack) and plain objects show their contents, so console.log(request.headers) or console.error("x", err) is caught.
const show = (x) => (typeof x === "string" ? x : inspect(x, { depth: 8, showHidden: true, getters: true, maxArrayLength: null, maxStringLength: null, breakLength: Infinity }));
export async function spyConsole(fn) {
  const lines = [], saved = {};
  for (const m of ["log", "error", "warn", "info", "debug", "trace", "dir", "dirxml", "table", "group", "groupCollapsed", "assert", "count", "timeLog"]) {
    saved[m] = console[m];
    console[m] = (...a) => {
      lines.push(format(...a));
      lines.push(a.map(show).join(" "));
      // a Headers / Request / Response: also its header list (inspect output can differ between runtimes)
      for (const x of a) for (const h of [x, x && x.headers]) if (h && typeof h.entries === "function" && typeof h.get === "function") lines.push(JSON.stringify([...h.entries()]));
      for (const x of a) if (x && typeof x === "object" && typeof x.url === "string") lines.push(x.url);
    };
  }
  try { await fn(); } finally { Object.assign(console, saved); }
  return lines.join("\n");
}

// a Rate Limiting binding stand-in: `limit` calls per key per test (period ignored), records the keys it saw
export function rateLimiter(limit = 3) {
  const seen = new Map();
  return { seen, limit: async ({ key }) => { const n = (seen.get(key) || 0) + 1; seen.set(key, n); return { success: n <= limit }; } };
}
