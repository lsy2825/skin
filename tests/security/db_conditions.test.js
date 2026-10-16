// node --test tests/security/*.test.js (also in the PR checks) — the database only accepts the price-condition tags it lists:
// supabase/schema_platform.sql offer_conditions.condition check ⊇ build2/export_db.py COND (chat C's exporter). A tag the
// exporter writes but the check does not list would make the DB load (supabase/load_platform.sql) fail. '시간대' added
// 2026-10-16 for C's #83 (prices that only name hours, e.g. 12시-3시 런치 타임).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const schemaTags = () => {
  const m = read("supabase/schema_platform.sql").match(/condition\s+text not null check \(condition in \(([^)]*)\)\)/);
  assert.ok(m, "offer_conditions.condition check found");
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

test("the DB's condition check lists every tag the exporter writes (build2/export_db.py COND)", () => {
  const m = read("build2/export_db.py").match(/^COND = \[([^\]]*)\]/m);
  assert.ok(m, "COND list found in build2/export_db.py");
  const cond = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(cond.length >= 5, "COND has the known tags");
  const allowed = new Set(schemaTags());
  assert.deepEqual(cond.filter((t) => !allowed.has(t)), [], "add these to offer_conditions.condition in supabase/schema_platform.sql (chat A) first");
});

test("'시간대' is an allowed condition (C #83), and the check has no duplicates", () => {
  const tags = schemaTags();
  assert.ok(tags.includes("시간대"));
  assert.equal(new Set(tags).size, tags.length);
});
