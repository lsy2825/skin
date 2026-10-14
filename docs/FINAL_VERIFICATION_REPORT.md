# 최종 검증 보고서 — YOONSILJANG 5.1 (전체 감사·운영 강화)

기준일 2026-10-14. 지시서: "YOONSILJANG 5.1 — FULL SYSTEM AUDIT & PRODUCTION HARDENING". 기능을 늘리지 않고, 만들어진 것을 독립적으로 확인하고 확인된 결함을 고쳤어요. **여기 적은 결과는 이 환경에서 실제로 돌린 것만이에요.**

## 1. 한 줄 결론

무료 가격 비교 앱은 안정적이고(회귀 전부 통과, 배포 중), 수익화는 **시연 + 서버 코드 검증** 단계예요. 확인된 P1 6건은 모두 고쳤지만, 실제 결제사·AI·네이티브 앱 검증과 법률 검토·주인 승인이 없어서 **운영(실제 결제) 준비 완료가 아니에요.**

## 2. 최종 회귀 (5.1 코드, 2026-10-14, `tests/run_regression.sh`, exit 0)

| 묶음 | 결과 |
|---|---|
| 단위 `tests/*.test.js` | 82/82 |
| 서버 원장(PostgreSQL 16) | 10/10 |
| 서버 API(PostgreSQL + 모의 결제사·AI·스토어·푸시) | 15/15 |
| DB 보안 정책 | 통과 |
| 비밀값 검사 | 0건 |
| 비교 묶음 판정(xkeys) | 124/124 |
| 수집 값 이상 가드 | 6/6 |
| 백업·복원(원장 포함) | 일치 |
| e2e commerce50 · admin51 · devices51 | 27/27 · 10/10 · 12/12(Chromium 에뮬레이션) |
| e2e 기존 18종(qa7·ux_qa·concern·xss·jomi·objective·frame·table_attr·compare_cards·v5·demo·data_sync·pricenow·audit40·taxonomy40·pricing40·ops40·audit_ui) | 모두 통과 |
| 접근성 axe(21화면×밝게·어둡게) · 터치 영역 | 위반 0 · 통과 |
| 의존성 `npm audit`(server) | 0건 |

## 3. 고친 것 (자세히: `CRITICAL_ISSUES_AND_FIXES.md`)

- **데이터**: 다른 시술이 같은 비교 묶음에 섞인 6줄(침샘·두피 발모·MTS를 '주름 보톡스 1부위'에, 피코프락셀·더마V 묶음을 단일 토닝에) 분리. 가격 변경 0.
- **매칭**: '정확히 같은 묶음' 정밀도 86.8% → 94.7~98.8%(실옵션 2,000줄). 외국산→국산 같은 위험한 오답 제거.
- **결제·원장**: 대사 누락(만료 주문 100개 뒤 새 결제), 부분 환불 누적 반올림, 네트워크 끊김·시간 제한, 서버 모드에서 시연 지갑으로 떨어지던 화면, ENV 기본값.
- **AI 비용**: 사용자·서비스 하루 한도, 비용표 없는 모델 거절, 죠미 동시 질문 제한, 답 없는 질문 차감 금지.
- **보안**: SSRF(와일드카드 DNS·DNS 확인), 선형 HTML 처리, JWT aud·깨진 서명, 푸시 주소 탈취, Google 테스트 구매.
- **수집**: 행 수는 그대로인데 가격이 깨진 자료를 거르는 값 이상 가드(CI 포함).
- **성능**: 결제 스크립트 지연 로딩으로 첫 화면을 4.0 수준으로 복구(느린 4G 9.45초 → 8.89초, 40요청).
- **운영**: 관리자 대시보드(서버 SQL + API + 앱 화면, 실측/추정 분리, MFA 관리자만).
- **절차**: 5.0 서버 커밋이 CI 비밀값 검사에서 걸렸던 일(배포 안 됨) — 회귀 스크립트에 비밀값 검사 포함.

## 4. 검증하지 못한 것 (지어내지 않음)

| 항목 | 이유 |
|---|---|
| 실제 토스 샌드박스 결제 | 토스 계약·테스트 키·서버 배포 없음 |
| Apple·Google 인앱 결제 | 네이티브 앱 없음 — 검증 계약만 |
| AI 사진 읽기 품질·토큰·비용 | OpenAI 키·라이선스 이미지 없음 |
| 실제 웹 푸시 | VAPID 키·서버 없음 |
| Safari(WebKit)·Firefox·실기기 | 이 환경에 Chromium만 |
| 서버 부하 시험 | 서버 미배포 |
| pip-audit | 도구 없음 |

## 5. 산출물 10개

`FULL_SYSTEM_AUDIT.md`, `VERIFIED_FEATURE_INVENTORY.md`, `PAYMENT_SECURITY_QA.md`, `DATA_QUALITY_AUDIT.md`, `AI_QUALITY_AND_COST_REPORT.md`, `CRAWLING_RELIABILITY_REPORT.md`, `PERFORMANCE_REPORT.md`, `PRODUCTION_READINESS_SCORECARD.md`, `CRITICAL_ISSUES_AND_FIXES.md`, 이 보고서.

## 6. 주인이 정할 것

1. 법률 검토 범위와 가격 확정. 2. 토스 계약·Supabase·Cloudflare 준비(→ SANDBOX 검증). 3. AI 사진 읽기를 쓸지(국외 전송 고지 필요). 4. 네이티브 앱 여부. 5. 요청 제한 저장소(KV/Durable Object) 비용.
