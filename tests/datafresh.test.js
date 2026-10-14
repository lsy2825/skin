// app/data.json freshness invariants (build2/appdata.py): meta.updated is the newest collection in the file (what the app
// calls '수집'), meta.built the build date; a branch is STALE only when its data is more than a day older than that
// newest collection — a rebuild without scraping on a later day (a code push) must not call every branch old.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "../app/data.json"), "utf8"));
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

test("meta.updated = the newest branch collection date; built is not earlier", () => {
  const dates = D.branches.map((b) => D.s[b[7]]).filter(Boolean).sort();
  assert.equal(D.meta.updated, dates[dates.length - 1]);
  if (D.meta.built) assert.ok(D.meta.built >= D.meta.updated, `${D.meta.built} < ${D.meta.updated}`);
});

test("STALE exactly when a branch's data is more than a day older than the newest collection", () => {
  for (const b of D.branches) {
    const d = D.s[b[7]], st = D.s[b[8]], old = !d || days(d, D.meta.updated) > 1;
    assert.equal(st, old ? "STALE" : "VERIFIED", `${D.s[b[1]]} ${d} ${st}`);
  }
});
