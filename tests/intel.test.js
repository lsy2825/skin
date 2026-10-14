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
