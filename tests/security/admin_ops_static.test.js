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

// The PR checks run no browser, so an e2e script outside the regression ran nowhere (B's alert_region, addon_col, cond_badge,
// spec_notes and new_chains until 2026-10-16). Now the named loop is followed by a catch-all over tests/e2e/*.js, so a new
// screen check from chat B runs without waiting for A to edit the list; helper modules are skipped by name.
test("run_regression.sh: every tests/e2e/*.js screen check runs (named loop + catch-all), helpers skipped, no stale names", () => {
  const sh = read("tests/run_regression.sh");
  const names = sh.match(/^for t in (.+?); do$/m)[1].split(/\s+/);
  const helpers = sh.match(/^E2E_HELPERS=" (.*) "$/m)[1].split(/\s+/).filter(Boolean);
  const scripts = fs.readdirSync(path.join(root, "tests/e2e")).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3));
  for (const h of helpers) {
    assert.ok(scripts.includes(h), `helper ${h}.js still exists (else drop it from E2E_HELPERS)`);
    assert.match(read(`tests/e2e/${h}.js`), /module\.exports\s*=/, `${h}.js is a helper module, not a screen check`);
    assert.ok(!names.includes(h), `${h} is a helper, not in the named loop`);
  }
  for (const n of names) assert.ok(scripts.includes(n), `the loop names tests/e2e/${n}.js, which does not exist`);
  assert.match(sh, /^E2E_LISTED=" \$\(sed -n 's\/\^for t in /m, "the catch-all reads the named list from this same file");
  assert.match(sh, /^for f in tests\/e2e\/\*\.js; do\n  t=\$\(basename "\$f" \.js\)\n  case "\$E2E_LISTED\$E2E_HELPERS" in \*" \$t "\*\) continue ;; esac\n  run "e2e \$t \(not yet in the list above\)" node "\$f"\ndone$/m);
  // run the catch-all's selection for real: it must pick exactly the scripts the named loop and the helpers leave out
  const pick = spawnSync("bash", ["-c", `cd "${root}"; ${sh.match(/^E2E_LISTED=.*$/m)[0].replace('"$0"', '"tests/run_regression.sh"')}; ${sh.match(/^E2E_HELPERS=.*$/m)[0]}; for f in tests/e2e/*.js; do t=$(basename "$f" .js); case "$E2E_LISTED$E2E_HELPERS" in *" $t "*) continue ;; esac; echo "$t"; done`], { encoding: "utf8" });
  assert.equal(pick.status, 0, pick.stderr);
  assert.deepEqual(pick.stdout.split("\n").filter(Boolean), scripts.filter((n) => !names.includes(n) && !helpers.includes(n)));
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
