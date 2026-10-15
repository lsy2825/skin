# 보안 아키텍처 (윤실장)

기준일: 2026-10-13. 지금 운영 중인 구조와 로그인·DB를 켰을 때의 구조를 함께 적었어요. 각 통제에는 상태를 붙였어요.
- **검증됨:** 실제로 테스트해서 동작을 확인했어요(`SECURITY_TEST_REPORT.md`).
- **미검증:** 만들었거나 설정했지만 이 환경에서 시험하지 못했어요.
- **미해결:** 아직 없어요.

## 1. 구조와 신뢰 경계
```
[병원 공개 페이지] ──(GitHub Actions: robots.txt 확인 → 수집 → 정리 → 급변 검토 → 빌드)──▶ [공개 저장소 lsy2825/skin]
                                                                                              │ 봇 커밋 + Pages 배포
                                                                                              ▼
 [사용자 휴대폰 브라우저] ◀── HTTPS ── [GitHub Pages: 정적 파일 app/ + data.json (공개)]
   └ localStorage(pc:*): 장바구니·기록·설정 (기기 안에만)
   └ (로그인을 켜면) ── HTTPS ──▶ [Supabase: Auth(구글·카카오, MFA) · PostgREST API · PostgreSQL(RLS)]
                                       ▲ service_role 키: GitHub Actions secret에만 (수집 파이프라인이 DB에 쓸 때)
```

| 경계 | 넘는 것 | 믿지 않는 것 |
|---|---|---|
| 병원 사이트 → 수집기 | HTML | 수집한 모든 문자열과 URL. 화면에는 글자로만 넣고, http(s)가 아닌 링크는 버려요 |
| 저장소 → 사용자 | 정적 파일 | 공유 링크, 주소 해시, localStorage 값. 형식을 검사하고 크기를 제한해요 |
| 브라우저 → Supabase | JWT + 요청 | 클라이언트가 보낸 모든 user_id·cart_id. 권한은 DB 정책이 판단해요 |

**지키려는 것**
1. 가격 데이터의 정확성(사업 자산)
2. 사용자 데이터의 기밀성: 시술 기록·장바구니·위치
3. 운영 자격 증명: GitHub 계정, Supabase 키

**고려한 공격자**
- 익명 방문자
- 로그인한 악의적 사용자: 남의 ID를 넣거나 대량으로 요청
- 손상된 의존성
- 저장소 쓰기 권한이 있는 사람이나 손상된 계정
- 수집 대상 사이트가 넣은 악성 문자열

## 2. 인증·인가 (Phase 2)
| 통제 | 설계 | 상태 |
|---|---|---|
| 인증 | Supabase Auth(구글·카카오 OAuth). `app/auth.js`, 키는 `app/config.js` | 코드 준비됨. **키 미설정(보류)·미검증** |
| 관리자 MFA 필수 | 관리자 판단 = `user_roles`에 admin 역할이 있고 JWT `aal = 'aal2'`(이번 세션에서 2단계 인증 통과). MFA 없이 로그인한 관리자는 일반 사용자와 같아요 | DB 정책 **검증됨**(로컬). Supabase MFA 등록 화면은 미구현 |
| 역할 기반 접근 통제 | `user_roles(user_id, role ∈ admin, reviewer)` | **검증됨**(로컬) |
| 〃 역할 부여 | API로는 아무도 못 써요. SQL 편집기나 service_role로만 부여하고, 부여·회수는 감사 기록에 남아요 | 〃 |
| 서버 측 인가 | 모든 판단은 DB 안에서 해요: RLS 정책, `SECURITY DEFINER` 함수 `review_offer`·`is_admin`. 앱에는 관리자 버튼 자체가 없어요. 숨긴 버튼에 의존하지 않아요 | **검증됨**(로컬) |
| 세션 만료 | Supabase access token(JWT) 만료 기본 1시간, refresh token 회전. 관리자가 많아지면 만료를 더 짧게, 세션 시간 제한(유료 플랜 기능)도 검토 | **미검증**(Supabase가 관리, 프로젝트 없음) |
| 안전한 로그아웃 | `signOut({ scope: "local" })`: 이 기기의 refresh token을 서버에서 폐기해요 | 코드 반영. **미검증** |
| 최소 권한 | DB: anon·authenticated의 모든 권한을 회수한 뒤 필요한 것만 다시 줘요. CI: 작업별 권한(빌드 job은 contents만, 배포 job은 pages·id-token만). 수집 파이프라인만 service_role | DB **검증됨**. CI는 다음 실행에서 확인 |

## 3. 데이터베이스 보안 (Phase 3) — `supabase/DATABASE_ACCESS_POLICIES.sql`
적용 순서: `schema_platform.sql` → `schema.sql` → 정책 파일. 스키마 파일만 적용하면 모든 표가 RLS로 잠겨요. 정책이 없으니 API로는 아무것도 못 해요(안전한 기본값).

| 대상 | 익명(anon) | 로그인 사용자 | 검수자(reviewer + MFA) | 관리자(admin + MFA) | 수집 파이프라인(service_role) |
|---|---|---|---|---|---|
| 가격·카탈로그(offers, branches, variants …) | **검증·미만료 가격만 읽기** | 같음 | + 검토 대기 읽기 | 읽기·쓰기·삭제 | 전부(RLS 우회, 감사됨) |
| 가격 이력(price_snapshots) | 검증된 것만 읽기 | 같음 | 같음 | 같음(쓰기 없음) | 추가 |
| 검토 처리 | — | — | `review_offer()`로만(기록됨) | 같음 | — |
| 감사 기록·검토 기록 | — | — | 검토 기록 읽기 | 감사 기록 읽기 | — (트리거만 써요. 수정·삭제는 누구도 못 해요) |
| 수집 정책·작업 기록 | — | — | 읽기 | 읽기 | 쓰기 |
| 역할(user_roles) | — | 자기 역할만 읽기 | 〃 | 전체 읽기 | 부여·회수 |
| 사용자 신고 | — | 자기 신고 쓰기(하루 10건)·읽기 | 전체 읽기·상태 변경 | + 삭제 | — |
| 프로필·기록·장바구니·항목·저장 패키지·알림·즐겨찾기 | — | **본인 것만** SELECT/INSERT/UPDATE/DELETE 각각 | 본인 것만 | 본인 것만 | — |

**사용자 데이터의 세부 규칙**
- 장바구니 항목: 장바구니 주인만 다룰 수 있어요. 남의 장바구니로 옮기거나 넣을 수 없어요.
- 알림: 내 장바구니만 가리킬 수 있어요.

**그 밖의 장치**
- **감사 기록:** 다음 표가 바뀌면 트리거가 기록해요. 바뀐 칸만 남기고, 무엇이·언제·누가(사용자 id 또는 `service_role`)·이전값→새값을 적어요.
  - 가격(가격·정가·검증 상태·종료일·이름·비교 키·종류)
  - 지점·브랜드·시술·패키지·수집 정책·역할
- **추가만 가능:** `audit_logs`·`verification_logs`는 DB 소유자도 고치거나 지울 수 없어요. 예외는 가격 삭제 때 연결만 끊는 것 하나예요.
- **안전한 마이그레이션**
  - 한 트랜잭션으로 적용해요.
  - 다시 실행해도 같은 결과예요. 테스트에서 두 번 적용해 확인해요.
  - `schema_migrations`에 버전을 기록해요.
- **뷰:** `current_offers`는 `security_invoker`라서 정책을 우회하지 않아요.

## 4. API 보안 (Phase 4)
지금은 API 서버가 없어요(정적 파일만). 로그인을 켜면 API는 Supabase PostgREST예요.

| 통제 | 방법 | 상태 |
|---|---|---|
| 요청 수 제한 | 사용자별 한도를 DB에서 강제해요. 넘으면 `quota exceeded`로 거절하고 Postgres 로그에 `quota_exceeded`를 남겨요. HTTP 요청 수(IP별) 제한은 호스팅 PostgREST에 없어요 | 사용자별 한도 **검증됨**. IP별 제한 **미해결**(Edge Function이나 앞단 프록시 필요). Supabase Auth 자체 제한은 **미검증** |
| 입력 검증 | CHECK 제약(길이·값 목록·범위), 열 단위 권한(신고할 때 상태·작성자 지정 불가), 공유 링크는 필드별로 형식 검사 | **검증됨** |
| 출력 인코딩 | 화면은 텍스트 노드·`setAttribute`만 써요. 링크는 http(s)·mailto·tel·상대 주소만. CSP `script-src 'self'` | **검증됨**(XSS 시험 7/7, CSP 끈 상태에서도 통과) |
| 크기 제한 | jsonb 크기(옵션 8 KB, 저장 패키지 32 KB), 텍스트 길이, 공유 링크 20,000자, 장바구니 항목 50개 | **검증됨** |
| CORS | 인증 수단이 아니에요. 권한은 RLS가 판단하니 다른 출처에서 호출해도 남의 데이터는 안 나와요. Supabase 호스팅 API의 CORS 정책은 직접 확인하지 않았어요 | **미검증** |
| 매개변수화된 SQL | supabase-js → PostgREST(매개변수). 적재는 CSV `\copy`. 정책 안의 동적 SQL은 `format('%I')` | 코드 검토로 확인 |
| 남용 탐지 | `RAISE LOG 'quota_exceeded …'`. Supabase 로그 탐색기에서 이 문자열을 찾아요 | 로그 출력 **검증됨**(로컬). 알림 연동 **미해결** |
| 안전한 오류 응답 | 함수는 `not allowed` / `quota exceeded` / `offer not found`처럼 내부 정보 없는 메시지만 내요 | **검증됨** |

## 5. 비밀 정보 관리 (Phase 5)
| 비밀 | 어디에 | 원칙 |
|---|---|---|
| Supabase anon 키 | (켜면) `app/config.js` | 공개해도 되는 키예요. 모든 권한은 RLS가 판단해요. 비밀 검사가 이 키의 역할이 `anon`인지 확인해요 |
| Supabase service_role 키 | GitHub Actions secret에만 | 브라우저·저장소에 절대 두지 않아요. CI 비밀 검사로 막아요 |
| GitHub 토큰 | Actions가 실행마다 발급(`github.token`) | 작업별 최소 권한 |
| 텔레그램 봇 토큰·대화 번호 | GitHub Actions repository secret(`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)에만 | 알림 스크립트가 토큰을 출력하지 않아요(§9) |
| 비밀번호 화면 PIN | 해시만 `gate.js`에 | 비밀이 아니라 가림막이에요. 숫자는 저장소에 쓰지 않아요(테스트는 `APP_PIN` 환경 변수) |

- **자동 비밀 검사:** `tests/security/scan_secrets.py`를 배포 전 테스트에서 매번 돌려요(**검증됨**).
  - 찾은 값은 로그에 쓰지 않아요. 공개 저장소의 CI 로그도 공개이기 때문이에요.
  - GitHub 자체 기능(secret scanning·push protection)은 이 환경에서 켤 수 없었어요. **사용자가 켜야 해요.**
- **개발·운영 분리:** Supabase 프로젝트를 둘로 나눠요(dev / prod). 키는 각각의 GitHub Environment secret에 둬요. **미해결**(프로젝트 없음).
- **노출된 자격 증명 교체:** PIN이 git 기록에 남아 있어요. 교체 절차는 `INCIDENT_RESPONSE_PLAN.md` §2. **미해결**(사용자 결정 필요).

## 6. 데이터 무결성 (Phase 6)
| 기능 | 방법 | 상태 |
|---|---|---|
| 가격 변경 감사 기록 | 정적 데이터: 모든 변경이 봇 커밋으로 git에 남고, 주간 스냅샷은 `data2/history/`에 있어요. DB: `audit_logs` 트리거 | git 운영 중. DB 트리거 **검증됨**(로컬) |
| 출처 검증 | 가격마다 원본 URL·확인일. 초저가는 원본을 다시 읽어 대조해요(`price-check`, 2026-10-13: 40개 중 38 일치) | 운영 중 |
| 이상 가격 탐지 | 지난주 대비 −90%/×10은 검토 대기로 보내요. 중간값 30% 이하이면서 1~2곳뿐인 가격은 '확인 필요'로 대표가에서 빼요 | 운영 중 |
| 승인된 갱신 경로 | 가격은 GitHub Actions 봇 → 커밋 → 배포 순서로만 바뀌어요. DB에서는 service_role 파이프라인과 MFA 관리자만 쓸 수 있어요 | 일부. **main 브랜치 보호가 없어요(미해결)** |
| 중복 탐지 | 정리 단계에서 같은 지점 중복 줄을 하나로 합쳐요. DB `unique(branch_id, source_hash)` | 운영 중 |
| 백업·복구 | 정적 데이터는 git이 전체 기록이에요(되돌리기 = 커밋 revert). DB는 `pg_dump` → `pg_restore` 절차를 `tests/db/backup_restore_test.sh`로 실제 데이터(가격 62,417줄)에서 확인해요 | **검증됨**(로컬). CI에서도 돌아요 |
| 관리자 변경 기록 | `audit_logs` 수정·삭제 불가. 역할 부여·회수도 기록돼요 | **검증됨**(로컬) |

## 7. 인프라·가용성 (Phase 7)
| 통제 | 상태 |
|---|---|
| HTTPS | `*.github.io`는 GitHub가 HTTPS를 강제해요(GitHub 문서 기준). 이 환경에서 직접 확인하지 못했어요(**미검증**). CSP `upgrade-insecure-requests` |
| 보안 HTTP 헤더 | GitHub Pages는 헤더를 직접 정할 수 없어요. 그래서 meta 태그로 CSP와 Referrer-Policy를 넣었어요. `frame-ancestors`/`X-Frame-Options`(클릭재킹)와 HSTS 설정은 **미해결**: 전용 도메인 + 프록시가 필요해요. 대신 클릭재킹은 스크립트로 일부 막아요: 다른 사이트 프레임 안이면 화면을 숨기고 새 창 링크만 보여줘요(`app/gate.js`, 시험 `tests/e2e/frame.js`) |
| Content Security Policy | 스크립트는 같은 사이트만, 지도 타일은 OSM만, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. 14개 화면에서 위반 0건으로 **검증됨** |
| 의존성 검사 | 버전 고정(requirements.txt, 액션 SHA). `.github/dependabot.yml`(주간 업데이트 PR). 로그인 라이브러리는 저장소 안에 복사해 둠(MIT). Dependabot alerts·CodeQL은 **사용자가 켜야 해요** |
| 오류 모니터링 | **미해결.** 앱 오류를 모으는 곳이 없어요. 도입한다면 개인정보를 지우는 설정으로 해야 해요. 가격 공장·앱 주소 감시는 §9 |
| 트래픽 모니터링 | **미해결.** GitHub Pages는 방문 통계를 주지 않아요 |
| 자원 한도 | GitHub Pages(사이트 1 GB, 월 대역폭 약 100 GB 권장), Actions 실행 시간, Supabase 플랜 한도. 데이터 파일은 5 MB 정도예요 |
| 백업 검증 | `db-security` 워크플로가 실제 데이터로 백업→복구를 확인해요 |
| 재해 복구 | `INCIDENT_RESPONSE_PLAN.md` |

## 8. 요약
**검증된 통제(테스트 통과)**
- DB 접근 정책: 익명, 다른 사용자, 가격 변경, 권한 상승, 관리자 MFA, 감사 기록, 추가만 가능, 요청 한도, 크기 제한
- 백업·복구
- XSS 방어(CSP 없이도)와 CSP
- 공유 링크 검증
- 비밀 정보 자동 검사(현재 파일)

**미검증 통제(만들었지만 시험 못 함)**
- Supabase Auth·MFA 등록·세션 만료·로그아웃 폐기 (실제 프로젝트가 없어요)
- HTTPS 강제
- CORS
- CI 작업별 권한 (2026-10-13 실행에서 확인: 빌드·커밋·배포 성공, 잘못된 입력은 검사 단계에서 멈춤)

**미해결 취약점·공백**
- git 기록의 PIN (교체 필요)
- 같은 출처를 다른 Pages 사이트와 공유
- 클릭재킹 헤더 (스크립트로 일부 완화)
- IP별 요청 제한
- 오류·트래픽 모니터링
- main 브랜치 보호
- GitHub 보안 기능 켜기
- 수집기 User-Agent
- dev/prod 분리

## 9. 운영 감시 (텔레그램 알림)
기준일: 2026-10-15. 알림 채널은 사용자가 고른 텔레그램이에요. 문제가 있을 때만 메시지 1건을 보내요(알림 피로 방지).

| 무엇을 | 어디서 | 언제 |
|---|---|---|
| 가격 공장 실패·중단 | `weekly.yml` 마지막 단계(`failure() \|\| cancelled()`) | 그 실행 직후 |
| 데이터 가드 발동(`data2/report.md`의 "지난 자료 유지", "수집 실패, 이전 자료도 없음", robots.txt 차단, 출처 정책 확인 실패, "지난 자료로 배포", 급변 가격 검토 대기) | `weekly.yml`(`health_check.py --report-only`) | 자료를 새로 만든 실행 직후 |
| 브랜드 수집일이 오늘(KST)보다 8일 넘게 지남, 지난 자료를 쓰는 지점 | 두 곳 모두(`app/data-meta.json`, 감시 작업은 배포된 파일 우선) | 실행 직후 + 매일 |
| 공장이 26시간 넘게 성공 못함, 예약 실행이 없음, 3시간 넘게 멈춤, 마지막 실행 실패(다시 알림) | `monitor.yml`(GitHub API, `actions: read`) | 매일 09:30 KST |
| 앱 주소 200, 배포된 `data-meta.json` 읽힘 | `monitor.yml` | 매일 |
| Worker 살아 있음(HTTP 500 미만이면 정상) | `monitor.yml`, 저장소 변수 `MONITOR_WORKER_URLS`에 적힌 주소만(비면 건너뜀) | 매일 |
| 감시 자체가 살아 있음 | `monitor.yml`: 월요일에 문제가 없으면 "[주간 생존 신호]" 1건 | 매주 월요일 |

- **비밀:** 봇 토큰과 대화 번호는 Actions repository secret에만 둬요. 저장소·로그·메시지에 쓰지 않아요.
  텔레그램 API는 토큰을 주소에 넣기 때문에, `.github/scripts/telegram.py`는 주소·예외 문구를 출력하지 않고
  HTTP 상태와 텔레그램 설명만 남겨요(이마저 토큰 모양 글자는 가려요). `set -x`·`curl -v`는 쓰지 않아요(**검증됨**:
  `tests/security/monitor_test.py`가 401/400/429/5xx/연결 실패와 주소가 든 예외에서 출력에 토큰이 없는지 확인).
- **실패해도 공장을 멈추지 않아요:** 알림 스크립트는 언제나 종료 코드 0이고, secret이 없으면 notice 한 줄만 남겨요.
  알림 단계에는 `continue-on-error`를 걸었어요. 그래서 GitHub의 실패 표시·메일은 그대로 남아요.
- **개인정보 없음:** 메시지에는 브랜드 이름, 날짜, 개수, 실행 기록 링크만 들어가요. 방문자 정보는 모으지도 보내지도 않아요.
- **한계(미검증):** 이 환경에서는 api.telegram.org와 workers.dev에 닿지 못해 실제 전송은 시험하지 못했어요.
  사용자가 `monitor` 워크플로를 수동 실행(시험 메시지 켬)해서 확인해요.
