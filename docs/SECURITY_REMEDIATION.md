# 보안 조치 내역 (Remediation)

기준일: 2026-10-13. 감사 결과(`SECURITY_AUDIT.md`)에 대해 한 일과 남은 일이에요. 우선순위는 지시서대로 치명적인 것부터예요.

상태
- ✅ **고침·검증:** 고쳤고 테스트로 확인했어요.
- 🟡 **고침·미검증:** 고쳤지만 이 환경에서 시험할 수 없었어요.
- ⛔ **미해결:** 결정이나 사용자 조치가 필요해요.

## 고친 것
| ID | 문제 | 조치 (파일) | 상태 / 검증 |
|---|---|---|---|
| R1 | PIN 평문 노출 | `NOTES.md`에서 숫자를 지웠어요. 테스트 4개는 `APP_PIN` 환경 변수를 읽어요(`tests/e2e/*.js`). 비밀 검사가 "코드에 적힌 PIN" 패턴을 막아요 | ✅ 현재 파일 0건(`scan_secrets.py`). **git 기록에는 남아 있어서 R-open-1이 필요해요** |
| R2 | 가격 플랫폼 표에 RLS 없음 | 모든 표에 RLS를 켜서 기본값을 잠금으로 했어요(`schema_platform.sql`). 정책은 `DATABASE_ACCESS_POLICIES.sql`에만 둬요. 가격은 검증·미만료만 공개로 읽고, 쓰기는 관리자 + MFA만 해요 | ✅ DB 시나리오 1·3·4 통과, 의도적 약화 3개 중 3개 탐지 |
| R3 | 알림이 남의 장바구니를 가리킴 | 알림 INSERT/UPDATE 정책에 장바구니 소유를 확인하는 조건을 넣었어요 | ✅ 시나리오 2(FAIL 2i가 실제로 잡히는지 약화 시험으로 확인) |
| R4 | 사용자 데이터 정책이 `for all` 하나뿐이었음 | SELECT/INSERT/UPDATE/DELETE를 따로 정책으로 만들었어요. `to authenticated`로 한정했어요. 즐겨찾기 표를 추가했어요 | ✅ 시나리오 2 |
| R5 | 관리자 MFA·역할 없음 | `user_roles` + `is_admin()`(역할이 있고 `aal2`일 때). 검수는 `review_offer()`(SECURITY DEFINER, 기록)로만 해요 | ✅ 시나리오 4(MFA 없는 관리자는 거부) |
| R6 | 감사 기록 없음 | 가격·카탈로그·역할 변경 트리거를 넣었어요(바뀐 칸만, 누가·언제). 감사·검토 기록은 추가만 가능해요 | ✅ 시나리오 4c·4e |
| R7 | 대량 요청·큰 값 | 사용자별 한도(신고 하루 10, 장바구니 30, 항목 50, 패키지 50, 알림 100, 즐겨찾기 500, 기록 2000)와 jsonb·텍스트 크기 제한을 넣었어요. 넘으면 `quota exceeded`로 거절하고 로그를 남겨요 | ✅ 시나리오 6 |
| R8 | 뷰가 정책을 우회 | `current_offers`를 `security_invoker = true`로 바꿨어요 | ✅ 시나리오 1b |
| R9 | CSP 없음 | meta CSP(`script-src 'self'` 등)와 Referrer-Policy를 넣었어요. 인라인 이벤트 처리기를 없앴어요(`#fcart`) | ✅ 14개 화면 위반 0건. 시험 도구의 인라인 주입도 실제로 막혀요 |
| R10 | `javascript:` 링크 가능 | `h()`가 http(s)·mailto·tel·상대 주소만 링크로 만들어요. 빌드 때도 http(s)가 아닌 원본 주소는 버려요 | ✅ XSS 시험(링크 0개). 검사를 지우면 시험이 실패하는 것도 확인했어요 |
| R11 | 공유 장바구니 링크 검사 부족 | 필드별 형식·길이 검사, 모르는 필드는 버림, 수량 1~20, 항목 50개, 링크 20,000자 제한, 해석 오류 처리 | ✅ XSS 시험 |
| R12 | 잘못된 `%` 주소로 오류 | 검색 화면의 주소 해석에 오류 처리를 넣었어요 | ✅ XSS 시험 경로에 포함 |
| R13 | 워크플로 입력 셸 인젝션 | `price-check.yml` 입력을 숫자형으로 바꾸고, 환경 변수로 전달하고, 1~200 범위를 검사해요 | 🟡 YAML 검사만 했어요. 다음 실행에서 확인 |
| R14 | CI 권한 과다 | `weekly.yml` 기본 권한을 없앴어요. 빌드 job은 contents: write만, 배포 job은 pages·id-token만 | ✅ 2026-10-13 GitHub 실행(run 38387214640)에서 빌드·커밋·배포 성공 |
| R15 | 액션·패키지 버전 미고정 | 액션을 커밋 SHA로 고정했어요(태그는 주석). `requirements.txt`는 정확한 버전으로 고정했어요(직접 의존 2개 + 하위 6개). `dependabot.yml`을 추가했어요 | ✅ GitHub 실행에서 SHA 고정 액션·고정 패키지로 성공. Dependabot 업데이트 점검도 실행됐어요 |
| R16 | 로그인 라이브러리를 CDN에서 무결성 검사 없이 불러옴 | npm 패키지(무결성 검증됨)에서 `app/vendor/supabase/`로 복사했어요(MIT 라이선스 포함). CSP가 외부 스크립트를 막아요 | 🟡 로그인을 켜지 않아 실제 로드는 미검증 |
| R17 | 로그아웃 | `signOut({ scope: "local" })`로 서버에서 refresh token을 폐기하도록 명시했어요 | 🟡 Supabase 없음 |
| R18 | robots.txt 확인이 실패해도 허용 | RFC 9309대로 바꿨어요: 4xx = 없음(허용), 5xx·연결 실패 = 그 주 수집 안 함. 모든 호스트를 확인해요. 확인 자체가 실패하면 지난번 결과를 실제로 써요(없으면 수집 안 함) | ✅ 판정 함수 8가지 경우 시험. 🟡 실제 사이트로는 미시험 |
| R19 | 위치 정밀도 | 저장 좌표를 약 1 m 단위에서 약 100 m 단위로 낮췄어요(기존 값은 다음 실행 때 한 번 변환) | 코드 반영 |
| R20 | 신고 메모 공개 안내 없음 | "GitHub 신고는 공개 글, 개인정보 적지 말 것" 문구를 넣었어요 | 코드 반영 |
| R21 | 비밀 정보 검사 수동 | `tests/security/scan_secrets.py`를 배포 전 테스트에 넣었어요. 찾은 값은 로그에 쓰지 않아요 | ✅ |
| R22 | DB 보안 테스트 자동화 | `.github/workflows/db-security.yml`: PostgreSQL 16 서비스에서 정책 시험과 실제 데이터 백업·복구 | ✅ GitHub 첫 실행(run 38387214542) 성공. 로컬과 다른 환경에서 같은 결과 |

## 남은 것 (사용자 조치 또는 결정 필요)
| ID | 할 일 | 왜 | 방법 |
|---|---|---|---|
| R-open-1 | **비밀번호 화면 PIN 교체** | 예전 PIN이 공개 git 기록에 남아 있어요. 공개 저장소의 기록을 다시 쓰는 건 복사본·캐시가 남아 효과가 제한적이라, 교체가 현실적인 해결이에요 | 새 PIN을 정해 주시면 해시를 바꾸고 서비스 워커 버전을 올려 배포할게요. 친구분들께도 새 PIN을 알려야 해요. PIN은 가림막일 뿐 데이터는 여전히 공개예요 |
| R-open-2 | **GitHub 보안 기능 켜기** | 이 작업 환경의 GitHub 연결은 저장소 설정 변경을 막아요(HTTP 403) | 아래 체크리스트 |
| R-open-3 | **main 브랜치 보호** | 쓰기 권한이 있으면 누구나 가격 데이터를 바로 바꿀 수 있어요 | Settings → Branches → main 규칙. 주의: 지금은 봇과 Claude가 main에 바로 올리는 구조라, 켜면 PR 방식으로 바꿔야 해요. 결정이 필요해요 |
| R-open-4 | 전용 도메인 + 프록시 | 같은 출처 공유, 클릭재킹 헤더, HSTS, IP별 요청 제한, 트래픽 통계를 해결하려면 필요해요 | 예: 도메인 구입 → Cloudflare(무료) → GitHub Pages. 비용·운영 결정이 필요해요 |
| R-open-5 | 로그인을 켤 때 | Supabase dev/prod 프로젝트 분리, 정책 적용, MFA 등록 화면, 세션 만료 설정, 실제 프로젝트에서 시나리오 7(만료 세션) 시험 | `SECURITY_TEST_REPORT.md` §시나리오 7 절차 |
| R-open-6 | 수집기 User-Agent | 일반 브라우저로 위장 중이에요. 정직한 이름으로 바꾸면 차단될 위험이 있어요 | 결정이 필요해요. 바꾼다면 사이트별로 시험해야 해요 |
| R-open-7 | 오류·트래픽 모니터링 | 지금은 없어요 | 개인정보를 지우는 설정으로 도입을 검토해요 |

**R-open-2 체크리스트 (GitHub 저장소 → Settings)**
1. Security(또는 Code security and analysis)
   - **Dependabot alerts** 켜기
   - **Dependabot security updates** 켜기
2. 같은 화면
   - **Secret scanning** 켜기
   - **Push protection** 켜기(비밀 정보가 든 커밋은 올라가지 않음)
3. 같은 화면 → **Code scanning → CodeQL analysis → Set up → Default**
4. Settings → **Pages** → "Enforce HTTPS" 체크 확인(github.io는 보통 이미 켜져 있어요)
5. 본인 GitHub 계정 → Settings → Password and authentication → **2단계 인증** 켜기(아직이라면)
