// node --test tests/*.test.js — price-data sync rules (app/domain/sync.js): what is trusted, what is saved, which state
const test = require("node:test");
const assert = require("node:assert/strict");
const Y = require("../app/domain/sync.js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const meta = { schema: 1, version: "2026-10-14.a9704227", updated: "2026-10-14", bytes: 5713226, sha256: "a970422715fd37e9e311b65451749beeba767834b1763a7e467cbca7fcfeb4c4", rows: 3, branches: 2 };
const data = { meta: { updated: "2026-10-14", rows: 3 }, branches: [[0, 1], [0, 2]], cols: [[1, 2, 3], [4, 5, 6]], keys: [], s: ["", "a", "b"] };

test("meta: a good meta passes; wrong schema, bad version, missing checksum are refused", () => {
  assert.deepEqual(Y.checkMeta(meta), []);
  assert.ok(Y.checkMeta({ ...meta, schema: 2 }).length);
  assert.ok(Y.checkMeta({ ...meta, version: "latest" }).length);
  assert.ok(Y.checkMeta({ ...meta, sha256: "" }).length);
  assert.ok(Y.checkMeta({ ...meta, version: "2026-10-14.deadbeef" }).length);   // version must carry the checksum's start
  assert.ok(Y.checkMeta(null).length && Y.checkMeta("x").length);
});
test("data: layout, counts, dates, duplicates and checksum are checked against the meta", () => {
  assert.deepEqual(Y.checkData(data, meta, meta.sha256), []);
  assert.deepEqual(Y.checkData(data, null), []);                                    // an old deploy without data-meta.json
  assert.ok(Y.checkData({ ...data, s: undefined }, meta).length);                   // missing section
  assert.ok(Y.checkData({ ...data, cols: [[1, 2], [4, 5, 6]] }, meta).length);       // a column shorter than the rows
  assert.ok(Y.checkData({ ...data, branches: [[0, 1], [0, 1]] }, meta).length);      // the same branch twice
  assert.ok(Y.checkData(data, { ...meta, updated: "2026-10-13" }).length);          // date differs from the meta
  assert.ok(Y.checkData(data, { ...meta, rows: 4 }).length);
  assert.ok(Y.checkData(data, meta, "0".repeat(64)).length);                        // corrupted transfer
  assert.ok(Y.checkData(null, meta).length);
  const rowsForm = { meta: data.meta, branches: data.branches, rows: [[0], [1], [2]], keys: [], s: data.s };
  assert.deepEqual(Y.checkData(rowsForm, null), []);                                 // the older row form is still read
  assert.ok(Y.checkData({ ...rowsForm, rows: [[0]] }, null).length);
});
test("states: loading, cached-while-downloading, ready, stale (old or offline), partial failure, error", () => {
  const base = { have: true, loading: false, fromCache: false, metaOk: true, newer: false, updated: "2026-10-14", today: "2026-10-15", stale: 0 };
  assert.equal(Y.stateOf({ have: false, loading: true }).state, "LOADING");
  assert.equal(Y.stateOf({ have: false, loading: false }).state, "ERROR");
  assert.equal(Y.stateOf(base).state, "READY");
  assert.equal(Y.stateOf({ ...base, fromCache: true, newer: true, loading: true }).state, "PARTIALLY_READY");
  const off = Y.stateOf({ ...base, fromCache: true, metaOk: false });
  assert.equal(off.state, "STALE"); assert.equal(off.offline, true);
  assert.equal(Y.stateOf({ ...base, today: "2026-10-30" }).state, "STALE");        // more than 8 days old
  assert.equal(Y.stateOf({ ...base, stale: 3 }).state, "PARTIALLY_FAILED");
  assert.equal(Y.stateOf({ ...base, fromCache: true, metaOk: true }).state, "READY");   // saved copy = server version
});
test("labels never say 실시간; progress is capped below 100 until done", () => {
  const l = Y.label({ state: "LOADING" }, { got: 5713226, total: 5713226 });
  assert.equal(l, "가격 받는 중 99%");
  for (const st of ["LOADING", "PARTIALLY_READY", "READY", "STALE", "PARTIALLY_FAILED", "ERROR"]) assert.ok(!/실시간/.test(Y.label({ state: st, offline: true }, { got: 1, total: 2, updated: "2026-10-14", stale: 1 })));
});
test("the repo's data-meta.json matches app/data.json (bytes, checksum, counts) and passes checkMeta", () => {
  const root = path.join(__dirname, "..", "app");
  const m = JSON.parse(fs.readFileSync(path.join(root, "data-meta.json"), "utf8"));
  const raw = fs.readFileSync(path.join(root, "data.json"));
  assert.deepEqual(Y.checkMeta(m), []);
  assert.equal(m.bytes, raw.length);
  assert.equal(m.sha256, crypto.createHash("sha256").update(raw).digest("hex"));
  const d = JSON.parse(raw.toString("utf8"));
  assert.deepEqual(Y.checkData(d, m, m.sha256), []);
});
