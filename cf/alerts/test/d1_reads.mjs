// D1 rows READ by the factory's finish and a send run, on the real runtime's D1 (workerd, wrangler getPlatformProxy) —
// the read ceiling of the 7th review, for the shape that broke it: every rule on a computed pair (concentrated), every rule
// an expiring one, and long exp_sent lists. node:sqlite cannot count rows read, so this runs from test/local_dev.sh:
//   node cf/alerts/test/d1_reads.mjs <the wrangler package folder>
// It checks, with N phones × 20 rules on P computed pairs:
//   1. no finish statement reads more when exp_sent is long (E = 60 entries, one ended) than when it is empty — membership
//      is a string search and the prune reads no list element (it was up to 6.5M rows in one finish at the ceiling);
//   2. PRUNE_XSENT reads each subscription row once, MARK_WEEKLY ≤ 41 and MARK_EXPIRING ≤ 70 rows per phone with 20 rules
//      (src/worker.js arithmetic at MAX_SUBS: 2,000 × (1 + 41 + 70) + 3 × PAIR_CAP ≈ 0.23M for a finish);
//   3. a push with an expiring notice reads ≤ 2 × (E + X) + 2 rows in SENT (X = pending entries merged in) — also with
//      E2 = 80 entries, the most a day's second such push can find (9th review: several finishes a day; rules.js END_DAYS);
//   4. (8th review) held rows (claim < 0): a send run's probes (CLAIM_P) read the same however many rows are held — about
//      PROBE_CLAIM_PER_ORIGIN rows per push origin that holds rows, PROBE_ORIGINS origins at most — and the release after a
//      2xx (RELEASE_HELD) frees SEND_LIMIT rows, reading ≤ RELEASE_PER_ROW per freed row, never the other held rows (it read
//      and sorted every held row of every origin: ~4 rows per held row in each of 77 runs, unbounded below MAX_SUBS).
//   5. (9th review) start: 'done' and 'deferred' read ≤ 4 rows and write none; 'compute' ≤ 10 rows read, ≤ 4 written.
// Exit 1 with the numbers when one fails. Nothing leaves this machine; the D1 is a throw-away folder.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const WR = process.argv[2];
if (!WR) { console.error("usage: node cf/alerts/test/d1_reads.mjs <wrangler package folder>"); process.exit(2); }
const { getPlatformProxy } = await import(pathToFileURL(join(WR, "wrangler-dist/cli.js")).href);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const { default: worker, send, SEND_LIMIT } = await import(new URL("../src/worker.js", import.meta.url).href);
const { PROBES, PROBE_ORIGINS } = await import(new URL("../src/rules.js", import.meta.url).href);
// the per-origin and per-freed-row ceilings src/worker.js uses for its arithmetic (measured: 31 and 7)
const PROBE_CLAIM_PER_ORIGIN = 32, PROBE_CLAIM_BASE = 20, RELEASE_PER_ROW = 8;
const Q = await import(new URL("../src/sql.js", import.meta.url).href);
const H = await import(new URL("./helpers.mjs", import.meta.url).href);

const N = 200, P = 150, E = 60, E2 = 80, X = 20;
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
  const add = (res, sql) => { if (res && res.meta) log.push([sql, res.meta.rows_read || 0, res.meta.rows_written || 0]); return res; };
  const wrap = (st, sql) => ({ bind: (...a) => wrap(st.bind(...a), sql), run: async () => add(await st.run(), sql), all: async () => add(await st.all(), sql),
    first: async (c) => { const r = add(await st.all(), sql).results[0]; return r === undefined ? null : c ? r[c] : r; }, __st: st, __sql: sql });
  const DB = { prepare: (sql) => wrap(raw.prepare(sql), sql), batch: async (list) => { const out = await raw.batch(list.map((s) => s.__st)); out.forEach((r, i) => add(r, list[i].__sql)); return out; } };
  const { jwk } = await H.vapidKeys();
  const env = H.makeEnv(DB, { PAIR_CAP: "3000", MAX_SUBS: "2000", VAPID_PRIVATE_JWK: jwk });
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
  // the same with E2 entries (four end dates × 20: today's own entries too — the second push with an expiring notice of a
  // day with several finishes)
  const listOf2 = JSON.stringify(Array.from({ length: E2 }, (_, i) => `2026-10-${21 + (i % 4)}|${key(9000 + i)}|`).sort());
  await raw.prepare("UPDATE subs SET pend_w = 1, last_w = '2026-10-01', pend_x = '2026-10-23', pend_xl = ?1, last_x = NULL, exp_sent = ?2, fails = 0, claim = NULL").bind(pend, listOf2).run();
  log = [];
  const r2 = await send(env, H.kst("2026-10-21T11:00:00"), { fetch: async () => new Response(null, { status: 201 }), waits: [0, 0] });
  const sentReads2 = log.filter(([sql]) => sql === Q.SENT).reduce((a, [, n]) => a + n, 0);
  console.log(`d1 reads: the same with exp_sent ${E2} + pend_xl ${X} (a day's second push with an expiring notice): SENT ${sentReads2} rows read for ${r2.sent} pushes`);
  if (r2.sent !== 40) fails.push(`the second send run sent ${r2.sent}, not 40`);
  if (sentReads2 > r2.sent * (2 * (E2 + X) + 2)) fails.push(`SENT read ${sentReads2} > ${r2.sent} × ${2 * (E2 + X) + 2}`);

  // 4. held rows. A send run at 12:00 where the first `h` rows are held (minute come) at `origins` push origins.
  //    waiting: every row had its weekly bundle yesterday (not due) — the probes are claimed, found not due and released;
  //    due:     every row is due and took pushes before; every push answers 201 — the probes go through and RELEASE_HELD frees
  //             SEND_LIMIT of the held rows in the run's closing batch
  const heldAt = H.kst("2026-10-22T12:00:00"), minute = Math.floor(heldAt / 60e3);
  const heldRun = async (h, origins, due) => {
    await raw.prepare(`UPDATE subs SET endpoint = CASE WHEN ?1 = 1 THEN 'https://fcm.googleapis.com/held/' || rowid ELSE 'https://wns2-h' || (rowid % ?1) || '.notify.windows.com/w/?token=' || rowid END,
      pend_w = 1, last_w = ?2, pend_x = NULL, pend_xl = NULL, last_x = NULL, exp_sent = NULL, fails = 0,
      claim = CASE WHEN rowid <= ?3 THEN -(?4 - 10 - rowid) ELSE NULL END`).bind(origins, due ? "2026-10-01" : "2026-10-21", h, minute).run();
    await raw.prepare("INSERT INTO stat (k, n) VALUES ('finish', 20261022) ON CONFLICT(k) DO UPDATE SET n = excluded.n").run();
    log = [];
    const res = await send(env, heldAt, { fetch: async () => new Response(null, { status: 201 }), waits: [0, 0] });
    const of = (q) => log.filter(([sql]) => sql === q).reduce((a, [, n]) => a + n, 0);
    const held = (await raw.prepare("SELECT count(*) AS c FROM subs WHERE claim < 0").first()).c;
    return { res, claimP: of(Q.CLAIM_P), release: of(Q.RELEASE_HELD), held, total: log.reduce((a, [, n]) => a + n, 0) };
  };
  const few = await heldRun(20, 1, false), all = await heldRun(N, 1, false), spread = await heldRun(N, 10, false);
  console.log(`d1 reads: held rows, not due — CLAIM_P ${few.claimP} rows read with 20 held, ${all.claimP} with ${N} held (one push origin), ${spread.claimP} with ${N} held over 10 origins`);
  if (all.claimP > few.claimP + 2) fails.push(`CLAIM_P read ${all.claimP} rows with ${N} held, ${few.claimP} with 20 (must not grow with the held rows)`);
  for (const [x, o] of [[all, 1], [spread, 10]])
    if (x.claimP > PROBE_CLAIM_BASE + PROBE_CLAIM_PER_ORIGIN * Math.min(o, PROBE_ORIGINS)) fails.push(`CLAIM_P read ${x.claimP} > ${PROBE_CLAIM_BASE} + ${PROBE_CLAIM_PER_ORIGIN} × ${o} origins`);
  if (spread.res.probes !== Math.min(10 * PROBES, 10)) fails.push(`10 origins holding rows should give PROBE_SLOTS probes, got ${spread.res.probes}`);
  const rel = await heldRun(N, 1, true), relSpread = await heldRun(N, 10, true);
  console.log(`d1 reads: held rows, all due, every push 201 — RELEASE_HELD ${rel.release} rows read (one origin, ${N - rel.held - PROBES} freed), ${relSpread.release} (10 origins, ${N - relSpread.held - relSpread.res.probes} freed); the run ${rel.total} / ${relSpread.total}`);
  for (const [x, label] of [[rel, "one origin"], [relSpread, "10 origins"]]) {
    const freed = N - x.held - x.res.probes;
    if (freed !== SEND_LIMIT) fails.push(`${label}: a run freed ${freed} held rows, not SEND_LIMIT ${SEND_LIMIT}`);
    if (x.release > RELEASE_PER_ROW * SEND_LIMIT + 20) fails.push(`${label}: RELEASE_HELD read ${x.release} > ${RELEASE_PER_ROW} × ${SEND_LIMIT} + 20`);
  }

  // 5. start (9th review): what a factory run or a catch-up costs before it computes anything
  const startAt = async (fp, when) => {
    log = [];
    const res = await worker.fetch(new Request("https://alerts.local/v1/internal/start", { method: "POST", headers: { authorization: "Bearer " + H.SECRET_VALUE, "content-type": "application/json" }, body: JSON.stringify({ fp }) }), env, { waitUntil() {} }, H.kst(when));
    const body = await res.json();
    return { go: body.go, lease: body.lease, read: log.reduce((a, [, n]) => a + n, 0), written: log.reduce((a, [, , w]) => a + w, 0) };
  };
  const fpA = "a".repeat(64);
  const first = await startAt(fpA, "2026-10-23T10:00:00");
  at = "2026-10-23T10:01:00";
  await call("/v1/internal/finish", { run: "2026-10-23|2026-10-23", today: "2026-10-23", fp: fpA, lease: first.lease });
  const done = await startAt(fpA, "2026-10-23T12:00:00");
  for (const [i, c] of ["b", "c"].entries()) {
    const g = await startAt(c.repeat(64), `2026-10-23T1${3 + i}:00:00`);
    at = `2026-10-23T1${3 + i}:01:00`;
    await call("/v1/internal/finish", { run: "2026-10-23|2026-10-23", today: "2026-10-23", fp: c.repeat(64), lease: g.lease });
  }
  const deferred = await startAt("d".repeat(64), "2026-10-23T16:00:00");
  console.log(`d1 reads: start — compute ${first.read} read / ${first.written} written, done ${done.read} / ${done.written}, deferred ${deferred.read} / ${deferred.written}`);
  if (first.go !== "compute" || done.go !== "done" || deferred.go !== "deferred") fails.push(`start answered ${first.go}, ${done.go}, ${deferred.go} — not compute, done, deferred`);
  for (const [label, x] of [["done", done], ["deferred", deferred]]) if (x.read > 4 || x.written > 0) fails.push(`start ${label} read ${x.read} > 4 or wrote ${x.written} > 0`);
  if (first.read > 10 || first.written > 4) fails.push(`start compute read ${first.read} > 10 or wrote ${first.written} > 4`);
} finally {
  await mf.dispose();
  rmSync(persist, { recursive: true, force: true });
}
if (fails.length) { for (const f of fails) console.error("FAIL d1 reads: " + f); process.exit(1); }
console.log("ok   d1 reads: the finish does not read more with long exp_sent lists; per-phone reads within the documented ceiling; held rows cost the same however many are held");
