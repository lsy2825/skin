# 웹 결제 연동 (토스페이먼츠, WEB_PG)

상태: 서버 쪽 흐름은 구현하고 **모의 토스**로 테스트했어요(`server/test/api.test.mjs` 1~5번). 실제 토스 샌드박스(test_ 키)로는 아직 결제해 보지 않았어요 → BLOCKED_EXTERNAL_DEPENDENCY(토스 계약·테스트 키, 서버 배포).

## 1. 공식 API (docs.tosspayments.com, 2026-10-14 확인)

- 승인: `POST https://api.tosspayments.com/v1/payments/confirm` 본문 `{paymentKey, orderId, amount}`, 인증 `Basic base64(시크릿키 + ':')`, `Idempotency-Key` 헤더 지원.
- 조회: `GET /v1/payments/{paymentKey}`, `GET /v1/payments/orders/{orderId}`.
- 취소: `POST /v1/payments/{paymentKey}/cancel` 본문 `{cancelReason, cancelAmount?}`.
- 웹훅: `PAYMENT_STATUS_CHANGED` 등. 10초 안에 200을 받아야 하고, 실패하면 최대 7번 재전송(1·4·16·64·256·1024·4096분). 결제 상태 웹훅에는 서명이 없어서 **서버가 시크릿키로 결제를 다시 조회**해요.
- 결제창(브라우저) SDK 호출 형태는 이 저장소에서 아직 쓰지 않았어요. 연결할 때 공식 문서의 최신 SDK 사용법을 다시 확인해야 해요(확인 전에는 단정하지 않아요).

## 2. 흐름 (server/src/payments/flow.mjs)

1. **주문 만들기** `POST /v1/orders {product_code, channel:"WEB_PG", idempotency_key}` — 서버가 활성 카탈로그 행에서 가격·크레딧·광고 없는 일수를 복사(스냅샷). 클라이언트가 보낸 금액·크레딧 필드는 무시. 같은 요청 키 → 같은 주문, 같은 키로 다른 상품 → 거절.
2. **결제창**: 응답의 `order_id`, `amount`, `order_name`으로 토스 결제창을 열어요(금액은 서버 값).
3. **성공 리다이렉트** → `POST /v1/checkout/toss/confirm {paymentKey, orderId, amount}`:
   - 주문이 이 사용자 것인지(아니면 '없는 주문'과 같은 404), 채널이 WEB_PG인지, **금액이 주문 스냅샷과 같은지 토스 호출 전에** 확인.
   - 토스 승인 API 호출(Idempotency-Key `confirm-<orderId>`). 이미 처리됨(ALREADY_PROCESSED_PAYMENT)이면 조회로 대신.
   - `commerce_fulfill_payment`: 주문 잠금 → 채널·금액·통화·DONE 확인 → 결제 행 → 크레딧(멱등 키 `grant:<order>`) → 광고 없는 기간 연장 → 주문 FULFILLED. 같은 결제 재호출은 `already: true`.
4. **웹훅** `POST /v1/webhooks/toss`: 이벤트 기록(중복 키) → `paymentKey`로 토스 재조회 → 상태별 처리(DONE 지급 / CANCELED·PARTIAL_CANCELED 환불 기록 / ABORTED·EXPIRED 주문 닫기). 일시 오류는 5xx로 돌려 토스가 다시 보내게 해요.
5. **대사(Cron 10분)**: 10분 넘게 열린 주문을 토스에 주문번호로 물어 보고 같은 처리. 결제 기록이 없고 1시간 지난 주문은 EXPIRED. 결과는 `payment_reconciliation_jobs`.
6. **중복 결제**: 이미 지급된 주문에 다른 결제가 오면 지급하지 않고 그 결제를 자동 취소해요.

## 3. 보안 점검 (테스트로 확인한 것)

| 공격·사고 | 결과 | 테스트 |
|---|---|---|
| 클라이언트가 금액을 바꿈 | 409, 토스 호출 없음 | api 2 |
| 다른 사람 주문으로 승인 | 404 | api 2 |
| 다른 상품 금액으로 만든 결제를 붙임 | 토스가 거절(402), 지급 없음 | api 2 |
| 승인 두 번 + 웹훅 | 한 번만 지급 | api 1 |
| 위조 웹훅(본문은 DONE, 실제는 READY) | 아무 변화 없음 | api 3 |
| 리다이렉트·웹훅 둘 다 놓침 | 대사가 지급, 두 번째 대사는 변화 없음 | api 3 |
| 부분·전체 취소 웹훅, 같은 웹훅 재전송 | 비례 회수, 중복 없음, 광고 없는 기간 제거 | api 4 |
| 이미 지급된 주문에 두 번째 결제 | 409 + 자동 취소 | api 4 |
| 운영 환경에서 시연 결제 | 403 | api 5 |
| SANDBOX에 live 키 / 승인 없는 PRODUCTION | 서버 시작 거부 | api 5 |

## 4. 켜는 순서 (주인이 할 일)

1. 토스페이먼츠 가맹 계약, 테스트 키 발급. 2. Supabase 프로젝트에 `schema_platform.sql → schema.sql → DATABASE_ACCESS_POLICIES.sql → monetization.sql → commerce_seed.sql` 적용. 3. `server/wrangler.toml.example` → 배포, `wrangler secret put`으로 비밀값. 4. WEB_PG 상품 행 활성화(승인자 기록). 5. 앱 `config.js commerce.apiBase` + CSP `connect-src`에 API 주소, `script-src`에 토스 SDK 주소 추가. 6. `PAYMENT_SANDBOX_QA.md` 체크리스트를 테스트 키로 실행.
