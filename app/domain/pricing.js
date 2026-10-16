// Price calculation domain logic, independent of the UI (requirement 4.3). Loaded as window.Pricing in the app and
// with require() in tests (tests/pricing.test.js). No DOM, no globals; prices are integer KRW.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Pricing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- VAT: listed price → price on the chosen basis. vat: 0 unknown · 1 포함 · 2 별도. mode: "incl" | "listed"
  function vatPrice(listed, vat, mode) {
    return mode === "incl" && vat === 2 ? Math.round(listed * 1.1) : listed;
  }

  // ---- event end date: "YYYY-MM-DD" before today (also "YYYY-MM-DD") = over; other values ('', 'posted:…') never expire
  function isExpired(until, today) {
    return /^\d{4}-\d{2}-\d{2}$/.test(until || "") && until < today;
  }
  // the chosen visit falls after the event's end date (until 'YYYY-MM-DD' < visit date): the price is still listed (pages often
  // set one period for every price and the factory reads a new one each week) but may be over by then — '기간 확인 필요'
  // (user decision 2026-10-16: mark it, do not drop it)
  function periodOver(until, when) {
    return !!(when && when.date) && /^\d{4}-\d{2}-\d{2}$/.test(until || "") && until < when.date;
  }

  // ---- visit date/time conditions
  // Public holidays incl. substitute days, compiled 2026-10-13 (verify against the government notice; see docs).
  const KR_HOLIDAYS = {
    "2026-12-25": "성탄절", "2027-01-01": "신정", "2027-02-05": "설 연휴", "2027-02-06": "설날", "2027-02-07": "설 연휴",
    "2027-02-08": "대체공휴일", "2027-03-01": "삼일절", "2027-05-05": "어린이날", "2027-05-13": "부처님오신날", "2027-06-06": "현충일",
  };
  // '[평일5시이전]' / '평일 오후 2시 이전' → minutes from midnight (hours 1–8 read as afternoon); null = not stated
  function parseCutoff(name) {
    const m = /(?:평일|프라임)[^0-9]{0,8}(\d{1,2})\s*시\s*(\d{1,2}\s*분)?\s*(?:이전|전|까지)/.exec(name || "");
    if (!m) return null;
    let hr = +m[1];
    if (hr >= 1 && hr <= 8) hr += 12;
    return hr * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  }
  // ---- the site's own visit days and hours: data.json row fields 16 days · 17 hours (C #71, 2026-10-16).
  // days = weekday bits 월=1 화=2 수=4 목=8 금=16 토=32 일=64 (0 = not stated; all seven days is 0 too); hours = 'HH:MM-HH:MM'
  // (24h, the end not included; 'N시 이전' = '00:00-HH:MM', 'N시 이후' = 'HH:MM-24:00') or ''. Files from before have 16 or
  // fewer fields, so neither: checked once per file, like Classify.hasAddonField.
  const WHEN_FIELD = 17;
  const hasWhenFields = (d) => !!d && (Array.isArray(d.cols) ? d.cols.length > WHEN_FIELD
    : Array.isArray(d.rows) && Array.isArray(d.rows[0]) && d.rows[0].length > WHEN_FIELD);
  const ALL_DAYS = 127, WEEKDAYS = 31, WEEKEND = 96;
  // 'HH:MM-HH:MM' → one number, start × 10000 + end in minutes from midnight (0 = no window, the whole day, or unreadable)
  function hoursCode(text) {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(text || "");
    if (!m) return 0;
    const from = +m[1] * 60 + +m[2], to = +m[3] * 60 + +m[4];
    return from < to && to <= 1440 && to - from < 1440 ? from * 10000 + to : 0;
  }
  // hours as text or as hoursCode → [from, to] in minutes, or null
  const hoursWin = (x) => { const c = typeof x === "string" ? hoursCode(x) : x > 0 ? x : 0; return c ? [Math.floor(c / 10000), c % 10000] : null; };
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  // days → the words on screen: 31 '평일', 96 '주말', 14 '화·수·목', 95 '평일·일요일'; 0 and all seven days → '' (no day limit)
  const DAY_NAMES = "월화수목금토일";
  function dayList(days) {
    const d = (days || 0) & ALL_DAYS;
    if (!d || d === ALL_DAYS) return "";
    if ((d & WEEKDAYS) === WEEKDAYS) return ["평일", d & 32 ? "토요일" : "", d & 64 ? "일요일" : ""].filter(Boolean).join("·");
    if (d === WEEKEND) return "주말";
    return [...DAY_NAMES].filter((_, k) => (d >> k) & 1).join("·");
  }
  const dayWords = (dl) => (dl.length === 1 ? `${dl}요일` : dl);     // one day reads '토요일'
  // the price sheet's lines for what the site wrote: ['되는 요일: 화·수·목', '되는 시간: 12:00~15:00'] (nothing guessed);
  // a window from midnight reads '16:00 이전', one to midnight '18:00 이후' (the site's own 'N시 이전/이후')
  function whenLines(days, hours) {
    const out = [], dl = dayList(days), w = hoursWin(hours);
    if (dl) out.push(`되는 요일: ${dayWords(dl)}`);
    if (w) out.push(`되는 시간: ${w[0] === 0 ? `${hhmm(w[1])} 이전` : w[1] === 1440 ? `${hhmm(w[0])} 이후` : `${hhmm(w[0])}~${hhmm(w[1])}`}`);
    return out;
  }
  // a price the site limits to some weekdays or hours is not a plain price, with or without a condition tag (B, 2026-10-16:
  // C #71 left the ~420 untagged ones, e.g. '토요일이벤트', to the app)
  const whenLimited = (days, hours) => { const d = (days || 0) & ALL_DAYS; return (d !== 0 && d !== ALL_DAYS) || !!hoursWin(hours); };

  // tags: "평일 낮·시간대·일요일·…" ; when: {date: "YYYY-MM-DD", time: "HH:MM" | ""} or null ; opt: {days, hours, holidays}
  // (the site's days bits and hours as text or hoursCode) — or, the older call shape, the holiday table itself.
  // returns 0 ok · 1 not valid on that visit · 2 valid by day but the app doesn't know the time window (check with the clinic).
  // - days stated: only those weekdays; a weekday-only price (no 토·일 bit, or no days and '평일 낮') not on a public holiday.
  //   '시간대' (C #83: a time window not limited to weekdays) with no days: any day.
  // - a visit time with the hours known: inside [from, to) ok, outside 1. Hours not known: '평일 낮' reads a '…시 이전' cutoff
  //   from the name, '평일 낮'/'시간대' are 2 unless the name says the hour does not matter ('[화수목 해피아워] 시간 상관 없이 …'),
  //   '타임세일' is 2.
  const ANY_TIME = /시간\s*(상관\s*(없이|없음|없는)|무관)/;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function condState(tags, name, when, opt) {
    const o = opt && typeof opt === "object" && (own(opt, "days") || own(opt, "hours") || own(opt, "holidays")) ? opt : { holidays: opt };
    const days = (o.days || 0) & ALL_DAYS, win = hoursWin(o.hours), holidays = o.holidays || KR_HOLIDAYS;
    const t = tags ? tags.split("·") : [];
    if (!when || !when.date || (!t.length && !days && !win)) return 0;
    const day = new Date(when.date + "T12:00:00Z").getUTCDay();      // 0 = Sunday
    const holiday = !!holidays[when.date];
    const wk = t.includes("평일 낮"), slot = t.includes("시간대");
    if (days && days !== ALL_DAYS) {
      if (!((days >> ((day + 6) % 7)) & 1)) return 1;               // bit 0 = Monday
      if (holiday && !(days & WEEKEND)) return 1;
    } else if (wk && (day === 0 || day === 6 || holiday)) return 1;
    if (t.includes("일요일") && day !== 0) return 1;
    if (!when.time) return 0;
    const [hh, mm] = when.time.split(":").map(Number), at = hh * 60 + mm;
    if (win) return at >= win[0] && at < win[1] ? 0 : 1;
    let state = 0;
    if (wk) {
      const cut = parseCutoff(name);
      if (cut != null) { if (at >= cut) return 1; } else if (!ANY_TIME.test(name || "")) state = 2;
    }
    if (slot && !ANY_TIME.test(name || "")) state = 2;
    if (t.includes("타임세일")) state = 2;
    return state;
  }
  // condition tag → the words on its badge. The tag is the id shared with the data build (build2/clean.py TAGS) and
  // condState above, so only the screen text changes here. '평일 낮' marks weekday-only prices (평일 낮·화수목·평일 해피아워…),
  // '시간대' (C #83) a time window on any day or on days with 토·일 — never '한정' in its words (the price sheet drops those).
  const COND_LABEL = { "평일 낮": "평일·시간 한정", "시간대": "정해진 시간만" };
  function condLabel(tag) {
    return own(COND_LABEL, tag) ? COND_LABEL[tag] : tag;
  }
  // the badge's title: what the tag means, after the days/hours the site wrote when there are any; '' for other tags
  const COND_HINT = {
    "평일 낮": "평일 중 정해진 요일·시간에만 되는 가격이에요(평일 낮·화수목·평일 해피아워 등). 정확한 요일·시간은 병원에 확인하세요",
    "시간대": "정해진 시간에만 되는 가격이에요. 되는 요일은 앱이 알지 못해요 — 병원에 확인하세요",   // C 2026-10-16: not 'not on the site' — some pages could not be re-read
  };
  const WHEN_HINT = "사이트에 적힌 요일·시간에만 되는 가격이에요. 병원에 확인하세요";
  function condTitle(tag, days, hours) {
    const lines = whenLines(days, hours);
    let t = tag ? (own(COND_HINT, tag) ? COND_HINT[tag] : "") : WHEN_HINT;
    if (!t) return "";
    if (tag === "시간대" && dayList(days)) t = "정해진 시간에만 되는 가격이에요. 병원에 확인하세요";   // the site did write the days
    return lines.length ? `${lines.join(", ")}. ${t}` : t;
  }
  // badge of a row whose days/hours have no condition tag saying so: '토요일만', '화·수·목만', '평일만'; hours only '정해진 시간만'.
  // Days and hours both: the badge of the tag C #83 gives such a row, so the hours are not hidden behind '평일만' —
  // weekdays only '평일·시간 한정' ('평일 낮'), days with 토·일 '정해진 시간만' ('시간대'); the title lists both
  function whenBadge(days, hours) {
    const d = (days || 0) & ALL_DAYS, dl = dayList(d), w = hoursWin(hours);
    if (dl && w) return COND_LABEL[d & WEEKEND ? "시간대" : "평일 낮"];
    if (dl) return `${dayWords(dl)}만`;
    return w ? COND_LABEL["시간대"] : "";
  }

  // ---- why a price is conditional (B, 2026-10-16 — the user: ask whether the person had the treatment before, and when
  // they will visit). One price row → "once", "repeat" or "" (a plain price); a row with both reasons is "once".
  // - "once": one time per person — kind 1 체험가, kind 2 한정가, the tags '첫 방문' and '1인 1회', and '타임세일': every such
  //   row in the data is a 체험가/한정가 that ends within days (a short sale, not an hour of the day — the hours of a time
  //   window come as '시간대' or the site's hours). A tag the app does not know is "once" too: never repeated on a guess.
  // - "repeat": a visit day / time only — the tags '평일 낮', '시간대', '일요일', or days / hours the site wrote with no tag
  //   ('토요일이벤트'). The visit date (condState) decides whether it applies, and when it does it is the same price every visit.
  // kind = row field 5, tags = '평일 낮·첫 방문' (field 6), days / hours as in whenLimited.
  const ONCE_TAGS = ["첫 방문", "1인 1회", "타임세일"], REPEAT_TAGS = ["평일 낮", "시간대", "일요일"];
  function condClass(kind, tags, days, hours) {
    const t = tags ? tags.split("·").filter(Boolean) : [];
    if (kind === 1 || kind === 2 || t.some((x) => !REPEAT_TAGS.includes(x))) return "once";
    return t.length || whenLimited(days, hours) ? "repeat" : "";
  }

  // ---- one cart line: q sessions of one item at one branch
  // cands / regular: [{i, p, special, repeat}] (regular = cands without special prices; repeat = a special whose condition is
  // the visit day / time only, condClass "repeat" — a special without it counts as once); override: {i, p, sess, special, repeat}
  // chosen by the user. At the same price a plain price wins, then a repeat one, then a once one (so a tie never reads as
  // '체험가 첫 회 + …' and is never counted as a first-visit line by limitOnce).
  const rank = (x) => (!x.special ? 0 : x.repeat ? 1 : 2);
  const better = (a, b) => !b || a.p < b.p || (a.p === b.p && rank(a) < rank(b));
  function cheapest(list) {
    let best = null;
    for (const x of list) if (better(x, best)) best = x;
    return best;
  }
  const isOnce = (x) => !!x.special && !x.repeat;
  // the person had this treatment before (cart item switch '전에 이 시술을 받아 봤어요'): once prices are not theirs any more
  const withoutOnce = (list) => list.filter((x) => !isOnce(x));
  // a once price counts once; later sessions use the cheapest price that repeats: a regular one, or one whose only condition
  // is the visit day / time (repeat — the visit date filter checks that condition, and it holds on every such visit, so
  // a repeat price alone is q × its price). Whether a once price can be repeated is not known from the clinic page, so with
  // NO repeating price the later sessions stay unpriced — never the once price × q (round-2 R14: 100원 special ×3 was shown
  // as a firm 300원), also when the user picked that once price for the branch. An incomplete line is not a total anyone
  // can compare. Line flags: laterOther = a once price first, later sessions at another price (laterRegular: a plain one);
  // repeat = the sessions after the first (all of them when there is one row) are at a visit day / time price.
  function onceThen(first, again, q, extra) {
    if (!again) return { total: first.p, rows: [first.i], units: 1, ...extra, special: true, unpriced: q - 1, incomplete: true };
    return { total: first.p + again.p * (q - 1), rows: [first.i, again.i], units: q, ...extra, special: true,
      laterOther: true, laterRegular: !again.special, repeat: !!(again.special && again.repeat) };
  }
  function lineCost(cands, regular, q, override) {
    q = Math.max(1, q || 1);
    const repeating = () => cheapest([...regular, ...cands.filter((x) => x.special && x.repeat)]);
    if (override) {
      // a once price picked for one session: still the first session only (a package or a pass is its own price)
      if (q > 1 && isOnce(override) && (override.sess || 1) <= 1) return onceThen(override, repeating(), q, { ov: true });
      const units = override.sess >= 99 ? 1 : Math.ceil(q / Math.max(1, override.sess || 1));
      return { total: override.p * units, rows: [override.i], units, ov: true, special: !!override.special, repeat: !!(override.special && override.repeat) };
    }
    const first = cheapest(cands);
    if (!first) return null;
    if (q === 1) return { total: first.p, rows: [first.i], units: 1, special: !!first.special, repeat: !!(first.special && first.repeat) };
    if (isOnce(first)) return onceThen(first, repeating(), q, {});
    // a plain or repeat price first: it repeats itself, so the cheapest repeating price is that same price
    const rest = repeating() || first;
    return { total: first.p + rest.p * (q - 1), rows: first.i === rest.i ? [first.i] : [first.i, rest.i], units: q, special: !!first.special,
      laterOther: false, laterRegular: false, repeat: !!(rest.special && rest.repeat) };
  }

  // ---- whole cart across branches
  // matrix: [{b, lines: [line | null per item]}]. Missing prices are never counted as 0.
  // returns full (every item priced, cheapest first), partial (some items), mix (each item at its cheapest branch,
  // ties go to a branch already on the route), pair (best two-branch plan), savings vs the best single branch.
  function compareClinics(matrix) {
    const m = matrix.length ? matrix[0].lines.length : 0;
    const full = [], partial = [];
    const priced = (l) => l && !l.incomplete;          // an incomplete line (later sessions unpriced) is not counted as a price
    for (const row of matrix) {
      const have = row.lines.filter(priced);
      const total = have.reduce((s, l) => s + l.total, 0);
      const out = { b: row.b, total, lines: row.lines, n: have.length, missing: row.lines.map((l, j) => (priced(l) ? -1 : j)).filter((j) => j >= 0) };
      if (m && have.length === m) full.push(out);
      else if (have.length) partial.push(out);
    }
    full.sort((x, y) => x.total - y.total);
    partial.sort((x, y) => y.n - x.n || x.total - y.total);
    // mix: two passes so ties prefer branches already chosen for another item
    const picks = [];
    for (let j = 0; j < m; j++) {
      let best = null;
      for (const row of matrix) { const l = row.lines[j]; if (priced(l) && (!best || l.total < best.line.total)) best = { b: row.b, line: l }; }
      picks.push(best);
    }
    const chosen = new Set(picks.filter(Boolean).map((p) => p.b));
    for (let j = 0; j < m; j++) {
      const p = picks[j];
      if (!p) continue;
      for (const row of matrix) { const l = row.lines[j]; if (priced(l) && l.total === p.line.total && row.b !== p.b && chosen.has(row.b)) { picks[j] = { b: row.b, line: l }; break; } }
    }
    const mixTotal = picks.reduce((s, p) => s + (p ? p.line.total : 0), 0);
    const mix = { picks, total: mixTotal, places: new Set(picks.filter(Boolean).map((p) => p.b)).size, missing: picks.filter((p) => !p).length };
    // best plan with at most two branches (both actually used)
    let pair = null;
    for (let x = 0; x < matrix.length; x++) for (let y = x + 1; y < matrix.length; y++) {
      const A = matrix[x], B = matrix[y];
      let total = 0, ok = true, useA = 0, useB = 0;
      const assign = [];
      for (let j = 0; j < m; j++) {
        const la = priced(A.lines[j]) ? A.lines[j] : null, lb = priced(B.lines[j]) ? B.lines[j] : null;
        if (!la && !lb) { ok = false; break; }
        if (la && (!lb || la.total <= lb.total)) { total += la.total; useA++; assign.push(A.b); } else { total += lb.total; useB++; assign.push(B.b); }
      }
      if (ok && useA && useB && (!pair || total < pair.total)) pair = { a: A.b, b: B.b, total, assign };
    }
    if (pair && full.length && pair.total >= full[0].total) pair = null;     // two visits only if it saves money
    return { full, partial, mix, pair, savings: full.length && !mix.missing ? full[0].total - mix.total : null };
  }

  // ---- 'first visit' prices are often one per visit: keep at most one such line per branch (the one that saves most);
  // the others fall back to their next price (recompute(j) = the line without first-visit rows). A line with no fallback
  // stays but is flagged, because the clinic may not allow it.
  function limitOnce(lines, onceFlags, recompute) {
    const idx = lines.map((l, j) => (l && onceFlags[j] ? j : -1)).filter((j) => j >= 0);
    if (idx.length <= 1) return lines.map((l) => l);
    const alt = new Map(idx.map((j) => [j, recompute(j)]));
    const saving = (j) => (alt.get(j) ? alt.get(j).total : Infinity) - lines[j].total;
    const keep = idx.reduce((a, j) => (saving(j) > saving(a) ? j : a), idx[0]);
    return lines.map((l, j) => {
      if (!alt.has(j) || j === keep) return l;
      const a = alt.get(j);
      return a ? { ...a, restacked: true } : { ...l, stackWarn: true };
    });
  }

  // ---- clinic package vs. the cart (mode C). name: package option name ('슈링크 300샷 + 리쥬란 2cc'),
  // items: [{fam: RegExp for the procedure family, spec: '300샷' | '', key: comparison id | undefined}],
  // partKeys: per '+' part, the comparison ids that part is (from build2 xkeys rules, 'X12;X24'), norm: Search.norm.
  // Each item: 'match' (the part is the same procedure: same key, or same family and amount), 'spec' (same family,
  // different amount/area/product), 'check' (same family, nothing to compare). extras = parts matching no cart item.
  function matchPackage(name, items, norm, partKeys = "") {
    const parts = (name || "").split(/\s*\+\s*/).map((s) => s.replace(/\[[^\]]*\]\s*/g, "").trim());
    const keysOf = partKeys ? partKeys.split(";").map((s) => s.split(",").filter(Boolean)) : [];
    const used = new Set();
    const matched = [];
    items.forEach((it, j) => {
      let k = it.key ? parts.findIndex((p, n) => !used.has(n) && (keysOf[n] || []).includes(it.key)) : -1;
      if (k < 0) k = parts.findIndex((p, n) => p && !used.has(n) && it.fam.test(p));
      if (k < 0) return;
      used.add(k);
      let state;
      if (it.key && keysOf.length) state = (keysOf[k] || []).includes(it.key) ? "match" : "spec";
      else {
        const pn = norm(parts[k]);
        const amount = /\d+(샷|cc|u|kj)/.exec(pn);
        state = !it.spec ? "check" : pn.includes(norm(it.spec)) ? "match" : amount ? "spec" : "check";
      }
      matched.push({ j, state, part: parts[k] });
    });
    const extras = parts.filter((p, n) => p && !used.has(n));
    return { parts, matched, extras, full: matched.length > 0 && matched.every((m) => m.state === "match") && !extras.length };
  }

  // a public holiday on Mon-Fri: its name, else ''. condState leaves weekend-only prices out that day ('그 요일만'); some clinics
  // do take weekend prices on holidays, so the screen says so and asks to check with the clinic (user decision 2026-10-16)
  function weekdayHoliday(date, holidays = KR_HOLIDAYS) {
    if (typeof date !== "string" || !Object.prototype.hasOwnProperty.call(holidays, date)) return "";
    const d = new Date(date + "T12:00:00Z").getUTCDay();
    return d >= 1 && d <= 5 ? holidays[date] : "";
  }
  // days with only Saturday/Sunday bits (no weekday bit): the rows a weekday holiday leaves out only because of their days
  const weekendOnly = (days) => { const d = (days || 0) & ALL_DAYS; return d !== 0 && (d & 31) === 0; };

  return { weekdayHoliday, weekendOnly, periodOver, vatPrice, isExpired, KR_HOLIDAYS, parseCutoff, WHEN_FIELD, hasWhenFields, hoursCode, dayList, whenLines, whenLimited, condState,
    condLabel, condTitle, whenBadge, ONCE_TAGS, REPEAT_TAGS, condClass, cheapest, isOnce, withoutOnce, lineCost, compareClinics, limitOnce, matchPackage };
});
