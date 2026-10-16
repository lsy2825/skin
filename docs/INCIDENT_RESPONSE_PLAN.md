# 사고 대응 계획 (Incident Response Plan)

기준일: 2026-10-15 (윤실장 6.0, 개발 지시서 A8). 문서 주인: 채팅 A(플랫폼·서버·보안).
운영자는 1명이에요(저장소 소유자 `lsy2825`). 세 채팅(A 플랫폼·B 앱 화면·C 데이터)은 운영자가 요청할 때 고치고 확인해요.

## 0. 지금 구성 (이 문서가 전제하는 것)

| 무엇 | 어디 | 주의 |
|---|---|---|
| 코드·가격 기록 | GitHub `lsy2825/skin` **공개**(2026-10-16 사용자 결정. 2026-10-15에 비공개로 돌렸는데 2026-10-16에 다시 공개인 것을 확인 — 언제·왜인지 모름) | 코드·git 기록 전체·Actions 실행 로그를 누구나 읽어요. 복사본 `leebackcoding/skin`(2026-10-14)도 있어요. **모든 커밋은 공개된 것으로 봐요** — 비밀값은 GitHub·Cloudflare 비밀값에만 두고 로그에 찍지 않아요(`docs/SECURITY_ARCHITECTURE.md` §0) |
| 가격 공장 | GitHub Actions `weekly.yml` → `tools/factory.sh` (매일 06:00 KST 판단, 월요일·행사 종료 시 수집) | 빌드가 실패하면 저장·배포 전에 멈추고, 앱은 어제 데이터를 그대로 보여줘요 |
| 앱 주소 | 공개: Cloudflare Workers 정적 파일 `yoonsiljang` (무료), https://yoonsiljang.lsy2825.workers.dev — **2026-10-15 판으로 고정**(공개 배포 멈춤, 저장소 변수 `PUBLIC_DEPLOY`=`on`일 때만 배포). 관리자: `yoonsiljang-admin`(Cloudflare Access 뒤)이 빌드마다 갱신 | GitHub Pages는 없어요. 보안 헤더는 `app/_headers` |
| 새 Worker(만드는 중) | `cf/metrics`(익명 집계, A4), `cf/alerts`(푸시, A5) + D1 | 배포 전까지는 해당 없음 |
| 비밀값 | GitHub Secrets: `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`(Environment `cloudflare`로 옮기면 그쪽, `docs/SECURITY_ARCHITECTURE.md` §5)(+ 알림을 켜면 `ALERTS_SECRET`; `ALERTS_URL`은 선택 — 기본 주소가 있어요. 저장소 변수(비밀 아님): `ALERTS_CODE_SHA`·`PUBLIC_APP_URL`). Worker secret: VAPID 비밀키 등 | 저장소에는 비밀값이 없어요(`python3 tests/security/scan_secrets.py`) |
| 로그인·DB(Supabase) | 꺼져 있음(`app/config.js` 비어 있음) | §7은 켠 뒤에만 해당 |

## 1. 등급과 첫 대응 시간

| 등급 | 예 | 첫 대응 |
|---|---|---|
| 1 (치명) | 비밀값 유출(Cloudflare 토큰·VAPID 비밀키 등), 계정 탈취(GitHub·Cloudflare), 가격 데이터 대량 변조, 사용자 데이터 유출 | 알게 된 즉시 |
| 2 (높음) | 잘못된 가격 배포, 앱 화면 깨짐(합친 PR 때문), 수집 차단으로 오래된 가격, 의존성 보안 경고(높음) | 24시간 안 |
| 3 (보통) | 일부 지점 오류, 집계·알림 Worker 일시 오류, 낮은 등급 경고 | 다음 정기 갱신 전 |

**공통 순서**
1. **멈춘다:** 자동 갱신(워크플로)을 끄거나, Cloudflare에서 이전 버전으로 되돌려요(§3).
2. **막는다:** 키를 교체하고 권한을 회수해요.
3. **되돌린다:** 커밋을 revert하고, 필요하면 백업에서 복구해요.
4. **확인한다:** 시험을 다시 돌리고 실제 주소에서 확인해요.
5. **기록한다:** §12 양식에 남기고, 재발 방지 대책을 정해요.

**누가 고치나:** 파일 주인표(`CLAUDE.md` '분업')를 따라요. 앱 화면 파일은 B, 데이터·수집은 C, 배포·비밀값·Worker는 A예요. 등급 1에서는 주인을 기다리지 않아요. 운영자가 "이번만 A가 고친다"고 정하면 A가 고치고, 뒤에 주인 채팅에 알려요.

## 2. 비밀값이 새었을 때

1. **교체가 먼저예요.** 기록을 지워도 이미 복사된 것은 남아요. 저장소가 공개라서(§0, 2026-10-16 사용자 결정) 커밋된 것은 모두 공개됐다고 봐요.
2. 어디에 나갔는지 확인해요. `python3 tests/security/scan_secrets.py --history`(전체 기록), GitHub 비밀값 검사 알림(켜 두었다면).
3. 종류별로 이렇게 해요.

| 새어 나간 것 | 할 일 |
|---|---|
| **Cloudflare API 토큰** | ① Cloudflare 대시보드 → 오른쪽 위 프로필 → **API Tokens**에서 해당 토큰을 **Roll**(새 값 발급)하거나 삭제해요. ② 새 값을 넣어요: Environment `cloudflare`로 옮겼다면 Settings → **Environments → cloudflare → Environment secrets**의 `CLOUDFLARE_API_TOKEN`(Repository secrets에 다시 만들지 않아요 — 이름이 같으면 Environment 값이 이기고, Repository secret이 생기면 합치기 전 실행의 Re-run을 막는 장치가 사라져요). 옮기기 전이면 Settings → Secrets and variables → Actions → **Repository secrets**의 `CLOUDFLARE_API_TOKEN`. ③ Cloudflare → Workers & Pages에서 모르는 Worker나 배포가 없는지 봐요(Deployments 탭). 있으면 §3처럼 되돌려요 |
| **VAPID 비밀키(푸시)** | 키를 바꾸면 모든 휴대폰이 알림을 다시 신청해야 해요(2026-10-16 절차, A5). ① **새 키 넣기:** GitHub → Actions → **cf-alerts** → Run workflow → Branch **main** → `setup_keys`와 `replace_keys`를 **둘 다** 체크 → Run. 러너 안에서 새 쌍을 만들고, 비공개키는 Worker 비밀값으로만 들어가요(출력·파일 없음). 같은 실행이 `ALERTS_SECRET`도 GitHub 값으로 다시 넣어요(키 교체에 딸린 일일 뿐 — `ALERTS_SECRET`만 바꿀 때는 아래 줄의 `sync_secret`). `cf/alerts/wrangler.jsonc`의 `VAPID_PUBLIC_KEY`는 비워 둬요(차 있으면 이 실행이 거절하고 아무것도 안 바꿔요). ② **확인:** 실행이 초록이고 요약에 새 공개키(87자)가 보여요. `https://yoonsiljang-alerts.lsy2825.workers.dev/health`가 `"sending":true`이고 `"key"`가 그 새 공개키예요. ③ **앱:** A가 새 공개키를 B에게 부탁 메모로 보내 `app/config.js`의 `pushPublicKey`를 바꾸게 해요(급하면 §1 예외). 바뀌기 전까지 감시가 'VAPID 공개키가 달라요'를 날마다 경고해요. 공개 배포가 멈춘 동안에는 바뀐 `config.js`가 휴대폰에 닿지 않아요. ④ **옛 구독(코드 기준, 2026-10-16 다시 고침):** 옛 키로 한 구독은 푸시 서비스가 거절해요. Worker는 푸시 서비스마다 **새 키가 처음 2xx를 받은 날**을 적어 두고(`stat` `ok:`), 마지막 푸시가 그날보다 오래된 행은 옛 키 구독으로 보고 401·403 3번 뒤 지워요(경고 없음) — 다시 구독한 휴대폰이 옛 행 때문에 막히지 않아요. 새 키가 그 서비스에서 아직 한 번도 통하지 않았으면(다시 구독한 휴대폰이 없음) 옛 행은 '우리 설정 고장일 수 있음'으로 보호를 받아 **7일(`REFUSING_GRACE_DAYS`)까지** 지워지지 않고(미뤄 두고 실행마다 그 서비스에서 2개씩만 다시 시도 — 그래서 옛 행이 많아도 다른 푸시 서비스의 휴대폰은 그날 받아요; 처음 한 번씩은 모두 시도돼요. 그 서비스가 2xx를 주면 받은 적 있는 행이 한꺼번에 풀려요) `/health`의 `"refusing":true`와 감시 경고가 날마다 나요. 7일이 지나면 평소처럼 세어 지워요. 잘못된 키를 잠깐 넣었다가 되돌려도 맞는 키의 `ok:` 날짜는 지워지지 않아요(키마다 따로 남김, 3차 검토) — 되돌린 뒤 그 키로 받던 휴대폰은 계속 '지금 키로 받은 기기'로 보호를 받아요. B의 '키가 다르면 다시 구독' 처리(부탁 메모)가 나간 뒤에는 휴대폰이 앱을 열 때 새 키로 다시 구독하고 옛 id를 지워요. 진짜 설정 고장(새 키를 잘못 넣음, `VAPID_SUBJECT` 오류 등)도 같은 경고가 나요 — 7일 안에 ①~②를 다시 확인하세요(그 뒤에는 거절하는 구독이 지워져요) |
| **`ALERTS_SECRET` 등 Worker 공유 비밀** | Worker secret과 GitHub Secret을 같은 새 값으로 바꿔요. ① 새 값을 내 PC에서 만들어(`docs/ARCHITECTURE.md` D19 켜는 순서 4번의 방법, 클립보드에만) GitHub 저장소 Settings → Secrets and variables → Actions → **Repository secrets**의 `ALERTS_SECRET` → Update에 붙여 넣어요. ② GitHub → Actions → **cf-alerts** → Run workflow → Branch **main** → **`sync_secret`만** 체크 → Run. 그 값을 stdin으로 Worker에 넣고 VAPID 키는 건드리지 않아요. (또는 Cloudflare 대시보드 → Workers & Pages → `yoonsiljang-alerts` → Settings → Variables and Secrets → `ALERTS_SECRET` → Edit에 같은 값을 붙여 넣어요.) ③ 클립보드를 다른 글자로 덮어요. ④ **확인:** 다음 날 06시 뒤 weekly-prices 실행의 `price_alerts`에 '401' 경고가 없고, `/health`의 `finished`가 그날로 바뀌어요. **`setup_keys`는 쓰지 않아요** — VAPID 키가 있으면 거절하고, `replace_keys`를 같이 고르면 모든 휴대폰이 다시 구독해야 해요. 바꾸는 사이에는 공장의 알림 단계만 실패하고, 가격 빌드는 계속돼요 |
| **비밀번호 화면 번호(PIN)** | 이건 화면을 가리는 것일 뿐이에요. 데이터는 공개 주소에 있어요. 사용자가 PC에서 `tools/windows/pin.bat`을 실행해요(#81, `docs/LOCAL_SETUP_WINDOWS.md` 4-1). 번호는 화면에 안 보이게 입력하고 채팅·저장소에 남지 않아요. 도구가 `app/gate.js`의 `HASH`와 `app/sw.js`의 `VER`(날짜·시각 숫자, 지금보다 100 이상) 두 줄만 바꾼 `pin/…` PR을 열고, 그 PR을 합치면 끝이에요. **예전 번호는 공개 기록에 남아 있어요** |
| **Supabase 키**(켠 뒤) | 대시보드에서 키를 교체해요. service_role이 나갔으면 JWT secret까지 바꿔요. Auth 로그와 `audit_logs`에서 이상 변경을 찾아요 |
| **GitHub 토큰·계정** | §5 |

4. 필요하면 git 기록을 다시 써요(`git filter-repo`). 단, 이미 퍼진 복사본은 없앨 수 없다고 보고 해요.

## 3. 잘못되거나 변조된 가격·화면이 배포됐을 때

**가장 빠른 길: Cloudflare에서 이전 버전으로 되돌리기 (1분)**
- 공개 배포가 멈춘 동안(2026-10-15~) 새 빌드는 **관리자 Worker `yoonsiljang-admin`에만** 올라가요. 그래서 잘못된 빌드의 되돌리기 대상은 `yoonsiljang-admin`이고, 공개 `yoonsiljang`은 고정된 판이에요(공개 쪽이 변조됐을 때만 `yoonsiljang`을 되돌려요).
- 대시보드: **Workers & Pages** → `yoonsiljang-admin`(또는 공개 쪽이면 `yoonsiljang`) → **Deployments** → 정상이던 버전의 ⋯ → **Rollback**.
- 명령: `npx wrangler@4.145.0 rollback --name yoonsiljang-admin`(바로 전 버전) 또는 `rollback --name <이름> <버전ID>`.
- 최근 **100개 버전**까지 되돌릴 수 있어요(Cloudflare 문서: Workers Rollbacks).
- 되돌려도 저장소는 그대로예요. 그래서 다음 공장 실행이 같은 내용을 다시 배포할 수 있어요. 아래 단계까지 해야 끝나요.

**그다음 저장소 정리**
1. **멈춤:** GitHub → Actions → **weekly-prices** → ⋯ → **Disable workflow**(자동 갱신 중지).
2. **원인 커밋 찾기:** `git log --oneline -- app/data.json data2/accepted`(데이터), `git log --oneline -- app/`(화면). 봇 커밋은 `Weekly prices`, `Rebuild app data`, `Price check`예요.
3. **되돌림:** `git revert <커밋>`을 PR로 올려요. 운영자가 승인해서 main에 합치면 공장이 수집 없이 다시 만들어 배포해요(약 5분).
   - 합친 PR 때문에 화면이 깨진 경우도 같아요. **그 PR을 올린 채팅**이 revert PR을 올려요(지시서 '충돌·사고').
4. **확인:** 관리자 주소(공개 배포를 켠 뒤라면 공개 주소)에서 해당 시술·화면을 보고, `data2/report.md`와 검토 대기(`data2/review.csv`)를 확인해요. Access 설정 전이면 내 PC에서 `python -m http.server 8766 --directory app`으로 봐요.
5. 원인이 수집 쪽(사이트 구조 변경 등)이면 C가 수집기·정리 규칙을 고쳐요. 데이터를 손으로 고치지 않아요(공통 규칙 9). 그 뒤 워크플로를 다시 켜고 수동 실행해요.
6. **다시 돌리기는 Re-run 말고** Actions → weekly-prices → **Run workflow**(skip_scrape 켬, 수집 실행이 실패했으면 끔)로 해요. 공장 job의 Re-run은 첫 단계에서 거절되고(옛 코드·옛 입력), deploy job이 없는 옛 실행(배포 분리 전)은 Re-run하지 않아요(토큰이 공장 job에 가고 섞인 빌드가 push될 수 있음).

## 4. 가격 공장이 실패하거나 수집이 막혔을 때

- **앱은 어제 데이터를 계속 보여줘요.** `factory.sh`는 시험·빌드가 실패하면 저장·배포 전에 멈춰요(`set -e`).
- 안전장치
  - 행·지점이 30% 넘게 줄면 지난 자료를 유지해요(`build2/weekly.py`).
  - robots.txt가 막거나 확인이 안 되면(5xx·연결 실패) 그 주 그 브랜드는 수집하지 않아요.
  - 수집 못 한 지점은 앱에 '지난 자료' 표시가 붙어요.
- 어디서 막혔는지: GitHub → Actions → 실패한 실행 → 'Factory' 단계 로그, 그리고 `data2/report.md`.
- 원인별 담당: 시험·배포·토큰은 A, 수집기·데이터 가드는 C, 앱 시험(`tests/*.test.js`)은 B.
- 여러 주 이어지면 사이트 정책(약관·robots.txt)을 확인하고, 필요하면 그 브랜드 수집을 멈춰요. 차단 우회는 하지 않아요.
- 모니터링 알림(A7)이 생기면 공장 실패·데이터 가드 걸림·수집 8일 초과가 메신저로 와요. 그 전까지는 GitHub 실패 메일이 유일한 신호예요.

## 5. GitHub 계정·저장소가 손상됐을 때

1. 비밀번호를 바꾸고, 2단계 인증을 확인하고, 모든 세션을 로그아웃해요.
2. Settings → Applications·Developer settings에서 모르는 토큰·앱 권한을 회수해요. Claude GitHub 앱 권한도 확인해요.
3. 저장소 Settings → Collaborators·Deploy keys·Secrets를 점검해요. **Secrets는 모두 교체해요**(Cloudflare 토큰은 §2).
4. 최근 커밋·PR·워크플로 실행을 검토하고, 변조된 커밋은 revert해요(§3).
5. 워크플로 파일이 바뀌었는지 확인해요: `git log -p .github/workflows`(외부 액션, 권한, 비밀값 출력).
6. 저장소 공개 여부가 바뀌지 않았는지 확인해요: Settings → General → Danger Zone의 visibility. 지금은 **공개가 맞아요**(§0, 2026-10-16 사용자 결정). 비공개로 바뀌어 있으면 누가 바꿨는지 감사 기록에서 찾아요 — GitHub 무료 요금제에서 비공개 저장소는 Environment secret을 못 써서, Environment `cloudflare`로 옮긴 배포 토큰을 deploy job이 받지 못해요.

## 6. Cloudflare 계정이 손상됐을 때

1. 비밀번호를 바꾸고 2단계 인증을 켜요. 모든 세션을 로그아웃해요.
2. **API Tokens**에서 모르는 토큰을 지우고, 쓰는 토큰은 Roll해요(§2 표).
3. **Workers & Pages**에서 Worker 목록·배포 기록·Secrets를 확인해요. 모르는 Worker는 지우고, 우리 Worker는 저장소에서 다시 배포해요(Actions → weekly-prices → Run workflow, `skip_scrape`). **공개 배포가 멈춘 동안 이 실행은 관리자 Worker만 다시 배포해요.** 공개 `yoonsiljang`은 ① `npx wrangler@4.145.0 rollback --name yoonsiljang <정상 버전ID>`로 되돌리거나 ② 그 한 번만 저장소 변수 `PUBLIC_DEPLOY`=`on`으로 두고 실행한 뒤 다시 지우거나 ③ 대시보드에서 그 Worker의 workers.dev 주소를 꺼요.
4. Members(계정 구성원)와 Access 설정(관리자 이메일 목록)을 확인해요.

## 7. 데이터베이스 사고

**D1(집계·알림 Worker, A4·A5 배포 뒤)**
- 집계(`cf/metrics`)에는 날짜·단계·횟수만 있어요. 잃어도 개인정보 피해는 없고, 그날 숫자만 비어요.
- 알림(`cf/alerts`)에는 푸시 구독 주소와 알림 조건이 있어요(이름·연락처 없음).
  - 의심되면 Worker를 이전 버전으로 되돌리거나(§3), 알림 cron을 멈춰요(대시보드 → Worker → Settings → Triggers).
- **D1 시점 복구(Time Travel):** 항상 켜져 있고 추가 비용이 없어요. 데이터베이스를 **지난 1분 단위 어느 시점으로든** 되돌릴 수 있고, 보관 기간은 **무료 플랜 7일 / 유료 플랜 30일**이에요(Cloudflare 문서 'Time Travel and backups'·'D1 Limits', 2026-10-15 확인. 이 계정은 무료 플랜이라 7일). 사용법: `wrangler d1 time-travel info <DB이름> --timestamp=<시각>`으로 그 시각의 북마크를 얻고, `wrangler d1 time-travel restore <DB이름> --timestamp=<시각>`으로 되돌려요. 되돌리면 그 사이의 모든 쓰기가 사라지고 진행 중인 요청은 취소되며, 되돌리기 직전 북마크가 출력되니 적어 두면 되돌린 것을 다시 되돌릴 수 있어요. 더 길게 보관하려면 R2로 내보내기 Workflow가 따로 필요해요(지금은 하지 않아요).
- **개인정보와의 관계:** 알림 D1에서 구독을 지워도(끄기·조건 0개·푸시 서비스 404/410) 지운 행은 위 기간(무료 7일)만큼은 Time Travel 기록에 남아 있을 수 있어요. 처리방침의 '바로 지워요'는 운영 중인 DB 기준이에요(C에게 전달함, 변호사 질문 대상).
- **데이터베이스가 사는 곳:** 집계 DB는 계정 쪽 정보로도 `running_in_region: APAC`(아시아·태평양)로 확인했어요. 알림 DB는 만들 때 같은 지역 힌트(`apac`)를 줘요.

**Supabase(로그인·DB를 켠 뒤에만)**
1. **읽기 전용 전환(긴급):** `revoke insert, update, delete on all tables in schema public from authenticated;` 앱은 기기 저장으로 계속 동작해요.
2. **복구:** 최근 백업(`pg_dump -Fc`)을 새 DB에 `pg_restore`해요. 절차는 `tests/db/backup_restore_test.sh`와 같아요. 행 수·md5·정책 수·트리거 수가 같으면 전환해요.
3. **정책 재적용:** `supabase/DATABASE_ACCESS_POLICIES.sql`(다시 실행해도 안전)을 적용하고 `bash tests/db/run_security_tests.sh`로 확인해요.

## 8. 의존성 보안 경고

1. Dependabot 알림·PR을 확인해요(켜는 법은 A9 안내).
2. 파일 주인이 고쳐요.
   - `requirements.txt`는 C
   - 액션 SHA(`.github/`)와 wrangler 버전은 A
   - 화면 쪽 라이브러리(`app/vendor/`)는 B
3. 관련 시험을 돌리고 PR로 합쳐요. 수집에 쓰는 패키지면 다음 공장 실행 결과를 확인해요.

## 9. 남용·스팸

- **집계 Worker:** 날짜·단계별 숫자만 늘어나요. 이상하게 튀면 그날 숫자를 분석에서 빼요. 저장된 개인정보가 없어서 사용자를 찾아 막는 방법은 없어요(설계상 그래요).
- **알림 Worker:** 구독 한도와 입력 검사가 먼저 막아요. 반복되면 구독 받기를 잠시 멈추는 판(배포)을 올려요. 감시가 `"pairs":"capped"`(지켜보는 쌍이 `PAIR_CAP`에 닿음)를 경고하면 심은 구독인지 보고, **좁은 정리 쿼리**(규칙의 key가 하나도 공장의 key 목록에 없고 푸시를 받은 적 없는 구독만, `SECURITY_ARCHITECTURE.md` §4)를 후보로 봐요. **단 key가 최근 바뀌었으면(재분류 — 최근 `data.json`의 `meta.recl` 날짜) 사용자 결정 뒤에만 써요**(6차 검증): 재분류 뒤 며칠은 앱을 아직 열지 않은 진짜 휴대폰도 옛 key만 갖고 있어 이 쿼리에 걸리고, 지워진 휴대폰은 다음 알림 변경 때 404를 받아 앱(B의 지금 코드)이 다시 구독하지 않고 푸시를 '꺼짐'으로 바꿔요 — 사용자가 다시 켜야 해요. 지어낸 key의 쌍은 5차 검증 뒤 목록 자리를 차지하지 못하므로(공장이 보낸 key 목록에 있는 key만 순위에 듦; 6차부터 그런 규칙도 저장은 되고, 7차부터 답은 약속 1 그대로 `{id}`·`{ok:true}`), 그래도 `capped`가 이어지면 실제 key로 심은 것이거나 진짜 구독이 상한보다 많은 것 → `PAIR_CAP` 조정을 사용자와 정해요. D1 하루 쓰기 한도(계정 전체 100,000줄)나 읽기 한도(5,000,000줄)를 넘으면 09:00 KST까지 모든 D1 쿼리가 실패해 `/health`가 503이에요 — 그날 알림·집계가 멈추고 09:00 KST에 저절로 돌아와요. 하루 최악 계산은 `cf/alerts/src/worker.js` 머리 주석(쓰기 약 91,700줄·읽기 약 3.17M — 7차 검증에서 몰린 규칙·긴 `exp_sent`까지 넣어 다시 잼; 전부 계산은 정기 실행의 첫 시도 한 번뿐이고 push·Run workflow·Re-run 실행은 key 목록만 보내며 '다음 06:00 정기 실행이 계산' notice를 남김; `cf/metrics`는 같은 계정 한도를 따로 최대 80,000줄)이에요. 하루에 전부 계산을 손으로 더 돌리지 마세요 — Re-run도 이제 key 목록만 보내요(같은 data의 전부 계산은 Worker가 멈춰 0줄). 손 수집·가격 재확인으로 낮에 새 데이터를 냈다면 그 소식은 다음 06시 정기 실행이 계산해요(그날 끝나는 가격의 expiring은 놓칠 수 있음 — 사용자 결정 항목). 정기 실행이 09:00 KST 넘어서 계산하면 다음 D1 하루에 전부 계산이 둘이 될 수 있어요(읽기는 약 4.57M로 한도 안, 쓰기는 최악에 넘을 수 있음) — 그날 `/health`가 503이면 이것부터 봐요. **넓은 정리 쿼리**는 푸시를 한 번도 받지 않은 구독을 모두(미뤄 둔 것·소식이 기다리는 것 포함) 지우므로, 아직 첫 푸시를 못 받은 진짜 휴대폰도 함께 지워져요 — 출시 초기에는 구독자 거의 전부라 **사용자 결정을 받은 뒤에만** 써요.
- **가격 파일 대량 수집:** 도메인을 산 뒤 `data.json` 요청 제한 규칙(A9)을 켜요. 그 전에는 막을 방법이 거의 없어요.

## 10. 개인정보 요청

- **기기 데이터:** 장바구니·관심·기록은 사용자 브라우저에만 있어요. 사이트 데이터를 지우면 사라져요.
- **푸시 알림:** 앱에서 알림을 끄면 구독이 지워져요(`DELETE /v1/push/subscribe/{id}`). 이름·연락처는 처음부터 받지 않아요.
- **익명 집계:** 날짜·단계별 횟수뿐이라, 특정인의 기록이 없어요.
- **로그인을 켠 뒤:** 앱의 탈퇴(`delete_me`)로 계정·프로필·기록이 함께 지워져요.

## 11. 복구 목표

| 대상 | 복구 시점(RPO) | 복구 시간(RTO) | 방법 |
|---|---|---|---|
| 앱 화면·가격 데이터 | 직전 배포 버전 | **1분**(Cloudflare 롤백) / 10분(revert + 재배포) | §3. git 기록 전체가 백업이에요 |
| 수집 원본 | 마지막 성공 수집 | — | `data2/accepted/`(커밋됨) |
| 집계·알림 D1 | 지난 7일 안 어느 1분(무료 플랜; 유료는 30일) | 1시간 안(목표) | §7 Time Travel |
| Supabase(켠 뒤) | 플랜의 자동 백업 주기 + 주간 `pg_dump` | 1시간 안(목표) | §7. 복구 절차는 CI에서 매번 검증 |

## 12. 사고 기록 양식

```
날짜·시각(발견/대응/종료):
등급:
무슨 일이 있었나:
영향(사용자·데이터·기간):
원인:
한 일(멈춤 → 막음 → 되돌림 → 확인):
담당 채팅·PR:
다시 안 생기게 할 일:
```
