# 기능 목록 (Feature Inventory)

기준일: 2026-10-14, 4.0 작업 시작 시점의 코드(커밋 a32c551)를 직접 읽고 정리했어요. 4.0에서 바뀐 상태는 표 맨 오른쪽 칸과 `FINAL_IMPLEMENTATION_REPORT.md`에 적어요.

상태 표기(지시서 그대로):
- `EXISTING_VERIFIED` — 원래 있었고 테스트로 확인
- `IMPLEMENTED` — 이번에 새로 만듦
- `IMPROVED` — 이번에 고침·보강
- `PARTIALLY_IMPLEMENTED` — 일부만
- `DEMO_ONLY` — 화면은 있지만 실제 서버 동작은 없음(화면에 그렇게 적혀 있음)
- `REQUIRES_BACKEND` — 서버가 있어야 가능
- `NEEDS_REVIEW` — 사람 확인 필요
- `BLOCKED` — 이 환경에서 불가

## 1. 구조
| 층 | 파일 | 규모 |
|---|---|---|
| 앱 화면 | `app/app.js` | 약 4,300줄, 함수 170개, 화면 22개(`views.*`) |
| 도메인 규칙(순수 함수, 테스트 가능) | `app/domain/pricing.js`(가격·부가세·만료) · `search.js`(검색·연산자·별칭) · `spec.js`(규격·조건 읽기) · `intel.js`(이력·알림) · `stats.js`(묶음 통계) · `concern.js`(고민 분류) · `sync.js`(데이터 동기화 검사) | 868줄 |
| 첫 화면·잠금 | `app/gate.js`(PIN 화면, 첫 방문 데이터 미리 받기) | PIN은 화면 잠금일 뿐 보안 수단 아님 |
| 오프라인 | `app/sw.js`(서비스 워커 `pc-v14`), `app/manifest.webmanifest` | |
| 데이터 빌드 | `build2/clean.py`(정리) → `xkeys.py`(직접 만든 비교 묶음 36개) + `taxonomy.py`(자동 비교 묶음) → `appdata.py`(`app/data.json`) + `datameta.py`(`data-meta.json`) | 매일 06:00 KST, 월요일 수집 |
| 수집 | `scrape/*.py`(브랜드 4곳 공개 HTML, robots 확인, 1초 1회) | 포에버의원은 중지 |
| 서버(꺼져 있음) | `supabase/*.sql`(가격·계정·정책 스키마), `app/auth.js` | `config.js`가 비어 있어 로그인 꺼짐 |

## 2. 화면(라우트) 목록
| 주소(`#…`) | 화면 | 주요 기능 | 4.0 전 상태 |
|---|---|---|---|
| `home` | 홈 | 검색창, 최근 본 것·이어서 보기, 지역 고르기, 죠미 인사, 가격 동향 | EXISTING_VERIFIED |
| `explore` | 탐색 | 시술별(분야 → 제품군), 피부 고민, 지도, 지점 비교로 가는 입구 | EXISTING_VERIFIED |
| `compare?k=` | 시술 비교 | 제품군·옵션 고르기, 시술 설명(선택 바로 아래), 지점별 가격 목록·카드, 가격 분포, 가격 이력, 규격 카드, 장바구니 담기, 알림 | EXISTING_VERIFIED |
| `table?q=` | 전체 가격표 | 필터 줄(지역·가격 조건·브랜드·정렬) + 상세 필터, 제품·장비 칩, 용량 칩 | EXISTING_VERIFIED |
| `search/<q>` | 검색 결과 | 연산자(AND·`-`·`|`·숫자+단위·`N회?`), 자연어 해석 카드, 오타 제안, 검색 팁 | EXISTING_VERIFIED |
| `cart` | 장바구니 | 장바구니 여러 개, 옵션 바꾸기, 합계 범위, 병원별 보기, 한 곳/나눠 가기, 공유, 예산 | EXISTING_VERIFIED |
| `saved` | 관심 | 관심 시술·지점, 알림, 알림 기록, 저장한 비교 | EXISTING_VERIFIED |
| `change` | 가격 변동 | 지난 수집 대비 바뀐 가격(실제 관측만) | EXISTING_VERIFIED |
| `map` | 지도 | 지점 위치(정밀도 표시), 목록 ↔ 지도, 가까운 순 | EXISTING_VERIFIED |
| `branch/<지점>` | 지점 상세 | 지점의 모든 가격, 출처·확인일 | EXISTING_VERIFIED |
| `quick` | 빠른 비교 | 비교함 2~4곳, 시술 × 지점 표 | EXISTING_VERIFIED |
| `versus` | 지점 A/B | 두 지점 같은 시술 비교 | EXISTING_VERIFIED |
| `snap/<id>` | 저장한 비교 | 휴대폰에 저장한 비교 다시 보기 | EXISTING_VERIFIED |
| `guide` · `concern` | 시술 안내 · 피부 고민 | 지식 베이스 문장만(생성형 AI 없음) | EXISTING_VERIFIED |
| `about` = `data` | 데이터 상태·앱 설치 | 지점 수, 확인 상태, 바뀐 가격, 원칙, 설치 안내, 이 기기 | EXISTING_VERIFIED |
| `terms` | 쉬운 용어 | 용어 설명 | EXISTING_VERIFIED |
| `rank` | 지점 순위 | `branchRanking` 꺼짐 → 안내만 | EXISTING_VERIFIED(꺼짐) |
| `me` | 마이 | 설정(부가세·특가·지역·테마), 기록 끄기, 메뉴 | EXISTING_VERIFIED |
| `ops` | 운영 현황 | 수집 보고, 검토 큐, 재수집 순서(공개 정보만) | EXISTING_VERIFIED |
| `import` | 공유 장바구니 받기 | 링크로 받은 장바구니 | EXISTING_VERIFIED |

## 3. 지시서 프로젝트별 기능 (4.0 전 → 4.0 뒤)
| # | 프로젝트 | 4.0 전 | 4.0 뒤(요약, 자세히는 FINAL_IMPLEMENTATION_REPORT.md) |
|---|---|---|---|
| 1 | 시술 분류(Category→Family→Product→Variant…) | 제품군(Family)·옵션(Variant) 2층. 제품·장비 층 없음, A~J 판정 없음 | **IMPROVED** — 제품·장비 층, A~J·R 판정, 쉬운 보기 단계, 분류 결함 수정, 검토 대기열·별칭 표(`TREATMENT_TAXONOMY.md`). 직접 만든 묶음 분할은 NEEDS_REVIEW |
| 2 | 통합 검색 | 가격 줄 검색 + 연산자 + 자연어. 결과 종류(시술·제품·장비·고민·병원·지역) 묶음 없음 | **IMPROVED** — '검색어가 가리키는 것'(제품·장비·병원·지역 + 실제 지점 수)(`SEARCH_ENGINE_QA.md`) |
| 3 | 지식 카드 | 시술 설명(지식 베이스 49개, 초안 표시) | EXISTING_VERIFIED — 설명은 선택 바로 아래(이전 수정), 비교 판정 설명 창 추가 |
| 4 | 가격 비교 엔진 | 같은 비교 묶음끼리만, 부가세 미확인 표시, 조건부 가격 칩 | **IMPROVED** — 가격 종류·범위 그래프, 가격 근거 순서 고정, 비교 판정(`PRICING_ENGINE_QA.md`) |
| 5 | 병원 비교 작업대 | 빠른 비교(2~4곳), A/B | EXISTING_VERIFIED — 같은 비교 묶음끼리만 맞대고, 없는 곳은 '없음·확인 안 됨'(4.0 변경 없음) |
| 6 | 장바구니 계획 | 한 곳/나눠 가기, 합계 범위 | **IMPLEMENTED** — 방문 계획 A~D(방문 수·합계, 병원 이름 없음)(`CART_ENGINE_QA.md`) |
| 7 | 지도 가격 탐색 | 위치·거리. 가격 핀은 `lowestHighlight` 꺼짐 | EXISTING_VERIFIED — 시술을 고르면 지점마다 가격 핀(중립 표시), 같은 건물 지점은 겹치지 않게 쌓기, 목록 ↔ 지도. 4.0 변경 없음 |
| 8 | 이력·알림 | 실제 수집일만, 지켜보기 6종, 알림 기록, 휴대폰 알림(앱 열 때만) | **IMPROVED** — 분류가 바뀐 묶음의 이력 재시작·안내, 알림은 조용히 기준 재설정, 바뀐 ID 따라가기. 백그라운드 푸시는 REQUIRES_BACKEND |
| 9 | 데이터 품질·운영 | 운영 현황, 급변 검토 큐, 재수집 순서 | **IMPLEMENTED** — 수집 실행 상태(GitHub 실제 QUEUED·RUNNING·SUCCESS·FAILED·RATE_LIMITED), 분류 검토 센터(읽기 전용)(`ADMIN_OPERATIONS_SPEC.md`) |
| 10 | 개인화 | 휴대폰 저장(관심·최근·장바구니·장소) | IMPROVED — 옵션 보기 방식 기억, 저장 항목 ID 이전(지운 것 없음) |
| 11 | 죠미 | 원본 그림 8표정, 문구 | EXISTING_VERIFIED — 승인 8 · 미승인 3 그대로(`JOMI_ASSET_STATUS.md`) |
| 12 | UX·모션 | 동작 줄이기 대응, 하단 탭 | IMPROVED — 새 화면 5종(`UX_REDESIGN_REPORT.md`), 모션 규칙 문서(`MOTION_DESIGN_SYSTEM.md`) |
| 13 | PWA·성능 | 설치·오프라인·데이터 동기화 | IMPROVED — 서비스 워커 pc-v15(분류 모듈 포함, review.json·GitHub 상태는 캐시 안 함), 측정(`PERFORMANCE_REPORT.md`) |
| 14 | 분석 이벤트 | 없음(수집 안 함) | **DEMO_ONLY** — 동의(기본 꺼짐) 뒤 이 기기에만, 모든 이벤트 demo 표시, 검색어 원문 없음. 서버 지표는 REQUIRES_BACKEND |
| 15 | 준법·출시 준비 | 법률 검토 체크리스트, 플래그로 꺼 둔 기능 | EXISTING_VERIFIED — 예약·결제·광고 없음, 지시 ② 플래그 꺼짐 유지, 출시 로드맵(`RELEASE_ROADMAP.md`) |

## 4. 저장소(이 기기)
`localStorage`의 `pc:` 키 30여 개. 주요 키는 다음과 같아요.
- 장바구니: `carts`
- 관심: `favs`
- 알림: `alerts` · `notes`
- 최근: `recent` · `recentQ`
- 장소: `places`
- 비교함: `short`
- 저장한 비교: `snaps`
- 재확인 요청 날짜: `rechecks`
- 설정: `vat` · `special` · `region` · `theme` · `brands`

가격 사본은 Cache Storage `pc-data-v1`에 있어요. 4.0에서 비교 ID가 바뀌면 이 기기의 저장 항목을 새 ID로 옮겨요(`PRODUCT_AUDIT.md` F-07).
