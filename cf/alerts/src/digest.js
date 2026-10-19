// One (treatment key, region) pair against the published data → the digest entry the factory sends to the Worker.
// Runs on the factory runner (notify.mjs), never in the Worker (the Worker must not read the 15 MB data.json).
// The entry carries numbers only; whether they are news is decided in D1 (src/sql.js DIGEST/MARK_WEEKLY) against the stored
// baseline, so a skipped day, a code-only rebuild or a failed run compares right and never sends the same news twice.
import { EXPIRING_DAYS, addDays, DAY_RE } from "./rules.js";

// prices(k, r) → per-branch lowest prices of the published rows (app price basis, NOT filtered by event end date: the
// baseline changes only when the factory publishes a new data.json, never because a day passed).
// rowsFor(k, r) → [{p, until}] rows still running today (for expiring). median: Stats.median (app/domain/stats.js).
export function pairStats({ prices, rowsFor, median, k, r, today }) {
  const ps = prices(k, r);
  const entry = { k, r, m: ps.length ? Math.min(...ps) : null, n: ps.length, med: ps.length ? median(ps) : null };
  // expiring: the lowest running price ending within 3 days (e, its end date u) and the lowest that stays after (s).
  // Undated, 9999-12-31 and 'posted:…' rows count as staying.
  const last = addDays(today, EXPIRING_DAYS);
  let e = null, u = null, s = null;
  for (const row of rowsFor(k, r)) {
    const ends = DAY_RE.test(row.until || "") && row.until >= today && row.until <= last;
    if (ends) { if (e === null || row.p < e || (row.p === e && row.until < u)) { e = row.p; u = row.until; } }
    else if (s === null || row.p < s) s = row.p;
  }
  if (e !== null) Object.assign(entry, { e, u, s });
  return entry;
}
