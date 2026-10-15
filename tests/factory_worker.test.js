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
function runDeploy({ fail = "", token = "tok", github = false } = {}) {
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
