# 윤실장 (피부과 가격비교) — Claude 작업 안내

공장형 피부과 브랜드(블리비·쁨·톡스앤필·리엔장)의 지점별 시술 가격을 모아 비교하는 PWA.
프레임워크·번들러 없음(순수 JS). `app/`은 빌드마다 관리자 Worker `yoonsiljang-admin`(`cf/admin/wrangler.jsonc`, Cloudflare Access 뒤)에
배포된다. 공개 Worker `yoonsiljang`(`wrangler.jsonc`, https://yoonsiljang.lsy2825.workers.dev)은 2026-10-15 판으로 고정(공개 배포 멈춤 — 저장소 변수
`PUBLIC_DEPLOY`=`on`일 때만 배포). GitHub 저장소는 2026-10-15 비공개 전환, GitHub Pages 없음. **코드·가격 공장은 비공개 GitHub에 그대로 둔다**
(2026-10-15 사용자 결정: GitHub 삭제 안 함, Cloudflare 이사는 보류 — `docs/CLOUDFLARE_MIGRATION.md`). 가격 공장 한 번 =
`tools/factory.sh`(`weekly.yml`이 돌림. 보류 중인 Cloudflare 상자 `cf/factory`도 같은 스크립트). 공장 순서를 바꿀 때는 이 스크립트만 고치고
`tests/factory_worker.test.js`를 돌린다.

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
  - `data.json` / `data-meta.json` / `home.json` — 주간 빌드 산출물. 직접 고치지 않는다(`home.json`은 첫 방문에 먼저 읽는 홈 요약, `build2/homedata.py`)
- `scrape/` — 브랜드별 수집기 → `build2/` 정리·묶기·앱 데이터 생성 → `app/data.json`
- `tests/` — 단위(`*.test.js`), 화면(`e2e/`), 보안(`security/`, `db/`), 성능(`perf/`)
- `server/`, `supabase/` — 결제·로그인용(현재 꺼져 있음, `app/config.js`가 비면 비활성)
- `docs/` — 설계·감사 문서. 기준 문서: `ARCHITECTURE.md`, `IMPLEMENTATION_STATUS.md`, `TREATMENT_TAXONOMY.md`
- `NOTES.md` — 지난 작업 메모(수집기별 세부, 사용자 결정 이력)

## 자주 쓰는 명령
    node --test tests/*.test.js                      # 단위 테스트 (빠름, 수정마다)
    bash .github/scripts/pr_checks.sh                # PR 자동 빠른 검사와 같은 것 (약 1분, 브라우저·PIN·DB 없이)
    python -m http.server 8766 --directory app       # 로컬 실행
    APP_PIN=<번호> node tests/e2e/<이름>.js          # 화면 검사 (서버 띄운 상태, Playwright 필요)
    APP_PIN=<번호> bash tests/run_regression.sh      # 전체 회귀 (PostgreSQL 필요)
    python build2/weekly.py --skip-scrape            # 이미 모은 자료로 앱 데이터 다시 만들기
    python tests/security/scan_secrets.py            # 비밀 정보 검사
Windows PC: `tools\windows\setup.bat` 한 번(Git·Python·Node·Playwright 설치, 위치는 `C:\yoonsiljang-tools\INSTALLED.md`), 앱 보기·끄기는
`start.bat`·`stop.bat`, 명령은 Git Bash에서 — `docs/LOCAL_SETUP_WINDOWS.md`.

## 작업 원칙
- 한 번에 하나만 바꾼다. 바꾼 뒤 관련 단위·e2e 테스트를 돌리고 결과를 보고한다.
- 화면 없는 계산은 `app.js`가 아니라 `app/domain/`에 두고 단위 테스트를 붙인다.
- 수집 데이터에서 온 문자열은 `h()`로 텍스트 노드로 넣는다(`html:` 속성 금지 — XSS). 링크는 `safeUrl` 통과분만.
- 누름이 사라지지 않게(2026-10-14 사고): 화면 다시 그리기는 `render()`만 쓴다 — 손가락이 눌린 동안엔 클릭이 끝날 때까지
  미뤄 준다. `change`·`blur`·`focusout`에서 `#main`을 직접 `replaceChildren`/`innerHTML`로 갈지 않는다. 필터를 바꾸는
  `go()`류는 그려질 때의 `params`가 아니라 지금 주소(`location.hash`)에 덧붙인다. 화면·입력칸을 바꾸면
  `tests/e2e/clickable.js`(회귀에 포함)를 돌린다.
- `app/`·`build2/`·`tests/`·`knowledge/`·`tools/factory.sh`·`cf/admin/`(그리고 `weekly.yml` 자체)이 main에 합쳐지면 `weekly.yml`이
  `tools/factory.sh`를 돌리고, Cloudflare 토큰을 가진 별도 deploy job(공장 job에는 토큰 없음)이 관리자 주소 `yoonsiljang-admin`
  (Cloudflare Access 로그인)을 다시 배포한다. **공개 주소 `yoonsiljang` 배포는
  2026-10-15 사용자 결정으로 멈춤** — GitHub 저장소 변수 `PUBLIC_DEPLOY`가 정확히 `on`일 때만 배포되고, 지금 공개 주소는 마지막 판을
  그대로 보여 준다. 공개 배포가 멈춘 동안 관리자 배포 실패는 공장 실행 실패(텔레그램 알림), 공개 배포를 켜면 경고만. Access 설정 전에는
  관리자 주소도 모두 403이라 새 판은 로컬(`python -m http.server 8766 --directory app`)에서만 보인다. 다시 켜려면 변수를 `on`으로 바꾼 뒤
  weekly-prices를 Run workflow(skip_scrape)로 한 번 돌린다. 2026-10-15 이전에 시작된 weekly-prices 실행은 Re-run하지 않는다(옛 factory.sh가
  공개 주소에 배포한다). main에는 직접 push하지 않고 PR로만 합친다(아래 '분업').
- 규격 이름이 깨지지 않게(2026-10-14 사고): 수집기는 상품명을 사이트 그대로 저장하고, 칸·묶음 제목을 앞에 붙이는 일은
  `build2/clean.py`(`title_words`)만 한다. 비교 규격 이름 규칙은 `build2/labels.py`(빌드 가드) — 수집기·정리·분류 규칙을
  바꾸면 `python3 tests/labels_test.py`를 돌린다.
- 죠미 대화가 말을 못 알아듣지 않게(2026-10-15 사고): 이해 규칙은 `app/domain/jomichat.js` 하나. 시술·가격·도움말·고민 규칙이나
  묶음 이름을 바꾸면 `node tools/jomi_chat_eval.js`로 예전·지금 점수를 보고 `tests/jomichat.test.js`(기준 밑이면 실패)를 돌린다.
  대화에는 병원·지점 이름을 넣지 않고, 고민 답에는 가격을 넣지 않는다.
- 문서는 새로 만들기보다 기존 기준 문서를 고친다.

## 분업 (윤실장 6.0, 2026-10-15~)
세 채팅이 동시에 일하고, 서로 다른 파일만 고친다. 기준 문서는 **개발 지시서**다
(https://claude.ai/code/artifact/d3a54da8-22f2-4f5c-aa90-ff3e13f6e82d).
참고 문서는 [6.0 보고서](https://claude.ai/code/artifact/0e9dbaac-2295-4faf-9bc0-3820b780f2a0),
[개선 보고서](https://claude.ai/code/artifact/1f61a769-e8f3-48dd-b34c-84a3ceb57390),
[검수 보고서](https://claude.ai/code/artifact/cfb9f199-05fb-4b12-bbd9-4bbeebdcf390)다.
6.0 보고서와 지시서가 다르면 지시서를 따른다(코드·공장은 비공개 GitHub, 앱만 Cloudflare 무료).

| 채팅 | 맡는 일 | 브랜치 |
|---|---|---|
| **A 플랫폼·서버·보안** | 배포·가격 공장, 보안 헤더·Access, 서버 쪽 크레딧 제거, 푸시·익명 집계 Worker, 모니터링, 사고 대응 | `platform/<일>` |
| **B 앱 화면** | 앱 쪽 크레딧 제거, 개선 1~2단계, 디자인·이탈 대책, 푸시 구독 화면, 집계 호출, (출시 때) 비밀번호·광고 칸 | `app/<일>` |
| **C 데이터·콘텐츠** | 규격 이름·옵션 정리, 부가세·약관 조사, 심평원 자료, 시술 설명, 처리방침·약관 초안 | `data/<일>` |

**파일 주인표.** 한 파일의 주인은 한 채팅뿐이다. 주인이 아니면 읽기만 하고, 고칠 일은 '부탁 메모'로 넘긴다.
| 주인 | 경로 |
|---|---|
| A | `.github/`, `tools/factory.sh`, `cf/`(새 Worker 포함), `wrangler.jsonc`, `server/`, `supabase/`, `tests/db/`, `tests/security/`, `tests/factory_worker.test.js`, `app/_headers`, `app/screens/ops.js`, `tests/run_regression.sh`, `README.md`, `CLAUDE.md`, 운영·보안·이사·사고 문서(`docs/CLOUDFLARE_MIGRATION.md`, `docs/SECURITY_*`, `docs/INCIDENT_RESPONSE_PLAN.md`, `docs/ARCHITECTURE.md`), `docs/VERIFIED_FEATURE_INVENTORY.md`(사용자 결정 2026-10-15), 결제·크레딧 전용 문서, Windows PC 준비(`tools/windows/`, `docs/LOCAL_SETUP_WINDOWS.md`, `.gitattributes`) |
| B | 위에 없는 `app/` 전부(`app.js`, `index.html`·CSP, `config.js`, `sw.js`, `styles.css`, `commerce.js`, `domain/`, `screens/`(ops 제외), `state/`, `workers/`, `data/`, `icons*`, `assets/`, `vendor/`), `tools/check_csp.js`, `tests/e2e/`, `tests/perf/`, `app/domain`을 시험하는 `tests/*.test.js`, `brand/`, `tools/jomi_chat_eval.js`, 화면·디자인 문서(`APP_JS_SPLIT_PLAN.md`, `DESIGN_SYSTEM.md`, `UX_*`, `JOMI_*`, `PWA_IMPLEMENTATION.md`), `tests/fixtures/jomi_chat_eval.json`, `tests/fixtures/jomi_chat_holdout.json` |
| C | `scrape/`, `build2/`, `data2/`, `knowledge/`, `requirements.txt`, 데이터 시험(`tests/*_test.py`, `build2`를 시험하는 `*.test.js`), `tools/audit_data.js`, `tools/review_queue.js`, 데이터·법률 문서(`DATA_*`, `TREATMENT_TAXONOMY.md`, `LEGAL_REVIEW_CHECKLIST.md`, `RELEASE_DECISION.md`, `docs/legal/`) |
| 공동 | `NOTES.md`(자기 날짜·채팅 제목 아래 끝에 덧붙이기만), `docs/REMEDIATION_MATRIX.md`(자기 담당 행만), `docs/IMPLEMENTATION_STATUS.md`(채팅마다 자기 절만 덧붙이기) |

`app/data.json`·`home.json`·`data-meta.json`·`review.json`은 가격 공장만 만들고, 아무 채팅도 손으로 고치지 않는다.
`CLAUDE.md`의 다른 절에 B·C가 덧붙일 줄은 부탁 메모로 A에게 넘긴다. 어느 쪽 파일인지 애매하면 고치기 전에 사용자에게 묻는다.

**공통 규칙 9개**
1. 자기 파일만 고친다. 주인표에 없는 파일이면 멈추고 사용자에게 묻는다.
2. 자기 브랜치에서만 일한다. 한 브랜치에는 한 가지 일만 한다. main에 직접 push하지 않는다.
3. 합치는 순서: 최신 main 위로 rebase → 관련 시험 통과 → PR(바뀐 것·시험 결과) → PR 화면의 자동 검사가 초록 → **사용자가 승인해야 합침**.
   자동 검사: 모든 PR에 `pr-checks`(약 1분, 공장의 배포 전 검사 + 회귀의 빠른 항목 + 문법 검사), `build2/`·`data2/`·`knowledge/`·`scrape/`를
   바꾸면 `pr-build`(공장과 같은 빌드), DB 파일을 바꾸면 `db-security`. 빨간 PR은 승인이 와도 합치지 않고 먼저 알린다.
   초록은 PR을 올린 때의 main 기준이라, 그 사이 다른 PR이 많이 합쳐졌으면 rebase·push해서 다시 돌린다(합친 뒤에도 공장 검사가 배포를 한 번 더 막는다).
   화면(e2e)·백업 복구까지 보는 전체 회귀는 여러 PR을 합친 뒤 묶어서 돌린다.
4. 가격 공장이 도는 동안(매일 06:00 KST 전후 30분)에는 합치지 않는다.
5. 다른 채팅에 부탁할 일은 PR 설명 맨 아래 "부탁 → B: …" 식으로 적는다. 다른 채팅의 파일을 대신 고치지 않는다.
6. 약속(아래)을 바꾸려면 먼저 지시서를 고치고 사용자 승인을 받는다. 필드는 더하기만 하고, 빼는 건 상대가 안 쓴다고 확인한 뒤에만 한다.
7. 끝난 일은 6.0 보고서·개선 보고서의 항목 번호로 PR에 적고, `docs/REMEDIATION_MATRIX.md`는 자기 행만 고친다.
8. 비밀값은 저장소에 두지 않는다. 배포 토큰·VAPID 비밀키·비밀번호 화면 번호는 Cloudflare·GitHub 비밀값에만 둔다. 합치기 전에 `python3 tests/security/scan_secrets.py`를 돌린다.
9. 데이터를 손으로 고치지 않는다. 가격·이름이 이상하면 C가 수집기나 정리 규칙을 고치고, 공장이 다시 만든다.

**채팅 사이 약속 6개 (요약, 자세한 형식은 지시서)**
1. 푸시 알림(A 서버 ↔ B 화면): `cf/alerts` Worker + D1. `POST /v1/push/subscribe {subscription, rules}→{id}`, `PUT /v1/push/rules/{id}`, `DELETE /v1/push/subscribe/{id}`.
   `rules`는 20개 이하로 `{kind: target|watch|newmatch|expiring, key, max?, region?}` 형식이다. 공장 배포 뒤 08~21시에 한 사람에게 주 1회 묶어서 보낸다.
   푸시 내용은 비우고, 광고 푸시는 없다. B의 `config.js`에는 `alertsApi`·`pushPublicKey`를 넣는다.
2. 익명 집계(A 서버, B 호출, C 처리방침): `cf/metrics` Worker. `POST /v1/m {"s":"단계"}` 형식이고 단계는 `open, first_price, compare_open,
   keep_cart, keep_fav, keep_alert, cart_open, return_7d` 8개만 받는다. 날짜·단계별 횟수만 저장하고 IP·기기·쿠키는 저장하지 않는다.
   `GET /v1/m/daily`는 Access 뒤에 둔다. `config.js`의 `metrics`는 기본으로 꺼 두고, 처리방침과 사용자 승인 뒤에 켠다.
3. 가격 공장 ↔ 데이터 빌드(A ↔ C): `tools/factory.sh`가 `build2/weekly.py`를 부르는 방법, 종료 코드, 결과 파일 위치는 그대로 둔다.
   새 파이썬 패키지는 `requirements.txt`에 버전을 고정한다.
4. 데이터 형식(C → B, A): `data.json`·`home.json`·`data-meta.json`에는 칸을 더하기만 한다(PR에 예시 한 줄과 B에게 부탁 메모).
   `data-meta.json`의 `changes`는 A의 알림 Worker도 읽는다.
5. 보안 헤더(A ↔ B): CSP와 `tools/check_csp.js`는 B가 맡는다. A는 `app/_headers`에 `frame-ancestors`, HSTS, `X-Content-Type-Options`,
   `Referrer-Policy`만 넣는다.
6. 문구(C → B): 처리방침·약관·운영 원칙 문장과 규격 설명은 C가 `docs/legal/`·`knowledge/`에 쓴다. B는 그 문장을 그대로 넣는다.
