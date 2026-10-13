# 작업 메모 (이어서 작업할 때 먼저 읽기)

사용자: 한국어로 답변. 모르면 모른다고, 추측이면 추측이라고, 근거 제시. 공장형 피부과 가격 비교가 목적(특정 브랜드 중심 아님).
요청(2026-10-13): 지도(지점 핀·내 위치·거리), 단순한 화면, 오타·오기 정리, 브랜드 동등, 매주 월요일 자동 갱신,
탭 정리(장바구니에 기능 몰지 않기), 홈 화면 앱(PWA), 비밀번호 0717(5번 틀리면 5분, 이후 틀릴 때마다 2배).
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
  - 포에버의원(`scrape/forever.py`, 아직 weekly·clean·appdata에 연결 안 함): <코드>.4-ever.co.kr/ko/treatments의 self.__next_f 안
    "categories"→treatments, 상세 /ko/treatments/<cat>/<slug>의 "options"[{name, price(정가), discountPrice(판매가)}]. VAT 별도. 강남 시험: 77개 시술 · 278행.
- 주소·좌표: `scrape/branches.py` → data2/branches.csv (120곳: 정확 110, 도로 9, 구 1). Nominatim 1초 간격, geocache.json 캐시.
- 정리: `build2/clean.py` (제외 96줄, 정가 삭제 20줄, 같은 지점 중복·행사 라벨만 다른 줄 합침 → 62,417줄). 사유는 data2/issues.csv.
  브랜드 간 같은 시술 묶기: `build2/xkeys.py`(36개, 테스트 `python build2/xkeys.py` → 90개 통과). 블리비 '리쥬란 스킨부스터(PN 베이직)'는 리쥬란힐러와 다른 상품이라 제외.
- 앱: `app/` (index.html · app.js · gate.js · sw.js · manifest · icons · vendor/leaflet). 탭: 홈·지도·비교·장바구니·더보기 + 지점 상세·검색.
  장바구니 합계 1위(블리비 일산점 144,400원, 슈링크100+리쥬란2cc×2+사각턱)를 CSV로 따로 계산해 일치 확인. 비밀번호 동작 브라우저로 확인.
- 주간: `build2/weekly.py` (브랜드 행·지점이 지난번보다 30% 넘게 줄면 그 브랜드는 data2/accepted 자료 유지) + `.github/workflows/weekly.yml` (월 06:00 KST, Pages 배포).
- 비밀번호 화면은 화면 잠금일 뿐: 저장소·data.json이 공개라 데이터는 공개 상태(사용자에게 안내함).

## 남은 일
1. 포에버의원 연결: clean.py BRANDS, appdata.py BRANDS(색·안내 문구), weekly.py SCRAPERS에 추가 → 전체 수집 → 앱 확인.
2. GitHub Pages: 사용자가 Settings → Pages → Source를 "GitHub Actions"로 했는지 확인 → Actions에서 weekly-prices 수동 실행 →
   해외 서버에서 사이트가 열리는지 확인(report.md). 막히면 사용자 PC(Windows, Python 3.12) 작업 스케줄러로 월요일 실행 + push.
3. 클라우드 샌드박스에서 병원 사이트가 막힐 수 있음(예전 리눅스 샌드박스에서 velyb.kr 403). 그러면 수집은 Actions에 맡기고 앱·규칙 작업만.
4. 쁨 강남 스탠다드점 가격 위치 찾기. 유앤아이의원(uni114.co.kr)은 가격이 그림이라 보류. 미앤아이·밴스 제외(robots/그림).
5. 휴대폰 주소: https://lsy2825.github.io/skin/ (Pages 켜진 뒤). "홈 화면에 추가" 안내.
