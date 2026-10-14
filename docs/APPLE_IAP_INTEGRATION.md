# Apple 인앱 결제 연동 (APPLE_IAP)

상태: **검증 계약 코드 + 모의 테스트만** (`server/src/payments/store.mjs appleAdapter`, `server/test/api.test.mjs` 12번). 네이티브 iOS 앱이 없어서 Apple 샌드박스 결제는 한 번도 해 보지 않았어요 → BLOCKED_EXTERNAL_DEPENDENCY. end-to-end로 검증했다고 말하지 않아요.

## 1. 왜 IAP인가

iOS 앱 안에서 디지털 상품(크레딧)을 팔면 원칙적으로 Apple 인앱 결제를 써야 해요. 앱 안에 외부 웹 결제를 끼워 넣어 IAP를 피하는 방식은 **쓰지 않아요**(지시서). 지역별 예외(외부 결제 허용 제도 등)는 실제로 적용되는지 확인되기 전에는 쓰지 않아요 — 한국의 적용 조건은 확인하지 않았어요(모르겠어요, 법률·스토어 정책 검토 필요).

## 2. 상품

- 소모성(Consumable) 3개: `kr.yoonsiljang.credits.mini|standard|plus` (시드에만 있고 비활성). 가격은 App Store 가격대에서 골라야 해요.
- 광고 없는 기간도 같은 묶음에 포함(웹과 같은 혜택).

## 3. 서버 검증 계약 (StoreKit 2)

앱이 구매 후 `signedTransactionInfo`(JWS)를 `POST /v1/store/apple`로 보내면:

1. JWS 헤더 `alg=ES256`, `x5c` 체인 3개(leaf, intermediate, root).
2. root 인증서 지문이 설정한 Apple 루트(`APPLE_ROOT_CERTS_B64`)와 같아야 함. leaf←intermediate←root 서명·발급자·유효기간 확인(`node:crypto X509Certificate`).
3. Apple 서명 인증서 확장 OID 확인(leaf `1.2.840.113635.100.6.11.1`, intermediate `1.2.840.113635.100.6.2.1`).
4. leaf 공개키로 JWS 서명 확인.
5. 내용: `bundleId` 일치, `environment`(Sandbox/Production) 일치, `type == Consumable`, `revocationDate` 없음.
6. `commerce_store_grant`: `transactionId`가 멱등 키 → 같은 거래를 다시 보내도 한 번만 지급. 주문을 만들고 바로 지급(가격 스냅샷은 그 채널의 활성 카탈로그 행).
7. 앱은 서버 응답을 받은 뒤에 거래를 finish 해요(서버 확인 전 finish 금지).

환불: App Store Server Notifications V2(`signedPayload`)를 `POST /v1/webhooks/apple`로 받아 같은 JWS 검증 후 `REFUND`/`REVOKE`이면 `commerce_refund(kind=REVOCATION, provider_done=true)` — 남은 구매 크레딧만큼 회수하고, 이미 쓴 몫은 '회수 못 함'으로 기록(잔액이 음수가 되지 않음).

## 4. 테스트한 것 / 못 한 것

- 한 것(생성한 테스트 인증서로): 정상 거래 지급, 같은 거래 재전송 무지급, 다른 앱 bundleId 거절, 본문을 바꾼 위조 JWS 거절.
- 못 한 것: 실제 Apple 루트 인증서로 실제 샌드박스 거래 검증, Server Notifications 실제 수신, Cloudflare Workers에서 `X509Certificate` 동작(nodejs_compat 지원 범위 확인 필요 — 추측으로 단정하지 않아요), 가족 공유·환불 요청 흐름.

## 5. 켜기 전 체크

App Store Connect 상품 등록·심사, Apple 루트 인증서(G3) 설정, Server Notifications URL 등록, Sandbox 테스터로 구매→서버 검증→finish→환불 알림까지 실제 확인, 개인정보 처리방침·결제 안내 문구 법률 검토.
