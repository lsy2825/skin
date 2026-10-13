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
