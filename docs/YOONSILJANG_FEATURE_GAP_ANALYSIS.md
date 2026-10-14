# 윤실장 기능 격차 분석 (Price Now 대비)

기준일: 2026-10-14. 참고 사이트에서 본 것: `PRICE_NOW_FEATURE_AUDIT.md`. 실제로 돌린 테스트: `QA_AND_REGRESSION_REPORT.md`.

상태 표기: **IMPLEMENTED**(새로 만듦) · **IMPROVED**(있던 것을 고침) · **EXISTING**(이미 있음, 그대로) · **DEMO_ONLY**(시연용, 정식 연동 아님) · **BACKEND_REQUIRED**(서버 필요) · **BLOCKED**(외부 허가·자료 필요) · **NOT_APPLICABLE**(윤실장 구조에 맞지 않음)

## 1. 원칙
- 같은 기능을 새로 만들지 않고 있던 부품을 고쳤어요: 검색은 `domain/search.js`, 가격표 필터는 `priceTable`, 알림은 `domain/intel.js`, 데이터 상태는 '알아두면 좋은 점' 화면, 동기화는 `loadData`.
- 새 메뉴는 만들지 않았어요. 마이 메뉴 이름만 '데이터 상태·앱 설치'로 바꿨어요(`#data`).
- ② 객관 표시 원칙은 그대로예요. 최저가 지점을 앞세우는 표시는 사용자가 고른 정렬·알림 안에서만 나와요.

## 2. 기능별 결과
| # | 기능 | 상태 | 무엇을 했나 | 어디서 |
|---|---|---|---|---|
| 1 | 전국 지점 검색 | EXISTING | — | 머리말 지역 |
| 2 | 지역 필터 | IMPROVED | 가격표 필터 줄 맨 앞에 지역 선택(화면 위 지역·전국·수도권·시·도별 곳 수) | `priceTable` |
| 3 | 브랜드 필터 | EXISTING | 필터 줄에 그대로 | `priceTable` |
| 4 | 고급 검색 연산자 | IMPLEMENTED | AND·`-`·`|`·숫자+단위 정확 일치·`N단위?`. '이렇게 찾았어요' 카드, 잘못된 연산자 안내. 기존 결함 2개 고침(`300샷`↔`1300샷`, `-파워`) | `Search.compile` (`ADVANCED_SEARCH_SPEC.md`) |
| 5 | 시술 검색 자동화 | EXISTING | 연산자가 있으면 자연어 해석을 건너뜀(일부러 쓴 문법 존중) | `views.search` |
| 6 | 자주 찾는 시술 | EXISTING | — | 홈 |
| 7 | 조건부 포함·제외 | IMPROVED | '가격 조건' 창 하나에 모음 | `priceCondSheet` |
| 8 | 체험가 필터 | IMPROVED | 같은 창 '가격 종류' | 〃 |
| 9 | 묶음 가격 필터 | IMPLEMENTED | 묶음(A+B) 포함·만·빼기 | 〃 |
| 10 | VAT 포함 가격 | EXISTING | 같은 창에서도 바꿀 수 있게 | 〃 |
| 11 | 브랜드별 비교 | IMPROVED | 지점 수·범위·중간값·조건부 가격 수·마지막 확인·표본 적음, 누르면 그 브랜드 지점의 같은 시술 가격 목록 | `brandCard` (`BRAND_PRICE_COMPARISON.md`) |
| 12 | 로딩 진행률 | IMPLEMENTED | 실제로 받은 양 %(죠미 로딩 줄), 다 받은 뒤 '정리하는 중' | `loadData` (`PRICE_SYNC_ARCHITECTURE.md`) |
| 13 | 부분 데이터 | IMPROVED / NOT_APPLICABLE | 저장된 가격을 먼저 보여주고 새 버전은 뒤에서(PARTIALLY_READY). 지점 단위 부분 검색은 파일 구조상 해당 없음 | 〃 |
| 14 | 장바구니 합계 | EXISTING | — | 장바구니 |
| 15 | 상위 3곳 재확인 | DEMO_ONLY | '합계 낮은순'일 때 맨 위 3곳 확인 카드 + 3곳 재확인 요청(GitHub, 실제 접수). 즉시 재수집은 BACKEND_REQUIRED | `top3Card` (`CART_INTELLIGENCE_REPORT.md`) |
| 16 | 가격 변동 알림 | IMPROVED | '지켜보기'의 가격 하락. 값은 병원 표시가·알림의 지역 기준(화면 설정을 바꿔도 가짜 알림 없음) | `Intel.evalWatch` (`ALERT_ENGINE_SPEC.md`) |
| 17 | 최저 지점 변경 알림 | IMPLEMENTED | 앱 안 알림. 휴대폰 푸시는 BACKEND_REQUIRED | 〃 |
| 18 | 알림 기록 | IMPROVED | 종류·시술·실제 지점·이전→새 가격·관측일·가격 보기. 지켜보기를 만들면 그 시술의 지난주 실제 변동을 '지난 기록'으로 | `alertsCard` |
| 19 | 증분 업데이트 | IMPROVED | `data-meta.json`(버전·SHA-256·크기·지점 상태·바뀐 줄 목록). 버전이 같으면 가격 파일을 받지 않음. 줄 단위 패치는 보류(이유: §3) | `build2/datameta.py`, `loadData` |
| 20 | 데이터 캐싱 | IMPROVED | 검사를 통과한 사본만 저장(형식·수·날짜·중복·SHA-256), 실패하면 마지막 정상본 유지, 오프라인 안내 문구 | `Sync`, `loadData` |
| 21 | PWA 설치 | IMPROVED | 설치 카드(브라우저가 허락할 때만 버튼, iPhone·Android 안내), 새 버전 알림, 매니페스트 id·바로가기 | `installCard`, `sw.js` (`PWA_IMPLEMENTATION.md`) |
| 22 | 모바일 알림 | DEMO_ONLY | 사용자가 누르면 권한 요청, 앱을 열 때 찾은 변화를 휴대폰 알림으로, TEST 알림. 앱이 닫혀 있을 때 푸시는 BACKEND_REQUIRED | `notifyPanel` |
| 23 | 데이터 갱신 상태 | IMPROVED | 머리말 상태 점, 안내 줄, 데이터 상태 화면 | `paintSync`, `dataStatusCard` (`DATA_TRANSPARENCY_SPEC.md`) |
| 24 | 수집 정책 안내 | IMPROVED | 데이터 상태에 원본·비교 기준·VAT·이벤트·신고 방법, 운영 현황에 재수집 순서 | `views.about`, `views.ops` |
| — | 가격 재확인 요청 | IMPLEMENTED (DEMO 표시) | '이 가격 다시 확인하기': 기록·원본 열기·실제 요청(하루 1번/가격, 10번/일) | `recheckSheet` (`PRICE_REFRESH_DESIGN.md`) |
| — | 제품·장비 필터 | IMPLEMENTED | 상품명에 적힌 제품·장비 칩 | `prodFacet` |
| — | 장바구니 조건 점검 | IMPROVED | 수량 제한·묶음 조건·중복 할인 경고 추가, 견적에 '확인할 조건 N개' | `quoteWarnings` |

## 3. 하지 않은 것과 이유
| 항목 | 상태 | 이유 |
|---|---|---|
| 지점 단위로 나눠 받기·지점 단위 부분 검색 | NOT_APPLICABLE | 데이터가 파일 하나(5.7MB, 압축 795KB)이고, 지점 수·묶음 통계·비교 키가 전체를 기준으로 미리 계산돼 있어요. 나누려면 빌드와 앱의 색인 구조를 다시 짜야 하고, 지금 크기에선 버전 확인만으로 재방문 내려받기가 0이 돼요 |
| 줄 단위 증분 패치 | 보류 | 같은 날 두 번 만든 파일을 비교하니 바뀐 가격 줄은 13줄인데 글자 번호표(문자열 표)는 29,438개 중 16,114개만 같은 자리였어요. 패치를 하려면 문자열 번호를 고정하는 빌드 변경이 먼저 필요해요(`PRICE_SYNC_ARCHITECTURE.md` §5) |
| 병원 사이트 즉시 재수집 | BACKEND_REQUIRED | 재수집 서버·작업 큐·요청 제한이 필요해요. 지금은 GitHub Actions 주간 수집뿐이에요 |
| 앱이 닫혀 있을 때 휴대폰 푸시 | BACKEND_REQUIRED · BLOCKED | 푸시 서버와 VAPID 키, 구독 저장소(Supabase 등)가 필요해요. 키가 없어요 |
| 6시간마다 수집 | BLOCKED | 서버 용량·병원 사이트 허용 범위 결정이 필요해요. 근거 없이 약속하지 않아요 |
| 카카오·Google·Apple 로그인 | 지시대로 하지 않음 | 이번 작업 범위 밖(시연 단계 PIN 유지) |
