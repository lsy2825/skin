// Price alerts, factory side (가격 알림 — 공장 쪽): node cf/alerts/notify.mjs [app/data.json]
// Run by .github/workflows/weekly.yml in its own job ('price_alerts', a fresh runner after the factory job — also on days
// the factory had nothing to do or failed: expiring is daily). That job runs the CODE of ONE reviewed commit named by the
// repository Variable ALERTS_CODE_SHA (a human sets it when alerts code is merged; the factory's GITHUB_TOKEN cannot
// change variables) and reads only the DATA (app/data.json, parsed as JSON, never run) from main. Only that job gets
// ALERTS_URL and ALERTS_SECRET; the factory job (tools/factory.sh, scrapers, pip packages) never runs on its machine.
// Plain node, no npm packages.
//   1. GET  /v1/internal/watched   the (treatment key, region) pairs someone watches — no ids, no endpoints, no baselines
//   2. compute each pair from the published data.json with the app's own code (app/domain/pricectx.js, pricing.js,
//      stats.js — read only) on the price basis of the app's alert engine (병원 표시가) → digest entries (numbers only)
//   3. POST /v1/internal/digest    500 entries at a time;   4. POST /v1/internal/finish   the Worker marks who has news
// Prints counts only (never keys, ids or endpoints). A failure prints a ::warning and exits 0: alerts never fail the price
// build, and the next run catches up (news waits in D1 until a finish consumes it).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { pairStats } from "./src/digest.js";
import { kstDay, regionMatch, KEY_RE, REGIONS, validDay } from "./src/rules.js";

const require = createRequire(import.meta.url);
const PriceCtx = require("../../app/domain/pricectx.js");
const Stats = require("../../app/domain/stats.js");
const Pricing = require("../../app/domain/pricing.js");

const CHUNK = 500;
// The price basis of every number sent to the Worker (and so of every rule's max): the clinics' LISTED price (병원 표시가,
// raw data.json r[3]), every brand, specials (체험가·한정가·첫 방문·시간 조건) included — exactly what the app's own alert
// engine compares: app/app.js watchNow() uses ROWS[i][14] (= the raw listed price, kept before the VAT display) with the
// alert's specials setting (default store "special" true), and docs/ALERT_ENGINE_SPEC.md §3 says "값은 병원 표시가".
// Never the screen's VAT mode: a VAT display setting or a change of data2/vat_policy.json (r[12]) moves no number here.
// Tests fail if the app's alert engine changes basis.
export const listedPrice = (r) => r[3];

// per-branch lowest listed prices of the published rows (the app's PriceCtx), leaving out only rows waiting for review
// (r[13]). NOT filtered by event end date: data.json changes only when the factory publishes, so the numbers (and the
// news) change only then — a day passing never moves the baseline (and within one collection the Worker keeps the
// baseline from moving the bad way when a rebuild drops ended rows: src/sql.js DIGEST).
export function priceIndex(data, today) {
  const ctx = PriceCtx.build({
    rows: PriceCtx.rowsOf(data), S: data.s, branches: data.branches, keys: data.keys, trend: data.trend,
    updated: data.meta.updated, today, brands: data.meta.brands, price: listedPrice, live: (r) => !r[13],
  });
  return (k, reg) => ctx.prices(k, "").filter((x) => regionMatch(reg, x.region)).map((x) => x.p);
}

// rows still running today of the watched keys (expiring), as rowsFor(k, r) → [{p, until}]: not waiting for review and
// event not over (Pricing.isExpired, the rule the app uses)
export function rowIndex(data, keys, today) {
  const S = data.s, rows = PriceCtx.rowsOf(data), by = new Map();
  for (const r of rows) {
    const ks = S[r[7]];
    if (!ks || r[13] || Pricing.isExpired(S[r[10]] || "", today)) continue;
    for (const k of ks.split(" ")) {
      if (!keys.has(k)) continue;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push({ p: listedPrice(r), until: S[r[10]] || "", region: S[data.branches[r[0]][5]] || "" });
    }
  }
  return (k, reg) => (by.get(k) || []).filter((x) => regionMatch(reg, x.region));
}

// the day the key's rows were last regrouped (data.json meta.recl: [[day, [keys]], …], build2/appdata.py reclassified()),
// '' if never. Sent with every entry: a new day re-bases the pair in D1 without news (src/sql.js DIGEST), as the app's own
// checkAlerts does with reclDate.
export function reclDate(data, k) {
  let d = "";
  for (const [day, keys] of (data.meta && data.meta.recl) || []) if (validDay(day) && Array.isArray(keys) && keys.includes(k) && day > d) d = day;
  return d;
}

// Does this data.json still have the shape the Worker accepts? Every compare key must match rules.js KEY_RE and every
// branch region must be one of REGIONS (or empty) — otherwise the Worker would answer 400 (BAD_DIGEST, BAD_RULES) and the
// phones' rules for those treatments would die quietly. → [] or the problems (counts only, so the log stays clean)
export function shapeProblems(data) {
  const out = [];
  if (!data || !data.meta || !Array.isArray(data.keys) || !Array.isArray(data.branches) || !Array.isArray(data.s)) return ["not a data.json"];
  const badKeys = data.keys.filter((k) => !Array.isArray(k) || !KEY_RE.test(k[0] || "")).length;
  if (badKeys) out.push(`${badKeys} of ${data.keys.length} compare keys do not match KEY_RE`);
  const badRegions = data.branches.filter((b) => { const r = data.s[b[5]] || ""; return r && !REGIONS.includes(r); }).length;
  if (badRegions) out.push(`${badRegions} of ${data.branches.length} branches have a region not in REGIONS`);
  if (data.meta.recl != null && !(Array.isArray(data.meta.recl) && data.meta.recl.every((x) => Array.isArray(x) && validDay(x[0]) && Array.isArray(x[1])))) out.push("meta.recl is not [[day, [keys]]]");
  return out;
}

// the Worker address: https only — the first request carries Authorization: Bearer <ALERTS_SECRET>, which must never
// travel in the clear (http is allowed for this machine only: wrangler dev in test/local_dev.sh)
export function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error("ALERTS_URL is not a URL"); }
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)) return;
  throw new Error("ALERTS_URL must be https");
}

async function call(f, url, secret, path, body, { tries = 3, timeoutMs = 20000, waitMs = 1000 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await f(url + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.ok) return await r.json();
      err = new Error(`${path.split("?")[0]} answered ${r.status}`);
      if (r.status < 500 && r.status !== 429) break;     // other answers will not get better by retrying
    } catch (e) { err = e; }
    if (i + 1 < tries && waitMs) await new Promise((ok) => setTimeout(ok, waitMs * 2 ** i));
  }
  throw err;
}

export async function notify({ data, today = kstDay(Date.now()), url, secret, fetch: f = fetch, log = console.log, waitMs }) {
  checkUrl(url);
  url = url.replace(/\/+$/, "");
  // a data.json the Worker would refuse: say so and call nothing — no finish, so GET /health "finished" stops advancing and
  // after 2 days "stale": true, which the monitor (.github/scripts/health_check.py) turns into a Telegram line; the phones'
  // rules are not silently dropped
  const problems = shapeProblems(data);
  if (problems.length) {
    log(`::warning title=price alerts::app/data.json shape changed (${problems.join("; ")}) — nothing sent until cf/alerts/src/rules.js KEY_RE/REGIONS follow`);
    return { pairs: 0, entries: [], weekly: 0, expiring: 0, changed: 0, skipped: "shape" };
  }
  const run = `${data.meta.updated}|${today}`;
  const opt = waitMs === undefined ? {} : { waitMs };
  const pairs = [];
  for (let after = "|"; after !== null;) {
    const page = await call(f, url, secret, `/v1/internal/watched?after=${encodeURIComponent(after)}`, undefined, opt);
    pairs.push(...page.pairs);
    after = page.next;
  }
  let entries = [];
  if (pairs.length) {
    const prices = priceIndex(data, today);
    const rowsFor = rowIndex(data, new Set(pairs.map((p) => p.k)), today);
    entries = pairs.map((p) => ({ ...pairStats({ prices, rowsFor, median: Stats.median, k: p.k, r: p.r, today }), g: reclDate(data, p.k) }));
    for (let i = 0; i < entries.length; i += CHUNK) await call(f, url, secret, "/v1/internal/digest", { run, entries: entries.slice(i, i + CHUNK) }, opt);
  }
  // finish even with no pairs: it also clears yesterday's marks and records the day for GET /health "finished"
  const done = await call(f, url, secret, "/v1/internal/finish", { run, today }, opt);
  const ending = entries.filter((e) => e.e != null).length;
  log(`price alerts: ${pairs.length} watched pairs (${done.changed} changed, ${ending} ending soon), marked ${done.weekly} weekly + ${done.expiring} expiring`);
  return { pairs: pairs.length, entries, ...done };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.ALERTS_URL || "", secret = process.env.ALERTS_SECRET || "";
  if (!url || !secret) { console.log("price alerts: ALERTS_URL / ALERTS_SECRET not set — skipped"); process.exit(0); }
  const file = process.argv[2] || "app/data.json";
  // the data file is READ AS DATA from a checkout of main: a parse error never echoes its content (JSON.parse messages quote it)
  const readData = () => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("the data file is not readable JSON"); } };
  (async () => { checkUrl(url); return notify({ data: readData(), url, secret }); })().catch((e) => {
    // never fail the price build; the message is a path + status or a network error (no secret, no ids)
    console.log(`::warning title=price alerts::price alert check failed (${e && e.message}) — the next run catches up`);
    process.exit(0);
  });
}
