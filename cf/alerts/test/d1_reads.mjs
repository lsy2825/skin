// D1 rows READ by the factory's finish and a send run, on the real runtime's D1 (workerd, wrangler getPlatformProxy) —
// the read ceiling of the 7th review, for the shape that broke it: every rule on a computed pair (concentrated), every rule
// an expiring one, and long exp_sent lists. node:sqlite cannot count rows read, so this runs from test/local_dev.sh:
//   node cf/alerts/test/d1_reads.mjs <the wrangler package folder>
// It checks, with N phones × 20 rules on P computed pairs:
//   1. no finish statement reads more when exp_sent is long (E = 60 entries, one ended) than when it is empty — membership
//      is a string search and the prune reads no list element (it was up to 6.5M rows in one finish at the ceiling);
//   2. PRUNE_XSENT reads each subscription row once, MARK_WEEKLY ≤ 41 and MARK_EXPIRING ≤ 70 rows per phone with 20 rules
//      (src/worker.js arithmetic at MAX_SUBS: 8,000 × (1 + 41 + 70) + 3 × PAIR_CAP ≈ 0.9M for a finish);
//   3. a push with an expiring notice reads ≤ 2 × (E + X) + 2 rows in SENT (X = pending entries merged in).
// Exit 1 with the numbers when one fails. Nothing leaves this machine; the D1 is a throw-away folder.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const WR = process.argv[2];
if (!WR) { console.error("usage: node cf/alerts/test/d1_reads.mjs <wrangler package folder>"); process.exit(2); }
const { getPlatformProxy } = await import(pathToFileURL(join(WR, "wrangler-dist/cli.js")).href);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const { default: worker, send } = await import(new URL("../src/worker.js", import.meta.url).href);
const Q = await import(new URL("../src/sql.js", import.meta.url).href);
const H = await import(new URL("./helpers.mjs", import.meta.url).href);

const N = 200, P = 150, E = 60, X = 20;
const persist = mkdtempSync(join(tmpdir(), "alerts-d1-reads-"));
const mf = await getPlatformProxy({ configPath: join(HERE, "../wrangler.jsonc"), persist: { path: persist } });
const fails = [];
try {
  const raw = mf.env.DB;
  // the migration, statement by statement (the trigger bodies hold ';')
  const mig = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  let buf = "";
  for (const line of mig.split("\n")) {
    buf += line + "\n";
    const t = buf.trim();
    if (!t) { buf = ""; continue; }
    if (/^CREATE TRIGGER/i.test(t) ? /END;\s*$/.test(t) : /;\s*$/.test(t)) { await raw.prepare(t).run(); buf = ""; }
  }
  // count rows read per statement (and per send-run statement) through a D1-shaped wrapper
  let log = [];
  const add = (res, sql) => { if (res && res.meta) log.push([sql, res.meta.rows_read || 0]); return res; };
  const wrap = (st, sql) => ({ bind: (...a) => wrap(st.bind(...a), sql), run: async () => add(await st.run(), sql), all: async () => add(await st.all(), sql),
    first: async (c) => { const r = add(await st.all(), sql).results[0]; return r === undefined ? null : c ? r[c] : r; }, __st: st, __sql: sql });
  const DB = { prepare: (sql) => wrap(raw.prepare(sql), sql), batch: async (list) => { const out = await raw.batch(list.map((s) => s.__st)); out.forEach((r, i) => add(r, list[i].__sql)); return out; } };
  const { jwk } = await H.vapidKeys();
  const env = H.makeEnv(DB, { PAIR_CAP: "3000", MAX_SUBS: "8000", VAPID_PRIVATE_JWK: jwk });
  const key = (i) => "T" + String(i).padStart(7, "0");
  const keys = Array.from({ length: P }, (_, i) => key(i));
  // N phones × 20 expiring rules, all on the P computed pairs
  for (let s = 0; s < N; s += 50) {
    const b = [raw.prepare(Q.SET_DAY).bind(20261018)];
    for (let i = s; i < s + 50; i++) {
      const rules = Array.from({ length: 20 }, (_, j) => ({ kind: "expiring", key: keys[(i * 7 + j * 7) % P] }));
      const uniq = [...new Map(rules.map((r) => [r.key, r])).values()].sort((a, c) => (a.key < c.key ? -1 : 1));
      b.push(raw.prepare(Q.SUBSCRIBE).bind("i" + String(i).padStart(21, "0"), `https://fcm.googleapis.com/r/${i}`, JSON.stringify(uniq), "2026-10-18", 100000, 100000));
    }
    await raw.batch(b);
  }
  const rulesRead = (await raw.prepare("SELECT sum(json_array_length(rules)) AS n FROM subs").first()).n;
  let at;
  const call = async (path, body) => {
    const r = await worker.fetch(new Request("https://alerts.local" + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + H.SECRET_VALUE, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} }, H.kst(at));
    if (r.status !== 200) throw new Error(`${path} answered ${r.status}`);
    return r.json();
  };
  const run = async (today, entry) => {
    at = `${today}T06:00:00`;
    await call("/v1/internal/keys", { keys });
    await call("/v1/internal/watched?at=0");
    await call("/v1/internal/digest", { run: `${today}|${today}`, entries: keys.map(entry) });
    log = [];
    await call("/v1/internal/finish", { run: `${today}|${today}`, today });
    const by = {};
    for (const [sql, r] of log) { const name = Object.entries(Q).find(([, v]) => v === sql)?.[0] || "?"; by[name] = (by[name] || 0) + r; }
    return by;
  };
  await run("2026-10-19", (k) => ({ k, r: "", m: 1000, n: 3, med: 1000 }));
  // the read-heavy finish (7th review "day 3b"): no weekly news, every expiring rule a NEW end date, every phone holding
  // yesterday's mark and an exp_sent list with one ended entry
  const listOf = (n) => (n ? JSON.stringify(Array.from({ length: n }, (_, i) => `2026-10-${String(i ? 21 + (i % 3) : 20).padStart(2, "0")}|${key(5000 + i)}|`).sort()) : null);
  const heavy = (k) => ({ k, r: "", m: 1000, n: 3, med: 1000, e: 1000, s: null, u: "2026-10-23" });
  await raw.prepare("UPDATE subs SET pend_w = 0, pend_x = '2026-10-22', pend_xl = '[\"2026-10-22|T9999999|\"]', exp_sent = ?1").bind(listOf(0)).run();
  const short = await run("2026-10-21", heavy);
  await raw.prepare("UPDATE subs SET pend_w = 0, pend_x = '2026-10-22', pend_xl = '[\"2026-10-22|T9999999|\"]', exp_sent = ?1").bind(listOf(E)).run();
  const long = await run("2026-10-21", heavy);
  console.log(`d1 reads: ${N} phones × ${rulesRead / N} expiring rules on ${P} pairs — finish with exp_sent empty ${JSON.stringify(short)}`);
  console.log(`d1 reads: the same with ${E} entries (one ended) ${JSON.stringify(long)}`);
  for (const k of ["MARK_WEEKLY", "MARK_EXPIRING", "PROMOTE", "PRUNE_SNAP", "ROLL_BU"])
    if (long[k] !== short[k]) fails.push(`${k} reads ${long[k]} with ${E} exp_sent entries, ${short[k]} without (must not grow with exp_sent)`);
  if (long.PRUNE_XSENT > N + 1) fails.push(`PRUNE_XSENT read ${long.PRUNE_XSENT} rows for ${N} phones (each row once, no list element)`);
  if (long.MARK_WEEKLY > N * 41 + 1) fails.push(`MARK_WEEKLY read ${long.MARK_WEEKLY} > ${N} × 41 + 1`);
  if (long.MARK_EXPIRING > N * 70) fails.push(`MARK_EXPIRING read ${long.MARK_EXPIRING} > ${N} × 70`);
  // a send run: 40 phones due an expiring notice, each with E announced entries and X pending ones
  const pend = JSON.stringify(Array.from({ length: X }, (_, i) => `2026-10-23|${key(7000 + i)}|`).sort());
  await raw.prepare("UPDATE subs SET pend_w = 0, pend_x = '2026-10-23', pend_xl = ?1, last_x = NULL, exp_sent = ?2, fails = 0, claim = NULL").bind(pend, listOf(E)).run();
  log = [];
  const r = await send(env, H.kst("2026-10-21T10:00:00"), { fetch: async () => new Response(null, { status: 201 }), waits: [0, 0] });
  const sentReads = log.filter(([sql]) => sql === Q.SENT).reduce((a, [, n]) => a + n, 0);
  console.log(`d1 reads: a send run of ${r.sent} pushes with an expiring notice (exp_sent ${E} + pend_xl ${X} each): SENT ${sentReads} rows read, the run ${log.reduce((a, [, n]) => a + n, 0)}`);
  if (r.sent !== 40) fails.push(`the send run sent ${r.sent}, not 40`);
  if (sentReads > r.sent * (2 * (E + X) + 2)) fails.push(`SENT read ${sentReads} > ${r.sent} × ${2 * (E + X) + 2}`);
  const merged = JSON.parse((await raw.prepare("SELECT exp_sent FROM subs WHERE last_x = '2026-10-21' LIMIT 1").first()).exp_sent);
  if (merged.join() !== [...merged].sort().join() || merged.some((x) => x < "2026-10-21")) fails.push("SENT must keep exp_sent sorted and drop ended entries");
} finally {
  await mf.dispose();
  rmSync(persist, { recursive: true, force: true });
}
if (fails.length) { for (const f of fails) console.error("FAIL d1 reads: " + f); process.exit(1); }
console.log("ok   d1 reads: the finish does not read more with long exp_sent lists; per-phone reads within the documented ceiling");
