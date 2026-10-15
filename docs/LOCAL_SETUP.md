# 내 컴퓨터(Windows)에서 윤실장 돌리기

이 문서는 **무엇을 받는지, 어디에 깔리는지, 어떻게 켜는지**를 정리했어요.
예시 폴더는 `C:\Users\사용자\Desktop\윤실장\skin`(바탕화면 윤실장 폴더에 받은 경우)이에요.

## 1. 한 번만: 필요한 것 받기

skin 폴더에서 주소창에 `powershell`을 쓰고 엔터를 누른 뒤, 아래 한 줄을 붙여 넣으세요.

    powershell -ExecutionPolicy Bypass -File tools\setup-windows.ps1

- 이미 깔린 것은 건너뛰어요. 여러 번 실행해도 괜찮아요.
- 이 스크립트는 skin 폴더를 GitHub의 최신 내용으로 맞춰요(`git pull`). GitHub 로그인 창이 뜨면 브라우저로 로그인하세요. 맞추지 못해도(로그인 안 함, 내 컴퓨터에서 고친 파일이 있음) 노란 글로 알려 주고 지금 있는 파일로 계속해요.
- 중간에 Windows가 설치 허락을 물으면 '예'를 누르세요.
- 화면 검사 도구(Playwright)를 받을지 물으면, 앱만 볼 거면 엔터(받지 않음)를 누르면 돼요.
- 안내 글은 영어로 나와요(Windows PowerShell에서 한글이 깨지는 걸 피하려고).
- 끝나면 **실제로 깔린 위치**(Git·Python·파이썬 라이브러리·Node.js·GitHub CLI·Playwright)가 나와요. 아래 표와 다르면 그 화면이 맞아요.
- 마지막에 단위 테스트가 1분쯤 돌아요. **몇 개가 실패로 나와도 설치는 끝난 거예요** — Windows의 줄바꿈 방식 때문에 실패하는 테스트가 있고, 앱 켜기와는 관계없어요.

## 2. 무엇이 어디에 깔리나요

| 무엇 | 왜 필요해요 | 어디에 깔려요(보통) |
|---|---|---|
| Git | 저장소 받기·올리기 | `C:\Program Files\Git\` |
| Python 3.12 | 앱 띄우기(작은 웹 서버), 가격 데이터 만들기 | `C:\Users\사용자\AppData\Local\Programs\Python\Python312\` 또는 `C:\Program Files\Python312\` |
| 파이썬 라이브러리 `requests`, `beautifulsoup4` 외 6개(`requirements.txt`, 판 번호 고정) | 가격 수집(scrape)·파이썬 테스트 | 위 Python 폴더 안 `Lib\site-packages\` (사용자 폴더 쪽에 깔릴 수도 있어요: `C:\Users\사용자\AppData\Roaming\Python\Python312\site-packages\`) |
| 파이썬 라이브러리 내려받기 임시 저장 | 다시 받을 때 빠르게 | `C:\Users\사용자\AppData\Local\pip\Cache\` |
| Node.js(LTS) | 단위 테스트(`node --test`), 점검 도구 | `C:\Program Files\nodejs\` |
| Node 내려받기 임시 저장(npm 캐시, Playwright를 고를 때만) | 다시 받을 때 빠르게 | `C:\Users\사용자\AppData\Local\npm-cache\` |
| GitHub CLI(`gh`) | GitHub 로그인·올리기 | `C:\Program Files\GitHub CLI\` |
| Playwright 1.56.1 (고를 때만) | 화면 검사(`tests\e2e\`) | `C:\Users\사용자\AppData\Local\yoonsiljang\e2e\node_modules\playwright\` |
| Playwright용 크롬(Chromium, 고를 때만) | 화면 검사 | `C:\Users\사용자\AppData\Local\ms-playwright\` |
| 환경 변수 `PYTHONUTF8=1` | 한글 파일을 깨지지 않게 | 사용자 환경 변수(설정 → 시스템 → 정보 → 고급 시스템 설정 → 환경 변수) |
| 환경 변수 `PLAYWRIGHT` (고를 때만) | 화면 검사가 위 Playwright를 찾게 | 사용자 환경 변수 |

**따로 받을 필요 없는 것**: 앱 안에서 쓰는 지도(Leaflet)·글꼴(Pretendard)은 이미 저장소의 `app\vendor\`에, 아이콘(lucide)은 `app\icons.js`에 들어 있어요.
배포 도구(wrangler)는 컴퓨터에서 앱을 보는 데 필요 없어서 받지 않아요(배포는 GitHub 쪽 공장이 해요).

## 3. 앱 켜기

skin 폴더의 `tools\run-app-windows.bat`을 **두 번 클릭**하세요.

- 검은 창이 뜨고, 잠시 뒤 인터넷 창에 앱(`http://localhost:8766`)이 열려요.
- 비밀번호 화면에서 아시는 번호를 넣으세요.
- 끌 때는 검은 창을 닫으면 돼요.
- 이 컴퓨터에서만 열려요(같은 와이파이의 다른 기기에서는 안 열려요).
- **검은 창 안을 마우스로 누르지 마세요.** 누르면 Windows가 글자 고르기 상태로 바꿔 앱이 멈춘 것처럼 보여요. 그랬다면 그 창에서 `Esc`를 누르면 다시 움직여요.

## 4. 가격 데이터를 새 규칙으로 다시 만들기 (필요할 때만)

skin 폴더에서 주소창에 `cmd`를 쓰고 엔터를 누른 뒤 붙여 넣으세요.

    py -3.12 build2\weekly.py --skip-scrape

- 이미 모아 둔 자료로 `app\data.json` 등을 다시 만들어요. 인터넷은 쓰지 않고, 컴퓨터에 따라 5~10분 걸려요.
- 이렇게 만든 파일은 **GitHub에 올리지 마세요**. 매일 도는 공장이 만들어요.
  올리기 전이나 1절 설치 스크립트를 다시 돌리기 전에, 만든 파일만 되돌리세요(skin 폴더의 cmd 창에서):

      git checkout -- app/data.json app/home.json app/data-meta.json data2

  빌드가 새로 만든 파일(`data2\history\…` 등)은 `git clean -f data2`로 지워요.
  `git status`에 이 목록 밖의 파일(예: `build2\…`)이 보이면 직접 고친 파일일 수 있어요 — 되돌리지 말고 Claude에게 물어보세요.

## 4-1. 화면 검사 돌리기 (Playwright를 받았을 때만)

3절로 앱을 켜 둔 채, skin 폴더에서 새 cmd 창을 열고:

    set APP_PIN=비밀번호화면번호
    node tests\e2e\clickable.js

- `비밀번호화면번호` 자리에 아시는 번호를 넣으세요. **번호를 파일이나 GitHub 어디에도 적지 마세요**(이 창에만 잠깐 있어요).
- 다른 검사는 `tests\e2e\` 안의 파일 이름으로 바꿔 돌리면 돼요.

## 5. 지우고 싶을 때

- Git·Python·Node.js·GitHub CLI: 설정 → 앱 → 설치된 앱에서 제거(Python은 'Python Launcher'도 따로 있어요).
- 내려받기 임시 저장: `C:\Users\사용자\AppData\Local\pip\Cache\`, `C:\Users\사용자\AppData\Local\npm-cache\` 폴더를 지워도 돼요. `C:\Users\사용자\AppData\Roaming\Python\Python312\`가 있으면 그것도요.
- 환경 변수 `PYTHONUTF8`도 지우세요(위 표의 환경 변수 메뉴).
- Playwright와 크롬: `C:\Users\사용자\AppData\Local\yoonsiljang\`와 `C:\Users\사용자\AppData\Local\ms-playwright\` 폴더를 지우고, 환경 변수 `PLAYWRIGHT`를 지우세요.
- 저장소: `C:\Users\사용자\Desktop\윤실장\skin` 폴더를 지우면 돼요(올리지 않은 작업이 있으면 같이 사라져요).
