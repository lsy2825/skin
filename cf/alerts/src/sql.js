// Every SQL statement the Worker runs, as constants: the node tests run these same strings on the real schema
// (migrations/0001_init.sql) with node:sqlite, so what is tested is what D1 runs. Deciding what is news and matching rules
// to it is done here in SQL (json_each × snap primary-key lookups), so that work is D1's, not the Worker's 10 ms CPU.
import { END_DAYS } from "./rules.js";

// a rule's pair: key + region ('' = nationwide; '수도권' is its own pair, computed by notify.mjs from 서울+경기+인천)
const RULE_PAIR = "d.k = j.value->>'$.key' AND d.r = coalesce(j.value->>'$.region', '')";

// does the stored rule list `old` hold a rule the new list `new` (both normalized JSON, rules.js validateRules: canonical
// order and field order) does not? Only then are the pending marks reset: they may be news for the removed rule. Adding a
// rule or sending the same rules (in any order) keeps them — news that was already promoted would otherwise be lost.
const RULES_DROPPED = (old, nu) => `EXISTS (SELECT 1 FROM json_each(${old}) o WHERE o.value NOT IN (SELECT value FROM json_each(${nu})))`;

// ---- the factory's key set (table keyset, ONE row): the compare keys of the data.json the factory last read, a JSON array
// (rules.js keySetJson). notify.mjs sends it on every run after a deploy (POST /v1/internal/keys, src/worker.js storeKeys;
// a run that is not the daily schedule's sends only this). The factory computes those keys only, so a pair whose key is not
// in it would never be computed: it is left out of WATCHED. Subscribe and PUT still STORE such a rule, and answer exactly
// as for any other rule (약속 1 unchanged — 7th review: no extra answer field); the pair starts being ranked as soon as a
// later key set holds the key, and is computed from the next daily (schedule) run on. No set stored yet: every key is ranked.
// ?1 the set's JSON. Written only when it differs (an unchanged set writes 0 rows; a change 1 row — INTEGER PRIMARY KEY,
// no index entry): a few rows a week.
export const SET_KEYS = "INSERT INTO keyset (id, keys) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET keys = excluded.keys WHERE keys <> excluded.keys";

// ?1 yyyymmdd — the Worker's own KST day, written in the same D1 batch right before SUBSCRIBE: the subs_ins trigger (migration)
// names today's 'new:<day>' counter from it, so the budget never reads a per-row date (no row holds one)
export const SET_DAY = "INSERT INTO stat (k, n) VALUES ('day', ?1) ON CONFLICT(k) DO UPDATE SET n = excluded.n WHERE n <> excluded.n";
// ?1 id ?2 endpoint ?3 rules ?4 today ?5 MAX_SUBS ?6 NEW_PER_DAY. Same endpoint again → new id (the old one stops working),
// allowed even when full or over today's budget; last_w/last_x/exp_sent stay (subscribing again never gets around once a
// week), pending marks are reset only when a rule was removed. No row back = the table is full or today's budget used up
// (nothing is ever evicted to make room: a full table answers 503 FULL and /health "capacity" says so).
export const SUBSCRIBE = `INSERT INTO subs (id, endpoint, rules)
  SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM subs WHERE endpoint = ?2)
    OR ((SELECT n FROM stat WHERE k = 'subs') < ?5 AND coalesce((SELECT n FROM stat WHERE k = 'new:' || ?4), 0) < ?6)
  ON CONFLICT(endpoint) DO UPDATE SET id = excluded.id, rules = excluded.rules,
    pend_w = CASE WHEN ${RULES_DROPPED("subs.rules", "excluded.rules")} THEN 0 ELSE subs.pend_w END,
    pend_x = CASE WHEN ${RULES_DROPPED("subs.rules", "excluded.rules")} THEN NULL ELSE subs.pend_x END,
    pend_xl = CASE WHEN ${RULES_DROPPED("subs.rules", "excluded.rules")} THEN NULL ELSE subs.pend_xl END
  RETURNING id`;
// ?1 today — why SUBSCRIBE returned nothing: total (MAX_SUBS) or today's new rows (NEW_PER_DAY)
export const SUBS_COUNTS = "SELECT (SELECT n FROM stat WHERE k = 'subs') AS total, coalesce((SELECT n FROM stat WHERE k = 'new:' || ?1), 0) AS today";
// ?1 id ?2 rules (≥ 1; a PUT with none is DELETE_SUB_RETURNING) — a removed rule resets the pending marks; send history
// (last_w, last_x, exp_sent) stays. No row back = unknown id
export const PUT_RULES = `UPDATE subs SET rules = ?2,
    pend_w = CASE WHEN ${RULES_DROPPED("rules", "?2")} THEN 0 ELSE pend_w END,
    pend_x = CASE WHEN ${RULES_DROPPED("rules", "?2")} THEN NULL ELSE pend_x END,
    pend_xl = CASE WHEN ${RULES_DROPPED("rules", "?2")} THEN NULL ELSE pend_xl END
  WHERE id = ?1 RETURNING id`;
export const DELETE_SUB = "DELETE FROM subs WHERE id = ?1";
// PUT with no rules = the phone switched everything off: the row goes (an unknown id gets no row back → 404)
export const DELETE_SUB_RETURNING = "DELETE FROM subs WHERE id = ?1 RETURNING id";
// health: D1 answers and the schema is there (reads a few stat rows by primary key; ';' sorts right after ':'). fin = the last factory finish (KST day as yyyymmdd);
// first_new = the earliest 'new:YYYY-MM-DD' day still kept — until the first finish nothing prunes them (PRUNE_STAT runs only
// in FINISH), so while fin is empty it is the day of the first subscription (GET /health "stale" when that is more than
// STALE_DAYS old: the factory → Worker link never worked); ref = the last KST day (yyyymmdd) a send run found phones that
// took our pushes refusing our VAPID token at a push service that took nothing else (STAT_REFUSING; GET /health
// "refusing"); cap = the last KST day the factory's watched list was cut at PAIR_CAP (STAT_CAPPED; GET /health "pairs")
export const HEALTH = `SELECT (SELECT n FROM stat WHERE k = 'subs') AS subs, (SELECT n FROM stat WHERE k = 'finish') AS fin,
  (SELECT substr(min(k), 5) FROM stat WHERE k >= 'new:' AND k < 'new;') AS first_new, (SELECT n FROM stat WHERE k = 'refusing') AS ref,
  (SELECT n FROM stat WHERE k = 'capped') AS cap`;

// ?1 page size ?2 offset ?3 today − PAIR_KEEP_DAYS (the Worker's clock). Pairs only — never ids, endpoints or numbers (they
// would leave Cloudflare for the runner). The factory digests every pair it gets, and every digested pair is D1 rows written
// (D1 Free allows 100,000 rows written a day FOR THE WHOLE ACCOUNT — over it every D1 query of the account fails until 00:00
// UTC = 09:00 KST). Only pairs whose key is in the stored key set are ranked (every pair while none is stored): the
// factory computes only the keys of the data.json it reads, so a pair of any other key would hold a place in the list for
// ever without being computed (never in snap, so never 'added', never news, never a push — 5th review). The set is read
// once per statement (a list subquery: json_each of the one keyset row). So the list is CUT at PAIR_CAP (src/worker.js
// watched) and comes in this order:
//   1. pairs watched by more phones that already received a push from us (planted subscriptions never did);
//   2. pairs first computed less than PAIR_KEEP_DAYS ago (snap.added): a list of new pairs, however many phones name them,
//      cannot push out the pairs computed this week — the list is never replaced in a day;
//   3. pairs not computed yet (not in snap);
//   4. pairs computed for longer than that that no phone which took a push watches: they make way for (3), so whoever
//      filled the list first cannot keep it for ever (4th review) — a new pair takes a row a finish freed (sql.js DIGEST);
// then pairs watched by more phones, then the more recently computed, then (k, r). A pair is counted once per phone (two
// rules of one phone on the same pair are one). Paged by rank (LIMIT/OFFSET): every page groups the table again. Digesting a
// page only moves that page's own new pairs up (3 → 2), so the later pages stay the same; a subscription made while the
// factory pages can shift a pair by one page (read twice or missed once — a missed pair's baseline is pruned and taken again
// silently the next day).
export const WATCHED = `SELECT w.k AS k, w.r AS r FROM (
    SELECT j.value->>'$.key' AS k, coalesce(j.value->>'$.region', '') AS r,
      count(DISTINCT CASE WHEN subs.last_w IS NOT NULL OR subs.last_x IS NOT NULL THEN subs.id END) AS got,
      count(DISTINCT subs.id) AS c
    FROM subs, json_each(subs.rules) j
    WHERE NOT EXISTS (SELECT 1 FROM keyset) OR j.value->>'$.key' IN (SELECT value FROM keyset, json_each(keyset.keys))
    GROUP BY 1, 2
  ) w LEFT JOIN snap s ON s.k = w.k AND s.r = w.r
  ORDER BY w.got DESC, CASE WHEN s.added > ?3 THEN 0 WHEN s.k IS NULL THEN 1 ELSE 2 END, w.c DESC, s.added DESC, w.k, w.r
  LIMIT ?1 OFFSET ?2`;
// ?1 today as yyyymmdd: the factory's watched list was cut at PAIR_CAP — GET /health "pairs": "capped" that day and the next
export const STAT_CAPPED = "INSERT INTO stat (k, n) VALUES ('capped', ?1) ON CONFLICT(k) DO UPDATE SET n = excluded.n";

// ?1 run ('updated|day': meta.updated = the collection date, the same on every rebuild until the next scrape) ?2 JSON
// array of checked entries (rules.js cleanEntry). First sight of a pair = baseline, no news. Afterwards the numbers go to
// pm/pn/pmed with p = 1 when they differ from the baseline (p = 0 when they are the baseline again), pu = this run's
// collection date when it is not the baseline's (bu).
// Within ONE collection (bu = this run's updated, SAME) the numbers only move the good way: lowest = min, branches = max,
// median only when there are more branches. A rebuild without a scrape drops ended rows from data.json (build2/clean.py),
// and the next scrape brings the same events back: neither is news. A brand added mid-week (more branches) still is.
// From a NEW collection a good move (a lower lowest price, more branches, a median that is not higher) is taken at once; a
// BAD move (higher lowest price or none, fewer branches, a higher median — or any median move while branches shrank) is
// HELD until the collection after it shows it too (cb = which numbers were held, cu = that collection). A brand whose
// scrape failed once (weekly.py keeps its last accepted file, clean.py drops its ended rows → the brand vanishes from
// data.json) and is back at the next scrape at the same prices is then no news at all; a real rise becomes the baseline
// one collection later (never news by itself). Left: a brand that fails two collections in a row is taken as gone, and its
// return is newmatch/watch/target news.
// g = the key's regroup day (data.json meta.recl): when it is NEWER than the stored one, the rows behind the pair are a new
// mix (a rule fix, not a price change) and the pair is re-based silently, as the app's checkAlerts does with reclDate
// (REBASE; TEXT compare of YYYY-MM-DD, '' never wins). A g that goes back (build2/appdata.py keeps only the last 12
// regroup days, so an old entry drops off, or '' when no entry holds the key any more) re-bases nothing and never lowers the
// stored g: the real price change of that collection is news. Left: a second regroup on the same collection day keeps the
// same g and reads as a price change.
// The baseline itself is never touched here — only FINISH promotes — so a digest without a finish (failed finish, failed
// later chunk) loses nothing. The same NEW collection digested AGAIN before a finish consumed it (REPEAT: pu already names
// it — a chunk notify.mjs retried after D1 had committed it, a 500 after the commit, or the next day's run of the same
// collection after a failed finish) keeps the pending numbers, cb and cu the first digest of that collection left: compared
// again, CONFIRM would read that collection's own cu as "not confirmed yet" and flip a confirmed bad move back to held, and
// the news it makes possible later would be lost (7th review). So digesting a collection twice = once; only run, e, s, u
// (and g through REBASE) are this run's. A good move a later build of that same collection shows is taken by the first
// digest after the finish (SAME) — a day later, never lost.
// ANOTHER new collection while the last one's numbers were never finished (PREV: pu names an earlier collection and p = 1 —
// its finish failed, and no finish ran before this collection came): the digest goes on as if that finish had run (8th
// review: the next collection used to be compared with the old baseline, so a confirmed rise was held again and the target
// and newmatch news after it was lost). Those numbers become q (qm/qn/qmed) and are what this collection is compared with,
// exactly as a finish would have promoted them; the baseline m/n/med stays the numbers the phones were last marked
// against. The next finish marks both steps — baseline → q and q → this collection (MARK_WEEKLY) — and promotes. Left: a
// third collection before any finish keeps only the latest unfinished numbers in q (baseline → the last unfinished
// collection → this one: a crossing in the middle collection alone is not news).
// ?3 PAIR_CAP: a NEW pair is added only while snap holds fewer than PAIR_CAP rows (counted once per statement, so one chunk
// of ≤ DIGEST_MAX 500 can pass it: snap ≤ PAIR_CAP + 500). The rows a finish prunes are free again only the next day, so
// a day can never both add a whole list and delete one: per factory run the snap side writes ≤ 2 × (PAIR_CAP + 500) rows
// (src/worker.js has the arithmetic). A pair left out waits for a free row (src/worker.js digest: 'capped').
// ?4 today (the Worker's clock): a new pair's `added` (WATCHED keeps it in the list for PAIR_KEEP_DAYS); never updated.
const SAME = "snap.bu = excluded.bu";
const REBASE = "excluded.g > snap.g";
const REPEAT = `(NOT ${SAME} AND snap.pu = excluded.bu)`;
// an earlier new collection's numbers no finish consumed (only read on the NEW path: not SAME, not REPEAT, so pu ≠ this one)
const PREV = "(snap.pu IS NOT NULL AND snap.p = 1)";
// what a NEW collection is compared with: those numbers when there are some (as their finish would have promoted them),
// else the baseline
const B_M = `(CASE WHEN ${PREV} THEN snap.pm ELSE snap.m END)`;
const B_N = `(CASE WHEN ${PREV} THEN snap.pn ELSE snap.n END)`;
const B_MED = `(CASE WHEN ${PREV} THEN snap.pmed ELSE snap.med END)`;
const BAD_M = `((excluded.m IS NULL AND ${B_M} IS NOT NULL) OR (excluded.m IS NOT NULL AND ${B_M} IS NOT NULL AND excluded.m > ${B_M}))`;
const BAD_N = `(excluded.n < ${B_N})`;
const BAD_MED = `(${BAD_N} OR (excluded.med IS NULL AND ${B_MED} IS NOT NULL) OR (excluded.med IS NOT NULL AND ${B_MED} IS NOT NULL AND excluded.med > ${B_MED}))`;
// a held move is taken when the collection before this one (another date) held the same number
const CONFIRM = "(snap.cu IS NOT NULL AND snap.cu <> excluded.bu)";
const TAKE_M = `(NOT ${BAD_M} OR (${CONFIRM} AND (snap.cb & 1) <> 0))`;
const TAKE_N = `(NOT ${BAD_N} OR (${CONFIRM} AND (snap.cb & 2) <> 0))`;
const TAKE_MED = `(NOT ${BAD_MED} OR (${CONFIRM} AND (snap.cb & 4) <> 0))`;
const NEW_M = `CASE WHEN ${SAME} THEN (CASE WHEN snap.m IS NULL THEN excluded.m WHEN excluded.m IS NULL THEN snap.m ELSE min(snap.m, excluded.m) END) WHEN ${TAKE_M} THEN excluded.m ELSE ${B_M} END`;
const NEW_N = `CASE WHEN ${SAME} THEN max(snap.n, excluded.n) WHEN ${TAKE_N} THEN excluded.n ELSE ${B_N} END`;
const NEW_MED = `CASE WHEN ${SAME} THEN (CASE WHEN excluded.n <= snap.n THEN snap.med ELSE excluded.med END) WHEN ${TAKE_MED} THEN excluded.med ELSE ${B_MED} END`;
// q: PREV's numbers on the NEW path; kept by a REPEAT; gone with SAME (the baseline's own collection again) and REBASE
const NEW_Q = (c) => `CASE WHEN ${REBASE} OR ${SAME} THEN NULL WHEN ${REPEAT} THEN snap.q${c} WHEN ${PREV} THEN snap.p${c} ELSE NULL END`;
const NEW_CB = `(CASE WHEN ${BAD_M} AND NOT ${TAKE_M} THEN 1 ELSE 0 END) + (CASE WHEN ${BAD_N} AND NOT ${TAKE_N} THEN 2 ELSE 0 END) + (CASE WHEN ${BAD_MED} AND NOT ${TAKE_MED} THEN 4 ELSE 0 END)`;
export const DIGEST = `INSERT INTO snap (k, r, m, n, med, bu, g, run, added, e, s, u)
  SELECT j.value->>'$.k', j.value->>'$.r', j.value->>'$.m', j.value->>'$.n', j.value->>'$.med', substr(?1, 1, 10),
    coalesce(j.value->>'$.g', ''), ?1, ?4, j.value->>'$.e', j.value->>'$.s', j.value->>'$.u'
  FROM json_each(?2) j
  WHERE EXISTS (SELECT 1 FROM snap s WHERE s.k = j.value->>'$.k' AND s.r = j.value->>'$.r') OR (SELECT count(*) FROM snap) < ?3
  ON CONFLICT(k, r) DO UPDATE SET run = excluded.run, e = excluded.e, s = excluded.s, u = excluded.u,
    g = CASE WHEN ${REBASE} THEN excluded.g ELSE snap.g END,
    m = CASE WHEN ${REBASE} THEN excluded.m ELSE snap.m END,
    n = CASE WHEN ${REBASE} THEN excluded.n ELSE snap.n END,
    med = CASE WHEN ${REBASE} THEN excluded.med ELSE snap.med END,
    bu = CASE WHEN ${REBASE} THEN excluded.bu ELSE snap.bu END,
    p = CASE WHEN ${REBASE} THEN 0 WHEN ${REPEAT} THEN snap.p ELSE ((${NEW_M}) IS NOT snap.m OR (${NEW_N}) IS NOT snap.n OR (${NEW_MED}) IS NOT snap.med OR (NOT ${SAME} AND ${PREV})) END,
    qm = ${NEW_Q("m")}, qn = ${NEW_Q("n")}, qmed = ${NEW_Q("med")},
    pm = CASE WHEN ${REBASE} THEN NULL WHEN ${REPEAT} THEN snap.pm ELSE ${NEW_M} END,
    pn = CASE WHEN ${REBASE} THEN NULL WHEN ${REPEAT} THEN snap.pn ELSE ${NEW_N} END,
    pmed = CASE WHEN ${REBASE} THEN NULL WHEN ${REPEAT} THEN snap.pmed ELSE ${NEW_MED} END,
    pu = CASE WHEN ${REBASE} OR ${SAME} THEN NULL ELSE excluded.bu END,
    cb = CASE WHEN ${REBASE} THEN 0 WHEN ${SAME} OR ${REPEAT} THEN snap.cb ELSE ${NEW_CB} END,
    cu = CASE WHEN ${REBASE} THEN NULL WHEN ${SAME} OR ${REPEAT} THEN snap.cu ELSE excluded.bu END`;

// finish (one batch, in this order). Weekly news = a pending pair against its baseline (from → to):
//   watch    median moved ≥ 5% (|to.med − from.med| × 20 ≥ from.med, exact in integers) or a new lowest price — push.js
//            watchMoved()
//   newmatch more branches (to.n > from.n)
//   target   the lowest price crossed max: now ≤ max, before > max or no price (already below max shows on screen only)
// A pair with q (an earlier collection no finish consumed, DIGEST PREV) has two steps, baseline → q and q → pending: news
// in either is news, as if each had had its finish. The same joined row — no extra row read.
const NEWS = (f, t) => `((j.value->>'$.kind' = 'watch' AND d.${f}med > 0 AND d.${t}med IS NOT NULL
            AND (abs(d.${t}med - d.${f}med) * 20 >= d.${f}med OR (d.${f}m IS NOT NULL AND d.${t}m IS NOT NULL AND d.${t}m < d.${f}m)))
       OR (j.value->>'$.kind' = 'newmatch' AND d.${t}n > d.${f}n)
       OR (j.value->>'$.kind' = 'target' AND d.${t}m IS NOT NULL AND d.${t}m <= j.value->>'$.max'
            AND (d.${f}m IS NULL OR d.${f}m > j.value->>'$.max')))`;
export const MARK_WEEKLY = `UPDATE subs SET pend_w = 1 WHERE pend_w = 0 AND EXISTS (
    SELECT 1 FROM json_each(subs.rules) j JOIN snap d ON ${RULE_PAIR} AND d.p = 1
    WHERE CASE WHEN d.qn IS NULL THEN ${NEWS("", "p")} ELSE ${NEWS("", "q")} OR ${NEWS("q", "p")} END)`;
// Announced expiring entries (subs.exp_sent; pend_xl holds the ones not announced yet) are 'end date|key|region' strings in
// a JSON array sorted by value — so by end date first. A KEY_RE key, a region and a date hold no quote, so '"<entry>"' finds
// exactly that element with instr(): membership costs no D1 row reads (json_each would read every element of every phone's
// list for every rule — 7th review: up to 6.5M reads in one finish).
const X_T = "d.u || '|' || d.k || '|' || d.r";
// the position in exp_sent of its first entry still running on ?1 (today): the first '"<date>|' among the days ?1 … ?1 +
// END_DAYS (= 3; 1e9 when there is none). No entry can end later than that: the Worker's digest refuses an end date u past
// its own day + END_DAYS (src/worker.js digest), and an entry is announced only from a run digested on or before today. In
// a list sorted by end date, everything before that position has ended. Scalar string functions only — no rows read.
const FIRST_LIVE = `min(${Array.from({ length: END_DAYS + 1 }, (_, i) => `coalesce(nullif(instr(exp_sent, '"' || date(?1, '+${i} days') || '|'), 0), 1000000000)`).join(", ")})`;
// ?1 today: announced entries whose end date passed are forgotten (exp_sent stays small; docs/legal/PRIVACY_POLICY_DRAFT.md
// '종료일이 지나면 지움'). Only a row whose first entry has ended is rewritten — the text from its first running entry on, or
// NULL. Reads each subscription row once (no json_each).
export const PRUNE_XSENT = `UPDATE subs SET exp_sent = CASE WHEN ${FIRST_LIVE} = 1000000000 THEN NULL ELSE '[' || substr(exp_sent, ${FIRST_LIVE}) END
  WHERE exp_sent IS NOT NULL AND ${FIRST_LIVE} <> 2`;
// ?1 run. expiring (this run's numbers): a price at or below T (max, or the ending price itself) ends within 3 days and
// nothing at or below T stays. Per (pair, end date): the ones in exp_sent were announced already (a later end date announced
// before never hides an earlier new one). pend_x = the earliest not announced, pend_xl = all of them (announced together).
// The rows are computed ONCE per finish (7th review: two statements each computed them before):
const X_PAIRS = `SELECT DISTINCT s2.id AS id, d.u AS u, ${X_T} AS t
      FROM subs s2, json_each(s2.rules) j JOIN snap d ON ${RULE_PAIR} AND d.run = ?1
      WHERE j.value->>'$.kind' = 'expiring' AND d.e IS NOT NULL AND d.e <= coalesce(j.value->>'$.max', d.e)
        AND (d.s IS NULL OR d.s > coalesce(j.value->>'$.max', d.e))
        AND instr(coalesce(s2.exp_sent, ''), '"' || ${X_T} || '"') = 0`;
// ?1 run. Every phone with something to announce gets it (pend_x, pend_xl), and a phone that still holds yesterday's
// pend_x but has nothing ending in THIS run's numbers any more (the clinic extended the event, the row left data.json, the
// rule was changed) loses the mark, so a wrong "ending soon" push never goes out the next morning. RETURNING says which:
// marked 1 (an expiring notice to send) or 0 (a stale mark cleared) — src/worker.js finish counts the 1s.
export const MARK_EXPIRING = `UPDATE subs SET pend_x = x.u, pend_xl = x.l FROM (
    SELECT s.id AS id, a.u AS u, a.l AS l FROM subs s LEFT JOIN (
      SELECT id, min(u) AS u, json_group_array(t) AS l FROM (
        ${X_PAIRS}
        ORDER BY s2.id, t)
      GROUP BY id) a ON a.id = s.id
    WHERE s.pend_x IS NOT NULL OR a.id IS NOT NULL) x
  WHERE subs.id = x.id AND (subs.pend_x IS NOT x.u OR subs.pend_xl IS NOT x.l)
  RETURNING pend_x IS NOT NULL AS marked`;
// the phones are marked: the pending numbers become the baseline (with their collection date)
// (q goes with them: a row with q always has p = 1, DIGEST)
export const PROMOTE = "UPDATE snap SET m = pm, n = pn, med = pmed, bu = coalesce(pu, bu), p = 0, pm = NULL, pn = NULL, pmed = NULL, pu = NULL, qm = NULL, qn = NULL, qmed = NULL WHERE p = 1";
// unchanged numbers from a new collection: the baseline now belongs to that collection
export const ROLL_BU = "UPDATE snap SET bu = pu, pu = NULL WHERE pu IS NOT NULL";
// ?1 today as yyyymmdd: the last finish, shown by GET /health ("finished") so a monitor sees the factory → Worker link stop.
// Written only when the day changes (a second finish the same day writes no row)
export const STAT_FINISH = "INSERT INTO stat (k, n) VALUES ('finish', ?1) ON CONFLICT(k) DO UPDATE SET n = excluded.n WHERE n <> excluded.n";
// ?1 the data.json the finish was computed from: the first 52 bits of its sha256 (src/worker.js dataTag). With 'finish' it
// says "this data.json was finished today" (SAME_DATA). Written only when it changes; a finish that does not name its data
// removes the row (CLEAR_DATA), so nothing can be taken for done
export const STAT_DATA = "INSERT INTO stat (k, n) VALUES ('data', ?1) ON CONFLICT(k) DO UPDATE SET n = excluded.n WHERE n <> excluded.n";
export const CLEAR_DATA = "DELETE FROM stat WHERE k = 'data'";
// ?1 today as yyyymmdd ?2 the data tag: the last finish was today and from this same data.json → 1. A factory run
// of the same data on the same KST day then stops at its first watched page (src/worker.js watched: done) — no digest, no
// finish: it would write every pair again and change nothing (6th review: weekly.yml runs many times a day). Two stat
// rows read by primary key.
export const SAME_DATA = "SELECT coalesce((SELECT n FROM stat WHERE k = 'finish') = ?1 AND (SELECT n FROM stat WHERE k = 'data') = ?2, 0) AS same";
// pairs not in this run's digest: nobody watches them any more, their key left data.json, or the watched list was cut at
// PAIR_CAP (src/worker.js watched; sql.js WATCHED says which pairs make way)
export const PRUNE_SNAP = "DELETE FROM snap WHERE run <> ?1";
export const PRUNE_STAT = "DELETE FROM stat WHERE k LIKE 'new:%' AND k < 'new:' || ?1";   // ?1 today: past days' budgets

// send run, first batch. ?1 now (epoch minutes). claim > 0 = the epoch minute of the send run holding the row: older than 15
// minutes = a run that died — cleared. (claim < 0 = a row HELD BACK, rules.js HOLD: never cleared by time — CLAIM_P tries a
// few a run, RELEASE_HELD frees a few a run after that push origin answers 2xx; both through the subs_held index.) One range
// of the subs_claim index (claim > 0 rows only).
export const RESET_STALE = "UPDATE subs SET claim = NULL WHERE claim > 0 AND claim < ?1 - 15";
// ?1 today ?2 today as yyyymmdd: pending end dates before today are dropped (scans the subs_x partial index: rows with a
// pending expiring only — up to MAX_SUBS rows read). Only until the day's finish ran: it rewrites or clears every pend_x
// from that day's numbers, so once stat 'finish' is today the walk is skipped: the gate g is a one-row-or-empty table the
// join starts from, and an empty one reads 3 rows instead of the walk (measured on a local D1; a plain WHERE condition was
// still checked row by row — 7th review: 8,000 rows read in each of 77 runs at the ceiling otherwise). One that stays (a
// factory a day behind may send an end date of yesterday) is never claimed — X_DUE needs pend_x ≥ today — and the next
// finish replaces it.
export const DROP_ENDED = `UPDATE subs SET pend_x = NULL, pend_xl = NULL
  FROM (SELECT 1 AS go WHERE coalesce((SELECT n FROM stat WHERE k = 'finish'), 0) <> ?2) g
  WHERE subs.pend_x IS NOT NULL AND subs.pend_x < ?1`;
export const VAPID_CACHE = "SELECT aud, jwt, exp FROM vapid";
// ?1 '<key tag> ' (the first 12 characters of the VAPID public key + a space): per push origin, for THIS key,
//   'ok:<tag> <origin>'  the first KST day (yyyymmdd) that origin took a push signed with this key (STAT_OK_SINCE). A row
//                        whose last push is OLDER than that day was last reached under an earlier key: its 401/403 is its
//                        own (a phone that never subscribed again after a key change), not a sign that our setup is broken
//                        (a row last reached ON that day counts as reached under this key: last_w/last_x hold the day only)
//   'rs:<tag> <origin>'  the first day of the current stretch in which phones that took our pushes under this key refuse at
//                        that origin while nothing goes through there (STAT_RS_START; cleared by the origin's next 2xx,
//                        CLEAR_RS). After REFUSING_GRACE_DAYS of it the refusals are counted again (src/worker.js send)
//   'rl:<tag> <origin>'  the last day of that stretch (STAT_RL): a stretch whose last day is older than yesterday ended without
//                        a 2xx (the phones stopped being due), so the next one starts again from its own first day
// Push origins are push-service hosts (fcm.googleapis.com, web.push.apple.com, …), never anything about a person.
// The 'ok:' rows of EVERY key are read (one per push service per key): a push origin with none never answered 2xx to any
// push of ours, so trouble there is not a push-service outage for a row that never received a push (src/worker.js send)
export const ORIGIN_STATS = `SELECT k, n FROM stat WHERE (k >= 'ok:' AND k < 'ok;')
  OR (((k >= 'rl:' AND k < 'rl;') OR (k >= 'rs:' AND k < 'rs;')) AND substr(k, 4, 13) = ?1)`;
// a push origin from an endpoint ('https://host/…' → 'https://host', the same as new URL(endpoint).origin: endpoints are
// stored as URL.href, so there is always a '/' after the host). The subs_held index (migration) is on this same expression,
// then NEVER (a row that never received a push), then claim — so every statement on held rows below names an origin and a
// NEVER value and reads one index range that stops after its share (8th review: reading every held row cost ~4 rows read per
// held row in each of 77 runs, and nothing bounds the held rows below MAX_SUBS).
const ORIGIN = "substr(endpoint, 1, 7 + instr(substr(endpoint, 9), '/'))";
const NEVER = "(last_w IS NULL AND last_x IS NULL)";
// ?1 now (epoch minutes) ?2 PROBES ?3 how many in all (min(PROBE_SLOTS, limit)) ?4 PROBE_ORIGINS. Held rows (claim < 0,
// rules.js HOLD) whose minute has come (−claim ≤ now), at most ?2 per push origin, the longest-waiting first: tried again in
// this run as probes (still failing → held again, at the back; a 2xx frees that origin's held rows a few a run,
// RELEASE_HELD). Claimed BEFORE the queue, so a probe is never crowded out on a busy day, and the claims below fill only what
// is left of the limit. How it reads (EXPLAIN QUERY PLAN checked in the tests, rows read in test/d1_reads.mjs): o = the push
// origins that hold rows, one index seek each (a skip over the index: the next origin after the last one), at most ?4 of
// them; for each origin the ?2 longest-waiting due rows that received a push before and the ?2 that never did (two index
// ranges that stop after ?2 entries); of those, ?2 per origin, the longest-waiting first. Rows read ≈ ?4 × (1 + 2 × (?2 + 1))
// + the claimed rows, however many rows are held. Left: more than ?4 origins holding rows at once (the push services
// have far fewer hosts, src/push.js PUSH_HOSTS) — the origins after the ?4th by name get no probe until fewer hold rows; a
// 2xx there (RELEASE_HELD) still frees theirs.
export const CLAIM_P = `UPDATE subs SET claim = ?1 WHERE id IN (
    WITH RECURSIVE o(x, n) AS (
      SELECT (SELECT ${ORIGIN} FROM subs WHERE claim < 0 ORDER BY 1 LIMIT 1), 1
      UNION ALL
      SELECT (SELECT ${ORIGIN} FROM subs WHERE claim < 0 AND ${ORIGIN} > o.x ORDER BY 1 LIMIT 1), n + 1 FROM o WHERE o.x IS NOT NULL AND n < ?4),
    c AS (
      SELECT h.id AS id, h.claim AS cl, o.x AS x FROM o, subs h
        WHERE h.rowid IN (SELECT rowid FROM subs WHERE ${ORIGIN} = o.x AND ${NEVER} = 0 AND claim < 0 AND claim >= -?1 ORDER BY claim DESC LIMIT ?2)
      UNION ALL
      SELECT h.id, h.claim, o.x FROM o, subs h
        WHERE h.rowid IN (SELECT rowid FROM subs WHERE ${ORIGIN} = o.x AND ${NEVER} = 1 AND claim < 0 AND claim >= -?1 ORDER BY claim DESC LIMIT ?2))
    SELECT id FROM (SELECT id, cl, row_number() OVER (PARTITION BY x ORDER BY cl DESC, id) AS i FROM c)
    WHERE i <= ?2 ORDER BY i, cl DESC, id LIMIT ?3)
  RETURNING id, endpoint, pend_w, last_w, pend_x, pend_xl, last_x, fails`;
// ?1 now (epoch minutes) ?2 today − 7 ?3 today ?4 limit ?5 FAIL_SLOTS. Together the three claims pick exactly the rows
// rules.js dueKinds() finds due (a test checks), in three passes, so a deadline is never queued behind weekly news and a
// row that failed before never takes the queue from rows that did not:
//   CLAIM_X  rows that never failed (fails = 0) with an expiring due, the nearest end date first, up to what the probes
//            left of the limit — subs_x index, in order, stops at the limit (no sort)
//   CLAIM_W  rows that never failed with the weekly bundle due, up to what is left of the limit: longest wait first,
//            never-sent first — subs_due index (pend_w = 1 rows only), in order, no sort. A row due only for its expiring is
//            always CLAIM_X's (X_DUE holds every such row): CLAIM_X takes all of them unless it fills the limit, and then
//            nothing is left for CLAIM_W anyway
//   CLAIM_F  rows that failed before (fails > 0), at most FAIL_SLOTS of the limit: rows that DID receive a push before
//            first (a real phone with one failure is never queued behind rows that never took a push — planted
//            subscriptions, or brand-new ones), then fewest failures, then longest wait — subs_fail index, in order, no
//            sort. A failing row costs every run at most one of these slots; a row that never received a push is removed
//            after NEVER_DROP failures, or at its first 401/403 (worker.js DROP_FAILING / DROP_REFUSED)
const RETURNS = "RETURNING id, endpoint, pend_w, last_w, pend_x, pend_xl, last_x, fails";
const X_DUE = "(pend_x >= ?3 AND (coalesce(last_x, '') < ?3 OR (pend_w = 1 AND (last_w IS NULL OR last_w <= ?2))))";
const ANY_DUE = "((pend_w = 1 AND (last_w IS NULL OR last_w <= ?2)) OR (pend_x >= ?3 AND coalesce(last_x, '') < ?3))";
// this run's claims so far (claim > 0 names the subs_claim index's own condition, so the count is one range of it)
const LEFT = "?4 - (SELECT count(*) FROM subs WHERE claim > 0 AND claim = ?1)";
export const CLAIM_X = `UPDATE subs SET claim = ?1 WHERE id IN (
    SELECT id FROM subs WHERE pend_x IS NOT NULL AND fails = 0 AND claim IS NULL AND ${X_DUE}
    ORDER BY pend_x LIMIT max(0, ${LEFT}))
  ${RETURNS}`;
export const CLAIM_W = `UPDATE subs SET claim = ?1 WHERE id IN (
    SELECT id FROM subs WHERE pend_w = 1 AND fails = 0 AND claim IS NULL AND (last_w IS NULL OR last_w <= ?2)
    ORDER BY coalesce(last_w, '') ASC LIMIT max(0, ${LEFT}))
  ${RETURNS}`;
export const CLAIM_F = `UPDATE subs SET claim = ?1 WHERE id IN (
    SELECT id FROM subs WHERE (pend_w = 1 OR pend_x IS NOT NULL) AND fails > 0 AND claim IS NULL AND ${ANY_DUE}
    ORDER BY (last_w IS NULL AND last_x IS NULL), fails, coalesce(last_w, '') ASC LIMIT max(0, min(?5, ${LEFT})))
  ${RETURNS}`;

// send run, results (written after every parallel group, src/worker.js send). SENT, RETRY, RELEASE and HOLD touch a row only
// while it still holds THIS run's claim (?7 / ?2 = the run's epoch minute): the first write clears it, so the same batch written
// twice (it committed, but D1's answer was lost and the Worker tried again) changes nothing the second time — no
// double-counted failure. The deletes are the same twice anyway.
// SENT: ?1 id ?2 weekly sent (0/1) ?3 expiring sent (0/1) ?4 today ?5 the claimed pend_x ?6 the claimed pend_xl (its entries
// are now announced: merged into exp_sent, sorted, entries that ended before today dropped — PRUNE_XSENT relies on the order;
// these are the json_each rows a push with an expiring notice reads, ≤ 3 days × 20 + 20) ?7 the claim. last_x = today
// whenever the push carried an expiring notice,
// stand-alone OR riding along with the weekly bundle: so a phone gets at most one push with an expiring notice a day
// (rules.js dueKinds), never a stand-alone one later on the day the weekly bundle carried one
export const SENT = `UPDATE subs SET claim = NULL, fails = 0,
    pend_w = CASE WHEN ?2 THEN 0 ELSE pend_w END,
    last_w = CASE WHEN ?2 THEN ?4 ELSE last_w END,
    exp_sent = CASE WHEN ?3 THEN nullif((SELECT json_group_array(value) FROM (
        SELECT value FROM json_each(coalesce(exp_sent, '[]')) WHERE value >= ?4 UNION SELECT value FROM json_each(coalesce(?6, '[]'))
        ORDER BY 1)), '[]') ELSE exp_sent END,
    pend_x = CASE WHEN ?3 AND pend_x = ?5 THEN NULL ELSE pend_x END,
    pend_xl = CASE WHEN ?3 AND pend_x = ?5 THEN NULL ELSE pend_xl END,
    last_x = CASE WHEN ?3 THEN ?4 ELSE last_x END
  WHERE id = ?1 AND claim = ?7`;
export const GONE = DELETE_SUB;
// a failed try (5xx, 3xx, network; or 401/403 — rules.js outcome): one more consecutive failure. ?2 the claim
export const RETRY = "UPDATE subs SET claim = NULL, fails = fails + 1 WHERE id = ?1 AND claim = ?2";
// ?2 how many in a row remove the row (rules.js RETRY_DROP); ?3 NEVER_DROP for a row that never received a push
export const DROP_FAILING = "DELETE FROM subs WHERE id = ?1 AND (fails >= ?2 OR (fails >= ?3 AND last_w IS NULL AND last_x IS NULL))";
// a 401/403 (after RETRY): ?2 REFUSED_DROP in a row remove the row — and a row that never received a push goes at its FIRST
// refusal (a subscription made under another applicationServerKey is refused for ever; planted ones cost one try)
export const DROP_REFUSED = "DELETE FROM subs WHERE id = ?1 AND (fails >= ?2 OR (last_w IS NULL AND last_x IS NULL))";
// ?2 the claim
export const RELEASE = "UPDATE subs SET claim = NULL WHERE id = ?1 AND claim = ?2";
// ?2 the claim ?3 the epoch minute the row may be tried again: held back, unchanged otherwise (rules.js HOLD). A negative
// claim is never a run's own (that is the run's epoch minute, > 0), so no claim of the queue, no count of a run's claims
// ('LEFT') and no SENT/RETRY/RELEASE ever matches it — only CLAIM_P (a probe) and RELEASE_HELD
export const HOLD = "UPDATE subs SET claim = -?3 WHERE id = ?1 AND claim = ?2";
// ?1 JSON array of the push origins that answered a push 2xx in this run and did not answer 429, in the order their first
// 2xx came (src/worker.js send, in the run's closing batch) ?2 how many at most (the run's SEND_LIMIT). Their held rows that
// received a push before are free again — per origin the longest-waiting first, origin after origin, at most ?2 in all per
// run (8th review: freeing every held row of an origin at once could write up to MAX_SUBS × 2 rows on the day an outage
// ends, on top of that day's pushes; ?2 a run is what the queue sends anyway). The rest follow in the next runs: the freed
// rows go out in queue order, and each run whose pushes get through there frees the next ?2. A row that never received a
// push stays held and comes back as a probe (so planted rows on a real push service cannot ride in on a real phone's 2xx).
// Reads per origin one index range of subs_held (NEVER = 0) that stops after ?2 entries, and stops at ?2 rows in all (no
// sort across origins: with one, every origin's whole range was read and sorted — 6,600 rows for 40 origins on workerd);
// measured ≈ 7 rows read per freed row, ≈ 280 for ?2 = 40, however many rows are held and however many origins.
export const RELEASE_HELD = `UPDATE subs SET claim = NULL WHERE rowid IN (
    SELECT h.rowid FROM json_each(?1) o, subs h
      WHERE h.rowid IN (SELECT rowid FROM subs WHERE ${ORIGIN} = o.value AND ${NEVER} = 0 AND claim < 0 ORDER BY claim DESC LIMIT ?2)
    LIMIT ?2)`;
// ?1 today as yyyymmdd: phones that took our pushes under this key refused it at a push service that took nothing else in the
// run (worker.js send: `suspect`) — GET /health "refusing" for that day and the next, so the daily monitor (09:30 KST) sees
// it from any run since the morning before. Within REFUSING_GRACE_DAYS nobody refused there was removed.
export const STAT_REFUSING = "INSERT INTO stat (k, n) VALUES ('refusing', ?1) ON CONFLICT(k) DO UPDATE SET n = excluded.n";
// ?1 '<tag> <origin>' ?2 today as yyyymmdd (ORIGIN_STATS). STAT_OK_SINCE goes into the SAME results batch as that origin's
// first SENT of the run (src/worker.js send), so a recorded push is never left without its day. STAT_OK_SINCE, STAT_RL and
// CLEAR_RS write nothing when there is nothing to change.
export const STAT_OK_SINCE = "INSERT INTO stat (k, n) VALUES ('ok:' || ?1, ?2) ON CONFLICT(k) DO NOTHING";
// a stretch starts (again) today: only when there is none still going (src/worker.js send)
export const STAT_RS_START = "INSERT INTO stat (k, n) VALUES ('rs:' || ?1, ?2) ON CONFLICT(k) DO UPDATE SET n = excluded.n";
export const STAT_RL = "INSERT INTO stat (k, n) VALUES ('rl:' || ?1, ?2) ON CONFLICT(k) DO UPDATE SET n = excluded.n WHERE n <> excluded.n";
export const CLEAR_RS = "DELETE FROM stat WHERE k IN ('rs:' || ?1, 'rl:' || ?1)";
// ?1 '<tag> ': the refusal stretches of other keys go. Their 'ok:' rows STAY (one small row per push service per key): one run
// with a wrong key must not erase the day the right key first went through — after going back, the phones it reached would
// otherwise all look like old-key subscriptions
export const DROP_OTHER_TAGS = "DELETE FROM stat WHERE ((k >= 'rl:' AND k < 'rl;') OR (k >= 'rs:' AND k < 'rs;')) AND substr(k, 4, 13) <> ?1";
export const SAVE_JWT = "INSERT INTO vapid (aud, jwt, exp) VALUES (?1, ?2, ?3) ON CONFLICT(aud) DO UPDATE SET jwt = excluded.jwt, exp = excluded.exp";
export const DROP_OLD_JWT = "DELETE FROM vapid WHERE exp < ?1";
