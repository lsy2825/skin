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
| UX05 죠미·의료 정보 | 부분 | 단위 | 엔진·고정 안전 문장·규격 정확성. 2,000개 확장은 미착수(47개) |

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

## 회귀 결과(2026-10-14)

전체 회귀 34/34 묶음 통과(단위 93, 서버 41, DB 보안·백업 복원, e2e 24개). 첫 실행에서 실패한 7개 중 2개는 앱 결함(비교 화면 '함께 확인할 것' 카드 위치, 죠미를 이미 만난 사람에게 첫 인사) → 앱 수정, 5개는 이번 제품 결정으로 낡은 기대값 → 시험 수정. 고친 내용은 커밋 `0fca15d`·`61e5a53`·`0ccd594`.
