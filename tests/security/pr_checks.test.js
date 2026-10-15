// node --test tests/security/*.test.js (also in tests/run_regression.sh and the PR checks themselves) — keeps the PR checks
// honest: .github/scripts/pr_checks.sh must run every pre-deploy check of the price factory and every quick (no browser, no
// PostgreSQL) suite of tests/run_regression.sh, and .github/workflows/pr-checks.yml must stay read-only and secret-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const script = read(".github/scripts/pr_checks.sh");
const wf = read(".github/workflows/pr-checks.yml");
// the workflow without its comments (the header explains why pull_request_target is NOT used; that must not trip the check)
const wfCode = wf.split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, "")).join("\n");
const norm = (c) => c.trim().replace(/^python3? /, "python3 ").replace(/\s+/g, " ");
const scriptCmds = script.split("\n").filter((l) => /^check /.test(l.trim())).map((l) => {
  const m = l.trim().match(/^check\s+"[^"]*"\s+(.*)$/);
  return m ? norm(m[1].replace(/^bash -c "(.*)"$/, "$1")) : "";
});

test("pr_checks.sh runs every check tools/factory.sh runs before a deploy", () => {
  const sh = read("tools/factory.sh");
  const body = sh.slice(sh.indexOf("checks() {"), sh.indexOf("\n}", sh.indexOf("checks() {")));
  const cmds = body.split("\n").slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith("log ") && !l.startsWith("#"));
  assert.ok(cmds.length >= 5, "found the factory's checks");
  for (const c of cmds) assert.ok(scriptCmds.includes(norm(c)), `factory check missing from the PR checks: ${c}`);
});

test("pr_checks.sh runs every quick suite of run_regression.sh (browser and PostgreSQL suites stay in the full regression)", () => {
  const rr = read("tests/run_regression.sh");
  const lines = rr.split("\n").filter((l) => /^run "/.test(l));
  let quick = 0;
  for (const l of lines) {
    const m = l.match(/^run "[^"]*" (.*)$/);
    let cmd = m[1].replace(/^bash -c "(.*)"$/, "$1");
    if (/tests\/db\/|admin_ops_browser\.js|tests\/e2e\//.test(cmd)) continue;          // needs PostgreSQL, a browser or the PIN
    quick++;
    if (/^node --test cf\/[a-z]+\/test\/\*\.test\.mjs$/.test(cmd)) {                  // covered by the cf/*/test loop
      assert.match(script, /for d in cf\/\*\/test; do/);
      assert.ok(fs.existsSync(path.join(root, cmd.split(" ")[2].replace("/*.test.mjs", ""))));
      continue;
    }
    assert.ok(scriptCmds.includes(norm(cmd)), `regression suite missing from the PR checks: ${cmd}`);
  }
  assert.ok(quick >= 10, `found the quick regression suites (${quick})`);
});

test("pr-checks.yml: pull_request only (never pull_request_target), read-only token, no secrets, pinned actions, runs the script", () => {
  assert.match(wfCode, /^on:\n {2}pull_request:\n {4}branches: \[main\]/m);
  assert.doesNotMatch(wfCode, /pull_request_target/);
  assert.match(wfCode, /^permissions: \{\}/m);
  assert.match(wfCode, /permissions:\n {6}contents: read\n/);
  assert.doesNotMatch(wfCode, /contents: write|id-token|secrets\./);
  assert.match(wfCode, /persist-credentials: false/);
  for (const u of wfCode.match(/uses: \S+/g)) assert.match(u, /@[0-9a-f]{40}$/, `${u} is pinned to a full commit SHA`);
  assert.match(wfCode, /run: bash \.github\/scripts\/pr_checks\.sh/);
});

test("pr_checks.sh keeps going after a failure and fails the job at the end", () => {
  assert.match(script, /^set -u$/m);
  assert.doesNotMatch(script, /^set -e/m, "set -e would stop at the first failed suite and hide the rest");
  assert.match(script, /exit \$fail\s*$/);
});
