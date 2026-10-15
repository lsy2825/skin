# 윤실장 (피부과 가격비교)

공장형 피부과 브랜드(블리비·쁨·톡스앤필·리엔장)의 지점별 시술 가격을 모아 비교하는 홈 화면 앱(PWA).
구조·설계 결정은 `docs/ARCHITECTURE.md`, 진행 상태는 `docs/IMPLEMENTATION_STATUS.md`.

- 앱: `app/`. 빌드마다 관리자 주소 `yoonsiljang-admin`(Cloudflare Access 로그인 뒤)에 배포돼요. **공개 주소 배포는 2026-10-15부터 멈춤**
  (저장소 변수 `PUBLIC_DEPLOY`=`on`일 때만). 내 PC에서 보기: `python -m http.server 8766 --directory app` → http://localhost:8766
- 매주 월요일 06:00(KST) GitHub Actions가 자동으로 가격을 모으고(`scrape/`), 정리하고(`build2/clean.py`), 앱 데이터(`app/data.json`)를 만들어요.
  수동 갱신: Actions → weekly-prices → Run workflow.
- 안전장치: 어떤 브랜드의 수집 결과가 지난주보다 30% 넘게 줄면 그 브랜드는 지난주 자료를 그대로 써요. 결과는 `data2/report.md`.
- 정리 규칙: 0원·안내 문구·서류 발급비 제외, 정가가 판매가보다 낮거나 10배 이상이면 정가 삭제, 같은 지점의 중복 줄 하나로. 내역은 `data2/issues.csv`.
- 브랜드 간 같은 시술 묶기: `build2/xkeys.py` (테스트: `python build2/xkeys.py`).
- 비밀번호 화면: `app/gate.js` (화면 잠금일 뿐, 데이터 파일은 공개 주소에 있어요).

Windows PC 준비(한 번): PowerShell에 아래 한 줄을 붙여 넣으면 Git·Python 3.12·Node.js·GitHub CLI 설치, `C:\dev\skin`에 저장소 받기,
파이썬 패키지 설치, 단위 테스트까지 해요(`tools/setup-windows.ps1`, 다시 실행해도 안전).

    irm https://raw.githubusercontent.com/lsy2825/skin/main/tools/setup-windows.ps1 | iex

로컬 실행:

    pip install -r requirements.txt
    python build2/weekly.py            # 수집부터 전부 (약 15분)
    python build2/weekly.py --skip-scrape   # 이미 모은 자료로 다시 만들기 (app/data.json + app/data-meta.json)
    python build2/datameta.py --prev 이전_data.json   # data-meta.json만 다시 만들기(버전·체크섬·바뀐 줄)
    node --test tests/*.test.js          # 가격 계산·검색·이력·통계·정렬 단위 테스트
    python tests/verify_prices_test.py   # 원본 대조 판정(가격이 원본 페이지 어디에 있는지) 시험
    python -m http.server 8766 --directory app
    APP_PIN=<비밀번호> node tests/e2e/ux_qa.js   # 화면 검사(Playwright 필요, 서버를 띄운 상태에서)
                                                 # 같은 방식: qa7·xss·a11y·concern·jomi·objective·frame·table_attr·compare_cards·v5_features·demo_features·data_sync·pricenow·touch_targets
    node tests/perf/gzserve.js app 8770 &  APP_PIN=<비밀번호> BASE=http://localhost:8770/ node tests/perf/first_load.js   # 첫 화면 속도(실험실 측정)
    node tools/audit_data.js                        # 데이터 점검(같은 묶음 안 다른 용량·횟수·제품, 중복 등 — 읽기만)
    node tools/review_queue.js                      # 분류 검토 대기열·별칭 표·app/review.json 만들기
    APP_PIN=<비밀번호> node tests/e2e/audit40.js     # 4.0 점검에서 고친 것 (taxonomy40·pricing40·ops40·audit_ui도 같은 방식)
    python tests/security/scan_secrets.py           # 비밀 정보 검사(배포 전 자동으로도 돌아요)
    bash tests/db/run_security_tests.sh             # DB 접근 정책 시험(로컬 PostgreSQL, 버리는 DB에서)

보안: docs/SECURITY_AUDIT.md(감사) · SECURITY_ARCHITECTURE.md(구조·통제) · SECURITY_REMEDIATION.md(조치·남은 일) ·
SECURITY_TEST_REPORT.md(시험 결과) · INCIDENT_RESPONSE_PLAN.md(사고 대응) · supabase/DATABASE_ACCESS_POLICIES.sql(DB 정책).
비밀번호 화면의 번호는 저장소에 적지 않아요(테스트는 APP_PIN 환경 변수).
4.0 개편: docs/FINAL_IMPLEMENTATION_REPORT.md(결과) · PRODUCT_AUDIT.md(점검) · TREATMENT_TAXONOMY.md(분류·비교 판정 A~J) · RELEASE_ROADMAP.md.
피부 고민으로 찾기: docs/AI_CONCERN_DISCOVERY_SPEC.md(기능 명세) · docs/LEGAL_REVIEW_CHECKLIST.md(출시 전 법률 검토 질문·게이트).

지도: © OpenStreetMap contributors (Leaflet, BSD-2). 좌표: OpenStreetMap Nominatim.
