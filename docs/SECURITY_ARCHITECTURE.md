# 보안 아키텍처 (윤실장)

기준일: 2026-10-13. 지금 운영 중인 구조와 로그인·DB를 켰을 때의 구조를 함께 적었어요. 각 통제에는 상태를 붙였어요.
- **검증됨:** 실제로 테스트해서 동작을 확인했어요(`SECURITY_TEST_REPORT.md`).
- **미검증:** 만들었거나 설정했지만 이 환경에서 시험하지 못했어요.
- **미해결:** 아직 없어요.

## 0. 공개 저장소 (2026-10-16 사용자 결정)
- GitHub `lsy2825/skin`은 **공개**예요. 2026-10-16에 확인했어요(`gh api repos/lsy2825/skin` → `private: false`, 로그인 없이 raw 파일 받기 200).
- 문서에는 2026-10-15 비공개 전환으로 적혀 있었어요. 언제·왜 다시 공개가 됐는지는 **모름**이에요. 사용자가 2026-10-16에 공개로 두기로 했어요.
- 그래서 코드·데이터·git 기록 전체·Actions 실행 로그를 누구나 읽어요. 복사본 `leebackcoding/skin`(2026-10-14)도 있어요.
- 2026-10-16 전체 기록 비밀 검사(`python3 tests/security/scan_secrets.py --history`, 브랜치 84개): **진짜 비밀값은 없었어요.**
  - 걸린 것 ①: `server/test/api.test.mjs` 옛 판의 시험용 가짜 값 2개.
  - 걸린 것 ②: 예전 비밀번호 화면 번호(R1·R-open-1). 번호를 바꿔서 해결해요(PC 도구 `tools/windows/pin.bat`, #81 합쳐짐 — 사용자 실행 대기).
- 남의 복사본(fork)에서 온 PR에는 비밀값이 가지 않아요. PR 검사는 `pull_request`만 쓰고 `pull_request_target`은 안 써요. 비밀값은 push·예약·수동 실행에서만 써요.
- 검사가 비밀값을 찾아도 값은 로그에 쓰지 않아요(종류·위치·길이만). Actions 로그도 공개이기 때문이에요.
- 비용: 공개 저장소는 GitHub Actions 표준 러너가 무료이고, 비공개의 월 2,000분 한도가 없다고 알고 있어요. 리드의 이해이고, 이 작업에서 결제 화면으로 **확인하지 않았어요.**
- 사용자 할 일: GitHub Settings → Code security에서 비밀 검사(secret scanning)와 push protection을 켜요. 이 작업의 토큰으로는 읽지도 바꾸지도 못해요(403). `RELEASE_CHECKLIST.md`의 'GitHub 보안 기능' 줄과 같은 일이에요.

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
| 최소 권한 | DB: anon·authenticated의 모든 권한을 회수한 뒤 필요한 것만 다시 줘요. CI: 작업별 권한(`weekly.yml` — update job은 main에서만 돌고 contents: write만·Cloudflare 토큰 없음·Re-run 거절, deploy job은 contents: read + 배포 단계에만 Cloudflare 토큰(`environment: cloudflare`, §5), redeploy job은 actions: write만(checkout·비밀 없음, 새 배포 코드 때문에 건너뛴 배포를 Run workflow로 다시 띄움), alert job은 contents: read). 수집 파이프라인만 service_role | DB **검증됨**. CI는 다음 실행에서 확인 |

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

### 가격 알림 Worker (`cf/alerts`, Cloudflare 무료 플랜)
로그인 없는 Web Push 구독을 받는 공개 API예요. 저장하는 것: 무작위 id·푸시 endpoint·규칙(시술 key·가격·지역)·보낸 날짜 몇 개. **구독마다 '마지막으로 쓴 날'은 어디에도 없고 보관 기간도 없어요**(2026-10-15 결정). 상세·저장 항목 전체 목록: `ARCHITECTURE.md` D19.

| 통제 | 방법 | 상태 |
|---|---|---|
| 구독 남용(클라이언트별) | `POST /v1/push/subscribe`에 Rate Limiting 바인딩(`SUBS_RL`, 60초에 3번, Cloudflare 지점별). 키는 접속 IP(`cf-connecting-ip`): IPv4는 주소 그대로, **IPv6는 앞 /64**(한 사용자가 /64 전체를 받으므로 주소만 바꿔 피하지 못하게, `rules.js clientKey`). **IP는 바인딩의 메모리 카운터(60초)에만 있고 D1·로그·응답 어디에도 남지 않아요**(코드 주석 `src/worker.js`, 시험: D1에 넘긴 값과 콘솔 출력 전체에서 IP를 찾음). 형식 검사를 통과한 요청만 셉니다 | **검증됨**(node 시험, 바인딩은 가짜). 실제 바인딩 동작은 **미검증**(배포 전) |
| 구독 남용(전체) | 하루(KST) 새 구독 2,000개 예산(`stat` 표 `new:날짜`; 오늘 날짜는 Worker 시계로 같은 D1 batch 안에서 `day` 줄에 적고 `subs_ins` 트리거가 그 줄로 이름을 정해요 — 구독 행은 날짜를 갖지 않아요. D1 무료 쓰기 하루 100,000줄보다 훨씬 아래) → 넘으면 429(꽉 찼어도 예산부터 확인). 전체 상한 `MAX_SUBS` 8,000 → 꽉 차면 **503 FULL이고 아무도 밀어내지 않아요**(밀어내기·365일 정리는 없음). 같은 endpoint 재구독은 둘 다 통과. 꽉 참은 `/health`의 `capacity`로 드러나요(아래 '용량 알림') | **검증됨**(node 시험: 꽉 찬 표가 하루·14개월 뒤에도 그대로 503, 아무도 안 지워짐) |
| 403·실패 구독 심기(남의 푸시 막기) | 큐 세 개: `CLAIM_X`·`CLAIM_W`는 실패한 적 없는 구독(fails = 0)만, `CLAIM_F`(실행당 10칸 `FAIL_SLOTS`)가 실패한 구독. **`CLAIM_F`는 푸시를 받은 적 있는 구독(진짜 기기가 한 번 실패한 경우)을 한 번도 받은 적 없는 구독(새 구독·심은 구독)보다 먼저** 시도해요(색인 `subs_fail`, 정렬 없이 색인 순서). 푸시를 받은 적 없는 구독은 **401·403을 처음 받는 순간 삭제**(다른 applicationServerKey로 만든 구독은 영원히 거절되므로 한 번 시도로 끝), 그 밖의 실패는 3번(`NEVER_DROP`); 받은 적 있는 구독은 401·403 3번·그 밖의 실패 10번이면 삭제. **푸시 서비스 쪽 문제(5xx·리다이렉트·시간 초과)는 그 서비스가 같은 실행에서 다른 푸시를 2xx로 받아 줬을 때만 그 구독의 실패로 세요** — 서비스 장애 한 시간 동안 아무도 지워지지 않아요(실패 없이 풀어 줌). 실행 전체를 멈추는 것은 예전에 푸시를 받은 기기 3대 이상이 401·403을 내고 성공이 하나도 없을 때뿐. 남는 비용: 새 구독은 모두 첫 시도를 받으므로 하루 예산(2,000)만큼의 첫 시도가 쓰이고, 그동안(2,000건 ÷ 40 = 약 50회 실행) 실패한 적 있는 진짜 기기는 같은 날 뒤쪽 실행에서 다시 시도돼요 | **검증됨**(`worker.test.mjs`: 403 구독 6개 + 정상 30개; 가장 빠른 마감의 심은 expiring 12개 + 정상 1개; **사흘 연속 매일 1,000개 심기**(403·400 절반씩) + 매일 1번 실패한 진짜 기기 20대 → 매일 20대 모두 그날 발송, 403 구독은 한 번 시도로 삭제; 푸시 서비스 장애 15번 연속 → 아무도 안 지워짐) |
| 빈 구독·끄기 | 규칙 0개 구독(POST)은 400. **`PUT /v1/push/rules/{id}`에 규칙 `[]`를 보내면 그 구독을 바로 삭제**(200 `{ok:true}`, 그 id는 이후 404 → 앱이 다시 구독) | **검증됨** |
| 보관·삭제(보관 기간 없음) | 구독은 **다음 경우에만 즉시 지워져요**: ① `DELETE /v1/push/subscribe/{id}` ② 규칙 `[]`로 PUT ③ 푸시 서비스가 404·410 ④ 연속 실패 규칙(401·403 3번·그 밖의 실패 10번·푸시를 한 번도 못 받은 구독 3번/첫 401·403). **그 밖의 자동 정리는 없어요**: 365일 정리·'꽉 차면 쉬는 구독 밀어내기'·`touched_day` 열·`subs_idle` 색인을 모두 없앴어요(데이터 최소화: 행마다 '마지막으로 쓴 날'이 없음; 남은 날짜는 마지막 발송일 `last_w`·`last_x`, 대기 표시 `pend_*`, `exp_sent`, `fails`, `claim`뿐) | **검증됨**(`worker.test.mjs` '데이터 최소화': 열 목록·색인 목록·`DELETE FROM subs` 문장 목록 고정, 21개월 된 구독도 푸시를 받음) |
| 용량 알림 | 아무도 밀어내지 않으므로 꽉 찬 표는 사람이 알아야 해요. `GET /health`는 `{"ok":true,…}`를 유지하고 `"capacity":"ok"｜"nearly_full"｜"full"`을 더해요(`stat` 카운터로 계산, `MAX_SUBS`의 80% 이상 `nearly_full`, 상한이면 `full`; 숫자는 본문에 없음). `monitor.yml`(`health_check.py`, GitHub 변수 `MONITOR_WORKER_URLS`에 이 Worker 주소가 있어야 해요)이 `capacity`가 `ok`가 아니면 경고 한 줄(알림 Worker 구독 표가 거의/가득 찼어요 — 정리하거나 `MAX_SUBS`를 올리세요)을 텔레그램으로 보내요; 필드가 없거나 `ok`면 경고 없음. `"stale":true`(공장이 2일 넘게 `finish`를 못 보냄 — `notify.mjs`가 조용히 실패해도 job은 초록이므로)도 같은 방식으로 경고 | **검증됨**(`worker.test.mjs`, `tests/security/monitor_test.py`) |
| 요청 크기 | 본문을 스트림으로 읽으며 누적 크기를 세다가 8 KB(공장 쪽 256 KB)를 넘으면 읽기를 취소하고 413. Content-Length가 없어도 같아요. 읽다 끊기면 400 | **검증됨**(node + wrangler dev) |
| SSRF(푸시 주소) | endpoint는 https + 알려진 푸시 호스트만, 포트·사용자 정보·`#fragment` 거절(쿼리는 허용: WNS `?token=`). 푸시 요청은 `redirect: 'manual'` — 3xx는 따라가지 않고 실패 1회로 셉니다 | **검증됨** |
| 로그 | 콘솔에는 개수만. IP·UA·accept-language·구독 id·endpoint는 찍지 않아요. invocation 로그는 꺼 둠(URL에 id가 있어서) | **검증됨** 두 겹: ① 정적 가드(`test/privacy.test.mjs`) — `src/*.js`·`notify.mjs`의 모든 `console.*` 호출 인자가 문자열 상수·`JSON.stringify(out)`·`e && e.message`뿐인지 확인(다른 인자가 들어오면 실패); ② 동작 시험 — 정상 흐름과 오류·남용 분기(429 레이트 리밋·예산, 503 꽉 참, 403 Origin, 400 BAD_JSON/BAD_SUBSCRIPTION/BAD_RULES/BAD_FINISH/BAD_DIGEST, 413, PUT 404, 푸시 404/410/429/3xx/네트워크 오류, D1 예외, cron 실패)를 같은 식별 헤더로 콘솔 가로채기 아래에서 돌려 IP·UA·id·endpoint가 없는지 확인(객체는 `util.format`/`inspect`로 펼쳐 검사) |
| 공장 → Worker | `/v1/internal/*`는 Bearer `ALERTS_SECRET`(상수 시간 비교). 공장이 받는 것은 (시술, 지역) 쌍뿐이고 보내는 것은 숫자뿐(필드 하나하나 검사). finish의 날짜는 Worker 시계로 정하고 공장이 보낸 today는 그 시계와 하루 안의 달력 날짜일 때만 받아요(먼 미래 날짜로 전체 삭제·`/health finished` 고정 불가) | **검증됨** |
| 공장 쪽 코드/데이터 분리 | `weekly.yml`의 `price_alerts` job은 **코드를 저장소 변수 `ALERTS_CODE_SHA`가 가리키는 커밋**(사람이 리뷰·머지한 뒤 직접 설정; 공장의 `GITHUB_TOKEN`은 Actions 변수를 바꿀 수 없어요)에서, 데이터는 main의 `app/data.json` 한 파일(일반 파일인지 확인, 심볼릭 링크 거절)만 가져와 `JSON.parse`해요. 공장이 main에 코드를 올려도(그 push는 새 실행을 일으키지 않고 다음 정기 실행의 `github.sha`가 되지만) **`github.sha`는 쓰지 않으므로** 그 코드는 이 토큰과 만나지 않아요. 변수가 비었거나 40자리 커밋 id가 아니면 job은 건너뛰고(notice), 핀이 main보다 뒤처지면 notice만 남겨요(오래된 코드는 형태 가드가 막아 무해). `ALERTS_URL`은 https만. 남는 점: 변수를 올려 주는 일은 사람 몫이고, `cf-alerts.yml` 배포는 머지된 main의 최신 커밋을 올리므로 사람이 머지 전 `git log`로 공장 push를 함께 봐야 해요 | **검증됨**(`tests/factory_worker.test.js`: `github.sha` 없음·핀 형식·두 체크아웃 `persist-credentials: false`·데이터 단계에서 아무것도 실행하지 않음; 심볼릭 링크 시뮬레이션; `notify.test.mjs`) |

남은 위험(가격 알림): 로그인이 없으므로 **한 주소(IP) 하나로도** 하루 새 구독 예산(2,000)을 먼저 써 버릴 수 있어요(레이트 리밋이 60초에 3번이면 하루 4,320번이 가능) — 그날 다른 사람의 새 구독은 429. 새 구독 하나마다 첫 푸시 시도 한 번은 받으므로(실패 뒤부터 뒤로 밀림) 하루 발송 3,080건 중 예산만큼(≤ 2,000)은 심은 구독의 첫 시도에 쓰일 수 있고, 그동안 실패한 적 있는 진짜 기기의 재시도는 그날 뒤쪽 실행으로 밀려요(심기를 매일 계속해도 그날 안에는 시도돼요; 푸시를 받은 적 있는 기기가 받은 적 없는 구독보다 먼저). 심은 구독은 첫 401·403이나 3번 실패로 지워져요. **밀어내기가 없으므로** 여러 날에 걸쳐 쓸모없는 구독이 표(8,000)를 채울 수 있어요 — 푸시를 받지 못하는 구독은 위 규칙으로 지워지지만, 푸시를 받은 적이 없고 실패도 하지 않는 구독(규칙에 맞는 소식이 없어 대기만 하는 구독)은 남아요. 그때의 답은 자동 보관 기간이 아니라 **용량 알림(`capacity`, 텔레그램)과 사람이 하는 정리 또는 `MAX_SUBS` 상향**이에요. 막는 데 드는 비용(구독 하나마다 실제 브라우저 푸시 구독)과 영향(새 구독만 막힘, 기존 구독의 푸시는 그대로)을 보고 지금은 받아들여요. 푸시 서비스에 5xx만 나는 구독(그 서비스가 같은 실행에서 아무것도 못 받음)은 실패로 세지 않으므로, 서비스가 계속 죽어 있다면 그 구독은 지워지지 않고 매 실행 칸 하나를 써요. 데이터 쪽: 한 브랜드 수집이 연속 2번 실패하면 그 브랜드는 사라진 것으로 보고, 돌아올 때 소식이 돼요(1번 실패는 소식 없음 — `ARCHITECTURE.md` D19 2수집 지연 규칙); 같은 수집일의 두 번째 재분류는 가격 변화로 읽혀요.

## 5. 비밀 정보 관리 (Phase 5)
| 비밀 | 어디에 | 원칙 |
|---|---|---|
| Supabase anon 키 | (켜면) `app/config.js` | 공개해도 되는 키예요. 모든 권한은 RLS가 판단해요. 비밀 검사가 이 키의 역할이 `anon`인지 확인해요 |
| Supabase service_role 키 | GitHub Actions secret에만 | 브라우저·저장소에 절대 두지 않아요. CI 비밀 검사로 막아요 |
| GitHub 토큰 | Actions가 실행마다 발급(`github.token`) | 작업별 최소 권한 |
| 텔레그램 봇 토큰·대화 번호 | GitHub Actions repository secret(`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)에만 | 알림 스크립트가 토큰을 출력하지 않아요(§9). `weekly.yml`의 alert job은 알림 스크립트를 **그 실행이 시작된 커밋**(`github.sha`)에서 쓰고(실행 중 공장이 push한 스크립트가 봇 토큰과 함께 돌지 않게), main에서는 `data2/report.md`·`app/data-meta.json`만 일반 파일일 때 가져와 데이터로 읽어요(아니면 그 알림을 건너뜀). 공장·배포·redeploy job이 실패하거나 중단되면 알려요. 공장 실패 문구의 '다시 돌리기' 안내는 실행 종류로 갈라요: 수집 실행(정기, skip_scrape 없는 수동)은 'skip_scrape 끄고 — 수집부터 다시', 다시 만들기 실행(push, skip_scrape)은 'skip_scrape'(고르는 값은 env로 넘기고 스크립트에 `${{ }}`를 넣지 않음) |
| Cloudflare 배포 토큰(`CLOUDFLARE_API_TOKEN`) | GitHub Actions secret에만. **지금은 repository secret**이고, 사용자가 GitHub Environment `cloudflare`(Deployment branches = main만)로 옮긴 뒤 repository secret을 지우면 그 Environment에만 있어요. 받는 곳: `weekly.yml`의 **deploy job** 배포 단계, `cf-workers.yml`(집계 Worker) — 두 job 모두 `environment: cloudflare`를 적어 둬서, 옮긴 뒤에는 이 둘(main에서 돌 때)만 토큰을 받아요 | 가격 공장(update job)은 이 토큰을 **받지 않아요**(배포 분리를 합친 뒤 시작된 실행부터). 그 job에서 수집기·pip 패키지·빌드 코드가 돌고, 같은 job 안이면 스크립트가 `unset`해도 `/proc/<pid>/environ`(스크립트·단계 셸)과 러너의 sudo로 다시 읽을 수 있기 때문이에요. deploy job은 새 러너에서 **그 실행이 시작된 커밋**(`github.sha` — 실행 중에 공장이 push해도 바뀌지 않음)의 코드(`tools/factory.sh`, `wrangler.jsonc`, `cf/admin/`, 앱 파일, `weekly.yml`의 단계)를 쓰고, 공장이 저장한 커밋에서는 만든 파일 4개(`app/data.json`·`data-meta.json`·`home.json`·`review.json`)만, 일반 파일일 때만 가져와요(심볼릭 링크면 멈춤 — wrangler가 이 러너의 파일을 올릴 수 있어서). 가져온 `data-meta.json`의 sha256·bytes가 `data.json`과, `home` 항목이 `home.json`과 다르면 멈춰요(섞인 빌드는 배포하지 않음). 그 커밋은 main에 있어야 해요. **건너뛰는 두 경우**(job은 초록, 알림 문구와 출력 `skipped`만): ① main에 그 커밋보다 **새 빌드**가 있으면 (`skipped=build`) 그 빌드를 저장한 실행이 배포해요(그 배포가 실패하면 그 실행의 alert job이 알려요). ② 그 실행이 시작된 커밋보다 **새 배포 코드**(데이터 파일 4개를 뺀 `app/`, `wrangler.jsonc`, `cf/admin/`, `tools/factory.sh`, `.github/workflows/weekly.yml`)가 있으면(`skipped=code`) **redeploy job**(`actions: write`만, checkout·비밀 없음, `github.token`만)이 main에서 Run workflow(skip_scrape)를 새로 띄워요. 그 변경이 띄운 push 실행에 기대지 않는 이유: 같은 concurrency 그룹 `weekly-prices`(`weekly.yml`·`price-check.yml`·`source-check.yml`)는 대기 실행을 하나만 두어서, 새 대기 실행(출처 검사, 빌드하지 않는 매일 정기 실행 등)이 오면 먼저 대기하던 실행이 소리 없이 취소돼요. 새로 띄운 실행은 이 실행의 alert job이 끝날 동안만 기다리고, 최신 main에서 시작하므로 자기보다 새 배포 코드가 없어 되풀이되지 않아요(공장이 저장하는 파일은 배포 코드가 아님). **Re-run:** GitHub Re-run은 그 실행의 옛 워크플로·옛 코드·옛 입력(`build2/`, `knowledge/`, `data2/`의 설정 파일, `scrape/`)을 그대로 써요. 그래서 공장(update) job의 Re-run은 첫 단계에서 거절해요(`GITHUB_RUN_ATTEMPT`가 1이 아니면 실패 — 'Re-run all jobs'도, 공장이 실패한 실행의 'Re-run failed jobs'도). deploy job만 다시 돌리기는 돼요: 위 두 경우면 건너뛰어요. 다시 만들거나 배포하려면 Run workflow(skip_scrape)를 써요(수집 실행이 실패했으면 skip_scrape 끄고). **배포 분리를 합치기 전에 시작된 실행(deploy job이 없는 실행)은 Re-run하지 않아요:** Re-run은 그 실행의 옛 `weekly.yml`·옛 `factory.sh`로 돌아서, 토큰이 다시 공장 job에 가고, 섞인 빌드 검사 없이(`pull --rebase -X theirs`) main에 push한 뒤 그 job에서 바로 배포해요. 토큰을 Environment `cloudflare`로 옮기면 그런 Re-run은 토큰을 못 받지만(옛 정의에 `environment`가 없음), 검사 없는 push는 그대로라 옮긴 뒤에도 Re-run하지 않아요. 공장은 빌드 전에 main의 최신 데이터 파일을 받아 오고(코드는 그 실행의 것), 만드는 사이 main이 그 파일을 바꾸면 push하지 않고 실패해요(섞인 빌드를 main에 올리지 않음). 다른 브랜치에서 Run workflow를 누르면 공장 job이 돌지 않아요(main만 — 그 브랜치 커밋이 main에 저장되거나 그 코드가 배포되지 않게). wrangler는 환경에 비밀이 없는 단계에서 설치(최상위 판만 고정, 같은 job이라 sudo로는 읽힘 — 차단선이 아니라 설치 스크립트가 기본으로 보는 환경에서 빼는 것)하고, 배포 단계에만 토큰을 줘요. **남는 위험:** 공장 job은 데이터를 저장하려고 main에 push할 수 있어요(contents: write, checkout이 남긴 git 인증). `price-check.yml`·`source-check.yml`도 같은 pip 패키지·수집기를 돌린 뒤 push할 수 있고, price-check는 끝에 `weekly.yml`(skip_scrape)을 바로 띄워요. 같은 실행 안에서 배포 코드가 push되면 그 실행의 deploy job은 건너뛰지만, 그 뒤 **redeploy job이 바로 띄우는 실행**의 deploy job에서 그 코드가 토큰과 함께 돌아요(몇 분 안에. 그 밖에 다음에 배포하는 실행 — 빌드하는 정기 실행, 수동 실행, PR 합친 뒤 — 도 마찬가지). 봇의 데이터 커밋에 섞일 수 있어서 `git log`는 나중에 찾는 용도이지 막는 장치가 아니에요. 워크플로 파일은 GITHUB_TOKEN으로 바꿀 수 없어요(GitHub가 막음). 토큰 권한은 Workers·D1 Edit라 계정의 Worker·D1 전체에 닿아요 redeploy가 띄운 실행은 같은 concurrency 그룹에서 대기 중이던 다른 실행(수집하는 정기 실행·수동 수집·price-check)을 대신해 취소할 수도 있어요 — 그러면 그 실행을 Run workflow로 다시 돌려요. Environment secret은 GitHub 무료 요금제에서는 공개 저장소에서만 써요(지금 공개, 2026-10-16 사용자 결정). |
| 비밀번호 화면 PIN | 해시만 `gate.js`에 | 비밀이 아니라 가림막이에요. 숫자는 저장소에 쓰지 않아요(테스트는 `APP_PIN` 환경 변수) |
| 가격 알림 VAPID 개인키 (`VAPID_PRIVATE_JWK`) | Cloudflare Worker secret(yoonsiljang-alerts)에만, 백업은 비밀번호 관리자 | `cf/alerts/vapid-keygen.mjs`가 화면에만 출력하고 파일로 남기지 않아요. 공개키는 비밀이 아님(`wrangler.jsonc`, `app/config.js`). 바꾸면 모든 구독이 다시 구독해야 해요 |
| 가격 알림 공장 토큰 (`ALERTS_SECRET`) | Worker secret + GitHub Actions secret | `weekly.yml`의 **별도 job `price_alerts`에만** 들어가요: Factory job이 끝난 뒤 **새 러너**에서 코드는 `ALERTS_CODE_SHA`로 고정한 리뷰된 커밋, 데이터는 main의 `app/data.json` 한 파일(둘 다 `persist-credentials: false`, 권한 `contents: read`), 아무것도 설치하지 않은 채 `notify.mjs`만 돌려요(환경 변수는 `ALERTS_URL`·`ALERTS_SECRET`뿐, 10분 제한). 그래서 Factory job이 실행한 코드(수집기, `pip install` 패키지)가 `$GITHUB_ENV`·`NODE_OPTIONS`·디스크의 파일로도, main에 코드를 올리는 방법으로도(main의 코드는 핀이 옮겨지기 전에는 실행되지 않음) 이 토큰을 읽을 수 없어요. `tests/factory_worker.test.js`가 확인. 토큰으로 할 수 있는 일: (시술, 지역) 쌍 읽기, 쌍의 숫자 쓰기(내용 없는 푸시 표시, 7일 제한), finish(표시·기준값 승격, 지난 날 예산 정리, `/health finished` — 날짜는 Worker 시계 기준이라 속여 고정할 수 없음). 구독을 지우거나 오래됐다는 이유로 정리하는 일은 아예 없어요. 바꿀 수 있는 것은 "누가 언제 내용 없는 푸시를 받나"뿐 — 구독·endpoint·규칙은 읽지도 쓰지도 못해요. Worker는 상수 시간 비교, 비어 있으면 503 |
| 가격 알림 배포 토큰 | 앱과 같은 `CLOUDFLARE_API_TOKEN`(GitHub Actions secret; weekly.yml·cf-alerts.yml) | 토큰 하나만 관리. 권한은 **Workers → Admin(제품 범위, 새 Worker를 만들려면 Editor로는 안 됨)** + **D1 → Edit**(마이그레이션). `cf-alerts.yml`은 wrangler를 **토큰 없는 단계에서 설치**하고 그 복사본만 토큰과 함께 돌려요(cf-workers.yml과 같은 방식). **받아들인 결과(2026-10-15):** 같은 토큰이 공장(`update`) job에도 전달되므로, 이 범위(Workers Admin + D1 Edit)의 토큰은 알림 D1의 모든 endpoint·규칙을 읽고 알림 Worker를 다시 배포(→ `VAPID_PRIVATE_JWK`·`ALERTS_SECRET` 읽기, 아무 때나 푸시)할 수 있어요. 공장 job과 알림 저장소 사이를 가르는 것은 `tools/factory.sh`가 수집기·pip 패키지 실행 전에 환경에서 토큰을 빼 두는 한 줄(배포 때만 `DEPLOY_TOKEN`으로 돌려줌)뿐이에요. 더 좁히려면 알림용 토큰(D1 Edit + Workers Scripts Edit)을 따로 만들어 `cf-alerts.yml`에만 두면 돼요 — 지금은 '토큰 하나' 결정으로 하지 않았어요 |

- **자동 비밀 검사:** `tests/security/scan_secrets.py`를 배포 전 테스트에서 매번 돌려요(**검증됨**).
  - 찾은 값은 로그에 쓰지 않아요. 공개 저장소의 CI 로그도 공개이기 때문이에요.
  - GitHub 자체 기능(secret scanning·push protection)은 이 환경에서 켤 수 없었어요. **사용자가 켜야 해요.**
- **개발·운영 분리:** Supabase 프로젝트를 둘로 나눠요(dev / prod). 키는 각각의 GitHub Environment secret에 둬요. **미해결**(프로젝트 없음).
- **노출된 자격 증명 교체:** 예전 PIN이 git 기록에 남아 있어요. 2026-10-16 사용자가 바꾸기로 정했고 도구 `tools/windows/pin.bat`이 합쳐졌어요(#81). 사용자가 PC에서 실행하고 그 PR을 합치면 끝이에요(`SECURITY_REMEDIATION.md` R-open-1, `INCIDENT_RESPONSE_PLAN.md` §2). **사용자 실행 대기.**

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
| HTTPS | 앱은 `https://yoonsiljang.lsy2825.workers.dev`(Cloudflare Workers, HTTPS만). `Strict-Transport-Security: max-age=31536000; includeSubDomains`를 보내요(`app/_headers`). 2026-10-15 모니터(A7)가 실제 응답 헤더로 **검증됨**. CSP `upgrade-insecure-requests` |
| 보안 HTTP 헤더 | Cloudflare Workers 정적 파일의 `app/_headers`(A2)로 `Content-Security-Policy: frame-ancestors 'none'`(클릭재킹), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`을 보내요. CSP 본문은 그대로 `index.html`의 meta 태그(B 소유). 2026-10-15 모니터(A7)가 실제 응답 헤더로 **검증됨**(`tests/security/headers_test.py`). 관리자 Worker(`cf/admin`)는 같은 4개를 코드에서 붙여요. GitHub Pages 시절의 `gate.js` 스크립트 완화는 뺐어요(B7 #32) |
| Content Security Policy | 스크립트는 같은 사이트만, 지도 타일은 OSM만, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. 14개 화면에서 위반 0건으로 **검증됨** |
| 의존성 검사 | 버전 고정(requirements.txt, 액션 SHA). `.github/dependabot.yml`(주간 업데이트 PR). 로그인 라이브러리는 저장소 안에 복사해 둠(MIT). Dependabot alerts·CodeQL은 **사용자가 켜야 해요** |
| 오류 모니터링 | **미해결.** 앱 오류를 모으는 곳이 없어요. 도입한다면 개인정보를 지우는 설정으로 해야 해요. 가격 공장·앱 주소 감시는 §9 |
| 트래픽 모니터링 | **미해결.** GitHub Pages는 방문 통계를 주지 않아요 |
| 자원 한도 | GitHub Pages(사이트 1 GB, 월 대역폭 약 100 GB 권장), Actions 실행 시간, Supabase 플랜 한도. 데이터 파일은 5 MB 정도예요 |
| 백업 검증 | `db-security` 워크플로가 실제 데이터로 백업→복구를 확인해요 |
| 재해 복구 | `INCIDENT_RESPONSE_PLAN.md` |

## 7-1. 관리자 주소 — 운영 현황을 Cloudflare Access 뒤로 (6.0 보안 3, A6)
지금까지 운영 현황(`#ops`: 수집 보고·신선도·수집 실행 상태·분류 검토 센터·재수집 순서·검토 큐·출처 정책·시술 설명 검수·기능 플래그)은
비밀번호 화면 뒤에 있었지만, 그 화면은 잠금일 뿐이라 일반 사용자도 볼 수 있었어요. 2026-10-15부터:

| 항목 | 설계 | 상태 |
|---|---|---|
| 관리자 주소 | Cloudflare Worker `yoonsiljang-admin`(`cf/admin/`, 무료 플랜). 공개 Worker와 **같은 `app/` 폴더**를 내주고(`assets.directory ../../app`, 빌드 하나·주소 둘), `tools/factory.sh deploy()`가 빌드마다 배포해요. 공개 Worker는 **2026-10-15부터 저장소 변수 `PUBLIC_DEPLOY`=`on`일 때만** 먼저 배포하고(그때 공개 배포 실패는 실행 실패, 관리자 배포 실패는 경고만), 공개 배포가 멈춘 동안에는 관리자 주소가 새 빌드를 받는 유일한 곳이라 **관리자 배포 실패가 실행 실패**예요(텔레그램 알림) | 코드·단위 시험 **검증됨**(`tests/factory_worker.test.js`: 가짜 wrangler로 순서·토큰·실패 처리), 배포는 **미검증**(이 환경은 Cloudflare에 닿지 않아요) |
| 실패 시 닫힘(fail closed) | 모든 요청이 `src/index.js`를 먼저 지나요(`run_worker_first`). `Cf-Access-Jwt-Assertion` 헤더를 RS256으로 검증(kid·aud·iss·exp·nbf, 인증서는 `https://<팀>.cloudflareaccess.com/cdn-cgi/access/certs`에서 1시간 캐시·분당 1회 재조회)하거나 `ctx.access.aud`가 `ACCESS_AUD`와 같을 때만 파일을 내줘요. **`ACCESS_AUD`·`ACCESS_TEAM_DOMAIN`이 비어 있으면(기본값) 전부 403** — Access를 켜기 전에 배포돼도 아무것도 안 보여요 | **검증됨**(`cf/admin/test/`: 설정 없음·헤더 없음·위조·만료·다른 aud/iss·alg none·모르는 kid → 403, 올바른 토큰·`ctx.access` → 200; `local_dev.sh`: 실제 런타임에서 403/404) |
| 보안 헤더 | Worker가 만든 응답에는 `app/_headers`가 적용되지 않아 같은 값 4개(`frame-ancestors 'none'`, HSTS 1년, `nosniff`, `strict-origin-when-cross-origin`)를 직접 붙이고, HTML은 `cache-control: no-store`(로그인이 끝난 뒤 화면이 남지 않게) | **검증됨**(단위) |
| 오프라인 사본 없음 | `/sw.js`는 404 — 관리자 주소에서는 서비스 워커가 설치되지 않아 관리자 화면이 휴대폰에 남지 않아요 | **검증됨**(단위) |
| 개인정보 | 읽는 요청 헤더는 `cf-access-jwt-assertion` 하나. IP·브라우저·쿠키·`cf` 객체는 읽지 않고, 로그 코드가 없고(`console` 금지 시험), Workers Logs·추적·preview 주소는 설정에서 꺼요 | **검증됨**(단위: 소스 금지 패턴, 설정 검사) |
| 앱 쪽 | `app/screens/ops.js`는 `location.hostname`이 `ADMIN_HOSTS`(관리자 주소, 그리고 로컬 개발·시험용 `localhost`/`127.0.0.1`)일 때만 내용을 그려요. 다른 주소에서는 "운영 현황은 관리자 주소에서만 볼 수 있어요." 한 줄만 보여주고 아무것도 가져오지 않아요(공장 `/status`·GitHub API·`review.json` 요청 0). 이건 보호가 아니라 정리예요 — 보호는 Access가 해요 | **검증됨**(`tests/security/admin_ops_browser.js`) |
| AUD·팀 도메인이 사는 곳 | `cf/admin/wrangler.jsonc`의 `vars`(비밀이 아닌 식별자). 대시보드에 넣으면 다음 `wrangler deploy`가 지우므로 파일에만 적어요 | 사용자 설정 대기 |
| 켜는 순서 | ① Zero Trust 설정(무료, 50명). 무료 플랜이어도 결제 수단 입력 화면이 나와요(청구되지 않아요) ② Workers & Pages → `yoonsiljang-admin` → **Access 탭** → "Protect this Worker behind Access" → **All traffic** → 정책은 **Cloudflare account**(이 계정의 구성원만 — 혼자 쓰는 계정이면 본인만 통과; 이메일 주소를 직접 적는 항목이 보이면 본인 주소 하나만 적어도 돼요). **Email domain에 gmail.com을 넣으면 안 돼요 — 모든 Gmail 사용자가 들어와요** → Apply Access(예전 대시보드라면 Domains 탭 / Settings → Domains & Routes → workers.dev → Enable Cloudflare Access) ③ Zero Trust → Access controls → Applications → `yoonsiljang-admin - Production` → Overview의 Application Audience (AUD) Tag와 팀 도메인을 `cf/admin/wrangler.jsonc` `vars`에 적고 다시 배포 ④ 본인 계정으로 열리면, 다른 구글 계정으로도 한 번 들어가 보세요 — 막혀야 정상이고, 열리면 정책이 Email domain으로 잡힌 거라 Zero Trust → Access controls → Applications에서 고쳐요. 로그인 뒤에도 빈 403이 나오면 Worker가 `Cf-Access-Jwt-Assertion` 헤더를 못 받는 경우 — 코드 쪽(A)에서 봐야 해요. **공개 Worker `yoonsiljang`에는 Access를 켜지 않고, Workers & Pages 첫 화면(개요)의 "Protect all Workers" 카드도 켜지 않아요**(공개 앱과 공장 관리자까지 로그인 벽 뒤로 들어가요; Access 탭에는 정책 목록만 보여요) | 사용자 작업(대시보드 경로는 2026-10-12자 Cloudflare 문서 기준) |

참고: Cloudflare 문서는 정적 파일 Worker에는 `ctx.access`가 전달되지 않는다고 적고 있어요. 그래서 실제로 동작하는 길은 헤더 JWT 검증이고,
`ctx.access`는 `wrangler dev`의 `access.dev` 시험과 나중을 위해 받아 둔 거예요. 둘 다 `ACCESS_AUD`가 비어 있으면 통하지 않아요.

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
| 가격 공장 실패·중단, Cloudflare 배포 실패, 다시 배포 요청 실패 | `weekly.yml` alert job(`needs: [update, deploy, redeploy]`, `if: always()` — 세 job 중 실패·중단이 있을 때만 보냄, 2026-10-16 #82) | 그 실행 직후 |
| 데이터 가드 발동(`data2/report.md`의 "지난 자료 유지", "수집 실패, 이전 자료도 없음", robots.txt 차단, 출처 정책 확인 실패, "지난 자료로 배포", 급변 가격 검토 대기) | `weekly.yml`(`health_check.py --report-only`) | 자료를 새로 만든 실행 직후 |
| 브랜드 수집일이 오늘(KST)보다 8일 넘게 지남, 지난 자료를 쓰는 지점 | 두 곳 모두(`app/data-meta.json`; 감시 작업은 `PUBLIC_DEPLOY`=`on`일 때 배포된 파일 우선, 공개 배포가 멈춘 동안은 저장소 파일) | 실행 직후 + 매일 |
| 공장이 26시간 넘게 성공 못함, 예약 실행이 없음, 3시간 넘게 멈춤, 마지막 실행 실패(다시 알림) | `monitor.yml`(GitHub API, `actions: read`) | 매일 09:30 KST |
| 앱 주소 200, 배포된 `data-meta.json` 읽힘(`PUBLIC_DEPLOY`=`on`일 때만 — 멈춘 동안은 건너뛰고 월요일 생존 신호에 '공개 주소 배포 멈춤 중'을 적어요) | `monitor.yml` | 매일 |
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
