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

### 가격 알림 Worker (`cf/alerts`, Cloudflare Workers Paid — 출시 요금제)
**요금제(2026-10-19 사용자 결정):** 앱은 Cloudflare Workers Paid(계정당 최소 월 $5)로 출시해요. 계정을 Workers Paid로 바꾸는 일은
`PUBLIC_DEPLOY`를 `on`으로 켜기 **전에** 해요(`ARCHITECTURE.md` D19 켜는 순서 8번). Worker의 한도는 `wrangler.jsonc`의 `PLAN`(기본 `"paid"`)이
고르는 묶음이에요 — 유료: 실행당 발송 200·구독 15,000·KST 하루 새 구독 1,500·D1 하루 계산 12; 무료(`"free"`, 9차 값): 40·2,000·500·3. 칸마다
변수로 덮어쓸 수 있고(플랫폼 한도 안), 무료 계정이 배포에서 거절하는 wrangler `limits` 칸 없이 코드가 지켜요(`src/worker.js` `PLANS`·`limits`).
유료 묶음은 모든 상한이 31일 내내 차도 계정 전체 D1 쓰기 40,890,023줄(포함 5천만의 81.8%, `cf/metrics` 상한 포함)·읽기 1,119,917,129줄(250억의
4.5%)이라 **청구액은 $5**예요(아래 '표 채우기'와 `src/worker.js` 머리 주석). 유료에서는 한도를 넘어도 멈추지 않고 돈이 들므로, 상한이 막지 않는
길(PUT·DELETE·같은 endpoint 재구독 — 100만 건에 약 $4.30, 그리고 새어 나간 `ALERTS_SECRET`으로 `digest` 되풀이)에 대비해 사용자가 Cloudflare 예산
알림(Manage Account → Billing → Billable Usage → Set Budget Alert, 예: $1, 다음 날 이메일 — 사용을 막지는 않음)을 켜요.
로그인 없는 Web Push 구독을 받는 공개 API예요. 저장하는 것: 무작위 id·푸시 endpoint·규칙(시술 key·가격·지역)·보낸 날짜 몇 개. **구독마다 '마지막으로 쓴 날'은 어디에도 없고 보관 기간도 없어요**(2026-10-15 결정). 상세·저장 항목 전체 목록: `ARCHITECTURE.md` D19.

| 통제 | 방법 | 상태 |
|---|---|---|
| 구독 남용(클라이언트별) | `POST /v1/push/subscribe`에 Rate Limiting 바인딩(`SUBS_RL`, 60초에 3번, Cloudflare 지점별). 키는 접속 IP(`cf-connecting-ip`): IPv4는 주소 그대로, **IPv6는 앞 /64**(한 사용자가 /64 전체를 받으므로 주소만 바꿔 피하지 못하게, `rules.js clientKey`). **IP는 바인딩의 메모리 카운터(60초)에만 있고 D1·로그·응답 어디에도 남지 않아요**(코드 주석 `src/worker.js`, 시험: D1에 넘긴 값과 콘솔 출력 전체에서 IP를 찾음). 형식 검사를 통과한 요청만 셉니다 | **검증됨**(node 시험, 바인딩은 가짜). 실제 바인딩 동작은 **미검증**(배포 전) |
| 구독 남용(전체) | 하루(KST) 새 구독 예산 — 무료 묶음 500개(`stat` 표 `new:날짜`; 오늘 날짜는 Worker 시계로 같은 D1 batch 안에서 `day` 줄에 적고 `subs_ins` 트리거가 그 줄로 이름을 정해요 — 구독 행은 날짜를 갖지 않아요. 유료 묶음은 1,500개 — 새 구독 한 개 약 5줄) → 넘으면 429(꽉 찼어도 예산부터 확인). 전체 상한 `MAX_SUBS` 유료 15,000·무료 2,000(무료 값은 9차 검증에서 8,000에서 낮춤 — D1 하루에 계산 3번) → 꽉 차면 **503 FULL이고 아무도 밀어내지 않아요**(밀어내기·365일 정리는 없음). 같은 endpoint 재구독은 둘 다 통과. 꽉 참은 `/health`의 `capacity`로 드러나요(아래 '용량 알림') | **검증됨**(node 시험: 꽉 찬 표가 하루·14개월 뒤에도 그대로 503, 아무도 안 지워짐) |
| 403·실패 구독 심기(남의 푸시 막기) | 큐 세 개: `CLAIM_X`·`CLAIM_W`는 실패한 적 없는 구독(fails = 0)만, `CLAIM_F`(실행당 10칸 `FAIL_SLOTS`)가 실패한 구독. **`CLAIM_F`는 푸시를 받은 적 있는 구독(진짜 기기가 한 번 실패한 경우)을 한 번도 받은 적 없는 구독(새 구독·심은 구독)보다 먼저** 시도해요(색인 `subs_fail`, 정렬 없이 색인 순서). 푸시를 받은 적 없는 구독은 **401·403을 처음 받는 순간 삭제**(다른 applicationServerKey로 만든 구독은 영원히 거절되므로 한 번 시도로 끝), 그 밖의 실패는 3번(`NEVER_DROP`); 받은 적 있는 구독은 401·403 3번·그 밖의 실패 10번이면 삭제. **푸시 서비스 쪽 문제(5xx·리다이렉트·시간 초과)는 그 서비스가 같은 실행에서 다른 푸시를 2xx로 받아 줬을 때만 그 구독의 실패로 세요** — 서비스 장애 동안 아무도 지워지지 않아요(실패 없이 미뤄 둠). **예외(4차 검토):** 푸시를 받은 적 없는 행이고 그 origin이 어느 키로도 우리 푸시에 2xx를 준 적이 없으면(`stat` `ok:` 없음) 세요 — 응답할 수 없는 지어낸 호스트에 심은 행은 3번 시도 뒤 지워져요(예전에는 세지 않고 미뤄 두기만 해서 영영 남고 `/health`에도 안 보였어요). 허용 호스트도 `notify.windows.com`·`push.services.mozilla.com` 앞 **한 단계 이름**만 받아요(`p1.x.notify.windows.com` 같은 주소는 와일드카드 인증서로 2xx를 줄 수 없음). **미뤄 두기(3차 검토, 4차 검토에서 고침):** 푸시 서비스 쪽 이유로 못 보낸 행(아래 보호로 봐준 행, 2xx가 없던 서비스의 장애, 429)은 큐에 돌려놓지 않고 claim에 '다시 시도해도 되는 분'을 음수로 적어요(`HOLD`, 180분·429는 30분). 돌아오는 길은 둘뿐이에요: 그 분이 지난 행을 **한 실행에 서비스마다 2개(`PROBES`), 모두 10개(`PROBE_SLOTS`)까지 시험 삼아**(`CLAIM_P`, 큐보다 먼저, 가장 오래 기다린 것부터), 그리고 **그 서비스가 2xx를 주면 받은 적 있는 행을 실행마다 40개(`SEND_LIMIT`)씩**(`RELEASE_HELD`, 실행의 마지막 batch; 그 실행에서 429를 준 서비스는 빼고; 받은 적 없는 행은 시험으로만 — 8차 검증: 예전에는 한 문장이 한꺼번에 최대 `MAX_SUBS`개를 풀어 그날 쓰기를 넘길 수 있었어요). 미뤄 둔 행은 색인 `subs_held`(origin·받은 적 있는지·claim)로만 찾아서, 미뤄 둔 행이 몇 개든 실행당 읽기가 정해져 있어요(시험은 origin마다 2개, 최대 64개 origin). 3차 때는 시간이 지나면 한꺼번에 풀려 다시 맨 앞을 차지해서, 그런 행이 약 720개를 넘으면 다른 푸시 서비스 기기가 7일 동안 하나도 못 받았어요(4차 검토 재현). **'우리 설정 고장' 보호는 푸시 서비스마다(2026-10-16 다시 고침):** 401·403은 실행이 끝난 뒤 판단하고, 거절이 와도 그 서비스로 보내기를 멈추지 않아요. 한 실행에서 어떤 푸시 서비스의 **이 키로 우리 푸시를 받은 적 있는 기기가 1대라도** 401·403을 내고 그 서비스가 그 실행에서 2xx를 하나도 안 주면, 거기서 거절된 받은 적 있는 기기는 그대로 미뤄 두고(실패 수 그대로, 실행마다 2개씩만 다시 시도) 받은 적 없는 구독은 실패 1번만 세요 — 실행당 대수를 세지 않으므로 소식 있는 기기가 1~2대뿐인 날에도 아무도 안 지워져요. 거절 구간이 이어지는 서비스에서는 받은 적 있는 기기가 미뤄져 있는 실행에도 받은 적 없는 구독을 지우지 않아요. **기한 7일(`REFUSING_GRACE_DAYS`, 사용자 결정):** 거절 구간의 첫날(`stat` `rs:`)부터 7일 뒤에는 평소처럼 세어 지워요(처리방침 '전달이 계속 실패하면 지움'). 구간은 그 서비스의 다음 2xx로 끝나고, 마지막 날(`stat` `rl:`)이 어제보다 오래되면(2xx 없이 끝남) 다음 거절은 새 구간이라 7일을 다시 받아요(3차 검토: 낡은 `rs:` 때문에 몇 주 뒤 진짜 고장에서 유예 0일이 되던 문제). 받은 적 있는 기기의 거절만 구간을 시작·연장해요. **키를 바꾼 뒤:** 지금 키가 그 서비스에서 처음 2xx를 받은 날(`stat` `ok:`, 그 2xx의 `SENT`와 같은 결과 batch에 씀)보다 마지막 푸시가 오래된 행은 옛 키 구독으로 보고 평소처럼 세요 → 다시 구독한 기기가 옛 행 때문에 막히지 않고 옛 행은 3번 거절 뒤 지워져요. `ok:`는 키를 바꿔도 지우지 않아요(서비스·키마다 한 줄): 잘못된 키로 한 번 돈 실행이 맞는 키의 날짜를 지우면, 되돌린 뒤 그 키로 받던 기기가 '옛 키 구독'으로 보여 다음 고장에서 보호 없이 지워졌어요(3차 검토). 같은 날 경계: 행에는 마지막 푸시의 날짜만 있어서, 지금 키가 처음 통한 날 마지막으로 받은 행은 '지금 키로 받은 행'으로 봐요. 다른 서비스는 계속 보내요. `stat`의 `refusing` → `/health` `"refusing":true`(그날과 다음 날) → 감시 경고. 심은 구독은 푸시를 받은 적이 없어 보호를 켤 수도 받을 수도 없어요. 보내기 전에 키를 서명·검증으로 확인하고(실패하면 아무 행도 잡지 않음), 행마다 예외를 잡아요. **결과는 병렬 묶음(6건)마다 바로 쓰고, D1이 거절하면 3번까지 다시 써요** — `SENT`·`RETRY`·`RELEASE`·`HOLD`는 이 실행의 claim을 아직 가진 행만 바꾸므로 다시 써도 실패 수가 두 번 오르지 않아요. 남는 빈틈: D1이 실행 내내 쓰기를 거절하거나 Worker가 묶음 도중에 끊기면 그 묶음(최대 6건)이 약 20분 뒤 다시 가요(D1이 거절하면 그 실행은 더 보내지 않음). 남는 비용: **규칙에 소식이 생긴** 새 구독만 첫 시도를 받아요. 발송 칸을 쓰게 하려는 사람이 소식이 잘 생기는 규칙을 고르면 하루 예산(2,000)만큼의 첫 시도가 쓰이고, 그동안(2,000건 ÷ 40 = 약 50회 실행) 실패한 적 있는 진짜 기기는 같은 날 뒤쪽 실행에서 다시 시도돼요(소식이 안 생기는 규칙의 구독은 시도를 받지 않음 → 아래 '남은 위험'의 표 채우기) | **검증됨**(`worker.test.mjs`: 403 구독 6개 + 정상 30개; 가장 빠른 마감의 심은 expiring 12개 + 정상 1개; **사흘 연속 매일 1,000개 심기**(403·400 절반씩) + 매일 1번 실패한 진짜 기기 20대 → 매일 20대 모두 그날 발송, 403 구독은 한 번 시도로 삭제; 푸시 서비스 장애 15번 연속 → 아무도 안 지워짐(3시간마다 시험, 사이 실행은 건드리지 않음); 한 푸시 서비스가 며칠 동안 우리 키를 거절 → 봐준 기기는 시험으로 다시 시도하고 7일 동안 아무도 안 지움·`refusing:true`·다른 서비스는 그대로, 7일 뒤에는 지움; 거절(403)·장애(503)·429 서비스의 받은 적 있는 행 45개가 큐 맨 앞 → FCM 기기는 다음 실행에 받음; **(4차) Apple의 받은 적 있는 기기 760대가 거절·장애·429 → FCM은 첫날 받고, 둘째 날 Apple 시도는 실행당 2건 이하, Apple이 돌아오면 시험 2건의 2xx로 실행마다 40대씩 풀려 760대가 그날 모두 받음; (8차) origin마다 시험 2개·받은 적 없는 행도 시험·429 서비스는 풀지 않음; 2xx를 준 적 없는 호스트에 심은 행 760개(호스트 760개 네트워크 오류, 호스트 7개 503) → FCM은 첫날 받고 심은 행은 3번씩 시도 뒤 모두 지워짐; 여러 단계 호스트 이름은 구독 400;** 2xx 없이 끝난 거절 구간 2주 뒤 새 고장 → 새 7일; 잘못된 키로 한 번 돈 뒤 되돌림 → 맞는 키의 `ok:` 유지, 다음 고장에서 기기 보호; 마지막 batch가 실패해도 첫 2xx의 `ok:`는 기록; Apple 30대 중 소식 있는 1·2·3대만 거절받는 날 → 아무도 안 지움; 키를 바꾼 뒤 API만으로 만든 '잠든 옛 키 행 8개 + 다시 구독한 20대' → 새 키 기기는 다음 주 푸시를 받고 옛 행은 지워짐; 결과 batch가 커밋 뒤 응답을 잃음 → 다시 써도 한 번만 기록, D1이 계속 거절 → 첫 묶음 뒤 더 보내지 않음; 실행 중 서명 실패·D1 예외 → 보낸 기록 유지; 짝이 안 맞는 비공개키 → 아무 행도 잡지 않고 `skipped:"keys"`) |
| 빈 구독·끄기 | 규칙 0개 구독(POST)은 400. **`PUT /v1/push/rules/{id}`에 규칙 `[]`를 보내면 그 구독을 바로 삭제**(200 `{ok:true}`, 그 id는 이후 404). 404를 받은 앱은 **B의 지금 코드(`app.js` `pushSync`)에서 다시 구독하지 않고 푸시를 '꺼짐'으로 바꿔요** — 사용자는 앱을 다시 연 뒤(그때 앱이 남은 브라우저 구독을 지워요) 켜야 해요 — 바로 켜면 옛 구독을 그대로 다시 보내요(6차 검증에서 문장 바로잡음, 9차 검증에서 다시: B의 지금 `pushSubscribe`는 남은 브라우저 구독을 그대로 다시 써요; 부탁 → B: 404에서 보낼 규칙이 남았으면 브라우저 구독을 `unsubscribe()` → 지금의 `pushPublicKey`로 새로 `subscribe()` → POST(앱을 켤 때마다 한 번만, 그것도 실패하면 '꺼짐'). '가격 알림 받기'(`pushSubscribe`)도 404를 받은 뒤이거나 브라우저에 남은 구독의 `applicationServerKey`가 지금의 `pushPublicKey`와 다르면 그 구독을 `unsubscribe()`한 뒤 새로 `subscribe()`해요. 같은 endpoint를 그대로 다시 POST하지 않아요 — 서버가 행을 지우는 대표 경우가 그 endpoint의 404·410이거나 옛 키라서 다음 발송에서 또 지워지고 화면만 '켜짐'으로 남아요, 7·8차 검증) | **검증됨** |
| 계산할 수 없는 key(5차 검증, 2026-10-16) | 공장(`notify.mjs`)은 읽은 `data.json`의 key만 계산해요. 그래서 공장이 맨 먼저 그 key 목록을 보내고(`POST /v1/internal/keys`, Bearer `ALERTS_SECRET`; 오름차순·중복 없음·`KEY_RE`·최대 `MAX_KEYS` 20,000개, 아니면 400 `BAD_KEYS`), Worker는 그것을 **`keyset` 표의 한 줄**(JSON 배열)에 **바뀔 때만** 다시 써요(같은 목록이면 0줄, 바뀌면 1줄 — 일주일에 몇 줄). ① `watched`는 그 목록에 있는 key의 쌍만 순위에 넣어요(목록을 한 번 읽는 list subquery) — 모양만 맞는 지어낸 key의 쌍이 계산되지도 않으면서 `PAIR_CAP` 자리를 영영 차지해, 아직 푸시를 받은 적 없는 진짜 기기의 쌍이 계산되지 못하던 문제(5차 검증)를 막아요. ② **구독(POST)·규칙 바꾸기(PUT)는 목록에 없는 key도 거절하지 않고 저장**하고, 답은 **약속 1 그대로**(201 `{id}`·200 `{ok:true}`)예요(6차 검증 — 5차에 넣은 400 `UNKNOWN_KEY`는 요청 전체를 거절해, B의 지금 코드에서 '받기'가 실패하고 `pushSync`가 400을 버려 같은 변경의 알림 삭제도 서버에 안 닿았어요; 7차 검증 — 6차의 정보용 `"unknown"` 칸은 B가 쓰지 않아 빼고, 약속을 글자 그대로 지켜요). 구독·PUT은 key 목록을 읽지 않아요(구독 9줄, 규칙 20개 PUT 65줄 읽기). 그런 key의 쌍은 ①로 순위에 들지 않다가, 그 key가 key 목록에 생긴 **뒤 다음 계산부터** 계산돼요(key 목록은 계산할 때마다 보내요 — 9차부터 계산은 바뀐 가격마다·하루 첫 계산, D1 하루 최대 3번). 지어낸 key 구독도 다른 구독처럼 하루 예산·`MAX_SUBS`를 써요(아래 '표 채우기' 계산 그대로). 규칙 `[]`의 PUT(삭제)은 key를 보지 않아요 | **검증됨**(`worker.test.mjs` '5th review'·'6th/7th review': 한 줄·바뀔 때만 씀, 잘못된 목록 400, 목록 전후 구독·PUT의 답이 약속 1 그대로(`{id}`·`{ok:true}`), 지어낸 key 쌍이 목록을 자르지 않음, 목록 전후의 지어낸 key 쌍 홍수 + 다음 날 구독한 진짜 기기 → 그날 공장 실행에서 계산·소식·푸시, 나중 목록에 생긴 key의 쌍은 그 key를 담은 첫 계산부터 계산; `notify.test.mjs`: 공장이 key 목록을 먼저 보냄; workerd `local_dev.sh`: PUT의 `{ok:true}`와 저장된 규칙) |
| 보관·삭제(보관 기간 없음) | 구독은 **다음 경우에만 즉시 지워져요**: ① `DELETE /v1/push/subscribe/{id}` ② 규칙 `[]`로 PUT ③ 푸시 서비스가 404·410 ④ 연속 실패 규칙(401·403 3번·그 밖의 실패 10번·푸시를 한 번도 못 받은 구독 3번/첫 401·403; 단 '우리 설정 고장'일 수 있는 푸시 서비스에서는 7일까지 아무도 안 지움 — 위 줄). **그 밖의 자동 정리는 없어요**(소식이 생기지 않는 규칙의 구독은 시도를 받지 않아 ④에도 걸리지 않고 남아요): 365일 정리·'꽉 차면 쉬는 구독 밀어내기'·`touched_day` 열·`subs_idle` 색인을 모두 없앴어요(데이터 최소화: 행마다 '마지막으로 쓴 날'이 없음; 남은 날짜는 마지막 발송일 `last_w`·`last_x`, 대기 표시 `pend_*`, `exp_sent`, `fails`, `claim`뿐 — `claim`은 보내는 동안의 시각이거나, 미뤄 둔 행을 다시 시도해도 되는 시각(음수; 그 행을 시험 삼아 다시 시도하거나 그 서비스가 2xx를 주면 지워짐)) | **검증됨**(`worker.test.mjs` '데이터 최소화': 열 목록·색인 목록·`DELETE FROM subs` 문장 목록 고정, 21개월 된 구독도 푸시를 받음) |
| 용량 알림 | 아무도 밀어내지 않으므로 꽉 찬 표는 사람이 알아야 해요. `GET /health`는 `{"ok":true,…}`를 유지하고 `"capacity":"ok"｜"nearly_full"｜"full"`을 더해요(`stat` 카운터로 계산, `MAX_SUBS`의 80% 이상 `nearly_full`, 상한이면 `full`; 숫자는 본문에 없음). `monitor.yml`(`health_check.py`, GitHub 변수 `MONITOR_WORKER_URLS`에 이 Worker 주소가 있어야 해요)이 `capacity`가 `ok`가 아니면 경고 한 줄(알림 Worker 구독 표가 거의/가득 찼어요 — 정리하거나 `MAX_SUBS`를 올리세요)을 텔레그램으로 보내요; 필드가 없거나 `ok`면 경고 없음. 같은 방식으로 경고하는 것(2026-10-16): `"stale":true`(공장이 2일 넘게 `finish`를 못 보냄, 또는 finish가 한 번도 없는데 첫 구독이 2일보다 오래됨 — `notify.mjs`가 조용히 실패해도 job은 초록이므로; 한 번도 없으면 'ALERTS_URL·ALERTS_SECRET·ALERTS_CODE_SHA 확인' 문장), `"sending":false`(VAPID 비밀값이 없거나 서명이 안 됨, 또는 `VAPID_PUBLIC_KEY`가 다른 키), `"refusing":true`(위 '우리 설정 고장' 보호가 켜짐), `"pairs":"capped"`(공장의 지켜보는 쌍 목록이 `PAIR_CAP`에서 잘렸거나 새 쌍이 그 아래 빈 자리를 기다림 — 아래 '남은 위험'의 D1 쓰기 한도), `"compute":"failed"`(10차: 이 D1 하루나 그 전 하루에 시작한 알림 계산이 끝나지 못함 — 임대가 남은 채 15분이 지남. 30분마다의 따라잡기에는 텔레그램이 없어서 이것으로 알려요)·`"compute":"deferred"`(그 사이 계산이 상한·06시 몫 때문에 미뤄짐), `"key"`가 감시 체크아웃(main)의 `app/config.js` `pushPublicKey`와 다름(그 값이 차 있을 때만; 메시지에 키 값은 없음 — 공개 배포가 멈춘 동안 실제 공개 앱의 `config.js`와는 비교하지 않아요). `/health` 본문은 낱말·날짜·공개키뿐이에요(`"plan":"paid"|"free"`도 낱말) | **검증됨**(`worker.test.mjs`, `tests/security/monitor_test.py`) |
| 요청 크기 | 본문을 스트림으로 읽으며 누적 크기를 세다가 8 KB(공장 쪽 256 KB)를 넘으면 읽기를 취소하고 413. Content-Length가 없어도 같아요. 읽다 끊기면 400 | **검증됨**(node + wrangler dev) |
| SSRF(푸시 주소) | endpoint는 https + 알려진 푸시 호스트만, 포트·사용자 정보·`#fragment` 거절(쿼리는 허용: WNS `?token=`). 푸시 요청은 `redirect: 'manual'` — 3xx는 따라가지 않고 실패 1회로 셉니다 | **검증됨** |
| 로그 | 콘솔에는 개수만. IP·UA·accept-language·구독 id·endpoint는 찍지 않아요. invocation 로그는 꺼 둠(URL에 id가 있어서) | **검증됨** 두 겹: ① 정적 가드(`test/privacy.test.mjs`) — `src/*.js`·`notify.mjs`의 모든 `console.*` 호출 인자가 문자열 상수·`JSON.stringify(out)`·`e && e.message`뿐인지 확인(다른 인자가 들어오면 실패); ② 동작 시험 — 정상 흐름과 오류·남용 분기(429 레이트 리밋·예산, 503 꽉 참, 403 Origin, 400 BAD_JSON/BAD_SUBSCRIPTION/BAD_RULES/BAD_FINISH/BAD_DIGEST/BAD_KEYS/BAD_PAGE, 413, PUT 404, 푸시 404/410/429/3xx/네트워크 오류, D1 예외, cron 실패)를 같은 식별 헤더로 콘솔 가로채기 아래에서 돌려 IP·UA·id·endpoint가 없는지 확인(객체는 `util.format`/`inspect`로 펼쳐 검사) |
| 공장 → Worker | `/v1/internal/*`는 Bearer `ALERTS_SECRET`(상수 시간 비교). 공장이 받는 것은 (시술, 지역) 쌍뿐이고(최대 `PAIR_CAP` 3,000쌍, 우리 푸시를 받은 기기가 보는 쌍 → 처음 계산한 지 7일이 안 된 쌍 → 아직 계산하지 않은 쌍 → 그보다 오래된 쌍; 새 쌍은 snap에 빈 자리가 있을 때만 들어감; 공장이 먼저 보낸 그 data.json의 key 목록(`keyset` 한 줄)에 있는 key의 쌍만 — 위 '계산할 수 없는 key') 보내는 것은 key 목록과 숫자뿐(필드 하나하나 검사). finish의 날짜는 Worker 시계로 정하고 공장이 보낸 today는 그 시계와 하루 안의 달력 날짜일 때만 받아요(먼 미래 날짜로 전체 삭제·`/health finished` 고정 불가). **부르는 횟수(9차 검증 — 2026-10-16 사용자 결정: 새 가격은 2시간 안에 계산; 10차 검증):** 배포한 `weekly.yml` 실행(정기·Run workflow·push·Re-run 모두)과 30분마다의 `alerts-catchup.yml`이 먼저 `POST /v1/internal/start {fp, nonce}`를 불러요. fp는 데이터의 지문(다이제스트가 계산에 쓰는 숫자 전부의 sha256 — 파일 바이트·시각 아님)이고 64자리 소문자 hex, nonce는 실행마다 한 번 뽑은 13자리 소문자 hex(52비트, 없어도 됨)예요 — 아니면 400 `BAD_START`. 답: 오늘 같은 지문을 끝냈으면(06:00 KST 전이면 — 따라잡기(`catchup: true`, `true` 말고 다른 값은 400)는 08:00 전이면 — 날짜와 상관없이 마지막 지문과 같으면) `done`(30줄 이하 읽기·0줄 쓰기), 이 실행의 nonce로 잡은 임대가 살아 있으면 **같은 `compute`와 같은 임대**(답이 사라져 notify가 다시 보낸 start — 다시 세지 않고 0줄 쓰기), 다른 계산이 15분 안에 시작해 안 끝났으면 `busy`(`stat` `lease`, 한 번에 하나 — 둘이 동시에 돌면 `PRUNE_SNAP`이 서로의 쌍을 지울 수 있음), D1 하루의 마지막 15분(23:45–24:00 UTC)이면 `deferred`(`edge`, 0줄 쓰기 — 계산의 쓰기가 늘 그 계산을 센 D1 하루에 들어가게), 이 UTC 하루에 이미 `COMPUTES_PER_DAY`(유료 12·무료 3)번을 셌으면 `deferred`(`cap`), 21:00 UTC 전이고 그보다 한 번 적게 셌으면 `deferred`(`reserve` — 마지막 한 번은 06:00 정기 실행 몫; 둘 다 `stat` `fd`에 그 D1 하루를 적고 그 하루 처음 미뤄진 공장 실행에만 `first: true` → 텔레그램은 D1 하루에 한 줄), 아니면 `compute`(임대·nonce·지문 꼬리표·횟수 ≤ 12줄 쓰기) → keys → watched → digest → finish {fp, lease}. 같은 지문의 계산이 이 D1 하루에 시작해 끝나지 못한 뒤(임대가 15분 넘게 남음)의 다시 계산은 **D1 하루에 한 번 세지 않아요**(`stat` `fr`; 그 죽은 시도는 finish가 커밋되지 않았으므로 digest의 7,015줄 이하) — 죽은 계산은 `stat` `cfail`로 `/health` `"compute":"failed"`에 드러나요. 그래서 우리 실행(공장·따라잡기 — 모두 `start`를 먼저 불러요, `notify.test.mjs`)은 D1 하루에 센 계산 `COMPUTES_PER_DAY`번 + 세지 않는 재시도 한 번보다 많이 하지 않아요(쓰기 상한의 근거). 상한은 예산 장치이지 토큰 경계가 아니에요: `keys`·`watched`·`digest`·`finish`는 임대를 보지 않으므로, 이 토큰을 가진 사람은 `start` 없이 `digest`로 줄을 쓸 수 있어요(아래 '가격 알림 공장 토큰' 줄 — 새면 §2처럼 바꿔요; 유료 계정에서는 그 줄이 돈이 돼요 — 예산 알림). 같은 새 수집을 finish 전에 다시 digest해도(재시도·finish 실패 뒤 다음 실행) 한 번과 같고, finish 하나가 실패한 뒤의 다음 digest + finish는 그 finish가 돌았던 길과 같은 소식·쌍을 남겨요(9차: digest는 늘 마지막 finish가 남겼을 상태 V — 대기 숫자가 있으면 그것 — 와 비교). digest의 종료일 u는 Worker 날짜 −1~+3일만 받아요(`exp_sent`가 무엇을 받아도 커지지 않음). finish는 끝난 날(KST — 몸통의 today와 Worker 날짜 중 이른 쪽, 곧 항목을 계산한 날: 10차, 자정을 넘긴 계산이 다음 날을 '이미 계산함'으로 적어 그날 계산과 끝나는 가격 푸시를 잃던 길을 막음. Worker 날짜보다 앞서 적지 않으므로 `/health finished`를 앞당겨 고정할 수 없음)과 지문 앞 52비트를 `stat` `finish`·`data`에 적고 자기 임대를 풀어요. 64자리 소문자 hex가 아닌 `fp`나 양의 정수가 아닌 `lease`는 400(`BAD_FINISH`) | **검증됨**(`worker.test.mjs` '9th/10th review (start)'·'10th review (KST midnight)'·'10th review (start nonce)'·'10th review (failed computation)'·'10th review (the 06:00 share and the D1 day's edge)'·'10th review (deferral notes)'·'9th review (a failed finish = a finish that ran)'·'7th review (DIGEST idempotent)'·'7th review (exp_sent)', `notify.test.mjs` '9th review (start)'·'10th review (a lost start answer)'·'9th review (fingerprint)'·'9th/10th review (CLI)', workerd `local_dev.sh`·`d1_reads.mjs`, 흐름 실측 `a5r10/flows10.mjs`) |
| 공장 쪽 코드/데이터 분리 | `weekly.yml`의 `price_alerts` job은 **그 실행의 deploy job이 배포한 뒤**(초록이고 건너뛰지 않음; 만들 것이 없던 정기 실행은 이미 배포된 판으로) 새 러너에서 돌고 — 30분마다의 `alerts-catchup.yml`(9차; 10차에 매시에서 30분으로)도 같은 핀 단계·데이터 단계·notify 단계(글자까지 같음, `tests/factory_worker.test.js`가 비교)로 main의 배포된 판을 써요 —, Cloudflare 토큰은 받지 않아요(`environment` 없음, `CLOUDFLARE_*` 없음 — 시험). **코드를 저장소 변수 `ALERTS_CODE_SHA`가 가리키는 커밋**(사람이 리뷰·머지한 뒤 직접 설정; 공장의 `GITHUB_TOKEN`은 Actions 변수를 바꿀 수 없어요)에서, **데이터는 deploy job이 파일을 가져온 같은 저장 커밋**(`needs.update.outputs.sha` — 지금의 main이 아님; 만들 것이 없던 날은 main)의 `app/data.json`·`app/data-meta.json` 두 파일만 받아 가져와요(6차 검증). 둘 다 git 모드 100644인 일반 파일(심볼릭 링크 거절)이고 `data.json`의 sha256·바이트가 `data-meta.json`과 같고, **공개 앱(저장소 변수 `PUBLIC_APP_URL`, 기본 `https://yoonsiljang.lsy2825.workers.dev`)이 그 같은 `data-meta.json`을 내줄 때만** 써요(`data-meta.json` 하나만 받음: https만, 리다이렉트 안 따라감, HTTP 200만, 1MB 상한, 30초 간격 3번). 아니면 `::warning`만 남기고 보내지 않아요. 공개 배포가 멈춘 동안(`PUBLIC_DEPLOY`가 `on`이 아님)은 계산하지 않아요(notice). 파일은 `JSON.parse`만 해요. 그래서 공개 앱에 닿지 않은 빌드의 숫자로 푸시가 나가지 않아요. 이 단계들에는 비밀값이 없어요. main 체크아웃은 `cf/alerts`·`app/domain`만 받아 '핀보다 main이 새롭다' 안내에만 써요. 공장이 main에 코드를 올려도(그 push는 그 뒤에 시작되는 실행의 `github.sha`가 되지만 — deploy-job PR 뒤에는 배포 코드 push면 redeploy job이 몇 분 안에 띄우는 실행도 포함) **`github.sha`는 쓰지 않으므로** 그 코드는 이 토큰과 만나지 않아요. 변수가 비었거나 40자리 커밋 id가 아니면 job은 건너뛰고(notice), 핀이 main보다 뒤처지면 notice만 남겨요(오래된 코드는 형태 가드가 막아 무해). `ALERTS_URL`은 https만. 남는 점: 변수를 올려 주는 일은 사람 몫이에요. 그리고 `cf-alerts.yml` 배포는 **그 실행의 main 최신 커밋**을 올려요(deploy job의 '시작 커밋보다 새 배포 코드면 건너뜀' 같은 검사는 없음): 공장의 `GITHUB_TOKEN`이 main에 올린 `cf/alerts` 코드는 다음 사람 머지(`cf-alerts.yml`의 paths — `app/app.js`·`app/domain/**` 등) 때 Cloudflare 토큰으로 배포돼 `VAPID_PRIVATE_JWK`·`ALERTS_SECRET`·endpoint에 닿을 수 있어요 — deploy job과 같은 남는 위험(§5 'Cloudflare 배포 토큰' 줄)이에요. `git log`로 공장 push를 보는 것은 **나중에 찾는 용도이지 막는 장치가 아니에요**(봇의 데이터 커밋에 섞일 수 있음). 사용자 재승인 항목(발견 1·17)에 이 길도 이름으로 적었어요 | **검증됨**(`tests/factory_worker.test.js`: `needs: [update, deploy]`와 실행 조건 그대로·`environment`·`CLOUDFLARE_*` 없음·`github.sha` 없음·핀 형식·세 체크아웃 `persist-credentials: false`·데이터는 `needs.update.outputs.sha`의 두 파일·curl 옵션·공개 앱의 sha256이 같을 때만 옮김·notify 단계에 모드 없음(9차: 모든 실행이 같고 Worker의 start가 정함)·`deferred` 출력과 텔레그램 한 줄·`alerts-catchup.yml`의 핀·데이터·notify 단계가 `weekly.yml`과 글자까지 같음·notify 단계에 `continue-on-error` 없음(실패·시간 초과면 끝 표시가 안 찍힘)·`alert` job이 이 job을 기다리고 끝나지 못한 job을 알림; which·data 단계를 적힌 그대로 진짜 git 체크아웃과 가짜 curl로 돌림 — 배포 커밋/main/잘못된 sha/공개 배포 멈춤, 일치·다른 빌드 3번·재시도 중 회복·네트워크 오류·302·404·JSON 아님·커밋 안의 짝 불일치·심볼릭 링크(모드 120000)·잘못된 `PUBLIC_APP_URL`; `notify.test.mjs`). 실제 Actions 실행·공개 주소로는 **미검증** |

남은 위험(가격 알림): 로그인이 없으므로 **한 주소(IP) 하나로도** 하루 새 구독 예산(유료 1,500·무료 500)을 먼저 써 버릴 수 있어요(레이트 리밋이 60초에 3번이면 하루 4,320번이 가능) — 그날 다른 사람의 새 구독은 429. 규칙에 소식이 생긴 새 구독은 첫 푸시 시도 한 번을 받으므로(실패 뒤부터 뒤로 밀림), 소식이 잘 생기는 규칙으로 심으면 하루 발송(유료 15,400·무료 3,080건) 중 예산만큼(유료 ≤ 1,500·무료 ≤ 500)이 심은 구독의 첫 시도에 쓰일 수 있고, 그동안 실패한 적 있는 진짜 기기의 재시도는 그날 뒤쪽 실행으로 밀려요(심기를 매일 계속해도 그날 안에는 시도돼요; 푸시를 받은 적 있는 기기가 받은 적 없는 구독보다 먼저). 시도를 받은 심은 구독만 첫 401·403이나 3번 실패로 지워져요.
**표 채우기(2026-10-16 고쳐 씀 — 사용자 재확인 필요):** 드는 비용은 **브라우저 없이 HTTP POST 한 번**이에요. 허용된 푸시 호스트의 지어낸 주소(예: `https://fcm.googleapis.com/fcm/send/<아무 글자>`; p256dh·auth는 모양만 검사)와 소식이 생기지 않을 규칙(예: 아주 낮은 `max`의 target)이면 돼요. 그런 행은 **푸시 시도를 한 번도 받지 않으므로 실패도 쌓이지 않아 영영 지워지지 않아요.** IP 하나로도 `MAX_SUBS` ÷ `NEW_PER_DAY` = 유료 15,000 ÷ 1,500 = **10일**(무료 묶음 2,000 ÷ 500 = 4일)이면 표가 차요(그 뒤 새 구독은 503 FULL). **'기존 구독의 푸시는 그대로'라고 예전에 적었던 것은 틀렸어요(2026-10-16 검토 발견, 사용자 재확인 필요):** 심은 행의 규칙(서로 다른 key 20개)이 공장의 digest를 쌍마다 하루 1줄씩 D1에 쓰게 해서, 약 5,000개(표의 62%, `capacity`는 아직 `ok`)면 하루 약 100,000줄 — D1 무료 쓰기 한도는 **계정 전체**이고 넘으면 09:00 KST까지 **모든 D1 쿼리**(finish·발송·구독, `cf/metrics`까지)가 실패해 날마다 알림 전체가 멈출 수 있었어요. 지금은 Worker가 공장에 주는 쌍을 **`PAIR_CAP`(3,000, 사용자 결정)**에서 자르고(우리 푸시를 받은 기기가 보는 쌍 → 처음 계산한 지 7일(`PAIR_KEEP_DAYS`)이 안 된 쌍 → 아직 계산하지 않은 쌍 → 그보다 오래된 쌍: 새 쌍이 이번 주 목록을 밀어내지 못하고, 먼저 채운 쪽이 목록을 영영 차지하지도 못함), 새 쌍은 snap에 `PAIR_CAP`보다 적은 행이 있을 때만 넣어요(finish가 지운 자리는 다음 계산부터 빔 — 계산 한 번이 목록을 통째로 넣고 빼지 못함; 하루에 목록이 통째로 바뀌지 않게 하는 것은 `WATCHED` 순위의 `PAIR_KEEP_DAYS`예요). 공장이 계산할 수 있는 key(그 data.json의 key 목록)의 쌍만 순위에 들어요(다른 key의 규칙은 저장되지만 계산되지 않음 — 위 '계산할 수 없는 key') → 전부 계산 한 번의 snap 쓰기 ≤ 2 × (3,000 + 500) = 7,000줄(순서와 무관하게 빈 자리 검사가 지킴). **공장이 부르는 횟수(6차 → 9차 → 10차 검증):** `weekly.yml`은 main에 push가 있을 때마다 돌아요(10-15 UTC 26번·10-16 UTC 29번). 6차까지는 그때마다 전부 계산해 29번이면 공장 쓰기만 약 90,000줄이었고, 6~8차는 정기 실행만 계산했어요(새 가격이 최대 약 20시간 기다림). **9차부터(2026-10-16 사용자 결정: 새 가격은 2시간 안에 계산)** 배포한 실행과 따라잡기(`alerts-catchup.yml`, 10차부터 30분마다)가 먼저 지문을 `start`에 묻고 — 오늘 끝낸 가격이면 `done`(30줄 이하 읽기·0줄 쓰기) — 계산은 **D1 하루에 `COMPUTES_PER_DAY`번(유료 12·무료 3)**까지 세요(21:00 UTC 전에는 한 번 적게 — 06시 몫, D1 하루의 마지막 15분에는 시작하지 않음, 같은 가격의 죽은 계산을 다시 하는 것은 하루 한 번 세지 않음 — 위 '공장 → Worker' 줄). **최악 쓰기**(로컬 D1에서 문장마다 잰 값, `src/worker.js` 머리 주석; 발송 실행 77번, 계산 한 번 = 구독 × 5 + snap 7,000 + `stat` ≤ 20, 세지 않는 재시도의 죽은 첫 시도 ≤ 7,015): **무료**(D1 하루 100,000줄) 발송 24,640(3,080건 × 푸시 한 건 최대 8줄) + 시험 claim 770 + 앞날에 미뤄 둔 행 풀기 6,160 + 새 구독 5,006(D1 하루에 KST 예산 이틀치) + 미룸 기록 2 + 계산 3번 × 17,020 + 죽은 시도 7,015 = **94,653줄(5.3% 남음)**; **유료**(31일 달 5천만 줄) 발송 123,200(15,400건 × 8) + 770 + 풀기 30,800 + 새 구독 15,006 + 2 + 계산 12번 × 82,020 + 7,015 + 다시 보낸 digest 묶음 78,000 = 하루 1,239,033줄, 같은 계정의 `cf/metrics` 상한(하루 80,000줄)을 더해 × 31일 = **40,890,023줄(81.8%)** → 청구액 $5. 로컬 D1 실측(10차, 매번 모든 폰 다시 표시): 무료 구독 2,000으로 계산 3번 16,008 + 14,007 + 16,008줄, 유료 구독 15,000으로 81,008 + 66,007 + 81,008줄. 계산에 없는 것(무료): D1이 이미 받은 digest 묶음을 공장이 다시 보낼 때(묶음마다 500줄 이하·2번 더까지 — 남는 5,347줄이 한 계산의 묶음을 한 번 더 받아 줘요). **최악 읽기**(구독 × 규칙 20개를 계산된 3,000쌍에 몰고 모두 expiring인 가장 나쁜 모양): 계산 한 번 ≤ 무료 336,650·유료 2,312,650줄 + 죽은 시도 + 발송 실행 77번 × (2 × 구독 + 34 + 미뤄 둔 행 1,383 + 풀기) + expiring이 실린 푸시 × 241(`SENT`: `exp_sent`는 종료일 4개 안이라 80개, 규칙을 바꾼 폰도 최근 4일의 푸시가 알린 100개 안 + `pend_xl` 20) + 그 KST 날 첫 finish 전 발송의 `DROP_ENDED` 77 × 구독 + 새 구독 × 9 + `start` ≤ 120 × 30 = **무료 D1 하루 2,467,769줄 / 5M(50.6% 남음)**, **유료 31일 달 1,119,917,129줄 / 250억(4.5%)**. 9차·8차의 숫자는 `ARCHITECTURE.md` D19의 이력 문장에만 남겨 두었어요(지금 코드의 숫자가 아님). PUT·DELETE·같은 endpoint 재구독과 같은 계정 한도를 나눠 쓰는 `cf/metrics`(스팸 날 최대 80,000줄 — 유료 계산에는 넣음)는 무료 계산 밖이라, **무료로 돌리면 둘을 합쳐 여전히 하루 한도를 넘을 수 있어요**. 유료에서는 넘어도 멈추지 않고 PUT 등 100만 건에 약 $4.30이 들어요(남는 910만 줄 뒤) — 예산 알림. **사용자 결정 필요:** 위 숫자(유료 200·15,000·1,500·12, 무료 40·2,000·500·3은 A가 고른 값), 예산 알림 금액, metrics 상한, 손잡이 `PLAN`·`NEW_PER_DAY`·`MAX_SUBS`·`COMPUTES_PER_DAY`. 잘리거나 새 쌍이 빈 자리를 기다린 날은 `/health` `"pairs":"capped"` → 감시 경고. 남는 점: 심은 구독이 **실제 key**(data.json에 있는 key — 지역 18개를 곱하면 쌍은 충분히 많아요)로 상한을 채우면, 아직 푸시를 받은 적 없는 진짜 새 구독의 쌍은 심은 쌍이 들어온 지 7일이 지나고 빈 자리가 날 때까지(공장 실행 하루 더) 계산되지 않아 그동안 소식을 못 받아요(4차 검토 전에는 정리하기 전까지 영영이었어요). 지어낸 key로는 이제 자리를 차지할 수 없어요(5차 검증). 심는 쪽이 날마다 더 많은 기기 수로 새 쌍을 계속 넣으면 자리를 두고 다툴 수 있어요 — 로그인이 없어 심은 쌍과 가를 수 없고, 답은 `PAIR_CAP` 조정이나 정리예요: 먼저 좁은 정리 쿼리(아래), 넓은 정리 쿼리는 진짜 기기도 함께 지워지므로 사용자 결정 뒤에만. 행에 날짜가 없어 '오래된 것부터 정리'는 할 수 없어요. 답은 자동 보관 기간이 아니라 **용량 알림(`capacity`, 텔레그램)과 사람이 하는 정리 또는 `MAX_SUBS` 상향**이에요. `NEW_PER_DAY`를 낮추면 채우는 데 더 걸려요(예: 유료에서 500이면 30일, 그 전에 `nearly_full` 경고) — 대신 진짜 새 구독이 몰리는 날 더 일찍 429가 나요.
**정리 쿼리(사람이 — Cloudflare 대시보드 → D1 → `yoonsiljang-alerts` → Console; 5차 검증에서 둘로 나눔. 시험: `worker.test.mjs` '4th/5th/6th review (cleanup queries)'가 이 문단의 네 쿼리를 그대로 읽어 돌리고 6차의 주의 문장도 확인해요):**
- ① **좁은 쿼리 — `pairs:"capped"` 경고 때 후보, key가 최근 바뀌었으면(재분류 직후) 사용자 결정 뒤에만:** 세기 `SELECT count(*) FROM subs WHERE last_w IS NULL AND last_x IS NULL AND (claim IS NULL OR claim < 0) AND EXISTS (SELECT 1 FROM keyset) AND NOT EXISTS (SELECT 1 FROM keyset ks, json_each(subs.rules) j WHERE instr(ks.keys, '"' || (j.value->>'$.key') || '"') > 0);`, 지우기 `DELETE FROM subs WHERE last_w IS NULL AND last_x IS NULL AND (claim IS NULL OR claim < 0) AND EXISTS (SELECT 1 FROM keyset) AND NOT EXISTS (SELECT 1 FROM keyset ks, json_each(subs.rules) j WHERE instr(ks.keys, '"' || (j.value->>'$.key') || '"') > 0);`. 뜻: 규칙의 key가 **하나도** 공장의 지금 key 목록에 없고, 푸시를 한 번도 받지 않았고, 지금 보내는 중이 아닌 구독만. key 목록이 아직 없으면(공장이 한 번도 안 돎) 아무것도 지우지 않아요. 이런 행은 계산할 쌍이 없어 지금은 소식도 푸시도 생길 수 없어요. key 하나라도 목록에 있는 구독과 푸시를 받은 적 있는 휴대폰은 건드리지 않아요. **주의(6차 검증):** 이 쿼리가 고르는 행에는 심은 행만 있는 게 아니에요 — **재분류(data.json `meta.recl`) 뒤 며칠은 진짜 휴대폰도 들어요.** key는 자주 바뀌어요(10-15 다시 빌드 한 번에 906개가 빠지고 726개가 생김, 10-16에도 18/25·8/5개). 앱은 재분류된 알림을 새 key로 옮기지만(`app.js`), 그 휴대폰이 앱을 열기 전까지 서버의 행은 옛 key만 갖고 있어요. 며칠만 빠졌다 돌아오는 key도 같아요(쿼리를 쓰지 않으면 돌아온 날 다시 계산돼요). 이런 휴대폰을 지우면 알림이 조용히 끊기고, 다음 PUT에서 404를 받은 앱(B의 지금 코드)은 **다시 구독하지 않고 푸시를 '꺼짐'으로 바꿔요** — 사용자는 앱을 다시 연 뒤(그때 앱이 남은 브라우저 구독을 지워요) 켜야 해요 — 바로 켜면 옛 구독을 그대로 다시 보내요(부탁 → B: 404에서 보낼 규칙이 남았으면 브라우저 구독을 `unsubscribe()` → 지금의 `pushPublicKey`로 새로 `subscribe()` → POST(앱을 켤 때마다 한 번만, 그것도 실패하면 '꺼짐'). '가격 알림 받기'(`pushSubscribe`)도 404를 받은 뒤이거나 브라우저에 남은 구독의 `applicationServerKey`가 지금의 `pushPublicKey`와 다르면 그 구독을 `unsubscribe()`한 뒤 새로 `subscribe()`해요. 같은 endpoint를 그대로 다시 POST하지 않아요). 그래서 쓰기 전에 최근 `meta.recl` 날짜를 보고, 며칠 안에 재분류가 있었으면 사용자 결정 뒤에만 써요.
- ② **넓은 쿼리 — 사용자 결정 뒤에만:** 세기 `SELECT count(*) FROM subs WHERE last_w IS NULL AND last_x IS NULL AND (claim IS NULL OR claim < 0);`, 지우기 `DELETE FROM subs WHERE last_w IS NULL AND last_x IS NULL AND (claim IS NULL OR claim < 0);`. 뜻: **푸시를 한 번도 받지 않은 구독 모두** — 소식이 없는 것, 소식이 기다리는 것(`pend_w`=1·`pend_x`), 실패가 쌓이는 것, 푸시 서비스 문제로 미뤄 둔 것(claim < 0)까지. 지금 보내는 중인 행(claim > 0)과 푸시를 받은 적 있는 휴대폰은 건드리지 않아요. **부작용:** 구독했지만 아직 푸시를 한 번도 못 받은 **진짜 휴대폰도 함께 지워져요** — 첫 소식이 막 생겨 기다리던 휴대폰, 첫 푸시 때 푸시 서비스가 잠깐 죽어 미뤄진 휴대폰, 표가 차서 쌍이 아직 계산되지 않은 휴대폰도요. **출시 초기에는 구독자 거의 모두가 아직 푸시를 받기 전이라 실제 구독자 전부가 지워질 수 있어요.** 그래서 `pairs:"capped"`나 `capacity` 경고가 와도 좁은 쿼리와 `PAIR_CAP`·`MAX_SUBS` 조정을 먼저 보고, 이 넓은 쿼리는 사용자 결정을 받은 뒤에만 써요. 로그인이 없어서 심은 구독과 구분할 수 없어요. 그 휴대폰은 알림이 끊긴 것을 모르고, 알림 목록을 바꿀 때에야(PUT → 404) 앱이 '꺼짐'으로 보여 사람이 다시 켜야 해요.

지운 행은 D1 시점 복구(Time Travel)에 무료 플랜 기준 7일 남아요(`INCIDENT_RESPONSE_PLAN.md` §7). `stat`의 `subs` 카운터는 트리거가 줄여 `capacity`도 따라 내려가요. 남는 점: 우리 푸시를 받은 적 있는 서비스(`ok:`가 있는 곳)가 **영영** 죽으면 거기서 받은 적 있는 휴대폰은 실패로 세지 않아 지워지지 않고, 실행마다 그 서비스 몫으로 시험 2칸(`PROBES`, 전체 `PROBE_SLOTS` 10칸 안)을 써요 — 사람이 그 서비스 주소로 골라 지워야 해요(`DELETE FROM subs WHERE endpoint LIKE 'https://<그 호스트>/%';`). 데이터 쪽: 한 브랜드 수집이 연속 2번 실패하면 그 브랜드는 사라진 것으로 보고, 돌아올 때 소식이 돼요(1번 실패는 소식 없음 — `ARCHITECTURE.md` D19 2수집 지연 규칙); 같은 수집일의 두 번째 재분류는 가격 변화로 읽혀요.

## 5. 비밀 정보 관리 (Phase 5)
| 비밀 | 어디에 | 원칙 |
|---|---|---|
| Supabase anon 키 | (켜면) `app/config.js` | 공개해도 되는 키예요. 모든 권한은 RLS가 판단해요. 비밀 검사가 이 키의 역할이 `anon`인지 확인해요 |
| Supabase service_role 키 | GitHub Actions secret에만 | 브라우저·저장소에 절대 두지 않아요. CI 비밀 검사로 막아요 |
| GitHub 토큰 | Actions가 실행마다 발급(`github.token`) | 작업별 최소 권한 |
| 텔레그램 봇 토큰·대화 번호 | GitHub Actions repository secret(`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)에만 | 알림 스크립트가 토큰을 출력하지 않아요(§9). `weekly.yml`의 alert job은 알림 스크립트를 **그 실행이 시작된 커밋**(`github.sha`)에서 쓰고(실행 중 공장이 push한 스크립트가 봇 토큰과 함께 돌지 않게), main에서는 `data2/report.md`·`app/data-meta.json`만 일반 파일일 때 가져와 데이터로 읽어요(아니면 그 알림을 건너뜀). 공장·배포·redeploy job이 실패하거나 중단되면 알려요. 공장 실패 문구의 '다시 돌리기' 안내는 실행 종류로 갈라요: 수집 실행(정기, skip_scrape 없는 수동)은 'skip_scrape 끄고 — 수집부터 다시', 다시 만들기 실행(push, skip_scrape)은 'skip_scrape'(고르는 값은 env로 넘기고 스크립트에 `${{ }}`를 넣지 않음) |
| Cloudflare 배포 토큰(`CLOUDFLARE_API_TOKEN`) | GitHub Actions secret에만. **지금은 repository secret**이고, 사용자가 GitHub Environment `cloudflare`(Deployment branches = main만)로 옮긴 뒤 repository secret을 지우면 그 Environment에만 있어요. 받는 곳: `weekly.yml`의 **deploy job** 배포 단계, `cf-workers.yml`(집계 Worker) — 두 job 모두 `environment: cloudflare`를 적어 둬서, 옮긴 뒤에는 이 둘(main에서 돌 때)만 토큰을 받아요 | 가격 공장(update job)은 이 토큰을 **받지 않아요**(배포 분리를 합친 뒤 시작된 실행부터). 그 job에서 수집기·pip 패키지·빌드 코드가 돌고, 같은 job 안이면 스크립트가 `unset`해도 `/proc/<pid>/environ`(스크립트·단계 셸)과 러너의 sudo로 다시 읽을 수 있기 때문이에요. deploy job은 새 러너에서 **그 실행이 시작된 커밋**(`github.sha` — 실행 중에 공장이 push해도 바뀌지 않음)의 코드(`tools/factory.sh`, `wrangler.jsonc`, `cf/admin/`, 앱 파일, `weekly.yml`의 단계)를 쓰고, 공장이 저장한 커밋에서는 만든 파일 4개(`app/data.json`·`data-meta.json`·`home.json`·`review.json`)만, 일반 파일일 때만 가져와요(심볼릭 링크면 멈춤 — wrangler가 이 러너의 파일을 올릴 수 있어서). 가져온 `data-meta.json`의 sha256·bytes가 `data.json`과, `home` 항목이 `home.json`과 다르면 멈춰요(섞인 빌드는 배포하지 않음). 그 커밋은 main에 있어야 해요. **건너뛰는 두 경우**(job은 초록, 알림 문구와 출력 `skipped`만): ① main에 그 커밋보다 **새 빌드**가 있으면 (`skipped=build`) 그 빌드를 저장한 실행이 배포해요(그 배포가 실패하면 그 실행의 alert job이 알려요). ② 그 실행이 시작된 커밋보다 **새 배포 코드**(데이터 파일 4개를 뺀 `app/`, `wrangler.jsonc`, `cf/admin/`, `tools/factory.sh`, `.github/workflows/weekly.yml`)가 있으면(`skipped=code`) **redeploy job**(`actions: write`만, checkout·비밀 없음, `github.token`만)이 main에서 Run workflow(skip_scrape)를 새로 띄워요. 그 변경이 띄운 push 실행에 기대지 않는 이유: 같은 concurrency 그룹 `weekly-prices`(`weekly.yml`·`price-check.yml`·`source-check.yml`)는 대기 실행을 하나만 두어서, 새 대기 실행(출처 검사, 빌드하지 않는 매일 정기 실행 등)이 오면 먼저 대기하던 실행이 소리 없이 취소돼요. 새로 띄운 실행은 이 실행의 alert job이 끝날 동안만 기다리고, 최신 main에서 시작하므로 자기보다 새 배포 코드가 없어 되풀이되지 않아요(공장이 저장하는 파일은 배포 코드가 아님). **Re-run:** GitHub Re-run은 그 실행의 옛 워크플로·옛 코드·옛 입력(`build2/`, `knowledge/`, `data2/`의 설정 파일, `scrape/`)을 그대로 써요. 그래서 공장(update) job의 Re-run은 첫 단계에서 거절해요(`GITHUB_RUN_ATTEMPT`가 1이 아니면 실패 — 'Re-run all jobs'도, 공장이 실패한 실행의 'Re-run failed jobs'도). deploy job만 다시 돌리기는 돼요: 위 두 경우면 건너뛰어요. 다시 만들거나 배포하려면 Run workflow(skip_scrape)를 써요(수집 실행이 실패했으면 skip_scrape 끄고). **배포 분리를 합치기 전에 시작된 실행(deploy job이 없는 실행)은 Re-run하지 않아요:** Re-run은 그 실행의 옛 `weekly.yml`·옛 `factory.sh`로 돌아서, 토큰이 다시 공장 job에 가고, 섞인 빌드 검사 없이(`pull --rebase -X theirs`) main에 push한 뒤 그 job에서 바로 배포해요. 토큰을 Environment `cloudflare`로 옮기면 그런 Re-run은 토큰을 못 받지만(옛 정의에 `environment`가 없음), 검사 없는 push는 그대로라 옮긴 뒤에도 Re-run하지 않아요. 공장은 빌드 전에 main의 최신 데이터 파일을 받아 오고(코드는 그 실행의 것), 만드는 사이 main이 그 파일을 바꾸면 push하지 않고 실패해요(섞인 빌드를 main에 올리지 않음). 다른 브랜치에서 Run workflow를 누르면 공장 job이 돌지 않아요(main만 — 그 브랜치 커밋이 main에 저장되거나 그 코드가 배포되지 않게). wrangler는 환경에 비밀이 없는 단계에서 설치(최상위 판만 고정, 같은 job이라 sudo로는 읽힘 — 차단선이 아니라 설치 스크립트가 기본으로 보는 환경에서 빼는 것)하고, 배포 단계에만 토큰을 줘요. **남는 위험:** 공장 job은 데이터를 저장하려고 main에 push할 수 있어요(contents: write, checkout이 남긴 git 인증). `price-check.yml`·`source-check.yml`도 같은 pip 패키지·수집기를 돌린 뒤 push할 수 있고, price-check는 끝에 `weekly.yml`(skip_scrape)을 바로 띄워요. 같은 실행 안에서 배포 코드가 push되면 그 실행의 deploy job은 건너뛰지만, 그 뒤 **redeploy job이 바로 띄우는 실행**의 deploy job에서 그 코드가 토큰과 함께 돌아요(몇 분 안에. 그 밖에 다음에 배포하는 실행 — 빌드하는 정기 실행, 수동 실행, PR 합친 뒤 — 도 마찬가지). 봇의 데이터 커밋에 섞일 수 있어서 `git log`는 나중에 찾는 용도이지 막는 장치가 아니에요. 워크플로 파일은 GITHUB_TOKEN으로 바꿀 수 없어요(GitHub가 막음). 토큰 권한은 Workers·D1 Edit라 계정의 Worker·D1 전체에 닿아요 redeploy가 띄운 실행은 같은 concurrency 그룹에서 대기 중이던 다른 실행(수집하는 정기 실행·수동 수집·price-check)을 대신해 취소할 수도 있어요 — 그러면 그 실행을 Run workflow로 다시 돌려요. Environment secret은 GitHub 무료 요금제에서는 공개 저장소에서만 써요(지금 공개, 2026-10-16 사용자 결정). |
| 비밀번호 화면 PIN | 해시만 `gate.js`에 | 비밀이 아니라 가림막이에요. 숫자는 저장소에 쓰지 않아요(테스트는 `APP_PIN` 환경 변수) |
| 가격 알림 VAPID 개인키 (`VAPID_PRIVATE_JWK`) | Cloudflare Worker secret(yoonsiljang-alerts)에만 | **`cf-alerts.yml`의 키 설정(Run workflow → `setup_keys`, main에서만, 2026-10-16)**이 GitHub 러너 안에서 키 쌍을 만들고(`node cf/alerts/vapid-keygen.mjs --put`), 비공개키는 `wrangler secret put`의 stdin으로만 넘겨요 — 인자·파일·로그 어디에도 없고, Actions에서는 맨 먼저 `::add-mask::`로 가려요(가린 줄이 로그에 안 보인다는 것은 GitHub 문서 기준, 실제 실행으로는 미확인). 그래서 **복사본이 어디에도 없어요**(Cloudflare 비밀값은 다시 읽을 수 없음). 잃거나 새면 새 쌍으로 바꾸고 모든 휴대폰이 다시 구독해요(`INCIDENT_RESPONSE_PLAN.md` §2). Worker에 이미 키가 있으면 `replace_keys`를 함께 고르지 않는 한 거절해요. 내 PC에서 `node cf/alerts/vapid-keygen.mjs`를 그냥 돌리면 화면에만 출력해요(파일 없음, Actions에서는 거절) — 그 길로 넣을 때만 비밀번호 관리자에 백업. 공개키는 비밀이 아님: Worker가 비공개키에서 계산해 `/health`의 `key`로 보여 주고, B가 `app/config.js` `pushPublicKey`에 넣어요(`wrangler.jsonc` `VAPID_PUBLIC_KEY`는 비워 둠 — 채우면 같은 키여야 하고 정적 시험이 `config.js`와도 비교) |
| 가격 알림 공장 토큰 (`ALERTS_SECRET`) | GitHub Actions secret(사용자가 만듦: 32자 이상, 띄어쓰기 없는 인쇄 가능한 글자) + Worker secret(`cf-alerts.yml` 키 설정이 같은 값을 stdin으로 복사. 처음 뒤에 값만 바꿀 때는 Run workflow의 `sync_secret` — VAPID 키는 그대로, `INCIDENT_RESPONSE_PLAN.md` §2) | `weekly.yml`의 **별도 job `price_alerts`의 notify 단계**와 30분마다의 `alerts-catchup.yml`의 같은 notify 단계에만 들어가요: deploy job이 배포한 뒤(만들 것이 없던 정기 실행은 이미 배포된 판으로) **새 러너**에서 코드는 `ALERTS_CODE_SHA`로 고정한 리뷰된 커밋(`persist-credentials: false`, 권한 `contents: read`, Cloudflare 토큰 없음), 데이터는 deploy job이 쓴 같은 저장 커밋의 `data.json`을 공개 앱의 `data-meta.json`과 맞춰 본 것(위 '공장 쪽 코드/데이터 분리'), 아무것도 설치하지 않은 채 `notify.mjs`만 돌려요(그 단계의 환경 변수는 `ALERTS_URL`·`ALERTS_SECRET`뿐, 단계 10분·job 20분 제한; 따라잡기 job도 비밀값은 이 둘뿐이고 텔레그램·Cloudflare 토큰 없음). 그래서 공장(`update`) job이 실행한 코드(수집기, `pip install` 패키지)가 `$GITHUB_ENV`·`NODE_OPTIONS`·디스크의 파일로도, main에 코드를 올리는 방법으로도(main의 코드는 핀이 옮겨지기 전에는 실행되지 않음) 이 토큰을 읽을 수 없어요. 그 밖에 받는 곳은 `cf-alerts.yml`의 키 설정·`sync_secret` 단계(`printf` → stdin, main만)뿐. `tests/factory_worker.test.js`·`notify.test.mjs`가 확인. **토큰으로 할 수 있는 일(2026-10-16 고쳐 씀):** (시술, 지역) 쌍 읽기, 쌍의 숫자 쓰기, finish(표시·기준값 승격, 지난 날 예산 정리, `/health finished` — 날짜는 Worker 시계 기준이라 속여 고정할 수 없음), start(계산 시작 — D1 하루 `COMPUTES_PER_DAY`번(유료 12·무료 3)까지, 그 뒤 `deferred`; 다만 `digest`·`finish`는 `start` 없이도 부를 수 있어 이 상한이 토큰을 막지는 않아요 — 토큰으로 `digest`를 되풀이하면 무료에서는 D1 쓰기 한도를 태우고 유료에서는 쓴 줄만큼 돈이 들어요(100만 줄에 $1 — 예산 알림이 다음 날 알려요), 새면 §2처럼 바꿈). 지어낸 숫자로 보낼 수 있는 최대: 내용 없는 푸시를 **주간 묶음은 폰마다 7일에 1번, expiring 규칙이 있는 폰에는 하루 1번까지**(새 종료일을 지어내면 날마다 가능; 주간 묶음에 실린 날은 따로 없음). 하루 2번은 주간 묶음과 expiring이 따로 가는 날(finish를 그날 첫 푸시 뒤에 또 부를 때 — 9차부터 하루 finish가 여럿일 수 있어 정상 운영에서도 생김)뿐이고, 08~21시만이에요. 지어낸 숫자는 finish 뒤 기준값이 되므로 진짜 소식이 한동안 안 나갈 수도 있어요. 구독을 지우거나 오래됐다는 이유로 정리하는 일은 아예 없어요 — 구독·endpoint·규칙은 읽지도 쓰지도 못해요. Worker는 상수 시간 비교, 비어 있으면 503 |
| 가격 알림 배포 토큰 | 앱과 같은 `CLOUDFLARE_API_TOKEN`(지금은 GitHub Actions repository secret이고, 사용자가 GitHub Environment `cloudflare`로 옮긴 뒤 repository secret을 지우면 그 Environment를 적은 job들만 받아요 — PR을 합친다고 secret이 옮겨지지는 않아요; 받는 곳: `cf-alerts.yml`의 `deploy` job(main만, `environment: cloudflare`를 적음 — 시험 job은 비밀값 없음), 그리고 `weekly.yml`의 deploy job(#82, 이 표의 'Cloudflare 배포 토큰' 줄). `weekly.yml`의 `price_alerts` job은 받지 않아요(`environment` 없음 — `tests/factory_worker.test.js`)) | 토큰 하나만 관리. 권한은 **Workers → Admin(제품 범위, 새 Worker를 만들려면 Editor로는 안 됨)** + **D1 → Edit**(마이그레이션). 이 범위면 알림 D1의 모든 endpoint·규칙을 읽고 알림 Worker를 다시 배포(→ `VAPID_PRIVATE_JWK`·`ALERTS_SECRET` 읽기, 아무 때나 푸시)할 수 있어요. **이 토큰을 받는 job에서 도는 코드는 모두 이 토큰을 읽을 수 있어요(2026-10-16 고쳐 씀).** 스크립트의 `unset`은 차단선이 아니에요 — 같은 job 안이면 `/proc/<pid>/environ`(스크립트·단계 셸)과 러너의 sudo로 다시 읽혀요. `unset`은 자식 프로세스 환경·로그로 실수로 새는 것만 줄여요(예전 이 칸의 '`tools/factory.sh`의 한 줄이 가른다'는 틀린 말이었어요). 그래서 (가) 배포 분리(#82, 2026-10-16 합침) 전의 `weekly.yml`처럼 공장(`update`) job이 이 토큰을 받으면, 그 job의 수집기·`requirements.txt` 패키지·빌드 코드가 이 토큰을 읽어 알림 저장소에 닿을 수 있어요(그 전 실행의 Re-run이 그래요 — 토큰을 Environment `cloudflare`로 옮기면 막혀요). (나) 지금은 공장 job이 토큰을 받지 않고, 새 러너의 deploy job 배포 단계만 받아요. 남는 길은 공장이 main에 push한 코드가 다음에 배포하는 실행에서 토큰과 함께 돌거나 Worker로 배포되는 것이에요('Cloudflare 배포 토큰' 줄, 위 §4 '공장 쪽 코드/데이터 분리'의 '남는 점'). `cf-alerts.yml`은 wrangler를 **토큰 없는 단계에서 설치**하고(cf-workers.yml과 같은 방식), 토큰은 그 고정된 wrangler와 키 설정의 `cf/alerts/vapid-keygen.mjs`(그 실행 커밋의 코드)에만 줘요. 배포·키 설정은 main에서만 해요. **받아들인 결과는 이 사실로 사용자에게 다시 승인받아야 해요.** 더 좁히려면 알림용 토큰(D1 Edit + Workers Scripts Edit)을 따로 만들어 `cf-alerts.yml`에만 두면 돼요 — 지금은 '토큰 하나' 결정으로 하지 않았어요 |

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
| Worker 살아 있음(`GET <주소>/health`가 200 + `"ok":true`일 때만 정상, 404도 고장으로 셈). 알림 Worker는 살아 있어도 `capacity`가 `ok`가 아니거나, `stale`·`refusing`이 true이거나, `sending`이 false이거나, `pairs`가 `capped`이거나, `compute`가 `failed`·`deferred`이거나(10차), `key`가 `app/config.js` `pushPublicKey`와 다르면 경고(§4 '용량 알림' 줄) | `monitor.yml`, 저장소 변수 `MONITOR_WORKER_URLS`에 적힌 주소만(비면 건너뜀) | 매일 |
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
