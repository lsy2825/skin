# 수집(크롤링) 비용 추적

## 1. 지금 수집은 어떻게 돌아가나

- GitHub Actions(공개 저장소)에서 매일 06:00 KST에 판단하고, 월요일·이벤트 종료 다음 날 4개 브랜드 공개 가격 페이지를 읽어요(`weekly.yml`). 수집 결과로 `data.json`을 다시 만들어 GitHub Pages에 배포해요.
- 공개 저장소의 GitHub Actions 표준 러너는 무료로 알려져 있어요 — 요금제·한도는 바뀔 수 있으니 결제 화면에서 확인해야 해요(**확인하지 않았어요**).
- 로그인·CAPTCHA 우회·차단 회피 없이 공개 페이지만 읽어요(기존 정책 그대로).

## 2. 비용 기록 방법 (service_cost_records)

| 칼럼 | 뜻 |
|---|---|
| category | `DATA`(수집), `INFRA`(호스팅·DB·Workers), `AI`, `COMMERCE`(결제 수수료 외 고정비), `OPERATIONS` |
| item | 예: `github-actions-collection`, `supabase-pro`, `cloudflare-workers` |
| period_start / period_end | 청구 기간 |
| amount_krw | 원화 금액 |
| kind | `ACTUAL`(청구서·영수증으로 확인) / `BUDGET`(가정·예산). 둘을 섞어 합치지 않아요 |
| source | 청구서 번호·화면 이름 등 근거 |

- 수집 실행당 비용(분)을 직접 측정하려면 Actions 실행 시간(분)을 월별로 모아 `BUDGET`(무료 한도 안이면 0원, 근거: 실행 기록)으로 넣어요. 실제 청구가 생기면 `ACTUAL`.
- 지금은 아무 행도 넣지 않았어요(서버 DB가 아직 없음). 운영 화면의 비용 카드는 '가정'만 보여줘요.

## 3. 주의

- 수집 빈도를 늘리면(예: 매일) 비용과 병원 사이트 부담이 같이 늘어요. 알림을 '실시간'처럼 보이게 하려고 수집을 늘리지 않아요.
- 유료 프록시·CAPTCHA 풀이 서비스 같은 비용 항목은 만들지 않아요(차단 회피 금지).
