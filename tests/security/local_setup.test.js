// node --test tests/security/*.test.js (also in tests/run_regression.sh and the PR checks) — keeps the Windows PC setup
// (tools/windows/, docs/LOCAL_SETUP_WINDOWS.md) honest: the same Node/Python versions as the GitHub checks, the same versions
// in the script and the guide, a verified Node download, no PIN stored, a tools folder only this account can change, files
// Windows can actually read, and one setup route only (the old one-line installer cannot reach a private repository).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const raw = (p) => fs.readFileSync(path.join(root, p));
const ps = read("tools/windows/setup.ps1").replace(/^\uFEFF/, "");
const doc = read("docs/LOCAL_SETUP_WINDOWS.md");
const pin = (name) => { const m = ps.match(new RegExp(`^\\$${name} = '([^']+)'`, "m")); assert.ok(m, `setup.ps1 sets $${name}`); return m[1]; };
// PowerShell code without comments and without the text inside quotes (so words in messages are not read as code)
const psCode = ps.split("\n").map((l) => l.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/#.*$/, "")).join("\n");

test("setup.ps1 installs the Node and Python versions the GitHub checks use", () => {
  const ci = read(".github/workflows/pr-checks.yml");
  const node = ci.match(/node-version: "(\d+)"/), python = ci.match(/python-version: "([\d.]+)"/);
  assert.ok(node && python, "pr-checks.yml still pins node-version and python-version");
  assert.equal(pin("NodeMajor"), node[1]);
  assert.equal(pin("PythonVer"), python[1]);
  assert.match(ps, new RegExp(`Python\\.Python\\.${pin("PythonVer").replace(".", "\\.")}'`), "winget installs that Python");
  assert.match(ps, new RegExp(`Python${pin("PythonVer").replace(".", "")}\\\\python\\.exe`), "and looks for it where it installs");
  assert.match(ps, new RegExp(`Python${pin("PythonVer").replace(".", "")}-arm64\\\\python\\.exe`), "ARM64 PCs install into …-arm64");
});

test("the guide lists the same versions, folders, programs and variables the script uses", () => {
  for (const v of [pin("NodeMajor"), pin("PythonVer"), pin("PlaywrightVer"), pin("AxeVer")]) assert.ok(doc.includes(v), `guide mentions ${v}`);
  assert.match(ps, /\[string\]\$Tools = 'C:\\yoonsiljang-tools'/);
  assert.ok(doc.includes("C:\\yoonsiljang-tools\\INSTALLED.md"), "guide points to the result file");
  for (const v of [...ps.matchAll(/Set-UserVar '([A-Z0-9_]+)'/g)].map((m) => m[1])) assert.ok(doc.includes(`\`${v}\``), `guide explains ${v}`);
  for (const id of [...ps.matchAll(/Winget-Install '([\w.]+)'/g)].map((m) => m[1])) assert.ok(doc.includes(`\`${id}\``), `guide names the winget package ${id}`);
  assert.ok(doc.includes("requirements.txt") && ps.includes("requirements.txt"), "Python packages come from requirements.txt");
});

test("the Node download is checked against the official SHA256 list, and a mismatch stops the setup", () => {
  assert.match(ps, /https:\/\/nodejs\.org\/dist\/index\.json/);
  assert.match(ps, /\$base\/SHASUMS256\.txt/);
  assert.match(ps, /\$got = \(Get-FileHash \$zip -Algorithm SHA256\)\.Hash/);
  assert.match(ps, /if \(-not \$want -or \$got\.ToLower\(\) -ne \$want\.ToLower\(\)\) \{ Remove-Item \$zip -Force; throw /);
});

test("the PIN is never stored, and the script only writes user-level variables", () => {
  const noComments = ps.split("\n").map((l) => l.replace(/^\s*#.*$/, "")).join("\n");
  assert.doesNotMatch(noComments, /Set-UserVar\s+['"]?APP_PIN|SetEnvironmentVariable\(\s*['"]APP_PIN|\$env:APP_PIN\s*=|setx\s+APP_PIN|Set-Item\s+[^\n]*APP_PIN/i);
  for (const f of ["setup.bat", "start.bat", "stop.bat"]) assert.doesNotMatch(read(`tools/windows/${f}`), /APP_PIN/i);
  assert.doesNotMatch(ps, /SetEnvironmentVariable\([^)]*'Machine'/, "only user variables are written");
  assert.match(ps, /--scope', 'user'/, "Python goes in the user's own folder");
});

test("the tools folder under C:\\ is locked to this account (+ SYSTEM, Administrators) before anything goes in it", () => {
  const lock = ps.indexOf("& icacls $Tools /inheritance:r /grant:r");
  assert.ok(lock > 0, "icacls removes inherited permissions");
  assert.match(ps, /"\*\$\(\$me\.Value\):\(OI\)\(CI\)F" '\*S-1-5-18:\(OI\)\(CI\)F' '\*S-1-5-32-544:\(OI\)\(CI\)F'/, "by SID, not by (Korean) name");
  assert.match(ps, /GetOwner\(\[Security\.Principal\.SecurityIdentifier\]\)/, "refuses a folder another account made");
  assert.ok(lock < ps.indexOf("Expand") || lock < ps.indexOf("ExtractToDirectory"), "the lock comes before Node is unpacked");
  assert.ok(lock < ps.indexOf("npm.cmd') install"), "and before npm installs");
  assert.match(doc, /이 계정\(과 SYSTEM·관리자\)만 고칠 수 있게/);
});

test("files Windows reads correctly: .ps1 is UTF-8 with BOM (PowerShell 5.1 + Korean), .bat files are ASCII", () => {
  const b = raw("tools/windows/setup.ps1");
  assert.deepEqual([...b.subarray(0, 3)], [0xef, 0xbb, 0xbf], "setup.ps1 starts with a UTF-8 BOM");
  for (const f of ["setup.bat", "start.bat", "stop.bat"]) {
    const t = raw(`tools/windows/${f}`);
    assert.ok([...t].every((c) => c < 0x80), `${f} is ASCII only (cmd.exe reads .bat in the console code page)`);
  }
});

test("setup.bat explains a missing setup.ps1 and keeps the window open when PowerShell fails to start", () => {
  const bat = read("tools/windows/setup.bat");
  assert.match(bat, /^if exist "%~dp0setup\.ps1" goto run\r?$/m);
  assert.match(bat, /^powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\.ps1" %\*\r?$/m);
  assert.match(bat, /^if not "%errorlevel%"=="0" pause\r?$/m, "a string compare also catches negative exit codes");
  assert.match(ps, /setup\.bat와 setup\.ps1 두 파일을 함께/, "the 'run it outside the folder' message names both files");
});

test("PowerShell 7-only syntax and Korean glued to a variable name stay out (the PC may only have Windows PowerShell 5.1)", () => {
  assert.doesNotMatch(psCode, /\?\?|&&|\|\||-AdditionalChildPath|utf8NoBOM|-Parallel\b/);
  const glued = ps.split("\n").map((l, i) => [i + 1, l.replace(/'[^']*'/g, "''")]).filter(([, l]) => /\$[A-Za-z_]\w*[\uac00-\ud7a3]/.test(l));
  assert.deepEqual(glued, [], "write ${name}개, not $name개 — PowerShell reads the Korean letters as part of the variable name");
});

test("text read back from Python is ASCII (JSON), so a Korean user folder is not garbled by the console code page", () => {
  assert.match(ps, /print\(json\.dumps\(dict\(p=/);
  assert.match(ps, /ConvertFrom-Json\)\.p/);
  assert.doesNotMatch(psCode, /& py -0p/, "py -0p prints paths in UTF-8, which 5.1 reads as cp949");
});

test("the app server only listens on this PC and only Python servers are stopped (Store Python is python3.12)", () => {
  assert.match(read("tools/windows/start.bat"), /http\.server 8766 --bind 127\.0\.0\.1 --directory app/);
  assert.match(ps, /'--bind', '127\.0\.0\.1'/);
  for (const t of [read("tools/windows/stop.bat"), ps]) assert.ok(t.includes("'^(python|pythonw|py)[\\d.]*$'"), "name rule matches python, py, python3.12");
});

test("line endings: .sh stays LF and .bat CRLF on any checkout; the clone keeps the repository's own line ends", () => {
  const ga = read(".gitattributes");
  assert.match(ga, /^\*\.sh\s+text eol=lf$/m);
  assert.match(ga, /^\*\.bat\s+text eol=crlf$/m);
  assert.doesNotMatch(ga, /^\*\s+(text|eol)/m, "no repo-wide rule: files stored with CRLF (data2/*.csv) must not show up as changed");
  assert.match(ps, /& \$git clone -c core\.autocrlf=false \$RepoUrl \$RepoDir/);
});

test("one setup route: README points to tools\\windows, the old irm | iex installer is gone", () => {
  const readme = read("README.md");
  assert.ok(readme.includes("tools\\windows\\setup.bat") && readme.includes("docs/LOCAL_SETUP_WINDOWS.md"));
  assert.doesNotMatch(readme, /setup-windows\.ps1 \| iex|raw\.githubusercontent\.com\/lsy2825/);
  assert.ok(!fs.existsSync(path.join(root, "tools/setup-windows.ps1")), "tools/setup-windows.ps1 was replaced by tools/windows/setup.ps1");
});

test("the guide keeps factory outputs out of PRs and scans for secrets after git add", () => {
  for (const f of ["app/data.json", "app/home.json", "app/data-meta.json"]) assert.ok(doc.includes(f), `guide names ${f} as a factory output`);
  assert.match(doc, /git restore app\/data\.json /);
  assert.doesNotMatch(doc, /git add -A/, "add only the files you changed");
  const add = doc.indexOf("git add <고친 파일들>"), scan = doc.indexOf("python tests/security/scan_secrets.py", add), commit = doc.indexOf("git commit", add);
  assert.ok(add > 0 && scan > add && commit > scan, "order: git add → secret scan → commit (the scan reads tracked/staged files only)");
});

test("second review round: another account's folder, winget text, half-finished clone, OneDrive desktop, Korean names in git", () => {
  assert.match(ps, /try \{ \$owner = \(Get-Acl -LiteralPath \$Tools -ErrorAction Stop\)\.GetOwner/, "an unreadable folder (another account locked it) does not crash");
  assert.match(ps, /if \(-not \$owner -or \(\$owner -ne \$me -and \$owner\.Value -ne 'S-1-5-32-544'\)\) \{\s*\n[^\n]*\n\s*\$Tools = Join-Path \$env:LOCALAPPDATA 'yoonsiljang-tools'/, "falls back to this account's own folder");
  const wg = ps.slice(ps.indexOf("function Winget-Install"), ps.indexOf("function Find-Git"));
  assert.match(wg, /\[Console\]::OutputEncoding = New-Object System\.Text\.UTF8Encoding\(\$false\)/, "winget's UTF-8 text is read as UTF-8");
  assert.match(wg, /finally \{ try \{ \[Console\]::OutputEncoding = \$oldEnc \}/, "and the console encoding is put back");
  assert.match(ps, /rev-parse --verify -q HEAD; \$haveRepo = \(\$LASTEXITCODE -eq 0\)/, "a .git folder without a commit is a half-finished clone");
  assert.match(ps, /if \(-not \(Test-Path \(Join-Path \$RepoDir 'requirements\.txt'\)\)\) \{\s*\n\s*throw /, "a clone whose checkout failed stops with what to do");
  assert.match(ps, /\[Environment\]::GetFolderPath\('Desktop'\)/, "the visible desktop is found (OneDrive moves it)");
  assert.match(ps, /\$RepoDir = Join-Path \$env:USERPROFILE '윤실장'/, "and the repository then goes outside OneDrive");
  assert.match(ps, /& \$git config --global core\.quotepath false/);
  assert.match(ps, /if \(\$logStarted\) \{ Write-Host "기록:/, "the log path is shown only when there is a log");
});

test("start.bat keeps the 'port in use' note on screen; stop.bat says so when it could not stop the server", () => {
  const start = read("tools/windows/start.bat"), stop = read("tools/windows/stop.bat");
  assert.match(start, /^:inuse\r?\n(?:rem [^\n]*\n)?(?:echo [^\n]*\n)+pause\r?\nstart "" http:\/\/localhost:8766\/\r?$/m);
  assert.match(stop, /Wait-Process -Id \$i -Timeout 5/);
  assert.match(stop, /if \(Get-Process -Id \$i -ErrorAction SilentlyContinue\) \{ 'Could not stop '/);
});

test("the guide: merge only when every check is green, and the restore list covers data2/history", () => {
  assert.match(doc, /git restore app\/data\.json app\/home\.json app\/data-meta\.json data2\/report\.md data2\/issues\.csv data2\/review\.csv data2\/history/);
  assert.match(doc, /검사가 모두 끝나고 모두 초록색/);
  for (const c of ["pr-checks", "pr-build", "db-security"]) assert.ok(doc.includes(`\`${c}\``), `guide names ${c}`);
});
