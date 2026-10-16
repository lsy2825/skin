// node --test tests/*.test.js — the Cloudflare price-factory manager's rules (cf/factory/src/runs.js): which manual runs are
// allowed, secrets compared safely, the run log keeps no tokens, the factory's own saves never re-trigger a build.
// The container side (entry.sh + tools/factory.sh) is checked by running the image: docs/CLOUDFLARE_MIGRATION.md §4.
// tools/factory.sh deploy() is run here with a fake wrangler (public Worker must deploy, the admin Worker may fail loudly).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
// import() takes a URL: a bare Windows path (C:\\…) is read as the scheme "c:" and refused (2026-10-17, owner's PC)
const load = () => import(require("url").pathToFileURL(path.join(__dirname, "../cf/factory/src/runs.js")).href);
// workflow text with LF line ends: a checkout with core.autocrlf=true (Windows) has CRLF, and the job/step finders look for "\n"
const readText = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// The machine's environment without the variables that change what the scripts under test do: git's own (a git hook's GIT_DIR
// would point the test at a real repository) and the factory's — these tests run inside factory runs: the GitHub factory job
// has FACTORY_DEPLOY=separate and FACTORY_INSTALL=1, the Cloudflare box FACTORY_RESULT_FILE and, on a trial run,
// FACTORY_NO_PUSH=1. A test that wants one of them sets it itself.
function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(GIT_|FACTORY_)/.test(k)) env[k] = v;
  return { ...env, ...extra };
}

// run only deploy() from tools/factory.sh, under the script's own `set -euo pipefail`, with a fake wrangler that records its
// arguments and fails on the config named in FAKE_FAIL ("public" = the root config, "admin" = cf/admin)
function runDeploy({ fail = "", token = "tok", github = false, pub = "on", separate = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-deploy-"));
  const calls = path.join(dir, "calls");
  fs.writeFileSync(path.join(dir, "wrangler"), [
    "#!/usr/bin/env bash",
    'echo "token=${CLOUDFLARE_API_TOKEN:-} args=$*" >> "$CALLS"',
    'case "$*" in *cf/admin/*) [ "$FAKE_FAIL" = admin ] && { echo "fake: admin deploy FAILS"; exit 1; } ;; *) [ "$FAKE_FAIL" = public ] && { echo "fake: public deploy FAILS"; exit 1; } ;; esac',
    "exit 0",
  ].join("\n") + "\n", { mode: 0o755 });
  const sh = fs.readFileSync(path.join(__dirname, "../tools/factory.sh"), "utf8");
  const fn = sh.slice(sh.indexOf("deploy() {"), sh.indexOf("\n}", sh.indexOf("deploy() {")) + 2);
  const script = `set -euo pipefail\nMODE=test\nDEPLOY_TOKEN=${JSON.stringify(token)}\nWRANGLER=${JSON.stringify(path.join(dir, "wrangler"))}\n` +
    `log() { echo "== factory[$MODE]: $*"; }\n${fn}\ndeploy\necho after-deploy\n`;
  const out = path.join(dir, "github_output");
  const env = cleanEnv({ CALLS: calls, FAKE_FAIL: fail, GITHUB_OUTPUT: out });
  if (separate) env.FACTORY_DEPLOY = "separate";
  delete env.GITHUB_ACTIONS;
  if (github) env.GITHUB_ACTIONS = "true";
  delete env.PUBLIC_DEPLOY;
  if (pub !== null) env.PUBLIC_DEPLOY = pub;
  const r = spawnSync("bash", ["-c", script], { cwd: path.join(__dirname, ".."), env, encoding: "utf8" });
  const lines = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [];
  const ghOut = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: r.stdout + r.stderr, calls: lines, ghOut };
}

test("factory deploy: public Worker then admin Worker, same token; both deploys succeed → no warning", () => {
  const r = runDeploy();
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.calls, ["token=tok args=deploy", "token=tok args=deploy --config cf/admin/wrangler.jsonc"]);
  assert.match(r.out, /after-deploy/);
  assert.ok(!/NOT deployed|::warning/.test(r.out), r.out);
});

test("factory deploy: a failed admin deploy is reported but does not fail the run (GitHub warning only on Actions)", () => {
  const r = runDeploy({ fail: "admin" });
  assert.equal(r.status, 0, r.out);
  assert.equal(r.calls.length, 2, "both deploys attempted");
  assert.match(r.out, /admin host NOT deployed/);
  assert.match(r.out, /after-deploy/, "the script goes on to `result ok` / `log done`");
  assert.ok(!r.out.includes("::warning"), "no GitHub annotation outside Actions");
  const gh = runDeploy({ fail: "admin", github: true });
  assert.equal(gh.status, 0, gh.out);
  assert.match(gh.out, /^::warning title=Cloudflare::yoonsiljang-admin/m);
});

test("factory deploy: a failed public deploy still fails the run, before the admin deploy", () => {
  const r = runDeploy({ fail: "public" });
  assert.notEqual(r.status, 0, r.out);
  assert.deepEqual(r.calls, ["token=tok args=deploy"], "admin deploy not attempted");
  assert.ok(!r.out.includes("after-deploy"));
});

test("factory deploy: public hosting paused (PUBLIC_DEPLOY unset or anything but 'on') → admin host only; an admin failure then fails the run", () => {
  for (const pub of [null, "", "off", "ON", "yes", "on "]) {
    const r = runDeploy({ pub });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.calls, ["token=tok args=deploy --config cf/admin/wrangler.jsonc"], `PUBLIC_DEPLOY=${JSON.stringify(pub)}: only the admin Worker`);
    assert.match(r.out, /public app NOT deployed/);
    assert.match(r.out, /after-deploy/);
    assert.ok(!r.out.includes("::notice"), "no GitHub annotation outside Actions");
  }
  const gh = runDeploy({ pub: null, github: true });
  assert.match(gh.out, /^::notice title=Cloudflare::public app not deployed \(PUBLIC_DEPLOY off\)/m);
  const bad = runDeploy({ pub: null, fail: "admin", github: true });
  assert.notEqual(bad.status, 0, "public hosting paused: the admin host is the only fresh copy, so its failed deploy fails the run (→ Telegram)");
  assert.match(bad.out, /^::warning title=Cloudflare::yoonsiljang-admin/m);
  assert.match(bad.out, /public hosting is paused, so this fails the run/);
  assert.ok(!bad.out.includes("after-deploy"));
});

test("weekly.yml hands PUBLIC_DEPLOY to the deploy step (a repository variable, no secret)", () => {
  const wf = readText(path.join(__dirname, "../.github/workflows/weekly.yml"));
  assert.match(wf, /^ {10}PUBLIC_DEPLOY: \$\{\{ vars\.PUBLIC_DEPLOY \}\}/m);
});

test("factory deploy on GitHub (FACTORY_DEPLOY=separate): no wrangler at all, the saved commit is named for the deploy job", () => {
  const r = runDeploy({ token: "", separate: true });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.calls, [], "the factory job never deploys");
  assert.match(r.ghOut, /^deploy=true$/m);
  assert.match(r.ghOut, /^sha=[0-9a-f]{40}$/m);
  assert.match(r.out, /deploy handed to the separate deploy job/);
  const leaked = runDeploy({ token: "tok", separate: true, github: true });
  assert.deepEqual(leaked.calls, [], "even a token that reached the factory job by mistake is not used there");
  assert.match(leaked.out, /^::warning title=Cloudflare::CLOUDFLARE_API_TOKEN was handed to the factory job/m);
});

// the real script in deploy mode, with a fake wrangler (no network): deploys only; refuses to run without a token or when told
// to hand the deploy on again
function runMode(mode, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-mode-"));
  const calls = path.join(dir, "calls");
  fs.writeFileSync(path.join(dir, "wrangler"), '#!/usr/bin/env bash\necho "token=${CLOUDFLARE_API_TOKEN:-} args=$*" >> "$CALLS"\n', { mode: 0o755 });
  const e = cleanEnv({ CALLS: calls, WRANGLER: path.join(dir, "wrangler"), PUBLIC_DEPLOY: "", ...env });
  for (const k of ["GITHUB_ACTIONS", "GITHUB_OUTPUT"]) delete e[k];
  for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
  const r = spawnSync("bash", [path.join(__dirname, "../tools/factory.sh"), mode], { env: e, encoding: "utf8" });
  const lines = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: r.stdout + r.stderr, calls: lines };
}

test("factory.sh deploy mode (weekly.yml deploy job): deploys only, needs the token, never hands the deploy on", () => {
  const ok = runMode("deploy", { CLOUDFLARE_API_TOKEN: "tok", FACTORY_DEPLOY: undefined });
  assert.equal(ok.status, 0, ok.out);
  assert.deepEqual(ok.calls, ["token=tok args=deploy --config cf/admin/wrangler.jsonc"], "public hosting paused → admin host only");
  assert.ok(!/unit tests|build /.test(ok.out), "no tests, no build, no scraping in deploy mode");
  const none = runMode("deploy", { CLOUDFLARE_API_TOKEN: "", FACTORY_DEPLOY: undefined });
  assert.equal(none.status, 1, none.out);
  assert.deepEqual(none.calls, []);
  assert.match(none.out, /deploy mode needs CLOUDFLARE_API_TOKEN/);
  const loop = runMode("deploy", { CLOUDFLARE_API_TOKEN: "tok", FACTORY_DEPLOY: "separate" });
  assert.equal(loop.status, 2, loop.out);
  assert.deepEqual(loop.calls, []);
});

// a job block of a workflow file (from "  <name>:" to the next job or the end)
function job(wf, name) {
  const start = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `the workflow has a ${name} job`);
  const rest = wf.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z_]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}
const stripComments = (t) => t.split("\n").map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");
const WF = path.join(__dirname, "../.github/workflows/weekly.yml");
// any ${{ … secrets … }} expression: secrets.X, secrets['X'], toJSON(secrets), with or without spaces
const SECRET = /\$\{\{[^}]*\bsecrets\b/;
// the steps of a job, split at "      - " (a step's comments above it stay with the step before)
const stepsOf = (block) => block.split(/\n      - /).slice(1);
// For every ${{ … secrets … }} in a job block: the first line of the step it sits in ("name: …"), or null when it is not
// inside a step — a job-level key (env:, outputs:, …), wherever it stands, even after the steps list.
function secretOwners(block) {
  const lines = block.split("\n");
  const owner = (i) => {
    for (let j = i; j >= 0; j--) {
      const l = lines[j];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      if (/^ {6}- /.test(l)) return l.slice(8);
      if (l.match(/^ */)[0].length <= 6) return null;
    }
    return null;
  };
  return [...block.matchAll(new RegExp(SECRET.source, "g"))].map((m) => owner(block.slice(0, m.index).split("\n").length - 1));
}
// the `run: |` script of a named step, as bash gets it (block indentation removed)
function stepScript(wf, jobName, stepName) {
  const lines = job(wf, jobName).split("\n");
  const at = lines.findIndex((l) => l.includes(`- name: ${stepName}`));
  assert.ok(at > 0, `${jobName} has the step "${stepName}"`);
  const runAt = lines.findIndex((l, i) => i > at && /^\s+run: \|$/.test(l));
  const indent = lines[runAt + 1].match(/^\s*/)[0];
  const body = [];
  for (let i = runAt + 1; i < lines.length && (lines[i].startsWith(indent) || !lines[i].trim()); i++) body.push(lines[i].slice(indent.length));
  return body.join("\n");
}

// A git/bash environment cut off from the machine's own git setup: no GIT_* and no FACTORY_* variables at all (cleanEnv),
// no global or system git config (commit signing, Windows' core.autocrlf=true), HOME in the temp folder. Every git and bash
// call of the executable tests below uses it.
function sandbox(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(tmp, "home");
  fs.mkdirSync(home);
  const env = cleanEnv({ HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
  const gitRaw = (cwd, args, input) => {
    const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=t", "-c", "user.email=t@x.invalid", "-c", "init.defaultBranch=main", ...args], { cwd, env, encoding: "utf8", input });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${r.stderr}`);
    return r.stdout;
  };
  const git = (cwd, args, input) => gitRaw(cwd, args, input).trim();
  // like an Actions `run:` step (shell: bash → bash --noprofile --norc -eo pipefail)
  const bash = (cwd, script, extra = {}) => spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { cwd, env: { ...env, ...extra }, encoding: "utf8" });
  return { tmp, env, git, gitRaw, bash, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}
const write = (dir, f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
const sha256 = (t) => require("crypto").createHash("sha256").update(t).digest("hex");

test("weekly.yml: no secret at the workflow level, none in the factory job, in the deploy job only in the token check and the deploy step", () => {
  const raw = readText(WF);   // the raw text: a comment-stripper could be fooled by a quoted " #"
  const jobsAt = raw.indexOf("\njobs:\n");
  assert.ok(jobsAt > 0);
  const head = raw.slice(0, jobsAt);
  assert.doesNotMatch(head, /env:/, "no workflow-level env: it would reach every job, the factory job too");
  assert.doesNotMatch(head, SECRET);
  // a YAML alias (*name) could copy a secret-bearing env: into another step without the text checks below seeing it
  assert.doesNotMatch(raw, /^[^#\n]*(:|-)\s+[&*][A-Za-z_][\w-]*\s*$|<<:/m, "no YAML anchors or aliases");
  for (const name of ["update", "deploy", "alert"]) {
    const block = job(raw, name);
    const firstStep = block.search(/\n      - /);
    assert.ok(firstStep > 0, `${name} has steps`);
    assert.doesNotMatch(block.slice(0, firstStep), SECRET, `${name}: no secret at job level (it would reach every step — checkout and installs too)`);
    assert.ok(!secretOwners(block).includes(null), `${name}: every secret sits inside a step (none in a job-level key, even one after the steps list)`);
  }
  const update = job(raw, "update");
  assert.doesNotMatch(update, SECRET, "no secret of any kind in the job that runs scrapers, pip packages and build code");
  assert.doesNotMatch(stripComments(update), /CLOUDFLARE_API_TOKEN/);
  const deploy = job(raw, "deploy");
  const steps = stepsOf(deploy);
  const withSecret = [...new Set(secretOwners(deploy))];
  assert.deepEqual(withSecret, ["name: Check the Cloudflare deploy token is set", "name: Deploy app/ (tools/factory.sh deploy)"],
    "secrets appear in exactly two deploy-job steps: the token check and the deploy");
  const install = steps.find((st) => /npm install/.test(st));
  assert.ok(install && /wrangler@4\.145\.0/.test(install), "wrangler installed, pinned");
  assert.doesNotMatch(install, SECRET, "the install step (dependency install scripts run there) has no secret");
  assert.ok(steps.indexOf(install) < steps.findIndex((st) => /run: bash tools\/factory\.sh deploy/.test(st)), "installed before the token step");
  assert.deepEqual(deploy.match(/^ +runs-on:.*$/gm).map((l) => l.replace(/#.*/, "").trim()), ["runs-on: ubuntu-24.04"], "deploy runs on a fresh GitHub-hosted runner (one runs-on, a fixed Ubuntu image)");
  assert.match(update, /\n    if: github\.ref == 'refs\/heads\/main'\n/, "a Run workflow on another branch never runs the factory (no save to main, no deploy of that branch)");
});

test("weekly.yml: deploy job — code from the run's start, data from the saved commit, skipped (green) when main is newer", () => {
  const wf = readText(WF);
  const update = stripComments(job(wf, "update")), deploy = stripComments(job(wf, "deploy")), alert = stripComments(job(wf, "alert"));
  assert.match(update, /FACTORY_DEPLOY: separate/);
  assert.match(update, /deploy: \$\{\{ steps\.decide\.outputs\.deploy \}\}/);
  assert.match(update, /sha: \$\{\{ steps\.decide\.outputs\.sha \}\}/);
  assert.match(deploy, /needs: update/);
  assert.match(deploy, /if: \$\{\{ needs\.update\.result == 'success' && needs\.update\.outputs\.deploy == 'true' \}\}/);
  assert.match(deploy, /permissions:\n\s+contents: read\n/);
  assert.doesNotMatch(deploy, /: write/);
  assert.match(deploy, /if \[\[ \$SHA =~ \^\[0-9a-f\]\{40\}\$ \]\]; then/, "the commit id from the factory job is checked as a whole value (bash =~, not a line-by-line grep)");
  assert.match(deploy, /ref: \$\{\{ github\.sha \}\}/, "the code that gets the token is the commit the run started on");
  assert.doesNotMatch(deploy, /ref: \$\{\{ steps\.commit/, "never the commit the factory job pushed");
  assert.match(deploy, /fetch-depth: 0/);
  assert.match(deploy, /persist-credentials: false/);
  assert.match(deploy, /git checkout "\$SHA" -- app\/data\.json app\/data-meta\.json app\/home\.json app\/review\.json\n/, "only the four built files come from the saved commit");
  assert.match(deploy, /^ {10}PUBLIC_DEPLOY: \$\{\{ vars\.PUBLIC_DEPLOY \}\}/m);
  assert.match(deploy, /node-version: "22"/);
  // every step after the data step runs only when it said go=true (go=false = a later run deploys; the job stays green)
  const steps = stepsOf(deploy);
  const data = steps.findIndex((st) => /^name: Take the built data/.test(st));
  assert.ok(data > 0 && /\n {8}id: data\n/.test(steps[data]));
  assert.ok(steps.length - data - 1 >= 4);
  for (const st of steps.slice(data + 1)) assert.match(st, /\n {8}if: steps\.data\.outputs\.go == 'true'\n/, `gated on go=true: ${st.split("\n")[0]}`);
  // every path the "newer deploy code" check watches starts a run of its own when it changes on main
  const pushPaths = JSON.parse(wf.match(/\n    paths: (\[[^\]]*\])/)[1]);
  const codePaths = steps[data].match(/rev-list "\$GITHUB_SHA\.\.\$MAIN" -- (.*?)\)"/)[1].split(" ").filter((p) => !p.startsWith("':"));
  assert.deepEqual(codePaths, ["app", "wrangler.jsonc", "cf/admin", "tools/factory.sh", ".github/workflows/weekly.yml"],
    "this workflow's own deploy steps are deploy code too: re-running only the deploy job runs them as they were at the run's start");
  for (const p of codePaths) assert.ok(pushPaths.includes(p) || pushPaths.includes(`${p}/**`), `on.push.paths has ${p}`);
  assert.match(deploy, /\n    outputs:\n {6}skipped: \$\{\{ steps\.data\.outputs\.skipped \}\}/, "the reason for a skip is handed on (redeploy job)");
  // alert job: scripts from the run's start commit, only the report taken from main (regular files), read as data
  assert.match(alert, /needs: \[update, deploy, redeploy, price_alerts\]/);
  assert.match(alert, /needs\.deploy\.result == 'failure' \|\| needs\.deploy\.result == 'cancelled'/, "a failed deploy also sends the Telegram alert");
  assert.match(alert, /ref: \$\{\{ github\.sha \}\}/, "the alert scripts that get the bot token come from the run's start commit");
  assert.doesNotMatch(alert, /ref: main/);
  assert.match(alert, /fetch-depth: 0/);
  assert.match(alert, /persist-credentials: false/);
  assert.match(alert, /for f in data2\/report\.md app\/data-meta\.json; do\n.*git ls-tree refs\/remotes\/origin\/main -- "\$f".*\n.*\[ "\$mode" != 100644 \]/);
  assert.match(alert, /git checkout refs\/remotes\/origin\/main -- data2\/report\.md app\/data-meta\.json/);
  assert.match(alert, /steps\.report\.outputs\.ok == 'true'\n/, "the data alerts run only on regular files");
});

test("weekly.yml: a re-run of the factory job is refused in its first step (attempt number from the environment); the deploy job may be re-run", () => {
  const wf = readText(WF);
  const steps = stepsOf(job(wf, "update"));
  assert.match(steps[0], /^name: Refuse a re-run of the factory/, "the very first step of the factory job, before checkout and installs");
  const script = stepScript(wf, "update", "Refuse a re-run of the factory");
  assert.match(script, /^if \[ "\$\{GITHUB_RUN_ATTEMPT:-1\}" != 1 \]; then$/m);
  assert.doesNotMatch(steps[0], /\$\{\{/, "the attempt number comes from the runner's environment, not from a ${{ }} pasted into the step");
  assert.doesNotMatch(stripComments(job(wf, "deploy")), /RUN_ATTEMPT|run_attempt/, "re-running only the deploy job stays allowed (its own checks skip when main is newer)");
  assert.doesNotMatch(steps[0], /\n\s*(if|continue-on-error):/, "the refusal step has no if: or continue-on-error: that could switch it off");
  assert.doesNotMatch(stripComments(job(wf, "update")), /\n    continue-on-error:/, "the factory job does not swallow the refusal");
  const sb = sandbox("rerun-guard-");
  try {
    const run = (attempt) => {
      const env = { ...sb.env };
      delete env.GITHUB_RUN_ATTEMPT;                     // these tests may themselves run inside an Actions job
      if (attempt !== null) env.GITHUB_RUN_ATTEMPT = attempt;
      const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { cwd: sb.tmp, env, encoding: "utf8" });
      return { status: r.status, out: r.stdout + r.stderr };
    };
    for (const first of [null, "", "1"]) {
      const r = run(first);
      assert.equal(r.status, 0, `attempt ${JSON.stringify(first)}: the first run goes on — ${r.out}`);
      assert.equal(r.out, "");
    }
    for (const again of ["2", "3", "10"]) {
      const r = run(again);
      assert.equal(r.status, 1, `attempt ${again}: refused`);
      assert.match(r.out, /^::error title=Re-run::Re-run은 그 실행의 옛 코드·옛 입력으로 다시 만들어요 — Actions에서 Run workflow\(skip_scrape\)를 쓰세요$/m);
    }
  } finally {
    sb.done();
  }
});

test("workflows: every job that gets the Cloudflare token names the GitHub Environment 'cloudflare'; no other job does", () => {
  const files = { "weekly.yml": WF, "cf-workers.yml": path.join(__dirname, "../.github/workflows/cf-workers.yml") };
  const seen = [];
  for (const [file, p] of Object.entries(files)) {
    const wf = readText(p);
    const names = [...wf.slice(wf.indexOf("\njobs:\n")).matchAll(/\n  ([a-z_][\w-]*):\n/g)].map((m) => m[1]);
    assert.ok(names.length > 0, `${file} has jobs`);
    for (const name of names) {
      const block = stripComments(job(wf, name));
      // any way of reading it: secrets.CLOUDFLARE_API_TOKEN, secrets['CLOUDFLARE_API_TOKEN'], toJSON(secrets)
      const token = /\$\{\{[^}]*(\bsecrets\s*\.\s*CLOUDFLARE_API_TOKEN\b|\bsecrets\s*\[|toJSON\(\s*secrets\s*\))/.test(block);
      if (token) {
        assert.match(block, /\n    environment: cloudflare\n/, `${file} ${name}: gets the token, so it names the environment`);
        seen.push(`${file} ${name}`);
      } else {
        assert.doesNotMatch(block, /\n    environment:/, `${file} ${name}: no token, no environment`);
      }
    }
  }
  assert.deepEqual(seen, ["weekly.yml deploy", "cf-workers.yml metrics"]);
});

test("weekly.yml redeploy job: a deploy skipped for newer deploy code starts a fresh rebuild of main — actions: write only, no checkout, no secret", () => {
  const wf = readText(WF);
  const raw = job(wf, "redeploy");
  const r = stripComments(raw);
  assert.match(r, /\n    needs: deploy\n/);
  assert.match(r, /\n    if: needs\.deploy\.outputs\.skipped == 'code'\n/, "only for newer deploy code — a newer build is deployed by the run that saved it");
  const perm = r.match(/\n    permissions:\n((?: {6}\S.*\n)+)/);
  assert.ok(perm, "redeploy has a permissions block");
  assert.deepEqual(perm[1].split("\n").filter(Boolean).map((l) => l.trim()), ["actions: write"], "permissions: exactly actions: write");
  assert.equal((r.match(/\n    permissions:/g) || []).length, 1);
  assert.doesNotMatch(r, /checkout|uses:/, "no checkout, no action: no code from the repository runs here");
  assert.doesNotMatch(raw, SECRET, "no secrets. expression of any kind");
  assert.doesNotMatch(r, /environment:/);
  assert.deepEqual([...r.matchAll(/\$\{\{([^}]*)\}\}/g)].map((m) => m[1].trim()), ["github.token"], "the only expression: this run's github.token");
  assert.match(r, /\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n/);
  assert.match(r, /\n {8}run: gh workflow run weekly\.yml --repo "\$GITHUB_REPOSITORY" --ref main -f skip_scrape=true\n/);
  assert.deepEqual(r.match(/^ +runs-on:.*$/gm).map((l) => l.trim()), ["runs-on: ubuntu-24.04"]);
  assert.equal(stepsOf(raw).length, 1, "one step");
  assert.doesNotMatch(stepsOf(raw)[0], /\n\s*(if|continue-on-error):/, "the dispatch step cannot be switched off quietly");
  assert.doesNotMatch(r, /\n    continue-on-error:/);
  // the alert job waits for it and reports a failed or cancelled redeploy
  const alert = stripComments(job(wf, "alert"));
  assert.match(alert, /needs: \[update, deploy, redeploy, price_alerts\]/);
  assert.match(alert, /needs\.redeploy\.result == 'failure' \|\| needs\.redeploy\.result == 'cancelled'/);
});

test("weekly.yml alert: a failed collection run says Run workflow WITHOUT skip_scrape, a rebuild run says skip_scrape (chosen by env)", () => {
  const wf = readText(WF);
  const step = stepsOf(job(wf, "alert")).find((st) => /^name: Alert on factory/.test(st));
  assert.ok(step);
  assert.match(step, /\n {10}COLLECT: \$\{\{ github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && !inputs\.skip_scrape\) \}\}\n/);
  const script = stepScript(wf, "alert", "Alert on factory");
  assert.doesNotMatch(script, /\$\{\{/, "the script reads only environment variables");
  const sb = sandbox("alert-text-");
  try {
    const bin = path.join(sb.tmp, "bin"), sent = path.join(sb.tmp, "sent");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "python3"), '#!/usr/bin/env bash\n[ "$1" = .github/scripts/telegram.py ] || { echo "unexpected: $*" >&2; exit 9; }\nprintf "%s\\n" "$2" >> "$SENT"\n', { mode: 0o755 });
    // Windows keeps the search path as "Path" (and splits it on ";"): add the fake python3 folder to that same variable,
    // or node finds no bash at all (2026-10-17, Windows runner)
    const pathKey = Object.keys(sb.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
    const send = (env) => {
      fs.writeFileSync(sent, "");
      const r = sb.bash(sb.tmp, script, { [pathKey]: `${bin}${path.delimiter}${sb.env[pathKey] || ""}`, SENT: sent, RUN_URL: "https://example.invalid/run/1", EVENT: "schedule",
        RESULT: "success", DEPLOY: "success", REDEPLOY: "skipped", COLLECT: "false", ...env });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const lines = fs.readFileSync(sent, "utf8").split("\n").filter(Boolean);
      assert.equal(lines.length, 1, "one message");
      return lines[0];
    };
    const COLLECT_AGAIN = "Re-run 말고 Run workflow(skip_scrape 끄고 — 수집부터 다시).";
    const REBUILD_AGAIN = "Re-run 말고 Run workflow(skip_scrape).";
    for (const [EVENT, RESULT] of [["schedule", "failure"], ["workflow_dispatch", "failure"], ["schedule", "cancelled"]]) {
      const t = send({ EVENT, RESULT, COLLECT: "true" });
      assert.match(t, /^윤실장 가격 공장 (실패|중단됨)/);
      assert.ok(t.includes(COLLECT_AGAIN), `collection run (${EVENT}, ${RESULT}): ${t}`);
      assert.ok(!t.includes(REBUILD_AGAIN), t);
    }
    for (const EVENT of ["push", "workflow_dispatch"]) {
      const t = send({ EVENT, RESULT: "failure", COLLECT: "false" });
      assert.ok(t.includes(REBUILD_AGAIN), `rebuild run (${EVENT}): ${t}`);
      assert.ok(!t.includes("수집부터"), t);
    }
    // a failed deploy: the data is already on main, so skip_scrape either way
    const dep = send({ DEPLOY: "failure", COLLECT: "true" });
    assert.match(dep, /^윤실장 Cloudflare 배포 실패/);
    assert.ok(dep.includes(REBUILD_AGAIN) && !dep.includes("수집부터"), dep);
    // the redeploy job could not start the rebuild
    const re = send({ REDEPLOY: "failure" });
    assert.match(re, /^윤실장 다시 배포 요청 실패/);
    assert.match(re, /Run workflow\(skip_scrape\)를 눌러 주세요/);
  } finally {
    sb.done();
  }
});

test("weekly.yml deploy job: the factory's commit id is checked as a whole value — a value with a line break is refused", () => {
  const script = stepScript(readText(WF), "deploy", "The commit the factory saved");
  const sb = sandbox("deploy-sha-");
  try {
    const run = (sha) => {
      const out = path.join(sb.tmp, "github_output");
      fs.writeFileSync(out, "");
      const r = sb.bash(sb.tmp, script, { SHA: sha, GITHUB_OUTPUT: out });
      return { status: r.status, out: r.stdout + r.stderr, gh: fs.readFileSync(out, "utf8") };
    };
    const good = "0123456789abcdef0123456789abcdef01234567";
    const ok = run(good);
    assert.equal(ok.status, 0, ok.out);
    assert.equal(ok.gh, `sha=${good}\n`);
    const a40 = "a".repeat(40);
    for (const bad of [`refs/remotes/origin/main\nx<<EOF\n${a40}\nEOF`, `${good}\n`, `${good}\nx`, `x\n${good}`, good.toUpperCase(), good.slice(1), `${good}0`, "", "refs/heads/main"]) {
      const r = run(bad);
      assert.notEqual(r.status, 0, `refused: ${JSON.stringify(bad)}`);
      assert.equal(r.gh, "", `nothing written to GITHUB_OUTPUT for ${JSON.stringify(bad)}`);
      assert.match(r.out, /::error title=Cloudflare::the factory job named no valid commit/);
    }
  } finally {
    sb.done();
  }
});

// Runs the deploy job's "Take the built data" step for real on a throwaway repository: a bare origin, the run's start commit
// (github.sha), and whatever `setup` puts on main after it (it returns the commit the factory named, or {sha, start} when the
// run started on another commit than the first one). The runner is a fresh clone checked out at the start commit, like
// actions/checkout with ref: github.sha and fetch-depth: 0.
const CODE = { "tools/factory.sh": "echo deploy v1\n", "app/app.js": "app v1\n", "wrangler.jsonc": "{\"name\":\"v1\"}\n", "cf/admin/src/index.js": "gate v1\n", "README": "start\n" };
const DATA = ["app/data.json", "app/data-meta.json", "app/home.json", "app/review.json"];
function built(v) {   // four data files that agree with each other, like build2 writes them
  const data = `{"v":"${v}"}\n`, home = `{"home":"${v}"}\n`;
  return {
    "app/data.json": data,
    "app/home.json": home,
    "app/data-meta.json": JSON.stringify({ version: v, bytes: Buffer.byteLength(data), sha256: sha256(data), home: { bytes: Buffer.byteLength(home), sha256: sha256(home) } }, null, 1) + "\n",
    "app/review.json": `{"review":"${v}"}\n`,
  };
}
const python3Works = spawnSync("python3", ["-c", "print(1)"], { encoding: "utf8" }).stdout?.trim() === "1";
function runDataStep(script, setup) {
  const sb = sandbox("deploy-step-");
  try {
    const origin = path.join(sb.tmp, "origin.git"), dev = path.join(sb.tmp, "dev"), runner = path.join(sb.tmp, "runner");
    sb.git(sb.tmp, ["init", "-q", "--bare", origin]);
    sb.git(sb.tmp, ["init", "-q", dev]);
    const g = (...a) => sb.git(dev, a);
    const commit = (files, msg) => { for (const [f, t] of Object.entries(files)) write(dev, f, t); g("add", "-A"); g("commit", "-q", "-m", msg); return g("rev-parse", "HEAD"); };
    const commitIndex = (msg) => { g("commit", "-q", "-m", msg); return g("rev-parse", "HEAD"); };
    const blob = (t) => sb.git(dev, ["hash-object", "-w", "--stdin"], t);
    const push = (branch = "main") => g("push", "-q", origin, `HEAD:refs/heads/${branch}`);
    const start = commit({ ...CODE, ...built("old") }, "start");
    push();
    const named = setup({ g, commit, commitIndex, blob, push, start });
    const { sha, start: runStart } = typeof named === "string" ? { sha: named, start } : named;
    sb.git(sb.tmp, ["clone", "-q", "--no-checkout", origin, runner]);
    sb.git(runner, ["checkout", "-q", "--detach", runStart]);
    const out = path.join(sb.tmp, "github_output");
    fs.writeFileSync(out, "");
    const r = sb.bash(runner, script, { SHA: sha, GITHUB_SHA: runStart, GITHUB_OUTPUT: out });
    const changed = sb.gitRaw(runner, ["status", "--porcelain"]).split("\n").filter(Boolean).map((l) => l.slice(3)).sort();
    const files = {};
    for (const f of [...DATA, ...Object.keys(CODE)]) files[f] = fs.readFileSync(path.join(runner, f), "utf8");
    return { status: r.status, out: r.stdout + r.stderr, gh: fs.readFileSync(out, "utf8"), changed, files, sha };
  } finally {
    sb.done();
  }
}
const asStart = (r) => { for (const [f, t] of Object.entries(CODE)) assert.equal(r.files[f], t, `${f} is the start commit's (the code that gets the token)`); };
const dataIs = (r, v) => { for (const [f, t] of Object.entries(built(v))) assert.equal(r.files[f], t, `${f} is the "${v}" build`); };

test("weekly.yml deploy job: the data step takes only the four built files, from a saved commit on main, when nothing newer is on main", { skip: !python3Works && "python3 not found (the step checks data-meta.json with python3)" }, () => {
  const script = stepScript(readText(WF), "deploy", "Take the built data from the saved commit");
  // normal: the saved build also changed other factory files; main then moved on with unrelated changes → go=true, and
  // exactly the four data files differ from the start commit afterwards
  const ok = runDataStep(script, ({ commit, push }) => {
    const saved = commit({ ...built("new"), "data2/accepted/x.json": "new\n", "docs/CLASSIFICATION_REVIEW_QUEUE.csv": "new\n" }, "Rebuild app data");
    push();
    commit({ README: "moved\n", "build2/weekly.py": "v2\n" }, "unrelated change on main");
    push();
    return saved;
  });
  assert.equal(ok.status, 0, ok.out);
  assert.equal(ok.gh, "go=true\n");
  assert.deepEqual(ok.changed, [...DATA].sort(), "git status: exactly the four data files, nothing else from the saved commit");
  dataIs(ok, "new");
  asStart(ok);

  // the saved commit holds OTHER deploy code than the run's start commit — its app/app.js, wrangler.jsonc and
  // cf/admin/src/index.js differ (it was made on a line that forked off before the start commit's code change, and was merged
  // into main, so main has no deploy code newer than the start) → go=true, and still exactly the four data files are taken:
  // a checkout of anything more from the saved commit would show in git status and in the code files
  const v2 = { "app/app.js": "app v2\n", "wrangler.jsonc": "{\"name\":\"v2\"}\n", "cf/admin/src/index.js": "gate v2\n" };
  const forked = runDataStep(script, ({ g, commit, push, start }) => {
    const runStart = commit(v2, "code v2 (the run starts here)");
    g("checkout", "-q", "-b", "side", start);
    const saved = commit({ ...built("new"), "data2/accepted/x.json": "new\n" }, "Rebuild app data");   // code still v1
    g("checkout", "-q", "main");
    g("merge", "-q", "--no-ff", "-m", "merge the build", "side");
    push();
    return { sha: saved, start: runStart };
  });
  assert.equal(forked.status, 0, forked.out);
  assert.equal(forked.gh, "go=true\n");
  assert.deepEqual(forked.changed, [...DATA].sort(), "git status: exactly the four data files, none of the saved commit's other code");
  dataIs(forked, "new");
  for (const [f, t] of Object.entries(v2)) assert.equal(forked.files[f], t, `${f} is the start commit's, not the saved commit's`);
  assert.equal(forked.files["tools/factory.sh"], CODE["tools/factory.sh"]);

  // a commit that is not on main
  const off = runDataStep(script, ({ g, commit, push, start }) => {
    g("checkout", "-q", "-b", "side", start);
    const c = commit(built("side"), "off main");
    push("side");
    return c;
  });
  assert.notEqual(off.status, 0);
  assert.match(off.out, /::error title=Cloudflare::[0-9a-f]{40} is not on main/);
  assert.equal(off.gh, "");
  assert.deepEqual(off.changed, []);

  // main already has a newer build (deploy-only re-run of an older run): skipped, green
  const older = runDataStep(script, ({ commit, push }) => {
    const c = commit(built("new"), "Rebuild app data");
    push();
    commit(built("newer"), "Weekly prices");
    push();
    return c;
  });
  assert.equal(older.status, 0, older.out);
  assert.equal(older.gh, "go=false\nskipped=build\n", "skipped=build: the run that saved the newer build deploys it — no redeploy");
  assert.match(older.out, /::notice title=Cloudflare::main already has a newer build than [0-9a-f]{40} — not deployed by this run: the run that saved that build deploys it .* use Run workflow \(skip_scrape\), not Re-run/);
  assert.deepEqual(older.changed, []);
  dataIs(older, "old");

  // main has newer deploy code than the run's start (a merged PR; or the factory job pushed code in this run) → skipped,
  // green, skipped=code: the redeploy job starts a rebuild of main. Each watched path on its own, then all of them in the
  // saved commit itself.
  for (const p of ["app/app.js", "app/_headers", "wrangler.jsonc", "cf/admin/src/index.js", "tools/factory.sh", ".github/workflows/weekly.yml"]) {
    const newer = runDataStep(script, ({ commit, push }) => {
      const c = commit(built("new"), "Rebuild app data");
      push();
      commit({ [p]: "v2\n" }, `change ${p}`);
      push();
      return c;
    });
    assert.equal(newer.status, 0, newer.out);
    assert.equal(newer.gh, "go=false\nskipped=code\n", `newer ${p} on main → not deployed by this run, redeploy`);
    assert.match(newer.out, /::notice title=Cloudflare::main has newer deploy code than this run's [0-9a-f]{40} — not deployed by this run: the redeploy job starts a rebuild of main/);
    assert.deepEqual(newer.changed, []);
  }
  const sameRun = runDataStep(script, ({ commit, push }) => {
    const c = commit({ ...built("new"), "app/app.js": "EVIL\n", "wrangler.jsonc": "{\"name\":\"evil\"}\n", "cf/admin/src/index.js": "EVIL\n", "tools/factory.sh": "echo EVIL $CLOUDFLARE_API_TOKEN\n" }, "Rebuild app data");
    push();
    return c;
  });
  assert.equal(sameRun.status, 0, sameRun.out);
  assert.equal(sameRun.gh, "go=false\nskipped=code\n", "code the factory job pushed in this run is not deployed by it");
  assert.deepEqual(sameRun.changed, []);
  asStart(sameRun);
});

test("weekly.yml deploy job: the data step refuses a mixed build (data-meta.json checksums) and anything but regular files", { skip: !python3Works && "python3 not found (the step checks data-meta.json with python3)" }, () => {
  const script = stepScript(readText(WF), "deploy", "Take the built data from the saved commit");
  const mixed = [
    [{ "app/data.json": "{\"v\":\"other build\"}\n" }, /app\/data-meta\.json does not match app\/data\.json/],
    [{ "app/home.json": "{\"home\":\"other build\"}\n" }, /app\/data-meta\.json does not match app\/home\.json/],
    [{ "app/data-meta.json": "{not json\n" }, /app\/data-meta\.json is not JSON/],
    [{ "app/data-meta.json": "{\"sha256\":\"x\"}\n" }, /app\/data-meta\.json has no data\/home checksums/],
  ];
  for (const [change, why] of mixed) {
    const r = runDataStep(script, ({ commit, push }) => { const c = commit({ ...built("new"), ...change }, "Rebuild app data"); push(); return c; });
    assert.notEqual(r.status, 0, `${JSON.stringify(change)}: ${r.out}`);
    assert.match(r.out, why);
    assert.match(r.out, /::error title=Cloudflare::.*nothing deployed/);
    assert.ok(!/go=true/.test(r.gh), "never go=true");
  }
  // a symlink in place of each data file (wrangler would upload the file it points to), and a directory in place of one
  for (const f of DATA) {
    const r = runDataStep(script, ({ g, commit, commitIndex, blob, push }) => {
      commit(built("new"), "Rebuild app data");
      g("update-index", "--add", "--cacheinfo", `120000,${blob("/proc/self/environ")},${f}`);
      const c = commitIndex(`symlink ${f}`);
      push();
      return c;
    });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, new RegExp(`::error title=Cloudflare::${f.replace(/[.]/g, "\\.")} in [0-9a-f]{40} is not a regular file \\(mode '120000'\\)`));
    assert.deepEqual(r.changed, [], "nothing taken");
    dataIs(r, "old");
  }
  const tree = runDataStep(script, ({ g, commit, commitIndex, blob, push }) => {
    commit(built("new"), "Rebuild app data");
    g("update-index", "--force-remove", "app/review.json");
    g("update-index", "--add", "--cacheinfo", `100644,${blob("{}\n")},app/review.json/inner.json`);
    const c = commitIndex("directory in place of app/review.json");
    push();
    return c;
  });
  assert.notEqual(tree.status, 0, tree.out);
  assert.match(tree.out, /app\/review\.json in [0-9a-f]{40} is not a regular file \(mode '040000'\)/);
  assert.deepEqual(tree.changed, []);
});

test("factory deploy: without a token nothing is deployed", () => {
  const r = runDeploy({ token: "" });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.calls, []);
  assert.match(r.out, /no CLOUDFLARE_API_TOKEN/);
});

test("manual run: only the five factory modes; price-check takes a whole number 1-200 (default 40)", async () => {
  const R = await load();
  assert.deepEqual(R.parseRun({ mode: "rebuild" }), { mode: "rebuild", arg: "" });
  assert.deepEqual(R.parseRun({ mode: "price-check" }), { mode: "price-check", arg: "40" });
  assert.deepEqual(R.parseRun({ mode: "price-check", max: 200 }), { mode: "price-check", arg: "200" });
  for (const bad of [{ mode: "price-check", max: 0 }, { mode: "price-check", max: 201 }, { mode: "price-check", max: "5; rm -rf /" }, { mode: "price-check", max: 1.5 }])
    assert.ok(R.parseRun(bad).error, JSON.stringify(bad));
  for (const bad of [null, {}, { mode: "deploy" }, { mode: "rebuild && curl x" }, { mode: ["rebuild"] }]) assert.ok(R.parseRun(bad).error, JSON.stringify(bad));
});

test("secrets: equal strings match; empty, different length or different text never do", async () => {
  const R = await load();
  assert.equal(R.sameSecret("abc123", "abc123"), true);
  assert.equal(R.sameSecret("", ""), false);
  assert.equal(R.sameSecret("abc123", "abc124"), false);
  assert.equal(R.sameSecret("abc", "abc123"), false);
  assert.equal(R.sameSecret(undefined, "x"), false);
  const req = (h) => ({ headers: new Map(Object.entries(h)) });
  assert.equal(R.bearer(req({ authorization: "Bearer s3cret" })), "s3cret");
  assert.equal(R.bearer(req({ authorization: "Basic s3cret" })), "");
  assert.equal(R.bearer(req({})), "");
});

test("run log: closing a run drops its token, keeps the newest 20, status shows no tokens", async () => {
  const R = await load();
  const cur = { ...R.newRun("r1", "weekly", "", "schedule", Date.parse("2026-10-19T21:00:00Z")), token: "t".repeat(64) };
  let runs = Array.from({ length: 25 }, (_, i) => ({ id: "old" + i }));
  const s = R.publicStatus(cur, runs);
  assert.equal(JSON.stringify(s).includes("tttt"), false);
  const next = R.closeRun(cur, runs, { state: "ok", step: "weekly" }, Date.parse("2026-10-19T21:30:00Z"));
  assert.equal(next.current, null);
  assert.equal(next.runs.length, R.KEEP);
  assert.equal(next.runs[0].id, "r1");
  assert.equal(next.runs[0].token, undefined);
  assert.equal(next.runs[0].endedAt, "2026-10-19T21:30:00.000Z");
  assert.deepEqual(R.closeRun(null, runs, {}).runs, runs);
});

test("box report: unknown result counts as failed; long text is cut; non-strings dropped", async () => {
  const R = await load();
  assert.equal(R.cleanReport({ result: "ok" }).state, "ok");
  assert.equal(R.cleanReport({ result: "skipped" }).state, "skipped");
  assert.equal(R.cleanReport({ result: "<script>" }).state, "failed");
  assert.equal(R.cleanReport({}).state, "failed");
  assert.equal(R.cleanReport({ result: "ok", summary: "x".repeat(9000) }).summary.length, 3000);
  assert.equal(R.cleanReport({ result: "ok", commit: { a: 1 } }).commit, "");
});

test("push events: the factory's own save is skipped, anyone else's push rebuilds", async () => {
  const R = await load();
  assert.equal(R.isOwnCommit({ author: { name: "factory bot", email: "factory@yoonsiljang.invalid" } }), true);
  assert.equal(R.isOwnCommit({ author: { name: "lsy2825", email: "lsy2825@gmail.com" } }), false);
  assert.equal(R.isOwnCommit(null), false);
  // entry.sh and runs.js must agree on the bot's address
  const entry = require("fs").readFileSync(path.join(__dirname, "../cf/factory/entry.sh"), "utf8");
  assert.ok(entry.includes(`FACTORY_BOT_EMAIL="${R.BOT_EMAIL}"`));
});

test("factory script: modes in the Worker and in tools/factory.sh are the same list", async () => {
  const R = await load();
  const sh = require("fs").readFileSync(path.join(__dirname, "../tools/factory.sh"), "utf8");
  for (const m of R.MODES) assert.ok(new RegExp(`^\\s+${m}\\)`, "m").test(sh), `factory.sh handles ${m}`);
});

// run only save() from tools/factory.sh in a throw-away git setup: a bare "origin" with main, the factory's clone, and a
// second clone that moves main underneath it. No git identity anywhere (empty HOME, no global/system config, no GIT_*
// variables), like a bare Actions runner. A pre-receive hook on origin can reject the first N pushes to exercise the retry.
// beforePull = {file, text}: the second clone pushes that change to main after the factory's commit, right before its pull.
const MOVE_MAIN_BEFORE_PULL = `git() {   # test hook: main moves between the factory's commit and its push
  if [ -n "\${MOVE_FILE:-}" ] && [[ " $* " == *" pull "* ]]; then
    local mf=$MOVE_FILE; MOVE_FILE=
    mkdir -p "$OTHER/$(dirname "$mf")"; printf '%s' "$MOVE_TEXT" > "$OTHER/$mf"
    command git -C "$OTHER" add -A
    command git -C "$OTHER" -c user.name=seed -c user.email=seed@example.com commit -q -m "main changed $mf"
    command git -C "$OTHER" push -q origin HEAD:main
  fi
  command git "$@"
}`;
function runSave({ moveMain = true, rejectPushes = 0, nothing = false, beforePull = null, noPush = false } = {}) {
  const sb = sandbox("factory-save-");
  const git = (cwd, ...args) => sb.git(cwd, args);
  const dir = sb.tmp;
  const origin = path.join(dir, "origin.git"), a = path.join(dir, "factory"), b = path.join(dir, "other");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(dir, "clone", "-q", origin, a);
  fs.writeFileSync(path.join(a, "README"), "seed\n");
  git(a, "add", "README"); git(a, "commit", "-q", "-m", "seed"); git(a, "push", "-q", "origin", "HEAD:main");
  git(dir, "clone", "-q", origin, b);
  if (moveMain) {                                                // someone else pushes to main after the factory cloned
    fs.writeFileSync(path.join(b, "other.txt"), "moved\n");
    git(b, "add", "other.txt"); git(b, "commit", "-q", "-m", "main moved"); git(b, "push", "-q", "origin", "HEAD:main");
  }
  if (rejectPushes > 0) {                                        // reject the first N pushes, then accept
    fs.mkdirSync(path.join(origin, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(origin, "hooks", "pre-receive"),
      `#!/usr/bin/env bash\nn=$(cat "${origin}/rejects" 2>/dev/null || echo 0)\nif [ "$n" -lt ${rejectPushes} ]; then echo $((n+1)) > "${origin}/rejects"; echo "fake: rejected $((n+1))" >&2; exit 1; fi\nexit 0\n`, { mode: 0o755 });
  }
  if (!nothing) write(a, "app/data.json", '{"built":1}\n');
  const sh = fs.readFileSync(path.join(__dirname, "../tools/factory.sh"), "utf8");
  const fn = sh.slice(sh.indexOf("save() {"), sh.indexOf("\n}", sh.indexOf("save() {")) + 2);
  const script = `set -euo pipefail\nMODE=test\nBOT_NAME="weekly-prices bot"\nBOT_EMAIL="actions@users.noreply.github.com"\n` +
    `log() { echo "== factory[$MODE]: $*"; }\nsleep() { :; }\n${MOVE_MAIN_BEFORE_PULL}\n${fn}\nsave "Weekly prices" app/data.json app/review.json\necho after-save\n`;
  const extra = { OTHER: b, MOVE_FILE: beforePull ? beforePull.file : "", MOVE_TEXT: beforePull ? beforePull.text : "" };
  if (noPush) extra.FACTORY_NO_PUSH = "1";
  const r = spawnSync("bash", ["-c", script], { cwd: a, env: { ...sb.env, ...extra }, encoding: "utf8" });
  git(b, "fetch", "-q", "origin", "main");
  const mainLog = git(b, "log", "--format=%an|%s", "origin/main").split("\n");
  const factoryLog = git(a, "log", "--format=%s", "HEAD").split("\n");
  sb.done();
  return { status: r.status, out: r.stdout + r.stderr, mainLog, factoryLog };
}

test("factory save: main moved meanwhile, no git identity on the runner → the commit is replayed on top and pushed", () => {
  const r = runSave({ moveMain: true });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /saved: [0-9a-f]+ Weekly prices \d{4}-\d{2}-\d{2}/);
  assert.match(r.out, /after-save/);
  assert.deepEqual(r.mainLog.slice(0, 2).map((l) => l.split("|")[1]).map((s) => s.replace(/ \d{4}-\d{2}-\d{2}$/, "")),
    ["Weekly prices", "main moved"], "bot commit on top of the moved main");
  assert.equal(r.mainLog[0].split("|")[0], "weekly-prices bot");
});

test("factory save: main changed a saved file between the factory's commit and its push → nothing pushed, the save fails", () => {
  // the file the factory built (with -X theirs the factory's copy would win: a newer build on main silently overwritten)
  const same = runSave({ moveMain: false, beforePull: { file: "app/data.json", text: '{"built":"other run"}\n' } });
  assert.equal(same.status, 1, same.out);
  assert.match(same.out, /main changed the factory's files meanwhile — not pushed/);
  assert.doesNotMatch(same.out, /after-save|saved: /);
  assert.equal(same.mainLog[0], "seed|main changed app/data.json", "main keeps the other change; no bot commit");
  assert.ok(!same.mainLog.some((l) => l.includes("Weekly prices")));
  // a saved file the factory did not change this time (the replay would mix the two builds)
  const other = runSave({ moveMain: false, beforePull: { file: "app/review.json", text: '{"review":"other run"}\n' } });
  assert.equal(other.status, 1, other.out);
  assert.match(other.out, /main changed the factory's files meanwhile — not pushed/);
  assert.ok(!other.mainLog.some((l) => l.includes("Weekly prices")));
  // a file outside the saved paths moving at the same moment is fine
  const unrelated = runSave({ moveMain: false, beforePull: { file: "notes.txt", text: "x\n" } });
  assert.equal(unrelated.status, 0, unrelated.out);
  assert.match(unrelated.mainLog[0], /^weekly-prices bot\|Weekly prices /);
  assert.equal(unrelated.mainLog[1], "seed|main changed notes.txt");
});

test("factory save: FACTORY_NO_PUSH=1 commits locally and pushes nothing", () => {
  const r = runSave({ moveMain: true, noPush: true });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /committed, not pushed \(FACTORY_NO_PUSH=1\)/);
  assert.match(r.factoryLog[0], /^Weekly prices /);
  assert.ok(!r.mainLog.some((l) => l.includes("Weekly prices")));
});

test("factory save: a rejected push is retried; three rejections fail the save", () => {
  const ok = runSave({ moveMain: false, rejectPushes: 2 });
  assert.equal(ok.status, 0, ok.out);
  assert.equal((ok.out.match(/rejected \(it moved again\) — try/g) || []).length, 2);
  assert.match(ok.out, /saved: /);
  const bad = runSave({ moveMain: false, rejectPushes: 3 });
  assert.notEqual(bad.status, 0, "three rejections → the save fails");
  assert.match(bad.out, /could not push to main after 3 tries/);
  assert.doesNotMatch(bad.out, /after-save/);
  assert.equal(bad.mainLog[0].split("|")[1], "seed", "nothing reached main");
});

test("factory save: nothing changed → no commit, no push", () => {
  const r = runSave({ nothing: true, moveMain: false });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /nothing new to save/);
  assert.equal(r.mainLog.length, 1);
});

// run only build() (with the real save()) from tools/factory.sh: build2/weekly.py and tools/review_queue.js are stubbed — the
// stub "builds" app/data.json from the input it finds and names the code it ran with. The factory's clone is at the start
// commit S; meanwhile main got a code change (code v2) and another run's build (prices v2).
// mainDeletes: the start commit S also has data2/accepted/old.csv, and main deletes it afterwards (a brand taken out).
function runBuild({ sameAsMain = false, mainMovesDuringBuild = false, failFetch = false, noOrigin = false, mainDeletes = false, noPush = noOrigin, checksFail = false } = {}) {
  const sb = sandbox("factory-build-");
  const git = (cwd, ...args) => sb.git(cwd, args);
  const dir = sb.tmp;
  const origin = path.join(dir, "origin.git"), dev = path.join(dir, "dev"), a = path.join(dir, "factory");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(dir, "clone", "-q", origin, dev);
  const commit = (files, msg) => { for (const [f, t] of Object.entries(files)) write(dev, f, t); git(dev, "add", "-A"); git(dev, "commit", "-q", "-m", msg); git(dev, "push", "-q", "origin", "HEAD:main"); return git(dev, "rev-parse", "HEAD"); };
  const start = commit({ "build2/code.txt": "code v1\n", "data2/accepted/prices.json": "prices v1\n", "app/data.json": "built from prices v1 with code v1\n",
    ...(mainDeletes ? { "data2/accepted/old.csv": "old brand\n" } : {}) }, "S");
  git(dir, "clone", "-q", origin, a);                             // the factory's checkout (github.sha = S)
  commit({ "build2/code.txt": "code v2\n" }, "code v2");          // a PR merged meanwhile
  if (mainDeletes) { git(dev, "rm", "-q", "data2/accepted/old.csv"); git(dev, "commit", "-q", "-m", "remove a brand"); git(dev, "push", "-q", "origin", "HEAD:main"); }
  const main = commit({ "data2/accepted/prices.json": "prices v2\n", "app/data.json": `built from prices v2 with code ${sameAsMain ? "v1" : "v2"}\n` }, "Weekly prices (another run)");
  if (failFetch) git(a, "remote", "set-url", "origin", path.join(dir, "missing.git"));
  if (noOrigin) git(a, "remote", "remove", "origin");
  const sh = fs.readFileSync(path.join(__dirname, "../tools/factory.sh"), "utf8");
  const fnOf = (name) => sh.slice(sh.indexOf(`${name}() {`), sh.indexOf("\n}", sh.indexOf(`${name}() {`)) + 2);
  const stub = `python() {   # stub build2/weekly.py
  [ "$1" = build2/weekly.py ] || { echo "unexpected: python $*" >&2; return 1; }
  echo "stub: weekly.py ran"
  echo "built from $(cat data2/accepted/prices.json) with $(cat build2/code.txt)" > app/data.json
  if [ -n "\${MOVE:-}" ]; then   # another change to a build file lands on main while this build runs
    printf 'built by someone else\\n' > "$DEV/app/data.json"
    command git -C "$DEV" -c user.name=seed -c user.email=seed@example.com commit -qam "main changed app/data.json"
    command git -C "$DEV" push -q origin HEAD:main
  fi
}
node() { :; }
checks() {   # stub tools/factory.sh checks(): records what it saw, fails when asked (a build the tests reject)
  echo "stub: checks on: $(cat app/data.json)"
  [ -z "\${CHECKS_FAIL:-}" ]
}`;
  const script = `set -euo pipefail\nMODE=test\nBOT_NAME="weekly-prices bot"\nBOT_EMAIL="actions@users.noreply.github.com"\nBUILT=""\n` +
    `log() { echo "== factory[$MODE]: $*"; }\nsleep() { :; }\n${stub}\n${fnOf("save")}\n${fnOf("build")}\nbuild --skip-scrape\necho "built=$BUILT"\n`;
  const env = { ...sb.env, DEV: dev, MOVE: mainMovesDuringBuild ? "1" : "", CHECKS_FAIL: checksFail ? "1" : "" };
  if (noPush) env.FACTORY_NO_PUSH = "1";   // sb.env has no FACTORY_* at all: only the cases that want it get it
  const r = spawnSync("bash", ["-c", script], { cwd: a, env, encoding: "utf8" });
  const show = (f) => git(origin, "show", `main:${f}`);
  const res = { status: r.status, out: r.stdout + r.stderr, start, main, mainTip: git(origin, "rev-parse", "main"),
    mainLog: git(origin, "log", "--format=%an|%s", "main").split("\n"), mainData: show("app/data.json"), mainCode: show("build2/code.txt"),
    mainFiles: git(origin, "ls-tree", "-r", "--name-only", "main").split("\n"),
    factoryHead: git(a, "rev-parse", "HEAD"), factoryData: fs.readFileSync(path.join(a, "app/data.json"), "utf8"),
    factoryHasOld: fs.existsSync(path.join(a, "data2/accepted/old.csv")) };
  sb.done();
  return res;
}

test("factory build: starts from main's latest data with the code as checked out, and pushes only its own build", () => {
  const r = runBuild();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, new RegExp(`build inputs: 2 of 14 paths from origin main ${r.main.slice(0, 12)}; code stays at ${r.start.slice(0, 7)}`));
  assert.equal(r.mainData, "built from prices v2 with code v1", "built on main's newest input (prices v2), with this run's code (v1)");
  assert.equal(r.mainCode, "code v2", "main's newer code is not put back to the run's code");
  assert.match(r.mainLog[0], /^weekly-prices bot\|Rebuild app data \d{4}-\d{2}-\d{2}$/);
  assert.equal(r.mainLog[1], "t|Weekly prices (another run)", "on top of the other run's build");
  assert.ok(!r.mainLog.some((l) => /Build inputs from main/.test(l)), "the local inputs commit is dropped by the replay, never pushed");
  assert.match(r.out, new RegExp(`built=${r.mainTip}`), "deploy() names the pushed commit");
});

test("factory build: the checks run again on the new build, after it is made and before it is saved", () => {
  const r = runBuild();
  assert.equal(r.status, 0, r.out);
  const ran = r.out.indexOf("stub: weekly.py ran"), checked = r.out.indexOf("stub: checks on: built from prices v2 with code v1");
  assert.ok(ran >= 0 && checked > ran, `checks after the build, on its output: ${r.out}`);
  assert.ok(checked < r.out.indexOf("built="), "and before save() finishes");
});

test("factory build: a build the checks reject is not saved — main keeps the last good build, the run fails (2026-10-19)", () => {
  const r = runBuild({ checksFail: true });
  assert.notEqual(r.status, 0, "the run fails (→ alert job → Telegram)");
  assert.match(r.out, /checks on the new build \(if they fail, this build is not saved or deployed/);
  assert.equal(r.mainTip, r.main, "nothing pushed to main");
  assert.equal(r.mainData, "built from prices v2 with code v2", "main still has the last good build");
  assert.ok(!r.out.includes("built="), "build() did not return (no commit handed to the deploy job)");
});

test("factory build: nothing new → nothing pushed, and the deploy job is handed main's commit (it holds this build)", () => {
  const r = runBuild({ sameAsMain: true });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /nothing new to save/);
  assert.equal(r.mainTip, r.main, "main unchanged");
  assert.match(r.out, new RegExp(`built=${r.main}\\n`), "not the factory's local HEAD (that has the start commit's data in its history only)");
  assert.notEqual(r.factoryHead, r.main);
});

test("factory build: main changes a build file while it builds → nothing pushed, the run fails (never a mixed build)", () => {
  const r = runBuild({ mainMovesDuringBuild: true });
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /main changed the factory's files meanwhile — not pushed/);
  assert.equal(r.mainLog[0], "seed|main changed app/data.json");
  assert.equal(r.mainData, "built by someone else");
  assert.doesNotMatch(r.out, /built=/);
});

test("factory build: a failed fetch of main stops the run before building; no origin remote builds the files as checked out", () => {
  const f = runBuild({ failFetch: true });
  assert.notEqual(f.status, 0, f.out);
  assert.match(f.out, /could not fetch origin main — not building/);
  assert.doesNotMatch(f.out, /stub: weekly\.py ran/);
  const n = runBuild({ noOrigin: true });
  assert.equal(n.status, 0, n.out);
  assert.match(n.out, /no 'origin' remote — building from the files as checked out/);
  assert.equal(n.factoryData, "built from prices v1 with code v1\n", "the checked-out input (prices v1), nothing fetched");
  assert.match(n.out, /nothing new to save/, "same as the checked-out build");
  assert.equal(n.factoryHead, n.start);
  assert.match(n.out, new RegExp(`built=${n.start}\\n`), "deploy() names the checked-out commit");
});

test("factory build: main deleted an input file after the run started → the build drops it too (checkout --no-overlay) and saves", () => {
  const r = runBuild({ mainDeletes: true });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /saved: /);
  assert.ok(!r.mainFiles.includes("data2/accepted/old.csv"), "not put back on main");
  assert.ok(r.mainFiles.includes("data2/accepted/prices.json"));
  assert.equal(r.factoryHasOld, false, "gone from the factory's work tree as well (the build never saw it)");
  assert.equal(r.mainData, "built from prices v2 with code v1");
});

test("price alerts: their own weekly.yml job after the deploy job deployed (or a no-build schedule day); reviewed code, the deployed commit's data checked against the public app; full only on the schedule; the factory and the deploy token never meet the alerts token", () => {
  const fs = require("fs");
  const sh = fs.readFileSync(path.join(__dirname, "../tools/factory.sh"), "utf8");
  assert.equal(/ALERTS|notify/.test(sh), false, "factory.sh knows nothing about price alerts");
  const yml = fs.readFileSync(path.join(__dirname, "../.github/workflows/weekly.yml"), "utf8");
  const code = yml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");      // comments may name anything
  // jobs: two-space keys under 'jobs:'
  const jobsText = code.slice(code.indexOf("\njobs:\n") + 7);
  const jobs = {};
  for (const part of jobsText.split(/\n(?=  [a-z][\w-]*:\n)/)) { const m = /^\s*([a-z][\w-]*):\n/.exec(part); if (m) jobs[m[1]] = part; }
  for (const j of ["update", "deploy", "redeploy", "alert", "price_alerts"]) assert.ok(jobs[j], `job ${j}`);
  const { update, alert, price_alerts: pa } = jobs;
  // a different machine: the factory job (scrapers, pip packages, build) cannot write files, $GITHUB_ENV or NODE_OPTIONS
  // that the alerts step would use, and never holds either token
  assert.equal(/ALERTS_|TELEGRAM_|notify/.test(update), false, "the factory job never sees ALERTS_*, TELEGRAM_* or runs notify");
  for (const [name, text] of Object.entries(jobs)) if (name !== "price_alerts") assert.equal(/ALERTS_|notify\.mjs|cf\/alerts/.test(text), false, `${name} never sees ALERTS_* or runs the alerts code`);
  // the Telegram job: its own secrets only; it waits for price_alerts and reports one that did not reach its end
  assert.match(alert, /TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/);
  assert.equal(/secrets\.(?!TELEGRAM_)/.test(alert), false, "only TELEGRAM_* secrets in the Telegram job");
  assert.match(alert, /\n {4}needs: \[update, deploy, redeploy, price_alerts\]\n/);
  assert.match(alert, /needs\.price_alerts\.result == 'failure' \|\| needs\.price_alerts\.result == 'cancelled' \|\|\n\s+\(needs\.price_alerts\.result == 'success' && needs\.price_alerts\.outputs\.done != 'true'\)/,
    "a failed, cancelled, or (continue-on-error) unfinished price-alerts job is reported, whichever way GitHub shows its result");
  // after every job that builds or deploys the app (the factory job, the deploy job)
  const needsM = /\n {4}needs: (\[[^\]\n]*\]|[\w-]+)\n/.exec(pa);
  assert.ok(needsM, "price_alerts has needs");
  const needs = needsM[1].replace(/^\[|\]$/g, "").split(",").map((x) => x.trim());
  assert.deepEqual(needs, ["update", "deploy"]);
  for (const [name, text] of Object.entries(jobs)) {
    if (name !== "price_alerts" && /CLOUDFLARE_API_TOKEN|tools\/factory\.sh|wrangler/.test(text)) assert.ok(needs.includes(name), `price_alerts must also need ${name} (it builds or deploys the app)`);
  }
  // WHEN: the deploy job deployed in this run (green, not skipped), or a schedule run had nothing to build (no deploy job)
  assert.match(pa, /\n {4}if: >-\n {6}!cancelled\(\) && needs\.update\.result == 'success' &&\n {6}\(\(needs\.deploy\.result == 'success' && needs\.deploy\.outputs\.skipped == ''\) \|\|\n {6}\(github\.event_name == 'schedule' && needs\.update\.outputs\.run == 'false' && needs\.deploy\.result == 'skipped'\)\)\n/);
  assert.match(jobs.deploy, /\n {6}skipped: \$\{\{ steps\.data\.outputs\.skipped \}\}/, "the deploy job says when it skipped (the condition above reads it)");
  assert.match(pa, /\n {4}permissions:\n {6}contents: read\n/, "read-only token");
  assert.match(pa, /\n {4}timeout-minutes: \d+ *(#[^\n]*)?\n/);
  assert.match(pa, /\n {4}continue-on-error: true\n/, "never fails the run");
  assert.match(pa, /\n {4}outputs:\n {6}done: \$\{\{ steps\.end\.outputs\.done \}\}/);
  assert.equal(/\n {4}environment:/.test(pa), false, "not the Cloudflare environment: the deploy token can never reach this job");
  assert.equal(/pip |requirements\.txt|npm (ci|install)|setup-python|tools\/factory\.sh|\$GITHUB_ENV|wrangler/.test(pa), false, "installs nothing, runs no factory code");
  const steps = pa.split(/\n {6}- /).slice(1);
  // CODE = the commit a human pinned in the repository Variable ALERTS_CODE_SHA (the factory's GITHUB_TOKEN can push to main
  // but cannot edit Actions variables), never main and never github.sha (a scheduled run's github.sha IS main's last commit,
  // which may be a factory push nobody reviewed). DATA = the deployed commit (needs.update.outputs.sha) or main on a no-build
  // day — two files, checked. main's alerts code is checked out only for a hint. No checkout keeps a credential.
  assert.equal(/github\.sha/.test(pa), false, "github.sha is main's last commit on a schedule run: never the code");
  const pin = steps.find((st) => /\n {8}id: pin\n/.test(st));
  assert.ok(pin, "the pin step");
  assert.match(pin, /PIN: \$\{\{ vars\.ALERTS_CODE_SHA \}\}/, "the variable arrives through env, not spliced into the script");
  assert.match(pin, /grep -Eq '\^\[0-9a-f\]\{40\}\$'/, "only a full 40-hex commit id is accepted (an empty ref would fall back to the default branch)");
  assert.match(pin, /echo "ok=false" >> "\$GITHUB_OUTPUT"/);
  const checkouts = steps.filter((st) => /^uses: actions\/checkout@/.test(st));
  assert.equal(checkouts.length, 3, "the pinned code, main's alerts code (hint), the data commit's two files");
  for (const c of checkouts) {
    assert.match(c, /persist-credentials: false/);
    assert.match(c, /\n {8}if: steps\.pin\.outputs\.ok == 'true'( && steps\.which\.outputs\.ok == 'true')?\n/, "nothing is fetched without a valid pin");
  }
  assert.match(checkouts[0], /\n {10}ref: \$\{\{ steps\.pin\.outputs\.sha \}\} *(#[^\n]*)?\n {10}path: code\n/, "the code = the pinned commit");
  assert.match(checkouts[1], /\n {10}ref: main *(#[^\n]*)?\n {10}path: published\n/, "main, for the hint only");
  assert.match(checkouts[1], /\n {10}sparse-checkout: \|\n {12}\/cf\/alerts\/\n {12}\/app\/domain\/\n {10}sparse-checkout-cone-mode: false\b/, "only main's alerts code (cf/alerts, app/domain) — no data from main here");
  assert.match(checkouts[2], /\n {8}if: steps\.pin\.outputs\.ok == 'true' && steps\.which\.outputs\.ok == 'true'\n/);
  assert.match(checkouts[2], /\n {10}ref: \$\{\{ steps\.which\.outputs\.ref \}\} *(#[^\n]*)?\n {10}path: data\n/, "the data = the commit the which step chose");
  assert.match(checkouts[2], /\n {10}sparse-checkout: \|\n {12}\/app\/data\.json\n {12}\/app\/data-meta\.json\n {10}sparse-checkout-cone-mode: false\b/, "exactly the two data files");
  const run = steps.filter((st) => /\brun:/.test(st));
  assert.equal(run.length, 6, "the pin check, the 'main is newer' hint, which data, taking the data, notify, the end mark");
  const [, hint, which, take, step, end] = run;
  // the hint: two diffs and a notice, nothing from either checkout is run
  assert.match(hint, /diff -rq code\/cf\/alerts published\/cf\/alerts/);
  assert.equal(/node |bash |python|source |\. \S/.test(hint.replace(/echo "[^"]*"/g, "")), false, "the hint runs nothing from a checkout");
  // which data: the deployed commit (the same one the deploy job took its files from), main on a no-build day, nothing while
  // public hosting is paused; every value through env
  assert.match(which, /\n {8}id: which\n/);
  assert.match(which, /\n {10}DEPLOYED: \$\{\{ needs\.deploy\.result == 'success' && needs\.deploy\.outputs\.skipped == '' \}\}\n/);
  assert.match(which, /\n {10}SAVED: \$\{\{ needs\.update\.outputs\.sha \}\}\n/, "the commit the factory saved = the one the deploy job took its data from");
  assert.match(which, /\n {10}PUBLIC: \$\{\{ vars\.PUBLIC_DEPLOY \}\}\n/);
  assert.match(which, /\[\[ \$SAVED =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.equal(/\$\{\{/.test(which.slice(which.indexOf("run: |"))), false, "no expression inside the script text");
  // taking the data: regular files + checksums + the public app's data-meta.json; nothing run from a checkout; no secret
  assert.match(take, /\n {8}id: data\n/);
  assert.match(take, /\n {8}timeout-minutes: \d+ *(#[^\n]*)?\n/, "the data step has its own time limit");
  assert.match(take, /\n {10}APP_URL: \$\{\{ vars\.PUBLIC_APP_URL \|\| 'https:\/\/yoonsiljang\.lsy2825\.workers\.dev' \}\}\n/, "the public app address: a repository variable, default the public app");
  assert.match(take, /mode=\$\(git -C data ls-tree HEAD -- "\$f" \| cut -d' ' -f1\)/);
  assert.match(take, /if \[ "\$mode" != 100644 \] \|\| \[ ! -f "data\/\$f" \] \|\| \[ -L "data\/\$f" \]; then skip/);
  assert.match(take, /hashlib\.sha256\(raw\)\.hexdigest\(\) != want or meta\.get\("bytes"\) != len\(raw\)/, "the deploy job's own check: sha256 and bytes");
  const curl = /curl [^\n]*\\\n[^\n]*/.exec(take)[0];
  for (const flag of ["--fail", "--proto '=https'", "--max-redirs 0", "--max-time 60", "--max-filesize 1000000", '"$APP_URL/data-meta.json"']) assert.ok(curl.includes(flag), `curl ${flag}`);
  assert.match(take, /\[ "\$code" = 200 \]/, "HTTP 200 only (a redirect answer is not followed and not taken)");
  assert.ok(take.indexOf('cp data/app/data.json "$RUNNER_TEMP/data.json"') > take.indexOf('if [ "$served" = "$want" ]'), "the file is handed on only after the public app's data-meta.json named it");
  assert.equal(/code\/|published\/|node /.test(take), false, "nothing from the code or hint checkout is read or run in the data step");
  assert.equal(/ALERTS_(URL|SECRET|MODE)|secrets\./.test(pin + hint + which + take), false, "the pin, hint, which and data steps have no secret");
  // the notify step: only with a valid pin AND the data taken; the pinned code on the data file; three env values. FULL
  // only for the FIRST attempt of the daily schedule (one computation per D1 day — cf/alerts/src/worker.js arithmetic; a
  // Re-run keeps event_name 'schedule' and re-runs this job with the deploy job — 7th review), the key set otherwise. No
  // continue-on-error of its own (7th review): a failure or timeout must end the job before the end mark (done stays
  // empty → the alert job's Telegram line); the JOB's continue-on-error keeps the run green
  assert.match(step, /\n {8}if: steps\.pin\.outputs\.ok == 'true' && steps\.data\.outputs\.ok == 'true'\n/);
  assert.match(step, /\n {8}run: node code\/cf\/alerts\/notify\.mjs "\$RUNNER_TEMP\/data\.json"\n/);
  assert.match(step, /\n {8}timeout-minutes: \d+\n/);
  assert.equal(/continue-on-error/.test(step), false, "the notify step does not swallow its own failure or timeout");
  for (const st of steps) assert.equal(/\n {8}continue-on-error:/.test(st), false, `no price_alerts step hides a failure from the end mark: ${st.split("\n")[0]}`);
  const env = step.slice(step.indexOf("        env:\n") + 13).split("\n").filter((l) => /^ {10}\w+:/.test(l)).map((l) => l.trim().split(":")[0]);
  assert.deepEqual(env, ["ALERTS_MODE", "ALERTS_URL", "ALERTS_SECRET"]);
  assert.match(step, /\n {10}ALERTS_MODE: \$\{\{ github\.event_name == 'schedule' && github\.run_attempt == '1' && 'full' \|\| 'keys' \}\}\n/, "full only on the daily schedule's first attempt; a push, Run workflow or Re-run sends the key set only");
  assert.ok(steps.indexOf(end) === steps.indexOf(step) + 1, "the end mark comes right after notify (a failed notify skips it)");
  assert.equal(/\n {8}if:/.test(end), false, "the end mark has no if: (always() would mark a failed job done)");
  assert.match(step, /\n {10}ALERTS_URL: \$\{\{ secrets\.ALERTS_URL \|\| vars\.ALERTS_URL \|\| 'https:\/\/yoonsiljang-alerts\.lsy2825\.workers\.dev' \}\}\n/, "ALERTS_URL defaults to the alerts Worker");
  assert.match(step, /\n {10}ALERTS_SECRET: \$\{\{ secrets\.ALERTS_SECRET \}\}(\n|$)/);
  assert.match(end, /\n {8}id: end\n {8}run: echo "done=true" >> "\$GITHUB_OUTPUT"/);
  assert.ok(steps.indexOf(end) === steps.length - 1, "the end mark is the last step");
  assert.equal(/CLOUDFLARE_|GITHUB_TOKEN|github\.token|secrets\.(?!ALERTS_)/.test(pa.replace(/secrets\.ALERTS_URL \|\| vars\.ALERTS_URL/, "")), false, "no other secret in the price-alerts job");
});

// the run script of one price_alerts step, as the runner gets it (the block scalar with its 10-space indent removed)
function priceAlertsStepScript(id) {
  const yml = fs.readFileSync(path.join(__dirname, "../.github/workflows/weekly.yml"), "utf8");
  const pa = yml.slice(yml.indexOf("\n  price_alerts:\n"));
  const st = pa.split(/\n {6}- /).find((s) => new RegExp(`\\n {8}id: ${id}\\n`).test(s));
  assert.ok(st, `price_alerts step ${id}`);
  const lines = st.split("\n");
  const i = lines.findIndex((l) => l === "        run: |");
  assert.ok(i > 0, `step ${id} has a run block`);
  const body = [];
  for (const l of lines.slice(i + 1)) { if (l.trim() && !l.startsWith("          ")) break; body.push(l.slice(10)); }
  return body.join("\n").replace(/\n+$/, "") + "\n";
}

test("price alerts which/data steps (run as written, a real git checkout, fake curl): the deployed commit or main; regular files with matching checksums; handed on only when the public app serves that data-meta.json", () => {
  const which = priceAlertsStepScript("which"), script = priceAlertsStepScript("data");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alerts-data-"));
  try {
    // which: every case
    const runWhich = (env) => {
      const out = path.join(dir, "which-out");
      fs.writeFileSync(out, "");
      const r = spawnSync("bash", ["-e", "-c", which], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, ...env } });
      return { status: r.status, out: r.stdout + r.stderr, output: fs.readFileSync(out, "utf8") };
    };
    const SHA = "a".repeat(40);
    assert.equal(runWhich({ DEPLOYED: "true", SAVED: SHA, PUBLIC: "on" }).output, `ref=${SHA}\nok=true\n`, "this run deployed: the saved commit");
    assert.equal(runWhich({ DEPLOYED: "false", SAVED: "", PUBLIC: "on" }).output, "ref=main\nok=true\n", "a no-build schedule day: main's copy");
    for (const bad of ["", "abc", `${SHA}\nref=evil`, SHA.toUpperCase()]) {
      const r = runWhich({ DEPLOYED: "true", SAVED: bad, PUBLIC: "on" });
      assert.equal(r.output, "ok=false\n", JSON.stringify(bad));
      assert.match(r.out, /::warning title=price alerts::the factory job named no valid commit/);
    }
    for (const p of ["", "off", "On", "on "]) {
      const r = runWhich({ DEPLOYED: "true", SAVED: SHA, PUBLIC: p });
      assert.equal(r.output, "ok=false\n", JSON.stringify(p));
      assert.match(r.out, /::notice title=price alerts::public hosting is paused/);
    }
    // data: a git checkout named data/ holding app/data.json + app/data-meta.json at HEAD, and a fake curl serving the public app
    const bin = path.join(dir, "bin"), pub = path.join(dir, "pub");
    for (const d of [bin, pub]) fs.mkdirSync(d);
    const dataJson = JSON.stringify({ meta: { updated: "2026-10-12", rows: 1 }, s: ["", "X24"] });
    const sha = require("crypto").createHash("sha256").update(dataJson).digest("hex");
    const meta = (h, bytes = dataJson.length) => JSON.stringify({ schema: 1, updated: "2026-10-12", bytes, sha256: h });
    const g = (...a) => { const r = spawnSync("git", ["-C", path.join(dir, "data"), ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    const commit = (files) => {
      fs.rmSync(path.join(dir, "data"), { recursive: true, force: true });
      fs.mkdirSync(path.join(dir, "data", "app"), { recursive: true });
      g("init", "-q");
      for (const [f, t] of Object.entries(files)) {
        if (typeof t === "object") fs.symlinkSync(t.link, path.join(dir, "data", f));
        else fs.writeFileSync(path.join(dir, "data", f), t);
      }
      g("add", "-A");
      g("commit", "-q", "-m", "data");
    };
    fs.writeFileSync(path.join(bin, "curl"), [
      "#!/usr/bin/env bash",
      'echo "$*" >> "$CURL_LOG"',
      'out=""; url=""',
      'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -w|--max-time|--max-filesize|--max-redirs|--proto) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done',
      'case "${FAKE_CURL:-}" in fail) echo "curl: (6) fake network error" >&2; exit 6;; redirect) printf 302; exit 0;; esac',
      'src="$PUB"; [ -n "${PUB_LATER:-}" ] && [ "$(wc -l < "$CURL_LOG")" -gt 1 ] && src="$PUB_LATER"',
      'f="$src/${url##*/}"; [ -f "$f" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }',
      'cp "$f" "$out"; printf 200',
    ].join("\n") + "\n", { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "sleep"), '#!/usr/bin/env bash\necho "$*" >> "$SLEEP_LOG"\n', { mode: 0o755 });
    let n = 0;
    const run = (env = {}) => {
      const rt = path.join(dir, `rt${++n}`), out = path.join(dir, `out${n}`), clog = path.join(dir, `curl${n}`), slog = path.join(dir, `sleep${n}`);
      fs.mkdirSync(rt);
      for (const f of [out, clog, slog]) fs.writeFileSync(f, "");
      const r = spawnSync("bash", ["-e", "-c", script], { cwd: dir, encoding: "utf8",
        env: { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: rt, GITHUB_OUTPUT: out, CURL_LOG: clog, SLEEP_LOG: slog, PUB: pub, APP_URL: "https://app.example.test/", ...env } });
      const taken = path.join(rt, "data.json");
      return { status: r.status, out: r.stdout + r.stderr, output: fs.readFileSync(out, "utf8"), curl: fs.readFileSync(clog, "utf8").trim().split("\n").filter(Boolean),
        sleeps: fs.readFileSync(slog, "utf8").trim().split("\n").filter(Boolean).length, taken: fs.existsSync(taken) ? fs.readFileSync(taken, "utf8") : null };
    };
    // the deployed pair, and the public app serves its data-meta.json: taken after one download
    commit({ "app/data.json": dataJson, "app/data-meta.json": meta(sha) });
    fs.writeFileSync(path.join(pub, "data-meta.json"), meta(sha));
    let r = run();
    assert.equal(r.status, 0, r.out);
    assert.equal(r.output, "ok=true\n", r.out);
    assert.equal(r.taken, dataJson);
    assert.match(r.out, /^price alerts: the data commit's data\.json is the one the public app serves \(sha256 checked\)$/m);
    assert.deepEqual(r.curl.map((l) => l.split(" ").pop()), ["https://app.example.test/data-meta.json"], "only the small data-meta.json is downloaded");
    assert.match(r.curl[0], /--fail --proto =https --max-redirs 0 --max-time 60 --max-filesize 1000000 /);
    assert.equal(r.sleeps, 0);
    // the public app serves another build (a deploy that did not reach it, public hosting paused): three tries, a ::warning
    fs.writeFileSync(path.join(pub, "data-meta.json"), meta("b".repeat(64)));
    r = run();
    assert.equal(r.output, "ok=false\n");
    assert.equal(r.taken, null);
    assert.match(r.out, /^::warning title=price alerts::the public app does not serve this data\.json \(a deploy that did not reach it, or a newer one\) — nothing sent \(the next daily run \(06:00 KST\) computes again; a push, Run workflow or Re-run only sends the key set\)$/m);
    assert.deepEqual([r.curl.length, r.sleeps], [3, 2]);
    // ... and serves it from the second try on (a deploy that just finished)
    const later = path.join(dir, "later");
    fs.mkdirSync(later);
    fs.writeFileSync(path.join(later, "data-meta.json"), meta(sha));
    r = run({ PUB_LATER: later });
    assert.equal(r.output, "ok=true\n", r.out);
    assert.deepEqual([r.curl.length, r.sleeps], [2, 1]);
    // a network error, a redirect answer, no file, not JSON: never taken
    fs.writeFileSync(path.join(pub, "data-meta.json"), meta(sha));
    for (const env of [{ FAKE_CURL: "fail" }, { FAKE_CURL: "redirect" }, { PUB: path.join(dir, "missing") }]) {
      r = run(env);
      assert.equal(r.output, "ok=false\n", JSON.stringify(env));
      assert.equal(r.taken, null);
    }
    fs.writeFileSync(path.join(later, "data-meta.json"), "not json");
    assert.equal(run({ PUB: later }).output, "ok=false\n");
    // the data commit's own pair does not match (another build's data.json, wrong bytes, no sha256): refused before any download
    for (const files of [{ "app/data.json": dataJson + " ", "app/data-meta.json": meta(sha) }, { "app/data.json": dataJson, "app/data-meta.json": meta(sha, 1) },
      { "app/data.json": dataJson, "app/data-meta.json": JSON.stringify({ updated: "2026-10-12" }) }, { "app/data.json": dataJson, "app/data-meta.json": "{" }]) {
      commit(files);
      r = run();
      assert.equal(r.output, "ok=false\n", JSON.stringify(files).slice(0, 80));
      assert.match(r.out, /::warning title=price alerts::app\/data\.json of the data commit does not match its data-meta\.json/);
      assert.equal(r.curl.length, 0);
    }
    // a symlink in the data commit (it could point at a file of this machine): refused by its git mode
    fs.writeFileSync(path.join(dir, "secret.json"), dataJson);
    commit({ "app/data.json": { link: path.join(dir, "secret.json") }, "app/data-meta.json": meta(sha) });
    r = run();
    assert.equal(r.output, "ok=false\n");
    assert.match(r.out, /::warning title=price alerts::app\/data\.json in the data commit is not a regular file \(mode '120000'\)/);
    assert.equal(r.taken, null);
    // PUBLIC_APP_URL that is not one https address: refused before any download
    commit({ "app/data.json": dataJson, "app/data-meta.json": meta(sha) });
    for (const u of ["http://app.example.test", "https://app.example.test\nhttps://evil.example", "https://app.example.test/x?y=1", "https://user@app.example.test", "file:///etc/passwd", ""]) {
      r = run({ APP_URL: u });
      assert.equal(r.output, "ok=false\n", JSON.stringify(u));
      assert.match(r.out, /::warning title=price alerts::repository variable PUBLIC_APP_URL is not an https address/);
      assert.equal(r.curl.length, 0, `no download for ${JSON.stringify(u)}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
