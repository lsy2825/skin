# One-time setup of this project on a Windows 10/11 PC.
#   Installs Git, Python 3.12, Node.js LTS and GitHub CLI with winget (tools already there are skipped),
#   gets the project into C:\dev\skin (git clone, or git pull if it is already there; another folder: set
#   $env:SKIN_DIR first),
#   installs the Python packages and runs the unit tests. Safe to run again.
# Run in PowerShell (no admin needed; Windows may ask for permission while installing):
#   irm https://raw.githubusercontent.com/lsy2825/skin/main/tools/setup-windows.ps1 | iex
# Messages are in English on purpose: Windows PowerShell 5.1 can garble non-ASCII text in scripts.
# No 'exit' anywhere: under 'irm | iex' it would close the PowerShell window.

$Dir = if ($env:SKIN_DIR) { $env:SKIN_DIR } else { "C:\dev\skin" }
$Repo = "https://github.com/lsy2825/skin.git"

function Step($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "STOPPED: $t" -ForegroundColor Red; throw $t }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
# Python 3.12 itself, not the Microsoft Store 'python' shortcut
function FindPython {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    $p = & py -3.12 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $p) { return "$p".Trim() }
  }
  foreach ($x in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:ProgramFiles\Python312\python.exe")) {
    if (Test-Path $x) { return $x }
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
  git -C $Dir pull --ff-only
  if ($LASTEXITCODE -ne 0) { Fail "git pull failed - there may be local changes in $Dir (see 'git -C $Dir status')" }
} else {
  if (Test-Path $Dir) { Fail "$Dir exists but is not a git folder. Rename or delete it, then run this again." }
  New-Item -ItemType Directory -Force -Path (Split-Path $Dir) -ErrorAction Stop | Out-Null
  git clone $Repo $Dir
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$Dir\requirements.txt")) { Fail "git clone failed" }
}

Step "Python packages"
$py = FindPython
if (-not $py) { Fail "Python 3.12 cannot be found. Close PowerShell, open a new one and run this again." }
& $py -m pip install -r "$Dir\requirements.txt"
if ($LASTEXITCODE -ne 0) { Fail "pip install failed" }

Step "Unit tests (node --test)"
Push-Location $Dir -ErrorAction Stop
node --test
$testCode = $LASTEXITCODE
Pop-Location
if ($testCode -ne 0) { Write-Host "Some tests failed - send the output above to Claude." -ForegroundColor Yellow }

Step "Done"
git --version
& $py --version
Write-Host "node $(node --version)"
gh --version | Select-Object -First 1
Write-Host ""
Write-Host "Open the app on this PC:" -ForegroundColor Green
Write-Host "  cd $Dir"
Write-Host "  & `"$py`" -m http.server 8766 --directory app"
Write-Host "  then open http://localhost:8766 in a browser (stop the server with Ctrl+C)"
Write-Host ""
Write-Host "Only if you will push changes from this PC (once):" -ForegroundColor Green
Write-Host "  gh auth login"
Write-Host "  git config --global user.name `"your name`""
Write-Host "  git config --global user.email `"your GitHub email`""
