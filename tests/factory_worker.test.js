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
const load = () => import(path.join(__dirname, "../cf/factory/src/runs.js"));

// run only deploy() from tools/factory.sh, under the script's own `set -euo pipefail`, with a fake wrangler that records its
// arguments and fails on the config named in FAKE_FAIL ("public" = the root config, "admin" = cf/admin)
function runDeploy({ fail = "", token = "tok", github = false, pub = "on" } = {}) {
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
  const env = { ...process.env, CALLS: calls, FAKE_FAIL: fail };
  delete env.GITHUB_ACTIONS;
  if (github) env.GITHUB_ACTIONS = "true";
  delete env.PUBLIC_DEPLOY;
  if (pub !== null) env.PUBLIC_DEPLOY = pub;
  const r = spawnSync("bash", ["-c", script], { cwd: path.join(__dirname, ".."), env, encoding: "utf8" });
  const lines = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: r.stdout + r.stderr, calls: lines };
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

test("weekly.yml hands PUBLIC_DEPLOY to the factory step (a repository variable, no secret)", () => {
  const wf = fs.readFileSync(path.join(__dirname, "../.github/workflows/weekly.yml"), "utf8");
  assert.match(wf, /^ {10}PUBLIC_DEPLOY: \$\{\{ vars\.PUBLIC_DEPLOY \}\}/m);
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
// second clone that moves main underneath it. No git identity anywhere (empty HOME, no global/system config), like a
// bare Actions runner. A pre-receive hook on origin can reject the first N pushes to exercise the retry.
function runSave({ moveMain = true, rejectPushes = 0, nothing = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-save-"));
  const env = { ...process.env, HOME: path.join(dir, "home"), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const k of Object.keys(env)) if (/^GIT_(AUTHOR|COMMITTER)_/.test(k)) delete env[k];
  fs.mkdirSync(env.HOME);
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const ident = ["-c", "user.name=seed", "-c", "user.email=seed@example.com"];
  const origin = path.join(dir, "origin.git"), a = path.join(dir, "factory"), b = path.join(dir, "other");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(dir, "clone", "-q", origin, a);
  fs.writeFileSync(path.join(a, "README"), "seed\n");
  git(a, "add", "README"); git(a, ...ident, "commit", "-q", "-m", "seed"); git(a, "push", "-q", "origin", "HEAD:main");
  git(dir, "clone", "-q", origin, b);
  if (moveMain) {                                                // someone else pushes to main after the factory cloned
    fs.writeFileSync(path.join(b, "other.txt"), "moved\n");
    git(b, "add", "other.txt"); git(b, ...ident, "commit", "-q", "-m", "main moved"); git(b, "push", "-q", "origin", "HEAD:main");
  }
  if (rejectPushes > 0) {                                        // reject the first N pushes, then accept
    fs.mkdirSync(path.join(origin, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(origin, "hooks", "pre-receive"),
      `#!/usr/bin/env bash\nn=$(cat "${origin}/rejects" 2>/dev/null || echo 0)\nif [ "$n" -lt ${rejectPushes} ]; then echo $((n+1)) > "${origin}/rejects"; echo "fake: rejected $((n+1))" >&2; exit 1; fi\nexit 0\n`, { mode: 0o755 });
  }
  if (!nothing) fs.writeFileSync(path.join(a, "app-data.json"), '{"built":1}\n');
  const sh = fs.readFileSync(path.join(__dirname, "../tools/factory.sh"), "utf8");
  const fn = sh.slice(sh.indexOf("save() {"), sh.indexOf("\n}", sh.indexOf("save() {")) + 2);
  const script = `set -euo pipefail\nMODE=test\nBOT_NAME="weekly-prices bot"\nBOT_EMAIL="actions@users.noreply.github.com"\n` +
    `log() { echo "== factory[$MODE]: $*"; }\nsleep() { :; }\n${fn}\nsave "Weekly prices" app-data.json missing.json\necho after-save\n`;
  const r = spawnSync("bash", ["-c", script], { cwd: a, env, encoding: "utf8" });
  git(b, "fetch", "-q", "origin", "main");
  const mainLog = git(b, "log", "--format=%an|%s", "origin/main").split("\n");
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: r.stdout + r.stderr, mainLog };
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
