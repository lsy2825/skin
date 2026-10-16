// Price alerts, factory side (가격 알림 — 공장 쪽): ALERTS_MODE=full|keys node cf/alerts/notify.mjs [app/data.json]
// Run by .github/workflows/weekly.yml in its own job ('price_alerts', a fresh runner after the deploy job deployed the app
// in that run, or on the daily schedule's 'nothing to build' days with the copy already deployed). That job runs the CODE
// of ONE reviewed commit named by the repository Variable ALERTS_CODE_SHA (a human sets it when alerts code is merged; the
// factory's GITHUB_TOKEN cannot change variables) and reads only the DATA: app/data.json of the commit the deploy job took
// it from (or main's copy on a no-build day), used only when its sha256 is the one data-meta.json names and the public app
// serves that same data-meta.json — what the phones were given — parsed as JSON, never run. Only that job gets ALERTS_URL
// and ALERTS_SECRET; the factory job (tools/factory.sh, scrapers, pip packages) never runs on its machine. Plain node, no
// npm packages.
// ALERTS_MODE (weekly.yml sets it): full = the FIRST attempt of the daily schedule run only — steps 1–5; keys = every other
// run (started by a push to main, by Run workflow — a manual collection, price-check.yml's or the redeploy job's rebuild —
// or a Re-run): only step 1, ≤ 1 D1 row written, and a ::notice that this data.json is computed by the next daily run
// (06:00 KST): the D1 budget holds one computation a day (src/worker.js). A full run of a data.json the Worker already
// finished today (same sha256, same KST day) stops after step 2's first page (done): no digest, no finish.
//   1. POST /v1/internal/keys      the compare keys of this data.json (ascending, each once): the Worker keeps them as one
//      row (rewritten only when they change) and ranks only pairs of these keys in (2) — a key the data does not have can
//      never be computed, so its pair must never take a place in the list (5th review); rules naming another key are
//      still stored and wait (6th review), computed from the first daily run whose data.json has the key
//   2. GET  /v1/internal/watched   the (treatment key, region) pairs someone watches — no ids, no endpoints, no baselines;
//      at most the Worker's PAIR_CAP (most important first), in one page; data = this file's sha256 (done: already finished
//      today); a pair whose key is not in this data.json is still skipped here (it would be one D1 row written for nothing)
//   3. compute each pair from that data.json (the copy the phones were given) with the app's own code
//      (app/domain/pricectx.js, pricing.js, stats.js — read only) on the price basis of the app's alert engine (병원 표시가)
//      → digest entries (numbers only)
//   4. POST /v1/internal/digest    500 entries at a time (a pair new to the Worker is kept only while its table has room
//      under PAIR_CAP: one left out waits for a row the finish frees — {skipped});   5. POST /v1/internal/finish   the
//      Worker marks who has news
// Prints counts only (never keys, ids or endpoints). A failure prints a ::warning and exits 0: alerts never fail the price
// build. News waits in D1 until a finish consumes it, and the next daily run (06:00 KST, weekly.yml ALERTS_MODE=full)
// computes again — a run started by a push, by Run workflow or a Re-run only sends the key set (8th review: "the next run
// catches up" sent an operator to Run workflow, which computes nothing).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { pairStats } from "./src/digest.js";
import { kstDay, regionMatch, KEY_RE, REGIONS, MAX_KEYS, validDay } from "./src/rules.js";

const require = createRequire(import.meta.url);
const PriceCtx = require("../../app/domain/pricectx.js");
const Stats = require("../../app/domain/stats.js");
const Pricing = require("../../app/domain/pricing.js");

const CHUNK = 500;
// The price basis of every number sent to the Worker (and so of every rule's max): the clinics' LISTED price (병원 표시가,
// raw data.json r[3]), every brand, specials (체험가·한정가·첫 방문·시간 조건) included — the default of the app's own
// alert engine: app/app.js watchNow() uses ROWS[i][14] (= the raw listed price, kept before the VAT display) with the
// alert's specials setting (default store "special" true), and docs/ALERT_ENGINE_SPEC.md §3 says "값은 병원 표시가".
// Specials included; alerts made with specials off (a.sp === false) are counted on the phone only (B #62: app/domain/push.js
// rulesOf never sends them as server rules), because these numbers would not match them.
// Never the screen's VAT mode: a VAT display setting or a change of data2/vat_policy.json (r[12]) moves no number here.
// Tests fail if the app's alert engine changes basis.
export const listedPrice = (r) => r[3];

// per-branch lowest listed prices of the published rows (the app's PriceCtx), leaving out only rows waiting for review
// (r[13]). NOT filtered by event end date: the deployed data.json changes only when a new build is deployed, so the numbers
// (and the news) change only then — a day passing never moves the baseline (and within one collection the Worker keeps the
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

// Does this data.json still have the shape the Worker accepts? Every compare key must match rules.js KEY_RE, there may be
// at most MAX_KEYS of them, and every branch region must be one of REGIONS (or empty) — otherwise the Worker would answer
// 400 (BAD_KEYS, BAD_DIGEST, BAD_RULES) and the phones' rules for those treatments would die quietly. → [] or the
// problems (counts only, so the log stays clean)
export function shapeProblems(data) {
  const out = [];
  if (!data || !data.meta || !Array.isArray(data.keys) || !Array.isArray(data.branches) || !Array.isArray(data.s)) return ["not a data.json"];
  const badKeys = data.keys.filter((k) => !Array.isArray(k) || !KEY_RE.test(k[0] || "")).length;
  if (badKeys) out.push(`${badKeys} of ${data.keys.length} compare keys do not match KEY_RE`);
  if (data.keys.length > MAX_KEYS) out.push(`${data.keys.length - MAX_KEYS} of ${data.keys.length} compare keys are past MAX_KEYS`);
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

// mode 'full' (default) | 'keys'; sha = the data.json's sha256 (hex) — sent so the Worker can say done (see above); without
// it a full run always computes
export async function notify({ data, sha, mode = "full", today = kstDay(Date.now()), url, secret, fetch: f = fetch, log = console.log, waitMs }) {
  checkUrl(url);
  url = url.replace(/\/+$/, "");
  if (mode !== "full" && mode !== "keys") throw new Error("ALERTS_MODE must be full or keys");
  if (sha !== undefined && !/^[0-9a-f]{64}$/.test(sha)) throw new Error("the data sha256 is not 64 hex digits");
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
  // the keys this data.json has, sent first: the Worker ranks only pairs of these keys (a key it cannot compute never takes
  // a place in the list); a rule naming another key is stored and waits. Ascending, each once (rules.js keySetJson)
  const keySet = [...new Set(data.keys.map((k) => k[0]))].sort();
  const ks = await call(f, url, secret, "/v1/internal/keys", { keys: keySet }, opt);
  if (mode === "keys") {
    const keysChanged = ks && ks.changed ? "changed" : "unchanged";
    log(`price alerts: key set sent (${keySet.length} keys, ${keysChanged}) — only the daily schedule run computes`);
    log("::notice title=price alerts::this run sent the key set only — the alerts for this data.json are computed by the next daily run (06:00 KST). A push, Run workflow or Re-run never computes: the D1 budget holds one computation a day");
    return { mode, keys: keySet.length, changed: !!(ks && ks.changed) };
  }
  const watched = [];
  let capped = false;
  for (let at = 0; at !== null;) {
    const page = await call(f, url, secret, `/v1/internal/watched?at=${at}${at === 0 && sha ? `&data=${sha}` : ""}`, undefined, opt);
    if (at === 0 && page.done === true) {
      log("price alerts: this data.json was already finished today (same sha256, same KST day) — nothing more to do");
      return { mode, pairs: 0, entries: [], done: true };
    }
    watched.push(...page.pairs);
    capped = capped || page.capped === true;
    at = Number.isInteger(page.next) && page.next > at ? page.next : null;
  }
  if (capped) log("::warning title=price alerts::the Worker cut the watched list at PAIR_CAP — some pairs were not computed (GET /health pairs: capped)");
  // only keys this data.json has (a key that left the data — a regroup — gets a fresh baseline when it is back: no news).
  // The Worker already ranked only these (the key set above); this guards against a Worker that did not
  const known = new Set(keySet);
  const seen = new Set();
  const pairs = watched.filter((p) => { const id = `${p.k}|${p.r}`; if (!known.has(p.k) || seen.has(id)) return false; seen.add(id); return true; });
  let entries = [];
  if (pairs.length) {
    const prices = priceIndex(data, today);
    const rowsFor = rowIndex(data, new Set(pairs.map((p) => p.k)), today);
    entries = pairs.map((p) => ({ ...pairStats({ prices, rowsFor, median: Stats.median, k: p.k, r: p.r, today }), g: reclDate(data, p.k) }));
    let waiting = 0;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const d = await call(f, url, secret, "/v1/internal/digest", { run, entries: entries.slice(i, i + CHUNK) }, opt);
      if (d && Number.isInteger(d.skipped) && d.skipped > 0) waiting += d.skipped;
    }
    if (waiting) log("::warning title=price alerts::new pairs wait for a free row under the Worker's PAIR_CAP — not computed today (GET /health pairs: capped)");
  }
  // finish even with no pairs: it also clears yesterday's marks and records the day for GET /health "finished"
  const done = await call(f, url, secret, "/v1/internal/finish", { run, today, ...(sha ? { data: sha } : {}) }, opt);
  const ending = entries.filter((e) => e.e != null).length;
  const skipped = watched.length - pairs.length;
  log(`price alerts: ${pairs.length} watched pairs (${skipped} skipped, ${done.changed} changed, ${ending} ending soon), marked ${done.weekly} weekly + ${done.expiring} expiring (${done.cleared} stale expiring cleared)`);
  return { mode, pairs: pairs.length, entries, ...done };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.ALERTS_URL || "", secret = process.env.ALERTS_SECRET || "";
  // missing ALERTS_URL / ALERTS_SECRET (names only, never a value): neither = alerts not set up (a ::notice); one without
  // the other = a half-done setup (a ::warning, so it shows on the run's page). weekly.yml gives ALERTS_URL a default (the
  // alerts Worker's workers.dev address), so there a missing ALERTS_SECRET is the warning.
  if (!url && !secret) { console.log("::notice title=price alerts::ALERTS_URL and ALERTS_SECRET are not set — price alerts skipped"); process.exit(0); }
  if (!secret) { console.log("::warning title=price alerts::ALERTS_SECRET is not set (ALERTS_URL is) — price alerts skipped. Create the repository secret ALERTS_SECRET (Settings → Secrets and variables → Actions → New repository secret), then run the cf-alerts workflow (Run workflow, branch main) so the Worker gets the same value: setup_keys the first time, sync_secret afterwards (it keeps the VAPID keys)"); process.exit(0); }
  if (!url) { console.log("::warning title=price alerts::ALERTS_URL is not set (ALERTS_SECRET is) — price alerts skipped. Set ALERTS_URL (an Actions secret or variable) to the alerts Worker's https address"); process.exit(0); }
  const file = process.argv[2] || "app/data.json";
  const mode = process.env.ALERTS_MODE || "full";
  // the data file is READ AS DATA (in weekly.yml: app/data.json of the deployed commit): a parse error never echoes its
  // content (JSON.parse messages quote it). Its sha256 is of the bytes read
  const readData = () => {
    let raw;
    try { raw = readFileSync(file); } catch { throw new Error("the data file is not readable"); }
    try { return { data: JSON.parse(raw.toString("utf8")), sha: createHash("sha256").update(raw).digest("hex") }; } catch { throw new Error("the data file is not readable JSON"); }
  };
  (async () => { checkUrl(url); return notify({ ...readData(), mode, url, secret }); })().catch((e) => {
    // never fail the price build; the message is a path + status or a network error (no secret, no ids)
    console.log(`::warning title=price alerts::price alert check failed (${e && e.message}) — the next daily run (06:00 KST) computes again; a push, Run workflow or Re-run only sends the key set`);
    process.exit(0);
  });
}
