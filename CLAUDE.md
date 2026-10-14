# 윤실장 (피부과 가격비교) — Claude 작업 안내

공장형 피부과 브랜드(블리비·쁨·톡스앤필·리엔장)의 지점별 시술 가격을 모아 비교하는 PWA.
프레임워크·번들러 없음(순수 JS). GitHub Pages로 `app/`을 배포.

## 대화 규칙
- 한국어로 답한다.
- 모르면 "모른다", 추측이면 "추측"이라고 밝히고, 근거(파일·줄·실행 결과)를 함께 제시한다.
- 목적은 공장형 피부과 전체의 가격 비교다. 특정 브랜드를 중심에 두지 않는다.
- 비밀번호 화면 번호는 저장소 어디에도 적지 않는다. 테스트는 `APP_PIN` 환경 변수로만.

## 폴더 구조
- `app/` — 배포되는 앱
  - `index.html` — 스크립트를 순서대로 읽음(gate → vendor → config/auth → icons/jomi/terms → domain/* → app.js)
  - `app.js` — 화면·라우터·상태 전부(약 4,800줄, 분리 작업 중: `docs/APP_JS_SPLIT_PLAN.md`)
  - `domain/*.js` — 화면 없는 로직(가격 계산·검색·분류·통계·동기화). 단위 테스트 있음
  - `commerce.js` + 일부 domain — 유료 화면, 처음 쓸 때 늦게 불러옴(`COMMERCE_JS`)
  - `gate.js` — 비밀번호 화면(화면 잠금일 뿐, 데이터는 공개 주소에 있음)
  - `data.json` / `data-meta.json` — 주간 빌드 산출물. 직접 고치지 않는다
- `scrape/` — 브랜드별 수집기 → `build2/` 정리·묶기·앱 데이터 생성 → `app/data.json`
- `tests/` — 단위(`*.test.js`), 화면(`e2e/`), 보안(`security/`, `db/`), 성능(`perf/`)
- `server/`, `supabase/` — 결제·로그인용(현재 꺼져 있음, `app/config.js`가 비면 비활성)
- `docs/` — 설계·감사 문서. 기준 문서: `ARCHITECTURE.md`, `IMPLEMENTATION_STATUS.md`, `TREATMENT_TAXONOMY.md`
- `NOTES.md` — 지난 작업 메모(수집기별 세부, 사용자 결정 이력)

## 자주 쓰는 명령
    node --test tests/*.test.js                      # 단위 테스트 (빠름, 수정마다)
    python -m http.server 8766 --directory app       # 로컬 실행
    APP_PIN=<번호> node tests/e2e/<이름>.js          # 화면 검사 (서버 띄운 상태, Playwright 필요)
    APP_PIN=<번호> bash tests/run_regression.sh      # 전체 회귀 (PostgreSQL 필요)
    python build2/weekly.py --skip-scrape            # 이미 모은 자료로 앱 데이터 다시 만들기
    python tests/security/scan_secrets.py            # 비밀 정보 검사

## 작업 원칙
- 한 번에 하나만 바꾼다. 바꾼 뒤 관련 단위·e2e 테스트를 돌리고 결과를 보고한다.
- 화면 없는 계산은 `app.js`가 아니라 `app/domain/`에 두고 단위 테스트를 붙인다.
- 수집 데이터에서 온 문자열은 `h()`로 텍스트 노드로 넣는다(`html:` 속성 금지 — XSS). 링크는 `safeUrl` 통과분만.
- `app/`이나 `build2/`를 push하면 Pages가 다시 배포된다. push 전에 사용자에게 확인한다.
- 문서는 새로 만들기보다 기존 기준 문서를 고친다.
