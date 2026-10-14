# 네이티브 스토어 준비 상태 (Release G)

**결론: BLOCKED_EXTERNAL_DEPENDENCY — 네이티브 iOS/Android 앱이 없어요.** 지금 윤실장은 PWA(웹 앱)이고, 웹에서는 토스(웹 결제)를 쓰는 구조예요.

| 항목 | 상태 |
|---|---|
| 서버 Apple 검증(JWS·인증서 체인·bundle·환경·소모성·취소) | 코드 + 생성 인증서 테스트 |
| 서버 Google 검증(products.get·purchaseState·consume) | 코드 + 모의 API 테스트 |
| 스토어 거래 ID 멱등 지급(`commerce_store_grant`) | PostgreSQL 테스트 |
| 스토어 환불(Apple 알림 / Google voided) → 회수 | Apple 경로 코드, Google 함수만(Cron 미연결) |
| 스토어 상품 행(비활성, 가격 자리표시) | 시드에 있음 |
| 네이티브 앱(StoreKit 2 / Play Billing 클라이언트) | **없음** |
| App Store / Play 심사 자료(개인정보 라벨, 결제 안내, 스크린샷) | **없음** |
| 스토어 수수료 프로그램(소규모 사업자) 가입 | **확인 안 함** |

## 스토어 정책 주의

- 앱 안에서 크레딧(디지털 상품)을 팔면 스토어 결제를 써요. 앱 안에 웹 결제를 끼워 넣거나 외부 결제로 유도하는 버튼은 넣지 않아요(지역별 예외는 적용이 확인될 때만).
- 웹(PWA)에서 산 크레딧을 네이티브 앱에서 쓰게 할지, 앱에서 웹 결제를 언급할 수 있는지는 각 스토어 정책 검토 필요(NEEDS_LEGAL_REVIEW).
- 의료 관련 앱 심사 기준(의료 조언 없음, 가격 정보의 출처 표시)도 확인 필요.
