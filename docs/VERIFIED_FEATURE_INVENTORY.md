# 검증된 기능 목록 (5.1)

기준일 2026-10-14. **'검증'은 이 환경에서 테스트를 실제로 돌려 통과한 것만이에요.** 상태: LIVE(배포된 앱에서 동작, 테스트됨) · DEMO(배포됨, 시연 표시, 돈·서버 없음) · SERVER_TESTED(서버 코드, 로컬 PostgreSQL + 모의 외부 서비스로 테스트, 배포 안 됨) · CONTRACT_ONLY(검증 규칙만, 외부 실물 미검증) · BLOCKED · NOT_BUILT.

## 무료 핵심 (배포됨)

| 기능 | 상태 | 증거 |
|---|---|---|
| 가격 데이터 로딩·오프라인·버전 확인 | LIVE | e2e data_sync 13/13, pricenow 44/44 |
| 검색(별칭·오타·연산자) | LIVE | unit search, qa7, ux_qa |
| 시술 비교·가격 근거·조건 | LIVE | compare_cards, objective, pricing40 |
| 장바구니(한 곳·나눠서·2곳) | LIVE | unit pricing, ux_qa, pricing40 |
| 관심·앱 안 가격 알림 | LIVE(기기 안) | demo_features, v5_features |
| 지도 | LIVE | audit_ui(버튼 전수) |
| 고민으로 찾기(규칙 기반) | LIVE | concern 23/23 |
| 죠미(원본 그림) | LIVE | jomi 39/39 |
| 운영 현황(수집 실행·검토 큐) | LIVE(PIN 뒤, 실제 인증 아님) | ops40 16/16 |
| 접근성 | LIVE | axe 0건(21화면×밝게·어둡게), 터치 영역 4,248/4,248 |

## 5.0 수익화

| 기능 | 상태 | 증거 / 한계 |
|---|---|---|
| 시연 지갑·충전(가격 스냅샷·부가세 표시·광고 없는 기간 연장) | DEMO | e2e commerce50 27/27, unit commerce 5/5 |
| 프리미엄 도구(글·견적·여러 이벤트 읽기, 제품·지역 보고서, 고급 계획, 지켜보기, 죠미 질문) | DEMO | commerce50, 보고서는 모은 가격에서만 계산 |
| 가격 이력 보고서 | BLOCKED(데이터) | 기록 2주 — 4주 전에는 판매 안 함(테스트) |
| AI 사진 읽기 | SERVER_TESTED(모의 OpenAI) / 앱 시연에서 닫힘 | api 7·13. OpenAI 키·비용표 없음 → BLOCKED |
| 크레딧 원장·지갑·예약/차감/반환·환불·광고 없는 기간 | SERVER_TESTED | ledger 10/10, api 15/15(일부 겹침), 백업·복원 일치 |
| 토스 웹 결제(주문·승인·웹훅·대사·취소·중복 결제 취소) | SERVER_TESTED(모의 토스) | api 1~5·13·15. **실제 토스 샌드박스 미검증** |
| Apple 인앱 결제 | CONTRACT_ONLY | 생성한 인증서로 JWS 검증 테스트. 네이티브 앱 없음 |
| Google Play 결제 | CONTRACT_ONLY | 모의 API. 네이티브 앱 없음 |
| 웹 푸시·가격 지켜보기 | SERVER_TESTED(모의 푸시) | api 11. VAPID 키·서버 없음 |
| 관리자 대시보드 | SERVER_TESTED + 앱 화면(모의 API로 확인) | api 14, e2e admin51 10/10 |
| 단위 경제성 | DEMO(가정) / SERVER_TESTED(실측 함수) | 운영 카드 '가정' 표시, commerce_economics |
| 서버 모드 결제·크레딧 화면 | NOT_BUILT(의도적으로 닫음) | e2e admin51 A8 |

## 하드코딩·시연 값 점검

| 값 | 위치 | 판단 |
|---|---|---|
| 묶음 가격·크레딧·기능 크레딧 | `supabase/commerce_seed.sql`(원천) + `app/domain/demowallet.js`(시연 사본) | 시연 사본은 테스트로 시드와 대조. 서버는 DB 카탈로그만 사용 |
| 결제 수수료·AI 비용 | `app/domain/economics.js` | '가정'으로 표시, 실측은 DB |
| 권한(admin) | Supabase `app_metadata.roles` + aal2 | 서버에서 확인. 앱 PIN은 인증이 아님(화면에도 명시) |
| 시연 PIN | 저장소에 없음(테스트는 `APP_PIN` 환경 변수) | 유지 |
| AI 한도 | `config.mjs` 환경 변수(기본 30회·30,000원) | 운영에서 조정 |

## 가짜·모의 구현을 실제처럼 보이게 한 곳 점검

- 시연 지갑: 모든 화면에 '시연 · 실제 돈 아님'. 서버 모드에서는 닫힘(I-06 수정).
- AI 사진 읽기: 시연에서 버튼은 있지만 '가짜 결과를 보여주지 않아요' 안내만(e2e C23).
- 관리자 대시보드: 시연에서는 숫자 없이 안내만(e2e A2).
- 운영 현황의 단위 경제성: '가정' 배지.
- 서버 테스트의 결제사·AI·스토어는 모두 모의 — 문서마다 그렇게 적었어요.
