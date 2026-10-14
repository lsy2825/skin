# 운영·검토 명세 (Admin Operations Spec)

기준일: 2026-10-14.
- 화면: 마이 → 운영 현황(`#ops`, `flags.ops`). 사용자 화면과 분리돼 있고, 메뉴에서만 들어가요.
- 코드: `app/app.js views.ops`·`reviewCenterCard`·`runStatusCard`, `tools/review_queue.js`(`app/review.json`), `.github/workflows/weekly.yml`
- 테스트: `tests/e2e/ops40.js`

## 1. 원칙
- **앱에서는 아무것도 바꾸지 못해요(읽기 전용).** 시연 사용자·일반 사용자 모두 데이터를 고칠 수 없어요.
  - 결정은 저장소 파일로만 해요: `data2/review_ok.csv`, `build2/xkeys.py`·`taxonomy.py`
  - 결정이 반영되면 다음 빌드(GitHub Actions)에 나타나요.
- **실제 서버 상태만** 보여줘요. 수집 실행 상태는 GitHub Actions 공개 API에서 읽은 그대로예요(QUEUED·RUNNING·SUCCESS·FAILED·RATE_LIMITED). 서버가 없는 기능은 '서버 필요'라고 적어요.
- 공개 저장소에 이미 있는 정보만 보여줘요. 비밀값·내부 주소는 없어요.
- 운영 현황 화면도 PIN 뒤에 있어요. PIN은 화면 잠금일 뿐 보안 인증이 아니에요(`SECURITY_ARCHITECTURE.md`). 실제 운영자 권한은 저장소 쓰기 권한이에요.

## 2. 화면 구성
| 카드 | 내용 | 출처 | 상태 |
|---|---|---|---|
| 운영 현황 | 마지막 빌드, 수집 보고 | `meta.about.report` | EXISTING_VERIFIED |
| 데이터 신선도 | 브랜드별 VERIFIED·STALE·EXPIRED·PENDING_REVIEW | `data.json` | EXISTING_VERIFIED |
| **수집 실행 상태** | 최근 weekly-prices 실행 5개: 상태·시작 시각·계기(예약·푸시·수동)·결과, Actions 링크 | GitHub API `actions/workflows/weekly.yml/runs` (누를 때만 요청) | IMPLEMENTED |
| **분류 검토 센터** | 비교 판정 분포(A~R), 대기열 R·C·J 건수와 앞쪽 항목(이유·할 일) | `app/review.json`(빌드가 만듦) | IMPLEMENTED |
| 급변 검토 큐 | 지난주보다 90%↓·10배↑ 가격 | `meta.review`, `data2/review.csv` | EXISTING_VERIFIED |
| 재수집 순서 | 다음 수집 때 먼저 볼 지점 | `recheckQueue` | EXISTING_VERIFIED |
| 출처 정책 | robots·약관 검토 상태 | `meta.about.sources` | EXISTING_VERIFIED |
| 기능 플래그 | config.js flags | `config.js` | EXISTING_VERIFIED |

## 3. 수집 실행 상태
| GitHub 값 | 화면 상태 |
|---|---|
| status = queued·waiting·requested·pending | QUEUED |
| status = in_progress | RUNNING |
| status = completed, conclusion = success | SUCCESS |
| status = completed, conclusion = failure·cancelled·timed_out·startup_failure | FAILED |
| HTTP 403/429이고 남은 요청 0(인증 없이 IP당 시간당 60번) | RATE_LIMITED + 다시 쓸 수 있는 시각 |
| 연결 실패 | "확인하지 못했어요"(상태를 지어내지 않음) |

- 자동으로 되풀이해서 묻지 않아요. 버튼을 누를 때만 한 번 요청해요.
- 앱에서 수집을 시작하는 버튼은 없어요. 시작하려면 저장소 쓰기 권한(토큰)이 필요한데, 토큰을 앱에 넣지 않아요. Actions 페이지의 'Run workflow'로 해요.

## 4. 분류 검토 센터
- `tools/review_queue.js`가 빌드 때마다 세 가지를 만들어요(weekly.yml 단계).
  - `docs/CLASSIFICATION_REVIEW_QUEUE.csv`
  - `docs/PRODUCT_ALIAS_MAPPING.csv`
  - `app/review.json`
- 대기열 종류: R(가격이 묶음 중간값과 10배 차이), C(한 묶음에 제품·장비가 둘 이상), J(제품군 낱말이 있는데 어느 묶음에도 없는 이름, 3곳 이상)
- 항목마다 이유와 **할 일**을 적어요. 예: "원본과 대조 → 맞으면 review_ok.csv"
- 상태값은 '대기' 하나예요. 처리하면 다음 빌드에서 대기열에서 빠져요. 앱에는 '처리함' 버튼이 없어요(가짜 성공을 만들지 않기 위해).

## 5. 바꿀 수 없는 것 (지시서의 금지 행동)
- 원본 가격 데이터 삭제, 전체 DB 파괴적 변경, 비밀키 변경, 인증 정책 변경은 앱에도 문서에도 그런 기능이 없어요.
- 외부 메시지 발송도 마찬가지예요. 재확인 요청은 사용자가 직접 GitHub 이슈 화면을 열어 보내는 방식이에요.

## 6. 사용 통계 (분석 이벤트)
| 항목 | 정책 |
|---|---|
| 기본값 | **꺼짐**. 마이 → '사용 통계 남기기(이 기기에만)'를 켰을 때만 |
| 저장 위치 | 이 기기 localStorage(`pc:events`, 최근 500개). **서버로 보내지 않아요**(보낼 서버가 없어요) |
| 표시 | 모든 이벤트에 `demo: true`. 실제 서비스 지표와 섞이지 않게 '시연 기록'으로 표시 |
| 남기는 것 | 이벤트 이름, 시각, 비교 묶음 ID·판정·계획 이름 같은 앱 안의 값 |
| 남기지 않는 것 | 검색어 원문, 피부 고민 입력, 위치 좌표, 이름·연락처 |
| 보기·지우기 | 같은 화면에서 이벤트별 개수 보기, 모두 지우기 |

이벤트 목록(`AN_EVENTS`)은 다음과 같아요.
- `search`(연산자 사용 여부만)
- `compare_view`
- `option_mode`
- `option_step`
- `prod_filter`
- `price_sheet`
- `cart_add`
- `scenario_open`
- `alert_set`

서버 지표로 쓰려면 아래가 필요해요(REQUIRES_BACKEND).
1. 동의 화면 문구 법률 검토
2. 수집 서버와 보관 기간
3. 시연 이벤트와 실제 이벤트 분리 저장
4. 개인정보 처리방침 갱신
