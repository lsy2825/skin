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
                 app/domain/pricing.js ── 가격 계산 도메인 로직(UI와 분리, tests/pricing.test.js)
                                          ▲
                 app/auth.js + supabase/schema.sql ── 구글·카카오 로그인, 내정보 동기화 (키 비어 있어 꺼짐)
```

| 영역 | 기술 | 위치 |
|---|---|---|
| 수집 | Python 3.12, requests, BeautifulSoup | `scrape/` (블리비·쁨·톡스앤필·리엔장, 포에버는 일시 중지) |
| 정리·정규화 | Python | `build2/clean.py`, `xkeys.py`, `groups.py` |
| 배포·스케줄 | GitHub Actions, GitHub Pages | `.github/workflows/weekly.yml` |
| 프런트 | 바닐라 JS(약 1,200줄), Leaflet(OSM), 나눔스퀘어라운드 | `app/` |
| 사용자 데이터 | 기기 localStorage. Supabase(Postgres+Auth)는 준비만 | `app/auth.js`, `supabase/schema.sql` |

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
- 단위당 가격(100샷당 등)은 기본 정렬에 쓰지 않아요(요구사항 3.2). 아직 표시 기능도 없어요.

**D4. 데이터 무결성 우선.**
- 가격 그래프와 변동은 실제 주간 스냅샷만 써요. 빈 주를 채우지 않아요.
- 할인율은 병원이 직접 적은 정가가 있을 때만 보여요. 정가가 판매가보다 낮거나 10배를 넘으면 정가를 지워요.
- 가짜 데이터는 테스트에서만 써요. 앱 데이터에는 없어요.
- 새 수집 결과가 30% 넘게 줄거나 빌드가 실패하면 지난 자료로 배포해요.

**D5. 수집 정책.**
공개 페이지만 읽어요. 요청 간격은 0.7~1초, 동시 4개, 재시도 3회예요. 로그인·CAPTCHA·차단 우회는 하지 않아요.
robots.txt와 이용약관 확인을 기록하는 Source Policy Registry는 아직 없어요(백로그 P0).

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

## 3. 프런트 구조 (app/app.js)
- 해시 라우터: `#home #map #compare #rank #versus #cart #me #branch/<i> #search/<q> #import/<data>`
- 데이터 인덱스: `byB`(지점→행), `byKB`(비교 키→지점→행), `byG`(자동 묶음→행), `byName`(이름→행)
- 해시 라우트 추가: `#change #table #about`
- 도메인 로직: 장바구니 계산은 `app/domain/pricing.js`(`lineCost`, `compareClinics`)로 분리했어요. 묶음 통계(`gstat`, `rowPos`)와 지점 순위는 아직 `app.js` 안에 있어요(다음 분리 대상).

## 4. 앞으로 넓힐 데이터 모델 (요구사항 §8 대응, 아직 구현 안 함)
Supabase(Postgres)로 옮길 때의 대응표예요. 금액은 모두 정수 KRW로 저장해요.

| 테이블 | 지금 어디에 있나 |
|---|---|
| clinic_brands / clinic_branches | `appdata.py BRANDS` / `data2/branches.csv` (주소·좌표) |
| treatment_categories / products / variants | `CATS` / `xkeys.py` 키·`FAM` / 자동 묶음 |
| offers (+ offer_conditions) | `clean.csv` 행. 조건은 `kind`·`tags`·`until`·`sess`, VAT는 아직 구조화 안 됨 |
| price_snapshots | `data2/history/*.json(.gz)`. 키×지점별 일반가 최저와 자동 묶음 |
| source_registry / ingestion_jobs | `scrape/*.py` 머리말과 `data2/raw/*.log.json`, `report.md` |
| verification_logs / audit_logs | `issues.csv`(자동 정리 사유)만 있음 |
| users / carts / cart_items / saved_packages | 기기 localStorage(`pc:carts`), `supabase/schema.sql`엔 profiles·records만 |
| price_alerts | 없음 |
