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
