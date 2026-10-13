# 피부과 가격비교

공장형 피부과 브랜드(블리비·쁨·톡스앤필·리엔장)의 지점별 시술 가격을 모아 비교하는 홈 화면 앱(PWA).

- 앱: `app/` (GitHub Pages로 배포). 휴대폰 브라우저에서 열고 "홈 화면에 추가"하면 앱처럼 쓸 수 있어요.
- 매주 월요일 06:00(KST) GitHub Actions가 자동으로 가격을 모으고(`scrape/`), 정리하고(`build2/clean.py`), 앱 데이터(`app/data.json`)를 만들어 배포해요.
  수동 갱신: Actions → weekly-prices → Run workflow.
- 안전장치: 어떤 브랜드의 수집 결과가 지난주보다 30% 넘게 줄면 그 브랜드는 지난주 자료를 그대로 써요. 결과는 `data2/report.md`.
- 정리 규칙: 0원·안내 문구·서류 발급비 제외, 정가가 판매가보다 낮거나 10배 이상이면 정가 삭제, 같은 지점의 중복 줄 하나로. 내역은 `data2/issues.csv`.
- 브랜드 간 같은 시술 묶기: `build2/xkeys.py` (테스트: `python build2/xkeys.py`).
- 비밀번호 화면: `app/gate.js` (화면 잠금일 뿐, 데이터 파일은 공개 주소에 있어요).

로컬 실행:

    pip install -r requirements.txt
    python build2/weekly.py            # 수집부터 전부 (약 15분)
    python build2/weekly.py --skip-scrape   # 이미 모은 자료로 다시 만들기
    python -m http.server 8766 --directory app

지도: © OpenStreetMap contributors (Leaflet, BSD-2). 좌표: OpenStreetMap Nominatim.
