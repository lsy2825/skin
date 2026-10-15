# Windows PC에서 윤실장 작업하기 — 필요한 프로그램과 설치 위치

이 PC에서 앱을 띄워 보고, 테스트를 돌리고, 고친 것을 GitHub(원격)에 올리려면 아래 프로그램이 필요하다.
**`tools/windows/setup.bat`를 한 번 더블클릭하면 전부 받아서 설치한다**(이미 있는 것은 건너뜀, 다시 실행해도 됨).
실제로 설치된 위치·버전·검사 결과는 설치가 끝나면 **`C:\yoonsiljang-tools\INSTALLED.md`**에 적힌다.
이 문서와 설치 파일은 A(플랫폼) 담당이다. 판(version)은 GitHub 자동 검사와 같게 맞춘다(`tests/security/local_setup.test.js`가 확인).
예전 한 줄 설치(`tools/setup-windows.ps1`, `irm … | iex`, `C:\dev\skin`)는 저장소가 비공개가 되면서 더 이상 쓸 수 없어 이 설치로 바꿨다.

> 아직 Windows PC에서 직접 돌려 보지 못했다. PowerShell 7로 문법 검사(5.1에 없는 문법 검사 포함)를 했고, 검토자 4명이
> Windows PowerShell 5.1·cmd 동작을 따져 찾은 문제를 고쳤다. winget·Python 설치기 동작은 PC마다 다를 수 있다.
> 멈추거나 노란 줄(확인할 것)이 나오면 그 화면이나 `C:\yoonsiljang-tools\setup-log.txt`를 Claude에게 보여 주면 된다.

## 1. 필요한 것과 설치 위치

| 이름 | 무엇에 쓰나 | 판 | 설치 위치 | 받는 곳 |
|---|---|---|---|---|
| Git (Git Bash 포함) | 원격에 올리기(push), 테스트 일부가 쓰는 `bash` | 최신 | `C:\Program Files\Git` (Git Bash: `C:\Program Files\Git\bin\bash.exe`) | winget `Git.Git` (설치 때 Windows 확인 창 1번) |
| GitHub CLI (`gh`) | PC에서 PR 만들기(없어도 됨 — GitHub 웹에서 만들어도 된다) | 최신 | `C:\Program Files\GitHub CLI` | winget `GitHub.cli` |
| Python | 앱 띄우기, 데이터 다시 만들기, 파이썬 테스트 | 3.12 | `C:\Users\<사용자>\AppData\Local\Programs\Python\Python312` (ARM64 PC는 `Python312-arm64`) | winget `Python.Python.3.12` (사용자 전용 설치) |
| 파이썬 패키지 8개 | 수집·빌드(`requests`, `beautifulsoup4`와 딸린 것) | `requirements.txt`에 고정 | 위 Python 폴더의 `Lib\site-packages` | pip |
| Node.js | 단위 테스트, 화면 테스트 | 22 (GitHub 검사와 같음) | `C:\yoonsiljang-tools\node` | nodejs.org 공식 zip (SHA256 확인) |
| Playwright | 화면 테스트(`tests/e2e/`)가 브라우저를 움직임 | 1.56.1 | `C:\yoonsiljang-tools\node_modules\playwright` | npm |
| Chromium | Playwright가 쓰는 브라우저 | Playwright 1.56.1에 맞는 판 | `C:\yoonsiljang-tools\browsers` | Playwright가 받음 |
| axe-core | 접근성 검사(`tests/e2e/a11y.js`) | 4.10.2 | `C:\yoonsiljang-tools\node_modules\axe-core\axe.min.js` | npm |
| 저장소(코드) | 작업할 파일 전부 | GitHub 최신 | `C:\Users\<사용자>\Desktop\윤실장` (바탕 화면이 OneDrive로 옮겨진 PC는 아래 참고) | `git clone` (GitHub 로그인 창 1번) |

- `C:\yoonsiljang-tools`는 **이 계정(과 SYSTEM·관리자)만 고칠 수 있게 권한을 잠근다.** C:\ 바로 아래 새 폴더는 원래 PC의 모든
  계정이 고칠 수 있는데, 이 폴더의 `node`가 `Path` 맨 앞에 들어가기 때문이다. 이 PC의 다른 계정이 이미 그 폴더를 만들어
  두었으면 건드리지 않고 `C:\Users\<사용자>\AppData\Local\yoonsiljang-tools`를 쓴다(실제 위치는 INSTALLED.md).
- 바탕 화면이 OneDrive로 옮겨진 PC(`C:\Users\<사용자>\OneDrive\바탕 화면`)는 저장소를 OneDrive 밖인 `C:\Users\<사용자>\윤실장`에
  받고, 보이는 바탕 화면에 `윤실장 저장소` 바로가기를 만든다(OneDrive가 `.git`을 동기화하면 파일 잠금·충돌이 생긴다).

**따로 받을 필요 없는 것**
- 앱 안 라이브러리(지도 Leaflet, 아이콘 Lucide, 글꼴 Pretendard, supabase-js): 이미 `app/vendor/`에 들어 있다.
- PostgreSQL: 전체 회귀(`tests/run_regression.sh`)의 DB 시험에만 필요하다. PR을 올리면 GitHub가 자동 검사(`pr-checks`, DB를
  건드린 PR은 `db-security`)를 돌리고, 전체 회귀는 Claude(클라우드)가 돌린다. PC에는 설치하지 않는다.
- wrangler(Cloudflare 배포 도구)·Docker: 배포는 GitHub Actions가 한다. PC에서 배포하지 않는다.

**환경 변수(사용자 변수, 새로 여는 창부터 적용)**

| 이름 | 값 | 왜 |
|---|---|---|
| `PLAYWRIGHT` | `C:\yoonsiljang-tools\node_modules\playwright` | 화면 테스트가 Playwright를 여기서 찾는다 |
| `AXE` | `C:\yoonsiljang-tools\node_modules\axe-core\axe.min.js` | 접근성 검사가 axe-core를 여기서 찾는다 |
| `PLAYWRIGHT_BROWSERS_PATH` | `C:\yoonsiljang-tools\browsers` | Chromium 위치 |
| `PYTHONUTF8` | `1` | 한글 파일을 UTF-8로 읽게 한다(GitHub 검사와 같음). 없으면 Windows 기본(cp949)으로 읽다가 깨진다 |
| `YOONSILJANG_TOOLS` | `C:\yoonsiljang-tools` | 도구 폴더 위치 |
| `Path` 앞에 추가 | Python 폴더, Python `Scripts`, `C:\yoonsiljang-tools\node` | `python`·`node`를 바로 부르게 |

- 비밀번호 화면 번호(`APP_PIN`)는 **저장하지 않는다**(저장소·환경 변수 어디에도). 화면 검사 때마다 직접 적는다.
- 스크립트들이 `python3`라고 부르기 때문에 Python 폴더에 `python3.exe`(같은 파일의 복사본)를 하나 만든다.
- git 설정 `core.quotepath=false`를 켠다: `git status`·`git diff`에 한글 파일 이름이 `\354\236…` 대신 그대로 보인다.
- 저장소는 줄바꿈을 바꾸지 않고 받는다(`core.autocrlf=false`). Windows식 줄바꿈(CRLF)이 되면 `bash` 스크립트가 멈춘다.
  저장소의 `.gitattributes`도 `*.sh`는 LF, `*.bat`는 CRLF로 고정한다.

## 2. 설치하기 (처음 한 번)

1. 설치 파일 두 개(`setup.bat`, `setup.ps1`)를 **같은 폴더**에 둔다(예: 다운로드 폴더). 둘 중 하나만 있으면 시작하지 않는다.
   - git으로 받은 저장소가 이미 있으면 `윤실장\tools\windows\`에서 그대로 실행해도 된다.
   - **압축(ZIP)으로 받은 폴더라면 그 안에서 실행하지 않는다.** `tools\windows`의 두 파일을 함께 다운로드 폴더로 복사해서 실행한다
     (그 폴더 이름을 바꾸고 새로 받아야 해서).
2. `setup.bat`를 더블클릭한다. "Windows의 PC 보호"나 "보안 경고" 창이 뜨면 `추가 정보 → 실행` 또는 `실행`.
3. 중간에 나오는 것
   - Git·GitHub CLI를 설치할 때 Windows 확인 창(관리자) → `예`
   - 커밋에 남길 이름·이메일 질문(처음 한 번) → GitHub 아이디·이메일
   - GitHub 로그인 창(비공개 저장소라서) → 저장소 주인 계정으로 로그인
   - 8766 포트를 예전에 띄운 파이썬 서버가 잡고 있으면 그 서버를 끈다
4. 끝나면 `C:\yoonsiljang-tools\INSTALLED.md`를 연다. 실제 위치·버전과 검사 결과(Chromium 실행, 앱 열기, 단위 테스트)가 있다.

- `Desktop\윤실장`에 이미 압축(ZIP)으로 받은 폴더가 있으면 지우지 않고 `윤실장_zip_backup_날짜`로 이름을 바꾼 뒤 새로 받는다.
  그 폴더에서 고친 파일이 있으면 **통째로 덮어쓰지 않는다.** ZIP은 받은 날의 사본이라, 덮어쓰면 그 뒤 다른 채팅이 고친 내용이
  사라진다. 새 폴더로 옮긴 뒤 Git Bash에서 `git diff <파일>`로 **내가 고친 줄만** 바뀌었는지 본다. 다른 줄도 바뀌었으면
  `git checkout -- <파일>`로 되돌리고, 고친 내용을 Claude에게 보여 주고 새 파일에 다시 넣는다.
- 받다가 끊겼으면(창을 닫음, 인터넷 끊김) 그냥 다시 실행한다. 받다 만 폴더는 `_zip_backup_날짜`로 비켜 두고 새로 받는다.
- 다른 위치를 쓰려면 PowerShell에서: `powershell -ExecutionPolicy Bypass -File setup.ps1 -RepoDir D:\work\윤실장 -Tools D:\yoonsiljang-tools`
- 단위 테스트를 건너뛰려면 `-SkipTests`를 붙인다.

## 3. 매일 쓰는 법

| 하고 싶은 것 | 방법 |
|---|---|
| 앱 보기 | `tools\windows\start.bat` 더블클릭 → 브라우저에 `http://localhost:8766` (이 PC에서만 열림) |
| 앱 끄기(8766 포트 닫기) | 서버 창(`yoonsiljang app`)을 닫거나 `tools\windows\stop.bat` 더블클릭 |
| 테스트·명령 | 저장소 폴더에서 **Git Bash**를 연다(탐색기 빈 곳 오른쪽 클릭 → `Open Git Bash here`, Windows 11은 `더 많은 옵션 표시` 안). `CLAUDE.md`의 "자주 쓰는 명령"을 그대로 쓴다 |

Git Bash에서 자주 쓰는 명령:

    node --test tests/*.test.js                       # 단위 테스트
    APP_PIN=<번호> node tests/e2e/clickable.js         # 화면 검사(먼저 start.bat로 앱을 띄운 상태, <번호>는 매번 직접)
    python tests/security/scan_secrets.py             # 비밀 정보 검사(git add 한 뒤, commit 전에)
    python build2/weekly.py --skip-scrape             # 이미 모은 자료로 앱 데이터 다시 만들기(확인용 — 아래 주의)

- **`weekly.py`로 다시 만든 데이터 파일은 올리지 않는다.** 이 명령은 가격 공장이 매일 만드는 파일
  (`app/data.json`, `app/home.json`, `app/data-meta.json`, `data2/report.md`, `data2/issues.csv`, `data2/review.csv`, `data2/history/`)을
  이 PC에서 다시 쓴다(`build2/weekly.py`·`clean.py`·`appdata.py`·`groups.py`). 이 파일들은 공장만 만든다(`CLAUDE.md` 분업).
  확인이 끝나면 올리기 전에 되돌린다(`git pull`이 "would be overwritten"이라며 멈출 때도 이것을 먼저):

      git restore app/data.json app/home.json app/data-meta.json data2/report.md data2/issues.csv data2/review.csv data2/history

- PowerShell에서 화면 검사를 할 때는 `$env:APP_PIN = "<번호>"; node tests/e2e/clickable.js` 처럼 쓴다(창을 닫으면 사라짐).
- 단위 테스트 일부(가격 공장 스크립트를 `bash`로 돌리는 시험)는 Git Bash에서 돌려야 한다. PowerShell·명령 프롬프트에서
  돌리면 `bash`를 못 찾거나 WSL의 `bash`가 잡혀 실패할 수 있다(추측: Windows에서 아직 돌려 보지 않음).

## 4. 원격(GitHub)에 올리는 법

**main에 바로 올리지 않는다.** `app/`·`build2/`·`tests/`·`knowledge/`·`tools/factory.sh`·`cf/admin/`이 main에 들어가면
가격 공장(`weekly.yml`)이 돌아 Cloudflare에 다시 배포한다. 브랜치에 올리고 PR로 합친다.

    git switch main && git pull                       # 1. 시작 전에 최신으로(다른 채팅의 작업과 부딪히지 않게)
    git switch -c 작업이름                             # 2. 새 브랜치(예: local/1015-cart-fix)
    # ... 고치고 테스트 ...
    git status                                        # 3. 바뀐 파일 확인 — 내가 고친 것만 있는지(공장 데이터 파일은 위 3절대로 되돌림)
    git diff                                          #    바뀐 줄 확인
    git add <고친 파일들>                               # 4. 올릴 파일만 담기
    python tests/security/scan_secrets.py             # 5. 비밀 정보 검사(담은 파일까지 본다)
    git commit -m "무엇을 고쳤는지"                     # 6. 저장
    git push -u origin 작업이름                        # 7. 원격에 올리기

- 비밀 정보 검사가 무언가를 찾으면: 그 파일을 고치고 **다시 `git add`** 한 뒤 검사를 다시 돌린다(커밋은 `git add` 해 둔 사본으로 된다).
- 8. GitHub 저장소 페이지에 뜨는 `Compare & pull request`로 PR을 만든다(또는 Git Bash에서 `gh pr create`, 처음 한 번 `gh auth login`)
  → PR 화면 아래 **검사가 모두 끝나고 모두 초록색**(`All checks have passed`)이 되면 합친다. `pr-checks`는 모든 PR에 돌고,
  `build2/`·`data2/`·`knowledge/`·`scrape/`를 바꾸면 `pr-build`(몇 분 걸림), DB 파일을 바꾸면 `db-security`도 함께 돈다.
  하나라도 빨간색이거나 아직 노란 점(도는 중)이면 합치지 않는다.
- 가격 공장이 도는 06:00(한국 시간) 앞뒤 30분에는 합치지 않는다.

## 5. 지우는 법

1. `C:\yoonsiljang-tools` 폴더를 지운다(Node·Playwright·Chromium·axe-core가 다 여기 있다).
2. 설정 → 시스템 → 정보 → 고급 시스템 설정 → 환경 변수에서 `PLAYWRIGHT`, `AXE`, `PLAYWRIGHT_BROWSERS_PATH`, `PYTHONUTF8`,
   `YOONSILJANG_TOOLS`를 지우고, `Path`에서 위 1절의 세 폴더를 뺀다.
3. Python 3.12, Git, GitHub CLI는 설정 → 앱에서 제거한다(다른 데서 안 쓰면). Git을 계속 쓰면 `git config --global --unset core.quotepath`로
   한글 이름 표시 설정만 되돌릴 수 있다.
