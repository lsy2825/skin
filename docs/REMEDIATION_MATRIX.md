# 2차 검토 조치표 (REMEDIATION_MATRIX)

기준 커밋 `da6f1ee`(검토 패키지와 같은 소스, `evidence/reproduce.mjs` 14개 관찰이 모두 재현됨) → 최종 커밋은 `VERSION.txt` 참조. 작성 2026-10-14.

**구현 상태**와 **검증 상태**를 따로 적어요. 검증 수준: `단위`(순수 함수) · `DB`(로컬 PostgreSQL 16 실제 실행) · `브라우저`(Chromium e2e, 실기기 아님) · `모의`(가짜 결제사·AI) · `미검증`. 외부 샌드박스·실기기·사용자 관찰은 **하나도 하지 못했어요.**

## R — 코드 결함

| ID | 구현 | 검증 | 코드 | 시험 | 남은 것 / 다음 조치 |
|---|---|---|---|---|---|
| R01 계정 전환 시 데이터 섞임 | 해결 | 브라우저(가짜 로그인 모듈) | `app/app.js` store 공간 분리·`onAccount`·`syncFromAccount`·`offerAnonImport`, `app/auth.js` `as(uid)` | `tests/e2e/accounts_r2.js` 14/14 | 실제 Supabase 로그인·다중 탭 실시험(키 없음 → 미검증) |
| R02 죠미가 규격 무시 | 해결 | 단위(실데이터) | `app/domain/jomiqa.js` `spec/fits/facts` | `tests/round2.test.js` R02 | 문맥 질문('그럼 4cc는?')은 앞 질문을 잇지 않음 — 설계만 |
| R03 중간값 불일치 | 해결 | 단위·DB | `app/domain/stats.js` `median`(유일), pricectx·premium·intel·match·jomiqa·push·app.js | round2 R03(국산 필러 1cc 110곳 = 74,500원) | — |
| R04 0번 행 최저가 | 해결 | 단위 | `pricectx.js` `best === null` | round2 R04 | — |
| R05 쓸모없는 결과 차감 | 해결 | 단위·DB·모의 | `premium.js usable()` 종류별, 미리보기 정책 `docs/PREMIUM_RESULT_POLICY.md`, `commerce.js` | round2 R05, server api | 실결제 환경 미검증 |
| R06 환불 누락 복구·부분 취소 선도착 | 해결 | DB·모의(가짜 토스) | `flow.mjs applyTossState/reconcile`, `commerce_recheck_payments` | server round2 R06 ×2 | 실제 토스 샌드박스 미검증(키 없음) |
| R07 거래 이력 계정 탈퇴·보관 기한 | 해결(보존 기간은 미정) | DB | `commerce_close_account`, `delete_me`, `commerce_purge_expired_reports`, 읽기 함수 `retain_until` | server round2 R07 ×2 | 거래 기록 보존 기간(법률) · GoTrue 로그인 차단 연결 |
| R08 AI 비용 상한이 엄격하지 않음 | 해결 | DB·모의 | `commerce_ai_reserve/settle`, `openai.mjs`, `ai/jomi.mjs`, AI 기본 꺼짐 | server round2 R08 | 실제 OpenAI 단가·호출 미검증 |
| R09 캐시 표시가 네트워크 대기 | 해결 | 단위(VM)·브라우저 측정 | `app.js loadData/fetchMeta`(8초 제한) | round2 R09, `tests/perf/compare_r2.js` 'stalled' | 실기기 미검증 |
| R10 타임아웃이 본문을 보호 못 함 | 해결 | 단위·모의 | `http.mjs fetchT/readCapped/readJson`, `safe.mjs` | server round2 R10 | — |
| R11 Workers DNS·CSP | 부분 | 모의 | `safe.mjs resolvesPublic`(DoH 대체), `tools/check_csp.js` | server round2 R11, round2 R11 | **실제 Workers 배포 미검증**, 토스 SDK 출처 목록은 문서 기준(확인 필요) |
| R12 스토어 계정 귀속·소비·환불 순회 | 부분(서버) | DB·모의 | `store.mjs accountRef/verify…/consume/voided`, `commerce_store_queue` | server api(Apple/Google) | 네이티브 앱 없음 → 실제 스토어 샌드박스 미검증 |
| R13 스냅샷을 주로 표시 | 해결 | 단위 | `Stats.observations/obsLabel`, `premium.historyGate`, 화면 '지난주'→'지난 수집' | round2 R13 | 수집일과 재빌드일 구분은 빌드 쪽 후속 |
| R14 1회 특가 반복 계산 | 해결 | 단위·브라우저(기존 e2e) | `pricing.js lineCost`(incomplete), `app.js okL/incTxt`, 고급 계획은 판매 중지(무료·유료 입력 불일치 해소) | round2 R14, pricing.test | '1인 1회/반복/미확인' 구조화는 데이터에 조건 문구가 있을 때만 |
| R15 쓸모없는 후속 질문이 횟수 소모 | 해결 | DB | `jobs.mjs ask`, `commerce_jomi_turn`(turn_key·release) | server round2 R15, api | — |
| R16 저장 동시성·멱등성 | 해결 | DB | `save_cart` RPC(버전), 보고서 `expected_version`, 주문·예약 같은 키 처리, 환불 미리보기 누적 계산 | server round2 D1/R16 ×4 | — |

## O — 최적화 (측정: `docs/PERFORMANCE.md`)

| ID | 구현 | 검증 | 비고 |
|---|---|---|---|
| O1 캐시 선표시 + 메타 제한 시간 | 해결 | 브라우저 측정 5회 | R09와 같음 |
| O2 홈 요약 데이터 분리 | 미해결(보류) | — | 측정상 첫 방문 시간의 대부분은 781KB 전송. 분리하려면 빌드·동기화·체크섬 구조를 바꿔야 해 이번 묶음에서 제외. 다음 단계 1순위 |
| O3 검색 색인 사전 생성 / Worker | 미해결(측정만) | 브라우저 측정 | 첫 검색 시간·long task를 전후로 기록. 개선 구현은 다음 단계 |
| O4 지도·프리미엄 지연 로딩 | 해결 | 브라우저(기존 지도 e2e) | Leaflet을 지도 화면에서만 받음. 프리미엄 스크립트는 5.1에서 이미 지연 |
| O5 SW 캐시 정책 | 해결 | 미검증(실기기) | 설치 목록 축소(지연 자산 제외), 자기 캐시(pc-v*)만 정리, 다른 출처 응답 캐시 안 함 |
| O6 app.js 분리·공용 정책 통합 | 부분 | 단위 | 공용 통계·가격 규칙 통합(Stats.median, Pricing). 화면별 파일 분리는 미착수 |
| O7 유료 축소·AI 기본 비활성·예산 예약 | 해결 | DB | BIZ01·R08 |

## UX

| ID | 구현 | 검증 | 비고 |
|---|---|---|---|
| UX01 첫 화면 약속·진입 | 해결 | 브라우저(회귀, 전후 화면 `docs/UX_EVIDENCE.md`) | "같은 용량·횟수끼리 비교" + 수집 범위 줄 + 운영 원칙 화면. **사용자 관찰 미실시** |
| UX02 가격 카드·비교 규칙 | 부분 | 브라우저 | 비교 화면은 가격 요약을 먼저. 표본 편중 시 분포 배지 숨김은 미구현 |
| UX03 장바구니 역할 | 해결 | 브라우저 | '비교용 예상 합계', 가격 없는 회차 분리 |
| UX04 실패 상태·접근성 | 부분 | 브라우저(axe) | 오류 경계·없는 지점·검색 안내 추가. **실기기 접근성 미검증** |
| UX05 죠미·의료 정보 | 부분 | 단위·e2e | 엔진·고정 안전 문장·규격 정확성. 비의학 대사 2,011개(`jomi_lines.json`, 규칙 시험), 이어 묻기, 평가 세트 100/100(질문이 묶음 이름 기반이라 쉬움). 의학 문장은 늘리지 않음 |

## DATA · BIZ · LEG

| ID | 구현 | 검증 | 비고 |
|---|---|---|---|
| DATA01 심평원 적합성 | 미해결 | — | 키 없음. 질의·최소 검증 절차만(`docs/DATA_AND_LEGAL.md` §2) |
| DATA02 원천 근거·삭제 창구 | 부분 | — | 원천표 작성, 수집기 이름 공개. 약관 확인일·운영자 연락처는 사람이 할 일 |
| DATA03 품질 지표·되돌리기 | 부분 | 실측 | 분류율 68.7% 등 실측. 중복 874·넓은 폭 110의 원인별 분류는 미착수 |
| BIZ01 유료 도구 정리 | 해결 | DB·단위·브라우저 | 3개 판매, 나머지 무료화/보류 — `docs/PRODUCT_DECISIONS.md` |
| BIZ02 비용 모델 | 부분 | — | 가정 계산만(실측 전환율 없음). 스토어 수수료에 웹 PG 3.3%를 쓰지 않음 |
| BIZ03 병원 B2B | 비해당(이번) | — | 주인 결정 전 만들지 않음 |
| LEG01~04 | 질문 작성 | — | 법률 검토 전. 결론 없음 |

## STORE01~18

`docs/STORE_READINESS.md` 표 참조. 요약: STORE05·07은 서버 쪽 부분 해결, 나머지는 네이티브 프로젝트가 없어 미해결.

## D — 1차 냉정 분석 보고서에서 내가 찾은 결함

| ID | 구현 | 검증 | 비고 |
|---|---|---|---|
| D1 같은 키 동시 요청 500 | 해결 | DB | 20동시 → 오류 0 |
| D2 서버 콜드 스타트(Workers CPU·메모리) | 미해결 | 측정만 | 유료 요금제 필요(무료 10ms). 서버용 요약 파일은 O2와 함께 후속 |
| D3 데이터 원본 장애 시 503 | 해결 | 단위 | 이전 데이터 계속 사용 |
| D4 요청 제한 저장소 | 해결 | DB | DB 공용 제한 + 메모리 정리 |
| D5 `__proto__` 링크 오류 | 해결 | 단위·브라우저(전: 페이지 오류 1건 → 후: 0) | + 화면 오류 경계 |
| D6 없는 지점 링크 | 해결 | 브라우저(전후 화면 06) | 안내 화면 |
| D7 유료 중간값 불일치 | 해결 | 단위 | R03과 같음 |
| D8 검색 연산자·초성 | 해결 | 단위 | — |

## B — 6.0 앱 화면(채팅 B, 2026-10-15)

검수 보고서 U번호·개선 보고서 E번호 기준. 검증은 `단위`(node --test) · `브라우저`(e2e, 이 저장소의 시험을 잠금 해제 상태로 실행, 실기기 아님).

| ID | 구현 | 검증 | 코드 | 시험 | 남은 것 / 다음 조치 |
|---|---|---|---|---|---|
| U4·U11 할인율·'최저' 표시 | 해결(B1, lsy2825/skin#7) | 단위·브라우저 | `app.js` trendCard·addKeySheet가 `discountEmphasis`·`lowestHighlight`를 따름 | e2e objective | — |
| U13·U20·E8 '2주'·이력 2회 | 해결(B1) | 단위·브라우저 | `Stats.historyReady`(서로 다른 8주), `Stats.obsLabel` | stats.test, e2e audit40 B7 | 기준 바뀐 날 이전 기록 빼기는 데이터(C) |
| U7·U14·E11 개발 문구·브랜드 수 | 해결(B1) | 브라우저 | `vatBrandsNote`·`liveBrands`(데이터에서 셈) | — | `meta.about.sources`가 5개 브랜드라 화면은 지점이 있는 브랜드로 대신(C에 부탁) |
| U8 빨간 '초안' 배지 | 해결(B1) | 브라우저 | `reviewBadge`·`kbFoot` | e2e concern | — |
| U5·E1 '병원 설명' | 해결(B1) | 브라우저 | guideBox·사전·죠미 답·목록에서 `f.desc` 안 보임 | — | 판촉 문구 거름 사전은 데이터(C) |
| U6·U10·E5·E6 부가세 미확인·추가 옵션 | 해결(B1·B9) | 단위·브라우저 | `cmpOk`·`cmpRk`, `addonOf`(빌드의 추가 옵션 칸 r[15]→r[19], C2; 그 칸이 없는 예전 파일만 `Classify.isAddon` 이름 규칙) | classify.test, e2e addon_col | 닥터에버스·셀린 부가세 조사는 데이터(C2) |
| E4·E10·U18·E12 중복 줄·빈 검색 요약 | 해결(B1) | 단위·브라우저 | `Search.uniqueRows` | search.test | 규격 이름 대소문자·부위 이름(E2·E3)은 데이터(C1) |
| 크레딧 화면 제거 | 해결(B2, lsy2825/skin#8) | 단위·브라우저 | `commerce.js` 삭제, 마이 메뉴·문구 | e2e devices51·a11y 갱신 | domain 5개 파일은 A3 뒤, demowallet·economics는 A6 뒤 삭제 |
| U1·U3·U17·E7 비교 화면 한 기준·길이·아래 막대 | 해결(B3) | 브라우저 | `cmpHead`·`rangeBar`·`cmpMoreSheet`, 목록 10곳+모두 보기, 접기 | e2e objective·compare_cards·pricenow·demo_features | '가격과 함께 꼭 확인하세요' 접기는 정책 문서 결정 필요, 13px 미만 글자(배지) 정리 |
| U11·6.0 이탈 대책 '내 견적'·한 번에 담기·첫 화면 가격 | 해결(B4, lsy2825/skin#12) | 브라우저 | `quickAdd`, 홈 `coverageLine`·ⓘ, 이름 '장바구니' → '내 견적'(사용자 결정) | e2e first_screens(새), jomi | `tests/run_regression.sh`에 first_screens 넣기(A) |
| 13px 미만 글자 | 해결(B3.5, lsy2825/skin#13) | 브라우저 | `styles.css` 61곳·인라인 2곳 → 13px(배지 등 4곳은 그대로) | 320px 넘침 36/292(main 41/292) | — |
| 6.0 약속 2 단계별 익명 집계 | 만듦·꺼짐(B5) | 단위·브라우저 | `domain/metrics.js`, `config.js` `metrics`·`metricsApi`, `check_csp.js` | metrics.test, e2e metrics(꺼짐 0건·켜짐 단계별 1번) | 켜기: A4 주소 + C 처리방침 + 사용자 승인. `run_regression.sh`에 metrics 넣기(A) |
| 6.0 약속 1 푸시 구독 화면·sw.js | 만듦·꺼짐(B6) | 단위·브라우저 | `domain/push.js`, 관심 탭 `.nfp`, `sw.js` push·notificationclick, `config.js` `alertsApi`·`pushPublicKey` | push.test, sw.test, e2e push(꺼짐 0건·켜짐 POST/PUT/DELETE) | 켜기: A5 주소·공개키 + C 처리방침. 실기기 푸시 확인. `run_regression.sh`에 push 넣기(A) |
| 6.0 약속 6 처리방침 화면 문구 | 해결(lsy2825/skin#40), 꺼진 동안 안 보임 | 단위·브라우저 | 설정 집계 칸·푸시 켜짐 줄·알림 설명을 C6 §4 확정 문장으로 | e2e push·metrics·clickable | 죠미 도움말·대사는 푸시를 켤 때. '오전 8시~오후 9시'는 C 문서에서 아직 ⏳ |
| A 메모: 가격 알림 시트 최저가 기준 | 해결(#41) | 브라우저 | `alertSheet`가 `addAlert`와 같은 지역·특가로 읽음 | e2e alert_region(새) | watch '오른 경우' 규칙이 정해지면 문구(A5) |
| '정보' 화면 Crawl-delay 문장 | 해결(#44) | 단위·브라우저 | `views.about` 리엔장 줄 문장 삭제(코드와 다름) | e2e clickable·ux_qa | 새 문장은 C(#45 뒤), 등록부 `rate` 글자 3~5곳 불일치도 C |

## C — 6.0 데이터(채팅 C, 2026-10-15)

개선 보고서 E번호 기준. 검증은 `단위`(labels_test·taxonomy·xkeys) · `빌드 비교`(같은 저장 자료로 `weekly.py --skip-scrape` 전후, 따로 떼어 둔 작업 트리) · `검증 에이전트`(관점마다 찾기 1 + 반박 2, 8차까지).

| ID | 구현 | 검증 | 코드 | 시험 | 남은 것 / 다음 조치 |
|---|---|---|---|---|---|
| E1 '병원 설명' 판촉 문구 | 해결(C1) | 단위·빌드 비교 | `labels.desc_problems`·`DESC_PROMO`, `taxonomy.build` 설명 세기(철자 묶음·지점 2곳 이상, 제모는 장비 이름만인 설명 뺌) | labels_test | 화면 숨김은 B1 그대로 |
| E2·E10 대소문자·띄어쓰기·괄호 위치만 다른 규격 | 해결(C1) | 단위·빌드 비교 | `taxonomy.loose_sig`, 시술군 철자 통일, 사라진 id는 `meta.keymap` | labels_test | 괄호 속 '+' 띄어쓰기로 묶음·단품이 갈리는 것(블리비 듀얼토닝)은 main부터 있던 규칙 — 후속 |
| E3 부위·크기만 남은 이름, 추가·조건부 가격 | 해결(C1) | 단위·빌드 비교 | `labels.problems` '부위만' + `product_head`, `xkeys.addon_only`, `COND` | labels_test | — |
| E3 제모 성별·부위·장비 | 해결(C1) | 단위·빌드 비교·검증 에이전트 | `taxonomy._area`·`_area_parts`·`AREA_SPELL`·`hair_area`·`_segs`, `clean.py` 페이지 성별 | labels_test | 닥터에버스 월간 제모 페이지의 여성·남성 칸 제목을 수집기가 못 남김 → 두 메뉴 페이지의 성별 없는 제모 줄은 비교 묶음에서 뺌(가격표엔 남음). 수집기 고치기는 후속 |
| E4 같은 가격 두 줄 | 해결(C1) | 단위·빌드 비교 | `clean.py` 합치기(이름·판매가, 가격표 줄 우선, 조건 교집합) | labels_test | — |
| 가격 변동 목록 가짜 항목 | 해결(C1) | 단위·빌드 비교 | `datameta.changes`, `appdata.reclassified`·`group_moved`·되살아난 id·`key_map` 성별·횟수 | labels_test | — |
| E5 추가 옵션 칸 | 해결(C2, lsy2825/skin#51) | 단위·빌드 비교 | `xkeys.addon_only`, data.json 16번째 칸 `addon` | labels_test | 앱은 r[15]을 실행 중 칸으로 씀 → B가 먼저 옮김 |
| E6 부가세 미확인 | 해결(C2, lsy2825/skin#51 — 미확인 23,408 → 3,314줄) | 단위·빌드 비교 | `data2/vat_policy.json` 닥터에버스·셀린, `clean.vat_of` | labels_test | 확인 못 한 지점(닥터에버스 4·셀린 2)은 미확인 |
| E8·E9 변동 기록(기준 바뀐 날·처음 모은 체인) | E9 해결(C3 lsy2825/skin#53), E8은 main의 `trend` since·`meta.recl`(규칙이 바꾼 키를 최근 12번까지 기억 — 그 이상은 시험 없음) | 단위·빌드 비교 | `appdata.brand_first`·`meta.brandFirst`, `datameta.changes` `new_chains` | labels_test | 앱 안내 문구는 B |
| 수집 예절 | 해결(lsy2825/skin#45, 3차 lsy2825/skin#63) | 단위(가짜 시계·스레드) | `scrape/common.py` Fetcher(robots)·호스트 시계·스레드 차례·429 뒤 그 호스트 멈춤, `weekly.gate`, 등록부 `rate` 글자 | `tests/crawl_manners_cases.py`(brand_parsers_test가 돌림, 체인별 속도 표 대조) | 이름표 연락처는 앱 주소로 먼저(사용자 2026-10-16), 정해지면 `BOT_INFO_URL`. 경로별 확인 밖 요청(쁨 지점 찾기·셀린 POST·톡스앤필 목록) |
| C1 다음: 시간·요일 한정 가격, 영국산 톡신 | 해결(lsy2825/skin#55) | 단위·빌드 비교 | `clean.TAGS` '평일 낮'(해피아워·화수목·평일 한정·N시~M시), `taxonomy.ORIGIN`·`xkeys` `(?<![미외영])국산` | labels_test | 앱은 '평일 낮'을 월~금으로 읽음(요일이 묶음 제목에만 있는 501줄) — 요일 칸은 B가 원하면 C가 더함 |
| C7 규격 낱말 한 줄 설명 | 해결(lsy2825/skin#52, 의료진 검수 전) | 단위·빌드 | `knowledge/specs.json` 177개, `knowledge.SPEC_BAN`, `appdata.spec_keys` → `meta.kb.specs[].keys` | labels_test, `build2/knowledge.py` | 화면에 붙이는 것은 B('의료진 검수 전' 표시), 검수는 사람 |
| C8 가격 줄 번호 | 해결(lsy2825/skin#54 — 계산만, data.json에 안 실음) | 단위·두 구현 대조(Node, 142,580줄) | `build2/rowid.py` | labels_test(예시 72줄, 틀린 구현 11가지) | 같은 페이지·같은 정가 줄은 판매가가 엇갈리면 맞바뀜(642줄) — `~N`은 저장 열쇠로 쓰지 않음, 앱 구현은 B |

## 회귀 결과(2026-10-14)

전체 회귀 34/34 묶음 통과(단위 93, 서버 41, DB 보안·백업 복원, e2e 24개). 첫 실행에서 실패한 7개 중 2개는 앱 결함(비교 화면 '함께 확인할 것' 카드 위치, 죠미를 이미 만난 사람에게 첫 인사) → 앱 수정, 5개는 이번 제품 결정으로 낡은 기대값 → 시험 수정. 고친 내용은 커밋 `0fca15d`·`61e5a53`·`0ccd594`.

## 6.0 A3 (2026-10-15): 서버·DB 쪽 크레딧 제거로 바뀐 행 — 채팅 A

크레딧·결제·스토어·AI 사진 읽기·프리미엄 작업 서버(`server/src/app·auth·config·db·jobs·safe·worker.mjs`, `ai/`, `payments/`)와
크레딧 장부(`supabase/monetization.sql`)를 지웠다(개발 지시서 A3, 6.0 수익 모델). 그래서 아래 행은 **대상이 없어졌다.**

| ID | 6.0 이후 상태 |
|---|---|
| R06 환불 복구·부분 취소 | 대상 없음(결제 제거) |
| R07 거래 이력·탈퇴 | 거래 장부 없음. 탈퇴는 `supabase/schema.sql`의 `delete_me`(계정 삭제, 연결 기록 함께 삭제)만 남음. DB 보안 시험 통과 |
| R08 AI 비용 상한 | 대상 없음(서버 AI 제거). 무료 죠미 대화는 기기 안 규칙(`app/domain/jomichat.js`)이라 비용 없음 |
| R10 타임아웃이 본문을 보호 못 함 | `server/src/http.mjs`의 `fetchT`/`readCapped`는 남김(푸시 발송이 씀). `safe.mjs`는 제거 |
| R11 Workers DNS·CSP | `safe.mjs` 제거로 서버 쪽 대상 없음. CSP 쪽은 B(`tools/check_csp.js`) |
| R12 스토어 귀속·소비·환불 | 대상 없음(스토어 결제 제거) |
| R15 후속 질문 횟수 소모 | 대상 없음(유료 죠미 제거) |
| D1·D3·D4 동시 요청·데이터 장애·요청 제한 | 대상 서버 없음. 새 Worker(A4 집계·A5 알림)에서 다시 설계 |
| D2 서버 콜드 스타트 | 대상 서버 없음 |

남은 서버 코드는 푸시 조각(`server/src/push.mjs`: 알림 서비스 허용 목록, VAPID 서명, 내용 없는 발송, 조용한 시간, 규칙 판단)과
`http.mjs`다. 시험은 `server/test/push.test.mjs` 5/5. A5에서 `cf/alerts` Worker가 이 조각을 가져다 쓴다.
