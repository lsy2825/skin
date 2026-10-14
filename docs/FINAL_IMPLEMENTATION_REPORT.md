# 최종 구현 보고서 — YOONSILJANG 5.0 (수익화·AI 커머스)

기준일: 2026-10-14. 지시서: "YOONSILJANG 5.0 — COMPLETE MONETIZATION & AI COMMERCE SYSTEM".
테스트 결과는 이 환경에서 **실제로 돌린 것만** 적었어요. 실제 결제사·실제 AI·네이티브 앱으로 한 테스트는 없어요.

## 요약

| 릴리스 | 결과 | 완료 수준 |
|---|---|---|
| A 점검·구조 | 저장소 점검·분류표, 구조, 카탈로그 버전 규칙, 경제성 가정 (`MONETIZATION_ARCHITECTURE.md`, `PRICING_AND_UNIT_ECONOMICS.md`) | DEMO_READY |
| B 지갑·상점 | 추가 전용 원장·지갑 투영·주문 스냅샷·지급 1회·예약/차감/반환·환불·광고 없는 기간(SQL, PostgreSQL 테스트 10). 앱 시연 지갑·충전 화면 | DEMO_READY · 서버 미배포 → BLOCKED_EXTERNAL_DEPENDENCY |
| C AI | OpenAI Responses API 사진 읽기(엄격 스키마, 가격 글자 재확인, 비용 기록, 대체 호출 무차감), 죠미 안전장치 | 모의 테스트만 · 키 없음 → BLOCKED_EXTERNAL_DEPENDENCY |
| D 분석 | 이벤트 글·견적 읽기, 매칭, 보고서 7종, 고급 계획(30일), 공유 요약, 무료 고치기 | DEMO_READY |
| E 토스 샌드박스 | 주문·승인·웹훅 재조회·대사·중복 결제 자동 취소·관리자 환불 | 모의 토스 테스트만 · 테스트 키 없음 → BLOCKED_EXTERNAL_DEPENDENCY |
| F 푸시·분석 | 가격 지켜보기 규칙·중복 없는 알림·조용한 시간·내용 없는 푸시(VAPID), `commerce_economics`, 운영 '가정' 카드 | 모의 테스트만 → BLOCKED_EXTERNAL_DEPENDENCY |
| G 네이티브 | Apple JWS·Google Play 검증 계약 | 네이티브 앱 없음 → BLOCKED_EXTERNAL_DEPENDENCY |
| H 운영 준비 | 체크리스트·보안 점검 문서 | NEEDS_LEGAL_REVIEW · PRODUCTION_READY 아님 |

## 무엇을 만들었나 (파일)

- DB: `supabase/monetization.sql`(표 22개, `commerce_*` 함수 40여 개, RLS·권한), `supabase/commerce_seed.sql`(카탈로그 v1: DEMO만 활성).
- 서버: `server/src/` — `app.mjs`(API), `payments/{toss,flow,store}.mjs`, `ai/{openai,jomi}.mjs`, `jobs.mjs`, `push.mjs`, `safe.mjs`, `auth.mjs`, `config.mjs`, `worker.mjs`, `server/wrangler.toml.example`.
- 공용 모듈(앱·서버): `app/domain/{offerparse,match,pricectx,premium,jomiqa,demowallet,economics}.js`.
- 앱: `app/commerce.js`(크레딧·충전·프리미엄 도구·보고서 화면), `app.js`(설치·메뉴·운영 경제성 카드), `config.js`(commerce 설정), SW `pc-v16`.
- 도구·테스트: `tools/unit_economics.js`, `tests/run_regression.sh`, `tests/offer.test.js`, `tests/commerce.test.js`, `tests/e2e/commerce50.js`, `server/test/{ledger,api}.test.mjs`.
- 문서 20개: MONETIZATION_ARCHITECTURE, PRICING_AND_UNIT_ECONOMICS, WEB_CHECKOUT_INTEGRATION, APPLE_IAP_INTEGRATION, GOOGLE_PLAY_BILLING_INTEGRATION, CREDIT_LEDGER_SPEC, CREDIT_REFUND_POLICY_SPEC, AD_FREE_ENTITLEMENTS, AI_VISION_PIPELINE, JOMI_AI_GUARDRAILS, PREMIUM_REPORTS_SPEC, PREMIUM_PLANNER_SPEC, PRICE_WATCH_AND_PUSH, CRAWLING_COST_TRACKER, OPERATIONAL_COST_DASHBOARD, SECURITY_AND_PRIVACY_AUDIT, PAYMENT_SANDBOX_QA, NATIVE_STORE_READINESS, PRODUCTION_LAUNCH_CHECKLIST, 이 보고서.

## 테스트 (실제 실행)

| 묶음 | 결과 |
|---|---|
| `server/test/ledger.test.mjs` (PostgreSQL 16) | 10/10 |
| `server/test/api.test.mjs` (PostgreSQL + 모의 결제사·AI·푸시) | 12/12 |
| `node --test tests/*.test.js` (기존 71 + 5.0 11) | 82/82 |
| `tests/e2e/commerce50.js` (Chromium, 390px) | 27/27 |
| 전체 회귀 | 원장 10/10 · API 12/12 · DB 보안 통과 · e2e commerce50 27/27, qa7, ux_qa, concern, xss, jomi, objective, frame, table_attr, compare_cards, v5_features, demo_features, data_sync, pricenow, audit40, taxonomy40, pricing40, ops40 통과. 단위 82/82·비밀값 검사는 고친 뒤 따로 다시 돌려 통과(첫 실행은 실행 방식 오류·테스트의 비밀값처럼 보이는 문자열 2개로 실패). audit_ui·a11y·touch_targets는 이 커밋 시점에 실행 중 — 결과는 다음 커밋에 적어요 |

## 한계 (정직하게)

- 서버는 저장소에만 있고 배포되지 않았어요. 실제 토스 샌드박스·OpenAI·Apple·Google·푸시 서비스와 통신한 적이 없어요.
- 배포된 앱은 DEMO: 시연 크레딧은 결제가 아니고 이 기기에만 있어요.
- AI 사진 읽기는 시연에서 닫혀 있어요(가짜 결과 없음). 가격 이력 보고서는 기록이 2주뿐이라 판매하지 않아요.
- 앱의 사진 업로드 화면(EXIF 제거)과 서버 모드 결제창·푸시 구독 화면은 서버 연결 때 추가해요.
- 환불 정책·약관·가격은 초안/실험값이고 법률 검토 전이에요.

## 사용자(주인)가 정해야 할 것

1. 실험 가격을 그대로 쓸지(₩990/1,990/3,900, 기능 크레딧).
2. 토스페이먼츠 계약·테스트 키 발급, Supabase 운영 프로젝트, Cloudflare 계정 — 생기면 SANDBOX 검증(`PAYMENT_SANDBOX_QA.md` §3).
3. OpenAI 사용 여부(사진이 국외 사업자로 전송됨 → 개인정보 고지 필요)와 모델·단가.
4. 법률 검토 범위(`PRODUCTION_LAUNCH_CHECKLIST.md` §2).
5. 네이티브 앱을 만들지(만들면 스토어 결제 필수).

---

# (이전) 최종 구현 보고서 — YOONSILJANG 4.0

기준일: 2026-10-14.
- 지시서: "YOONSILJANG 4.0 — THE ULTIMATE PRODUCT OVERHAUL"
- 형식: 지시서가 정한 칸(Feature / Previous State / Changes / Files / Test / Result / Limitations / Next)
- 테스트 결과는 이 환경에서 **실제로 돌린 것만** 적었어요. 전체 회귀는 `REGRESSION_TEST_REPORT.md`에 있어요.

## 요약
| 릴리스 | 중요도 | 결과 |
|---|---|---|
| A 점검·핵심 정확도 | CRITICAL | 데이터 결함 9건 수정(가짜 변동 재발 1건 포함), 2건 NEEDS_REVIEW로 남김(`PRODUCT_AUDIT.md`). 버튼 164개 눌러 반응 없음 0 |
| B 분류·검색 | CRITICAL | 제품·장비 층, 비교 판정 A~J·R, 쉬운 보기, 결과 종류 검색, 대기열 120건·별칭 574줄 |
| C 가격·장바구니 | CRITICAL | 가격 종류 범위, 가격 근거 순서, 방문 계획 A~D |
| D 운영 | HIGH | GitHub 실제 수집 상태, 분류 검토 센터(읽기 전용) |
| E 경험·측정 | HIGH | 사용 통계(동의·이 기기·시연 표시), 모션·성능·죠미·경쟁 문서 |
| F 다음 | FUTURE | `RELEASE_ROADMAP.md` |

## 기능별

### 1. 시술 분류 체계
- **Previous State**: 제품군 → 옵션 2층. 제품·장비 층이 없었어요. 'N회 한정가' 378줄을 1회로 읽었고, '외국산'을 국산으로 읽었어요. 제모 장비·부위가 서로 섞였어요.
- **Changes**
  - 횟수·원산지 규칙을 고쳤어요.
  - 직접 만든 묶음 21곳의 잘못 묶임을 막았어요.
  - 자동 묶음 서명에 장비 8종, 화면 이름의 부위, 괄호 속 내용, LDM 분, 포텐자 모드·팁을 넣었어요.
  - 모델 번호가 용량으로 읽히지 않게 했어요.
  - 같은 상품이 묶음 제목만 다를 때 하나로 봐요.
  - 제품·장비 층(`classify.js products`), 비교 판정 A~J·R, 쉬운 보기(종류 → 용량·부위 → 횟수)를 더했어요.
  - 검토 대기열·별칭 표를 만들었어요.
- **Files**: `build2/xkeys.py`, `build2/taxonomy.py`, `app/domain/classify.js`, `app/app.js`(`mixFor`·`prodRank`·`classOf`·`specSteps`·`variantParts`), `tools/review_queue.js`, `docs/TREATMENT_TAXONOMY.md`, `docs/PRODUCT_ALIAS_MAPPING.csv`, `docs/CLASSIFICATION_REVIEW_QUEUE.csv`
- **Test**: `xkeys.py` 117 · `taxonomy.py` 51 · `classify.test.js` 6 · `taxonomy40.js` 13 · `audit40.js` A1~A10
- **Result**: 통과. 비교 묶음 2,420 → 2,617개. 묶음에 든 줄은 70.3% → 68.7%(정확도 우선)
- **Limitations**: 직접 만든 묶음 5개(X03·X10·X28·X30·X35)는 제품이 섞여 있어요. 안내와 거르기로 대신해요. 판정은 상품명만 보고 내려요.
- **Next**: 대기열 C 51건을 사람이 결정하기

### 2. 통합 검색
- **Previous State**: 가격 줄 + 연산자 + 자연어. 결과 종류 구분이 없었어요.
- **Changes**: "검색어가 가리키는 것" 카드(제품·장비 + 판매 지점 수, 병원, 지역 + 지점 수). 지역으로 해석된 검색도 원래 입력으로 찾아요. 제품 지점 수는 검색어가 가리키는 제품만 세요(성능).
- **Files**: `app/app.js`(`typedResults`·`prodBranches`), `docs/SEARCH_ENGINE_QA.md`
- **Test**: `taxonomy40.js` B10~B12, `pricenow.js` S4~S9
- **Result**: '아포지' 55곳 = 데이터 55곳. '강남' 병원 3·지역 3. 통과
- **Limitations**: 상품명에 제품을 적지 않은 지점은 제품 검색에서 빠져요.
- **Next**: —

### 3. 지식 카드
- **Previous State**: 지식 베이스 49개, 선택 바로 아래 설명
- **Changes**: 비교 판정 'A~J 뜻' 창
- **Files**: `app/app.js`(`clsSheet`)
- **Test**: `taxonomy40.js` B9
- **Result**: 통과
- **Limitations**: 의료진 검수 전 문장은 '초안' 표시(기존)
- **Next**: 의료진 검수

### 4. 가격 비교 엔진
- **Previous State**: 같은 묶음끼리, 부가세 미확인 표시, 조건부 칩
- **Changes**: 가격 종류(일반·이벤트·조건부·고시가) 범위를 한 눈금에 그리는 카드, 가격 근거에 '가격 종류' 줄과 고정 순서, 맨 위 비교 판정
- **Files**: `app/app.js`(`priceClass`·`priceClassCard`·`priceSheet`), `docs/PRICING_ENGINE_QA.md`
- **Test**: `pricing40.js` C1~C5, `pricenow.js` S10~S12
- **Result**: X29 일반가 69곳·1.6만~16.5만 원 = 데이터. 통과
- **Limitations**: 행사 표기 없는 행사 가격은 '일반가'로 보여요(초저가·R로 따로 알림).
- **Next**: R 59건 원본 대조

### 5. 병원 비교 작업대
- **Previous State**: 빠른 비교 2~4곳, A/B, 제공 표
- **Changes**: 없음
- **Files**: —
- **Test**: `demo_features.js` 47/47
- **Result**: EXISTING_VERIFIED
- **Limitations**: —
- **Next**: —

### 6. 장바구니 계획
- **Previous State**: 한 곳 합계 범위, 섞기, 최대 2곳 설정
- **Changes**: 방문 계획 A~D 카드(한 곳 / 시술별로 나눠서 / 최대 2곳 / 가까운 한 곳). 각 카드에 방문 수와 합계, 해당 탭으로 가는 버튼이 있어요. 병원 이름은 없어요.
- **Files**: `app/app.js`(`scenarioCard`), `docs/CART_ENGINE_QA.md`
- **Test**: `pricing40.js` C6~C11, `qa7.js` Q4
- **Result**: A 범위 = 요약 범위. B 194,700원(3곳) ≤ C 196,790원(2곳) ≤ A 최저 207,680원. 통과
- **Limitations**: 이동 시간·상담비는 계산하지 않아요.
- **Next**: —

### 7. 지도 가격 탐색
- **Previous State**: 시술을 고르면 지점마다 가격 핀(중립), 같은 건물 쌓기, 목록 연동
- **Changes**: 없음(점검만 함. 같은 좌표 7쌍은 실제 같은 건물이거나 정밀도 표시가 있는 경우)
- **Files**: —
- **Test**: `v5_features.js`, `ux_qa.js`
- **Result**: EXISTING_VERIFIED
- **Limitations**: 바텀시트 개편 안 함
- **Next**: —

### 8. 이력·알림
- **Previous State**: 실제 수집일만, 지켜보기 6종. 분류가 바뀌면 가짜 변동·가짜 이력이 생길 수 있었어요.
- **Changes**
  - 다시 묶인 묶음(`meta.recl`)은 변동·검토에서 빼고, 이력을 그날부터 다시 그리고, 안내를 띄워요.
  - 알림은 알리지 않고 기준만 다시 잡아요.
  - 바뀐 ID(`meta.keymap`)를 따라 저장 항목을 옮겨요.
  - 같은 날 다시 빌드해도 가짜 변동이 생기지 않게 했어요(CI 재빌드에서 3 → 16건 재발을 발견하고 고침).
- **Files**: `build2/appdata.py`(`load_prev`·`reclassified`·`key_map`·`trend`), `app/app.js`(`migrateKeys`·`reclDate`·`checkAlerts`·`keyTrend`)
- **Test**: `audit40.js` A12~A14·B1~B7
- **Result**: 통과. 변동 3건(실제)만
- **Limitations**: 다시 묶인 묶음의 예전 이력은 화면에서 빠져요. 원본 스냅샷 파일은 그대로 남아요.
- **Next**: 백그라운드 푸시(REQUIRES_BACKEND)

### 9. 데이터 품질·운영 검토 센터
- **Previous State**: 운영 현황(보고·신선도·급변 큐·재수집 순서)
- **Changes**
  - 수집 실행 상태: GitHub Actions 공개 API, 누를 때만. QUEUED·RUNNING·SUCCESS·FAILED·RATE_LIMITED, 연결 실패 시 "확인하지 못했어요".
  - 분류 검토 센터: `review.json`, 읽기 전용, 처리는 저장소에서
  - CI가 매 빌드마다 대기열을 만들어요.
- **Files**: `app/app.js`(`runStatusCard`·`reviewCenterCard`), `tools/review_queue.js`, `.github/workflows/weekly.yml`, `app/index.html`(CSP `connect-src` + api.github.com), `app/sw.js`, `docs/ADMIN_OPERATIONS_SPEC.md`
- **Test**: `ops40.js` O1~O9(GitHub 응답은 테스트에서 흉내 냄). 실제 API 응답 형식은 curl로 확인했어요(in_progress/completed·success).
- **Result**: 통과
- **Limitations**: 인증 없는 요청은 시간당 60번이에요. 앱에서 수집을 시작할 수 없어요(토큰을 넣지 않음).
- **Next**: 중계 서버(REQUIRES_BACKEND)

### 10. 개인화
- **Previous State**: 이 기기 저장(관심·최근·장바구니·장소·설정)
- **Changes**: 옵션 보기 방식 기억(`pc:cmpMode`), 저장 항목의 ID 이전(지운 것 없음)
- **Files**: `app/app.js`
- **Test**: `taxonomy40.js` B7, `audit40.js` B1~B6
- **Result**: 통과
- **Limitations**: —
- **Next**: —

### 11. 죠미
- **Previous State**: 승인 8 · 미승인 3(설명·장바구니·곤란)
- **Changes**: 없음(새 그림 생성 없음)
- **Files**: `docs/JOMI_ASSET_STATUS.md`
- **Test**: `jomi.js` 39/39
- **Result**: EXISTING_VERIFIED
- **Limitations**: 미승인 3표정은 원본 작가 그림이 필요해요.
- **Next**: 사용자 결정(이름 표기, 그림)

### 12. UX·모션
- **Previous State**: 동작 줄이기 대응
- **Changes**: 새 화면 5종. 좁은 화면 넘침 2건을 고쳤어요(시험이 잡음). 모션 규칙 문서
- **Files**: `app/styles.css`, `docs/UX_REDESIGN_REPORT.md`, `docs/MOTION_DESIGN_SYSTEM.md`
- **Test**: `ux_qa.js` 25/25, `compare_cards.js` 14/14, `touch_targets`, `a11y`
- **Result**: 통과
- **Limitations**: 홈 개편 안 함
- **Next**: —

### 13. PWA·성능
- **Previous State**: `pc-v14`. 첫 방문 느린 4G 8.8초
- **Changes**: `pc-v15`(분류 모듈). review.json·GitHub 상태는 캐시하지 않아요. 제품 지점 수 계산을 필요할 때만 하도록 줄였어요.
- **Files**: `app/sw.js`, `tests/perf/feature40.js`, `docs/PERFORMANCE_REPORT.md`
- **Test**: `first_load.js`, `feature40.js`, 4.0 전후 같은 방법 비교
- **Result**
  - 느린 4G 첫 방문 8,855ms(전과 같은 수준)
  - 새 화면 43~142ms(CPU 4배 느림)
  - 첫 검색 4.0 전 1,197ms → 뒤 1,206ms
- **Limitations**: 실기기 측정 없음
- **Next**: —

### 14. 분석 이벤트
- **Previous State**: 없음
- **Changes**: 사용 통계. 기본 꺼짐이고, 켜면 이 기기에만 남아요(최근 500개). 모두 `demo: true`이고, 검색어 원문·고민·위치는 남기지 않아요. 보기·지우기가 있어요. 이벤트는 9종이에요.
- **Files**: `app/app.js`(`track`·`eventsSheet`·`AN_EVENTS`), `docs/ADMIN_OPERATIONS_SPEC.md` §6
- **Test**: `ops40.js` O10~O15
- **Result**: DEMO_ONLY, 통과
- **Limitations**: 서버 지표 없음
- **Next**: 동의 문구 법률 검토 + 서버(REQUIRES_BACKEND)

### 15. 준법·출시 준비
- **Previous State**: 예약·결제·광고 없음, 지시 ② 플래그 꺼짐
- **Changes**: 새 화면도 병원 이름을 앞세우지 않아요(시험). 금지 행동은 없어요(원본 삭제·비밀키·인증 정책·외부 발송·예약/결제 없음).
- **Files**: `docs/RELEASE_ROADMAP.md`, `docs/COMPETITOR_BENCHMARK.md`
- **Test**: `objective.js` 32/32, `pricing40.js` C3·C11, `scan_secrets.py`
- **Result**: 통과
- **Limitations**: 법률 판단은 전문가 검토가 필요해요.
- **Next**: 출시 전 법률 검토

## 산출물 18개
| # | 파일 | 상태 |
|---|---|---|
| 1 | `PRODUCT_AUDIT.md` | 작성 |
| 2 | `FEATURE_INVENTORY.md` | 작성 |
| 3 | `COMPETITOR_BENCHMARK.md` | 작성(공개 문구만, 앱 직접 사용 못 함) |
| 4 | `TREATMENT_TAXONOMY.md` | 작성 |
| 5 | `PRODUCT_ALIAS_MAPPING.csv` | 생성(574줄, CI가 매 빌드 갱신) |
| 6 | `CLASSIFICATION_REVIEW_QUEUE.csv` | 생성(120건, CI 갱신) |
| 7 | `SEARCH_ENGINE_QA.md` | 작성 |
| 8 | `PRICING_ENGINE_QA.md` | 작성 |
| 9 | `CART_ENGINE_QA.md` | 작성 |
| 10 | `DATA_QUALITY_REPORT.md` | §0 추가 |
| 11 | `ADMIN_OPERATIONS_SPEC.md` | 작성 |
| 12 | `UX_REDESIGN_REPORT.md` | 작성 |
| 13 | `MOTION_DESIGN_SYSTEM.md` | 작성 |
| 14 | `JOMI_ASSET_STATUS.md` | 작성 |
| 15 | `PERFORMANCE_REPORT.md` | 작성 |
| 16 | `REGRESSION_TEST_REPORT.md` | 작성 |
| 17 | `RELEASE_ROADMAP.md` | 작성 |
| 18 | `FINAL_IMPLEMENTATION_REPORT.md` | 이 문서 |

## 사용자가 정해야 할 것 (4.0에서 생긴 것)
1. 직접 만든 비교 묶음 중 제품이 섞인 5개(X03·X10·X28·X30·X35)를 제품별로 나눌지. 나누면 더 정확하지만, 묶음마다 비교 지점 수가 줄어요.
2. 사용 통계를 서버로 모을지. 모으려면 동의 문구 법률 검토와 서버가 필요해요.
3. 이전부터 남은 것: 죠미/조미 이름 표기, 미승인 3표정 그림, 푸시 서버, 로그인
