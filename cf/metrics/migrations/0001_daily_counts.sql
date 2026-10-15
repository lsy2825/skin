-- One row per (KST day, stage) holding only a count. There is deliberately no column that could hold an IP, a device,
-- a cookie or a time of day: at most 8 rows a day. (Cloudflare's own D1 point-in-time backup can still restore the table as
-- it was at a given minute; that reveals at most when a count changed, never who sent it.) The stage list must equal STAGES in src/rules.js (tests check it).
-- WITHOUT ROWID: the primary key is the table, so the first write of a day costs 1 written row instead of 2 (no extra index).
CREATE TABLE daily_counts (
  day   TEXT    NOT NULL CHECK (length(day) = 10),
  stage TEXT    NOT NULL CHECK (stage IN ('open', 'first_price', 'compare_open', 'keep_cart', 'keep_fav', 'keep_alert', 'cart_open', 'return_7d')),
  n     INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (day, stage)
) WITHOUT ROWID;
