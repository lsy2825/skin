# app.js 분리 계획

## 현재 상태 (2026-10-14 확인, 2차 검토 수정 뒤 다시 잼)
- `app/app.js` 4,825줄, 약 493KB. 파일 전체가 하나의 즉시 실행 함수 `(function(){ ... })()` 안에 있다.
- 함수 약 340개가 같은 클로저 안의 변수(`D`, `ROWS`, `S`, `store`, `views`, `current` 등)를 서로 공유한다.
- 화면 등록: `views[이름] = (rest, params) => 요소`, 라우터 `renderNow()`(4723줄~)가 `location.hash`로 고른다.
- 번들러가 없어서 `index.html`의 `<script>` 순서가 곧 의존 순서다.

## 왜 어렵나 (핵심 문제)
파일을 그냥 자르면, 잘린 쪽에서 클로저 변수와 헬퍼(`h`, `$`, `fill`, `icon`, `won`, `cur()` …)를 볼 수 없다.
그래서 먼저 **공유하는 것들을 한 곳(`App` 이름공간)에 모으고**, 그다음 화면을 하나씩 떼어낸다.
`D`, `ROWS`처럼 나중에 다시 대입되는 `let` 변수는 값이 아니라 함수(`App.data()`)로 꺼내 써야 한다. 값을 복사해 두면 데이터 갱신 뒤 옛 값이 남는다.

## 단계
각 단계 끝마다: `node --test tests/*.test.js` + 해당 화면 e2e + `ux_qa`·`xss`·`a11y`. 실패하면 그 단계만 되돌린다.

0. **기준선 기록** — 지금 상태로 전체 회귀를 한 번 돌려 통과·실패 목록을 남긴다. (이미 실패하던 것과 새로 깨진 것을 구분하려고)
1. **공용 뼈대 `app/core.js`** — `h`, `$`, `fill`, `icon`, `safeUrl`, `won`, `store`, 토스트·시트 열기, `nav` 를 `window.App`에 올린다.
   `app.js`는 이것들을 `const { h, $, ... } = App;`으로 받아 쓴다. 동작 변화 없음.
2. **데이터 접근** — `App.data()`, `App.rows()`, 가격 동기화(127~395줄)를 `app/state/data.js`로.
3. **독립성이 높은 화면부터 하나씩** (`app/screens/*.js`, 각 파일은 `App.views.이름 = ...`로 등록):

   | 순서 | 화면 | 현재 위치(대략) | 이유 |
   |---|---|---|---|
   | 3-1 | 운영 현황 `ops` | 2188~2322 | 비밀번호 뒤 관리 화면, 다른 화면이 거의 안 씀 |
   | 3-2 | 데이터 안내 `about`·사전·용어 | 2323~2659, 3338~3370 | 읽기 전용 화면 |
   | 3-3 | 피부 고민 `concern` | 2660~2753 | domain/concern.js에 로직이 이미 있음 |
   | 3-4 | 지도·지역 `map` | 3042~3217 | Leaflet 의존만 분명함 |
   | 3-5 | 지점 상세·순위·비교 | 3218~3325 | |
   | 3-6 | 내정보 `me` | 4288~4532 | |
   | 3-7 | 데모 기능 묶음 | 3326~3784 | 기능이 여러 개라 나눠서 |
   | 3-8 | 검색·가격표 | 1770~2156, 3785~3888 | 필터 상태가 URL에 있어 주의 |
   | 3-9 | 장바구니 `cart` | 624~755, 3889~4287 | 떠 있는 장바구니 바(`paintFloatCart`)가 모든 화면에서 씀 → 마지막 |

4. **남는 `app.js`** — 라우터와 시작 코드만(목표 300줄 이하).
5. **`index.html` 스크립트 순서 정리**, 서비스 워커(`sw.js`) 캐시 목록에 새 파일 추가. 이걸 빠뜨리면 오프라인에서 화면이 안 뜬다.

## 주의
- 서비스 워커 캐시 목록(`sw.js`)과 `index.html` 순서를 단계마다 같이 고친다.
- 첫 화면 속도(`tests/perf/first_load.js`)를 0단계와 마지막에 비교한다. 파일 수가 늘면 요청이 늘어난다.
  느려지면 배포 전에 하나로 합치는 간단한 빌드 단계를 고려한다(추측: 지금 규모에서는 큰 차이 없을 가능성이 높음).
- 한 단계 = 커밋 하나. push(=자동 배포)는 단계 몇 개를 모아 확인한 뒤.
- 줄 번호는 2026-10-14 기준이라 작업하면서 바뀐다. 구역 주석(`// ---------------- 이름`)으로 찾는다.

## 진행 기록
| 단계 | 커밋 | 내용 | 검증 |
|---|---|---|---|
| 0 기준선 | — | 2차 최종 회귀 34/34 + `first_load.js` 3회 | slow4g 첫 방문 중앙값 8,891ms · 재방문 2,138ms · 1,279KB/39요청 |
| 1 `app/core.js` | `39e1112` | `$ h safeUrl fill icon won km store toast undoToast actToast copyText` + 계정 공간(`App.scope/setScope`) | 단위 93 · ux_qa·xss·a11y·accounts_r2·jomi·data_sync·commerce50 |
| 2 `app/state/data.js` | `b8442ba` | 가격 동기화(`App.Data`, 화면 훅 apply/paint, `io` 교체 가능), `App.data()/App.rows()` | 단위 93(R09를 data.js로) · ux_qa·xss·a11y·data_sync·pricenow·ops40·jomi |
| 3-1 `app/screens/ops.js` | `0f66a26` | 운영 현황. 화면 파일은 `App.screens`에 등록 → app.js가 시작 직전 설치, 바뀌는 데이터는 `App.state()`로 그릴 때 읽음 | 단위 93 · ops40·admin51·commerce50·ux_qa·a11y·xss |
| 3-2 `app/screens/about.js` | `474db5f` | 데이터 안내 `#about`(`#data`)·운영 원칙 `#principles`·처리방침 `#privacy`·시술 사전 `#guide`·쉬운 용어 `#terms`와 그 화면만 쓰던 `dataStatusCard`·`installCard`·`deviceCard`·설치 안내 이벤트·`famTitle`. 다른 화면도 쓰는 `recheckQueue`·`coverageLine`·`PRIVACY`/`privacyParts`/`privacyLink`·`kbSheet`·`termBtn` 등은 app.js에 두고 `App`으로 넘김. `App.state()`에 `KEYS byKB kbFind WHEN_COL current` 더함. 사전·용어는 합쳐 62줄이라 `guide.js`로 나누지 않음. SW `pc-v31`. 정적 검사(type_steps·space_steps·color_roles·jomilines)가 about.js도 읽게 함 | 단위 245 · privacy·demo_features·v5_features·qa7·spec_notes·jomi·concern·o2_home·ux_qa·xss·a11y·clickable + type_steps·space_steps·color_roles·cond_badge·touch_targets·ops40 · pricenow 39개(데이터 상태·설치 포함) 통과 뒤 오프라인(서비스 워커) 단계에서 시간 초과 — main에서도 똑같음(로컬 서버가 127.0.0.1이라 SW 미등록) · main과 화면 HTML 비교(about·principles·guide 3가지·terms·compare·me·시술 설명 시트): 죠미 말 무작위 한 줄 말고 같음 |
| 3-3 `app/screens/concern.js` | `3960141` | 피부 고민 `#concern` — 지금은 '죠미와 대화' 화면 전체라서 두 구역을 함께 옮김: '피부 고민으로 찾기'(`concernOf`·`concernVisible`·`kbById`·`famsOfEntry`·`draftTag`·`concernCard`)와 '죠미와 대화'(`mascotImg`·`whereText`·`priceLine`·`famAnswer`·`chatAnswer`·`chatSend`·대화 기록 `chatTurns`/`chatMemo`·`views.concern`). 홈 검색창(`routeQuery`·`specRoute`)도 쓰는 `chatCtx`와 그 캐시는 app.js에 두고 `App`으로 넘김. 홈 → 대화로 넘기는 말 `pendingChat`은 concern.js가 갖고, 홈은 `App.chatPending(t)`로 넘김(app.js에서 바뀐 실행 줄은 이 한 줄). `App`에 `kbVisible chatCtx jomiImg regionName st J track`, `App.state()`에 `CONC` 더함. 누를 때 읽던 `KEYS`·`D`(가격 비교 칩, 지역 가격표 단추)는 누를 때 `App.state()`로 읽음. SW `pc-v31` 그대로(이 브랜치에서 이미 올림), SHELL에 추가. 정적 검사(type_steps·space_steps·color_roles·jomilines)가 concern.js도 읽게 함 | 단위 245 · concern 31·jomi 42·demo_features 47·ux_qa 26·xss 7·a11y(21화면×밝게/어둡게, 위반 0)·clickable 4 + type_steps 143·space_steps 118·color_roles 156·price_focus 2·touch_targets 3193/3193 · main과 화면 HTML 비교 22단계(대화 13가지: 고민·시술 이름·이어 묻기·도움말·두 시술·오타·지역·응급·진료 권고·개인 판단·모르는 말·인사 / 지역 가격표·가격 비교 칩 이동 / 부작용 시트 / 대화 지우기 / `#concern?c=pigment` / 홈 검색창 → 대화 넘김·가격 비교) 모두 같음, 오류 0 |
| 3-4 `app/screens/map.js` | `16bbb8a` | 지도 `#map` — 구역 '// ---------------- map'의 `views.map`·`setMapLock`·Leaflet 늦게 불러오기(`loadLeaflet`·`leafletP`/`leafletFailed`)·`initMap`·`priceLabel`·`drawMap`·`branchMarker`·`markListSel`·`focusBranch`·`kmOk`·`kmChips`·`paintNear`와 지도 객체 `map`/`layer`/`meMarker`. 같은 구역 안의 '지역 이름'(`AREAS`·`areaIndex`·`areaFind`·`useArea`·`areaSearch`)은 위치 시트(`locSheet`·`locate`)와 검색(지역 칩)도 써서 app.js에 둠. 지도 객체는 map.js가 갖고, app.js의 두 곳(`useArea`의 `fitBounds`, 지점 상세의 '지도' 단추 `setView`)은 `App.mapNow()`로 그때그때 읽음(app.js에서 바뀐 실행 줄은 이 두 곳). `App`에 `ranking brandOn brandOf dist regionCmp locate savePlace usePlace areaSearch brandChips` 더함. 새 데이터가 오면 바뀌는 `KEYS`(그릴 때)·`BR`(핀·목록을 그릴 때, 목록→핀 누를 때)·`current`(Leaflet을 다 불러온 때)는 그 순간 `App.state()`로 읽음. SW `pc-v31` 그대로, SHELL에 추가. 정적 검사(type_steps·space_steps·color_roles·jomilines)가 map.js도 읽게 함 | 단위 245 · demo_features 47·v5_features 27·alert_region 13·ux_qa 26·xss 7·a11y(21화면×밝게/어둡게, 위반 0)·clickable 4 + qa7 59·type_steps 143·space_steps 118·color_roles 156·price_focus 2 · pr_checks 20/20 · eslint `no-undef`: app.js에 새로 모르는 이름 없음, map.js는 브라우저 전역·`L`만 · main과 지도 화면 비교 25단계(열기·시술 고르기·확대·묶음 핀·가격 핀·팝업 → 지점·뒤로·동네 찾기·고르기·3km·축소·이 지역 재검색·목록 → 핀·지도 가운데를 집으로·위치만 보기·브랜드 칩 두 번·지점 상세 '지도' 단추·검색 지역 칩·위치 시트 동네·비교 → 지도 / 휴대폰: 잠금 풀기·잠그기; `#main` HTML·지도 위치·위치 단추·시트·토스트) 모두 같음 · 페이지 오류 1건(`_leaflet_pos`, 지도에서 동네를 고를 때)은 main에서도 같은 단계에서 남 — 이번 일과 무관, 고치지 않음 |

계획과 다른 점: `sheet`·`nav`는 아직 app.js 안에 있어요(렌더·기록과 얽혀 있어서). 화면 파일에는 `App.nav`로 넘겨요.

측정(3-1 뒤, 같은 조건 3회): slow4g 첫 방문 중앙값 8,839ms · 재방문 2,140ms · 요청 42개(+3). **차이 없음(오차 범위).** 파일이 늘어 요청은 3개 늘었지만 시간 영향은 보이지 않아요. app.js 4,825줄 → 4,527줄.

app.js 줄 수(3-2 뒤): 3-1 뒤 4,527줄에서 그동안의 기능 작업으로 5,786줄이 됐고, 3-2로 5,786줄 → 5,585줄(−201). `screens/about.js` 233줄.

app.js 줄 수(3-3 뒤): 5,585줄 → 5,428줄(−157). 옮긴 원래 줄 162줄, app.js에 새로 생긴 줄은 안내 주석 2줄·`chatCtx` 캐시 선언 1줄·`App`에 넘기는 목록 2줄. `screens/concern.js` 180줄.

app.js 줄 수(3-4 뒤): 5,428줄 → 5,272줄(−156). 옮긴 원래 줄 161줄(구역 머리 2줄 + `views.map`~`paintNear` 159줄), app.js에 새로 생긴 줄은 안내 주석 2줄·`useArea`의 `App.mapNow()` 읽기 1줄·`App`에 넘기는 목록 2줄. `screens/map.js` 177줄.

시험 연결(3-2~3-4 검토 뒤): `tests/e2e/cond_badge.js`의 '시간대 미표기' 문구 검사가 app.js만 받아 보던 것을, `index.html`이 읽는 `screens/*.js`도 함께 보게 함(앞으로 생길 화면 파일도 저절로 들어감). 소스 파일을 직접 읽는 다른 정적 검사(type_steps·space_steps·color_roles·jomilines)는 화면 파일을 옮길 때마다 목록에 더함.

다음: 3-5(지점 상세·순위·비교)부터 같은 방식. 화면 하나 = 커밋 하나.
