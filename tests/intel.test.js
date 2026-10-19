// node --test tests/*.test.js — price history stats and alert rules (app/domain/intel.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../app/domain/intel.js");

test("history: only observed points, changes and lowest date", () => {
  const dates = ["2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13"];
  const s = I.historyStats(dates, [100, null, 90, 90]);
  assert.deepEqual(s, { points: 3, first: "2026-09-22", last: "2026-10-13", cur: 90, min: 90, max: 100, median: 90, changes: 1, minLast: "2026-10-13" });
  assert.equal(I.historyStats(dates, [100, null, 90, 90], "2026-10-01").points, 2);
  assert.equal(I.historyStats(dates, [null, null, null, null]), null);
  assert.equal(I.daysBefore("2026-10-13", 30), "2026-09-13");
});

test("alert: target price fires once per new low, once a day", () => {
  const a = { type: "target", target: 150000 };
  assert.equal(I.evalAlert(a, { value: 160000 }, "2026-10-13").fire, false);
  const r = I.evalAlert(a, { value: 149000 }, "2026-10-13");
  assert.equal(r.fire, true);
  const a2 = { ...a, ...r.patch };
  assert.equal(I.evalAlert(a2, { value: 140000 }, "2026-10-13").fire, false);          // same day
  assert.equal(I.evalAlert(a2, { value: 149000 }, "2026-10-14").fire, false);          // same price again
  assert.equal(I.evalAlert(a2, { value: 140000 }, "2026-10-14").fire, true);
});

test("alert: new lowest sets a base first, then fires on a lower price", () => {
  let a = { type: "newlow" };
  const r1 = I.evalAlert(a, { value: 50000 }, "2026-10-13");
  assert.equal(r1.fire, false); a = { ...a, ...r1.patch };
  assert.equal(I.evalAlert(a, { value: 50000 }, "2026-10-14").fire, false);
  const r2 = I.evalAlert(a, { value: 45000 }, "2026-10-14");
  assert.equal(r2.fire, true); assert.equal(r2.patch.base, 45000);
});

test("alert: cart total, event expiring, new matching offer", () => {
  assert.equal(I.evalAlert({ type: "cartdrop", target: 300000 }, { value: 299000 }, "2026-10-13").fire, true);
  assert.equal(I.evalAlert({ type: "cartdrop", base: 310000 }, { value: 305000 }, "2026-10-13").fire, true);
  assert.equal(I.evalAlert({ type: "expiring" }, { value: 1, until: "2026-10-17" }, "2026-10-13").fire, false);   // 4 days
  const e = I.evalAlert({ type: "expiring" }, { value: 1, until: "2026-10-17" }, "2026-10-15");
  assert.equal(e.fire, true); assert.match(e.text, /2일 뒤/);
  assert.equal(I.evalAlert({ type: "expiring", last: "2026-10-17" }, { value: 1, until: "2026-10-17" }, "2026-10-16").fire, false);
  assert.equal(I.evalAlert({ type: "newmatch", base: 10 }, { value: 1, count: 12 }, "2026-10-13").fire, true);
  assert.equal(I.evalAlert({ type: "newmatch", base: 10 }, { value: 1, count: 9 }, "2026-10-13").patch.base, 9);
  assert.equal(I.evalAlert({ type: "target", target: 1 }, null, "2026-10-13").fire, false);    // nothing priced
});

// ---- watch: several kinds of change, only between two real observations (docs/ALERT_ENGINE_SPEC.md)
const W = require("../app/domain/intel.js");
const base = { low: 100000, lowB: "블리비|강남점", lowName: "블리비 강남점", lowRow: "블리비|강남점|슈링크 300샷", count: 3, set: ["블리비|강남점", "쁨|홍대점", "톡스앤필|강남본점"], recheck: "" };
const nowOf = (x) => ({ ...base, rowState: { [base.lowRow]: "live" }, ...x });
test("watch: first look only sets the base — nothing fires", () => {
  const r = W.evalWatch({ type: "watch" }, nowOf({}), "2026-10-14");
  assert.equal(r.events.length, 0); assert.equal(r.patch.base.low, 100000);
});
test("watch: price drop and lowest-branch change are separate events with real before/after", () => {
  const r = W.evalWatch({ base }, nowOf({ low: 90000, lowB: "쁨|홍대점", lowName: "쁨 홍대점", lowRow: "쁨|홍대점|슈링크 300샷" }), "2026-10-21");
  assert.deepEqual(r.events.map((e) => e.t), ["drop", "lowbranch"]);
  assert.equal(r.events[0].before, 100000); assert.equal(r.events[0].after, 90000);
  assert.match(r.events[1].text, /블리비 강남점 → 쁨 홍대점/);
});
test("watch: same price at another branch is not a 'lowest branch change'", () => {
  const r = W.evalWatch({ base }, nowOf({ lowB: "쁨|홍대점" }), "2026-10-21");
  assert.equal(r.events.length, 0);
});
test("watch: target fires once when crossing, not again while it stays below", () => {
  const w = { base, target: 95000 };
  assert.deepEqual(W.evalWatch(w, nowOf({ low: 94000 }), "2026-10-21").events.map((e) => e.t), ["drop", "target"]);
  assert.deepEqual(W.evalWatch({ base: { ...base, low: 94000 }, target: 95000 }, nowOf({ low: 93000 }), "2026-10-28").events.map((e) => e.t), ["drop"]);
});
test("watch: a new branch selling it, the old lowest ending, and a re-check need", () => {
  const r = W.evalWatch({ base }, nowOf({ set: [...base.set, "리엔장|인천점"], count: 4, rowState: { [base.lowRow]: "expired" }, recheck: "최저가 지점이 이번 주 수집에 실패했어요" }), "2026-10-21");
  assert.deepEqual(r.events.map((e) => e.t), ["newmatch", "lowended", "recheck"]);
  assert.deepEqual(r.events[0].added, ["리엔장|인천점"]);
  assert.match(r.events[1].text, /이벤트 기간이 끝났어요/);
});
test("watch: switched-off kinds never fire; no repeat for the same observation", () => {
  const w = { base, on: { drop: false, lowbranch: true } };
  assert.deepEqual(W.evalWatch(w, nowOf({ low: 90000 }), "2026-10-21").events.map((e) => e.t), []);
  const again = W.evalWatch({ base: { ...base, low: 90000 } }, nowOf({ low: 90000 }), "2026-10-21");
  assert.equal(again.events.length, 0);
});

// 가격 변동 notice for chains collected for the first time (data.json meta.brandFirst, chat C3 · 개선 보고서 E9)
const FIRST = { 블리비: "2026-10-13", 쁨: "2026-10-13", 톡스앤필: "2026-10-13", 리엔장: "2026-10-13", 포에버: "2026-10-14",
  밴스: "2026-10-14", 유앤아이: "2026-10-14", 데이뷰: "2026-10-14", 닥터에버스: "2026-10-14", 셀린: "2026-10-14" };
const LIVE = ["블리비", "쁨", "톡스앤필", "리엔장", "밴스", "유앤아이", "데이뷰", "닥터에버스", "셀린"];   // 포에버: no branches
test("new chains: only the chains first collected after the previous snapshot, in screen order, '10월 14일'", () => {
  const g = I.newChains(FIRST, "2026-10-13", LIVE, "2026-10-14");
  assert.deepEqual(g, [{ date: "2026-10-14", label: "10월 14일", brands: ["밴스", "유앤아이", "데이뷰", "닥터에버스", "셀린"] }]);
  assert.equal(I.newChainsNote(g), "밴스·유앤아이·데이뷰·닥터에버스·셀린 체인은 10월 14일부터 모았어요. 처음 모은 체인이라 가격이 '새로 생겼어요'에 하나씩 나오지 않고, 다음 수집부터 변동이 보여요.");
  // a chain not passed in (switched off, or no branches like 포에버) is not named
  assert.deepEqual(I.newChains(FIRST, "2026-10-13", ["블리비", "셀린"], "2026-10-14")[0].brands, ["셀린"]);
  assert.equal(I.newChains(FIRST, "2026-10-13", LIVE).length, 1);   // upto is optional
});
test("new chains: several first days, oldest first, one sentence", () => {
  const g = I.newChains({ ...FIRST, 셀린: "2026-10-21" }, "2026-10-13", LIVE, "2026-10-21");
  assert.deepEqual(g.map((x) => [x.label, x.brands.join("·")]), [["10월 14일", "밴스·유앤아이·데이뷰·닥터에버스"], ["10월 21일", "셀린"]]);
  assert.match(I.newChainsNote(g), /^밴스·유앤아이·데이뷰·닥터에버스 체인은 10월 14일부터, 셀린 체인은 10월 21일부터 모았어요\. /);
  assert.equal(I.koDay("2026-01-05"), "1월 5일");
});
test("new chains: nothing to say — old files, no previous snapshot, every chain already compared, bad dates", () => {
  assert.deepEqual(I.newChains(undefined, "2026-10-13", LIVE, "2026-10-14"), []);         // data.json before C3: no brandFirst
  assert.deepEqual(I.newChains(null, "2026-10-13", LIVE, "2026-10-14"), []);
  assert.deepEqual(I.newChains(FIRST, "", LIVE, "2026-10-14"), []);                        // first collection: nothing compared
  assert.deepEqual(I.newChains(FIRST, undefined, LIVE, "2026-10-14"), []);
  assert.deepEqual(I.newChains(FIRST, "2026-10-14", LIVE, "2026-10-21"), []);              // the next collection: all were in 10-14
  assert.deepEqual(I.newChains(FIRST, "2026-10-13", ["블리비", "쁨"], "2026-10-14"), []);   // only chains from the start
  assert.deepEqual(I.newChains({ 밴스: "2026-10-30", 셀린: "10/14", 데이뷰: 20261014 }, "2026-10-13", LIVE, "2026-10-14"), []);
  assert.deepEqual(I.newChains(FIRST, "2026-10-13", ["밴스", "밴스", "toString"], "2026-10-14")[0].brands, ["밴스"]);
  assert.equal(I.newChainsNote([]), "");
  assert.equal(I.newChainsNote(undefined), "");
});

// ---- re-basing treatment alerts whose rows the rules moved (data.json meta.recl, C #112)
// the test checkAlerts used before: rebase when the id's latest meta.recl date is after the alert's day (a.rb || a.created)
const oldRule = (meta, id, since) => { let d = ""; for (const [dt, ks] of meta.recl || []) if (ks.includes(id)) d = dt; return !!d && d > since; };
const M = (updated, recl, extra = {}) => ({ updated, built: updated, recl, ...extra });
test("recl gap 1 (C #112): a rebuild of the same collection adds the id to that date's entry — the date test misses it", () => {
  // collection 10-14; the alert was made on 10-15 with build 1; build 2 (a rule fix merged, still collection 10-14) moves T1
  const b1 = M("2026-10-14", [["2026-10-14", ["T0"]]]), b2 = M("2026-10-14", [["2026-10-14", ["T0", "T1"]]]);
  assert.equal(oldRule(b2, "T1", "2026-10-15"), false);                                  // the gap
  const was = I.reclMark(b1, "T1", "2026-10-14.aaaa1111");
  assert.deepEqual(was, { u: "2026-10-14", v: "2026-10-14.aaaa1111", f: [] });
  assert.equal(I.reclRebase(was, I.reclMark(b2, "T1", "2026-10-14.bbbb2222")), "listed");
  assert.equal(I.reclRebase(was, I.reclMark(b2, "T9", "2026-10-14.bbbb2222")), "");      // an id no build moved: kept
});
test("recl gap 2: collected 10-18, built 10-19 — an alert made on 10-18 with the 10-14 data misses the 10-18 entry", () => {
  const before = M("2026-10-14", [["2026-10-14", ["T1"]]]), now = M("2026-10-18", [["2026-10-14", ["T1"]], ["2026-10-18", ["T1", "T2"]]]);
  assert.equal(oldRule(now, "T2", "2026-10-18"), false);                                 // the gap
  assert.equal(I.reclRebase(I.reclMark(before, "T2", "v1"), I.reclMark(now, "T2", "v2")), "listed");
  assert.equal(I.reclRebase(I.reclMark(before, "T1", "v1"), I.reclMark(now, "T1", "v2")), "listed");
  // the next open of the same build, and the next collection without a move: nothing
  const seen = I.reclMark(now, "T2", "v2");
  assert.equal(I.reclRebase(seen, I.reclMark(now, "T2", "v2")), "");
  assert.equal(I.reclRebase(seen, I.reclMark(M("2026-10-25", now.recl), "T2", "v3")), "");
});
test("recl: an entry that leaves meta.recl (12 kept) is no move; data older than the baseline's is", () => {
  const was = I.reclMark(M("2026-10-18", [["2026-08-02", ["T1"]], ["2026-10-18", ["T1"]]]), "T1", "v1");
  assert.equal(I.reclRebase(was, I.reclMark(M("2026-10-25", [["2026-10-18", ["T1"]]]), "T1", "v2")), "");
  assert.equal(I.reclRebase(was, I.reclMark(M("2026-10-14", []), "T1", "v0")), "older");   // a deploy rolled back
});
test("recl: the id already in its collection's entry (C #112's 33) — another build of that collection re-bases it", () => {
  const recl = [["2026-10-14", ["T1", "T2"]]], m = M("2026-10-14", recl);
  const was = I.reclMark(m, "T1", "2026-10-14.aaaa1111");
  assert.equal(I.reclRebase(was, I.reclMark(m, "T1", "2026-10-14.aaaa1111")), "");          // the same build again
  assert.equal(I.reclRebase(was, I.reclMark(m, "T1", "2026-10-14.bbbb2222")), "rebuilt");   // a rebuild may have moved it again
  // an id the collection's entry does not list keeps its comparison on a rebuild; so does the next collection
  assert.equal(I.reclRebase(I.reclMark(m, "T3", "2026-10-14.aaaa1111"), I.reclMark(m, "T3", "2026-10-14.bbbb2222")), "");
  assert.equal(I.reclRebase(was, I.reclMark(M("2026-10-18", recl), "T1", "2026-10-18.cccc3333")), "");
});
test("recl: a build not known (data-meta.json not read: version '') is never 'another build' — no false 'rebuilt' at the next open", () => {
  const m = M("2026-10-14", [["2026-10-14", ["T1"]]]);
  const unknown = I.reclMark(m, "T1", "");
  assert.equal(unknown.v, "");
  assert.equal(I.reclRebase(unknown, I.reclMark(m, "T1", "2026-10-14.aaaa1111")), "");     // the same build, its version read now
  assert.equal(I.reclRebase(I.reclMark(m, "T1", "2026-10-14.aaaa1111"), unknown), "");
  // the other rules still hold without a version: a new entry, older data
  assert.equal(I.reclRebase(unknown, I.reclMark(M("2026-10-18", [...m.recl, ["2026-10-18", ["T1"]]]), "T1", "")), "listed");
  assert.equal(I.reclRebase(I.reclMark(M("2026-10-18", m.recl), "T1", ""), unknown), "older");
});
test("recl: with meta.reclBuilt (one entry per build that moved rows) its stamps tell exactly", () => {
  const recl = [["2026-10-14", ["T1", "T2"]]];
  const b1 = M("2026-10-14", recl, { reclBuilt: [["2026-10-14#1", ["T1", "T2"]]] });
  const b2 = M("2026-10-14", recl, { reclBuilt: [["2026-10-14#1", ["T1", "T2"]], ["2026-10-14#2", ["T1"]]] });
  const w1 = I.reclMark(b1, "T1", "v1"), w2 = I.reclMark(b1, "T2", "v1");
  assert.deepEqual(w1, { u: "2026-10-14", v: "v1", f: ["2026-10-14", "b2026-10-14#1"], x: 1 });
  assert.equal(I.reclRebase(w1, I.reclMark(b2, "T1", "v2")), "listed");
  assert.equal(I.reclRebase(w2, I.reclMark(b2, "T2", "v2")), "");                          // build 2 did not move T2
  // a phone that did not open the app during build 2 still finds it on the next collection
  const next = M("2026-10-18", recl, { reclBuilt: b2.reclBuilt });
  assert.equal(I.reclRebase(w1, I.reclMark(next, "T1", "v3")), "listed");
});
test("recl: alerts saved before marks re-base once when the id is listed, else only get a mark", () => {
  const m = M("2026-10-18", [["2026-10-14", ["T1"]]]);
  assert.equal(I.reclRebase(undefined, I.reclMark(m, "T1", "v")), "legacy");
  assert.equal(I.reclRebase(undefined, I.reclMark(m, "T5", "v")), "");
  assert.equal(I.reclRebase({ u: "2026-10-18" }, I.reclMark(m, "T1", "v")), "legacy");     // a broken mark
  assert.deepEqual(I.reclMark(undefined, "T1", ""), { u: "", v: "", f: [] });
  assert.deepEqual(I.reclMark({ recl: [["2026-10-14", null], "x"] }, "T1", ""), { u: "", v: "", f: [] });
});
test("recl: the shipped data.json — meta.recl is [[collection date, [ids]]] up to meta.updated; the 'day' gap is real", () => {
  const meta = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "app", "data.json"), "utf8")).meta;
  assert.ok(Array.isArray(meta.recl) && meta.recl.length <= 12);
  for (const [d, ks] of meta.recl) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(d) && d <= meta.updated && Array.isArray(ks), d);
  if (!meta.recl.length) return;
  const [d, ks] = meta.recl[meta.recl.length - 1], id = ks[0];
  // an alert made on the day of the newest entry, with the build before it (that entry not there yet)
  const before = { ...meta, recl: meta.recl.slice(0, -1) };
  assert.equal(oldRule(meta, id, d), false);                                              // the gap
  assert.equal(I.reclRebase(I.reclMark(before, id, "old"), I.reclMark(meta, id, "new")), "listed");
});
test("rebaseAlert: the new baseline is what is listed now; nothing fires at the next check of the same values", () => {
  // newlow: base = now; no value now → no base, the next value is only a baseline
  let a = { type: "newlow", base: 120000, last: 120000, lastAt: "2026-10-14" };
  Object.assign(a, I.rebaseAlert(a, { value: 100000, count: 3 }));
  assert.equal(a.base, 100000); assert.equal(a.last, undefined); assert.equal(a.lastAt, undefined);
  assert.equal(I.evalAlert(a, { value: 100000 }, "2026-10-19").fire, false);
  a = { type: "newlow", base: 120000 };
  Object.assign(a, I.rebaseAlert(a, { value: null, count: 0 }));
  assert.equal(a.base, undefined);
  const r = I.evalAlert(a, { value: 90000 }, "2026-10-20");
  assert.equal(r.fire, false); assert.equal(r.patch.base, 90000);
  // newmatch: base = branch count now
  a = { type: "newmatch", base: 3 };
  Object.assign(a, I.rebaseAlert(a, { value: 1, count: 7 }));
  assert.equal(a.base, 7); assert.equal(I.evalAlert(a, { value: 1, count: 7 }, "2026-10-19").fire, false);
  assert.deepEqual(I.rebaseAlert({ type: "expiring", last: "2026-10-20" }, { value: 1 }), {});
});
test("rebaseAlert newmatch: no row in the region now is a count of 0, not 'no baseline' — a first branch later is news, as for a watch", () => {
  // alertNow gives {value: null, count: 0} when the alert's region has no row
  const a = { type: "newmatch", base: 3, lastAt: "2026-10-14" };
  Object.assign(a, I.rebaseAlert(a, { value: null, count: 0 }));
  assert.equal(a.base, 0); assert.equal(a.lastAt, undefined);
  assert.equal(I.evalAlert(a, { value: null, count: 0 }, "2026-10-19").fire, false);      // still none: nothing
  const r = I.evalAlert(a, { value: 50000, count: 2 }, "2026-10-20");
  assert.equal(r.fire, true); assert.equal(r.patch.base, 2); assert.match(r.text, /0곳 → 2곳/);
  // the watch, re-based on the same empty region, tells the same change
  const w = I.evalWatch({}, { low: null, lowB: "", set: [], count: 0 }, "2026-10-19").patch;
  assert.deepEqual(I.evalWatch(w, { low: 50000, lowB: "x|1", set: ["x|1", "y|2"], count: 2 }, "2026-10-20").events.map((e) => e.t), ["newmatch"]);
  // no reading at all (no now): no base, the next count is only a baseline
  assert.equal(I.rebaseAlert({ type: "newmatch", base: 3 }, null).base, undefined);
});
test("rebaseAlert target: a value under the target after the move counts as told — no notice now or at the next check", () => {
  // told 90,000 (target 100,000); after the move 95,000 is listed. The old re-base dropped `last` and told 95,000 at the
  // next open — news made by the new mix of rows, not by a price
  const told = { type: "target", target: 100000, last: 90000, lastAt: "2026-10-14" };
  const old = { ...told, ...I.evalAlert({ ...told, lastAt: "2026-10-19", base: null, last: null }, { value: 95000 }, "0000-00-00").patch };
  delete old.lastAt; delete old.last;
  assert.equal(I.evalAlert(old, { value: 95000 }, "2026-10-19").fire, true);              // the false notice
  const a = { ...told, ...I.rebaseAlert(told, { value: 95000 }) };
  assert.equal(a.last, 95000); assert.equal(a.lastAt, undefined);
  assert.equal(I.evalAlert(a, { value: 95000 }, "2026-10-19").fire, false);
  assert.equal(I.evalAlert(a, { value: 93000 }, "2026-10-20").fire, true);                // lower than 95,000: news (90,000 no longer blocks)
  // the move made it lower than what was told (99,000 → 95,000), or brought it under the target never told before
  // (120,000 → 95,000): the move is no news either
  for (const was of [{ ...told, last: 99000 }, { type: "target", target: 100000 }]) {
    const b = { ...was, ...I.rebaseAlert(was, { value: 95000 }) };
    assert.equal(b.last, 95000);
    assert.equal(I.evalAlert(b, { value: 95000 }, "2026-10-19").fire, false);
    assert.equal(I.evalAlert(b, { value: 94000 }, "2026-10-20").fire, true);
  }
  // now above the target: nothing kept, the next crossing fires
  const up = { ...told, ...I.rebaseAlert(told, { value: 130000 }) };
  assert.equal(up.last, undefined); assert.equal(I.evalAlert(up, { value: 99000 }, "2026-10-21").fire, true);
  // no value now (no row in the region): nothing kept, the next value under the target fires
  const none = { ...told, ...I.rebaseAlert(told, { value: null, count: 0 }) };
  assert.equal(none.last, undefined); assert.equal(I.evalAlert(none, { value: 95000 }, "2026-10-21").fire, true);
});
test("rebaseAlert target: like a watch's '목표가 이하' re-based on the same values — the move itself never tells a crossing", () => {
  const T = 100000, only = { target: true, drop: false, lowbranch: false, newmatch: false, lowended: false, recheck: false };
  const wNow = (v) => ({ low: v, lowB: "x|1", set: ["x|1"], count: 1 });
  // [value after the move, the next value]: under → same (no news) · over → under (a real crossing)
  for (const [moved, next, news] of [[95000, 95000, false], [130000, 99000, true]]) {
    for (const was of [{ type: "target", target: T }, { type: "target", target: T, last: 90000, lastAt: "2026-10-14" }, { type: "target", target: T, last: 99500 }]) {
      const t = { ...was, ...I.rebaseAlert(was, { value: moved }) };
      const w = { target: T, on: only, ...I.evalWatch({}, wNow(moved), "2026-10-19").patch };
      assert.equal(I.evalAlert(t, { value: next }, "2026-10-20").fire, news, JSON.stringify([was, moved, next]));
      assert.equal(I.evalWatch(w, wNow(next), "2026-10-20").events.some((e) => e.t === "target"), news);
    }
  }
});
