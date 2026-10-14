# 전체 시스템 감사 (5.1)

기준일 2026-10-14. 기능 추가가 아니라 **실제로 만들어진 것을 독립적으로 확인하고, 확인된 결함을 고치는** 감사예요. 세부 문서: `VERIFIED_FEATURE_INVENTORY.md`, `CRITICAL_ISSUES_AND_FIXES.md`, `PAYMENT_SECURITY_QA.md`, `DATA_QUALITY_AUDIT.md`, `AI_QUALITY_AND_COST_REPORT.md`, `CRAWLING_RELIABILITY_REPORT.md`, `PERFORMANCE_REPORT.md`, `PRODUCTION_READINESS_SCORECARD.md`, `FINAL_VERIFICATION_REPORT.md`.

## 1. 방법

| 방법 | 내용 |
|---|---|
| 독립 코드 검토 | 별도 검토자(이 대화의 구현 맥락 없이 코드만 읽음)가 결제·원장·AI·서버 전체를 검토하고, 의심 항목은 버리는 데이터베이스에서 재현 스크립트로 확인 |
| 측정 | 실데이터 감사(`tools/audit_data.js`), 매칭 평가(`tools/eval_offers.js`, 2,000줄), 성능(`first_load.js`), 접근성(axe), 기기 매트릭스 |
| 운영 기록 | GitHub Actions 최근 60건, 실패 단계 확인 |
| 테스트 | 모든 수정에 회귀 테스트를 붙이고 전체 회귀 실행 |

## 2. Phase 1 — 저장소

- **구성**: 앱(PWA, 바닐라 JS, `app/`), 공용 도메인 모듈(`app/domain/`, 앱·서버·테스트가 같은 코드), 수집·빌드(`scrape/`, `build2/`, Python), 서버(`server/`, Workers 형식, 배포 안 됨), DB(`supabase/*.sql`), 테스트(`tests/`, `server/test/`), 문서(`docs/`).
- **경계**: 돈·잔액·권한은 서버와 DB 함수만. 브라우저는 시연 지갑(DEMO)만 — 서버 모드에서 시연 지갑으로 떨어지던 결함(I-06)을 고쳤어요.
- **중복 코드**: 시연 지갑의 상품·기능 가격이 시드 SQL과 중복 → 의도된 시연 사본, 테스트로 대조. 죠미 안전장치는 앱·서버 공용 모듈로 하나만 있어요. `pricectx.rowsOf`와 `app.js rowsOf`가 같은 일을 함(앱은 이미 로드된 행을 쓰므로 유지, P3).
- **죽은 코드**: `uploaded_assets` 표(원본 사진 보관 옵션 자리, v1 미사용 — 문서화), `isPrivateIp`(이제 Node DNS 확인에서 사용).
- **의존성**: 서버 npm `pg` 1개(개발용) — `npm audit` 0건. Python 고정 버전(requirements.txt, Dependabot). pip-audit은 이 환경에 없어 실행하지 못했어요.
- **비밀값**: 추적 파일 364개 검사 0건(`scan_secrets.py`). 단, 5.0 서버 커밋 하나가 테스트용 문자열 때문에 CI에서 걸렸어요(I-23, 배포 안 됨, 수정됨).
- **DB 마이그레이션·인덱스·정책**: 모든 SQL 두 번 적용(멱등) 확인, 수익화 표 22개 전부 RLS, `commerce_*` 함수는 service_role만 실행(독립 검토가 권한 함수로 확인), 인덱스 보강.
- **배포 설정**: GitHub Pages(앱), `weekly.yml`(수집·빌드·배포), `wrangler.toml.example`(서버, 비밀값 칸 없음). 서버는 배포되지 않았어요.
- **하드코딩**: `VERIFIED_FEATURE_INVENTORY.md` §하드코딩 표.
- **가짜·모의를 실제처럼**: 시연 표시·닫힌 화면·'가정' 배지로 구분(같은 문서 §가짜).

## 3. 발견 요약

| 심각도 | 발견 | 수정 | 남음 |
|---|---|---|---|
| P0 | 0 | — | — |
| P1 | 6 (데이터 오분류, 매처 정밀도, 대사 누락, AI 무제한, ENV 기본값, 서버 모드 시연 지갑) | 6 | 0 |
| P2 | 12 | 11 | 1 (요청 제한 공유 저장소 O-01) |
| P3 | 12 | 8 | 4 (Apple/Google 계정 묶기, orders.expires_at, 같은 묶음 중복, 출처 중복 줄) |

## 4. 하지 않은 것 (지시서 준수)

실제 결제 활성화 없음, 운영 데이터 변경 없음(데이터는 묶음 분류 6줄만 — 원본 가격 삭제 없음), 깨지는 배포 없음(무료 앱 회귀 전부 통과 후 배포), 운영 준비 완료라고 표시하지 않음.
