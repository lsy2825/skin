# 아키텍처와 설계 결정

피부과·미용의료 시술 가격비교 플랫폼. 이 문서는 **지금 실제로 돌아가는 구조**와 그렇게 정한 이유,
그리고 마스터 요구사항(2026-10-13)에 맞춰 앞으로 넓혀 갈 방향을 적어요. 진행 상태는 `docs/IMPLEMENTATION_STATUS.md`.

## 1. 지금 구조 (2026-10-13)

```
scrape/sources.py ─▶ data2/sources.json (Source Policy Registry: robots.txt 허용 여부, 부가세·날짜 문구 근거)
병원 공개 페이지 ──(scrape/*.py, 주 1회 + 이벤트 종료 다음 날)──▶ data2/raw/<brand>.csv  (원본 보존: 이름·가격·정가·종료일·URL·수집시각)
                                          │  build2/weekly.py: 브랜드별 행·지점이 30% 넘게 줄면 지난 자료 유지
                                          ▼
                          build2/clean.py ─▶ data2/clean.csv + data2/issues.csv (제외·정가 삭제·기간 지남 사유 기록)
                                          │  data2/vat_policy.json  브랜드별 부가세 기본값(사이트 원문 근거)
                                          │  build2/xkeys.py   브랜드 간 같은 시술 36개(수작업 규칙, 테스트 90개)
                                          │  build2/groups.py  같은 옵션 자동 묶음(3곳 이상) 3,210개, 지점 가격 수준
                                          ▼
                        build2/appdata.py ─▶ app/data.json (앱이 읽는 압축 JSON) + data2/history/<date>.json(.auto.json.gz)
                                          │  급변(±90%/×10) 가격 → data2/review.csv 검토 대기, 승인 data2/review_ok.csv
                                          ▼
GitHub Actions(weekly.yml) ── 매일 06:00 KST 판단(build2/needs_refresh.py): 월요일 또는 저장된 이벤트가 끝났으면 수집
                              → 단위 테스트(node --test) → 빌드 → 커밋 → GitHub Pages 배포 / app·build2·tests 변경 push 시 수집 없이 재배포
                                          ▼
                 app/ (정적 PWA, 프레임워크 없음) ── 휴대폰 홈 화면 앱, 오프라인 캐시(sw.js), 비밀번호 화면(gate.js)
                 app/domain/ ── pricing.js(가격 계산) · search.js(검색 정규화·해석) · intel.js(이력 통계·알림), node:test로 검증
                                          ▲
                 app/auth.js + supabase/schema.sql ── 구글·카카오 로그인, 내정보·장바구니 동기화 (키 비어 있어 꺼짐)
                 build2/export_db.py → supabase/schema_platform.sql ── 같은 데이터를 PostgreSQL 표로 (DB로 옮길 때용, 지금 앱은 안 씀)
```

| 영역 | 기술 | 위치 |
|---|---|---|
| 수집 | Python 3.12, requests, BeautifulSoup | `scrape/` (블리비·쁨·톡스앤필·리엔장, 포에버는 일시 중지) |
| 정리·정규화 | Python | `build2/clean.py`, `xkeys.py`, `groups.py` |
| 배포·스케줄 | GitHub Actions, GitHub Pages | `.github/workflows/weekly.yml` |
| 프런트 | 바닐라 JS(`app.js` 약 2,200줄 + `domain/` 약 450줄), Leaflet(OSM), 나눔스퀘어라운드 | `app/` |
| 사용자 데이터 | 기기 localStorage(`pc:` 접두사). Supabase(Postgres+Auth)는 준비만 | `app/auth.js`, `supabase/schema.sql` |
| 테스트 | node:test(단위), Python 자체 테스트(xkeys), Playwright(E2E, 로컬 실행) | `tests/`, `tests/e2e/` |

## 2. 설계 결정

**D1. 지금 스택을 유지하고 Next.js로 다시 만들지 않는다.**
요구사항이 "기존 스택 우선, 무분별한 재작성 금지, 낮은 인프라 비용"이에요. 정적 PWA + 주간 배치로 서버비 0원에 이미 가격 조회·비교·장바구니가 돌아가요.
서버가 꼭 필요한 기능(가격 알림 발송, 관리자 검증, 사용자별 저장)은 Supabase(무료 플랜)를 붙여 해결하고,
SEO 랜딩 페이지는 Python이 정적 HTML을 미리 만들어 같은 Pages에 올리는 방식으로 할 수 있어요.
재검토 시점: 관리자 화면·알림이 커져서 서버 렌더링이나 API가 꼭 필요해질 때.

**D2. 원본 → 정리 → 앱 데이터의 3단 분리, 원본 보존.**
`data2/raw`(원본, 매주 덮어씀)와 `data2/accepted`(검증 통과본), `data2/clean.csv`(정리본), `issues.csv`(정리 사유)를 따로 둬요.
정규화 전 값은 지우지 않아요. DB로 옮길 때는 같은 구조를 `offers`(현재) / `price_snapshots`(이력)로 나눠요(§4).

**D3. 같은 조건끼리만 비교한다.**
- 브랜드 간 비교는 수작업 규칙 36개(`xkeys.py`). 용량·샷·회차·원산지가 같은 1회 가격만 묶고, 테스트로 오매칭을 막아요.
- 그 밖은 **이름이 정확히 같은 옵션**(공백·단위 표기만 통일)을 3곳 이상이 팔 때만 자동 묶음(`groups.py`). 비슷하지만 다른 상품은 묶지 않아요.
- 단위당 가격(100샷당 등)은 참고로만 보여주고 기본 정렬에 쓰지 않아요(요구사항 3.2). 단위가 다르면 '조건 상이'로 빼요.

**D4. 데이터 무결성 우선.**
- 가격 그래프와 변동은 실제 주간 스냅샷만 써요. 빈 주를 채우지 않아요.
- 할인율은 병원이 직접 적은 정가가 있을 때만 보여요. 정가가 판매가보다 낮거나 10배를 넘으면 정가를 지워요.
- 가짜 데이터는 테스트에서만 써요. 앱 데이터에는 없어요.
- 새 수집 결과가 30% 넘게 줄거나 빌드가 실패하면 지난 자료로 배포해요.

**D5. 수집 정책.**
공개 페이지만 읽어요. 요청 간격은 0.7~1초, 동시 4개, 재시도 3회예요. 로그인·CAPTCHA·차단 우회는 하지 않아요.
robots.txt 확인은 Source Policy Registry(`scrape/sources.py` → `data2/sources.json`)가 수집 전에 해요(D8). 이용약관 검토일(`terms_reviewed`)은 사람이 채워야 해서 비어 있어요.

**D6. 지점은 독립 개체예요.** 같은 브랜드라도 지점마다 가격표를 따로 수집하고 비교해요(`branches` 배열과 지점별 URL).

**D8. 정확성 장치 (2026-10-13 추가).**
- 종료일이 지난 이벤트는 빌드 때 빼고(`issues.csv`), 앱도 오늘 날짜로 한 번 더 걸러요. 블리비처럼 금요일에 끝나는 이벤트 때문에 주말에 가격이 비지 않도록 종료 다음 날 아침 자동 재수집해요.
- 부가세는 행 이름의 표기 → 브랜드 기본값(`vat_policy.json`, 원문 인용·URL·확인일) 순서로 정하고, 근거가 없으면 '미확인'으로 둬요. 앱 기본 표시는 부가세 포함 예상가, 설정에서 병원 표시가로 전환.
- 지점마다 마지막 확인일과 상태(VERIFIED/STALE), 가격마다 출처 URL을 앱에 보여요.
- 지난주보다 90% 넘게 내리거나 10배 넘게 오른 가격은 사람이 승인할 때까지 비교에서 빼요(Human-in-the-loop, 파일 기반).
- robots.txt가 막으면 그 주 수집을 건너뛰고 지난 자료를 유지해요. crawl-delay를 요구하는 호스트는 주 1회 한 페이지만 읽어요.

**D9. 가격 계산은 `app/domain/pricing.js`.** 회차(첫 회만 특가), 패키지 묶음 수, 한 곳/여러 곳/최대 두 곳 최적화, 부가세, 종료일, 방문일 조건을 순수 함수로 두고 `tests/pricing.test.js`(node:test)로 검증해요. 화면 코드는 데이터를 모아 넘기고 결과를 그리기만 해요.

**D7. 법적으로 민감한 기능은 꺼 둔다.**
로그인과 회원정보는 `config.js`가 비면 꺼져요(feature flag). 예약·결제·광고·수수료 기능은 만들지 않아요.
시술 기록은 민감정보일 수 있어서, 켜기 전에 동의와 처리방침이 필요해요.

**D10. 편의 기능의 상태는 세 곳에만 둔다 (2026-10-13 추가).**
- **주소(URL):** 공유할 수 있는 상태. 화면, 검색어, 필터, 비교 시술(`#table?q=…&cat=…`, `#compare?k=X12`). 새로고침·뒤로 가기·링크 공유가 그대로 돼요.
- **기기 저장소(localStorage `pc:*`):** 사람마다 다른 상태. 장바구니, 즐겨찾기, 내 필터, 최근 검색, 정렬, 집·직장, 알림, 신고 기록. 로그인을 켜면 장바구니부터 서버와 병합해요(고유 id 사용).
- **메모리(`st`):** 그 화면에서만 쓰는 상태(펼침, 선택 탭).
- 화면은 이 상태로부터 매번 다시 그려요(`render`). 다시 그리는 중의 중첩 호출은 막아요.

**D11. 확인 창 대신 되돌리기, 다시 그려도 포커스 유지.**
- 삭제·해지는 바로 실행하고, 6초 동안 "되돌리기"를 띄워요(`undoToast`).
- 이름 입력은 `prompt` 대신 시트(`nameSheet`)를 써서 칸 아래에서 검증해요.
- 시트(`sheet`)는 포커스를 안에 가두고, Esc로 닫고, 연 버튼으로 돌아가요.
- 같은 화면을 다시 그리면, 포커스가 있던 컨트롤을 이름표와 순서로 다시 찾아 포커스를 줘요(`focusMark`, `focusBack`).
- 터치 영역은 글자 크기를 키우지 않고 누르는 영역만 24×24px 이상으로 넓혀요(`.linkbtn::after`).

**D12. '인기'는 판매 지점 수예요.**
- 서버와 이용 통계를 두지 않기로 해서(D1, 개인정보 최소 수집), 인기 검색어는 파는 지점이 많은 시술로 정해요.
- 실제 검색량 순위는 서버 집계와 처리방침이 생긴 뒤에 할 수 있어요(`ADVANCED_UX_ROADMAP.md` P2).

## 3. 프런트 구조 (app/app.js)
- **해시 라우터**
  - 화면: `#home #map #compare #rank #versus #table #search/<q> #cart #import/<data> #me #branch/<i> #change #about #ops`
  - 쿼리는 필터 상태예요.
- **데이터 인덱스:** `byB`(지점→행), `byKB`(비교 키→지점→행), `byG`(자동 묶음→행), `byName`(이름→행), 검색 인덱스(`Search.buildIndex`, 캐시)
- **도메인 로직(`app/domain/`, UI 없음, 브라우저·Node 공용)**
  - `pricing.js`: 부가세, 종료일, 방문 조건, 줄 계산, 지점 비교, 첫 방문 중복 방지, 패키지 판정
  - `search.js`: 별칭, 정규화, 오타, 자동완성, 단위, 자연어 해석
  - `intel.js`: 이력 통계, 알림 판정
  - 묶음 통계(`gstat`, `rowPos`)와 지점 순위(`branchRanks`)는 아직 `app.js` 안에 있어요(다음 분리 대상).
- **공용 화면 조각**
  - `sheet`, `nameSheet`, `undoToast`, `copyText`, `favBtn`, `switchEl`
  - `priceTable`(필터·칩·결과 수·범위·프리셋), `noResults`(대안 제안)

## 4. 데이터 모델 (요구사항 §8)
`supabase/schema_platform.sql`에 표로 설계했고, `build2/export_db.py`가 지금 데이터를 CSV로 바꿔 넣어요. 로컬 PostgreSQL 16에서 적재·질의를 확인했어요. 앱은 아직 이 DB를 쓰지 않고 `app/data.json`을 읽어요. 금액은 모두 정수 KRW예요.

| 테이블 | 지금 데이터가 있는 곳 | DB 스키마 |
|---|---|---|
| clinic_brands / clinic_branches | `appdata.py BRANDS`, `data2/branches.csv` | 있음 |
| treatment_categories / products / variants | `CATS`, `FAM`, `xkeys.py` 36개 | 있음 |
| offers (+ offer_conditions) | `clean.csv` 행. 원문 이름, 부가세, 종료일, 출처 URL, 해시 | 있음(중복 방지 `unique(branch_id, source_hash)`) |
| official_packages / items | 이름에 '+'가 있는 상품 | 있음 |
| price_snapshots | `data2/history/*.json(.gz)` | 있음(연 단위 파티션) |
| source_registry / ingestion_jobs | `data2/sources.json`, `data2/raw/*.log.json`, `report.md` | 있음 |
| verification_logs / audit_logs / user_reports | `issues.csv`, `review.csv`, 기기의 `pc:reports` | 있음(쓰는 화면은 관리자 인증 뒤) |
| users / carts / cart_items / saved_packages / price_alerts | 기기 localStorage | `supabase/schema.sql`(RLS, 격리 테스트 `tests/db/rls_test.sql`) |
