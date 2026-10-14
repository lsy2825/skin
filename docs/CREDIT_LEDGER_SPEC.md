# 크레딧 원장 명세

원천: `supabase/monetization.sql`. 테스트: `server/test/ledger.test.mjs`(10개), `server/test/api.test.mjs`(12개), 실제 PostgreSQL 16에서 실행.

## 1. 원장 (credit_transactions)

- **추가 전용**: 수정·삭제 트리거가 막아요(`commerce_forbid_change`). 고칠 일이 있으면 `ADMIN_ADJUSTMENT` 행을 새로 넣어요(사유·처리자 필수, 감사 기록).
- 행마다 `type`, `bucket`(PAID/PROMO), `amount`, `effect_balance`, `effect_reserved`, `idempotency_key`(유일), 참조(order/job/payment/refund).
- 유형: `PURCHASE_GRANTED`, `PROMOTIONAL_GRANTED`, `CREDIT_RESERVED`, `CREDIT_CAPTURED`, `CREDIT_RELEASED`, `PURCHASE_REFUNDED`, `PAYMENT_REVERSED`, `ADMIN_ADJUSTMENT`.
- **지갑(credit_wallets)은 투영**: 같은 트랜잭션에서 원장 효과를 더해요. 잔액·예약은 0 이상, 예약 ≤ 잔액(체크 제약). `commerce_verify_wallet`이 원장 합계와 지갑·예약 행을 대조해요(모든 테스트 끝에서 확인).
- 구매 크레딧(PAID)과 보너스 크레딧(PROMO)은 따로 세고, **구매 크레딧은 유효기간이 없어요.** 쓸 때는 보너스부터.

## 2. 동시성

- 한 사용자의 모든 지출은 지갑 행을 `FOR UPDATE`로 잠가 줄을 세워요.
- 테스트: 5크레딧에 1크레딧 작업 20개를 동시에 → 정확히 5개 성공, 15개 `INSUFFICIENT_CREDITS`, 잔액 0, 원장 일치(원장 6번).

## 3. 예약 → 차감 / 반환

| 단계 | 함수 | 규칙 |
|---|---|---|
| 예약 | `commerce_reserve` | 같은 (사용자, 요청 키) → 같은 작업(두 번 눌러도 한 번). 같은 기능·같은 범위의 이용권이 살아 있으면 0크레딧. 부족하면 예약 없이 `INSUFFICIENT_CREDITS`. 기한(기본 300초, 최대 설정값) 기록 |
| 시작 | `commerce_start_job` | RESERVED → RUNNING |
| 차감 | `commerce_capture` | 결과(제목 있는 보고서)가 있어야만. 보고서 저장, 이용권 기간 시작. 두 번 불러도 한 번 |
| 반환 | `commerce_release` | 실패·검증 실패·시간 초과·충돌. 이미 반환된 작업을 나중에 차감하려 하면 `JOB_RELEASED`(늦게 온 결과로 돈을 받지 않음) |
| 만료 | `commerce_expire_jobs` | 기한이 지난 RESERVED/RUNNING을 반환(Cron 10분) |

- 서버는 같은 요청 키로 **다른 입력**이 오면 409(입력 해시 비교) — 키를 재사용해 다른 결과를 받는 것을 막아요.
- AI 대체 모델 호출은 비용 기록만 늘고 사용자 크레딧은 기능 가격 그대로(추가 차감 없음).

## 4. 지급·환불

- `commerce_fulfill_payment`: 주문당 결제 한 건, 지급 멱등 키 `grant:<order>`. 늦게 온 승인(주문이 EXPIRED/FAILED/CANCELED)도 실제 돈이므로 지급.
- `commerce_refund`: `credits_target = round(paid_credits × 환불액 ÷ 결제액)`(전액이면 남은 몫 전부). 회수는 쓰지 않은 구매 크레딧까지만 — 잔액은 절대 음수가 되지 않고, 모자란 몫은 `credits_unrecovered`로 기록. 우리가 먼저 하는 환불(kind REFUND, provider_done=false)은 이미 쓴 크레딧이 있으면 `CREDITS_ALREADY_SPENT`로 멈춰요(정책 확인 후 진행). 결제사가 이미 돈을 돌려준 경우(웹훅·차지백·스토어 취소)는 `provider_done=true`로 기록만.
- 전액 환불이면 그 묶음의 광고 없는 일수를 빼요(이미 뺀 일수는 `revoked_days`로 세어 두 번 빼지 않음). 보고서는 남겨요.

## 5. 접근 통제

- 모든 표 RLS 켜짐, `anon`/`authenticated`에 쓰기 권한 없음. 사용자는 자기 행만 읽기(지갑, 원장, 주문, 결제(주문 통해), 보고서, 이용권 등). 카탈로그는 활성 행만 읽기.
- `commerce_*` 함수는 `security definer`, `search_path=''`, 실행 권한은 `service_role`만(원장 10번: 사용자가 함수를 직접 불러도 거부).
- 관리자 동작(보너스·조정·환불)은 서버에서 `admin` 역할 + 2단계 인증(aal2)을 확인하고, DB 함수가 처리자를 감사 기록에 남겨요.

## 6. 시연 지갑과의 관계

`app/domain/demowallet.js`는 같은 규칙을 기기 안에서 흉내 낼 뿐이고 결제된 크레딧의 근거가 아니에요(localStorage는 결제 크레딧의 원천이 될 수 없음). `tests/commerce.test.js`가 규칙 일치를 확인해요.
