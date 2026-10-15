# One-time setup of this project on a Windows 10/11 PC (what goes where: docs/LOCAL_SETUP.md).
#   Installs Git, Python 3.12, Node.js LTS and GitHub CLI with winget (tools already there are skipped),
#   uses the clone this script sits in (or gets the project into C:\dev\skin: git clone, or git pull if it is already
#   there; another folder: set $env:SKIN_DIR first),
#   installs the Python packages, optionally Playwright + Chromium for the screen tests, shows where everything went,
#   and runs the unit tests last.
#   Safe to run again.
# Run it from the clone (no admin needed; Windows may ask for permission while installing):
#   powershell -ExecutionPolicy Bypass -File tools\setup-windows.ps1
# (The repository is private since 2026-10-15, so 'irm https://raw.githubusercontent.com/... | iex' needs a login and
#  no longer works as a one-liner.)
# Messages are in English on purpose: Windows PowerShell 5.1 can garble non-ASCII text in scripts.
# No 'exit' anywhere: under 'irm | iex' it would close the PowerShell window.

# the clone this file is in (tools\..), when it is run as a file; under 'irm | iex' $PSScriptRoot is empty
$Here = if ($PSScriptRoot) { Split-Path $PSScriptRoot -Parent } else { "" }
# (a copy without .git, e.g. unzipped, is used as it is: no update, no second copy in C:\dev\skin)
$Dir = if ($env:SKIN_DIR) { $env:SKIN_DIR } elseif ($Here -and ((Test-Path (Join-Path $Here ".git")) -or
        ((Test-Path (Join-Path $Here "app\index.html")) -and (Test-Path (Join-Path $Here "requirements.txt"))))) { $Here } else { "C:\dev\skin" }
$Playwright = "1.56.1"                                   # exact version, like requirements.txt
$E2E = Join-Path $env:LOCALAPPDATA "yoonsiljang\e2e"     # Playwright lives outside the project folder
$Repo = "https://github.com/lsy2825/skin.git"

function Step($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "STOPPED: $t" -ForegroundColor Red; throw $t }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
# Output of a program read as UTF-8: with PYTHONUTF8=1 Python writes UTF-8, and Windows PowerShell 5.1 would read it in the
# console code page (949 on Korean Windows) - a Korean user folder name in a path came back garbled
function Utf8Out([scriptblock]$cmd) {
  $old = [Console]::OutputEncoding
  try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; return (& $cmd) } finally { [Console]::OutputEncoding = $old }
}
# Python 3.12 itself, not the Microsoft Store 'python' shortcut. The usual folders first, then the py launcher
function FindPython {
  foreach ($x in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:ProgramFiles\Python312\python.exe")) {
    if (Test-Path $x) { return $x }
  }
  if (Get-Command py -ErrorAction SilentlyContinue) {
    $p = Utf8Out { & py -3.12 -X utf8 -c "import sys; print(sys.executable)" 2>$null }
    if ($LASTEXITCODE -eq 0 -and $p -and (Test-Path "$p".Trim())) { return "$p".Trim() }
  }
  return $null
}
function NodeOk {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  $v = & node --version
  return ($v -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20)
}

Step "Checking winget"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Fail "winget was not found. Install or update 'App Installer' from Microsoft Store, then run this again."
}

$apps = @(
  @{ id = "Git.Git";            name = "Git";         have = { [bool](Get-Command git -ErrorAction SilentlyContinue) } },
  @{ id = "Python.Python.3.12"; name = "Python 3.12"; have = { [bool](FindPython) } },
  @{ id = "OpenJS.NodeJS.LTS";  name = "Node.js LTS"; have = { NodeOk } },
  @{ id = "GitHub.cli";         name = "GitHub CLI";  have = { [bool](Get-Command gh -ErrorAction SilentlyContinue) } }
)
foreach ($a in $apps) {
  Step "$($a.name)"
  if (& $a.have) { Write-Host "already installed - skipped"; continue }
  winget install --id $a.id -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { Fail "installing $($a.name) failed (winget exit code $LASTEXITCODE)" }
  RefreshPath
  if (-not (& $a.have)) { Fail "$($a.name) was installed but cannot be found yet. Close PowerShell, open a new one and run this again." }
}

Step "Settings"
# Korean text in files and output: the same setting the GitHub runs use
[Environment]::SetEnvironmentVariable("PYTHONUTF8", "1", "User")
$env:PYTHONUTF8 = "1"
Write-Host "PYTHONUTF8=1 (saved for new windows too)"

Step "Project folder $Dir"
if (Test-Path "$Dir\.git") {
  # an update failing (not logged in to GitHub, local changes) does not stop the setup: it goes on with the files there
  git -C $Dir pull --ff-only
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not update $Dir from GitHub - going on with the files already there." -ForegroundColor Yellow
    Write-Host "  Possible reasons: not logged in to GitHub (a login window may have been closed), or local changes (git -C `"$Dir`" status)." -ForegroundColor Yellow
  }
} elseif ($Dir -eq $Here) {
  Write-Host "not a git clone - update skipped"
} else {
  if (Test-Path $Dir) { Fail "$Dir exists but is not a git folder. Rename or delete it, then run this again." }
  New-Item -ItemType Directory -Force -Path (Split-Path $Dir) -ErrorAction Stop | Out-Null
  git clone $Repo $Dir
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$Dir\requirements.txt")) { Fail "git clone failed" }
}

Step "Python packages"
$py = FindPython
if (-not $py -or -not (Test-Path $py)) { Fail "Python 3.12 cannot be found. Close PowerShell, open a new one and run this again." }
$global:LASTEXITCODE = 0       # (global: a plain assignment would make a script copy that hides the real exit code)
& $py -m pip install -r "$Dir\requirements.txt"
if (-not $? -or $LASTEXITCODE -ne 0) { Fail "pip install failed" }

Step "Playwright + Chromium for the screen tests (optional, about 300 MB)"
$ans = Read-Host "Install them? Only needed for tests\e2e (y/N)"
if ($ans -match '^[yY]') {
  New-Item -ItemType Directory -Force -Path $E2E -ErrorAction Stop | Out-Null
  npm install --prefix "$E2E" --no-fund --no-audit "playwright@$Playwright"
  if ($LASTEXITCODE -ne 0) { Fail "npm install playwright failed" }
  & (Join-Path $E2E "node_modules\.bin\playwright.cmd") install chromium
  if ($LASTEXITCODE -ne 0) { Fail "downloading Chromium failed" }
  # the screen tests load require(process.env.PLAYWRIGHT || 'playwright')
  [Environment]::SetEnvironmentVariable("PLAYWRIGHT", (Join-Path $E2E "node_modules\playwright"), "User")
  $env:PLAYWRIGHT = Join-Path $E2E "node_modules\playwright"
  Write-Host "PLAYWRIGHT=$env:PLAYWRIGHT (saved for new windows too)"
} else {
  Write-Host "skipped"
}

Step "Done"
git --version
& $py --version
Write-Host "node $(node --version)"
gh --version | Select-Object -First 1
Write-Host ""
Write-Host "Where things are (details: docs\LOCAL_SETUP.md):" -ForegroundColor Green
Write-Host "  project      $Dir"
Write-Host "  git          $((Get-Command git).Source)"
Write-Host "  python       $py"
$pkgs = Utf8Out { & $py -X utf8 -c "import requests, os; print(os.path.dirname(os.path.dirname(requests.__file__)))" }
Write-Host "  packages     $pkgs"
Write-Host "  node         $((Get-Command node).Source)"
Write-Host "  gh           $((Get-Command gh).Source)"
if (Test-Path $E2E) { Write-Host "  playwright   $E2E (browsers: $env:LOCALAPPDATA\ms-playwright)" }
Write-Host ""
Write-Host "Open the app on this PC:" -ForegroundColor Green
Write-Host "  double-click tools\run-app-windows.bat in $Dir"
Write-Host "  (or: cd `"$Dir`" ; & `"$py`" -m http.server 8766 --directory app ; then open http://localhost:8766)"
Write-Host ""
Write-Host "Only if you will push changes from this PC (once):" -ForegroundColor Green
Write-Host "  gh auth login"
Write-Host "  git config --global user.name `"your name`""
Write-Host "  git config --global user.email `"your GitHub email`""

# Last, so the summary above is shown even if a test hangs. Only tests\*.test.js: the ones under cf\, server\ and
# tests\security\ and the factory test need bash or a server; a few more can fail on Windows line endings (CRLF).
# None of this matters for opening the app.
Step "Unit tests (node --test tests\*.test.js, about a minute)"
Push-Location $Dir -ErrorAction Stop
$tests = Get-ChildItem tests\*.test.js | Where-Object { $_.Name -ne "factory_worker.test.js" } | ForEach-Object { $_.FullName }
node --test --test-timeout=120000 $tests
$testCode = $LASTEXITCODE
Pop-Location
if ($testCode -ne 0) { Write-Host "Some tests failed. The app still opens; send the output above to Claude if you like." -ForegroundColor Yellow }
