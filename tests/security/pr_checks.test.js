// node --test tests/security/*.test.js (also in tests/run_regression.sh and the PR checks themselves) — keeps the PR checks
// honest: .github/scripts/pr_checks.sh must run every pre-deploy check of the price factory and every quick (no browser, no
// PostgreSQL) suite of tests/run_regression.sh; every workflow that runs a pull request's code must stay read-only and
// secret-free. Same-repo PRs run the workflow files as the PR changed them, so this is a safety net against mistakes, not a
// security boundary — it must still catch the common ones (a write permission, a token, a secret, an injected PR title).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const script = read(".github/scripts/pr_checks.sh");

// a YAML/shell line without its comment: whole-line comments go; a trailing " #…" goes only when the quotes before it are
// balanced (so a '#' inside a quoted value is kept and still checked)
function stripComment(line) {
  if (/^\s*#/.test(line)) return "";
  for (let i = line.indexOf(" #"); i !== -1; i = line.indexOf(" #", i + 1)) {
    const before = line.slice(0, i);
    if ((before.match(/"/g) || []).length % 2 === 0 && (before.match(/'/g) || []).length % 2 === 0) return before;
  }
  return line;
}
const code = (text) => text.split("\n").map(stripComment).join("\n");
const norm = (c) => stripComment(c).trim().replace(/^python3? /, "python3 ").replace(/\s+/g, " ");
const scriptCmds = code(script).split("\n").filter((l) => /^check /.test(l.trim())).map((l) => {
  const m = l.trim().match(/^check\s+"[^"]*"\s+(.*)$/);
  assert.ok(m, `unparsable check line: ${l}`);
  return norm(m[1].replace(/^bash -c "(.*)"$/, "$1"));
});

test("pr_checks.sh runs every check tools/factory.sh runs before a deploy", () => {
  const sh = read("tools/factory.sh");
  const body = sh.slice(sh.indexOf("checks() {"), sh.indexOf("\n}", sh.indexOf("checks() {")));
  const cmds = code(body).split("\n").slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith("log "));
  assert.ok(cmds.length >= 6, "found the factory's checks");
  for (const c of cmds) assert.ok(scriptCmds.includes(norm(c)), `factory check missing from the PR checks: ${c}`);
});

test("pr_checks.sh runs every quick suite of run_regression.sh, wherever the run line sits (loops and ifs included)", () => {
  const rr = code(read("tests/run_regression.sh"));
  const runs = [...rr.matchAll(/\brun\s+(["'])(.*?)\1\s+([^;\n]+?)\s*(?=;|$)/gm)];
  const named = rr.split("\n").filter((l) => /\brun\s+["']/.test(l)).length;
  assert.equal(runs.length, named, "every line with a run call was parsed (none skipped)");
  let quick = 0;
  for (const m of runs) {
    const cmd = m[3].replace(/^bash -c "(.*)"$/, "$1").trim();
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

test("a new test file is not forgotten: every tests/*_test.py, tests/security/*_test.py and server/test/*.test.mjs is in the PR checks", () => {
  const files = [
    ...fs.readdirSync(path.join(root, "tests")).filter((f) => /_test\.py$/.test(f)).map((f) => `tests/${f}`),
    ...fs.readdirSync(path.join(root, "tests/security")).filter((f) => /_test\.py$/.test(f)).map((f) => `tests/security/${f}`),
    ...fs.readdirSync(path.join(root, "server/test")).filter((f) => /\.test\.mjs$/.test(f)).map((f) => `server/test/${f}`),
  ];
  assert.ok(files.length >= 8, `found the test files (${files.length})`);
  const text = code(script);
  for (const f of files) {
    const name = f.startsWith("server/") ? f.replace("server/", "") : f;      // server tests run from cd server
    assert.ok(text.includes(name), `${f} runs nowhere automatically — add it to .github/scripts/pr_checks.sh (and to tools/factory.sh checks() or tests/run_regression.sh if it guards deploys or the regression)`);
  }
});

// every workflow that runs a pull request's code
const prWorkflows = fs.readdirSync(path.join(root, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ f, text: read(`.github/workflows/${f}`) })).filter(({ text }) => /^\s+pull_request:/m.test(code(text)));

test("no workflow uses pull_request_target", () => {
  for (const f of fs.readdirSync(path.join(root, ".github/workflows")))
    assert.doesNotMatch(code(read(`.github/workflows/${f}`)), /pull_request_target/, f);
});

test("workflows that run PR code: read-only token, no secrets or tokens, pinned actions, no PR text in commands", () => {
  const names = prWorkflows.map((w) => w.f).sort();
  for (const want of ["db-security.yml", "pr-build.yml", "pr-checks.yml"]) assert.ok(names.includes(want), `${want} found`);
  for (const { f, text } of prWorkflows) {
    const c = code(text);
    assert.doesNotMatch(c, /\bsecrets\b/, `${f}: no secret of any form (secrets.X, secrets['X'], toJSON(secrets), inherit)`);
    assert.doesNotMatch(c, /github\.token|GITHUB_TOKEN/, `${f}: the token is never handed to a step`);
    assert.doesNotMatch(c, /write-all|read-all|:\s*write\b/, `${f}: no write permission`);
    assert.doesNotMatch(c, /github\.event\.pull_request\.(title|body|head)|github\.head_ref/, `${f}: PR-controlled text never reaches a command`);
    const lines = c.split("\n");
    lines.forEach((l, i) => {
      const m = l.match(/^(\s*)permissions:\s*(.*)$/);
      if (!m) return;
      if (m[2].trim() === "{}") return;
      assert.equal(m[2].trim(), "", `${f}:${i + 1}: permissions is {} or a block`);
      const block = [];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || lines[j].match(/^(\s*)/)[1].length > m[1].length); j++)
        if (lines[j].trim()) block.push(lines[j].trim());
      assert.deepEqual(block, ["contents: read"], `${f}:${i + 1}: the only permission is contents: read`);
    });
    const checkouts = (c.match(/uses:\s*actions\/checkout@/g) || []).length;
    assert.ok(checkouts >= 1, `${f}: checks out the code`);
    assert.equal((c.match(/persist-credentials:\s*false/g) || []).length, checkouts, `${f}: every checkout has persist-credentials: false`);
    for (const u of c.match(/uses:\s*\S+/g) || []) assert.match(u, /@[0-9a-f]{40}$/, `${f}: ${u} is pinned to a full commit SHA`);
  }
});

test("pr-checks.yml runs on EVERY pull request (no paths filter: the secret scan must see doc-only PRs) on a fixed image", () => {
  const c = code(read(".github/workflows/pr-checks.yml"));
  assert.match(c, /^on:\n {2}pull_request:\n {4}branches: \[main\]\n/m);
  assert.doesNotMatch(c, /paths(-ignore)?:/);
  assert.match(c, /runs-on: ubuntu-\d\d\.\d\d/);
  assert.match(c, /run: bash \.github\/scripts\/pr_checks\.sh/);
});

test("every job of every workflow runs on a fixed image, never *-latest (ubuntu-latest moved to Ubuntu 26 on 2026-10-19)", () => {
  let jobs = 0;
  for (const f of fs.readdirSync(path.join(root, ".github/workflows")).filter((x) => /\.ya?ml$/.test(x))) {
    const c = code(read(`.github/workflows/${f}`));
    assert.doesNotMatch(c, /(ubuntu|windows)-latest/, `${f}: pin the image (ubuntu-24.04, windows-2022); move to a newer one on purpose, in a PR`);
    for (const m of c.matchAll(/^\s*runs-on:\s*(.*)$/gm)) {
      jobs++;
      const img = m[1].trim();
      // Windows only for pr-checks.yml's windows-unit job (2026-10-17): everything else stays on Ubuntu
      if (f === "pr-checks.yml" && img === "windows-2022") continue;
      assert.match(img, /^ubuntu-\d\d\.\d\d$/, `${f}: runs-on "${img}" is a fixed Ubuntu version`);
    }
  }
  assert.ok(jobs >= 10, `found the jobs (${jobs})`);
});

test("pr-checks.yml windows-unit: the unit tests on Windows the way setup.ps1 runs them, failures as annotations", () => {
  const raw = read(".github/workflows/pr-checks.yml");
  const at = raw.indexOf("\n  windows-unit:\n");
  assert.ok(at > 0, "the job exists");
  const job = raw.slice(at);
  const quick = raw.slice(raw.indexOf("\n  quick:\n"), at);
  assert.match(job, /runs-on: windows-2022/);
  assert.match(job, /permissions:\n {6}contents: read\n/);
  assert.match(job, /git config --global core\.autocrlf false\n[\s\S]*uses: actions\/checkout@/, "line ends like the owner's PC, set before the checkout");
  for (const k of ["node-version", "python-version"]) assert.equal(job.match(new RegExp(`${k}: "([\\d.]+)"`))[1], quick.match(new RegExp(`${k}: "([\\d.]+)"`))[1], `same ${k} as the quick job (and as setup.ps1)`);
  assert.match(job, /shell: powershell\n/, "Windows PowerShell 5.1, as on the owner's PC");
  assert.match(job, /\(Join-Path \$gitRoot 'bin'\) \+ ';' \+ \(Join-Path \$gitRoot 'usr\\bin'\) \+ ';' \+ \$env:Path/, "Git Bash's bash and git first, like setup.ps1");
  assert.match(job, /'--test', '--test-reporter=tap', 'tests\/\*\.test\.js'/);
  assert.match(job, /node \.github\/scripts\/tap_annotate\.js \$out\n[\s\S]*exit \$p\.ExitCode/, "annotations, then the job fails when a test failed");
  const ps = read("tools/windows/setup.ps1");
  assert.ok(ps.includes("(Join-Path $gitRoot 'bin') + ';' + (Join-Path $gitRoot 'usr\\bin') + ';' + $env:Path"), "setup.ps1 sets PATH the same way");
});

test("tap_annotate.js: one annotation per failing test with its file and line, totals printed, subtest parents skipped", () => {
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "tap-"));
  const tap = path.join(tmp, "u.tap");
  fs.writeFileSync(tap, [
    "TAP version 13",
    "# Subtest: works", "ok 1 - works", "  ---", "  duration_ms: 1", "  ...",
    "# Subtest: breaks on windows", "not ok 2 - breaks on windows", "  ---", "  duration_ms: 1",
    "  location: 'D:\\\\a\\\\skin\\\\skin\\\\tests\\\\factory_worker.test.js:365:1'", "  failureType: 'testCodeFailure'",
    "  error: |-", "    Expected values to be strictly equal:", "    null !== 0", "  code: 'ERR_ASSERTION'", "  ...",
    "# Subtest: parent", "not ok 3 - parent", "  ---", "  failureType: 'subtestsFailed'", "  error: '1 subtest failed'", "  ...",
    "# Subtest: skipped", "ok 4 - skipped # SKIP needs pwsh", "  ---", "  ...",
    "1..4", "# tests 4", "# pass 2", "# fail 2", "# skipped 1", "",
  ].join("\r\n"));
  const r = require("child_process").spawnSync(process.execPath, [path.join(root, ".github/scripts/tap_annotate.js"), tap], { encoding: "utf8" });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  const errs = r.stdout.split("\n").filter((l) => l.startsWith("::error"));
  assert.equal(errs.length, 1, r.stdout);
  assert.match(errs[0], /^::error file=tests\/factory_worker\.test\.js,line=365,title=Windows%3A breaks on windows::Expected values to be strictly equal: null !== 0$/);
  for (const t of ["# tests 4", "# pass 2", "# fail 2", "# skipped 1"]) assert.ok(r.stdout.includes(t), t);
  const none = require("child_process").spawnSync(process.execPath, [path.join(root, ".github/scripts/tap_annotate.js"), path.join(root, "no-such.tap")], { encoding: "utf8" });
  assert.equal(none.status, 0);
  assert.match(none.stdout, /^::error title=Windows unit tests::no TAP output/m, "a missing file is an annotation, the exit code still comes from node --test");
});

test("pr-build.yml runs the factory's build commands on build-affecting PRs", () => {
  const c = code(read(".github/workflows/pr-build.yml"));
  const sh = read("tools/factory.sh");
  const body = code(sh.slice(sh.indexOf("build() {"), sh.indexOf("\n}", sh.indexOf("build() {"))));
  assert.match(body, /python build2\/weekly\.py/);
  assert.match(body, /node tools\/review_queue\.js/);
  assert.match(c, /run: python build2\/weekly\.py --skip-scrape/);
  assert.match(c, /run: node tools\/review_queue\.js/);
  for (const p of ["build2/**", "data2/**", "knowledge/**", "scrape/**", "tools/review_queue.js"]) assert.ok(c.includes(`"${p}"`), `pr-build watches ${p}`);
});

test("pr_checks.sh keeps going after a failure, limits each suite, shows the whole reason, fails the job at the end", () => {
  assert.match(script, /^set -u$/m);
  assert.doesNotMatch(script, /^set -e/m, "set -e would stop at the first failed suite and hide the rest");
  assert.match(script, /timeout -k 10 300 "\$@"/);
  assert.match(script, /tail -n 150/);
  assert.match(script, /exit \$fail\s*$/);
});
