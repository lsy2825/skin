// node --test tests/security/*.test.js (also in tests/run_regression.sh) — guards on the regression script itself:
// 1. a server already answering on port 8766 must stop the run (2026-10-15: a stale server kept answering, so the e2e suites tested
//    an old copy of the app and reported failures that were not in the code);
// 2. the backup/restore suite needs data that a fresh checkout does not have: it must say SKIP out loud, never a bare FAIL or an OK.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const root = path.join(__dirname, "..", "..");
const script = fs.readFileSync(path.join(root, "tests/run_regression.sh"), "utf8");

test("run_regression.sh: the port guard comes before the server start and before any suite", () => {
  const guard = script.indexOf("already in use");
  const server = script.indexOf("python3 -m http.server");
  const firstRun = script.indexOf('\nrun "');
  assert.ok(guard > 0 && server > 0 && firstRun > 0);
  assert.ok(guard < server, "the guard runs before the script starts its own server");
  assert.ok(server < firstRun, "no suite runs before the server is up");
});

test("run_regression.sh: with port 8766 taken it stops with exit 1, says so, and runs no suite", async () => {
  const holder = http.createServer((q, r) => r.end("old app"));
  const mine = await new Promise((ok) => { holder.once("error", () => ok(false)); holder.listen(8766, "127.0.0.1", () => ok(true)); });
  try {
    const env = { ...process.env, APP_PIN: "x" };                // any value: the guard stops before a browser is opened
    const out = await new Promise((ok) => {
      const p = spawn("bash", ["tests/run_regression.sh"], { cwd: root, env });
      let t = ""; p.stdout.on("data", (d) => (t += d)); p.stderr.on("data", (d) => (t += d));
      const kill = setTimeout(() => p.kill("SIGKILL"), 20000);
      p.on("close", (code) => { clearTimeout(kill); ok({ code, t }); });
    });
    assert.equal(out.code, 1, out.t);
    assert.match(out.t, /FAIL \| port 8766 is already in use/);
    assert.doesNotMatch(out.t, /^OK /m, "no suite ran");
  } finally {
    if (mine) holder.close();                                    // never touches a server this test did not start
  }
});

test("run_regression.sh: backup/restore without data says SKIP and how to get the data; with data it runs the suite", () => {
  assert.match(script, /if \[ -f data2\/db\/offers\.csv \]; then run "backup \/ restore" bash tests\/db\/backup_restore_test\.sh/);
  assert.match(script, /SKIP \| backup \/ restore \| no data2\/db\/offers\.csv and no data2\/clean\.csv — run: python build2\/weekly\.py --skip-scrape && python build2\/export_db\.py/);
  assert.match(script, /if \[ ! -f data2\/db\/offers\.csv \] && \[ -f data2\/clean\.csv \]; then python3 build2\/export_db\.py/);
});
