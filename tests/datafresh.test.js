// app/data.json freshness invariants (build2/appdata.py): meta.updated is the collection — the day most branches were read (what the app
// calls '수집'), meta.built the build date; a branch is STALE only when its data is more than a day older than that
// newest collection — a rebuild without scraping on a later day (a code push) must not call every branch old.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "../app/data.json"), "utf8"));
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

test("meta.updated = the day most branches were collected (newest on a tie); built is not earlier", () => {
  const n = {};
  for (const b of D.branches) { const d = D.s[b[7]]; if (d) n[d] = (n[d] || 0) + 1; }
  const mode = Object.keys(n).sort((a, b) => n[b] - n[a] || (a < b ? 1 : -1))[0];
  assert.equal(D.meta.updated, mode, JSON.stringify(n));
  if (D.meta.built) assert.ok(D.meta.built >= D.meta.updated, `${D.meta.built} < ${D.meta.updated}`);
});

test("STALE exactly when a branch's data is more than a day older than the collection", () => {
  for (const b of D.branches) {
    const d = D.s[b[7]], st = D.s[b[8]], old = !d || days(d, D.meta.updated) > 1;   // newer than the collection (a brand added later) is not old
    assert.equal(st, old ? "STALE" : "VERIFIED", `${D.s[b[1]]} ${d} ${st}`);
  }
});
