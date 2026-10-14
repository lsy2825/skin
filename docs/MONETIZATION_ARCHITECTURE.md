# 윤실장 5.0 수익화 구조 (선불 크레딧 · AI 커머스)

기준일 2026-10-14. 이 문서는 5.0 Release A(저장소 점검·구조)의 결과이고, 이후 릴리스에서 실제로 만든 것과 아직 막힌 것을 함께 적어요.

## 1. 원칙

- **선불·비정기만**: 구독·자동 충전 없음. 크레딧 묶음(MINI/STANDARD/PLUS)을 필요할 때 한 번씩 사요.
- **무료 핵심은 그대로**: 검색·가격 비교·장바구니·관심·지도·죠미 기본 기능은 크레딧과 무관하게 계속 무료. 5.0 코드는 이 기능들의 코드 경로를 바꾸지 않아요(e2e `C25`, 기존 회귀 전체로 확인).
- **돈과 잔액은 서버만**: 브라우저는 결제 비밀키·OpenAI 키를 갖지 않고, 크레딧을 만들거나 잔액을 바꾸거나 결제를 승인하거나 작업 성공을 표시할 수 없어요. 모든 잔액 변경은 `supabase/monetization.sql`의 `commerce_*` 함수(서비스 역할만 실행)로만 일어나요.
- **가격을 만들지 않음**: 보고서의 모든 숫자는 병원 사이트에서 모은 가격(`data.json`)에서 계산해요. AI는 사진의 글자를 옮겨 적을 뿐이고, 옮긴 가격은 사진에 적힌 글자를 결정론적 파서로 다시 읽어 같은 숫자일 때만 써요.
- **중립성 유지**: 광고·협찬 없음(`FLAGS.ads=false`), 병원 순위·최저가 강조 플래그 끔 그대로(`lowestHighlight`, `branchRanking`, `discountEmphasis` = false). 유료 보고서도 병원 추천·순위를 만들지 않아요.

## 2. 구성

```
브라우저(PWA, GitHub Pages)                       서버(Cloudflare Workers, server/)                Supabase(PostgreSQL)
 app/commerce.js  ──(Bearer JWT)──▶  src/app.mjs  ──(service role, PostgREST rpc)──▶  commerce_* 함수 + RLS
 app/domain/*.js (공용: 파서·매칭·보고서·        src/payments/{toss,flow,store}.mjs ──▶ 토스페이먼츠 / Apple / Google
   죠미 안전장치·시연 지갑·경제성)                src/ai/{openai,jomi}.mjs ─────────▶ OpenAI Responses API
                                                  src/push.mjs ─────────────────────▶ Web Push 서비스
                                                  Cron: 결제 대사·멈춘 작업 해제·가격 지켜보기
```

- 공용 도메인 모듈(UMD, 앱·서버·테스트가 같은 코드 사용): `offerparse.js`(글→가격 항목), `match.js`(같은 비교 묶음 찾기), `pricectx.js`(가격 맥락), `premium.js`(보고서), `jomiqa.js`(죠미 안전장치), `demowallet.js`(시연 지갑), `economics.js`(단위 경제성).
- 환경: `DEMO`(시연 지갑, 서버 없음) / `SANDBOX`(토스 test_ 키만) / `PRODUCTION`(live_ 키 + 주인 승인 `LIVE_PAYMENTS_APPROVED`). `server/src/config.mjs`가 잘못된 조합이면 시작을 거부해요.
- 지금 배포된 앱은 **DEMO**예요(`app/config.js commerce.apiBase = ""`). 서버는 저장소에만 있고 아직 어디에도 배포되지 않았어요.

## 3. 저장소 점검 결과 (Release A)

| 영역 | 5.0 전 상태 | 분류 | 5.0에서 한 일 / 남은 일 |
|---|---|---|---|
| 가격 데이터·검색·비교·장바구니·지도·관심·죠미 | 4.0까지 구현·테스트 | ALREADY_IMPLEMENTED_AND_TESTED | 손대지 않음(회귀로 확인) |
| 인증(Supabase Auth, 카카오·Google) | 코드 있음, 키 없음(꺼짐) | REQUIRES_PROVIDER_CONFIGURATION | 서버가 JWT(HS256/JWKS) 검증 |
| 앱 내 가격 알림(관심) | 구현·테스트(기기 안) | ALREADY_IMPLEMENTED_AND_TESTED | 서버 푸시는 새로 |
| 크레딧 상품 카탈로그(버전) | 없음 | NEW_IMPLEMENTATION | `credit_products`(버전 행, 승인 없이는 실채널 활성 불가) |
| 크레딧 원장 | 없음 | NEW_IMPLEMENTATION | 추가 전용 원장 + 지갑 투영, PostgreSQL 테스트 10개 |
| 웹 결제(토스) | 없음 | NEW_IMPLEMENTATION + REQUIRES_PROVIDER_CONFIGURATION | 어댑터·승인·웹훅·대사·환불, 모의 토스로 테스트. 실제 샌드박스 미검증 |
| Apple IAP / Google Play | 없음, 네이티브 앱 없음 | REQUIRES_PROVIDER_CONFIGURATION / BLOCKED | 검증 계약 코드 + 모의 테스트만 |
| AI 사진 읽기 | 없음 | NEW_IMPLEMENTATION + REQUIRES_PROVIDER_CONFIGURATION | Responses API 어댑터, 모의 테스트. 키 없음 |
| 이벤트 글·견적 읽기, 매칭 | 없음 | NEW_IMPLEMENTATION | 결정론 파서·매처, 시연에서 동작 |
| 보고서·고급 계획 | 무료 장바구니 엔진만 | NEW_IMPLEMENTATION | 같은 엔진 위에 보고서. 가격 이력 보고서는 데이터 2주뿐이라 판매 안 함 |
| 광고 없는 기간 | 광고 자체가 없음 | NEW_IMPLEMENTATION | 권리만 관리(광고를 붙이지 않음) |
| 비용 회계·단위 경제성 | 없음 | NEW_IMPLEMENTATION | 모델 비용표·사용 기록·서비스 비용·`commerce_economics`, 운영 화면 '가정' 카드 |
| 이용약관·환불 정책·결제 고지 | 없음 | REQUIRES_LEGAL_REVIEW | 초안 문구만(앱에 '초안' 표시) |

## 4. 데이터 흐름 요약

- **구매(웹)**: 앱 → `POST /v1/orders`(서버가 카탈로그에서 가격 스냅샷) → 토스 결제창 → 성공 리다이렉트 → `POST /v1/checkout/toss/confirm` → 서버가 주문 소유자·금액 확인 후 토스 승인 API 호출 → `commerce_fulfill_payment`(주문당 한 번만 지급). 웹훅·대사 작업은 토스 API로 다시 읽은 상태만 믿어요. 자세히: `WEB_CHECKOUT_INTEGRATION.md`.
- **프리미엄 작업**: 앱 → `POST /v1/jobs`(기능 코드·입력·요청 키) → 무료 사전 점검(데이터 부족이면 차감 없이 거절) → `commerce_reserve` → 실행 → 쓸 수 있는 결과면 `commerce_capture`(보고서 저장) / 아니면 `commerce_release`. 멈춘 작업은 Cron이 `commerce_expire_jobs`로 돌려줘요. 자세히: `CREDIT_LEDGER_SPEC.md`.
- **다시 열기·고치기·죠미 후속 질문**: 무료(`commerce_report`, `commerce_update_report`).

## 5. 시연(DEMO) 범위

`app/commerce.js` + `app/domain/demowallet.js`: 같은 규칙(가격 스냅샷, 보너스 먼저, 예약→차감/반환, 요청 키당 한 번, 이용권 기간, 광고 없는 기간 이어 붙이기)을 이 기기 안에서만 흉내 내요. 화면마다 '시연 · 실제 돈 아님'을 표시하고, 시연 크레딧은 결제된 크레딧이 아니에요. SANDBOX/PRODUCTION에서는 이 코드를 쓰지 않아요.

## 6. 완료 수준 (정직한 현재 상태)

| 릴리스 | 내용 | 수준 |
|---|---|---|
| A | 점검·구조·카탈로그 버전·경제성 가정 | DEMO_READY (문서·코드) |
| B | 원장·지갑·상점·시연 결제·광고 없는 기간 | DEMO_READY(앱) · 서버 원장 PostgreSQL 테스트 통과 · SANDBOX 배포 없음 → BLOCKED_EXTERNAL_DEPENDENCY |
| C | AI 사진 읽기 | 모의 테스트 통과 · OpenAI 키·모델 비용표 없음 → BLOCKED_EXTERNAL_DEPENDENCY |
| D | 글·견적 읽기, 매칭, 보고서, 계획, 공유 요약 | DEMO_READY |
| E | 토스 샌드박스 | 모의 계약 테스트 통과 · 토스 테스트 키·서버 배포 없음 → BLOCKED_EXTERNAL_DEPENDENCY |
| F | 가격 지켜보기·푸시·비용 분석 | 서버 모의 테스트 통과 · VAPID 키·서버 없음 → BLOCKED_EXTERNAL_DEPENDENCY |
| G | 네이티브 스토어 준비 | 계약 코드·모의 테스트만 · 네이티브 앱 없음 → BLOCKED_EXTERNAL_DEPENDENCY |
| H | 운영 출시 준비 | NEEDS_LEGAL_REVIEW · 주인 승인 없음 → PRODUCTION_READY 아님 |

PRODUCTION_READY라고 주장하지 않아요. 조건은 `PRODUCTION_LAUNCH_CHECKLIST.md`.
