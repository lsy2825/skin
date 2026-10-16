# 윤실장 — 비밀번호 화면 번호 바꾸기. 같은 폴더의 pin.bat를 더블클릭하면 이 파일이 실행된다. 설명: docs/LOCAL_SETUP_WINDOWS.md 4-1절
# 하는 일: 새 번호(숫자 4개)를 화면에 보이지 않게 두 번 받는다 → app/gate.js의 HASH 한 줄을 sha256("velyb-gate:" + 번호)로,
# app/sw.js의 VER을 새 값으로(gate.js는 캐시 우선이라, 바꿔야 설치한 폰이 새 gate.js를 받는다) → GitHub main의 최신 커밋 위
# 새 브랜치 pin/날짜-시각에 커밋 → GitHub에 올리고 PR 만드는 페이지를 연다. 번호는 저장소·파일·환경 변수·채팅 어디에도 남기지 않는다(CLAUDE.md).
# 지금 작업 폴더(고친 파일·브랜치)는 건드리지 않는다: 임시 폴더(git worktree)에 두 파일만 꺼내 고치고, 올린 뒤 지운다.
# VER은 한 칸이 아니라 날짜·시각 숫자(yyMMddHH)로 올린다. 그사이 다른 PR이 VER을 한 칸 올려 먼저 합쳐지면, 두 PR이 같은 줄을
# 다른 값으로 바꾼 것이라 GitHub에 app/sw.js 충돌로 보인다(→ 이 PR을 닫고 다시 실행). 같은 값이었다면 충돌 없이 합쳐지는데
# VER이 그대로라 설치한 폰이 예전 gate.js(예전 번호)를 계속 쓴다.
# 주의: 숫자 4개짜리 번호의 해시는 gate.js를 본 누구나 몇 초 만에 거꾸로 찾을 수 있다(gate.js는 공개 파일). 화면 잠금일 뿐이다.
# 이 파일은 UTF-8(BOM 있음)으로 둔다. Windows PowerShell 5.1에서도 돌아가게 쓴다(?? · 삼항 · && 안 씀).
[CmdletBinding()]
param(
  [string]$RepoDir = (Join-Path (Join-Path $PSScriptRoot '..') '..')
)

$Prefix = 'velyb-gate:'   # app/gate.js check(): sha256("velyb-gate:" + pin) === HASH
$PinPattern = '^[0-9]{4}$' # app/gate.js press(): 숫자 4개를 누르면 바로 확인한다
$Repo = 'lsy2825/skin'
$ErrorActionPreference = 'Continue'   # git 실패는 종료 코드로 직접 본다

function Say([string]$m) { Write-Host ''; Write-Host "== $m" -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "  OK  $m" -ForegroundColor Green }
function Stop-Here([string]$m) { throw $m }
function Find-Git {
  $c = Get-Command git -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe")) { if (Test-Path $p) { return $p } }
  return $null
}
# 화면에 보이지 않게 받은 번호를 평문으로 꺼내고, 꺼낸 메모리는 바로 지운다
function Read-Pin([string]$prompt) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  if ($null -eq $s) { return '' }
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); $s.Dispose() }
}
function Get-Sha256Hex([string]$text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)) } finally { $sha.Dispose() }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}
# gate.js·sw.js에는 한글이 있다: .NET으로 UTF-8(BOM 없음) 그대로 읽고 쓴다(PowerShell 5.1의 Get-Content·>는 인코딩을 바꾼다)
$Utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Utf8([string]$p) { return [IO.File]::ReadAllText($p, $Utf8) }
function Write-Utf8([string]$p, [string]$t) { [IO.File]::WriteAllText($p, $t, $Utf8) }

$git = $null; $root = $null; $tmp = $null; $noHooks = $null; $branch = $null; $pushed = $false
$pin1 = $null; $pin2 = $null; $failed = $false
try {
  Say '저장소 확인'
  $git = Find-Git
  if (-not $git) { Stop-Here 'Git이 없어요. 먼저 tools\windows\setup.bat를 실행하세요.' }
  if (-not (Test-Path -LiteralPath $RepoDir)) { Stop-Here "저장소 폴더가 없어요: $RepoDir" }
  $root = (Resolve-Path -LiteralPath $RepoDir).Path
  if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) { Stop-Here "git으로 받은 저장소가 아니에요(압축 파일로 받은 폴더?): $root — setup.bat로 다시 받으세요." }
  foreach ($f in @('app/gate.js', 'app/sw.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $f))) { Stop-Here "윤실장 저장소가 아니에요($f 없음): $root" }
  }
  $url = [string](& $git -C $root remote get-url origin 2>$null)
  if (($LASTEXITCODE -ne 0) -or ($url -notmatch 'lsy2825/skin(\.git)?/?$')) { Stop-Here "이 폴더의 origin이 $Repo 저장소가 아니에요: $url" }
  Ok $root

  Say 'GitHub에서 최신 main 받기'
  # 받을 곳을 정확히 적고, 받은 커밋 ID를 쓴다(remote.origin.fetch 설정이나 'origin/main'이라는 다른 이름에 기대지 않는다)
  & $git -C $root fetch --quiet origin '+refs/heads/main:refs/remotes/origin/main'
  if ($LASTEXITCODE -ne 0) { Stop-Here 'main을 받지 못했어요(인터넷 연결이나 GitHub 로그인을 확인하세요).' }
  $base = [string](& $git -C $root rev-parse --verify --quiet 'refs/remotes/origin/main^{commit}')
  if (($LASTEXITCODE -ne 0) -or ($base -notmatch '^[0-9a-f]{40,64}$')) { Stop-Here 'GitHub main의 커밋을 찾지 못했어요.' }
  Ok ('최신 main ' + $base.Substring(0, 7))

  # 아직 합치지 않은 번호 바꾸기 브랜치(pin/…)가 있으면 번호를 묻기 전에 멈춘다: PR 두 개가 열려 있으면 버린 번호가 합쳐질 수 있다.
  # --prune: GitHub에서 지운 브랜치는 이 PC의 목록에서도 지운다(지운 뒤 다시 실행하면 통과)
  & $git -C $root fetch --quiet --prune origin '+refs/heads/pin/*:refs/remotes/origin/pin/*'
  if ($LASTEXITCODE -ne 0) { Stop-Here 'GitHub의 pin/ 브랜치 목록을 받지 못했어요(인터넷 연결이나 GitHub 로그인을 확인하세요).' }
  $open = @(& $git -C $root for-each-ref '--format=%(refname)' "--no-merged=$base" 'refs/remotes/origin/pin' | Where-Object { $_ } | ForEach-Object { $_ -replace '^refs/remotes/origin/', '' })
  if ($LASTEXITCODE -ne 0) { Stop-Here 'pin/ 브랜치를 확인하지 못했어요(git for-each-ref).' }
  if ($open.Count -gt 0) {
    Stop-Here ('아직 합치지 않은 번호 바꾸기 브랜치가 GitHub에 있어요: ' + ($open -join ', ') + ' — GitHub에서 그 PR을 먼저 닫고(Close pull request) 브랜치를 지운 뒤(Delete branch) 다시 실행하세요. 그 번호를 그대로 쓰려면 다시 실행하지 말고 그 PR을 합치세요. 이미 합친 PR이면(Squash·Rebase로 합친 경우) 그 브랜치만 지우세요(Delete branch).')
  }
  Ok '열려 있는 번호 바꾸기 브랜치 없음'

  # 임시 폴더: 파일을 다 풀지 않고(--no-checkout) 목록만 main으로 채운 뒤(read-tree) 두 파일만 꺼낸다.
  # 커밋 훅은 쓰지 않는다(저장소 밖의 빈 폴더를 hooksPath로): 훅이 다른 파일을 담으면(git add -A) 나머지 파일이 다 지워진 커밋이 된다
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('yoonsiljang-pin-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $noHooks = $tmp + '-nohooks'
  New-Item -ItemType Directory -Path $noHooks -Force -ErrorAction Stop | Out-Null
  $nh = 'core.hooksPath=' + $noHooks
  & $git -c $nh -C $root worktree add --quiet --no-checkout --detach $tmp $base
  if ($LASTEXITCODE -ne 0) { $tmp = $null; Stop-Here '임시 작업 폴더를 만들지 못했어요(git worktree).' }
  & $git -c $nh -C $tmp read-tree HEAD
  if ($LASTEXITCODE -ne 0) { Stop-Here '임시 작업 폴더를 준비하지 못했어요(git read-tree).' }
  & $git -c $nh -C $tmp checkout -- app/gate.js app/sw.js
  if ($LASTEXITCODE -ne 0) { Stop-Here 'app/gate.js·app/sw.js를 꺼내지 못했어요.' }
  $gatePath = Join-Path $tmp 'app/gate.js'; $swPath = Join-Path $tmp 'app/sw.js'
  $gate = Read-Utf8 $gatePath; $sw = Read-Utf8 $swPath
  $hm = [regex]::Matches($gate, 'const HASH = "([0-9a-f]{64})"')
  $vm = [regex]::Matches($sw, 'const VER = "pc-v([0-9]+)";')
  if ($hm.Count -ne 1) { Stop-Here "app/gate.js에서 HASH 줄을 하나만 찾아야 하는데 $($hm.Count)개예요 — 이 도구를 고쳐야 해요(채팅 A에게 알려 주세요)." }
  if ($vm.Count -ne 1) { Stop-Here "app/sw.js에서 VER 줄을 하나만 찾아야 하는데 $($vm.Count)개예요 — 이 도구를 고쳐야 해요(채팅 A에게 알려 주세요)." }
  $oldHash = $hm[0].Groups[1].Value
  $oldVer = [long]$vm[0].Groups[1].Value
  # 새 VER = 날짜·시각(yyMMddHH). 다른 PR이 고를 값(지금 VER에서 한 칸씩 올린 값)과 겹치지 않게, 지금 VER보다 적어도 100 크게 한다:
  # 그래야 그사이 VER을 올린 PR(100번 미만으로 올린 것)과 겹칠 때 조용히 합쳐지지 않고 충돌로 보인다. 같은 날 다시 바꾸는 등으로
  # 날짜 값이 지금 VER + 100보다 작으면 지금 VER + 100.
  $newVer = [long](Get-Date -Format 'yyMMddHH')
  if ($newVer -lt ($oldVer + 100)) { $newVer = $oldVer + 100 }

  Say '새 번호 입력(화면에 보이지 않아요)'
  Write-Host '  숫자 4개. 채팅·메모·파일 어디에도 적지 마세요.'
  $pin1 = Read-Pin '  새 번호'
  if ($pin1 -notmatch $PinPattern) { Stop-Here '숫자 4개가 아니에요. 다시 실행해 주세요.' }
  $pin2 = Read-Pin '  한 번 더'
  if ($pin1 -ne $pin2) { Stop-Here '두 번 입력한 번호가 달라요. 다시 실행해 주세요.' }
  $newHash = Get-Sha256Hex ($Prefix + $pin1)
  $pin1 = $null; $pin2 = $null
  if ($newHash -eq $oldHash) { Stop-Here '지금 번호와 같아요. 다른 번호로 다시 실행해 주세요.' }
  Ok '번호 확인(저장하지 않음)'

  Say 'app/gate.js·app/sw.js 고치기'
  Write-Utf8 $gatePath ($gate.Replace("const HASH = `"$oldHash`"", "const HASH = `"$newHash`""))
  Write-Utf8 $swPath ($sw.Replace("const VER = `"pc-v$oldVer`";", "const VER = `"pc-v$newVer`";"))
  & $git -c $nh -C $tmp add -- app/gate.js app/sw.js
  if ($LASTEXITCODE -ne 0) { Stop-Here '바꾼 두 파일을 담지 못했어요(git add).' }
  # 바뀐 것이 정확히 두 줄(각 파일 한 줄)인지 확인한다 — 아니면 올리지 않는다
  $numstat = @(& $git -c $nh -C $tmp diff --cached --numstat | Where-Object { $_ })
  $want = @("1`t1`tapp/gate.js", "1`t1`tapp/sw.js")
  if (($numstat.Count -ne 2) -or ($numstat[0] -ne $want[0]) -or ($numstat[1] -ne $want[1])) {
    Stop-Here ('바뀐 줄이 예상과 달라서 올리지 않았어요: ' + ($numstat -join ' | '))
  }
  Ok "HASH 한 줄, VER pc-v$oldVer → pc-v$newVer"

  Say '커밋하고 GitHub에 올리기'
  $branch = 'pin/' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  & $git -c $nh -C $tmp commit --quiet --no-verify -m "PIN screen: new number (only its hash is stored) + sw.js VER pc-v$oldVer -> pc-v$newVer" -m 'Made by tools/windows/pin.ps1 (user decision 2026-10-16). The number itself is not in the repository.'
  if ($LASTEXITCODE -ne 0) { Stop-Here '커밋하지 못했어요. 커밋에 남길 이름·이메일이 없으면 setup.bat를 한 번 실행하세요.' }
  # 올리기 직전에 한 번 더: 커밋의 부모가 받은 main 커밋이고, main과 다른 것이 정확히 그 두 줄인지
  $parent = [string](& $git -c $nh -C $tmp rev-parse --verify --quiet 'HEAD^')
  $after = @(& $git -c $nh -C $tmp diff --numstat $base HEAD | Where-Object { $_ })
  if (($parent -ne $base) -or ($after.Count -ne 2) -or ($after[0] -ne $want[0]) -or ($after[1] -ne $want[1])) {
    Stop-Here ('커밋이 예상과 달라서 올리지 않았어요: ' + ($after -join ' | '))
  }
  & $git -c $nh -C $tmp push --quiet --no-verify origin "HEAD:refs/heads/$branch"
  if ($LASTEXITCODE -ne 0) { Stop-Here 'GitHub에 올리지 못했어요(로그인 창이 떴다면 저장소 주인 계정으로 로그인한 뒤 다시 실행하세요).' }
  $pushed = $true
  Ok "브랜치 $branch"

  $title = '비밀번호 화면 번호 바꾸기 (' + $branch + ')'
  $body = "사용자 결정(2026-10-16)으로 비밀번호 화면 번호를 바꿨어요. tools/windows/pin.ps1이 만든 PR이에요(브랜치 $branch).`n`n" +
    "- app/gate.js: HASH 한 줄(번호 자체는 저장소에 없음)`n" +
    "- app/sw.js: VER pc-v$oldVer → pc-v$newVer (gate.js는 캐시 우선이라 바꿔야 설치한 폰이 새 파일을 받아요)`n`n" +
    "GitHub에 app/sw.js 충돌이 보이면 그사이 다른 PR이 VER을 바꾼 거예요. 충돌을 손으로 풀지 말고, 이 PR을 닫고 브랜치를 지운 뒤 pin.bat를 다시 실행하세요.`n`n" +
    "부탁 → B: 이 PR이 합쳐진 뒤 sw.js VER을 올릴 때는 main에 있는 값에서 올려 주세요(이 PR이면 pc-v$newVer 다음 번호)."
  $prUrl = "https://github.com/$Repo/compare/main...$branch" + '?expand=1&title=' + [uri]::EscapeDataString($title) + '&body=' + [uri]::EscapeDataString($body)
  Write-Host ''
  Write-Host '  PR 만드는 페이지(브라우저가 안 열리면 아래 주소를 여세요):'
  Write-Host "  $prUrl"
  if ($env:OS -eq 'Windows_NT') {
    # 이미 올린 뒤다: 브라우저가 안 열려도 실패로 끝내지 않는다
    try { Start-Process $prUrl -ErrorAction Stop }
    catch { Write-Host '  브라우저를 열지 못했어요. 위 주소를 복사해서 브라우저에 붙여 넣으세요(GitHub에는 이미 올라갔어요).' -ForegroundColor Yellow }
  }
} catch {
  $failed = $true
  Write-Host ''
  Write-Host "  !!  $($_.Exception.Message)" -ForegroundColor Red
} finally {
  $pin1 = $null; $pin2 = $null
  if ($tmp -and $git -and $root) {
    & $git -C $root worktree remove --force $tmp 2>$null
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    & $git -C $root worktree prune 2>$null
  }
  if ($noHooks -and (Test-Path -LiteralPath $noHooks)) { Remove-Item -LiteralPath $noHooks -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($failed -and $pushed) {
  Write-Host ''
  Write-Host ('GitHub에는 이미 올라갔어요: 브랜치 ' + $branch + ' — 다시 실행하지 마세요. 위 주소(없으면 GitHub 저장소 화면의 "Compare & pull request")에서 PR을 만드세요.') -ForegroundColor Yellow
  exit 1
}
if ($failed) { Write-Host ''; Write-Host '바꾸지 않았어요. 저장소와 작업 폴더는 그대로예요.'; exit 1 }
Write-Host ''
Write-Host '다음 할 일' -ForegroundColor Cyan
Write-Host '  1. 열린 페이지(안 열렸으면 위 주소)에서 "Create pull request"를 누르세요. 아래 검사가 모두 초록색이 되면 합칩니다(채팅에 "PIN PR 합쳐"라고 해도 돼요).'
Write-Host '  2. GitHub에 app/sw.js 충돌이 보이면(그사이 다른 PR이 VER을 바꿈) 이 PR을 닫고 브랜치를 지운 뒤 pin.bat를 다시 실행하세요.'
Write-Host '  3. 합치면 관리자 주소에는 다음 배포 때 새 번호가 적용돼요. 공개 주소는 공개 배포(PUBLIC_DEPLOY)가 꺼진 동안 예전 번호 그대로예요.'
Write-Host '  4. 화면 검사(APP_PIN)도 이제 새 번호로 적어요. 번호는 어디에도 저장하지 마세요.'
exit 0
