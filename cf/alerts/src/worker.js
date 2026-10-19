// 가격 알림 (yoonsiljang-alerts): Web Push subscriptions in D1 and a once-a-week bundled push, Cloudflare Workers Paid (the
// plan profile below; PLAN "free" fits a Free account).
//   POST   /v1/push/subscribe       {subscription, rules} → 201 {id}       (the phone keeps the id; nothing personal stored)
//   PUT    /v1/push/rules/{id}      {rules}               → 200 {ok:true} | 404 (unknown id); rules [] DELETES the row
//                                                            (200 {ok:true}; afterwards that id answers 404)
//     both (약속 1 exactly — 7th review: no extra field): the rules are stored as sent, whatever their keys; a pair whose
//           key is not in the key set of the factory's last data.json is not ranked (sql.js WATCHED) until a later key set
//           holds it, and is computed from the next computation on (a changed set of prices, or the day's first)
//   DELETE /v1/push/subscribe/{id}                        → 204
//   GET    /health (= /v1/health)                         → 200 {ok:true, window, sending, key, finished, stale, refusing,
//                                                            capacity, pairs, compute, plan} (health() below) | 503
//                                                            {ok:false} when D1 fails
//   /v1/internal/{start,keys,watched,digest,finish,send}  → the price factory and the catch-up every 30 minutes (weekly.yml,
//                                                            alerts-catchup.yml → notify.mjs), Bearer ALERTS_SECRET
//   cron '*/10 23,0-11 * * *' (UTC = 08:00–20:50 KST)     → send(): at most SEND_LIMIT pushes per run
// No Cloudflare imports, so node tests import this file and pass their own env (DB = a D1-shaped wrapper over node:sqlite).
// src/index.js re-exports only the default handler (a Worker entry may export nothing else).
//
// D1 arithmetic for BOTH plan profiles (re-check when changing the cron, PLANS, PAIR_CAP, LEASE_MS, an index or the start gate).
// 10th review — a user decision of 2026-10-19: the app launches on Cloudflare Workers PAID ($5 a month). 11th review: the
// account is still Free when this Worker is first deployed (merging deploys it), so wrangler.jsonc keeps PLAN "free" until
// the account IS on Workers Paid; the launch is: switch the account → merge a one-line PR setting PLAN "paid" → then
// PUBLIC_DEPLOY "on" (GET /health "plan" shows the setting only, never the account's plan). Paid includes, a month (renewed
// on the subscription date — the worst month has 31 days), FOR THE WHOLE ACCOUNT (cf/metrics shares it): 50 million D1 rows
// written (then $1.00 a million), 25 billion read (then $0.001 a million), 5 GB stored (then $0.75 a GB-month); Workers 10
// million requests and 30 million CPU ms (then $0.30 / $0.02 a million); 10,000 subrequests an invocation, 6 connections at
// a time, 30 s CPU per cron run (interval < 1 hour) and 15 minutes of wall time, 30 s CPU per HTTP request (no wrangler
// "limits" block: a Free account refuses one at deploy — every limit is kept in code, PLANS/limits below). Free: 100,000
// rows written and 5 million read a DAY (00:00–24:00 UTC = 09:00–09:00 KST; since 2026-09-01 an account over it gets an
// error for EVERY D1 query until 09:00 KST — no finish, no send, no subscribe), 50 outside requests an invocation, 10 ms
// CPU. Profiles (PLANS): free = what keeps D1 Free's day with ≥ 5% left; paid = what keeps the WORST month inside the
// included allowance with ≥ 5% left, so the bill stays $5.
//                       SEND_LIMIT  MAX_SUBS  NEW_PER_DAY  COMPUTES_PER_DAY
//                free           40     1,750          500                 3
//                paid          200    15,000        1,500                12
//   WHEN THE FACTORY COMPUTES (9th review — prices computed at most 2 hours after a deploy, a user decision of 2026-10-16):
//         every weekly.yml run that deployed data (schedule, Run workflow — a manual collection, price-check.yml's or the
//         redeploy job's rebuild —, a push, a Re-run) and every alerts-catchup.yml run (every 30 minutes, :07 and :37 UTC)
//         asks start (below) with the data's fingerprint first. Prices finished today are 'done': ≤ 30 rows read (measured
//         5), 0 written. Changed prices are computed at once; at most COMPUTES_PER_DAY computations are COUNTED per D1 day
//         (stat 'fc'), and before 21:00 UTC (06:00 KST) only COMPUTES_PER_DAY − 1 — the last one is the 06:00 run's (10th
//         review; a day of data PRs used them all by the afternoon) —, for a catch-up before 23:00 UTC (08:00 KST; 11th
//         review: the 06:07 catch-up took it for the prices deferred the afternoon before, and the 06:00 collection then
//         waited for 09:00). One runs at a time ('busy', stat 'lease'). None starts in the last LEASE_MS of a D1 day
//         (23:45–24:00 UTC), so every write lands in the D1 day that counted it. A retry of the same prices after a
//         computation of them that started this D1 day and died (its lease ran out) is not counted, once a D1 day — that dead
//         try wrote ≤ 7,015 rows (its digest; its finish never committed). Unchanged prices are computed once more each KST
//         day (ending prices count days): not before 06:00 (NIGHT_END_HOUR — the 06:00 run does it), by a catch-up not before
//         08:00 (CATCHUP_ROLL_HOUR: a collection takes ~40–45 minutes). A computation that crosses KST midnight notes the day
//         it computed (finish below), so the next day's own computation still runs.
//   LATENCY (what the user was promised, deploy → computed): every path, honestly —
//         (1) the same workflow run, minutes: the price_alerts job (a fresh runner, ~1 minute), its data step (≤ 4 minutes
//             while the public app does not serve the new data-meta.json yet), the computation (measured 0.5–6.0 s on a
//             local D1 at 1,750–15,000 phones) → usually ≤ ~7 minutes;
//         (2) that job could not compute (a skipped data step, a failure before start, 'busy'): the next catch-up — ≤ 30
//             minutes to its schedule + GitHub's delay (21–25 minutes were seen for weekly.yml's 06:00 schedule; the :07/:37
//             delay is measured only after the merge) + its data step and computation → ≤ ~1 hour;
//         (3) a computation that died holding the lease (≤ LEASE_MS 15 minutes 'busy'): the first catch-up after the lease
//             runs out retries the same prices uncounted → ≤ 17 + 30 + 25 + 5 ≈ 77 minutes; one GitHub run dropped (it may,
//             under load) adds 30 → ≈ 1 h 50 min. So ≤ 2 hours holds for (1)–(3) with GitHub's delay ≤ ~25 minutes and at most
//             one dropped run. Past 2 hours: GitHub delays a scheduled run longer or drops two in a row; the retry dies too
//             (then counted: each further try uses the cap); the cap is used up — 'deferred' until 09:00 KST (cap: up to
//             ~23 hours) or the 06:00 run (the 06:00 share: up to ~21 hours; that run computes main's prices, which hold the
//             deferred ones — or, if it does not compute, the 08:07 catch-up). Paid's 12 cover the worst day seen (11
//             fingerprints deployed on 2026-10-14 UTC, most of them data PRs); free's 3 do not (merge data PRs together). The
//             D1 day's edge (08:45–09:00 KST) waits for the 09:07 catch-up: ≤ ~50 minutes, inside 2 hours. UNTIL A PERSON
//             FIXES IT (11th review): a start every retry gets the same 4xx (401/403: GitHub's ALERTS_SECRET is not the
//             Worker's; 404: ALERTS_URL is not this Worker), an answer the pinned code does not know, a data.json shape the
//             Worker would refuse, or ALERTS_CODE_SHA unset while public hosting is on and ALERTS_SECRET is set — nothing is
//             computed; weekly.yml's alert job sends a Telegram line at every factory run that meets it (startfail — the next
//             one that deploys, the daily 06:00 schedule at the latest; the catch-up has no Telegram). A Worker or D1 that does
//             not answer (5xx, network): nothing computed until it is back — the 09:30 KST monitor reports GET /health down,
//             and after 2 days 'stale'
//   runs that may send: the cron fires 13 h × 6 = 78 times a day; inWindow() refuses 20:50 → 77 runs (08:00 … 20:40 KST).
//         The same cron for both profiles (a cron cannot follow a var): free 77 × 40 = 3,080 pushes a day, paid 77 × 200 =
//         15,400 — each ≥ MAX_SUBS, so every phone can be pushed on its worst day (a phone needs ≈ 2 a week: ≤ 1 weekly bundle
//         + pushes with an expiring notice, ≤ 1 a day — rules.js dueKinds). A day with more due sends expiring rows first,
//         nearest end date first (CLAIM_X). Held rows (rules.js HOLD) take at most PROBE_SLOTS 10 of a run as probes and
//         come back at most SEND_LIMIT a run once that service answers 2xx; rows that failed before take at most FAIL_SLOTS 10
//   a send run: free ≤ 40 push fetches (redirects never followed, 1 each) of the 50 outside requests allowed; paid ≤ 200 of
//         10,000 (PLAN "paid" on a Free account: the 51st fetch throws "Too many subrequests." — send stops the run like a
//         stall, releases the rest and counts no failure; 11th review). D1 = the claim batch + one results batch per parallel
//         group of 6 (free ≤ 7, paid ≤ 34) + the closing one, each tried at most 3 times → ≤ 27 / ≤ 108 D1 calls. Wall time
//         at worst (every push hits the 8 s timeout): free 7 × 8 s ≈ 1 minute, paid 34 × 8 s ≈ 4.5 minutes — inside the
//         10-minute cadence and the 15-minute cron limit. CPU, 10th/11th review, measured in node over the workerd D1 proxy
//         (process.cpuUsage around send(): an UPPER bound — the proxy's RPC and JSON are in it; workerd reports no CPU time
//         locally): 141–186 ms a run of 40 pushes, 439–623 ms a run of 200 (≤ 3.1 ms a push), 14–22 ms a run with nothing to
//         send. Paid's 30 s cron CPU leaves ≥ 48 times that. Free's 10 ms was never measured on the real runtime (the node
//         figure is far above it — a guess that the native D1 binding costs much less; the free profile is not what launches)
//   D1 WRITES — D1 counts every row a statement writes plus one per index entry it changes. Rows written per statement,
//         measured on a local D1 (wrangler 4.145.0 / workerd; production is assumed to count the same way — a guess), deletes
//         counted as 2 (row + primary-key entry, as the D1 docs describe). With R = 77 runs, S = SEND_LIMIT, M = MAX_SUBS,
//         N = NEW_PER_DAY, K = COMPUTES_PER_DAY, a D1 day where everything peaks at once:
//           pushes: claim 2 + its result (SENT 1; a hold 2; a counted failure up to 4 — the row and its subs_due, subs_x and
//             subs_fail entries — and a delete 2 more) ≤ 8 → R × S × 8; a probe's claim 1 more → R × 10; held rows freed
//             (RELEASE_HELD) ≤ R × S × 2
//           new subscriptions: 5 each (the KST day's first 8); a D1 day spans two KST budget days → 2 × N × 5 + 6
//           the deferral notes (stat 'fd' ≤ 3 — a catch-up's, the 'reserve' line, the 'cap' line — and 'fn' ≤ 2; the first
//             ever 2 more) ≤ 6
//           ended end dates dropped before the KST day's first finish (DROP_ENDED, 1 a row — 11th review: it was in the reads
//             only): each pending date once a KST day, and a D1 day holds two KST mornings → 2M
//           ONE COMPUTATION: the finish's marks ≤ 5 a subscription (PRUNE_XSENT 1 + MARK_WEEKLY 2 + MARK_EXPIRING 2 — every
//             mark of a full table changing every time; 11th review: subs_fail's WHERE named pend_w and pend_x, so a phone that
//             had failed once wrote 7 — it names fails only now, measured 5 for failed phones too) → 5M; the snap ≤ 2 ×
//             (PAIR_CAP + 500) = 7,000 (a pair digested again 1, its PROMOTE or ROLL_BU 1, a new pair 2, a pruned pair 2:
//             2(x + S) — DIGEST adds a pair only while snap holds fewer than PAIR_CAP rows, and a row a finish frees is free
//             only for the next computation); stat rows ≤ 20 (start ≤ 12 — measured 8 the first time ever, 5 after, 7 for a
//             retry with its notes —, key set 1, capped 2, finish 4, lease freed 1) → 5M + 7,020 (free 15,770, paid 82,020).
//             A digest chunk notify.mjs sends again after D1 committed it writes NOTHING (11th review: sql.js DIGEST leaves a
//             row that already holds these numbers — measured 0 rows for 12 chunks sent again at each ceiling), and a PUT
//             that resets a phone's marks cannot raise this ceiling (it already counts every phone marked again)
//           the one uncounted retry's dead first try: start 12 + key set 1 + digest ≤ 7,000 + capped 2 = 7,015
//         FREE (a day of 100,000): 24,640 + 770 + 6,160 + 5,006 + 6 + 3,500 + 3 × 15,770 + 7,015 = 94,407 (5.6% left).
//           Measured (11th review, 1,750 phones × 20 rules on the 3,000 computed pairs, every phone sent and marked again
//           between the computations, every expiring rule a new end date each time, the third the next KST morning; every
//           phone fails = 0 and again every phone fails = 1 — the same): 14,758 + 13,007 + 14,758 (≤ 15,770 each); all rules
//           expiring 11,258 + 9,507 + 11,258. Not counted: PUT/DELETE and a subscription sent again for the same endpoint
//           (≈ 1–4 rows each, bounded only by the Workers request limit and SUBS_RL), and cf/metrics (src/rules.js there: up
//           to 80,000 on a spammed day — the two together can still pass the day)
//         PAID (a month of 50,000,000): 123,200 + 770 + 30,800 + 15,006 + 6 + 30,000 + 12 × 82,020 + 7,015 = 1,191,037 a day;
//           + cf/metrics at its cap 80,000 = 1,271,037 × 31 days = 39,402,147 (78.8%; 10.6M left for PUT/DELETE and
//           same-endpoint subscriptions, which no cap bounds). Measured at the paid ceiling (15,000 phones × 20 rules, the
//           same adversarial days, fails = 0 and fails = 1 alike): 81,008 + 66,007 + 81,008 (≤ 82,020 each); all expiring
//           51,008 + 36,007 + 51,008
//   D1 READS (a per-statement walk measured on the same runtime; test/d1_reads.mjs, run by local_dev.sh, checks that no
//         finish statement reads more with long lists and the per-phone ceilings):
//           one computation, the worst shape (every rule an expiring one on a computed pair — MARK_WEEKLY's EXISTS walks every
//             rule, MARK_EXPIRING marks every phone —, exp_sent lists of 60 entries): free 298,700 (1,750 phones: watched
//             83,370 + digest 12,000 + finish ~203,300 + start ≤ 30; four kinds mixed 198,901), paid 2,312,750 (15,000:
//             watched 626,620 + digest 12,000 + finish ~1,674,100; mixed 1,457,651 — 1,711,145 for a first computation)
//           the dead try: watched + digest + start (free 95,400, paid 638,650); digest chunks sent again: 3,000 each (DIGEST
//             2,000 + DIGEST_HELD 1,000 — measured), 12 a computation → (K + 1) × 36,000
//           a start ≤ 30 (≤ 120 a day: 48 catch-ups, the factory runs that deployed — 26–42 a day were counted on
//             2026-10-13…16 — and retries); a subscribe 9; a PUT of 20 rules 65
//           a send run: 35 with nothing pending; the rows with news waiting that are NOT due — weekly waiting (sent within 7
//             days) and expiring waiting (one went out today) — 2M + 34 (free 3,534, paid 30,034; measured — a row that failed
//             before is one subs_fail entry, also with nothing pending: CLAIM_F read M + 3), + M while the KST day's first
//             finish has not run (DROP_ENDED); probes ≤ 1,383 (one index seek per push origin, at most PROBE_ORIGINS —
//             however many rows are held); a release ≤ 7 a freed row (measured 280–305 freeing 40: free 340, paid ≤ 1,400);
//             a push with an expiring notice ≤ 241 more in SENT (rules.js END_DAYS: ≤ 100 announced + ≤ 20 pending, merged and
//             sorted; measured 161, 201 and 241 a push with 60, 80 and 100 entries). Measured worst runs: free 13,459 (40
//             pushes), paid 79,639 (200 pushes, before the day's first finish)
//         FREE (a day of 5,000,000): 3 × 298,700 + 95,400 + 4 × 36,000 + 77 × (3,534 + 1,383 + 340) + 3,080 × 241 + 77 × 1,750
//           + 2 × 500 × 9 + 120 × 30 = 2,429,919 (51.4% left)
//         PAID (a month of 25,000,000,000): 12 × 2,312,750 + 638,650 + 13 × 36,000 + 77 × (30,034 + 1,383 + 1,400) + 15,400 ×
//           241 + 77 × 15,000 + 2 × 1,500 × 9 + 120 × 30 = 36,283,559 a day × 31 = 1,124,790,329 (4.5%)
//   THE BILL (paid, every cap hit every day of a 31-day month): writes 39.4M of 50M, reads 1.12B of 25B, storage ≤ ~0.1 GB
//         of 5 GB (15,000 rows of ≤ ~4 KB + 3,500 snap rows), Workers requests ≤ ~0.3M of 10M, CPU ≤ ~3M ms of 30M → $0 over
//         the $5. Outside every cap: PUT/DELETE and same-endpoint subscriptions (≤ 4 rows written + 65 read each): about
//         $4.30 per million such requests once the 10.6M rows left are gone — a Cloudflare budget alert (Manage Account →
//         Billing → Billable Usage → Set Budget Alert, informational, the day after) tells the owner. Raising a cap: one more
//         computation a day ≈ 82,020 × 31 = 2.54M rows a month (up to three more keep 5% of the 50M: 47.0M; past 50M $1 a
//         million)
// VAPID: only the secret VAPID_PRIVATE_JWK is needed — the public key is derived from it (push.js publicKeyOf). The
//   optional var VAPID_PUBLIC_KEY, when set, must be that same key (else nothing is sent, GET /health sending:false).
import { ID_RE, validDay, validRun, FINISH_SLACK_DAYS, daysBetween, newId, kstDay, kstHour, addDays, inWindow, pushTtl, dueKinds, outcome,
  hostTrouble, capacityOf, STALE_DAYS, REFUSING_DAYS, CAPPED_DAYS, validateRules, cleanEntry, validEnd, keySetJson, clientKey, RETRY_DROP, REFUSED_DROP,
  NEVER_DROP, FAIL_SLOTS, REFUSING_GRACE_DAYS, HOLD_MINUTES, SLOW_HOLD_MINUTES, PROBES, PROBE_SLOTS, PROBE_ORIGINS, PAIR_KEEP_DAYS } from "./rules.js";
import { checkSubscription, vapidJwt, vapidKey, pushRequest } from "./push.js";
import * as Q from "./sql.js";

// ---- the plan profile (10th review — a user decision of 2026-10-19: the app launches on Cloudflare Workers PAID; 11th: PLAN
// stays "free" in wrangler.jsonc until the account IS on Workers Paid — the launch switches the account, then a one-line PR
// sets "paid", then PUBLIC_DEPLOY goes on). wrangler.jsonc vars.PLAN = "paid" | "free" picks the limits below; each one can
// still be set on its own (vars SEND_LIMIT, MAX_SUBS, NEW_PER_DAY, COMPUTES_PER_DAY — a var beats the profile). PLAN missing
// or anything else = "free": the profile that fits either account. No wrangler "limits" block (a Free account would refuse
// it at deploy): every limit is kept here, in code. The arithmetic above holds for both profiles.
//   SEND_LIMIT        pushes per send run. Free: 40 of the 50 outside requests a Free invocation may make. Paid: 200 —
//                     10,000 subrequests (≤ 200 pushes + ≤ 3 × (34 + 2) D1 calls), 6 connections at a time (34 groups of
//                     6 × the 8 s push timeout = 4.5 min at worst, inside the 10-minute cron step and the 15-minute cron
//                     wall time; measured CPU per push in the arithmetic above), 77 runs × 200 = 15,400 a day ≥ MAX_SUBS
//   MAX_SUBS          subscriptions (nothing evicts: full = 503 FULL, GET /health "capacity")
//   NEW_PER_DAY       new subscriptions per KST day (one ≈ 5 rows written; a D1 day spans two KST days)
//   COMPUTES_PER_DAY  full computations (start → keys → watched → digest → finish) that may START in one D1 day (00:00–24:00
//                     UTC = 09:00–09:00 KST), counted in D1 (stat 'fc'); before 21:00 UTC (06:00 KST) one of them is kept
//                     for the day's 06:00 computation — from a catch-up until 23:00 UTC (08:00 KST, CATCHUP_ROLL_HOUR; 11th
//                     review) (RESERVE_FROM_UTC_HOUR). Past it: 'deferred' (start below). ≤ 99
// Free = the 9th review's values with MAX_SUBS 1,750 (11th review: D1 Free's 100,000 rows written a day for the whole
// account, with 5% left once a failed phone's rows and DROP_ENDED are counted). Paid = what keeps the WORST month (31 days,
// every cap hit every day, cf/metrics at its own cap) inside the 50 million rows written and 25 billion rows read a month the
// $5 plan includes with ≥ 5% left (arithmetic above): the bill stays $5.
export const PLANS = Object.freeze({
  free: Object.freeze({ SEND_LIMIT: 40, MAX_SUBS: 1750, NEW_PER_DAY: 500, COMPUTES_PER_DAY: 3 }),
  paid: Object.freeze({ SEND_LIMIT: 200, MAX_SUBS: 15000, NEW_PER_DAY: 1500, COMPUTES_PER_DAY: 12 }),
});
// a var may move a limit, never past what the platform itself allows: pushes per run ≤ 45 on Free (50 outside requests an
// invocation), ≤ 500 on Paid (84 groups × 8 s = 11 minutes at worst, inside the 15-minute cron wall time); computations ≤ 99
// (stat 'fc' keeps the count in two digits)
const SEND_MAX = { free: 45, paid: 500 };
export const planOf = (env) => (env && env.PLAN === "paid" ? "paid" : "free");
export function limits(env) {
  const plan = planOf(env), p = PLANS[plan];
  return {
    plan,
    SEND_LIMIT: Math.min(SEND_MAX[plan], Math.floor(num(env.SEND_LIMIT, p.SEND_LIMIT))),
    MAX_SUBS: Math.floor(num(env.MAX_SUBS, p.MAX_SUBS)),
    NEW_PER_DAY: Math.floor(num(env.NEW_PER_DAY, p.NEW_PER_DAY)),
    COMPUTES_PER_DAY: Math.min(99, Math.floor(num(env.COMPUTES_PER_DAY, p.COMPUTES_PER_DAY))),
  };
}
// the free profile's values under their old names (node tests and test/d1_reads.mjs run without PLAN, i.e. the free profile)
export const { SEND_LIMIT, MAX_SUBS, NEW_PER_DAY, COMPUTES_PER_DAY } = PLANS.free;
// before this UTC hour (21:00 UTC = 06:00 KST) a start may take only COMPUTES_PER_DAY − 1 computations of the D1 day: the
// last one is kept for the day's computation of the 06:00 KST factory run (or the 08:00 catch-up) — 9th-review finding: a
// day of data PRs used all three by the afternoon, and the next morning's collection and ending prices waited until 09:37.
// A catch-up may not take it before CATCHUP_ROLL_HOUR (08:00 KST = 23:00 UTC) either — 11th-review finding: the 06:07
// catch-up took it for the prices deferred the afternoon before, and the 06:00 collection then waited for 09:00
export const RESERVE_FROM_UTC_HOUR = 21;
// one computation at a time (stat 'lease'): a start while another one started less than this ago and did not finish is
// answered 'busy'. Longer than notify's step limit in both workflows (10 minutes), so a live run never loses it — and so
// no start is taken in the last LEASE_MS of a D1 day (23:45–24:00 UTC = 08:45–09:00 KST, start: 'deferred' why 'edge'):
// every write of a computation lands in the D1 day that counted it (9th-review finding: a start at 08:59:30 KST wrote its
// rows into the next D1 day, which then took three more — four in one D1 day)
export const LEASE_MS = 15 * 60e3;
// KST hour before which unchanged prices are not computed again just because the day changed (start: 'done' with a finish
// of an earlier day): the day's computation is the 06:00 factory run's (no push goes out before 08:00), so a night of
// catch-up runs (every 30 minutes) costs no computation. Changed prices are computed at any hour
export const NIGHT_END_HOUR = 6;
// the same for a catch-up run (start {catchup: true}, alerts-catchup.yml) until 08:00 KST: the catch-ups between 06:00 and
// 08:00 may come while the 06:00 factory run is still collecting (GitHub starts it 20–25 minutes late and a collection takes
// ~40–45 minutes — 'Weekly prices 2026-10-17' was saved at 07:06 KST; the job may take up to 90), so they compute changed
// prices only and leave the day's computation to that run — computing yesterday's prices again there would spend one of
// COMPUTES_PER_DAY right before the new collection needs it — and, until then, never the D1 day's last computation (the
// 06:00 share, RESERVE_FROM_UTC_HOUR — 11th review). From 08:00 (the first push goes out at 08:00 anyway) a catch-up
// computes the day if no run did (the 06:00 run failed, or built nothing and its alerts job did not finish)
export const CATCHUP_ROLL_HOUR = 8;
// (key, region) pairs the factory digests per run, and the most rows snap holds (+ one digest chunk) — its D1 writes are
// ≤ 2 × (PAIR_CAP + 500) rows per full computation, ≤ COMPUTES_PER_DAY a D1 day (arithmetic above). A user decision;
// wrangler.jsonc vars.PAIR_CAP. Only
// pairs of keys in the factory's key set count (a key the data.json does not have never takes a place). Past it the list
// is cut (sql.js WATCHED: pairs of phones that took a push, then pairs computed this week, then pairs not computed yet,
// then the rest) or a new pair waits for a free row, and GET /health says "pairs": "capped" (the monitor warns)
export const PAIR_CAP = 3000;
const PARALLEL = 6;                    // the runtime runs at most 6 outside fetches at once anyway
// what a fetch throws past the invocation's subrequest limit (Cloudflare docs: "Error: Too many subrequests.")
const SUBREQUEST_LIMIT_RE = /too many subrequests/i;
const PUBLIC_MAX = 8 * 1024, INTERNAL_MAX = 256 * 1024;
// a watched page holds the whole list (PAGE ≥ PAIR_CAP): every page groups subs × rules again (sql.js WATCHED), so one page
// per factory run reads the table once — 6th review: two pages of 2,000 read it twice (≈ 435,000 rows each at the ceiling)
const PAGE = 5000, DIGEST_MAX = 500;
// the data's fingerprint (notify.mjs fingerprint: a sha256, lower-case hex) and its tag in stat 'data': the first 52 bits
// as a number (exact in JS and SQLite)
const SHA_RE = /^[0-9a-f]{64}$/;
const dataTag = (sha) => parseInt(sha.slice(0, 13), 16);
// the UTC day (D1's day, the one its free-plan limits count) as yyyymmdd
const utcDayNum = (ms) => Number(new Date(ms).toISOString().slice(0, 10).replace(/-/g, ""));
// waits (ms) before the 2nd and 3rd try of a results batch (D1 retries no write by itself: "Network connection lost",
// "overloaded", "DB reset … retry" are answers a write can get)
const RESULT_WAITS = [100, 400];
// a stat day number (yyyymmdd) → 'YYYY-MM-DD', or null
const dayOfNum = (n) => { const s = n ? String(n) : ""; const d = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : ""; return validDay(d) ? d : null; };
const dayNum = (day) => Number(day.replace(/-/g, ""));

const json = (data, status = 200, extra = {}) =>
  new Response(data === null ? null : JSON.stringify(data), { status, headers: { ...(data === null ? {} : { "content-type": "application/json; charset=utf-8" }), ...extra } });

// constant-time comparison (cf/factory/src/runs.js sameSecret); empty never matches
export function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// a refused request: status and error code
class Bad extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

// the body, at most max bytes, read as a stream with a running count (a body without Content-Length cannot make the
// Worker buffer more than max): too big → 413 (stream cancelled), the client going away mid-body → 400
async function readCapped(request, max) {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(/^\d+$/.test(declared) && Number(declared) <= max)) throw new Bad(413, "TOO_LARGE");
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    let step;
    try { step = await reader.read(); } catch { throw new Bad(400, "BAD_JSON"); }
    if (step.done) break;
    total += step.value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw new Bad(413, "TOO_LARGE"); }
    chunks.push(step.value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

// JSON body with a size cap. application/json or text/plain (so the app may send a simple request); the Origin check is
// separate.
async function readJson(request, max) {
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type && type !== "application/json" && type !== "text/plain") throw new Bad(400, "BAD_JSON");
  const buf = await readCapped(request, max);
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { throw new Bad(400, "BAD_JSON"); }
}

function allowedOrigins(env) {
  return [env.ALLOWED_ORIGIN, ...String(env.DEV_ORIGINS || "").split(",")].map((s) => (s || "").trim()).filter(Boolean);
}
// browsers send Origin on cross-site calls: only the app's own origin gets CORS; a foreign Origin is refused.
// (Not a security boundary — the 128-bit id, the host allow-list, size caps and the rate limits are.)
function cors(request, env) {
  const o = request.headers.get("origin");
  if (!o) return { ok: true, headers: {} };
  if (!allowedOrigins(env).includes(o)) return { ok: false, headers: { vary: "Origin" } };
  return { ok: true, headers: { "access-control-allow-origin": o, vary: "Origin" } };
}

const bearer = (request) => { const h = request.headers.get("authorization") || ""; return h.startsWith("Bearer ") ? h.slice(7) : ""; };
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

async function subscribe(request, env, now) {
  const body = await readJson(request, PUBLIC_MAX);
  const sub = checkSubscription(body && body.subscription);
  if (sub.error) throw new Bad(400, sub.error);
  const v = validateRules(body.rules);
  // an empty subscription would never send and sit in D1 for ever
  if (v.error || !v.rules.length) throw new Bad(400, "BAD_RULES");
  // Per-client rate limit (after validation, so junk requests do not use it up). The key is the connecting IP
  // (cf-connecting-ip): IPv4 as is, IPv6 cut to its /64 (rules.js clientKey — one client usually holds a whole /64). It
  // goes ONLY to the Rate Limiting binding, whose counter lives in Cloudflare's memory at that location for the 60-second
  // period: it is never written to D1, never logged, never returned. Missing binding (node tests, a local run without
  // it) → no check.
  if (env.SUBS_RL) {
    const key = clientKey(request.headers.get("cf-connecting-ip"));
    if (!(await env.SUBS_RL.limit({ key })).success) throw new Bad(429, "RATE_LIMITED");
  }
  const L = limits(env), today = kstDay(now), max = L.MAX_SUBS, perDay = L.NEW_PER_DAY;
  const rules = JSON.stringify(v.rules);
  // one batch: the Worker's own KST day first (the subs_ins trigger names today's 'new:' counter from it), then the INSERT
  const res = await env.DB.batch([
    env.DB.prepare(Q.SET_DAY).bind(Number(today.replace(/-/g, ""))),
    env.DB.prepare(Q.SUBSCRIBE).bind(newId(), sub.endpoint, rules, today, max, perDay),
  ]);
  const row = res[1] && res[1].results && res[1].results[0];
  if (!row) {
    // today's new-subscription budget used up: 429 (so a flood does not read as "full"); else the table is full: 503 FULL.
    // Nothing is evicted — GET /health "capacity" tells the operator (the monitor warns), who purges or raises MAX_SUBS.
    const c = await env.DB.prepare(Q.SUBS_COUNTS).bind(today).first();
    if (!c || c.today >= perDay) throw new Bad(429, "RATE_LIMITED");
    throw new Bad(503, "FULL");
  }
  return { status: 201, body: { id: row.id } };
}

async function putRules(request, env, id) {
  if (!ID_RE.test(id)) throw new Bad(404, "NOT_FOUND");
  const body = await readJson(request, PUBLIC_MAX);
  const v = validateRules(body && body.rules);
  if (v.error) throw new Bad(400, v.error);
  // no rules left = the phone switched every alert off: the row is deleted (unknown id → 404 as for any other PUT)
  if (!v.rules.length) {
    if (!(await env.DB.prepare(Q.DELETE_SUB_RETURNING).bind(id).first())) throw new Bad(404, "NOT_FOUND");
    return { status: 200, body: { ok: true } };
  }
  if (!(await env.DB.prepare(Q.PUT_RULES).bind(id, JSON.stringify(v.rules)).first())) throw new Bad(404, "NOT_FOUND");
  return { status: 200, body: { ok: true } };
}

async function unsubscribe(env, id) {
  if (ID_RE.test(id)) await env.DB.prepare(Q.DELETE_SUB).bind(id).run();
  return { status: 204, body: null };
}

// ---- factory side (Bearer ALERTS_SECRET; never CORS)
// POST /v1/internal/keys {keys} → {keys: <how many>, changed}. The compare keys of the data.json the app was just given,
// each once in ascending order (rules.js keySetJson; else 400 BAD_KEYS). Stored as ONE row, rewritten only when it differs
// (sql.js SET_KEYS: ≤ 1 row written). notify.mjs sends it right after a start answered 'compute', before the first watched
// page: WATCHED then ranks only pairs of these keys (a rule naming any other key is stored all the same and waits).
async function storeKeys(request, env) {
  const body = await readJson(request, INTERNAL_MAX);
  const set = keySetJson(body && body.keys);
  if (!set) throw new Bad(400, "BAD_KEYS");
  const res = await env.DB.prepare(Q.SET_KEYS).bind(set).run();
  return { keys: body.keys.length, changed: ((res && res.meta && res.meta.changes) || 0) > 0 };
}

// POST /v1/internal/start {fp, nonce?, catchup?: true} → {go: "done" | "busy"} | {go: "deferred", why, until, first} |
// {go: "compute", lease}. The first call of every factory run that deployed data and of every alerts-catchup run (catchup:
// true) — 9th review: alerts within 2 hours of new prices, a user decision of 2026-10-16. fp = the data's fingerprint
// (notify.mjs fingerprint: the numbers a digest can be computed from, not the file's bytes or timestamps); nonce = 13
// lower-case hex characters (52 random bits, kept whole in stat 'ln' — exact in JS and SQLite) notify.mjs draws once per run
// (10th review: a start whose answer was lost and that notify sends again gets the SAME answer — the same lease, counted
// once). In this order (sql.js START_STATE: ≤ 30 rows read — measured 5 for done, 7 busy, 5–12 deferred, ≤ 28 before a
// compute — 0 written):
//   done      the last finish was from these same prices, today (KST) — or, any day, before NIGHT_END_HOUR (a catch-up:
//             CATCHUP_ROLL_HOUR): a code-only rebuild, a re-run, a catch-up with nothing new costs nothing
//   compute   (again) this run's own computation holds the lease (the same nonce): its first answer was lost — also when
//             that first try's batch committed only after this try read the state (TAKE_LEASE then finds the run's own
//             lease: sql.js LEASE_MINE, 11th review — it answered 'busy' to itself)
//   busy      another computation started less than LEASE_MS ago and did not finish (one at a time: two at once could prune
//             each other's pairs — sql.js PRUNE_SNAP)
//   deferred  why 'edge': the last LEASE_MS of the D1 day (23:45–24:00 UTC = 08:45–09:00 KST) — no computation starts there,
//             so all of its writes land in the D1 day that counted it; the next catch-up (after 09:00 KST) computes.
//             why 'cap': COMPUTES_PER_DAY computations already started this D1 day (until 09:00 KST); why 'reserve':
//             COMPUTES_PER_DAY − 1 started and it is before 21:00 UTC (06:00 KST) — for a catch-up, before 08:00 KST (23:00
//             UTC, CATCHUP_ROLL_HOUR; 11th review) — the last one is kept for the 06:00 KST factory run (until 06:00 KST; a
//             catch-up: 08:00, when it may take it if no run did). Both note the D1 day (stat 'fd': GET /health "compute":
//             "deferred") and say first: true to the first factory run deferred that D1 day, once more to the first one
//             deferred 'cap' after a 'reserve' line, and again to the start of that same run sent again (stat 'fn' = its
//             nonce — 11th review: a lost answer lost the D1 day's line) — its workflow sends ONE Telegram line a D1 day
//             (two when 'reserve' became 'cap'; 9th-review finding: 30 lines in four days). ≤ 2 rows written (fd, fn)
//   compute   the lease is taken (stat 'lease' = now, 'ln' = the nonce, 'lf' = the fingerprint's tag) and the computation
//             counted (stat 'fc') — except a RETRY: the same prices again after a computation of them that started this D1
//             day and died (its lease ran out without a finish) is not counted, once a D1 day (stat 'fr'; 9th-review finding:
//             a failed computation silently burned one of the day's three). A lease found run out is a failed computation:
//             stat 'cfail' = the D1 day (GET /health "compute": "failed", the monitor warns). ≤ 12 rows written. The factory
//             goes on with keys, watched, digest and finish {…, lease} (which frees it)
// So a D1 day takes at most COMPUTES_PER_DAY counted computations + one uncounted retry whose first try died before its
// finish (the write arithmetic above counts both). keys, watched, digest and finish do not check the lease: the cap keeps
// the D1 budget against our own runs, which all ask start first (notify.mjs is the only caller — tests check its order),
// not against someone holding ALERTS_SECRET, who could write rows with digest anyway (docs/SECURITY_ARCHITECTURE.md §4:
// rotate the secret)
const NONCE_RE = /^[0-9a-f]{13}$/;
const DAY_MS = 86400e3;
// GET /health "compute" looks back this many UTC days (like REFUSING_DAYS / CAPPED_DAYS: the daily monitor sees the day before)
const COMPUTE_DAYS = 1;
async function start(request, env, now) {
  const body = await readJson(request, INTERNAL_MAX);
  if (!body || typeof body.fp !== "string" || !SHA_RE.test(body.fp) || (body.catchup !== undefined && body.catchup !== true) ||
    (body.nonce !== undefined && !(typeof body.nonce === "string" && NONCE_RE.test(body.nonce)))) throw new Bad(400, "BAD_START");
  const k = limits(env).COMPUTES_PER_DAY, today = dayNum(kstDay(now)), utc = utcDayNum(now), tag = dataTag(body.fp);
  const nonce = body.nonce ? parseInt(body.nonce, 16) : null, dayStart = now - (now % DAY_MS);
  const s = (await env.DB.prepare(Q.START_STATE).bind(today, tag, now, LEASE_MS, utc, nonce, dayStart).first()) || {};
  if (s.same && (s.today || kstHour(now) < (body.catchup ? CATCHUP_ROLL_HOUR : NIGHT_END_HOUR))) return { go: "done" };
  if (s.mine) return { go: "compute", lease: s.lease };
  if (s.busy) return { go: "busy" };
  if (now - dayStart >= DAY_MS - LEASE_MS) return { go: "deferred", why: "edge", until: "09:00", first: false };
  const retry = s.retry ? 1 : 0;
  // the D1 day's last computation is the 06:00 KST factory run's: nobody takes it before 21:00 UTC (06:00 KST), and a
  // catch-up not before CATCHUP_ROLL_HOUR (08:00 KST = 23:00 UTC) either — 11th review: the 06:07 catch-up took it for the
  // prices deferred the afternoon before, and the 06:00 collection then waited for 09:00 (cap) without a Telegram line
  const reserved = new Date(now).getUTCHours() < RESERVE_FROM_UTC_HOUR || (body.catchup === true && kstHour(now) < CATCHUP_ROLL_HOUR);
  const cap = reserved ? k - 1 : k;
  if (!retry && s.computes >= cap) {
    const why = s.computes >= k ? "cap" : "reserve";
    // until: when these prices can be computed — 09:00 KST (a new D1 day) for 'cap'; for 'reserve' the 06:00 factory run
    // (06:00 KST) computes main's prices, which hold these, and a catch-up waits for 08:00
    const until = why === "cap" ? "09:00" : body.catchup ? "08:00" : "06:00";
    // one Telegram line a D1 day (first: true to the first factory run deferred in it), one more when 'reserve' became
    // 'cap', and the same first: true again to the run that was told when its start comes again (its answer was lost)
    const level = body.catchup ? 0 : why === "cap" ? 2 : 1;
    const first = level > 0 && (s.told < level || !!s.toldme);
    await env.DB.batch([
      env.DB.prepare(Q.STAT_DEFERRED).bind(utc, level),
      ...(first && nonce !== null ? [env.DB.prepare(Q.STAT_TOLD).bind(nonce)] : []),
    ]);
    if (why === "cap") console.log("alerts start: deferred — COMPUTES_PER_DAY computations started this D1 day");
    else console.log("alerts start: deferred — the D1 day's last computation is kept for the 06:00 KST run");
    return { go: "deferred", why, until, first };
  }
  const res = await env.DB.batch([
    env.DB.prepare(Q.TAKE_LEASE).bind(now, LEASE_MS, utc, cap, retry),
    env.DB.prepare(Q.LEASE_OF).bind(now, nonce === null ? -1 : nonce, tag),
    retry ? env.DB.prepare(Q.MARK_RETRY).bind(now, utc) : env.DB.prepare(Q.COUNT_COMPUTE).bind(now, utc),
    ...(s.stale ? [env.DB.prepare(Q.STAT_CFAIL).bind(now, utc)] : []),
    ...(nonce !== null ? [env.DB.prepare(Q.LEASE_MINE).bind(now, LEASE_MS, nonce)] : []),
  ]);
  const took = res[0];
  if (!(took && took.results && took.results.length)) {
    // another run started in between — or this run's own first try, whose batch committed after this try read the state
    // (its answer was lost): that lease is this run's (11th review — it answered 'busy' to itself)
    const mine = nonce !== null && res[res.length - 1] && res[res.length - 1].results && res[res.length - 1].results[0];
    if (mine && Number.isSafeInteger(mine.lease)) return { go: "compute", lease: mine.lease };
    return { go: "busy" };
  }
  if (s.stale) console.log("alerts start: a computation that started before did not finish (its lease ran out)");
  return { go: "compute", lease: now };
}

// GET /v1/internal/watched?at=<offset> → {pairs, next: <offset> | null, capped?: true}. At most PAIR_CAP pairs in all, only
// pairs whose key is in the stored key set (storeKeys above), most important first (sql.js WATCHED; a pair keeps its place
// PAIR_KEEP_DAYS after it was first computed, by the Worker's clock); a list cut at the cap answers capped: true on its
// last page and stamps stat 'capped' (GET /health "pairs"). With digest's room check this keeps the factory's D1 writes
// bounded however many pairs the subscriptions name. One page holds PAGE pairs (≥ PAIR_CAP), so a factory run groups the
// table once. (Whether to compute at all is start's answer above.)
async function watched(env, url, now) {
  const cap = num(env.PAIR_CAP, PAIR_CAP);
  const raw = url.searchParams.get("at") || "0";
  const at = /^\d{1,9}$/.test(raw) ? Number(raw) : -1;
  if (at < 0 || at > cap) throw new Bad(400, "BAD_PAGE");
  const want = Math.min(PAGE, cap - at);
  const { results } = await env.DB.prepare(Q.WATCHED).bind(want + 1, at, addDays(kstDay(now), -PAIR_KEEP_DAYS)).all();
  const rows = results || [];
  const pairs = rows.slice(0, want).map((x) => ({ k: x.k, r: x.r }));
  const more = rows.length > want, end = at + pairs.length;
  if (more && end >= cap) {
    await env.DB.prepare(Q.STAT_CAPPED).bind(dayNum(kstDay(now))).run();
    console.log("alerts watched: the list was cut at PAIR_CAP");
    return { pairs, next: null, capped: true };
  }
  return { pairs, next: more ? end : null };
}

// POST /v1/internal/digest {run, entries} → {saved, skipped}. A pair not in snap yet is added only while snap holds fewer than
// PAIR_CAP rows (sql.js DIGEST), with today (the Worker's clock) as its first day; one left out (skipped) waits for a row a
// finish frees, and stamps stat 'capped' (GET /health "pairs": "capped") — the list is at its cap.
// An expiring end date u must lie within the Worker's own day − FINISH_SLACK_DAYS … + END_DAYS (= 3, rules.js validEnd; the
// factory sends u ≤ its day + 3 and its day is never ahead of the Worker's): a later one would outlive sql.js PRUNE_XSENT's
// look-ahead, and none can pile up in exp_sent (a push reads ≤ 201 rows in SENT whatever the factory sends, ≤ 241 for a phone
// that changed its rules — rules.js END_DAYS, 8th/9th review).
// Else 400 BAD_DIGEST and nothing is written.
async function digest(request, env, now) {
  const body = await readJson(request, INTERNAL_MAX);
  if (!body || !validRun(body.run) || !Array.isArray(body.entries) || body.entries.length > DIGEST_MAX) throw new Bad(400, "BAD_DIGEST");
  const entries = body.entries.map(cleanEntry), today = kstDay(now);
  if (entries.some((e) => !e || (e.u != null && !validEnd(e.u, today)))) throw new Bad(400, "BAD_DIGEST");
  if (!entries.length) return { saved: 0, skipped: 0 };
  const list = JSON.stringify(entries);
  const res = await env.DB.prepare(Q.DIGEST).bind(body.run, list, num(env.PAIR_CAP, PAIR_CAP), today).run();
  let saved = Math.min(entries.length, (res && res.meta && res.meta.changes) || 0);
  // fewer rows changed than entries: a pair left out for room — or one that already held exactly these numbers (a chunk sent
  // again: sql.js DIGEST writes nothing for it). Count what snap holds now (≤ DIGEST_MAX primary-key lookups, 0 written)
  if (saved < entries.length) {
    const held = await env.DB.prepare(Q.DIGEST_HELD).bind(list).first();
    if (held && Number.isSafeInteger(held.n)) saved = Math.min(entries.length, held.n);
  }
  const skipped = entries.length - saved;
  if (skipped) {
    await env.DB.prepare(Q.STAT_CAPPED).bind(dayNum(today)).run();
    console.log("alerts digest: new pairs wait for room under PAIR_CAP");
  }
  return { saved, skipped };
}

// POST /v1/internal/finish {run, today, fp?, lease?} → {weekly, expiring, cleared, changed}. One atomic batch: mark the
// phones (expiring = phones given an expiring notice to send, cleared = stale expiring marks removed — sql.js MARK_EXPIRING),
// THEN promote the pending numbers to the baseline (a failure promotes nothing), note the day and the data (fp = its
// fingerprint; stat 'finish' + 'data': start answers done to the same prices the same day) and free the start's lease.
// Every date here comes from the Worker's own clock (today = kstDay(now)): the body's `today` and the run's day part only
// have to agree with it (calendar dates within FINISH_SLACK_DAYS, else 400 BAD_FINISH and nothing is touched), so the
// factory token can neither wipe past days' budgets with a far-future day nor pin /health "finished". The day noted as
// 'finished' (stat 'finish': start's done, the send runs' DROP_ENDED gate, /health) is the EARLIER of the body's today and
// the Worker's: the day the entries were computed for (10th review — a computation that started at 23:59 KST and finished
// after midnight noted the next day as computed, so that day's own computation and its ending prices never came; never
// later than the Worker's day, so it cannot pin /health "finished" ahead).
async function finish(request, env, now) {
  const body = await readJson(request, INTERNAL_MAX);
  const today = kstDay(now);
  if (!body || !validRun(body.run) || !validDay(body.today) || (body.fp != null && !SHA_RE.test(body.fp)) ||
    (body.lease != null && !(Number.isSafeInteger(body.lease) && body.lease > 0))) throw new Bad(400, "BAD_FINISH");
  if (Math.abs(daysBetween(body.today, today)) > FINISH_SLACK_DAYS || body.run.split("|")[1] !== body.today) throw new Bad(400, "BAD_FINISH");
  const res = await env.DB.batch([
    env.DB.prepare(Q.PRUNE_XSENT).bind(today),
    env.DB.prepare(Q.MARK_WEEKLY),
    env.DB.prepare(Q.MARK_EXPIRING).bind(body.run),
    env.DB.prepare(Q.PROMOTE),
    env.DB.prepare(Q.PRUNE_SNAP).bind(body.run),
    env.DB.prepare(Q.PRUNE_STAT).bind(today),
    env.DB.prepare(Q.ROLL_BU),
    env.DB.prepare(Q.STAT_FINISH).bind(Math.min(dayNum(body.today), dayNum(today))),
    body.fp ? env.DB.prepare(Q.STAT_DATA).bind(dataTag(body.fp)) : env.DB.prepare(Q.CLEAR_DATA),
    ...(body.lease != null ? [env.DB.prepare(Q.FREE_LEASE).bind(body.lease)] : []),
  ]);
  const ch = (i) => (res[i] && res[i].meta && res[i].meta.changes) || 0;
  const x = (res[2] && res[2].results) || [];
  const marked = x.filter((r) => r.marked).length;
  const out = { weekly: ch(1), expiring: marked, cleared: x.length - marked, changed: ch(3) };
  console.log("alerts finish", JSON.stringify(out));
  return out;
}

// ---- one send run (cron, or POST /v1/internal/send). Counts only in logs — never ids or endpoints.
// nowMs = when the run starts: the REAL time (scheduled() passes the later of scheduledTime and Date.now(), so a cron run
// that starts late is judged by the clock, not by its schedule). clock() = the time right now, read before every push: by
// default nowMs plus the real time elapsed since the call (Date.now() advances with every I/O in a Worker); tests pass
// their own clock.
export async function send(env, nowMs = Date.now(), { fetch: f = fetch, clock, waits = RESULT_WAITS } = {}) {
  const started = Date.now();
  const now = clock || (() => nowMs + (Date.now() - started));
  const out = { sent: 0, gone: 0, retry: 0, refused: 0, stopped: 0, held: 0 };
  if (!inWindow(nowMs)) { console.log("alerts send: outside 08:00-20:45 KST"); return { ...out, skipped: "window" }; }
  // the key, checked BEFORE any row is claimed (push.js vapidKey): the public key comes from the secret VAPID_PRIVATE_JWK
  // itself (VAPID_PUBLIC_KEY, when set, must be that same key) and one test signature must verify with it. A secret that
  // is missing, broken or cannot sign locks no row and costs no push.
  const v = await vapidKey(env, nowMs);
  if (!v.key) {
    if (v.why === "missing") console.log("alerts send: VAPID_PRIVATE_JWK not set");
    else if (v.why === "mismatch") console.error("alerts send: VAPID_PUBLIC_KEY is set and is not the public key of VAPID_PRIVATE_JWK");
    else console.error("alerts send: VAPID_PRIVATE_JWK is not a P-256 private key that signs");
    return { ...out, skipped: "keys" };
  }
  const pub = v.key, priv = env.VAPID_PRIVATE_JWK;
  const today = kstDay(nowMs), todayN = dayNum(today), minute = Math.floor(nowMs / 60e3), nowS = Math.floor(nowMs / 1000);
  const limit = limits(env).SEND_LIMIT, weekAgo = addDays(today, -7);
  // the key's tag (a new key never uses an old token, nor an old key's per-origin records)
  const tag = pub.slice(0, 12);
  // the probes (held rows whose minute has come, a few per push origin: sql.js CLAIM_P) first, then the queue in what is left
  const [, , cache, origins, cp, cx, cw, cf] = await env.DB.batch([
    env.DB.prepare(Q.RESET_STALE).bind(minute),
    env.DB.prepare(Q.DROP_ENDED).bind(today, todayN),
    env.DB.prepare(Q.VAPID_CACHE),
    env.DB.prepare(Q.ORIGIN_STATS).bind(`${tag} `),
    env.DB.prepare(Q.CLAIM_P).bind(minute, PROBES, Math.min(PROBE_SLOTS, limit), PROBE_ORIGINS),
    env.DB.prepare(Q.CLAIM_X).bind(minute, weekAgo, today, limit),
    env.DB.prepare(Q.CLAIM_W).bind(minute, weekAgo, today, limit),
    env.DB.prepare(Q.CLAIM_F).bind(minute, weekAgo, today, limit, FAIL_SLOTS),
  ]);
  // RETURNING gives rows in table order, not in the ORDER BY of the claim: sort again (the probes, then the nearest deadline,
  // then the weekly queue longest wait first, then the few rows that failed before: fewest failures first)
  const by = (...f) => (a, b) => { for (const g of f) { const x = g(a), y = g(b); if (x !== y) return x < y ? -1 : 1; } return 0; };
  const probes = cp.results || [];
  const subs = [...probes,
    ...(cx.results || []).sort(by((r) => r.pend_x)),
    ...(cw.results || []).sort(by((r) => r.last_w || "")),
    ...(cf.results || []).sort(by((r) => r.fails, (r) => r.last_w || ""))];
  if (!subs.length) return out;
  if (probes.length) out.probes = probes.length;

  // per push origin (sql.js ORIGIN_STATS): okEver = it answered 2xx to a push of ours under some key; for THIS key: okSince
  // = the first day this key went through there; stretchFrom / stretchLast = the first / last day of the current stretch of
  // refusals that may be our own setup's fault
  const okSince = new Map(), okEver = new Set(), stretchFrom = new Map(), stretchLast = new Map();
  for (const o of origins.results || []) {
    const kind = o.k.slice(0, 3), origin = o.k.slice(3 + tag.length + 1), d = dayOfNum(o.n);
    if (kind === "ok:") okEver.add(origin);
    if (d && o.k.slice(3, 3 + tag.length) === tag) (kind === "ok:" ? okSince : kind === "rs:" ? stretchFrom : stretchLast).set(origin, d);
  }
  const took = (s) => !!(s.last_w || s.last_x);
  // one JWT per push origin, cached in D1 (keyed with the public key, so a new key never uses an old token)
  const jwts = new Map(), fresh = [];
  for (const c of cache.results || []) if (c.aud.startsWith(tag + " ") && c.exp - nowS > 3600) jwts.set(c.aud.slice(tag.length + 1), c.jwt);
  const stmts = [], slowHosts = new Set(), refused = [], trouble = [], okOrigins = new Set();
  // queued: rows whose result statement is in stmts (or already written); waiting: rows decided after the loop (refused,
  // push-service trouble). Every claimed row ends this run with a statement (the finally below).
  const queued = new Set(), waiting = new Set();
  let closed = false, stalled = false, limited = false;
  const release = (s) => env.DB.prepare(Q.RELEASE).bind(s.id, minute);
  // held back (rules.js HOLD): out of the queue — back as a probe from that minute on, or when its push origin answers 2xx
  const hold = (s, minutes) => env.DB.prepare(Q.HOLD).bind(s.id, minute, minute + minutes);
  const q = (s, ...st) => { queued.add(s.id); stmts.push(...st); };
  const result = (s, what, due) => {
    if (what === "sent") { out.sent++; q(s, env.DB.prepare(Q.SENT).bind(s.id, due.weekly ? 1 : 0, due.expiring ? 1 : 0, today, s.pend_x ?? null, s.pend_xl ?? null, minute)); }
    else if (what === "gone") { out.gone++; q(s, env.DB.prepare(Q.GONE).bind(s.id)); }
    else if (what === "retry") { out.retry++; q(s, env.DB.prepare(Q.RETRY).bind(s.id, minute), env.DB.prepare(Q.DROP_FAILING).bind(s.id, RETRY_DROP, NEVER_DROP)); }
    else if (what === "slowed") { out.stopped++; q(s, hold(s, SLOW_HOLD_MINUTES)); }   // that push service said 429
    else { out.stopped++; q(s, release(s)); }
  };
  // Results are written AS THE RUN GOES: after every parallel group, what it decided (sent, gone, counted failures, stopped
  // rows, new JWTs) goes to D1 in one batch, tried up to 3 times (RESULT_WAITS). A run cut short loses at most one group's
  // records, and a batch that committed but whose answer was lost is harmless to write again (sql.js SENT/RETRY/RELEASE/HOLD
  // only touch a row that still holds THIS run's claim). If D1 still refuses, the run sends nothing more (stalled) and the batch
  // is tried once more at the end with everything else. Left: when that last try fails too (D1 down for the whole run) or
  // the Worker is stopped mid-group, the pushes of that group are unrecorded — their rows stay claimed, the run after next
  // frees them (RESET_STALE, 15 minutes) and those phones get the same push again about 20 minutes later.
  const write = async (list) => {
    for (let i = 0; ; i++) {
      try { return await env.DB.batch(list); }
      catch (e) { if (i >= waits.length) throw e; await new Promise((ok) => setTimeout(ok, waits[i])); }
    }
  };
  let unwritten = [];
  const flush = async () => {
    const list = [...unwritten, ...fresh.splice(0), ...stmts.splice(0)];
    unwritten = [];
    if (!list.length) return;
    try { await write(list); }
    catch {
      unwritten = list;
      if (!stalled) { stalled = true; out.stalled = true; console.error("alerts send: D1 did not take the results batch — no more pushes in this run"); }
    }
  };
  async function one(s) {
    let due = { weekly: false, expiring: false };
    try {
      due = dueKinds(s, today);
      if (!due.weekly && !due.expiring) return result(s, "stopped", due);       // claimed but nothing due after all
      let origin;
      try { origin = new URL(s.endpoint).origin; } catch { return result(s, "gone", due); }
      if (closed || stalled || limited) return result(s, "stopped", due);
      if (slowHosts.has(origin)) return result(s, "slowed", due);
      if (!jwts.has(origin))   // a promise, so parallel pushes to one origin sign once
        jwts.set(origin, vapidJwt(origin, priv, env.VAPID_SUBJECT || env.ALLOWED_ORIGIN, nowMs).then((t) => {
          fresh.push(env.DB.prepare(Q.SAVE_JWT).bind(`${tag} ${origin}`, t.jwt, t.exp));
          return t.jwt;
        }));
      const jwt = await jwts.get(origin);
      // the window is checked again right before this push, and the TTL is computed from this moment: a run that is
      // still going at 20:45 stops, and no push can arrive after 21:00
      const t = now();
      if (closed || !inWindow(t)) { if (!closed) { closed = true; out.closed = true; } return result(s, "stopped", due); }
      if (stalled || limited) return result(s, "stopped", due);                 // decided while this one signed
      if (slowHosts.has(origin)) return result(s, "slowed", due);
      const req = pushRequest(s.endpoint, jwt, pub, pushTtl(t));
      let status = 0;
      try { status = (await f(req.url, { ...req.init, signal: AbortSignal.timeout(8000) })).status; }
      catch (e) {
        // the runtime's own limit, not the push service (11th review): "Too many subrequests." — a Free account running the
        // paid profile (PLAN "paid": 200 pushes a run, Free allows 50 outside requests). Like a stall: this row and the
        // rest of the run are released unchanged (no failure counted — status 0 would count one against every phone past
        // the 50th, run after run), and the run's log says so
        if (SUBREQUEST_LIMIT_RE.test(String((e && e.message) || ""))) {
          if (!limited) { limited = true; out.limited = true; console.error("alerts send: the runtime refused more outside requests (subrequest limit) — no more pushes in this run; a Free account needs PLAN \"free\""); }
          return result(s, "stopped", due);
        }
        status = 0;
      }
      const what = outcome(status);
      if (what === "sent" && !okOrigins.has(origin)) {
        // this origin's first 2xx in the run: the day this key went through there (kept if older) and the end of any refusal
        // stretch go into the SAME results batch as this SENT, so a recorded push never lacks them (sql.js STAT_OK_SINCE).
        // Its held rows are freed in the run's closing batch (below: sql.js RELEASE_HELD, a few a run)
        okOrigins.add(origin);
        stmts.push(env.DB.prepare(Q.STAT_OK_SINCE).bind(`${tag} ${origin}`, todayN), env.DB.prepare(Q.CLEAR_RS).bind(`${tag} ${origin}`));
      }
      if (what === "slow") { slowHosts.add(origin); return result(s, "slowed", due); }
      // 401/403 and push-service trouble (5xx, redirect, timeout) are decided after the run (below), once every push of the
      // run has answered: whether that push service took another push 2xx in this run is part of the decision. A refusal
      // never stops the run for that service — a 2xx later in the same run (a phone that subscribed with the current key)
      // is what tells an old subscription's refusal from a broken setup.
      if (what === "refused") { waiting.add(s.id); refused.push({ s, origin }); return; }
      if (what === "retry" && hostTrouble(status)) { waiting.add(s.id); trouble.push({ s, origin, due }); return; }
      return result(s, what, due);
    } catch {
      // anything unexpected (a signature that fails after the check above, …): this row is released unchanged — never
      // counted against it — and the run goes on. Counted in the run's log line, the error itself is not logged (a JSON
      // or key error may quote what it parsed).
      out.errors = (out.errors || 0) + 1;
      if (!queued.has(s.id) && !waiting.has(s.id)) result(s, "stopped", due);
    }
  }
  try {
    for (let i = 0; i < subs.length; i += PARALLEL) {
      await Promise.all(subs.slice(i, i + PARALLEL).map(one));
      await flush();
    }
    // a push origin that answered 5xx / a redirect / timed out for a row but took another push 2xx in this run: the service
    // was up, so that failure is the row's (counted, RETRY_DROP / NEVER_DROP). So is it for a row that never received a push
    // at an origin that never answered 2xx to any push of ours under any key (no 'ok:'): nothing says a push service is
    // there (a made-up host that cannot answer — 4th review), and the row goes after NEVER_DROP tries. Otherwise the origin
    // may simply be down: the row is held back unchanged (rules.js HOLD; fails does not move) — an outage deletes nobody,
    // and while it lasts its rows come back only as probes, so the other services' phones get the runs' slots.
    for (const t of trouble) {
      if (okOrigins.has(t.origin) || (!took(t.s) && !okEver.has(t.origin))) result(t.s, "retry", t.due);
      else { out.held++; q(t.s, hold(t.s, HOLD_MINUTES)); }
    }
    // 401/403. A row is counted (one more failure, removed after REFUSED_DROP in a row; a row that never received a push at
    // its first refusal) unless OUR setup may be what is broken at that push origin. That is the case ("suspect") when a
    // phone that took our pushes under THIS key refuses there and the origin took no push 2xx in this run. It starts a
    // stretch (stat 'rs:' first day, 'rl:' last day of such runs), which ends at the origin's next 2xx, or when its last
    // day is older than yesterday (it ended without a 2xx: those phones stopped being due) — a new incident weeks later
    // starts its own grace days. For up to REFUSING_GRACE_DAYS from the first day of the stretch, at an origin that took
    // nothing 2xx in the run and is suspect in it or has a stretch going: a phone that took our pushes is held back
    // unchanged (rules.js HOLD; fails stays; held, not released, so these rows never keep the other push services' phones
    // waiting — they come back as probes, a few a run, and SEND_LIMIT a run once that origin answers 2xx — and so most runs of a
    // stretch try only a few of them, which is why a stretch going is enough), and a row that never took one gets one
    // failure and stays. Only a phone that took our pushes makes a run suspect and moves 'rl:'
    // (planted rows can neither start nor prolong a stretch). Judged per run and per origin from one such phone on, so a
    // quiet day with few phones due deletes nobody either.
    // A row last reached BEFORE this key first went through that origin (stat 'ok:') is an old subscription made under an
    // earlier key: its refusal is its own — counted, never suspect — so after a key change the phones that subscribed again
    // are not held up by the ones that did not, and the old rows go. A row last reached ON that day counts as reached under
    // this key (last_w/last_x hold the day only): on the day of a key change, a phone that got its last push under the old
    // key before the new one first went through is protected like the others. A planted subscription never took a push, so
    // it can neither make an origin suspect nor be spared. Suspect origins → stat 'refusing' → GET /health "refusing": true
    // → a Telegram line every day of the stretch.
    const lastPush = (s) => ((s.last_w || "") > (s.last_x || "") ? s.last_w : s.last_x) || "";
    const oldKey = (s, origin) => okSince.has(origin) && lastPush(s) < okSince.get(origin);
    const suspect = new Set(refused.filter(({ s, origin }) => took(s) && !okOrigins.has(origin) && !oldKey(s, origin)).map((x) => x.origin));
    const yesterday = addDays(today, -1);
    const stretchSince = (origin) => { const f = stretchFrom.get(origin), l = stretchLast.get(origin); return f && l && l >= yesterday ? f : null; };
    const careful = (origin) => !okOrigins.has(origin) && (suspect.has(origin) || !!stretchSince(origin));
    const graceOver = (origin) => { const f = stretchSince(origin); return !!f && daysBetween(today, f) >= REFUSING_GRACE_DAYS; };
    for (const { s, origin } of refused) {
      out.refused++;
      if (!careful(origin) || graceOver(origin) || (took(s) && oldKey(s, origin)))
        q(s, env.DB.prepare(Q.RETRY).bind(s.id, minute), env.DB.prepare(Q.DROP_REFUSED).bind(s.id, REFUSED_DROP));
      else if (took(s)) { out.spared = (out.spared || 0) + 1; q(s, hold(s, HOLD_MINUTES)); }
      else q(s, env.DB.prepare(Q.RETRY).bind(s.id, minute));
    }
    if (suspect.size) {
      out.refusing = suspect.size;
      for (const o of suspect) {
        if (!stretchSince(o)) stmts.push(env.DB.prepare(Q.STAT_RS_START).bind(`${tag} ${o}`, todayN));
        stmts.push(env.DB.prepare(Q.STAT_RL).bind(`${tag} ${o}`, todayN));
      }
      stmts.push(env.DB.prepare(Q.STAT_REFUSING).bind(todayN));
      console.error("alerts send: phones that took our pushes refuse the VAPID token where nothing else went through — kept, not counted (within the grace days)");
    }
  } finally {
    // a claimed row left without a statement (an exception above) is released, not left claimed for 15 minutes
    for (const s of subs) if (!queued.has(s.id)) { out.stopped++; q(s, release(s)); }
    // the push origins that took a push 2xx in this run free their held rows (sql.js RELEASE_HELD: rows that received a push
    // before, the longest-waiting first, at most `limit` in all — the next runs free the rest as they go). Not an origin
    // that said 429 in this run: the rows it slowed were held just now, and it asked us to slow down. Holds of this run at
    // the other origins are never touched: a row is held for push-service trouble or a refusal only where nothing went
    // through in the run (above), and those origins are not in this list
    const freeAt = [...okOrigins].filter((o) => !slowHosts.has(o));
    const closing = freeAt.length ? [env.DB.prepare(Q.RELEASE_HELD).bind(JSON.stringify(freeAt), limit)] : [];
    await write([...unwritten, ...fresh, ...stmts, ...closing, env.DB.prepare(Q.DROP_OTHER_TAGS).bind(`${tag} `), env.DB.prepare(Q.DROP_OLD_JWT).bind(nowS)]);
  }
  console.log("alerts send", JSON.stringify(out));
  return out;
}

// GET /health — what the daily monitor (.github/scripts/health_check.py) reads; words, days and the public key only:
//   sending   a push could go out now: VAPID_PRIVATE_JWK signs, and VAPID_PUBLIC_KEY (when set) is its key (push.js vapidKey)
//   key       the VAPID public key pushes go out with (public information; null while sending is false) — the monitor
//             compares it with app/config.js pushPublicKey, the key phones subscribe with
//   finished  KST day of the last factory finish (null before the first)
//   stale     that finish is more than STALE_DAYS days old, or — no finish ever — subscriptions exist and the first is more
//             than STALE_DAYS days old (the factory → Worker link stopped or never worked; notify.mjs fails quietly)
//   refusing  a send run today or yesterday (REFUSING_DAYS) found phones that took our pushes refusing our VAPID token at a
//             push service that took nothing else — kept, not counted, for up to REFUSING_GRACE_DAYS (send above)
//   capacity  'ok' | 'nearly_full' (≥ 80% of MAX_SUBS) | 'full' — nothing is evicted, a person must purge or raise MAX_SUBS
//   pairs     'ok' | 'capped': the factory's watched list was cut at PAIR_CAP today or yesterday (CAPPED_DAYS) — some pairs
//             were not computed (planted subscriptions, or more real ones than the cap: purge or raise PAIR_CAP)
//   compute   'ok' | 'deferred' | 'failed' (10th review — what a catch-up run cannot say itself: it has no Telegram):
//             'failed' = a computation started this UTC day or the one before and never finished (its lease ran out — stat
//             'cfail', or the lease still left), 'deferred' = a start was deferred this UTC day or the one before
//             (COMPUTES_PER_DAY used up, or its last computation kept for the 06:00 KST run — stat 'fd'). The monitor (09:30
//             KST = 00:30 UTC) sees anything from the D1 day before
//   plan      'paid' | 'free': the limits in effect — the PLAN SETTING (wrangler.jsonc; limits() above), NOT the account's
//             Cloudflare plan, which the Worker cannot see (11th review: only the dashboard's plan page shows that)
async function health(env, now) {
  const h = { "cache-control": "no-store" };
  let row;
  try { row = await env.DB.prepare(Q.HEALTH).first(); }
  catch { console.error("alerts health: D1 did not answer"); return json({ ok: false }, 503, h); }
  const v = await vapidKey(env, now);
  const today = kstDay(now);
  const within = (d, days) => !!d && daysBetween(today, d) >= 0 && daysBetween(today, d) <= days;
  const finished = dayOfNum(row && row.fin), refusedOn = dayOfNum(row && row.ref), cappedOn = dayOfNum(row && row.cap);
  const firstNew = row && validDay(row.first_new) ? row.first_new : null;
  const stale = finished ? daysBetween(today, finished) > STALE_DAYS
    : Number(row && row.subs) > 0 && !!firstNew && daysBetween(today, firstNew) > STALE_DAYS;
  const refusing = within(refusedOn, REFUSING_DAYS);
  const L = limits(env);
  const capacity = capacityOf(row && row.subs, L.MAX_SUBS);
  const pairs = within(cappedOn, CAPPED_DAYS) ? "capped" : "ok";
  // UTC days (D1's): this one or the one before
  const utcToday = dayOfNum(utcDayNum(now));
  const withinUtc = (n) => { const d = dayOfNum(n); return !!d && daysBetween(utcToday, d) >= 0 && daysBetween(utcToday, d) <= COMPUTE_DAYS; };
  const failed = withinUtc(row && row.cf) || (Number.isSafeInteger(row && row.lease) && row.lease <= now - LEASE_MS);
  const compute = failed ? "failed" : withinUtc(row && row.fd ? Math.floor(row.fd / 10) : null) ? "deferred" : "ok";
  return json({ ok: true, window: "08-21 KST", sending: !!v.key, key: v.key || null, finished, stale, refusing, capacity, pairs, compute, plan: L.plan }, 200, h);
}

async function route(request, env, now) {
  const url = new URL(request.url), path = url.pathname, m = request.method;
  if ((path === "/health" || path === "/v1/health") && m === "GET") return health(env, now);

  if (path.startsWith("/v1/push/")) {
    const c = cors(request, env);
    if (!c.ok) return json({ error: "FORBIDDEN_ORIGIN" }, 403, c.headers);
    if (m === "OPTIONS")
      return new Response(null, { status: 204, headers: { ...c.headers, "access-control-allow-methods": "POST, PUT, DELETE", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
    let r;
    try {
      const seg = path.split("/");                      // ['', 'v1', 'push', 'subscribe' | 'rules', id?]
      if (m === "POST" && path === "/v1/push/subscribe") r = await subscribe(request, env, now);
      else if (m === "PUT" && seg[3] === "rules" && seg.length === 5) r = await putRules(request, env, seg[4]);
      else if (m === "DELETE" && seg[3] === "subscribe" && seg.length === 5) r = await unsubscribe(env, seg[4]);
      else r = { status: 404, body: { error: "NOT_FOUND" } };
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      r = { status: e.status, body: { error: e.code } };
    }
    return json(r.body, r.status, c.headers);
  }

  if (path.startsWith("/v1/internal/")) {
    if (!env.ALERTS_SECRET) return json({ error: "NOT_CONFIGURED" }, 503);
    if (!sameSecret(bearer(request), env.ALERTS_SECRET)) return json({ error: "UNAUTHORIZED" }, 401);
    try {
      if (m === "POST" && path === "/v1/internal/start") return json(await start(request, env, now));
      if (m === "POST" && path === "/v1/internal/keys") return json(await storeKeys(request, env));
      if (m === "GET" && path === "/v1/internal/watched") return json(await watched(env, url, now));
      if (m === "POST" && path === "/v1/internal/digest") return json(await digest(request, env, now));
      if (m === "POST" && path === "/v1/internal/finish") return json(await finish(request, env, now));
      if (m === "POST" && path === "/v1/internal/send") return json(await send(env, now));
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      return json({ error: e.code }, e.status);
    }
  }
  return json({ error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request, env, _ctx, now = Date.now()) {
    // the message only (D1/runtime errors name no request data); never the URL, which may hold a subscription id
    try { return await route(request, env, now); }
    catch (e) { console.error("alerts error", e && e.message); return json({ error: "INTERNAL" }, 500); }
  },
  async scheduled(event, env, ctx) {
    // the real start time: a cron run may start late (it runs when a machine is free), and the window and every TTL must
    // follow the clock, never the schedule
    const start = Math.max(event.scheduledTime || 0, Date.now());
    ctx.waitUntil(send(env, start).catch((e) => console.error("alerts send failed", e && e.message)));
  },
};
