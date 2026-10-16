// node --test tests/security/*.test.js (also in tests/run_regression.sh and the PR checks) — keeps the Windows PC setup
// (tools/windows/, docs/LOCAL_SETUP_WINDOWS.md) honest: the same Node/Python versions as the GitHub checks, the same versions
// in the script and the guide, a verified Node download, no PIN stored, a tools folder only this account can change, files
// Windows can actually read, and one setup route only (the old one-line installer stays gone though the repo is public again).
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
const codeOf = (t) => t.split("\n").map((l) => l.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/#.*$/, "")).join("\n");
const psCode = codeOf(ps);
const pinPs = read("tools/windows/pin.ps1").replace(/^\uFEFF/, "");
// Each Join-Path call and how many positional (path) parts it gets. Strings are kept (a "$(Join-Path \u2026)" inside one counts),
// text in single quotes is emptied first (it may hold spaces or #), and a comment starts at the first # outside double quotes.
function joinPathParts(text) {
  const found = [];
  for (const line of text.split("\n")) {
    let l = line.replace(/'[^']*'/g, "''"), dq = false;
    for (let i = 0; i < l.length; i++) { if (l[i] === '"') dq = !dq; else if (l[i] === "#" && !dq) { l = l.slice(0, i); break; } }
    const group = (i) => { let d = 0; for (let j = i; j < l.length; j++) { if (l[j] === "(") d++; else if (l[j] === ")" && --d === 0) return j + 1; } return l.length; };
    for (const m of l.matchAll(/Join-Path\b/g)) {
      let i = m.index + m[0].length, parts = 0, value = false;
      for (;;) {
        while (l[i] === " " || l[i] === "\t") i++;
        if (i >= l.length || /[)}|;]/.test(l[i])) break;
        let j = i;
        if (l[i] === "(") j = group(i);
        else if (l[i] === "'") { while (l[j] === "'") j = l.indexOf("'", j + 1) + 1; }
        else if (l[i] === '"') { j = l.indexOf('"', i + 1); j = j < 0 ? l.length : j + 1; }
        else while (j < l.length && !/[\s)}|;]/.test(l[j])) j = l[j] === "(" ? group(j) : j + 1;
        const tok = l.slice(i, j);
        if (/^-[A-Za-z]/.test(tok)) value = !/^-Resolve$/i.test(tok);   // -Path x / -ChildPath x are named, -Resolve is a switch
        else if (value) value = false;
        else parts++;
        i = j;
      }
      found.push({ line: line.trim(), parts });
    }
  }
  return found;
}

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
  for (const f of ["setup.ps1", "pin.ps1"]) assert.deepEqual([...raw(`tools/windows/${f}`).subarray(0, 3)], [0xef, 0xbb, 0xbf], `${f} starts with a UTF-8 BOM`);
  for (const f of ["setup.bat", "start.bat", "stop.bat", "pin.bat"]) {
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
  for (const [name, text, code] of [["setup.ps1", ps, psCode], ["pin.ps1", pinPs, codeOf(pinPs)]]) {
    assert.doesNotMatch(code, /\?\?|&&|\|\||-AdditionalChildPath|utf8NoBOM|-Parallel\b/, name);
    const glued = text.split("\n").map((l, i) => [i + 1, l.replace(/'[^']*'/g, "''")]).filter(([, l]) => /\$[A-Za-z_]\w*[\uac00-\ud7a3]/.test(l));
    assert.deepEqual(glued, [], `${name}: write \${name}개, not $name개 — PowerShell reads the Korean letters as part of the variable name`);
    const joins = joinPathParts(text);
    assert.ok(joins.length >= 3, `${name}: Join-Path calls found`);
    assert.deepEqual(joins.filter((j) => j.parts > 2), [], `${name}: Join-Path takes two parts in 5.1 (3+ parts need PowerShell 6's -AdditionalChildPath) — nest it instead`);
  }
  assert.deepEqual(joinPathParts("$a = Join-Path $b 'c' 'd'").map((j) => j.parts), [3], "the counter sees three parts");
  assert.deepEqual(joinPathParts("(Join-Path (Join-Path $PSScriptRoot '..') '..')").map((j) => j.parts), [2, 2], "and nested calls as two each");
  assert.deepEqual(joinPathParts("Ok \"x: $(Join-Path $T 'a b') # y\" # Join-Path $a $b $c").map((j) => j.parts), [2], "inside a string yes, in a comment no");
  assert.deepEqual(joinPathParts("Join-Path $T \"node-$v-win\" 'it''s'").map((j) => j.parts), [3], "double-quoted and doubled-quote parts count once each");
  assert.deepEqual(joinPathParts("Join-Path -Path $a -ChildPath ([x]::y('z')) -Resolve").map((j) => j.parts), [0], "named parameters are not positional parts");
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
  assert.match(ps, /rev-parse --verify -q HEAD\s*\n\s*\$haveRepo = \(\$LASTEXITCODE -eq 0\) -and \[bool\]\(& \$git -C \$RepoDir ls-files -- requirements\.txt\)/, "no commit, or a commit without an index (checkout failed), is a half-finished clone");
  assert.doesNotMatch(ps, /git restore --source=HEAD :\//, "that advice leaves the index missing; a commit after it deletes every other file");
  assert.match(ps, /\$alt = Join-Path \$env:USERPROFILE '윤실장'\s*\n\s*if \(-not \$PSBoundParameters\.ContainsKey\('RepoDir'\) -and -not \(Test-Path \(Join-Path \$RepoDir '\.git'\)\) -and \(Test-Path \(Join-Path \$alt '\.git'\)\)\) \{ \$RepoDir = \$alt \}/, "an existing clone wins over the desktop setting");
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

// ---- tools/windows/pin.ps1: change the PIN screen number (user decision 2026-10-16) -------------------------------------
const gate = read("app/gate.js"), sw = read("app/sw.js");
const pinCode = codeOf(pinPs);
const pinRaw = pinPs.split("\n").map((l) => l.trim());

test("pin.ps1 hashes the number the way app/gate.js checks it, and finds exactly one HASH line and one VER line", () => {
  const prefix = pinPs.match(/^\$Prefix = '([^']+)'/m);
  assert.ok(prefix, "pin.ps1 sets $Prefix");
  assert.ok(gate.includes(`sha256("${prefix[1]}" + pin) === HASH`), "gate.js check() uses the same prefix");
  assert.match(pinPs, /^\$PinPattern = '\^\[0-9\]\{4\}\$'/m, "4 digits");
  assert.match(pinPs, /\$pin1 = Read-Pin '[^']*'\s*\n\s*if \(\$pin1 -notmatch \$PinPattern\) \{ Stop-Here /, "the 4-digit rule is enforced right after the first entry");
  assert.match(gate, /pin\.length < 4\) pin \+= d/, "gate.js takes 4 digits");
  assert.match(gate, /if \(pin\.length === 4\) setTimeout\(check/, "and checks at the 4th");
  const hashRe = /\[regex\]::Matches\(\$gate, '([^']+)'\)/.exec(pinPs), verRe = /\[regex\]::Matches\(\$sw, '([^']+)'\)/.exec(pinPs);
  assert.ok(hashRe && verRe, "pin.ps1 looks for the HASH and VER lines");
  assert.equal((gate.match(new RegExp(hashRe[1], "g")) || []).length, 1, "exactly one HASH line in app/gate.js (else the tool refuses)");
  assert.equal((sw.match(new RegExp(verRe[1], "g")) || []).length, 1, "exactly one VER line in app/sw.js");
  assert.match(gate, /HASH = sha256\("velyb-gate:" \+ PIN\)/, "the comment in gate.js still names the same rule");
});

test("pin.ps1 never shows, stores or sends the number: hidden input, wiped memory, no file, no variable, no log", () => {
  assert.equal((pinPs.match(/Read-Host -Prompt \$prompt -AsSecureString/g) || []).length, 1, "the only input is hidden");
  assert.match(pinPs, /ZeroFreeBSTR\(\$b\); \$s\.Dispose\(\)/, "the plain copy in memory is wiped");
  assert.doesNotMatch(pinCode, /Read-Host(?![^\n]*-AsSecureString)/, "no visible Read-Host");
  // every raw line (strings and comments kept, any case, $pin1 · ${pin1} · $script:pin1 …) that names the two variables — exactly these
  assert.deepEqual(pinRaw.filter((l) => /pin[12]\b/i.test(l)), [
    "$pin1 = $null; $pin2 = $null; $failed = $false",
    "$pin1 = Read-Pin '  새 번호'",
    "if ($pin1 -notmatch $PinPattern) { Stop-Here '숫자 4개가 아니에요. 다시 실행해 주세요.' }",
    "$pin2 = Read-Pin '  한 번 더'",
    "if ($pin1 -ne $pin2) { Stop-Here '두 번 입력한 번호가 달라요. 다시 실행해 주세요.' }",
    "$newHash = Get-Sha256Hex ($Prefix + $pin1)",
    "$pin1 = $null; $pin2 = $null",
    "$pin1 = $null; $pin2 = $null",
  ], "the number is only read, checked, compared, hashed and cleared");
  // files are written only by the Write-Utf8 helper, and only gate.js and sw.js are written with it
  assert.deepEqual(pinRaw.filter((l) => /WriteAll(Text|Bytes|Lines)|AppendAll(Text|Lines)|StreamWriter|FileStream|\[IO\.File\]::(Create|Open|AppendText|Copy|Move)/i.test(l)),
    ["function Write-Utf8([string]$p, [string]$t) { [IO.File]::WriteAllText($p, $t, $Utf8) }"], "no other file writer");
  assert.deepEqual(pinRaw.filter((l) => /Write-Utf8/.test(l)).slice(1), [
    "Write-Utf8 $gatePath ($gate.Replace(\"const HASH = `\"$oldHash`\"\", \"const HASH = `\"$newHash`\"\"))",
    "Write-Utf8 $swPath ($sw.Replace(\"const VER = `\"pc-v$oldVer`\";\", \"const VER = `\"pc-v$newVer`\";\"))",
  ], "Write-Utf8 writes only the HASH and VER lines");
  assert.doesNotMatch(pinCode, /APP_PIN|SetEnvironmentVariable|setx|Set-Content|Add-Content|Out-File|Tee-Object|Start-Transcript|Export-Clixml|Set-Clipboard/i);
  assert.match(pinPs, /finally \{\s*\n\s*\$pin1 = \$null; \$pin2 = \$null/, "cleared even when something fails");
});

test("pin.ps1 works on GitHub's latest main commit, refuses while another PIN PR is open, and gives VER a value no other PR would pick", () => {
  assert.match(pinPs, /& \$git -C \$root fetch --quiet origin '\+refs\/heads\/main:refs\/remotes\/origin\/main'\s*\n\s*if \(\$LASTEXITCODE -ne 0\)/, "main is fetched into its exact place (whatever remote.origin.fetch says)");
  assert.match(pinPs, /\$base = \[string\]\(& \$git -C \$root rev-parse --verify --quiet 'refs\/remotes\/origin\/main\^\{commit\}'\)/, "and used by its commit id");
  assert.match(pinPs, /Ok \('최신 main ' \+ \$base\.Substring\(0, 7\)\)/, "the OK line shows which commit");
  assert.match(pinPs, /worktree add --quiet --no-checkout --detach \$tmp \$base/, "the temporary worktree starts at that commit, not at a name");
  const dup = pinPs.indexOf("& $git -C $root fetch --quiet --prune origin '+refs/heads/pin/*:refs/remotes/origin/pin/*'"), ask = pinPs.indexOf("Read-Pin '  새 번호'");
  assert.ok(dup > 0 && dup < ask, "the pin/ branches are fetched (deleted ones pruned) before the number is asked");
  assert.match(pinPs, /\$open = @\(& \$git -C \$root for-each-ref '--format=%\(refname\)' "--no-merged=\$base" 'refs\/remotes\/origin\/pin'/, "a pin/ branch not merged into main is an open PIN PR");
  assert.match(pinPs, /if \(\$open\.Count -gt 0\) \{\s*\n\s*Stop-Here \('[^']*' \+ \(\$open -join ', '\) \+ '[^']*PR을 먼저 닫고[^']*브랜치를 지운 뒤/, "and stops: close it and delete its branch first");
  assert.ok(pinPs.indexOf("if ($open.Count -gt 0)") < ask);
  assert.match(pinPs, /\$newVer = \[long\]\(Get-Date -Format 'yyMMddHH'\)\s*\n\s*if \(\$newVer -lt \(\$oldVer \+ 100\)\) \{ \$newVer = \$oldVer \+ 100 \}/,
    "VER = date+hour, never the old VER + 1 another PR would pick (so a race shows up as a conflict in app/sw.js)");
  assert.match(pinPs, /\$title = '[^']*\(' \+ \$branch \+ '\)'/, "the PR title names its branch");
  assert.match(pinPs, /충돌이 보이면[^\n]*이 PR을 닫고 브랜치를 지운 뒤 pin\.bat를 다시 실행/, "PR text: a conflict in app/sw.js means close and run again");
  assert.match(pinPs, /Write-Host '  2\. GitHub에 app\/sw\.js 충돌이 보이면[^']*다시 실행하세요\.'/, "and so do the next steps");
});

test("pin.ps1 changes only the two lines, on a new pin/ branch, never main and never the working folder; hooks cannot add files", () => {
  assert.match(pinPs, /& \$git -c \$nh -C \$tmp read-tree HEAD/, "its index is main's file list (so the commit keeps every other file)");
  assert.match(pinPs, /& \$git -c \$nh -C \$tmp add -- app\/gate\.js app\/sw\.js/, "only the two files are staged");
  assert.match(pinPs, /\$want = @\("1`t1`tapp\/gate\.js", "1`t1`tapp\/sw\.js"\)/, "and the staged change must be one line in each");
  assert.match(pinPs, /if \(\(\$numstat\.Count -ne 2\) -or \(\$numstat\[0\] -ne \$want\[0\]\) -or \(\$numstat\[1\] -ne \$want\[1\]\)\) \{\s*\n\s*Stop-Here \('바뀐 줄이/, "else it stops before the commit");
  assert.match(pinPs, /^\s*\$nh = 'core\.hooksPath=' \+ \$noHooks$/m, "hooks point to an empty folder outside the repository");
  assert.match(pinPs, /^\s*\$noHooks = \$tmp \+ '-nohooks'$/m);
  const inTmp = [...pinCode.matchAll(/& \$git [^\n]*-C \$tmp [^\n]*/g)].map((m) => m[0]);
  assert.ok(inTmp.length >= 6);
  for (const l of inTmp) assert.match(l, /^& \$git -c \$nh -C \$tmp /, `every git command in the temporary folder runs without hooks: ${l}`);
  assert.match(pinPs, /& \$git -c \$nh -C \$root worktree add /);
  assert.match(pinPs, /-C \$tmp commit --quiet --no-verify /, "commit --no-verify");
  const recheck = pinPs.indexOf("diff --numstat $base HEAD"), push = pinPs.indexOf(" push --quiet");
  assert.ok(recheck > 0 && recheck < push, "right before the push: the commit is checked again");
  assert.match(pinPs, /\$parent = \[string\]\(& \$git -c \$nh -C \$tmp rev-parse --verify --quiet 'HEAD\^'\)/);
  assert.match(pinPs, /if \(\(\$parent -ne \$base\) -or \(\$after\.Count -ne 2\) -or \(\$after\[0\] -ne \$want\[0\]\) -or \(\$after\[1\] -ne \$want\[1\]\)\) \{\s*\n\s*Stop-Here/, "parent = main commit, exactly the two lines, else stop");
  assert.match(pinPs, /\$branch = 'pin\/' \+ \(Get-Date/);
  const pushes = [...pinCode.matchAll(/& \$git[^\n]* push [^\n]*/g)].map((m) => m[0]);
  assert.equal(pushes.length, 1);
  assert.match(pushes[0], /push --quiet --no-verify origin ""$/, "push target is the pin/ branch (a quoted HEAD:refs/heads/$branch)");
  assert.match(pinPs, /push --quiet --no-verify origin "HEAD:refs\/heads\/\$branch"/);
  assert.deepEqual(pinRaw.filter((l) => /refs\/heads\/main|\bpush\b[^\n]*\bmain\b/.test(l)), ["& $git -C $root fetch --quiet origin '+refs/heads/main:refs/remotes/origin/main'"], "main is only fetched, never pushed");
  assert.match(pinPs, /worktree remove --force \$tmp/, "the temporary folder is removed");
  assert.match(pinPs, /if \(\$noHooks -and \(Test-Path -LiteralPath \$noHooks\)\) \{ Remove-Item/, "and so is the empty hooks folder");
  assert.match(pinPs, /\[IO\.File\]::ReadAllText\(\$p, \$Utf8\)/, "gate.js has Korean text: read and written as UTF-8 without BOM, not with Get-Content");
});

test("pin.ps1 after the push: a browser that does not open is not a failure, and any later failure says the branch is already up", () => {
  assert.match(pinPs, /if \(\$LASTEXITCODE -ne 0\) \{ Stop-Here 'GitHub에 올리지 못했어요[^\n]*\n\s*\$pushed = \$true/, "$pushed is set right after the push");
  assert.match(pinPs, /try \{ Start-Process \$prUrl -ErrorAction Stop \}\s*\n\s*catch \{ Write-Host '[^']*위 주소[^']*' -ForegroundColor Yellow \}/, "Start-Process failing only prints where the address is");
  assert.match(pinPs, /if \(\$failed -and \$pushed\) \{[^}]*이미 올라갔어요[^}]*다시 실행하지 마세요[^}]*exit 1\s*\n\}/, "a failure after the push does not say 'nothing changed'");
  assert.ok(pinPs.indexOf("if ($failed -and $pushed)") < pinPs.indexOf("if ($failed) {"), "that message comes first");
  assert.match(pinPs, /열린 페이지\(안 열렸으면 위 주소\)에서/);
});

test("pin.bat checks that pin.ps1 is next to it and keeps the window open; the guide explains the tool", () => {
  const bat = read("tools/windows/pin.bat");
  assert.match(bat, /^if exist "%~dp0pin\.ps1" goto run\r?$/m);
  assert.match(bat, /^powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pin\.ps1" %\*\r?\npause\r?$/m, "the window stays open after pin.ps1 ends (pin.ps1 has no pause of its own)");
  assert.match(bat, /^echo pin\.ps1 is missing[^\n]*\r?\npause\r?\nexit \/b 1\r?$/m, "the missing-file note stays on screen");
  assert.match(bat, /\r\n/, "CRLF (.gitattributes *.bat eol=crlf)");
  assert.doesNotMatch(bat.replace(/\r\n/g, ""), /\n/, "every line ends with CRLF");
  assert.ok(doc.includes("tools\\windows\\pin.bat"), "guide names pin.bat");
  assert.match(doc, /공개 주소는[^\n]*예전 번호/, "guide says the public copy keeps the old number while public deploys are off");
  assert.match(doc, /몇 초 만에/, "and that a 4-digit hash is no protection");
  assert.match(doc, /예전 번호 바꾸기 PR[^\n]*닫/, "guide: close an old PIN PR before running again");
  assert.match(doc, /`app\/sw\.js` 충돌/, "guide: what a conflict in app/sw.js means");
});

// End to end on throwaway repositories (a local bare 'origin' named lsy2825/skin.git — never GitHub), one fresh repository per
// case. Needs PowerShell 7 (pwsh) and Python's pty module (a terminal for the hidden prompt), e.g. the ubuntu-24.04 PR check;
// skipped elsewhere (Windows PCs). The little Python terminal answers .NET's cursor-position questions at once (else each typed
// key waits for a timeout), types each answer only when its prompt has appeared AND the terminal's echo is off (typed earlier,
// Linux would echo the number back), and kills the tool after 60 s, printing what it saw.
const { spawnSync } = require("child_process");
const os = require("os");
const crypto = require("crypto");
const TERMINAL = String.raw`
import os, pty, select, signal, sys, termios, time
answers, cmd = sys.argv[1].split("\n"), sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
out, typed, end = b"", 0, time.time() + 60
while time.time() < end:
    if not select.select([fd], [], [], 0.5)[0]:
        continue
    try:
        data = os.read(fd, 4096)
    except OSError:
        break
    if not data:
        break
    out += data
    for _ in range(data.count(b"\x1b[6n")):
        os.write(fd, b"\x1b[1;1R")
    text = out.decode("utf-8", "replace")
    if typed < len(answers) and text.count("새 번호: ") + text.count("한 번 더: ") > typed:
        wait = time.time() + 5
        while termios.tcgetattr(fd)[3] & termios.ECHO and time.time() < wait:
            time.sleep(0.01)
        os.write(fd, answers[typed].encode() + b"\r")
        typed += 1
if time.time() >= end:
    os.kill(pid, signal.SIGKILL)
    out += b"\n[terminal: no exit within 60 s, killed]\n"
status = os.waitpid(pid, 0)[1]
sys.stdout.write(out.decode("utf-8", "replace"))
sys.exit(os.waitstatus_to_exitcode(status))
`;
const have = (cmd, args) => { try { return spawnSync(cmd, args, { encoding: "utf8", timeout: 20000 }).status === 0; } catch { return false; } };
const which = (cmd) => (process.env.PATH || "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, cmd))
  .find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } });
const canRun = process.platform !== "win32" && have("pwsh", ["-NoProfile", "-Command", "exit 0"]) && have("python3", ["-c", "import pty, termios"]);
const PWSH = canRun ? which("pwsh") : null, PY = canRun ? which("python3") : null, GIT = canRun ? which("git") : null;
const sha = (p) => crypto.createHash("sha256").update("velyb-gate:" + p).digest("hex");
const hashOf = (g) => g.match(/const HASH = "([0-9a-f]{64})"/)[1];
const verOf = (s) => +s.match(/const VER = "pc-v(\d+)";/)[1];
// test numbers that cannot appear in a branch name's HHmmss (hours ≤ 23, minutes/seconds ≤ 59), so the screen check is never fooled
const PIN = ["9753", "8642"].find((p) => sha(p) !== hashOf(gate));
// the seed's sw.js has a fixed small VER, so these cases do not depend on the VER this repository has today (after a PIN PR
// it is a date value, which would move the tool to its VER + 100 rule)
const SW0 = sw.replace(/const VER = "pc-v\d+";/, 'const VER = "pc-v29";');
const expVer = (date, old) => (date < old + 100 ? old + 100 : date);
const WANT = ["1\t1\tapp/gate.js", "1\t1\tapp/sw.js"];
const yyMMddHH = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return +`${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}`; };

// A fresh throwaway repository: origin (bare), seed (writes main), and the user's clone '윤실장' with an unsaved README edit
function repo({ gateText = gate, withTool = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pin-e2e-"));
  const git = (cwd, ...a) => { const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8" }); assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`); return r.stdout; };
  const origin = path.join(tmp, "lsy2825", "skin.git"), seed = path.join(tmp, "seed"), work = path.join(tmp, "윤실장");
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(seed, rel)), { recursive: true }); fs.writeFileSync(path.join(seed, rel), text); };
  const toMain = (msg) => { git(seed, "add", "-A"); git(seed, "commit", "-q", "-m", msg); git(seed, "push", "-q", origin, "HEAD:refs/heads/main"); return git(seed, "rev-parse", "HEAD").trim(); };
  fs.mkdirSync(origin, { recursive: true }); git(origin, "init", "-q", "--bare");
  fs.mkdirSync(seed, { recursive: true }); git(seed, "init", "-q");
  put("app/gate.js", gateText); put("app/sw.js", SW0); put("README.md", "x\n"); put("docs/a.md", "a\n");
  if (withTool) put("tools/windows/pin.ps1", raw("tools/windows/pin.ps1"));
  toMain("seed");
  git(tmp, "clone", "-q", origin, work); git(work, "config", "user.name", "t"); git(work, "config", "user.email", "t@example.invalid");
  fs.appendFileSync(path.join(work, "README.md"), "my unsaved edit\n");
  const run = (answers, { script = path.join(root, "tools/windows/pin.ps1"), repoDir = work, env = {} } = {}) => {
    const r = spawnSync(PY, ["-c", TERMINAL, answers.join("\n"), PWSH, "-NoProfile", "-File", script, ...(repoDir ? ["-RepoDir", repoDir] : [])],
      { encoding: "utf8", timeout: 90000, env: { ...process.env, TMPDIR: tmp, POWERSHELL_TELEMETRY_OPTOUT: "1", POWERSHELL_UPDATECHECK: "Off", ...env } });
    const out = (r.stdout || "").replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, "");   // without colour and title codes
    assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith("yoonsiljang-pin-")), [], `the temporary folders are gone\n${out}`);
    assert.equal(git(work, "worktree", "list").trim().split("\n").length, 1, "the temporary worktree is unregistered");
    return { status: r.status, out };
  };
  const branches = () => git(origin, "for-each-ref", "--format=%(refname:short)", "refs/heads/pin").split("\n").filter(Boolean);
  return { tmp, origin, seed, work, git, put, toMain, run, branches };
}
// Nothing on the screen shows what was typed: not the error line, and not the rest (minus temp paths and long hex runs —
// commit ids, dates — that could hold the same digits by chance)
function hidden(c, r, typed) {
  const bang = r.out.split("\n").filter((l) => l.includes("!!"));
  const screen = r.out.split(c.tmp).join("").replace(/[0-9a-f]{7,}/gi, "");
  for (const t of typed) {
    assert.ok(!bang.some((l) => l.includes(t)), `the error line does not show the typed text: ${bang.join(" / ")}`);
    assert.ok(!screen.includes(t), "the typed text never appears on the screen (hidden prompt shows *)");
  }
}
function refused(c, r, why, typed) {
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, why);
  assert.match(r.out, /바꾸지 않았어요/);
  assert.deepEqual(c.branches().filter((b) => /^pin\/\d{8}-\d{6}$/.test(b)), [], "nothing pushed");
  hidden(c, r, typed);
}
// The tool pushed one pin/ branch on top of GitHub's main: the right hash, only VER changed in sw.js, two lines in all
function pushed(c, r, { swMain = SW0 } = {}) {
  assert.equal(r.status, 0, r.out);
  const mine = c.branches().filter((b) => /^pin\/\d{8}-\d{6}$/.test(b));
  assert.equal(mine.length, 1, `one new pin/ branch: ${mine}`);
  const br = mine[0], g = (...a) => c.git(c.origin, ...a);
  assert.equal(g("rev-parse", `${br}^`).trim(), g("rev-parse", "main").trim(), "the branch sits on GitHub's latest main");
  assert.deepEqual(g("diff", "--numstat", "main", br).trim().split("\n"), WANT, "exactly one line in gate.js and one in sw.js");
  const newGate = g("show", `${br}:app/gate.js`), newSw = g("show", `${br}:app/sw.js`);
  assert.ok(newGate.includes(`const HASH = "${sha(PIN)}"`), "gate.js has sha256('velyb-gate:' + number)");
  assert.equal(newGate.replace(sha(PIN), hashOf(gate)), gate, "every other byte of gate.js (Korean text, line ends) is unchanged");
  const oldVer = verOf(swMain), ver = verOf(newSw);
  assert.equal(newSw, swMain.replace(`const VER = "pc-v${oldVer}";`, `const VER = "pc-v${ver}";`), "sw.js: only VER changed, from main's own sw.js");
  assert.ok(ver >= oldVer + 100, "at least 100 above main's VER: never a value another PR would pick by counting up");
  const msg = g("log", "-1", "--format=%B", br);
  assert.ok(!msg.includes(PIN), "the commit message has no number");
  assert.ok(msg.includes(`pc-v${oldVer} -> pc-v${ver}`), msg);
  hidden(c, r, [PIN]);
  return { br, oldVer, ver };
}
const e2e = (name, opts, fn) => test(`pin.ps1 end to end: ${name}`, { skip: canRun ? false : "needs pwsh and python3 (pty)" }, () => {
  const c = repo(opts);
  try { fn(c); } finally { fs.rmSync(c.tmp, { recursive: true, force: true }); }
});

e2e("a number that is not 4 digits (12345, 123, 12a4) changes nothing", {}, (c) => {
  for (const bad of ["12345", "123", "12a4"]) {
    const r = c.run([bad, bad]);
    refused(c, r, /숫자 4개가 아니에요/, [bad]);
    assert.doesNotMatch(r.out, /한 번 더/, `${bad}: stops at the first entry`);
  }
});

e2e("two different entries change nothing", {}, (c) => {
  const other = [...PIN].reverse().join("");   // a different 4 digits that also cannot appear in HHmmss
  refused(c, c.run([PIN, other]), /두 번 입력한 번호가 달라요/, [PIN, other]);
});

e2e("the number in use now changes nothing", { gateText: gate.replace(hashOf(gate), sha(PIN)) }, (c) => {
  refused(c, c.run([PIN, PIN]), /지금 번호와 같아요/, [PIN]);
});

e2e("success: hash and a date VER on a new pin/ branch, number nowhere, working copy untouched; merged or deleted pin/ branches do not block", {}, (c) => {
  c.git(c.seed, "push", "-q", c.origin, "HEAD:refs/heads/pin/old-merged");                       // an old PIN PR that was merged
  const gone = c.git(c.work, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "old").trim();     // a branch deleted on GitHub that
  c.git(c.work, "update-ref", "refs/remotes/origin/pin/20250101-000000", gone);                   // this PC still lists (pruned)
  const before = yyMMddHH(), r = c.run([PIN, PIN]), after = yyMMddHH();
  const { br, ver } = pushed(c, r);
  assert.ok(ver >= expVer(before, 29) && ver <= expVer(after, 29), `VER is the date and hour (yyMMddHH): ${ver}`);
  assert.ok(r.out.includes("최신 main " + c.git(c.origin, "rev-parse", "main").trim().slice(0, 7)), "the OK line names main's commit");
  const url = new URL(r.out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("https://github.com/lsy2825/skin/compare/main...")));
  assert.equal(url.searchParams.get("title"), `비밀번호 화면 번호 바꾸기 (${br})`, "the PR title names its branch");
  const body = url.searchParams.get("body");
  assert.match(body, /app\/sw\.js 충돌이 보이면[^\n]*닫고[^\n]*다시 실행/);
  assert.match(body, /부탁 → B: [^\n]*pc-v\d+ 다음 번호/);
  assert.ok(!body.includes(PIN));
  assert.equal(c.git(c.work, "status", "--short"), " M README.md\n", "the working copy keeps its own edit and nothing else");
});

e2e("main moved after the clone: the branch sits on the new main and VER comes from the new main", {}, (c) => {
  const moved = SW0.replace('const VER = "pc-v29";', 'const VER = "pc-v99123123";');   // above any date: the + 100 rule
  c.put("app/sw.js", moved); c.toMain("B: VER up");
  const { ver } = pushed(c, c.run([PIN, PIN]), { swMain: moved });
  assert.equal(ver, 99123223, "old VER + 100 when the date is below old VER + 100");
});

e2e("an unsaved edit in app/sw.js stays in the working folder and out of the branch", {}, (c) => {
  fs.appendFileSync(path.join(c.work, "app", "sw.js"), "// my unsaved edit\n");
  const { br } = pushed(c, c.run([PIN, PIN]));
  assert.ok(!c.git(c.origin, "show", `${br}:app/sw.js`).includes("my unsaved edit"));
  assert.equal(c.git(c.work, "status", "--short"), " M README.md\n M app/sw.js\n");
  assert.ok(fs.readFileSync(path.join(c.work, "app", "sw.js"), "utf8").endsWith("// my unsaved edit\n"));
});

e2e("a gate.js with a UTF-8 BOM is refused by the two-line check (the tool writes without BOM)", { gateText: "﻿" + gate }, (c) => {
  const r = c.run([PIN, PIN]);
  refused(c, r, /바뀐 줄이 예상과 달라서 올리지 않았어요: 2\t2\tapp\/gate\.js \| 1\t1\tapp\/sw\.js/, [PIN]);
  assert.doesNotMatch(r.out, /커밋이 예상과 달라서|OK {2}브랜치/, "stopped by the first check, before any commit");
});

e2e("hooks in the user's clone (pre-commit 'git add -A') never run: still exactly two lines, or nothing pushed", {}, (c) => {
  const hooks = path.join(c.tmp, "hooks"), mark = path.join(c.tmp, "hook-ran");
  fs.mkdirSync(hooks);
  for (const h of ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit", "post-checkout", "pre-push"]) {
    fs.writeFileSync(path.join(hooks, h), `#!/bin/sh\necho ${h} >> '${mark}'\n${h === "pre-commit" ? "git add -A\n" : ""}exit 0\n`, { mode: 0o755 });
  }
  c.git(c.work, "config", "core.hooksPath", hooks);
  const r = c.run([PIN, PIN]);
  if (r.status === 0) pushed(c, r);
  else { assert.equal(r.status, 1, r.out); assert.deepEqual(c.branches(), [], "nothing pushed"); }
  assert.ok(!fs.existsSync(mark), `no hook ran: ${fs.existsSync(mark) ? fs.readFileSync(mark, "utf8") : ""}`);
});

e2e("an unmerged pin/ branch on GitHub stops the tool before it asks for the number", {}, (c) => {
  c.git(c.seed, "checkout", "-q", "-b", "side");
  c.put("README.md", "an older PIN PR\n"); c.git(c.seed, "commit", "-q", "-am", "an older PIN PR (not merged)");
  c.git(c.seed, "push", "-q", c.origin, "HEAD:refs/heads/pin/20260101-000000");
  const r = c.run([PIN, PIN]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /아직 합치지 않은 번호 바꾸기 브랜치가 GitHub에 있어요: pin\/20260101-000000 — [^\n]*PR을 먼저 닫고/);
  assert.doesNotMatch(r.out, /새 번호/, "the number is never asked");
  assert.deepEqual(c.branches(), ["pin/20260101-000000"], "nothing new pushed");
});

e2e("on Windows with no way to open a browser: still a success, with a note to use the printed address", {}, (c) => {
  const bin = path.join(c.tmp, "bin");
  fs.mkdirSync(bin); fs.symlinkSync(fs.realpathSync(GIT), path.join(bin, "git"));      // PATH: git only — no xdg-open & co.
  const r = c.run([PIN, PIN], { env: { OS: "Windows_NT", PATH: bin } });
  pushed(c, r);
  assert.match(r.out, /브라우저를 열지 못했어요\. 위 주소를/);
  assert.doesNotMatch(r.out, /바꾸지 않았어요|!!/);
});

e2e("double-click route: tools/windows/pin.ps1 inside the clone, no -RepoDir (pin.bat passes none)", { withTool: true }, (c) => {
  pushed(c, c.run([PIN, PIN], { script: path.join(c.work, "tools", "windows", "pin.ps1"), repoDir: null }));
  assert.equal(c.git(c.work, "status", "--short"), " M README.md\n");
});
