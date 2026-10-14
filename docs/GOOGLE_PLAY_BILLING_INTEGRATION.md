# Google Play 결제 연동 (GOOGLE_PLAY)

상태: **검증 계약 코드 + 모의 Google API 테스트만** (`server/src/payments/store.mjs googleAdapter`, `server/test/api.test.mjs` 12번). Android 앱이 없어서 실제 결제는 해 보지 않았어요 → BLOCKED_EXTERNAL_DEPENDENCY.

## 1. 상품

인앱 상품(소모성) `credits_mini|standard|plus` — 시드에만 있고 비활성. 앱 안 디지털 상품은 Play 결제를 써요(우회 결제 없음). 한국의 대체 결제 제도 적용 여부는 확인하지 않았어요(정책·법률 검토 필요).

## 2. 서버 검증 계약

앱이 구매 후 `{productId, purchaseToken}`을 `POST /v1/store/google`로 보내면:

1. 서비스 계정 JWT(RS256, scope `androidpublisher`)로 OAuth 토큰(`oauth2.googleapis.com/token`, 50분 캐시).
2. `GET androidpublisher/v3/applications/{package}/purchases/products/{productId}/tokens/{token}`.
3. `purchaseState == 0`(구매 완료)만 지급. 2(대기)·1(취소)은 409. `orderId` 없으면 거절.
4. `commerce_store_grant`: `orderId`가 멱등 키 → 같은 구매를 다시 보내도 한 번만.
5. 지급 뒤 `:consume` 호출(같은 묶음을 다시 살 수 있게). 소비 실패는 앱이 다시 보내면 되고, 지급은 이미 멱등.
6. 테스트 구매(`purchaseType == 0`)는 응답에 `test: true`로 표시 — 운영 회계에서 빼야 해요(아직 원장에 테스트 구매 표시 칼럼은 없음, 출시 전 추가 필요).

환불: Voided Purchases API(`voided()`)를 대사 작업에서 읽어 `commerce_refund(kind=REVOCATION, provider_done=true)`로 기록하는 함수까지 있어요. **Cron에 연결은 아직 안 했어요**(앱이 없어서) — 출시 전 연결 필요.

## 3. 테스트한 것 / 못 한 것

- 한 것(모의 API): 구매 완료 지급 + consume 호출, 같은 토큰 재전송 무지급, 대기 중 구매 409.
- 못 한 것: 실제 Play Console 상품·라이선스 테스터 구매, 실서비스 계정 권한, RTDN(실시간 개발자 알림) 수신, 환불 대사 Cron 연결.
