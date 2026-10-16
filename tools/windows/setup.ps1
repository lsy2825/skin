# 윤실장 — Windows PC 준비(한 번만). 같은 폴더의 setup.bat를 더블클릭하면 이 파일이 실행된다. 설명: docs/LOCAL_SETUP_WINDOWS.md
# 하는 일: Git·Python 3.12 설치(winget, 없을 때만) → 저장소 받기(git clone, 줄바꿈 그대로) → Node.js 22(nodejs.org 공식 zip,
# SHA256 확인)·Playwright·Chromium·axe-core를 C:\yoonsiljang-tools에 → 파이썬 패키지(requirements.txt) → 사용자 환경 변수 →
# 간단한 검사(앱 열기·Chromium·단위 테스트) → C:\yoonsiljang-tools\INSTALLED.md에 실제 위치·버전·검사 결과.
# 다시 실행해도 된다(이미 있는 것은 건너뜀). 관리자 권한 없이 실행한다(Git 설치 때만 Windows가 확인 창을 띄운다).
# 비밀번호 화면 번호(APP_PIN)는 어디에도 저장하지 않는다. Windows PowerShell 5.1에서도 돌아가게 쓴다(?? · 삼항 · && 안 씀).
# 이 파일은 UTF-8(BOM 있음)으로 둔다 — BOM이 없으면 한국어 Windows의 PowerShell 5.1이 한글을 깨뜨려 읽는다.
[CmdletBinding()]
param(
  [string]$RepoDir = (Join-Path $env:USERPROFILE 'Desktop\윤실장'),
  [string]$Tools = 'C:\yoonsiljang-tools',
  [switch]$SkipTests
)

# CI와 같은 판(.github/workflows/pr-checks.yml의 node-version·python-version, tests/security/local_setup.test.js가 맞춰 봄)
$NodeMajor = '22'
$PythonVer = '3.12'
$PlaywrightVer = '1.56.1'
$AxeVer = '4.10.2'
$RepoUrl = 'https://github.com/lsy2825/skin.git'
$Port = 8766

$ErrorActionPreference = 'Continue'      # 프로그램(git·python·node) 실패는 종료 코드로 직접 본다
$ProgressPreference = 'SilentlyContinue' # PowerShell 5.1은 진행 막대 때문에 내려받기가 아주 느려진다
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$warnings = New-Object System.Collections.ArrayList
$results = [ordered]@{}

function Say([string]$m) { Write-Host ''; Write-Host "== $m" -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "  OK  $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "  !!  $m" -ForegroundColor Yellow; [void]$script:warnings.Add($m) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
# 사용자 PATH 맨 앞에 폴더를 넣는다(이미 있으면 앞으로 옮김). %USERPROFILE% 같은 변수는 펼치지 않고 그대로 둔다.
function Add-UserPath([string]$dir) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  $cur = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $want = $dir.TrimEnd('\')
  $keep = @($cur -split ';' | Where-Object { $_ -and ([Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ne $want) })
  $key.SetValue('Path', ((@($want) + $keep) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
  $key.Close()
  $env:Path = "$want;$env:Path"
}
function Set-UserVar([string]$name, [string]$value) {
  [Environment]::SetEnvironmentVariable($name, $value, 'User')   # 새로 여는 창부터 보인다(Windows에 바뀐 것을 알림)
  Set-Item -Path "Env:$name" -Value $value
}
function Winget-Install([string]$id, [string[]]$extra) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget(앱 설치 관리자)이 없어요. Microsoft Store에서 '앱 설치 관리자'를 설치·업데이트한 뒤 다시 실행하세요."
  }
  Write-Host "  winget으로 $id 설치 중... (확인 창이 뜨면 '예')"
  # winget은 UTF-8로 쓴다. 5.1은 받은 출력을 콘솔 코드 페이지(cp949)로 읽어 한국어 안내가 깨지므로, 도는 동안만 UTF-8로 읽는다
  $oldEnc = [Console]::OutputEncoding
  try {
    try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
    & winget install -e --id $id --source winget --accept-package-agreements --accept-source-agreements --silent @extra | Out-Host
    $code = $LASTEXITCODE
  } finally { try { [Console]::OutputEncoding = $oldEnc } catch { } }
  Refresh-Path
  return $code
}
function Find-Git {
  $c = Get-Command git -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe")) { if (Test-Path $p) { return $p } }
  return $null
}
function Find-Python {
  # 1) 설치기가 쓰는 자리(ARM64 PC는 폴더 이름 끝에 -arm64가 붙는다)
  foreach ($p in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python312-arm64\python.exe",
                   "$env:ProgramFiles\Python312\python.exe", "$env:ProgramFiles\Python312-arm64\python.exe")) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  # 2) 설치기가 남기는 레지스트리 기록(PEP 514). py -0p 출력은 쓰지 않는다 — 한글 사용자 폴더 경로가 5.1에서 깨져 읽힌다
  $reg = @(Get-ItemProperty -Path 'HKCU:\Software\Python\PythonCore\3.12*\InstallPath', 'HKLM:\Software\Python\PythonCore\3.12*\InstallPath' -ErrorAction SilentlyContinue |
    ForEach-Object { $_.ExecutablePath } | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
  if ($reg.Count -gt 0) { return [string]$reg[0] }
  return $null
}
function Port-Owners {
  $c = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  return @($c | Select-Object -ExpandProperty OwningProcess -Unique)
}
# 8766 포트를 잡고 있는 파이썬 서버(예전에 띄운 앱)를 끈다. 파이썬이 아니면 건드리지 않는다.
function Close-Port {
  foreach ($procId in (Port-Owners)) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -match '^(python|pythonw|py)[\d.]*$') {   # Microsoft Store 판은 이름이 python3.12
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $procId -Timeout 5 -ErrorAction SilentlyContinue
      if (Get-Process -Id $procId -ErrorAction SilentlyContinue) { Warn "$Port 포트의 파이썬 서버(PID $procId)를 끄지 못했어요 — 그 창을 직접 닫아 주세요"; continue }
      Ok "$Port 포트를 쓰던 파이썬 서버(PID $procId)를 껐어요"
    } elseif ($p) {
      Warn "$Port 포트를 $($p.ProcessName)(PID $procId)이 쓰고 있어요 — 파이썬이 아니라서 그대로 뒀어요"
    }
  }
}

$logStarted = $false
try {
  # 바탕 화면이 OneDrive로 옮겨진 PC: 보이는 바탕 화면은 OneDrive 안이고 C:\Users\<사용자>\Desktop은 화면에 안 보인다.
  # 저장소는 OneDrive 밖(동기화가 .git을 건드리면 잠금·충돌)인 C:\Users\<사용자>\윤실장에 받고, 보이는 바탕 화면에 바로가기를 둔다.
  # 이미 받아 둔 저장소가 있으면 그곳을 쓴다(바탕 화면 설정을 나중에 바꿔도 두 번째 사본을 받지 않게)
  $alt = Join-Path $env:USERPROFILE '윤실장'
  if (-not $PSBoundParameters.ContainsKey('RepoDir') -and -not (Test-Path (Join-Path $RepoDir '.git')) -and (Test-Path (Join-Path $alt '.git'))) { $RepoDir = $alt }
  $desk = [Environment]::GetFolderPath('Desktop')
  $deskMoved = $desk -and ($desk.TrimEnd('\') -ne (Join-Path $env:USERPROFILE 'Desktop'))
  if ($deskMoved -and -not $PSBoundParameters.ContainsKey('RepoDir') -and -not (Test-Path $RepoDir)) {
    $RepoDir = Join-Path $env:USERPROFILE '윤실장'
  }
  if (-not (Test-Path $Tools)) {
    try { New-Item -ItemType Directory -Path $Tools -Force -ErrorAction Stop | Out-Null }
    catch { $Tools = Join-Path $env:LOCALAPPDATA 'yoonsiljang-tools'; New-Item -ItemType Directory -Path $Tools -Force | Out-Null; Warn "C:\ 바로 아래에 폴더를 만들 수 없어 도구를 $Tools 에 둬요" }
  }
  # C:\ 바로 아래 새 폴더는 C:\ 기본 권한을 물려받아 PC의 다른 계정도 고칠 수 있다. 이 폴더의 node가 PATH 맨 앞에 들어가므로
  # 이 계정·SYSTEM·Administrators만 쓰게 잠근다(매번 해도 결과는 같다). 이름 대신 SID — 한글 계정 이름이어도 그대로 된다.
  if ((Split-Path $Tools -Parent) -match '^[A-Za-z]:\\?$') {
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $owner = $null
    try { $owner = (Get-Acl -LiteralPath $Tools -ErrorAction Stop).GetOwner([Security.Principal.SecurityIdentifier]) } catch { }
    if (-not $owner -or ($owner -ne $me -and $owner.Value -ne 'S-1-5-32-544')) {
      # 이 PC의 다른 계정이 먼저 만들어 잠근 폴더(읽을 수도 없음): 건드리지 않고 이 계정 전용 폴더를 쓴다
      $Tools = Join-Path $env:LOCALAPPDATA 'yoonsiljang-tools'; New-Item -ItemType Directory -Path $Tools -Force | Out-Null
      Warn "C:\yoonsiljang-tools 는 이 PC의 다른 계정 폴더라서 도구를 $Tools 에 둬요"
    } else {
      & icacls $Tools /inheritance:r /grant:r "*$($me.Value):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /Q | Out-Null
      if ($LASTEXITCODE -ne 0) { Warn "$Tools 권한을 이 계정 전용으로 바꾸지 못했어요(PC의 다른 계정도 고칠 수 있어요)" }
    }
  }
  try { Start-Transcript -Path (Join-Path $Tools 'setup-log.txt') -Force | Out-Null; $logStarted = $true } catch { }
  Write-Host "윤실장 PC 준비 — 저장소: $RepoDir / 도구: $Tools" -ForegroundColor White

  # 저장소 폴더 안에서 실행하면(압축으로 받은 폴더 등) 그 폴더 이름을 바꾸거나 받을 수 없다 → 밖에서 실행하게 한다
  $here = [string]$PSScriptRoot
  if ($here -and -not (Test-Path (Join-Path $RepoDir '.git')) -and ($here.TrimEnd('\') + '\').StartsWith($RepoDir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "setup.bat와 setup.ps1 두 파일을 함께 $RepoDir 폴더 밖(예: 다운로드 폴더)으로 복사해서 setup.bat를 실행하세요. 이 폴더는 git 저장소로 새로 받아야 해서, 그 안에서는 실행할 수 없어요."
  }

  # 1) Git (+ Git Bash: 테스트 일부가 bash로 돈다)
  Say 'Git'
  $git = Find-Git
  if (-not $git) { [void](Winget-Install 'Git.Git' @()); $git = Find-Git }
  if (-not $git) { throw 'Git을 찾지 못했어요. https://git-scm.com/download/win 에서 설치한 뒤 다시 실행하세요.' }
  $results['Git'] = (& $git --version)
  $gitRoot = Split-Path (Split-Path $git)               # ...\Git\cmd\git.exe → ...\Git
  $gitBash = Join-Path $gitRoot 'bin\bash.exe'
  Ok "$($results['Git']) — $git"
  if (-not (& $git config --global user.name)) {
    $n = Read-Host '  커밋에 남길 이름(GitHub 아이디도 됨, 비우면 건너뜀)'
    if ($n) { & $git config --global user.name $n }
  }
  if (-not (& $git config --global user.email)) {
    $e = Read-Host '  커밋에 남길 이메일(GitHub 계정 이메일, 비우면 건너뜀)'
    if ($e) { & $git config --global user.email $e }
  }
  & $git config --global core.quotepath false          # git status·diff에 한글 파일 이름을 \354\236… 대신 그대로 보여 준다
  # GitHub CLI(gh): PC에서 PR을 만들 때 쓴다(Claude Code 등). 없어도 설치는 계속한다 — PR은 GitHub 웹에서도 만든다
  try {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { [void](Winget-Install 'GitHub.cli' @()) }
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($gh) { $results['GitHub CLI'] = "$(@(& $gh.Source --version)[0]) — $($gh.Source)"; Ok $results['GitHub CLI'] }
    else { Warn 'GitHub CLI(gh)를 설치하지 못했어요 — PR은 GitHub 웹에서 만들면 돼요' }
  } catch { Warn "GitHub CLI(gh) 설치 건너뜀: $($_.Exception.Message)" }

  # 2) 저장소 받기. 줄바꿈은 저장소 그대로(core.autocrlf=false) — Windows식으로 바뀌면 bash 스크립트와 일부 시험이 멈춘다.
  Say "저장소 ($RepoUrl)"
  Close-Port
  # 받다가 끊긴 폴더는 아래 else에서 백업 이름으로 바꾸고 다시 받는다: .git만 있고 커밋(HEAD)이 없거나, 'Clone succeeded,
  # but checkout failed'처럼 HEAD는 있는데 목록(index)이 안 만들어진 경우(그때는 파일 일부가 디스크에 있어도 git이 모른다)
  $haveRepo = $false
  if (Test-Path (Join-Path $RepoDir '.git')) {
    $null = & $git -C $RepoDir rev-parse --verify -q HEAD
    $haveRepo = ($LASTEXITCODE -eq 0) -and [bool](& $git -C $RepoDir ls-files -- requirements.txt)
  }
  if ($haveRepo) {
    if (-not (Test-Path (Join-Path $RepoDir 'requirements.txt'))) {
      throw "저장소 파일 일부가 디스크에 없어요(지워졌거나 디스크 부족·백신). 고친 것이 없으면 Git Bash에서 $RepoDir 폴더를 열고 git reset --hard 를 실행한 뒤 다시 실행하세요. 고친 것이 있으면 먼저 Claude에게 git status 화면을 보여 주세요."
    }
    & $git -C $RepoDir config core.autocrlf false
    Ok "이미 받은 저장소예요 — $RepoDir (최신으로 맞추기: Git Bash에서 git pull)"
    $fs = Join-Path $RepoDir 'tools\factory.sh'
    if ((Test-Path $fs) -and ([IO.File]::ReadAllText($fs)).Contains("`r`n")) {
      Warn '저장소 파일 줄바꿈이 Windows식(CRLF)이에요. 고친 것을 모두 올린(push) 뒤 Git Bash에서: git rm -rq --cached . && git reset -q --hard'
    }
  } else {
    if (Test-Path $RepoDir) {
      if (@(Get-ChildItem -LiteralPath $RepoDir -Force).Count -gt 0) {
        $bak = (Split-Path $RepoDir -Leaf) + '_zip_backup_' + (Get-Date -Format 'yyyyMMdd-HHmmss')
        try { Rename-Item -LiteralPath $RepoDir -NewName $bak -ErrorAction Stop }
        catch { throw "$RepoDir 폴더 이름을 바꾸지 못했어요(어떤 창이 그 폴더를 열고 있어요). 그 폴더를 연 탐색기·명령 창·편집기를 모두 닫고 다시 실행하세요." }
        Warn "원래 있던 $RepoDir 폴더(git 저장소가 아니거나 받다 만 것)는 $bak 로 이름을 바꿔 뒀어요. 거기서 고친 파일이 있으면 통째로 덮어쓰지 말고, 새 폴더로 옮긴 뒤 Git Bash에서 git diff로 내가 고친 줄만 바뀌었는지 확인하세요(docs\LOCAL_SETUP_WINDOWS.md 2절)."
      } else { Remove-Item -LiteralPath $RepoDir -Force }
    }
    Write-Host '  저장소는 공개라 받을 때는 보통 로그인 창이 뜨지 않아요. GitHub 로그인 창이 뜨면 저장소 주인 계정으로 로그인하세요.'
    & $git clone -c core.autocrlf=false $RepoUrl $RepoDir
    if ($LASTEXITCODE -ne 0) { throw "git clone 실패 — 인터넷 연결과 GitHub 로그인(저장소 주인 계정)을 확인하고 다시 실행하세요. 위에 'Clone succeeded, but checkout failed'가 보이면 디스크 공간·백신을 확인하세요. 받다가 끊겼으면 그냥 다시 실행하면 돼요." }
    Ok "받았어요 — $RepoDir"
  }
  if ($deskMoved) {
    try {
      $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk '윤실장 저장소.lnk'))
      $lnk.TargetPath = $RepoDir; $lnk.Save()
      Ok "바탕 화면(OneDrive)에 '윤실장 저장소' 바로가기를 만들었어요 → $RepoDir"
    } catch { Warn "바탕 화면 바로가기를 만들지 못했어요. 저장소는 $RepoDir 에 있어요" }
    $deskZip = Join-Path $desk '윤실장'
    if ((Test-Path $deskZip) -and -not (Test-Path (Join-Path $deskZip '.git'))) {
      Warn "바탕 화면의 '윤실장' 폴더는 git 저장소가 아니라 GitHub에 올릴 수 없어요. 앞으로는 $RepoDir ('윤실장 저장소' 바로가기)에서 작업하세요. 그 폴더에서 고친 파일은 2절처럼 git diff로 확인하며 옮기세요."
    } elseif ((Test-Path (Join-Path $deskZip '.git')) -and ($deskZip.TrimEnd('\') -ne $RepoDir.TrimEnd('\'))) {
      Warn "바탕 화면(OneDrive)의 '윤실장'도 git 저장소예요(예전에 받은 것). 그 폴더에서 git status와 git log --branches --not --remotes 로 올리지 않은 것이 없는지 보고, 있으면 push한 뒤 앞으로는 $RepoDir 에서 작업하세요."
    }
  }
  $results['저장소'] = $RepoDir

  # 3) Python 3.12 + 패키지
  Say "Python $PythonVer"
  $py = Find-Python
  if (-not $py) {
    $code = Winget-Install 'Python.Python.3.12' @('--scope', 'user')
    $py = Find-Python
    if (-not $py) { Write-Host "  (winget 종료 코드 $code — 사용자 전용 설치가 안 되면 일반 설치로 다시 시도)"; [void](Winget-Install 'Python.Python.3.12' @()); $py = Find-Python }
  }
  if (-not $py) { throw 'Python 3.12를 찾지 못했어요. https://www.python.org/downloads/ 에서 3.12를 설치한 뒤 다시 실행하세요.' }
  $pyDir = Split-Path $py
  Add-UserPath (Join-Path $pyDir 'Scripts')
  Add-UserPath $pyDir                                    # 맨 앞: Microsoft Store의 가짜 python보다 먼저 찾게
  $py3 = Join-Path $pyDir 'python3.exe'                  # 스크립트들이 python3라고 부른다(Windows 설치본엔 없음)
  if (-not (Test-Path $py3)) {
    try { Copy-Item $py $py3 -ErrorAction Stop; Ok 'python3 이름으로도 부를 수 있게 했어요' }
    catch { Warn "python3.exe를 만들지 못했어요($pyDir 쓰기 권한). python3 대신 python으로 실행하세요." }
  }
  $results['Python'] = (& $py -V)
  Ok "$($results['Python']) — $py"
  Set-UserVar 'PYTHONUTF8' '1'                           # 한글 파일을 UTF-8로 읽게(CI와 같음). 없으면 cp949로 읽다 깨진다
  & $py -m pip install --disable-pip-version-check --no-warn-script-location -q -r (Join-Path $RepoDir 'requirements.txt')
  if ($LASTEXITCODE -ne 0) { Warn '파이썬 패키지 설치 실패 — 인터넷 연결을 확인하고 다시 실행하세요.' }
  # 경로를 JSON(ASCII, 한글은 \uXXXX)으로 받는다: PYTHONUTF8=1인 python의 UTF-8 출력을 5.1이 cp949로 읽어 한글 폴더 이름이 깨지지 않게
  $siteJson = @(& $py -c 'import os, json, requests; print(json.dumps(dict(p=os.path.dirname(os.path.dirname(requests.__file__)))))')
  if ($LASTEXITCODE -eq 0 -and $siteJson.Count -gt 0) {
    $site = ([string]$siteJson[-1] | ConvertFrom-Json).p
    $results['파이썬 패키지'] = $site; Ok "requirements.txt 패키지 — $site"
  }

  # 4) Node.js 22 (공식 zip을 도구 폴더에. 관리자 권한 없음, CI와 같은 판)
  Say "Node.js $NodeMajor"
  $nodeDir = Join-Path $Tools 'node'
  $node = Join-Path $nodeDir 'node.exe'
  $haveNode = $false
  if (Test-Path $node) { if ([string](& $node -v) -match "^v$NodeMajor\.") { $haveNode = $true } }
  if (-not $haveNode) {
    $arch = 'x64'; if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
    $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing   # 변수에 먼저 담는다: 5.1은 JSON 배열을 한 덩어리로 넘긴다
    $rel = @($index | Where-Object { $_.version -like "v$NodeMajor.*" -and $_.files -contains "win-$arch-zip" })[0]
    if (-not $rel) { throw "nodejs.org에서 Node $NodeMajor 판을 찾지 못했어요." }
    $ver = $rel.version; $zipName = "node-$ver-win-$arch.zip"; $base = "https://nodejs.org/dist/$ver"
    $dl = Join-Path $Tools 'downloads'; New-Item -ItemType Directory -Path $dl -Force | Out-Null
    $zip = Join-Path $dl $zipName
    Write-Host "  $zipName 내려받는 중..."
    Invoke-WebRequest "$base/$zipName" -OutFile $zip -UseBasicParsing
    $sums = [string](Invoke-RestMethod "$base/SHASUMS256.txt" -UseBasicParsing)
    $want = (@($sums -split "\r?\n" | Where-Object { $_ -match ('\s' + [regex]::Escape($zipName) + '$') })[0] -split '\s+')[0]
    $got = (Get-FileHash $zip -Algorithm SHA256).Hash
    if (-not $want -or $got.ToLower() -ne $want.ToLower()) { Remove-Item $zip -Force; throw "내려받은 Node 파일의 SHA256이 공식 값과 달라요(받다가 깨졌을 수 있음). 다시 실행하세요." }
    Ok 'SHA256 공식 값과 같음'
    $unz = Join-Path $Tools "node-$ver-win-$arch"
    foreach ($d in @($nodeDir, $unz)) { if (Test-Path $d) { Remove-Item $d -Recurse -Force } }
    Add-Type -AssemblyName System.IO.Compression.FileSystem   # Expand-Archive(5.1)보다 훨씬 빠르다
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $Tools)
    Rename-Item -LiteralPath $unz -NewName 'node'
    Remove-Item $zip -Force
  }
  Add-UserPath $nodeDir
  $results['Node.js'] = "$(& $node -v) (npm $(& (Join-Path $nodeDir 'npm.cmd') -v))"
  Ok "Node $($results['Node.js']) — $nodeDir"

  # 5) Playwright + Chromium + axe-core (화면 검사용, 도구 폴더 안에만)
  Say "Playwright $PlaywrightVer · Chromium · axe-core $AxeVer"
  $pkg = Join-Path $Tools 'package.json'
  if (-not (Test-Path $pkg)) { Set-Content -Path $pkg -Value '{ "name": "yoonsiljang-tools", "private": true }' -Encoding ASCII }
  Push-Location $Tools
  & (Join-Path $nodeDir 'npm.cmd') install --no-audit --no-fund --save-exact "playwright@$PlaywrightVer" "axe-core@$AxeVer"
  $npmCode = $LASTEXITCODE
  Pop-Location
  if ($npmCode -ne 0) { throw 'npm install 실패 — 인터넷 연결을 확인하고 다시 실행하세요.' }
  Set-UserVar 'PLAYWRIGHT' (Join-Path $Tools 'node_modules\playwright')
  Set-UserVar 'AXE' (Join-Path $Tools 'node_modules\axe-core\axe.min.js')
  Set-UserVar 'PLAYWRIGHT_BROWSERS_PATH' (Join-Path $Tools 'browsers')
  Set-UserVar 'YOONSILJANG_TOOLS' $Tools
  Write-Host '  Chromium 내려받는 중(수백 MB, 몇 분 걸려요)...'
  & $node (Join-Path $Tools 'node_modules\playwright\cli.js') install chromium
  if ($LASTEXITCODE -ne 0) { throw 'Chromium 내려받기 실패 — 다시 실행하세요.' }
  $results['Playwright'] = "$PlaywrightVer — $env:PLAYWRIGHT"
  $results['Chromium'] = $env:PLAYWRIGHT_BROWSERS_PATH
  $results['axe-core'] = "$AxeVer — $env:AXE"
  Ok '설치됨'

  # 6) 검사
  Say '검사'
  Push-Location $RepoDir
  $chk = & $node -e "require(process.env.PLAYWRIGHT).chromium.launch().then(b=>b.close()).then(()=>console.log('chromium-ok'))"
  if ([string]$chk -match 'chromium-ok') { $results['검사: Chromium 실행'] = '통과'; Ok 'Chromium이 켜졌다 꺼짐' }
  else { $results['검사: Chromium 실행'] = '실패'; Warn 'Chromium을 켜지 못했어요(위 오류를 Claude에게 보여 주세요)' }
  Close-Port
  if (@(Port-Owners).Count -eq 0) {
    $srv = Start-Process -FilePath $py -ArgumentList @('-m', 'http.server', "$Port", '--bind', '127.0.0.1', '--directory', 'app') -WorkingDirectory $RepoDir -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 2
    try {
      $r = Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 10
      $results['검사: 앱 열기'] = "통과 (HTTP $($r.StatusCode))"; Ok "http://localhost:$Port 이 열림"
    } catch { $results['검사: 앱 열기'] = '실패'; Warn "앱을 열지 못했어요: $($_.Exception.Message)" }
    Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
  } else { $results['검사: 앱 열기'] = '건너뜀(포트 사용 중)' }
  if ($SkipTests) { $results['검사: 단위 테스트'] = '건너뜀(-SkipTests)' }
  elseif (-not (Test-Path $gitBash)) { $results['검사: 단위 테스트'] = '건너뜀(Git Bash 없음)'; Warn "Git Bash($gitBash)가 없어 단위 테스트를 건너뛰었어요" }
  else {
    Write-Host '  단위 테스트(node --test tests/*.test.js) 도는 중...'
    $env:Path = (Join-Path $gitRoot 'bin') + ';' + (Join-Path $gitRoot 'usr\bin') + ';' + $env:Path   # bash·git을 Git Bash 것으로(WSL bash 말고)
    $out = Join-Path $Tools 'unit-test-output.txt'; $err = Join-Path $Tools 'unit-test-errors.txt'
    $t = Start-Process -FilePath $node -ArgumentList @('--test', 'tests/*.test.js') -WorkingDirectory $RepoDir -NoNewWindow -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    $text = [IO.File]::ReadAllText($out)
    $pass = '?'; $fail = '?'
    if ($text -match '(?m)^# pass (\d+)') { $pass = $Matches[1] }
    if ($text -match '(?m)^# fail (\d+)') { $fail = $Matches[1] }
    $results['검사: 단위 테스트'] = "통과 $pass / 실패 $fail (전체 출력: $out)"
    if ($t.ExitCode -eq 0) { Ok "단위 테스트 통과 $pass" } else { Warn "단위 테스트 실패 ${fail}개 — Windows에서 처음 돌린 결과예요. $out 파일을 Claude에게 보여 주면 고칠게요." }
  }
  Pop-Location

  # 7) 실제 위치·버전 기록
  $lines = New-Object System.Collections.ArrayList
  [void]$lines.Add('# 윤실장 PC 설치 결과')
  [void]$lines.Add('')
  [void]$lines.Add("만든 때: $(Get-Date -Format 'yyyy-MM-dd HH:mm') · 만든 것: tools\windows\setup.ps1 · 설명: docs\LOCAL_SETUP_WINDOWS.md")
  [void]$lines.Add('')
  [void]$lines.Add('| 항목 | 판 · 위치 · 결과 |')
  [void]$lines.Add('|---|---|')
  foreach ($k in $results.Keys) { [void]$lines.Add("| $k | $($results[$k]) |") }
  [void]$lines.Add('')
  [void]$lines.Add('## 사용자 환경 변수 (새로 여는 창부터 적용)')
  [void]$lines.Add('')
  foreach ($v in @('PLAYWRIGHT', 'AXE', 'PLAYWRIGHT_BROWSERS_PATH', 'PYTHONUTF8', 'YOONSILJANG_TOOLS')) { [void]$lines.Add("- ``$v`` = ``$([Environment]::GetEnvironmentVariable($v, 'User'))``") }
  [void]$lines.Add("- ``Path`` 맨 앞에 추가: ``$pyDir``, ``$(Join-Path $pyDir 'Scripts')``, ``$nodeDir``")
  [void]$lines.Add('- `APP_PIN`(비밀번호 화면 번호)은 저장하지 않았어요. 화면 검사 때마다 직접 적어요.')
  if ($warnings.Count -gt 0) {
    [void]$lines.Add('')
    [void]$lines.Add('## 확인할 것')
    [void]$lines.Add('')
    foreach ($w in $warnings) { [void]$lines.Add("- $w") }
  }
  [IO.File]::WriteAllText((Join-Path $Tools 'INSTALLED.md'), ($lines -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($false)))

  Say '끝'
  Ok "설치 위치와 결과: $(Join-Path $Tools 'INSTALLED.md')"
  Write-Host "  앱 보기: $RepoDir\tools\windows\start.bat 더블클릭 → http://localhost:$Port"
  Write-Host "  앱 끄기($Port 포트 닫기): 서버 창을 닫거나 $RepoDir\tools\windows\stop.bat"
  Write-Host '  테스트·올리기: 저장소 폴더에서 Git Bash를 열고 docs\LOCAL_SETUP_WINDOWS.md 순서대로'
  if ($warnings.Count -gt 0) { Write-Host "  확인할 것이 $($warnings.Count)개 있어요(노란 줄, INSTALLED.md 끝)." -ForegroundColor Yellow }
} catch {
  Write-Host ''
  Write-Host "멈췄어요: $($_.Exception.Message)" -ForegroundColor Red
  if ($logStarted) { Write-Host "기록: $(Join-Path $Tools 'setup-log.txt') — 이 화면이나 기록 파일을 Claude에게 보여 주세요. 고친 뒤 다시 실행하면 이어서 해요." -ForegroundColor Red }
  else { Write-Host '이 화면을 Claude에게 보여 주세요(사진도 돼요). 고친 뒤 다시 실행하면 이어서 해요.' -ForegroundColor Red }
} finally {
  try { Stop-Transcript | Out-Null } catch { }
  Read-Host 'Enter를 누르면 창이 닫혀요'
}
