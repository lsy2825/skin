// node --test tests/security/*.test.js (also in tests/run_regression.sh) — A6 round-2 guards that need no browser:
// the regression list no longer runs the two B-owned e2e files that assert on removed #ops cards, and the browser check
// unlocks the PIN screen only through APP_PIN (exit 2 without it, no gate bypass in the file).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("run_regression.sh: commerce50/admin51 are out (they expect #ops cards that are gone), the admin checks are in", () => {
  const sh = read("tests/run_regression.sh");
  const loop = sh.match(/^for t in (.+?); do$/m);
  assert.ok(loop, "e2e loop found");
  const names = loop[1].split(/\s+/);
  for (const gone of ["commerce50", "admin51"]) assert.ok(!names.includes(gone), `${gone} not in the e2e loop`);
  for (const kept of ["ops40", "clickable", "devices51"]) assert.ok(names.includes(kept), `${kept} still in the e2e loop`);
  assert.ok(/node tests\/security\/admin_ops_browser\.js/.test(sh), "browser check listed");
  assert.ok(/node --test cf\/admin\/test\/\*\.test\.mjs/.test(sh), "admin Worker tests listed");
  assert.ok(/node --test tests\/security\/\*\.test\.js/.test(sh), "this file listed");
  assert.ok(/\$\{APP_PIN:\?/.test(sh), "the suite itself requires APP_PIN");
});

// The PR checks run no browser, so an e2e script missing from this loop runs nowhere (B's alert_region, addon_col, cond_badge,
// spec_notes and new_chains sat outside it until 2026-10-16). Helper modules that only export code are named here.
test("run_regression.sh: every tests/e2e/*.js screen check is in the e2e loop (helpers excepted)", () => {
  const helpers = new Set(["rows"]);
  const names = read("tests/run_regression.sh").match(/^for t in (.+?); do$/m)[1].split(/\s+/);
  const scripts = fs.readdirSync(path.join(root, "tests/e2e")).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3));
  for (const h of helpers) {
    assert.ok(scripts.includes(h), `helper ${h}.js still exists (else drop it from this list)`);
    assert.match(read(`tests/e2e/${h}.js`), /module\.exports\s*=/, `${h}.js is a helper module, not a screen check`);
  }
  const missing = scripts.filter((n) => !helpers.has(n) && !names.includes(n));
  assert.deepEqual(missing, [], "add these to the e2e loop in tests/run_regression.sh");
  for (const n of names) assert.ok(scripts.includes(n), `the loop names tests/e2e/${n}.js, which does not exist`);
});

test("admin_ops_browser.js: exits 2 without APP_PIN and never unlocks the gate another way", () => {
  const src = read("tests/security/admin_ops_browser.js");
  for (const banned of ["pc:gate-ok", "gate.js", "GATE_HASH", "const HASH"]) assert.ok(!src.includes(banned), `no "${banned}" in the test`);
  assert.ok(/if \(!PIN\) \{[^\n]*process\.exit\(2\)/.test(src), "exit 2 branch present");
  const env = { ...process.env };
  delete env.APP_PIN;
  const r = spawnSync(process.execPath, [path.join(root, "tests/security/admin_ops_browser.js")], { env, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 2, `exit code (stdout: ${r.stdout.slice(0, 200)} stderr: ${r.stderr.slice(0, 200)})`);
  assert.match(r.stderr, /APP_PIN/);
  assert.equal(r.stdout.trim(), "", "nothing ran before the check");
});
