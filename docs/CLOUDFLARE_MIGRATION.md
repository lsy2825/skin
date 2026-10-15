# Cloudflare 이사 계획 (2026-10-15)

> **현재 결정 (2026-10-15, 최종): GitHub는 지우지 않는다. 이사는 0~1단계에서 멈춘다(보류).**
> 지금 구성은 이렇다.
> - 코드와 가격 공장: **비공개 GitHub**(`weekly.yml` → `tools/factory.sh`).
> - 앱 주소: **Cloudflare 무료 플랜**(https://yoonsiljang.lsy2825.workers.dev).
>
> Cloudflare 공장(`cf/factory/`)은 만들고 시험까지 마쳤지만 배포하지 않았다. 아무것도 돌지 않고 비용도 들지 않는다.
> 나중에 다시 옮기기로 하면 아래 2단계(유료 플랜 가입)부터 이어서 한다.
> 그때까지 `tools/factory.sh`와 `tests/factory_worker.test.js`는 GitHub 공장에서도 쓰이므로 계속 유지한다.

처음 결정(2026-10-15, 같은 날 철회): 코드 보관·가격 공장·앱 주소를 모두 Cloudflare로 옮기고, 끝나면 GitHub 저장소를 지운다.
이유는 보안이었다. GitHub 저장소가 공개 상태였고, 다른 계정(`leebackcoding/skin`, 2026-10-14)이 이미 통째로 복사해 갔다.
비공개 전환(0단계)으로 이 걱정이 해결됐다. 그래서 유료 플랜이 필요한 2단계 이후는 하지 않기로 했다.

## 1. 바뀌는 것

| | 지금 (GitHub) | 이사 후 (Cloudflare) | 근거 문서 |
|---|---|---|---|
| 코드 보관 | GitHub `lsy2825/skin` | **Artifacts** 저장소 `skin` (git 그대로: clone·push) | developers.cloudflare.com/artifacts |
| 가격 공장 | GitHub Actions `weekly.yml` | **Containers**: `cf/factory` Worker가 매일 06:00 KST에 상자를 켬 | /containers, "Cron container" 예제 |
| 코드가 바뀌면 다시 만들기 | `push` 트리거 | Artifacts `pushed` 이벤트 → Queue `skin-pushes` → `rebuild` | /artifacts/guides/event-subscriptions |
| 앱 주소 | `yoonsiljang.lsy2825.workers.dev` (GitHub Pages는 비공개 전환으로 2026-10-15 종료) | **Workers 정적 파일** `yoonsiljang` 하나 (`wrangler.jsonc`) | /workers/static-assets |
| 수동 실행(가격 재확인·출처 재확인) | `price-check.yml`·`source-check.yml` 버튼 | `POST /run {mode}` (비밀키 필요) | `cf/factory/src/index.js` |
| 운영 화면의 수집 상태 | GitHub API(공개 저장소일 때만 읽힘) | `GET /status` (공장 관리자) | `app/screens/ops.js` |
| 의존성 업데이트 알림 | Dependabot | 없음 → 분기마다 직접 확인(`requirements.txt`, wrangler, 상자 이미지 digest) | — |

**바뀌지 않는 것:** 공장이 하는 일. 두 곳 모두 같은 스크립트 `tools/factory.sh`를 돌린다.
판단(월요일·이벤트 종료) → 단위 테스트·비밀 정보 검사 → 수집·빌드 → 분류 대기열 → main에 저장 → 앱 배포 순서다.
수집 규칙(robots.txt, `YoonSiljangBot`, 차단 우회 금지)도 그대로다.

## 2. 구성 요소

```
cf/factory/
  wrangler.jsonc   Worker "yoonsiljang-factory": cron 0 21 * * *, Container(Durable Object), Artifacts 바인딩, Queue 소비자
  src/index.js     상자 켜기(실행마다 2시간짜리 git 토큰 발급), 보고 받기, 상태 보여 주기, 100분 넘으면 끄기
  src/runs.js      실행 기록 규칙(모드 검사, 비밀키 비교, 토큰 없는 기록) — tests/factory_worker.test.js
  Dockerfile       python 3.12 + node 22 + git + wrangler 4.145.0 (digest 고정, 일반 사용자로 실행)
  entry.sh         Artifacts에서 main 받기 → tools/factory.sh <mode> → 결과 보고
tools/factory.sh   공장 한 번 (GitHub weekly.yml도 이 스크립트를 부른다)
```

**보안 설계**
- git 토큰: 실행마다 새로 발급한다(쓰기 권한, 2시간 후 저절로 만료). 상자 디스크는 실행이 끝나면 버려진다.
- 배포 토큰(`CF_DEPLOY_TOKEN`): `factory.sh`가 환경에서 빼 두었다가 `wrangler deploy` 때만 넘긴다. 수집기·빌드는 이 토큰을 볼 수 없다.
- 공개 배포 스위치(`PUBLIC_DEPLOY`, Worker 변수, 기본 빈 값): `on`일 때만 상자도 공개 Worker를 배포한다(2026-10-15부터 공개 배포 멈춤, GitHub 쪽은 저장소 변수). 그 밖에는 관리자 Worker만.
- 보고 토큰: 실행마다 새로 만들고, 그 실행에만 쓸 수 있다. `/status`에는 토큰이 나오지 않는다(시험으로 확인).
- 수동 실행 `/run`은 `RUN_SECRET`이 있어야 한다. 비교는 상수 시간으로 한다. 모드와 `max`는 정해진 값만 받는다.
- 공장이 저장한 커밋(`factory@yoonsiljang.invalid`)은 push 이벤트로 다시 빌드를 일으키지 않는다(무한 반복 방지).

## 3. 이사 순서

| 단계 | 내용 | 누가 | 상태 |
|---|---|---|---|
| 0 | GitHub 저장소 **비공개**로 전환(이사 중 추가 유출 막기) | 사용자 | **완료** (2026-10-15, GitHub Pages 배포 단계 제거) |
| 1 | 공장 스크립트 하나로 통일(`tools/factory.sh`), 상자·관리자 코드 작성, 로컬 시험 | Claude | **완료** (§4) |
| 2 | Cloudflare **Workers Paid**($5/월) 가입 → Artifacts·Containers 사용 가능 | 사용자 | 대기 |
| 3 | Artifacts 저장소 `skin` 만들고 GitHub 전체 이력 가져오기(import) → 커밋 수·최신 해시 대조 | Claude+사용자 | 대기 |
| 4 | 공장 관리자 배포, `DRY_RUN=1`(저장·배포 안 함)로 2~3주 GitHub 공장과 나란히 실행 → 결과 비교 | Claude | 대기 |
| 5 | 전환일: GitHub 일정 끄기 → 마지막 이력 다시 가져오기 → `DRY_RUN=0` → Queue 이벤트 연결 | Claude+사용자 | 대기 |
| 6 | 사용자 컴퓨터에 Claude Code 설치, Artifacts 저장소 clone, 작업 확인 | 사용자(안내: Claude) | 대기 |
| 7 | 백업 확인 후 GitHub 저장소 삭제 | 사용자 | 대기 |

**전환 전에는 원본이 GitHub 하나다.** 두 공장이 동시에 서로 다른 곳에 저장하면 기록이 갈라진다.
그래서 4단계는 `DRY_RUN=1`로만 돌린다.

## 4. 이미 시험한 것 (2026-10-15, 이 작업 환경)

| 시험 | 결과 |
|---|---|
| `tools/factory.sh rebuild` (임시 복사본 → 임시 원격 저장소) | 통과, 3분 58초. 커밋 1개 저장·push 확인 |
| `factory.sh weekly` (화요일) / `price-check abc` / 없는 모드 | "수집 안 함"으로 종료(`run=false`, `skipped`) / 거절(종료 코드 2) / 거절(2) |
| 상자 이미지 빌드 | 1.98GB, `whoami`=factory, Python 3.12.15, Node 22.23.3, git 2.39.5, wrangler 4.145.0 |
| 상자 안에서 `rebuild` 전 과정 (원격 저장소 = 임시 저장소) | 통과, 4분 41초. pip 설치 → 단위 테스트 → 빌드 → `factory bot` 이름으로 저장·push → 보고(`ok`, 토큰 일치) |
| 상자 실패 경로 | 잘못된 입력 → `failed`, 쉬는 날 → `skipped`, 원격 저장소 못 받음 → `failed (clone)` |
| `wrangler deploy --dry-run` (공장 관리자) | 설정 검사·코드 묶기 통과. 이미지 빌드 단계는 이 작업 환경의 인증서 차단으로 실패했다. 같은 Dockerfile을 인증서를 넣어 직접 빌드하면 성공한다 |
| 단위 테스트 | 130/130 (`tests/factory_worker.test.js` 6개 포함) |
| GitHub에서 `weekly.yml` → `factory.sh rebuild` (run 38669693769) | 공장 단계 성공(시험·빌드·저장·Cloudflare 배포). 같은 실행의 GitHub Pages 배포는 비공개 전환으로 실패 → 단계 제거 |
| 운영 화면 `tests/e2e/ops40.js` | 18/18. Cloudflare `/status` 응답이면 그 상태 그대로(GitHub에 안 물음), 없으면 GitHub로. 공장이 보낸 글자는 글자로만 |

**아직 시험하지 못한 것:** 실제 Cloudflare에서 상자 켜기, Artifacts 토큰 발급, 이벤트 Queue 연결.
유료 플랜이 있어야 하고, 이 작업 환경에서는 `api.cloudflare.com` 접속이 막혀 있다. 2~4단계에서 확인한다.
병원 사이트가 Cloudflare 쪽 접속을 막을지도 모른다. 4단계의 나란히 실행에서 브랜드별 수집 행 수를 비교해서 확인한다.

## 5. 비용 (2026-10 Cloudflare 가격표 기준, 추정)

- Workers Paid **$5/월**. 컨테이너는 CPU 375 vCPU-분, 메모리 25 GiB-시간, 디스크 200 GB-시간이 포함된다.
  - 전체 수집 1회는 약 22분(GitHub 2026-10-13 실행 기록)이다.
  - basic 상자(vCPU 1/4, 1 GiB)로 1회 ≈ 5.5 vCPU-분, 메모리 ≈ 0.4 GiB-시간이다. 월 4~8회면 포함량 안이다(추측).
- Artifacts: 월 1만 작업, 1GB까지 포함이다. 그 뒤로는 1천 작업당 $0.15, GB-월당 $0.50이다.
  - 저장소는 `.git` 81MB에 데이터 이력이 매주 늘어난다. 1GB를 언제 넘을지는 측정 후 기록한다.
- 정적 파일(앱) 요청은 무료이고 무제한이다.

## 6. 되돌리기

전환일 전까지는 GitHub 공장이 그대로 돈다. Cloudflare 쪽은 지우기만 하면 된다
(`wrangler delete --config cf/factory/wrangler.jsonc`).
전환 뒤 문제가 생기면 Artifacts의 최신 이력을 GitHub(비공개)에 push하고 `weekly.yml` 일정을 다시 켠다.
**GitHub 삭제(7단계)는 Cloudflare 공장이 최소 2주 혼자 문제없이 돈 다음에만 한다.**
