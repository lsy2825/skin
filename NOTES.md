# 작업 메모 (이어서 작업할 때 먼저 읽기)

사용자: 한국어로 답변. 모르면 모른다고, 추측이면 추측이라고, 근거 제시. 공장형 피부과 가격 비교가 목적(특정 브랜드 중심 아님).
요청(2026-10-13): 지도(지점 핀·내 위치·거리), 단순한 화면, 오타·오기 정리, 브랜드 동등, 매주 월요일 자동 갱신,
탭 정리(장바구니에 기능 몰지 않기), 홈 화면 앱(PWA), 비밀번호 화면(번호는 저장소에 적지 않음 — 사용자에게 확인, 5번 틀리면 5분, 이후 틀릴 때마다 2배).
선택: 지도 = OpenStreetMap(Leaflet) · 자동 갱신 = GitHub Actions(막히면 사용자 PC 작업 스케줄러) · 브랜드 더 조사해서 추가.

## 지금 상태 (2026-10-13)
- 직접 수집기(`scrape/`): AI 요약 없이 HTML/내장 데이터를 읽음. 블리비 53,313행/58곳 · 쁨 9,500/23 · 톡스앤필 11,888/32 · 리엔장 149/5.
  - 블리비: community01.php?tb=event_multi&etc5=<지점>&sField=1..7, div.cont / ul.slist li. 지점 목록 = #tab_menu01.
  - 쁨: www.ppeum1~40.com 리다이렉트 → 새 사이트 <sub>.ppeum.com/selectSurgery(input[data-price], .priceDecoration, 탭 순서=상자 순서)
    또는 옛 사이트 event.ppeum.com/v1/event/reserve?branch=ppeumN (li[data-num]). 춘천·창원은 서브도메인만 있음(EXTRA_SUBS).
    강남 스탠다드점(ppeum9): 예약 페이지에 상품 0개 → 가격 위치 미확인.
  - 톡스앤필: toxnfillN.com, serviceInfo.php?c= → 카테고리 → detail.php 옵션(li.treatment_item). 옵션 없으면 카드의 '부터' 가격을 (대표가)로.
    본문의 자유 형식 표(예: 압구정 제모)는 읽지 않음.
  - 리엔장: <지점>.lienjang.net/agree/info 비급여 고시표(정가, 최종변경일 2024-10-25) → 앱에 '고시가'로 표시. 강남 404, 잠실 SSL 오류.
  - 포에버의원(`scrape/forever.py`, weekly·clean·appdata·branches에 연결함 2026-10-13. 클라우드 샌드박스에선 사이트 접속 불가 → 첫 실제 수집은 Actions): <코드>.4-ever.co.kr/ko/treatments의 self.__next_f 안
    "categories"→treatments, 상세 /ko/treatments/<cat>/<slug>의 "options"[{name, price(정가), discountPrice(판매가)}]. VAT 별도. 강남 시험: 77개 시술 · 278행.
- 주소·좌표: `scrape/branches.py` → data2/branches.csv (120곳: 정확 110, 도로 9, 구 1). Nominatim 1초 간격, geocache.json 캐시.
- 정리: `build2/clean.py` (제외 96줄, 정가 삭제 20줄, 같은 지점 중복·행사 라벨만 다른 줄 합침 → 62,417줄). 사유는 data2/issues.csv.
  브랜드 간 같은 시술 묶기: `build2/xkeys.py`(36개, 테스트 `python build2/xkeys.py` → 90개 통과). 블리비 '리쥬란 스킨부스터(PN 베이직)'는 리쥬란힐러와 다른 상품이라 제외.
- 앱: `app/` (index.html · app.js · gate.js · sw.js · manifest · icons · vendor/leaflet). 탭: 홈·지도·비교·장바구니·더보기 + 지점 상세·검색.
  장바구니 합계 1위(블리비 일산점 144,400원, 슈링크100+리쥬란2cc×2+사각턱)를 CSV로 따로 계산해 일치 확인. 비밀번호 동작 브라우저로 확인.
- 주간: `build2/weekly.py` (브랜드 행·지점이 지난번보다 30% 넘게 줄면 그 브랜드는 data2/accepted 자료 유지) + `.github/workflows/weekly.yml` (월 06:00 KST, Pages 배포).
- 비밀번호 화면은 화면 잠금일 뿐: 저장소·data.json이 공개라 데이터는 공개 상태(사용자에게 안내함).

## 장바구니 개편 (2026-10-13, 사용자: '너무 간소화됐다, 옵션 선택이 사라졌다')
- 여러 장바구니(이름·복사·삭제·링크 공유 #import/<base64url>), 기존 pc:cart는 첫 장바구니로 옮김.
- 담기 시트: 시술 묶음(meta.fam, appdata.py FAM)의 옵션(예: 슈링크 100/300샷) + 횟수 + 담을 장바구니.
- 지점 가격표·검색 결과의 아무 줄이나 '그대로' 담기(같은 이름 상품끼리 비교) 또는 '같은 시술로' 담기.
- 결과 3가지: 한 곳에서 다 받기(펼쳐 보는 지점별 견적, 줄마다 그 지점의 다른 옵션·N회 패키지로 바꾸기 → item.ov), 여러 곳 섞기, 브랜드·지역별 최저. 거리 제한(내 위치).
- rows에 sess(회차 수, 99=이용권) 추가. 패키지를 고르면 ceil(횟수/sess)묶음으로 계산.
- 사용자가 예전 앱 파일/캡처를 첨부하기로 함 → 오면 빠진 기능 대조.
- 배포: app/·build2/ 바뀐 push는 수집 없이(--skip-scrape) 다시 만들어 Pages 배포.

## 2026-10-13 추가 요청(내정보·로그인·폰트·가격 동향)
- 포에버: 사용자 요청으로 '잠깐 스탑' → weekly.py SCRAPERS에서 뺌(코드·appdata 브랜드는 남김, 지점 0이면 앱에서 숨김).
- 탭 '더보기' → '내정보'(#me, 옛 #more도 여기로). 프로필(닉네임·성별·나이대), 받은 시술 기록(pc:recs, 장바구니 견적 '받았어요'·지점 '방문 기록'),
  방문한 지점, 그 아래 옛 더보기 내용(데이터 안내·지역·지점 목록(접힘)·설정).
- 로그인: Supabase(구글·카카오) 코드 준비만, 사용자 결정 '기능만 만들고 지금 넣지 말기' → app/config.js 비어 있으면 꺼짐.
  app/auth.js, supabase/schema.sql(RLS, delete_me), docs/로그인_설정.md. 민감정보(시술 기록) 동의·처리방침 필요 안내함.
- 폰트: Pretendard(OFL-1.1) app/vendor/fonts/pretendard (동적 서브셋, 필요한 글자 범위만 내려받음). 아이콘: Lucide(ISC) app/icons.js.
- 가격 동향: appdata trend(data2/history 주별 스냅샷 → 키별 일반가 중간값·최저가, 정가 대비 할인 중간값). 홈 '가격 동향'(대분류 칩→소분류 목록·스파크라인), 비교 탭 선 그래프.
  스냅샷은 2026-10-13 하나뿐이라 선은 10/19부터 생김.

## 2026-10-13 마스터 요구사항 대응 (자세한 건 docs/ARCHITECTURE.md, docs/IMPLEMENTATION_STATUS.md)
- 예전 앱 = claude.ai 아티팩트 CVsoz3sVXrMRNjGJ6Hy1wP(공유)·M4UdRzMGj9uGuMAnrxYReZ. 빠졌던 기능 대부분 복원(자동 묶음 build2/groups.py, 지점 순위·비교, 가격 변동, 전체 가격표, 안내, 장바구니 2곳 조합·공유 메모, 방문일).
- 지역 기본 보기 수도권(pc:region), 데이터는 전국.
- 정확성: 종료일 지난 이벤트 제외 + 종료 다음 날 자동 재수집(needs_refresh.py, 매일 06:00 판단), 출처·확인일, STALE, 급변 검토(review.csv/review_ok.csv),
  부가세 4개 브랜드 모두 '별도'(vat_policy.json 원문 근거) → 앱 기본 부가세 포함 예상가(pc:vat), robots.txt 확인(sources.py, source-check 워크플로).
- 계산 로직 app/domain/pricing.js + tests/pricing.test.js(node --test tests/*.test.js, 워크플로에서도 실행).
- 사용자 결정: 알림·로그인·관리자는 키 필요 → 나중에.

## 남은 일
1. 포에버의원: 연결 완료(브랜드 안내에 'VAT 별도'; 태그로 넣으면 '특가'로 분류돼 숨겨지므로 태그는 안 씀). 다음 Actions 실행 결과(report.md)로 행·지점·주소 확인.
   앱: 필터를 저장한 사용자도 새 브랜드는 켜진 상태로 시작(pc:nbrands).
2. GitHub Pages: 사용자가 Settings → Pages → Source를 "GitHub Actions"로 했는지 확인 → Actions에서 weekly-prices 수동 실행 →
   해외 서버에서 사이트가 열리는지 확인(report.md). 막히면 사용자 PC(Windows, Python 3.12) 작업 스케줄러로 월요일 실행 + push.
3. 클라우드 샌드박스에서 병원 사이트가 막힐 수 있음(예전 리눅스 샌드박스에서 velyb.kr 403). 그러면 수집은 Actions에 맡기고 앱·규칙 작업만.
4. 쁨 강남 스탠다드점 가격 위치 찾기. ~~유앤아이의원(uni114.co.kr)은 가격이 그림이라 보류. 미앤아이·밴스 제외(robots/그림).~~
   → 2026-10-14 다시 확인(사용자 요청 "유명 브랜드 조사해서 적용", GitHub 러너에서 robots 먼저 읽는 탐색 scrape/probe.py):
   유앤아이·밴스 모두 robots가 가격 페이지를 허용하고 가격이 글자 → 추가. 데이뷰·닥터에버스도 추가. 셀린은 목록이 스크립트로 불러와져 보류 → 2026-10-15 원본 페이지 탐색으로 항목 상세 요청(_contentDetail.php POST idx)을 확인해 추가(9곳). 연신내 본점·다산·홍대는 새 사이트(*.cellinclinic.com/ko)로 옮겨 아직.
   이 컨테이너에서는 병원 사이트·Nominatim이 열리지 않아(curl 000) 수집·주소는 probe/** 워크플로(결과는 실행 주석으로 회수)로 돌림.
5. 휴대폰 주소: https://lsy2825.github.io/skin/ (Pages 켜진 뒤). "홈 화면에 추가" 안내.
- 2026-10-14 규격 이름: 닥터에버스 칸 제목(가격대·꼬리표·행사명)이 상품명 앞에 붙고 남은 낱말이 붙어 나와 '20만원3921만재생' 같은 규격이 보였음 → clean.title_words·taxonomy._spaced로 원인 수정, build2/labels.py 빌드 가드(가격·날짜·홍보·기호·붙은 글자 규격은 비교 묶음 안 만듦) + tests/labels_test.py·labels.test.js. 유앤아이 제모 화면의 필링·스킨케어는 자기 이름대로 분류. docs/TREATMENT_TAXONOMY.md §1.
- 2026-10-14 클릭 무반응: 입력칸 change/focusout이 누르는 도중 화면을 다시 그려 클릭이 사라짐(예산·최소/최대 가격 뒤 칩) → render()가 누름이 끝날 때까지 기다림, go()는 지금 주소 기준. tests/e2e/clickable.js 회귀 포함. CLAUDE.md 규칙.

## 2026-10-15 · 채팅 B(앱 화면) 메모
- 분업: 개발 지시서 https://claude.ai/code/artifact/d3a54da8-22f2-4f5c-aa90-ff3e13f6e82d (B = app/ 화면, 브랜치 app/…).
- B1(lsy2825/skin#7) 개선 1단계, B2(#8) 화면 쪽 크레딧 제거, B3 비교 화면 새 배치 — 세 PR은 쌓여 있어 #7 → #8 → B3 순서로 합침.
- 사용자 결정(2026-10-15): '장바구니' → '내 견적'으로 바꿈(B4). 비교 화면 '가격과 함께 꼭 확인하세요'는 접지 않고 가격 바로 아래
  (OBJECTIVE_DISPLAY_POLICY.md 그대로). 13px 미만 글자(배지)는 따로 작업으로 13px에.
- 이 클라우드 환경에는 APP_PIN이 없어서 e2e는 잠금 해제 상태(sessionStorage)를 미리 넣는 방식으로 돌렸음 — 공식 결과는 APP_PIN으로 다시 확인할 것.
- 2026-10-15 사용자 결정(둘째): `tests/fixtures/jomi_chat_*.json`은 B. `docs/IMPLEMENTATION_STATUS.md`는 공동(자기 절만 덧붙임). `tools/eval_offers.js`·
  `tools/unit_economics.js`는 지움 — eval_offers·offerparse.js·offer.test.js는 #20에서, unit_economics는 A6 뒤 demowallet·economics와 함께.
  푸시(B6)는 A5 값 → C6 처리방침 → 사용자 승인 뒤에 켬(집계 B5와 같은 순서).
- PR: B4 #12, B3.5 #13, B5 #16(집계, 꺼짐), B6 #19(푸시, 꺼짐), B7 #17(frame.js)·#20(크레딧 흔적), #21(jomi e2e 들쭉날쭉: 전체 대사 교체 전후 경합),
  #22(가격 범위 숫자 `.hp.range`가 입력칸 `.range` grid와 이름 충돌 → 겹침·320px 넘침, main부터 있던 것).

- 합치기(사용자 승인 2026-10-15): B PR 16개를 #31 뒤 순서대로 모두 합침(#37 따로). 배포 확인은 A(pc-v29, frame-ancestors none).
- 다음 PR(승인 대기): #40 처리방침 화면 문구, #41 알림 시트 최저가 지역, #44 정보 화면 Crawl-delay 문장, #43 C4 크기 가드·#39 C5 기록(C가 시작 안 해서 사용자 지시로 B가 대신).
- #39를 C 정정으로 고치다 찾은 것: 공장의 파이썬 3.12 `urllib.robotparser`는 처음 맞는 규칙을 따라 `Allow: /`가 먼저인 호스트에서 뒤의 `Disallow`를 못 봄
  (3.11.17·3.12.3·3.13.16으로 직접 확인). C의 #45가 자체 판정으로 고침. 문서 사실 확인은 코드 대조 → 반박 검토를 두 번 돌려야 수렴했음(첫 고친 판에도 30곳 안팎 틀림).
- 이 환경에서 `rm -rf $변수`는 안전 검사에 막힘 — 임시 작업 폴더는 새 이름으로 만들고 지우지 않음.

## 2026-10-15 (채팅 A) 사용자 결정
- `docs/VERIFIED_FEATURE_INVENTORY.md`는 A가 맡는다(주인표 A 줄).
- 익명 집계 합계(날짜별·단계별 횟수, `cf/metrics`)는 기간 없이 계속 보관한다. 정리(삭제) 작업을 넣지 않는다.
- 푸시 구독 정보(`cf/alerts`)는 따로 보관 기간 없이 다음 경우에 바로 지운다: 앱에서 '끄기'(DELETE), 알림 조건이 0개가 될 때(앱이 DELETE, 서버도 빈 규칙 PUT을 삭제로 처리),
  푸시 서비스가 404/410으로 구독이 사라졌다고 알릴 때(연속 실패도 포함). 365일 미사용 정리와 '꽉 찼을 때 밀어내기'는 넣지 않는다.

## 2026-10-15 · 채팅 C(데이터) 메모
- C1 정리 규칙(E1·E2·E3·E4·E10, lsy2825/skin#50): 검증 에이전트 8차까지 돌림 — 제모 부위 읽기(`taxonomy._area`·`_area_parts`·`AREA_SPELL`),
  괄호 '+'(제모: 부위 나열·장비 괄호·포함/제외 메모 / 그 밖: ' + ' 띄어 쓴 것만 묶음, main 그대로), 닥터에버스 두 메뉴 페이지(같은 이름 두 가격) 가드,
  제모 기기는 묶음 제목·'[젠틀맥스]' 머리표에서도 읽음, 가격 변동 가짜 항목(`appdata.reclassified`·`group_moved`·keymap 성별·횟수)이 주로 손댄 곳.
  성별이 붙은 같은 이름 두 가격(유앤아이 기기 탭 등)은 빼면 실제 가격 2,983줄이 빠져서 둠 — 근본 해결은 수집기가 탭 이름을 남기기. 알려진 한계는 PR 본문.
- C2(#51) 추가 옵션 칸·부가세(E5·E6): data.json 16번째 칸 `addon` — 앱은 r[15]을 실행 중 칸으로 덮어써서 B가 옮겨야 읽힘.
  `data2/vat_policy.json`은 사람이 근거를 적는 입력 파일(공장이 쓰지 않음). `branches_unconfirmed` 지점은 '미확인'.
- C3(#53) `meta.brandFirst`·`new_chains`, C8(#54) 가격 줄 번호는 `build2/rowid.py`로 계산(칸으로 안 실음), C7(#52) `knowledge/specs.json`,
  C1 다음(#55) 해피아워·화수목·평일 한정은 '평일 낮' 태그, 영국산은 수입.
- 수집 예절(#45): 리엔장 Crawl-delay 180초를 단계 사이에도 지킴(`data2/.host_clock.json`·`.robots_cache.json`, git 밖), 주소 단계 robots,
  긴 Crawl-delay 호스트는 같은 실행에서 재시도 안 함, 출처 점검 기록 없는 체인만 건너뜀.
- 합치는 순서(C 결정, 사용자 승인 2026-10-15 'C9 빼고 다 진행'): #39 → #45, 데이터는 #50 → #51 → #53 → #54, #55·#52는 #50 뒤.
- 조사 메모: 이 클라우드 환경에서 drevers.com이 YoonSiljangBot에 Cloudflare 403을 줬음(환경 IP 때문인지 모름). Firecrawl 크레딧이 2026-10-15에 바닥남.
