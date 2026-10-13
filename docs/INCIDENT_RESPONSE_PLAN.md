# 사고 대응 계획 (Incident Response Plan)

기준일: 2026-10-13. 운영자는 1명이에요(저장소 소유자). Claude 세션은 운영자가 요청할 때 코드 수정과 확인을 도와요.

## 1. 등급과 첫 대응 시간
| 등급 | 예 | 첫 대응 |
|---|---|---|
| 1 (치명) | 비밀 키 유출(service_role 등), 계정 탈취, 가격 데이터 대량 변조, 사용자 데이터 유출 | 알게 된 즉시 |
| 2 (높음) | 잘못된 가격 배포, 수집 차단으로 오래된 가격, 의존성 보안 경고(높음) | 24시간 안 |
| 3 (보통) | 일부 지점 오류, 신고 스팸, 낮은 등급 경고 | 다음 정기 갱신 전 |

**공통 순서**
1. 멈춘다: 배포나 워크플로를 중지해요.
2. 막는다: 키 교체, 권한 회수.
3. 되돌린다: 커밋 revert, 백업 복구.
4. 확인한다: 테스트를 다시 돌려요.
5. 기록한다: 아래 §9 양식.

## 2. 비밀 정보가 공개됐을 때 (PIN · 키 · 토큰)
1. 무엇이 어디에 나갔는지 확인해요.
   - `python tests/security/scan_secrets.py --history`
   - GitHub secret scanning 알림(켜 두었다면)
2. **교체가 먼저예요.** 공개 저장소의 기록은 복사본이 남아서, 지우는 것만으로는 해결되지 않아요.
3. 무엇이 나갔는지에 따라
   - **비밀번호 화면 PIN**
     1. 새 PIN의 해시를 만들어요: `python3 -c "import hashlib;print(hashlib.sha256(b'velyb-gate:새PIN').hexdigest())"`
     2. `app/gate.js`의 `HASH`를 바꾸고 `app/sw.js`의 `VER`를 올려요.
     3. push하면 자동 배포돼요. 사용하는 분들께 새 PIN을 알려요.
   - **Supabase 키**
     1. 대시보드에서 키를 교체(rotate)해요. service_role이 나갔다면 JWT secret까지 바꿔야 해요.
     2. 새 service_role 키는 GitHub Settings → Secrets에만 넣어요.
     3. Auth 로그와 `audit_logs`에서 그 사이의 이상 변경을 찾아요.
   - **GitHub 토큰·계정**: §5
4. 필요하면 git 기록을 다시 써요(`git filter-repo`). 단, 이미 퍼진 복사본은 없앨 수 없다는 걸 전제로 해요.

## 3. 잘못되거나 변조된 가격이 배포됐을 때
1. **멈춤:** GitHub → Actions → weekly-prices → "Disable workflow"(자동 갱신 중지)
2. **원인 커밋 찾기:** `git log --oneline -- app/data.json data2/accepted`
   - 봇 커밋은 'Weekly prices' 또는 'Rebuild app data'예요.
   - 사람이 바꾼 커밋인지, 다른 계정인지 확인해요.
3. **되돌림:** `git revert <커밋>` → push하면 지난 데이터로 재배포돼요(약 2~3분).
4. **확인:** 앱에서 해당 시술을 보고, `data2/report.md`와 검토 대기(`data2/review.csv`)를 확인해요.
5. 원인이 수집 쪽이면(사이트 구조 변경 등) 고친 뒤 Actions를 다시 켜고 수동 실행해요.
6. DB를 쓰는 경우: `audit_logs`에서 해당 행의 이전값을 찾아 관리자(MFA)가 되돌리거나, 백업에서 복구해요(§6).

## 4. 수집이 막혔거나 robots.txt가 막을 때
- 자동 안전장치가 있어요.
  - 행·지점이 30% 넘게 줄면 지난 자료를 유지해요.
  - robots.txt가 막거나 확인할 수 없으면(5xx·연결 실패) 그 주 그 브랜드는 수집하지 않아요.
- `data2/report.md`와 Actions 요약에서 어느 브랜드인지 확인해요.
- 그 주에 수집하지 못한 지점은 앱에 바로 '지난 자료'(STALE) 표시가 붙고, '조건 없는 최저가'에서 빠져요.
- 여러 주 이어지면 사이트 정책을 확인하고, 필요하면 수집을 중단해요.

## 5. GitHub 계정이나 저장소가 손상됐을 때
1. 비밀번호 변경, 2단계 인증 확인, 모든 세션 로그아웃
2. Settings → Applications·Tokens에서 모르는 토큰·앱 권한을 회수해요.
3. 저장소 Settings → Collaborators·Deploy keys·Secrets를 점검해요. Secrets는 모두 교체해요.
4. 최근 커밋과 워크플로 실행 기록을 검토하고, 변조된 커밋은 revert해요(§3).
5. 워크플로 파일이 바뀌었는지(외부 액션, 권한) `git log -p .github/workflows` 로 확인해요.

## 6. 데이터베이스 사고 (로그인·DB를 켠 뒤)
1. **읽기 전용 전환(긴급):** `revoke insert, update, delete on all tables in schema public from authenticated;`
   - 앱은 기기 저장으로 계속 동작해요.
2. **복구:** 최근 백업(`pg_dump -Fc`)을 새 DB에 `pg_restore` 해요.
   - 절차는 `tests/db/backup_restore_test.sh`와 같아요.
   - 행 수·md5·정책 수·트리거 수를 비교해 같으면 전환해요.
3. **정책 재적용:** `supabase/DATABASE_ACCESS_POLICIES.sql`(다시 실행해도 안전) → `bash tests/db/run_security_tests.sh`로 같은 정책을 테스트 DB에서 확인해요.
4. Supabase 플랜에 따라 자동 백업·시점 복구(PITR) 여부가 달라요. 켤 때 확인하고, 주 1회 `pg_dump`를 별도로 보관하는 걸 권해요.

## 7. 의존성 보안 경고
1. Dependabot 알림이나 PR을 확인해요.
2. `requirements.txt`의 버전을 올리거나 액션 SHA를 갱신해요.
3. 테스트를 돌려요.
   - `node --test`, `python build2/xkeys.py`, `python build2/taxonomy.py`
   - 수집 모듈 import 확인
4. push하면 자동 재배포돼요. 수집에 쓰는 패키지면 다음 주간 실행 결과를 확인해요.

## 8. 남용·스팸 (신고·요청 폭주)
- DB 한도가 먼저 막아요(신고 하루 10건 등). Postgres 로그에서 `quota_exceeded`를 찾아 사용자 id를 확인해요.
- 반복되면 Supabase Auth에서 해당 사용자를 차단(ban)하거나 삭제해요. 그 사용자의 신고는 검수자가 REJECTED로 바꿔요.
- 개인정보가 담긴 GitHub 신고 이슈는 운영자가 숨기거나 삭제해요.

## 9. 개인정보 요청
- **로그인 사용자의 탈퇴:** 앱의 탈퇴(`delete_me`)로 계정·프로필·기록이 함께 지워져요.
- **기기 데이터:** 기기 데이터는 사용자 본인 브라우저에만 있어요. 브라우저 사이트 데이터를 지우면 사라져요.

## 10. 재해 복구 목표
| 대상 | 복구 시점 목표(RPO) | 복구 시간 목표(RTO) | 방법 |
|---|---|---|---|
| 앱·가격 데이터(정적) | 마지막 커밋(보통 주 1회 + 이벤트 종료 다음 날) | 10분 안 | git revert 또는 워크플로 재실행. git 기록 전체가 백업이에요 |
| 수집 원본 | 마지막 성공 주 | — | `data2/accepted/`(커밋됨) |
| DB(켠 뒤) | 플랜의 자동 백업 주기 + 주간 pg_dump | 1시간 안(목표) | §6. 복구 절차는 CI에서 매번 검증 |

## 11. 사고 기록 양식
```
날짜·시각(발견/대응/종료):
등급:
무슨 일이 있었나:
영향(사용자·데이터·기간):
원인:
한 일(멈춤 → 막음 → 되돌림 → 확인):
다시 안 생기게 할 일:
```
