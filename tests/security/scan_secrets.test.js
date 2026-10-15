// node --test tests/security/*.test.js (also in tests/run_regression.sh and the PR checks) — the secret scan must read every
// tracked file, Korean names included. Plain `git ls-files` quotes a non-ASCII name ("docs/\353\241..."), open() failed on it
// and the scanner skipped the file without a word, so a token pasted into docs/메모.md passed both the PC check and pr-checks.
// Each case runs tests/security/scan_secrets.py in a throwaway git repository. The fake token is assembled at run time so this
// file itself never contains one (the scanner reads this file too).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const scanner = path.join(__dirname, "scan_secrets.py");
const PY = process.env.PYTHON || "python3";
const fakeToken = () => ["gh", "p_", "Zx9".repeat(12)].join("");

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-"));
  const git = (...a) => { const r = spawnSync("git", a, { cwd: dir, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
  git("init", "-q");
  fs.mkdirSync(path.join(dir, "app"));
  fs.writeFileSync(path.join(dir, "app/config.js"), "window.CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  git("add", "-A");
  return dir;
}
const scan = (dir) => spawnSync(PY, [scanner], { cwd: dir, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } });

test("a token in a Korean-named file is found and the file is named", () => {
  const r = scan(repo({ "docs/한글메모.md": `토큰: ${fakeToken()}\n` }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /docs\/한글메모\.md:1: GitHub token/);
  assert.doesNotMatch(r.stdout, new RegExp(fakeToken()), "the secret itself is never printed");
});

test("the same token is found in an ASCII-named file and in a name with spaces", () => {
  const r = scan(repo({ "docs/memo.md": `${fakeToken()}\n`, "docs/my notes.md": `${fakeToken()}\n` }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /docs\/memo\.md:1: GitHub token/);
  assert.match(r.stdout, /docs\/my notes\.md:1: GitHub token/);
});

test("clean files with Korean names pass, and every tracked file is counted", () => {
  const r = scan(repo({ "docs/로그인_설정.md": "설정 안내\n", "docs/readme.md": "hello\n" }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /secret scan ok \(3 tracked files\)/);
});

test("a tracked file deleted from disk is skipped, not reported as unreadable", () => {
  const dir = repo({ "docs/gone.md": "x\n" });
  fs.unlinkSync(path.join(dir, "docs/gone.md"));
  const r = scan(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
