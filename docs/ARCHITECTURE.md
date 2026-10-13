# 아키텍처와 설계 결정

피부과·미용의료 시술 가격비교 플랫폼. 이 문서는 **지금 실제로 돌아가는 구조**와 그렇게 정한 이유,
그리고 마스터 요구사항(2026-10-13)에 맞춰 앞으로 넓혀 갈 방향을 적어요. 진행 상태는 `docs/IMPLEMENTATION_STATUS.md`.

## 1. 지금 구조 (2026-10-13)

```
병원 공개 페이지 ──(scrape/*.py, 주 1회)──▶ data2/raw/<brand>.csv  (원본 보존: 이름·가격·정가·유효기간·URL·수집시각)
                                          │  build2/weekly.py: 브랜드별 행·지점이 30% 넘게 줄면 지난 자료 유지
                                          ▼
                          build2/clean.py ─▶ data2/clean.csv + data2/issues.csv (제외·정가 삭제 사유 기록)
                                          │  build2/xkeys.py   브랜드 간 같은 시술 36개(수작업 규칙, 테스트 90개)
                                          │  build2/groups.py  같은 옵션 자동 묶음(3곳 이상) 3,210개, 지점 가격 수준
                                          ▼
                        build2/appdata.py ─▶ app/data.json (앱이 읽는 압축 JSON) + data2/history/<date>.json(.auto.json.gz)
                                          ▼
GitHub Actions(weekly.yml) ── 월 06:00 KST 수집 → 커밋 → GitHub Pages 배포 / app·build2 변경 push 시 수집 없이 재배포
                                          ▼
                 app/ (정적 PWA, 프레임워크 없음) ── 휴대폰 홈 화면 앱, 오프라인 캐시(sw.js), 비밀번호 화면(gate.js)
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

**D7. 법적으로 민감한 기능은 꺼 둔다.**
로그인과 회원정보는 `config.js`가 비면 꺼져요(feature flag). 예약·결제·광고·수수료 기능은 만들지 않아요.
시술 기록은 민감정보일 수 있어서, 켜기 전에 동의와 처리방침이 필요해요.

## 3. 프런트 구조 (app/app.js)
- 해시 라우터: `#home #map #compare #rank #versus #cart #me #branch/<i> #search/<q> #import/<data>`
- 데이터 인덱스: `byB`(지점→행), `byKB`(비교 키→지점→행), `byG`(자동 묶음→행), `byName`(이름→행)
- 도메인 로직: 장바구니 계산(`lineAt`, `cartTotals`, `mixTotals`)과 묶음 통계(`gstat`, `rowPos`)가 아직 UI 파일 안에 있어요.
  요구사항 4.3에 따라 `app/domain/`으로 분리하고 단위 테스트를 붙일 예정이에요(백로그 P1).

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
