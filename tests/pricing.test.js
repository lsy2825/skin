// node --test tests/*.test.js   (Node 18+). Domain rules of app/domain/pricing.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../app/domain/pricing.js");

test("VAT: 별도 prices get 10% in 'incl' mode, others unchanged", () => {
  assert.equal(P.vatPrice(49000, 2, "incl"), 53900);
  assert.equal(P.vatPrice(49000, 2, "listed"), 49000);
  assert.equal(P.vatPrice(69000, 1, "incl"), 69000);   // already VAT 포함
  assert.equal(P.vatPrice(69000, 0, "incl"), 69000);   // unknown: never guessed
  assert.equal(P.vatPrice(1900, 2, "incl"), 2090);
});

test("expired events: only real dates before today", () => {
  assert.equal(P.isExpired("2026-10-17", "2026-10-18"), true);
  assert.equal(P.isExpired("2026-10-17", "2026-10-17"), false);  // last day still valid
  assert.equal(P.isExpired("posted:2024-10-25", "2026-10-18"), false);
  assert.equal(P.isExpired("", "2026-10-18"), false);
  assert.equal(P.isExpired("9999-12-31", "2026-10-18"), false);
});

test("time cutoff parsing", () => {
  assert.equal(P.parseCutoff("[평일5시이전] 슈링크 300샷"), 17 * 60);
  assert.equal(P.parseCutoff("프라임 타임 오후 2시 이전"), 14 * 60);
  assert.equal(P.parseCutoff("[프라임 타임] 울쎄라 300샷"), null);
});

test("visit conditions: weekday-daytime, Sunday, holidays", () => {
  const tue = { date: "2026-10-20", time: "" }, sun = { date: "2026-10-18", time: "" };
  assert.equal(P.condState("평일 낮", "x", tue), 0);
  assert.equal(P.condState("평일 낮", "x", sun), 1);
  assert.equal(P.condState("평일 낮", "x", { date: "2026-12-25", time: "" }), 1);          // holiday (Friday)
  assert.equal(P.condState("평일 낮", "[평일5시이전] x", { date: "2026-10-20", time: "16:30" }), 0);
  assert.equal(P.condState("평일 낮", "[평일5시이전] x", { date: "2026-10-20", time: "17:00" }), 1);
  // the hour does not matter when the name says so (C1b 해피아워 rows); without such words an unknown hour stays "check"
  assert.equal(P.condState("평일 낮·1인 1회", "[화수목 해피아워] 시간 상관 없이 화/수/목요일 방문 고객님 대상 · 블랙필 1회", { date: "2026-10-21", time: "11:00" }), 0);
  assert.equal(P.condState("평일 낮", "시간무관 평일 이벤트", { date: "2026-10-21", time: "19:00" }), 0);
  assert.equal(P.condState("평일 낮", "[화수목 해피아워] 블랙필 1회", { date: "2026-10-21", time: "11:00" }), 2);
  assert.equal(P.condState("평일 낮", "[화수목 해피아워] 시간 상관 없이 블랙필", { date: "2026-10-24", time: "11:00" }), 1);   // Saturday
  assert.equal(P.condState("평일 낮", "[프라임 타임] x", { date: "2026-10-20", time: "18:00" }), 2);  // window unknown
  assert.equal(P.condState("일요일", "x", sun), 0);
  assert.equal(P.condState("일요일", "x", tue), 1);
  assert.equal(P.condState("", "x", tue), 0);
  assert.equal(P.condState("평일 낮", "x", null), 0);
});

// C1b (2026-10-15): 해피아워·화수목·'평일 한정'·'12시~17시' prices carry the same '평일 낮' tag. The name the app gets often
// has no day or hour (they are in the event title), so: weekend/holiday → not valid, a weekday → valid, a weekday with a
// chosen time → 'time unclear' unless the name has a '…시 이전' cutoff.
test("visit conditions: happy-hour, 화수목 and '평일 한정' rows under the '평일 낮' tag", () => {
  const sat = { date: "2026-10-24", time: "" }, mon = { date: "2026-10-19", time: "" }, wed = { date: "2026-10-21", time: "" };
  for (const [tags, name] of [["평일 낮", "해피아워_스킨케어 · LDM 1회"], ["평일 낮·1인 1회", "[화수목 해피아워] 시간 상관 없이 화/수/목요일 방문 고객님 대상 (1인 1회, keep 불가) · 블랙필 1회"],
    ["평일 낮", "(대표X,평일한정이벤트)얼굴위쪽보톡스(국산)"], ["평일 낮", "인모드 FX 얼굴전체 3회"]]) {
    assert.equal(P.condState(tags, name, sat), 1, name);
    assert.equal(P.condState(tags, name, { date: "2026-12-25", time: "" }), 1, name);       // public holiday on a Friday
    assert.equal(P.condState(tags, name, wed), 0, name);
    // a picked hour: unknown → 2 (check with the clinic), except a name that says the hour does not matter
    assert.equal(P.condState(tags, name, { ...wed, time: "11:00" }), /시간 상관 없이/.test(name) ? 0 : 2, name);
  }
  // without the days field (files before C #71, or the site wrote none) a 화수목 price still counts on a Monday
  assert.equal(P.condState("평일 낮", "인모드 FX 얼굴전체 3회", mon), 0);
});

// C #83: '(12시-3시)' with no day words is '시간대' now (a time window, not limited to weekdays); with the hours field
// (C #71, '12:00-15:00') the app checks the window itself
test("visit conditions: '시간대' — any day, the hours decide", () => {
  const name = "색소 올인원 · 색소 올인원 1회 (12시-3시)", sat = { date: "2026-10-24", time: "" }, wed = { date: "2026-10-21", time: "" };
  const xmas = { date: "2026-12-25", time: "" };
  // hours not known: never left out by the day; a picked hour is 'check with the clinic' unless the name says it does not matter
  for (const w of [sat, wed, xmas, { date: "2026-10-25", time: "" }]) assert.equal(P.condState("시간대", name, w), 0, w.date);
  assert.equal(P.condState("시간대", name, { ...wed, time: "11:00" }), 2);
  assert.equal(P.condState("시간대", name, { ...sat, time: "13:00" }), 2);
  assert.equal(P.condState("시간대", "해피아워 시간 상관 없이 · 토닝", { ...sat, time: "13:00" }), 0);
  // hours known: inside [12:00, 15:00) ok, outside not valid, on a Saturday too
  const hrs = { days: 0, hours: "12:00-15:00" };
  assert.equal(P.condState("시간대", name, { ...wed, time: "11:30" }, hrs), 1);
  assert.equal(P.condState("시간대", name, { ...wed, time: "12:00" }, hrs), 0);
  assert.equal(P.condState("시간대", name, { ...wed, time: "14:30" }, hrs), 0);
  assert.equal(P.condState("시간대", name, { ...wed, time: "15:00" }, hrs), 1);    // the end is not included
  assert.equal(P.condState("시간대", name, { ...sat, time: "13:00" }, hrs), 0);
  assert.equal(P.condState("시간대", name, { ...sat, time: "16:00" }, hrs), 1);
  assert.equal(P.condState("시간대", name, sat, hrs), 0);                            // no time picked: the day is fine
  // days with 토·일 (C #83 tags these '시간대' too): those days only
  const wkend = { days: 96, hours: "10:00-15:00" };
  assert.equal(P.condState("시간대", "x", { ...sat, time: "10:00" }, wkend), 0);
  assert.equal(P.condState("시간대", "x", { ...wed, time: "10:00" }, wkend), 1);
});

test("visit conditions: the site's days bits (월=1 … 일=64)", () => {
  const mon = { date: "2026-10-19", time: "" }, tue = { date: "2026-10-20", time: "" }, wed = { date: "2026-10-21", time: "" };
  const thu = { date: "2026-10-22", time: "" }, sat = { date: "2026-10-24", time: "" }, sun = { date: "2026-10-25", time: "" };
  const hhs = { days: 14 };                                    // 화·수·목
  for (const tags of ["평일 낮", "평일 낮·1인 1회", "", "첫 방문"]) {
    assert.equal(P.condState(tags, "[화수목 해피아워] 블랙필", mon, hhs), 1, tags);
    assert.equal(P.condState(tags, "[화수목 해피아워] 블랙필", tue, hhs), 0, tags);
    assert.equal(P.condState(tags, "[화수목 해피아워] 블랙필", wed, hhs), 0, tags);
    assert.equal(P.condState(tags, "[화수목 해피아워] 블랙필", thu, hhs), 0, tags);
    assert.equal(P.condState(tags, "[화수목 해피아워] 블랙필", sat, hhs), 1, tags);
  }
  // weekend bits: 주말 (96) and 토요일 only (32)
  assert.equal(P.condState("", "주말 이벤트", sat, { days: 96 }), 0);
  assert.equal(P.condState("", "주말 이벤트", sun, { days: 96 }), 0);
  assert.equal(P.condState("", "주말 이벤트", wed, { days: 96 }), 1);
  assert.equal(P.condState("", "토요일이벤트 · 토닝", sat, { days: 32 }), 0);
  assert.equal(P.condState("", "토요일이벤트 · 토닝", sun, { days: 32 }), 1);
  assert.equal(P.condState("", "토요일이벤트 · 토닝", mon, { days: 32 }), 1);
  // days bits win over the tag: a '평일 낮' row whose site names Saturday is valid on Saturday (no such rows in the data now —
  // C #83 never tags days with 토·일 '평일 낮' — but if a site writes Saturday, the days decide)
  assert.equal(P.condState("평일 낮", "x", sat, { days: 48 }), 0);
  // all seven days / no days: no day limit
  assert.equal(P.condState("", "x", sat, { days: 127 }), 0);
  assert.equal(P.condState("", "x", sat, { days: 0 }), 0);
  // an untagged day price has no time limit of its own: a picked hour does not make it 'check'
  assert.equal(P.condState("", "토요일이벤트 · 토닝", { ...sat, time: "11:00" }, { days: 32 }), 0);
});

test("visit conditions: public holidays and weekday-only prices", () => {
  const xmas = { date: "2026-12-25", time: "" };              // 성탄절, a Friday
  assert.equal(P.condState("평일 낮", "x", xmas, { days: 31 }), 1);       // 평일 only
  assert.equal(P.condState("", "x", xmas, { days: 16 }), 1);               // 금요일 only, no tag
  assert.equal(P.condState("평일 낮", "x", xmas, { days: 0 }), 1);         // no days + '평일 낮' = 월~금 as before
  assert.equal(P.condState("", "x", xmas, { days: 48 }), 0);               // 금·토: not a weekday-only price, Friday is on
  assert.equal(P.condState("시간대", "x", xmas, { days: 0 }), 0);          // '시간대' without days: any day
  assert.equal(P.condState("평일 낮", "x", { date: "2026-12-24", time: "" }, { days: 31 }), 0);
  // the holiday table can still be given (options form and the older 4th argument)
  const mine = { "2026-10-21": "임시" }, wed = { date: "2026-10-21", time: "" };
  assert.equal(P.condState("평일 낮", "x", wed, { days: 31, holidays: mine }), 1);
  assert.equal(P.condState("평일 낮", "x", wed, mine), 1);
  assert.equal(P.condState("평일 낮", "x", xmas, {}), 0);                  // an empty table: no holidays
});

test("visit conditions: the site's hours — inside, outside, the end, 24:00", () => {
  const wed = (time) => ({ date: "2026-10-21", time });
  const o = { days: 14, hours: "11:00-16:00" };
  assert.equal(P.condState("평일 낮", "x", wed("10:30"), o), 1);
  assert.equal(P.condState("평일 낮", "x", wed("11:00"), o), 0);
  assert.equal(P.condState("평일 낮", "x", wed("15:30"), o), 0);
  assert.equal(P.condState("평일 낮", "x", wed("16:00"), o), 1);
  assert.equal(P.condState("평일 낮", "x", wed(""), o), 0);
  // known hours win over the '…시 이전' words in the name
  assert.equal(P.condState("평일 낮", "[평일5시이전] x", wed("16:30"), { hours: "11:00-16:00" }), 1);
  // 'N시 이전' = '00:00-HH:MM', 'N시 이후' = 'HH:MM-24:00'
  assert.equal(P.condState("평일 낮", "x", wed("09:00"), { hours: "00:00-17:00" }), 0);
  assert.equal(P.condState("평일 낮", "x", wed("17:00"), { hours: "00:00-17:00" }), 1);
  assert.equal(P.condState("시간대", "x", wed("21:00"), { hours: "18:00-24:00" }), 0);
  assert.equal(P.condState("시간대", "x", wed("23:30"), { hours: "18:00-24:00" }), 0);
  assert.equal(P.condState("시간대", "x", wed("17:30"), { hours: "18:00-24:00" }), 1);
  // the app keeps hours as one number (Pricing.hoursCode): the same answers
  const code = P.hoursCode("11:00-16:00");
  assert.equal(code, 660 * 10000 + 960);
  assert.equal(P.condState("평일 낮", "x", wed("10:30"), { hours: code }), 1);
  assert.equal(P.condState("평일 낮", "x", wed("11:00"), { hours: code }), 0);
  // hours on a row with no tag and with '타임세일': the window decides (no 'check'); without hours 타임세일 stays 'check'
  assert.equal(P.condState("", "x", wed("12:00"), { hours: "13:00-17:00" }), 1);
  assert.equal(P.condState("", "x", wed("13:00"), { hours: "13:00-17:00" }), 0);
  assert.equal(P.condState("타임세일", "x", wed("13:00"), { hours: "13:00-17:00" }), 0);
  assert.equal(P.condState("타임세일", "x", wed("13:00")), 2);
  // unreadable or whole-day hours: no window
  for (const t of ["", "12:00", "15:00-12:00", "00:00-24:00", "10:00-25:00", "x"]) assert.equal(P.hoursCode(t), 0, t);
  assert.equal(P.condState("", "x", wed("09:00"), { hours: "00:00-24:00" }), 0);
});

test("visit conditions: the older call shape (3 or 4 arguments) is unchanged", () => {
  const tue = { date: "2026-10-20", time: "" }, sun = { date: "2026-10-18", time: "" };
  assert.equal(P.condState("평일 낮", "x", tue), 0);
  assert.equal(P.condState("평일 낮", "x", sun), 1);
  assert.equal(P.condState("평일 낮", "x", sun, P.KR_HOLIDAYS), 1);
  assert.equal(P.condState("평일 낮", "x", { date: "2026-12-25", time: "" }, P.KR_HOLIDAYS), 1);
  assert.equal(P.condState("평일 낮", "x", { ...tue, time: "11:00" }, undefined), 2);
  assert.equal(P.condState(null, "x", tue), 0);
  assert.equal(P.condState("", "x", tue, { days: 0, hours: 0 }), 0);
});

test("days / hours fields: which files have them, words on screen", () => {
  const cols = (n) => ({ cols: Array.from({ length: n }, () => [0]) }), rows = (n) => ({ rows: [Array.from({ length: n }, () => 0)] });
  assert.equal(P.hasWhenFields(cols(18)), true);
  assert.equal(P.hasWhenFields(cols(17)), false);
  assert.equal(P.hasWhenFields(cols(16)), false);
  assert.equal(P.hasWhenFields(rows(18)), true);
  assert.equal(P.hasWhenFields(rows(15)), false);
  assert.equal(P.hasWhenFields({ rows: [] }), false);
  assert.equal(P.hasWhenFields(null), false);
  // day list: 평일 / 주말 by name, other sets one by one, no limit → ''
  assert.equal(P.dayList(31), "평일");
  assert.equal(P.dayList(96), "주말");
  assert.equal(P.dayList(14), "화·수·목");
  assert.equal(P.dayList(15), "월·화·수·목");
  assert.equal(P.dayList(32), "토");
  assert.equal(P.dayList(95), "평일·일요일");
  assert.equal(P.dayList(63), "평일·토요일");
  assert.equal(P.dayList(42), "화·목·토");
  for (const d of [0, 127, undefined, null]) assert.equal(P.dayList(d), "", String(d));
  assert.deepEqual(P.whenLines(14, "12:00-15:00"), ["되는 요일: 화·수·목", "되는 시간: 12:00~15:00"]);
  assert.deepEqual(P.whenLines(32, 0), ["되는 요일: 토요일"]);
  assert.deepEqual(P.whenLines(0, P.hoursCode("18:00-24:00")), ["되는 시간: 18:00 이후"]);
  assert.deepEqual(P.whenLines(31, "00:00-16:00"), ["되는 요일: 평일", "되는 시간: 16:00 이전"]);
  assert.deepEqual(P.whenLines(127, ""), []);
  assert.ok(!P.whenLines(14, "12:00-15:00").some((x) => x.includes("한정")));   // the price sheet drops lines with '한정'
  // what makes a price not plain: some weekdays or a time window
  assert.equal(P.whenLimited(32, 0), true);
  assert.equal(P.whenLimited(0, P.hoursCode("12:00-15:00")), true);
  assert.equal(P.whenLimited(0, "12:00-15:00"), true);
  assert.equal(P.whenLimited(0, 0), false);
  assert.equal(P.whenLimited(127, ""), false);
  assert.equal(P.whenLimited(undefined, undefined), false);
  // the badge of an untagged day / time price
  assert.equal(P.whenBadge(32, 0), "토요일만");
  assert.equal(P.whenBadge(14, 0), "화·수·목만");
  assert.equal(P.whenBadge(31, 0), "평일만");
  assert.equal(P.whenBadge(96, ""), "주말만");
  assert.equal(P.whenBadge(0, "11:00-17:00"), "정해진 시간만");
  // days and hours: the hours show on the badge too — the words of the tag C #83 gives such a row
  assert.equal(P.whenBadge(31, "11:00-17:00"), P.condLabel("평일 낮"));
  assert.equal(P.whenBadge(14, P.hoursCode("11:00-17:30")), P.condLabel("평일 낮"));
  assert.equal(P.whenBadge(32, "10:00-15:00"), P.condLabel("시간대"));
  assert.equal(P.whenBadge(127, "10:00-15:00"), P.condLabel("시간대"));
  assert.equal(P.whenBadge(31, "00:00-24:00"), "평일만");                  // a whole-day window is no window
  assert.equal(P.whenBadge(0, 0), "");
});

test("condition badge words: '평일 낮' reads '평일·시간 한정', '시간대' '정해진 시간만', other tags as they are", () => {
  assert.equal(P.condLabel("평일 낮"), "평일·시간 한정");
  assert.equal(P.condLabel("시간대"), "정해진 시간만");
  for (const t of ["평일 낮", "시간대"]) assert.ok(P.condLabel(t).replace(/[^가-힣]/g, "").length <= 7, t);
  assert.ok(!P.condLabel("시간대").includes("한정"));
  for (const t of ["일요일", "타임세일", "첫 방문", "1인 1회", "새 조건"]) assert.equal(P.condLabel(t), t);
  // titles: what the tag means, after the days / hours the site wrote; the '시간대' title says the days are unknown only when they are
  assert.equal(P.condTitle("시간대", 0, ""), "정해진 시간에만 되는 가격이에요. 되는 요일은 앱이 알지 못해요 — 병원에 확인하세요");
  assert.equal(P.condTitle("시간대", 0, "12:00-15:00"), "되는 시간: 12:00~15:00. 정해진 시간에만 되는 가격이에요. 되는 요일은 앱이 알지 못해요 — 병원에 확인하세요");
  assert.ok(!P.condTitle("시간대", 96, "10:00-15:00").includes("되는 요일은 앱이 알지 못해요"));
  assert.ok(P.condTitle("시간대", 96, "10:00-15:00").startsWith("되는 요일: 주말, 되는 시간: 10:00~15:00."));
  assert.ok(/해피아워/.test(P.condTitle("평일 낮", 0, "")) && /화수목/.test(P.condTitle("평일 낮", 0, "")));
  assert.ok(P.condTitle("평일 낮", 14, "11:00-16:00").startsWith("되는 요일: 화·수·목, 되는 시간: 11:00~16:00."));
  assert.ok(P.condTitle("", 32, 0).startsWith("되는 요일: 토요일. 사이트에 적힌 요일·시간에만"));
  assert.equal(P.condTitle("첫 방문", 31, 0), "");
  assert.equal(P.condTitle("toString", 0, 0), "");
  assert.equal(P.condLabel("toString"), "toString");
  // the tag id itself is unchanged: condState still keys on '평일 낮', not on the badge words
  assert.equal(P.condState(P.condLabel("평일 낮"), "x", { date: "2026-10-18", time: "" }), 0);
  assert.equal(P.condState("평일 낮", "x", { date: "2026-10-18", time: "" }), 1);
});

const row = (i, p, special = false) => ({ i, p, special });

test("line: cheapest, tie prefers regular price, special only for the first session", () => {
  assert.equal(P.lineCost([], [], 1, null), null);
  assert.deepEqual(P.lineCost([row(1, 900, true), row(2, 900)], [row(2, 900)], 1, null).rows, [2]);
  const l = P.lineCost([row(1, 500, true), row(2, 900)], [row(2, 900)], 3, null);
  assert.equal(l.total, 500 + 900 * 2);
  assert.deepEqual(l.rows, [1, 2]);
  assert.equal(l.special, true);
  // only a special price exists: whether it repeats is unknown → later sessions stay unpriced, never special × q
  // (round-2 R14); the line is incomplete and is not counted as a cart total
  const once = P.lineCost([row(1, 500, true)], [], 2, null);
  assert.equal(once.total, 500); assert.equal(once.unpriced, 1); assert.equal(once.incomplete, true);
  assert.equal(P.lineCost([row(1, 100, true)], [], 3, null).total !== 300, true);
  const cmp = P.compareClinics([{ b: 0, lines: [once] }]);
  assert.equal(cmp.full.length, 0, "an incomplete line is not a full total");
  // a regular (non-special) price alone repeats as before
  assert.equal(P.lineCost([row(1, 500)], [row(1, 500)], 2, null).total, 1000);
});

// ---- once / repeat (B, 2026-10-16): a once price is one time per person, a repeat price holds on every visit that fits its
// day / time — the visit date filter (condState) checks that condition
test("condition split: 체험가·한정가·첫 방문·1인 1회·타임세일 are once; 평일 낮·시간대·일요일·the site's days/hours are repeat", () => {
  assert.equal(P.condClass(1, "", 0, ""), "once");                 // 체험가
  assert.equal(P.condClass(2, "", 0, ""), "once");                 // 한정가
  for (const t of ["첫 방문", "1인 1회", "타임세일"]) assert.equal(P.condClass(0, t, 0, ""), "once", t);
  assert.equal(P.condClass(0, "새 태그", 0, ""), "once", "a tag the app does not know is never repeated on a guess");
  for (const t of ["평일 낮", "시간대", "일요일"]) assert.equal(P.condClass(0, t, 0, ""), "repeat", t);
  assert.equal(P.condClass(0, "", 32, ""), "repeat", "untagged '토요일이벤트' (days 토)");
  assert.equal(P.condClass(0, "", 0, "12:00-15:00"), "repeat", "untagged hours as text");
  assert.equal(P.condClass(0, "", 0, P.hoursCode("12:00-15:00")), "repeat", "… and as the app's hoursCode");
  assert.equal(P.condClass(3, "평일 낮", 31, ""), "repeat", "a 회차 price for weekdays");
  // both reasons: once
  assert.equal(P.condClass(0, "평일 낮·첫 방문", 31, ""), "once");
  assert.equal(P.condClass(0, "평일 낮·1인 1회", 0, ""), "once");
  assert.equal(P.condClass(1, "", 32, ""), "once");
  assert.equal(P.condClass(2, "일요일", 64, ""), "once");
  // plain: no kind 1/2, no tag, no day/time limit (all seven days is no limit)
  for (const [k, d, hr] of [[0, 0, ""], [3, 0, ""], [4, 0, ""], [0, 127, ""], [0, 0, "bad"]]) assert.equal(P.condClass(k, "", d, hr), "", `${k} ${d} ${hr}`);
  assert.deepEqual([...P.ONCE_TAGS, ...P.REPEAT_TAGS].sort(), ["1인 1회", "시간대", "일요일", "첫 방문", "타임세일", "평일 낮"].sort());
});

test("condition split covers every tag the data build writes (build2/clean.py TAGS + TIME_TAGS)", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../build2/clean.py"), "utf8");
  const block = /^TAGS = \[([\s\S]*?)\]\s*$/m.exec(src);
  assert.ok(block, "TAGS list found in build2/clean.py");
  const tags = [...block[1].matchAll(/\("([^"]+)",\s*r"/g)].map((m) => m[1]);
  const only = /^TIME_ONLY = "([^"]+)"/m.exec(src), time = /^TIME_TAGS = \("([^"]+)", TIME_ONLY\)/m.exec(src);
  assert.ok(tags.length >= 4 && only && time, "tag ids read");
  for (const t of [...tags, only[1], time[1]]) assert.ok(P.ONCE_TAGS.includes(t) || P.REPEAT_TAGS.includes(t), `build tag '${t}' is classified`);
});

test("condition split agrees with the app's special rule (kind 1/2, any tag, or a day/time limit)", () => {
  for (const k of [0, 1, 2, 3, 4]) for (const t of ["", "평일 낮", "첫 방문", "평일 낮·첫 방문", "시간대"]) for (const d of [0, 32, 31, 127]) for (const hr of ["", "10:00-16:00"]) {
    const special = k === 1 || k === 2 || t !== "" || P.whenLimited(d, hr);
    assert.equal(P.condClass(k, t, d, hr) !== "", special, `${k} ${t} ${d} ${hr}`);
  }
});

const rep = (i, p) => ({ i, p, special: true, repeat: true });
test("line: a repeat price counts for every session — q × price, with or without a regular price", () => {
  let l = P.lineCost([rep(1, 300)], [], 1, null);
  assert.equal(l.total, 300); assert.equal(l.repeat, true); assert.equal(l.incomplete, undefined);
  l = P.lineCost([rep(1, 300)], [], 3, null);                       // no regular price: no longer '2회째부터 가격 없음'
  assert.equal(l.total, 900); assert.deepEqual(l.rows, [1]); assert.equal(l.units, 3);
  assert.equal(l.incomplete, undefined); assert.equal(l.unpriced, undefined); assert.equal(l.repeat, true); assert.equal(l.laterRegular, false);
  l = P.lineCost([rep(1, 300), row(2, 500)], [row(2, 500)], 3, null);   // cheaper than the regular price: every session at it
  assert.equal(l.total, 900); assert.deepEqual(l.rows, [1]); assert.equal(l.repeat, true); assert.equal(l.laterRegular, false);
  l = P.lineCost([rep(1, 600), row(2, 500)], [row(2, 500)], 3, null);   // the regular price is cheaper: it wins as before
  assert.equal(l.total, 1500); assert.equal(l.repeat, false); assert.equal(l.special, false);
  // a once price first, then the cheapest price that repeats — a repeat one when it is below the regular one
  l = P.lineCost([row(1, 100, true), rep(2, 300), row(3, 500)], [row(3, 500)], 3, null);
  assert.equal(l.total, 100 + 300 * 2); assert.deepEqual(l.rows, [1, 2]); assert.equal(l.repeat, true); assert.equal(l.laterRegular, false);
  l = P.lineCost([row(1, 100, true), rep(2, 300)], [], 3, null);       // … also with no regular price at all
  assert.equal(l.total, 700); assert.equal(l.incomplete, undefined);
  // the full-cart comparison counts such a line
  assert.equal(P.compareClinics([{ b: 0, lines: [P.lineCost([rep(1, 300)], [], 3, null)] }]).full[0].total, 900);
});

test("line: once prices keep the R14 rule — counted once, never once × q", () => {
  const once = P.lineCost([row(1, 100, true)], [], 3, null);            // a special with no repeat flag is once (older callers)
  assert.equal(once.total, 100); assert.equal(once.incomplete, true); assert.equal(once.unpriced, 2); assert.equal(once.repeat, undefined);
  const flagged = P.lineCost([{ i: 1, p: 100, special: true, repeat: false }], [], 3, null);
  assert.equal(flagged.incomplete, true); assert.notEqual(flagged.total, 300);
  const reg = P.lineCost([row(1, 100, true), row(2, 300)], [row(2, 300)], 3, null);
  assert.equal(reg.total, 700); assert.equal(reg.laterRegular, true); assert.equal(reg.repeat, false);
  // a repeat flag on a plain price means nothing (only specials are once or repeat)
  assert.equal(P.lineCost([{ i: 1, p: 100, special: false, repeat: true }], [{ i: 1, p: 100, special: false, repeat: true }], 2, null).repeat, false);
});

test("had it before (cart item switch): once prices leave the candidates, the next cheapest price is used", () => {
  const cands = [row(1, 100, true), rep(2, 300), row(3, 500)], regular = [row(3, 500)];
  assert.deepEqual(P.withoutOnce(cands).map((x) => x.i), [2, 3]);
  assert.equal(P.isOnce(row(1, 100, true)), true); assert.equal(P.isOnce(rep(2, 300)), false); assert.equal(P.isOnce(row(3, 500)), false);
  let l = P.lineCost(P.withoutOnce(cands), P.withoutOnce(regular), 3, null);
  assert.equal(l.total, 900); assert.deepEqual(l.rows, [2]);
  l = P.lineCost(P.withoutOnce([row(1, 100, true), row(3, 500)]), [row(3, 500)], 1, null);
  assert.equal(l.total, 500); assert.equal(l.special, false);
  // only once prices: no price for this person at that branch (never the once price)
  assert.equal(P.lineCost(P.withoutOnce([row(1, 100, true)]), [], 1, null), null);
  assert.deepEqual(P.withoutOnce([]), []);
});

test("line: a once price first says so for the later sessions (laterOther), whatever price they use", () => {
  let l = P.lineCost([row(1, 100, true), row(3, 500)], [row(3, 500)], 3, null);
  assert.equal(l.laterOther, true); assert.equal(l.laterRegular, true); assert.equal(l.repeat, false);
  l = P.lineCost([row(1, 100, true), rep(2, 300), row(3, 500)], [row(3, 500)], 3, null);
  assert.equal(l.laterOther, true); assert.equal(l.laterRegular, false); assert.equal(l.repeat, true); assert.deepEqual(l.rows, [1, 2]);
  l = P.lineCost([rep(2, 300), row(3, 500)], [row(3, 500)], 3, null);     // a repeat price alone: nothing 'later' to say
  assert.equal(l.laterOther, false); assert.equal(l.repeat, true);
  assert.equal(P.lineCost([row(1, 100, true), row(3, 500)], [row(3, 500)], 1, null).laterOther, undefined);
});

test("line: at the same price a plain price wins, then a repeat one, then a once one", () => {
  assert.deepEqual(P.lineCost([row(1, 300, true), rep(2, 300)], [], 3, null).rows, [2], "a once/repeat tie is no '체험가 첫 회 + …' line");
  assert.equal(P.lineCost([row(1, 300, true), rep(2, 300)], [], 3, null).laterOther, false);
  assert.deepEqual(P.lineCost([rep(2, 300), row(1, 300, true)], [], 3, null).rows, [2], "whatever the order");
  assert.deepEqual(P.lineCost([row(1, 300, true), rep(2, 300), row(3, 300)], [row(3, 300)], 1, null).rows, [3]);
  assert.equal(P.cheapest([row(1, 300, true), rep(2, 300), row(3, 300)]).i, 3);
  assert.equal(P.cheapest([row(1, 300, true), rep(2, 300)]).i, 2);
  assert.equal(P.cheapest([row(1, 200, true), rep(2, 300)]).i, 1, "a lower price still wins");
});

test("line: a once price picked for a branch keeps the R14 rule (first session only)", () => {
  const ov = { i: 9, p: 100, sess: 1, special: true };
  let l = P.lineCost([row(1, 300, true), row(3, 500)], [row(3, 500)], 3, ov);
  assert.equal(l.total, 100 + 500 * 2); assert.deepEqual(l.rows, [9, 3]); assert.equal(l.ov, true); assert.equal(l.laterOther, true);
  assert.notEqual(l.total, 300, "never the picked once price × 3");
  l = P.lineCost([row(1, 300, true), rep(2, 400), row(3, 500)], [row(3, 500)], 3, ov);   // later sessions: the cheapest repeating price
  assert.equal(l.total, 100 + 400 * 2); assert.deepEqual(l.rows, [9, 2]); assert.equal(l.repeat, true);
  l = P.lineCost([row(1, 300, true)], [], 3, ov);                       // nothing repeats: later sessions unpriced
  assert.equal(l.total, 100); assert.equal(l.incomplete, true); assert.equal(l.unpriced, 2); assert.equal(l.ov, true);
  assert.equal(P.compareClinics([{ b: 0, lines: [l] }]).full.length, 0);
  assert.equal(P.lineCost([], [], 1, ov).total, 100, "one session: the picked price");
  // a package or a pass picked by hand is its own price (bundles), also when it is a special
  assert.equal(P.lineCost([], [], 5, { i: 9, p: 300000, sess: 3, special: true }).total, 600000);
  assert.equal(P.lineCost([], [], 5, { i: 9, p: 300000, sess: 99, special: true }).total, 300000);
  // a picked visit day / time price repeats like an automatic one, and the line says so
  l = P.lineCost([], [], 3, { i: 9, p: 300, sess: 1, special: true, repeat: true });
  assert.equal(l.total, 900); assert.equal(l.repeat, true); assert.equal(l.incomplete, undefined);
  assert.equal(P.lineCost([], [], 3, { i: 9, p: 300, sess: 1 }).repeat, false, "a plain pick is no repeat line");
});

test("line: user-chosen package covers sessions in bundles", () => {
  assert.equal(P.lineCost([], [], 5, { i: 9, p: 300000, sess: 3 }).total, 600000);   // 5 sessions → two 3-session packages
  assert.equal(P.lineCost([], [], 5, { i: 9, p: 300000, sess: 99 }).total, 300000);  // unlimited pass
});

test("cart: single clinic needs every item, missing prices never count as 0", () => {
  const L = (t) => (t == null ? null : { total: t, rows: [0], units: 1 });
  const r = P.compareClinics([
    { b: "A", lines: [L(100), L(200)] },
    { b: "B", lines: [L(50), null] },
    { b: "C", lines: [L(120), L(150)] },
  ]);
  assert.deepEqual(r.full.map((x) => [x.b, x.total]), [["C", 270], ["A", 300]]);
  assert.deepEqual(r.partial.map((x) => [x.b, x.n, x.missing]), [["B", 1, [1]]]);
  assert.equal(r.mix.total, 200);                 // 50 at B + 150 at C
  assert.equal(r.savings, 70);
  assert.deepEqual([r.pair.a, r.pair.b, r.pair.total], ["B", "C", 200]);
});

test("cart: mix ties go to a branch already on the route; no pair when one branch is as cheap", () => {
  const L = (t) => ({ total: t, rows: [0], units: 1 });
  const r = P.compareClinics([
    { b: "A", lines: [L(100), L(100)] },
    { b: "B", lines: [L(100), L(120)] },
  ]);
  assert.deepEqual(r.mix.picks.map((p) => p.b), ["A", "A"]);
  assert.equal(r.mix.places, 1);
  assert.equal(r.pair, null);
});

test("cart: item nobody sells", () => {
  const r = P.compareClinics([{ b: "A", lines: [{ total: 10, rows: [0] }, null] }]);
  assert.equal(r.full.length, 0);
  assert.equal(r.mix.missing, 1);
  assert.equal(r.savings, null);
});

test("first-visit prices: one per branch, the biggest saving stays", () => {
  const L = (t, extra = {}) => ({ total: t, rows: [0], units: 1, ...extra });
  const lines = [L(5000), L(9000), L(30000)];
  const alts = [L(20000), L(10000), null];
  const out = P.limitOnce(lines, [true, true, false], (j) => alts[j]);
  assert.deepEqual(out.map((l) => l.total), [5000, 10000, 30000]);   // item 0 saves 15,000 → keeps; item 1 falls back
  assert.equal(out[1].restacked, true);
  const noAlt = P.limitOnce([L(5000), L(9000)], [true, true], (j) => (j === 0 ? L(20000) : null));
  assert.equal(noAlt[1].total, 9000);                                  // no other price: kept (only option) …
  assert.equal(noAlt[1].stackWarn, undefined);                         // … because it saves most (Infinity)
  assert.equal(noAlt[0].restacked, true);
  assert.deepEqual(P.limitOnce([L(1), null], [true, false], () => null).map((l) => l && l.total), [1, null]);
});

test("package match: spec equal / different / unknown, extra parts", () => {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, "");
  const items = [{ fam: /슈링크/, spec: "300샷" }, { fam: /리쥬란/, spec: "2cc" }, { fam: /아쿠아필/, spec: "" }];
  let m = P.matchPackage("슈링크 300샷 + 리쥬란 2cc", items, norm);
  assert.deepEqual(m.matched.map((x) => [x.j, x.state]), [[0, "match"], [1, "match"]]);
  assert.equal(m.full, true);
  m = P.matchPackage("슈링크 100샷 + 리쥬란 2cc + 크라이오셀", items, norm);
  assert.deepEqual(m.matched.map((x) => x.state), ["spec", "match"]);
  assert.deepEqual(m.extras, ["크라이오셀"]);
  assert.equal(m.full, false);
  m = P.matchPackage("아쿠아필 + 리쥬란 2cc", items, norm);
  assert.deepEqual(m.matched.map((x) => [x.j, x.state]), [[1, "match"], [2, "check"]]);
});

test("package match with per-part comparison keys (from xkeys)", () => {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, "");
  const items = [{ fam: /톡신|보톡스/, spec: "50U", key: "X01" }, { fam: /톡신|보톡스/, spec: "", key: "X02" }];
  let m = P.matchPackage("[EVENT] 국산 사각턱보톡스 50U + 국산 주름보톡스 1부위", items, norm, "X01;X02");
  assert.deepEqual(m.matched.map((x) => [x.j, x.state]), [[0, "match"], [1, "match"]]);
  assert.equal(m.full, true);
  m = P.matchPackage("국산 턱보톡스 100U + 침샘보톡스", items, norm, ";");
  assert.deepEqual(m.matched.map((x) => x.state), ["spec", "spec"]);   // toxin, but not the same procedure
  assert.equal(m.full, false);
});

test("weekday holidays: weekend-only prices are left out, the screen says clinics differ (user decision 2026-10-16)", () => {
  assert.equal(P.weekdayHoliday("2026-12-25"), "성탄절");          // Friday
  assert.equal(P.weekdayHoliday("2026-12-24"), "");               // not a holiday
  assert.equal(P.weekdayHoliday("2027-02-06"), "");               // 설날 on a Saturday: a holiday, but not a weekday one
  assert.equal(P.weekdayHoliday(null), "");
  assert.equal(P.weekdayHoliday("2026-12-25", { "2026-12-25": "x" }), "x");
  for (const [d, want] of [[32, true], [64, true], [96, true], [31, false], [48, false], [0, false], [127, false]]) assert.equal(P.weekendOnly(d), want, String(d));
  // the filter itself is condState's '그 요일만' rule: a weekend-only price is out on a weekday holiday, a 금·토 price is in
  assert.equal(P.condState("", "주말 이벤트", { date: "2026-12-25", time: "" }, { days: 96 }), 1);
  assert.equal(P.condState("", "금토 이벤트", { date: "2026-12-25", time: "" }, { days: 48 }), 0);
});

test("periodOver: a visit after the event's end date (user decision 2026-10-16: mark '기간 확인 필요', do not drop)", () => {
  assert.equal(P.periodOver("2026-10-17", { date: "2026-10-20", time: "" }), true);
  assert.equal(P.periodOver("2026-10-17", { date: "2026-10-17", time: "" }), false);   // the last day still counts
  assert.equal(P.periodOver("2026-10-17", { date: "2026-10-16", time: "" }), false);
  assert.equal(P.periodOver("2026-10-17", null), false);                                 // no visit chosen
  assert.equal(P.periodOver("", { date: "2026-10-20" }), false);
  assert.equal(P.periodOver("posted:2026-09-01", { date: "2026-10-20" }), false);         // a posting date is not an end date
  assert.equal(P.periodOver("2099-12-31", { date: "2026-10-20" }), false);
});

