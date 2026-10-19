-- Price alerts (가격 알림) — D1 database yoonsiljang-alerts, binding DB. STRICT tables. Dates are KST 'YYYY-MM-DD' text;
-- no names/phones/e-mails, no IP or user agent, no user-side times, and NO per-subscription 'last used' date: a subscription
-- row stays until it is deleted (DELETE, PUT with no rules, the push service says 404/410, or repeated failures — see
-- src/worker.js). The one clock value is subs.claim: a server send time kept only while sending (cleared when the push is
-- done, and by every send run once it is older than 15 minutes), or — negative — the minute from which a row held back after
-- a push-service problem may be tried again (src/rules.js HOLD: cleared when it is tried again as a probe, a few a run, or
-- when that push service answers a push 2xx).
-- Applied by .github/workflows/cf-alerts.yml (wrangler d1 migrations apply DB --remote) before every deploy.

-- one row per phone (push subscription). The id is the only key the phone holds: whoever has it may change the rules.
CREATE TABLE subs (
  id TEXT PRIMARY KEY,               -- 128 random bits, base64url (22)
  endpoint TEXT NOT NULL UNIQUE,     -- push service URL (allow-listed hosts only, no #fragment, ≤ 1024)
  rules TEXT NOT NULL,               -- normalized JSON [{kind,key,max?,region?}], 1–20 (a PUT with none deletes the row)
  pend_w INTEGER NOT NULL DEFAULT 0, -- weekly bundle has news to send (reset when the rules change)
  last_w TEXT,                       -- day the last weekly bundle went out (7-day rule; kept when the rules change)
  pend_x TEXT,                       -- earliest end date of a saved price about to end, not announced yet (expiring)
  pend_xl TEXT,                      -- the 'end date|key|region' list behind pend_x, JSON; moves to exp_sent when sent
  exp_sent TEXT,                     -- sorted JSON list of 'end date|key|region' already announced (never the same one
                                     -- twice); passed end dates are removed by the factory's finish (and at the next send)
  last_x TEXT,                       -- day of the last push that carried an expiring notice, stand-alone or riding along
                                     -- with the weekly bundle (at most one such push a day)
  fails INTEGER NOT NULL DEFAULT 0,  -- consecutive failed pushes (a 5xx/timeout counts only when that push service answered
                                     -- another push 2xx in the same run): 10 → removed, 3 when the last was a 401/403, 3 when
                                     -- the row never received a push at all (last_w and last_x empty); a never-pushed row
                                     -- is removed at its FIRST 401/403 (a key mismatch never heals). Where OUR setup may be
                                     -- broken (src/worker.js send: a phone that took our pushes under this key refuses and
                                     -- that push service took nothing else in the run) nobody is removed for up to
                                     -- REFUSING_GRACE_DAYS, and a row that took a push before is not even counted there
  claim INTEGER                      -- server send time (epoch minutes) while a send run holds the row; minus the epoch
                                     -- minute from which it may be tried again while it is held back (a push service
                                     -- refused our token where our setup may be broken, was down, or said 429:
                                     -- src/rules.js HOLD); NULL otherwise
) STRICT;
-- partial indexes: only rows with something to send, in the order the send runs take them. subs_due: rows with the weekly
-- bundle pending that never failed (fails = 0), longest wait first, never-sent first (CLAIM_W; a row due only for an expiring
-- is CLAIM_X's, subs_x). Keeping pend_x out of its WHERE also keeps the factory's expiring marks cheaper in D1 rows
-- written (src/worker.js arithmetic). subs_fail: rows that failed before (CLAIM_F, a few
-- slots per run): rows that DID receive a push before come first (a real phone with one failure), rows that never received
-- one after them (new, or planted), then fewest failures, then longest wait. An empty cron run reads almost nothing and a
-- full one stops after its rows without sorting.
CREATE INDEX subs_due ON subs(fails, coalesce(last_w, '')) WHERE pend_w = 1;
CREATE INDEX subs_fail ON subs((last_w IS NULL AND last_x IS NULL), fails, coalesce(last_w, '')) WHERE fails > 0 AND (pend_w = 1 OR pend_x IS NOT NULL);
-- the few rows a send run holds right now (claim > 0: stale claims and a run's own count go through this, not a scan)
CREATE INDEX subs_claim ON subs(claim) WHERE claim > 0;
-- the rows held back (claim < 0), per push origin (the same expression as src/sql.js ORIGIN), rows that received a push
-- before apart from rows that never did, then the minute they may be tried again: the probes take a few per origin and a
-- release a few per run, each an index range that stops after its share — never a walk over every held row (8th review:
-- reading them all cost ~4 rows per held row in each of 77 runs, and the held rows are not bounded below MAX_SUBS)
CREATE INDEX subs_held ON subs(substr(endpoint, 1, 7 + instr(substr(endpoint, 9), '/')), (last_w IS NULL AND last_x IS NULL), claim) WHERE claim < 0;
-- expiring rows: fails FIRST, then the end date, so the send run claims the nearest deadline among rows that never failed
-- (CLAIM_X: fails = 0, in index order) and a failing row can never hold the front of the queue; DROP_ENDED scans it
CREATE INDEX subs_x ON subs(fails, pend_x) WHERE pend_x IS NOT NULL;

-- the (treatment key, region) pairs someone watches. No link to any person.
-- m/n/med = the baseline the phones were last marked against; p = 1 with pm/pn/pmed = newer numbers from the published
-- data.json that FINISH has not consumed yet (sticky: a failed finish or a failed later digest chunk keeps them; FINISH
-- promotes them to the baseline in the same batch that marks the phones). bu = the collection date (data.json meta.updated)
-- of the baseline: within one collection the baseline only moves the good way, and a change the bad way (fewer branches,
-- higher lowest price, higher median) from a NEW collection is taken only when the collection after it shows it again
-- (cb/cu remember what the last collection showed: src/sql.js DIGEST). Numbers are the clinics' listed prices (병원
-- 표시가, the app's alert engine basis). e/s/u = expiring, recomputed by every factory run. g = the day the key's rows were
-- last regrouped (data.json meta.recl): a NEWER g re-bases the pair without news, like the app's own checkAlerts (g never goes back).
-- added = the KST day (Worker clock) the pair was first computed: the factory's list keeps it for src/rules.js PAIR_KEEP_DAYS
-- (src/sql.js WATCHED). About a (treatment, region) pair, never a person.
CREATE TABLE snap (
  k TEXT NOT NULL,
  r TEXT NOT NULL,                   -- '' = nationwide, '수도권' = 서울+경기+인천, else one 시·도
  m INTEGER,                         -- baseline lowest price (per-branch lowest)
  n INTEGER NOT NULL,                -- baseline branches with a price
  med INTEGER,                       -- baseline median (Stats.median)
  p INTEGER NOT NULL DEFAULT 0,      -- 1 = pm/pn/pmed differ from the baseline and wait for FINISH
  pm INTEGER,
  pn INTEGER,
  pmed INTEGER,
  bu TEXT NOT NULL,                  -- collection date (meta.updated) of the baseline
  pu TEXT,                           -- collection date of the pending numbers when it is not bu
  cb INTEGER NOT NULL DEFAULT 0,     -- which numbers the last NEW collection moved the bad way and were held back: 1 = m, 2 = n, 4 = med
  cu TEXT,                           -- that collection's date (a held-back move is taken when the NEXT collection shows it too)
  qm INTEGER,                        -- q = unfinished pending numbers (their finish failed) that a later digest moved on
  qn INTEGER,                        -- from: that digest was computed against them, and the next finish marks baseline → q
  qmed INTEGER,                      -- and q → pending (src/sql.js DIGEST V, MARK_WEEKLY)
  g TEXT NOT NULL DEFAULT '',        -- regroup day of the key (meta.recl) the baseline belongs to
  run TEXT NOT NULL,                 -- 'updated|day' of the factory run that last wrote the row (unwatched pairs are pruned)
  added TEXT NOT NULL DEFAULT '',    -- KST day the pair was first computed (never updated)
  e INTEGER,                         -- expiring: lowest price ending within 3 days
  s INTEGER,                         -- expiring: lowest price that stays after that
  u TEXT,                            -- expiring: end date of e
  PRIMARY KEY (k, r)
) STRICT;

-- the compare keys of the data.json the factory last read (notify.mjs → POST /v1/internal/keys, on every run after a deploy,
-- before it asks for the watched pairs): ONE row, a JSON array in ascending order (src/rules.js keySetJson), rewritten only
-- when the set changes (src/sql.js SET_KEYS: a few rows written a week). The factory computes only those keys, so the
-- watched list ranks only pairs whose key is in it (src/sql.js WATCHED). Subscribe/PUT store a rule whose key is not in it
-- and answer as for any rule (its pair waits until a later key set holds the key). Public treatment keys
-- only — nothing about a person. INTEGER PRIMARY KEY: no separate index.
CREATE TABLE keyset (id INTEGER PRIMARY KEY CHECK (id = 1), keys TEXT NOT NULL) STRICT;

-- VAPID JWT per push origin (a signed token, not a secret; 12 h). Re-signed only when < 1 h is left.
CREATE TABLE vapid (aud TEXT PRIMARY KEY, jwt TEXT NOT NULL, exp INTEGER NOT NULL) STRICT;

-- counters, so subscribe never counts the table (D1 bills rows read):
--   'subs'            subscriptions now (MAX_SUBS cap; GET /health "capacity" is computed from it)
--   'new:YYYY-MM-DD'  new subscriptions that KST day (NEW_PER_DAY budget; FINISH removes past days)
--   'day'             the Worker's own KST day (yyyymmdd) of the last subscribe call: the Worker writes it in the same D1
--                     batch right before the INSERT, and the subs_ins trigger names today's counter from it (no row holds a date)
--   'finish'          KST day (yyyymmdd, the Worker's clock) of the last factory finish (GET /health "finished")
--   'data'            the prices that finish was computed from: the first 52 bits of their fingerprint (notify.mjs
--                     fingerprint; no row = not told). With 'finish' a start of the same prices the same day is 'done'
--   'lease'           epoch ms a computation started (one at a time; its finish deletes it, else it runs out after 15
--                     minutes); 'fc' the UTC day × 100 + computations counted that D1 day (COMPUTES_PER_DAY) — src/sql.js
--                     START_STATE, TAKE_LEASE, COUNT_COMPUTE. 'ln' / 'lf' the nonce (52 random bits) and the fingerprint's
--                     tag the lease was taken with (a lost start answer sent again gets the same lease; a retry of the same
--                     prices); 'fr' the UTC day of that day's one uncounted retry; 'cfail' the UTC day a computation was
--                     found dead (its lease ran out — GET /health "compute": "failed"); 'fd' the UTC day × 10 + 1 once a
--                     factory run was told it was deferred that day (× 10 + 0: only a catch-up) — GET /health "compute":
--                     "deferred", one Telegram line a D1 day (src/sql.js LEASE_OF, MARK_RETRY, STAT_CFAIL, STAT_DEFERRED)
--   'refusing'        KST day (yyyymmdd) of the last send run in which phones that took our pushes refused our VAPID
--                     token at a push service that took nothing else (GET /health "refusing" that day and the next)
--   'capped'          KST day (yyyymmdd) the factory's watched list was last cut at PAIR_CAP (GET /health "pairs")
--   'ok:<tag> <origin>'  per push-service origin, for the VAPID key whose public key starts with <tag> (12 characters):
--                     the first KST day that origin took a push signed with it (kept when the key changes: one row per
--                     origin per key); 'rs:<tag> <origin>' / 'rl:<tag> <origin>' the first / last day of the current
--                     stretch of refusals there that may be our own setup's fault (src/sql.js ORIGIN_STATS).
--                     Push-service hosts only — nothing about a person
CREATE TABLE stat (k TEXT PRIMARY KEY, n INTEGER NOT NULL) STRICT;
INSERT INTO stat (k, n) VALUES ('subs', 0);
CREATE TRIGGER subs_ins AFTER INSERT ON subs BEGIN
  UPDATE stat SET n = n + 1 WHERE k = 'subs';
  INSERT INTO stat (k, n) SELECT 'new:' || substr(d.n, 1, 4) || '-' || substr(d.n, 5, 2) || '-' || substr(d.n, 7, 2), 1
    FROM stat AS d WHERE d.k = 'day'
  ON CONFLICT(k) DO UPDATE SET n = n + 1;
END;
CREATE TRIGGER subs_del AFTER DELETE ON subs BEGIN UPDATE stat SET n = n - 1 WHERE k = 'subs'; END;
