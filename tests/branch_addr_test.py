"""Branch address picking (scrape/branches.py) on saved public pages (tests/fixtures/branches, read by the address probe
on 2026-10-15, scripts stripped). The page shows the company address first and the branch's own after it (유앤아이 수원·
광교); an address with no 시군구 (세종) or with 읍·면 (양산); a page that shows only the company address (목포) — that
branch gets no address rather than the company's.
The address with its floor and building (address_full) stops at the page footer (2026-10-16: 'Copyright © …' after the
쁨·밴스 footer address, the 셀린 footer links, 유앤아이 '내 위치에서 길 찾기'): on the saved 밴스·유앤아이·셀린 pages and on
ppeum_bupyeong_min.html — NOT a saved page, a minimal one rebuilt from the text data2/branches.csv kept for 쁨 부평점 (the
dev container cannot reach ppeum.com). What JUNK cuts after the address (phone numbers from a real area code, 'TEL' —
not 'HOTEL', not the digits of a lot or building number, a time or a price). The app's clean-up of addresses saved
before that (build2/appdata.py clean_addr) on the stored texts, half-cut footer words included.
  python3 tests/branch_addr_test.py
"""
import os, sys, types
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scrape"))
sys.path.insert(0, os.path.join(HERE, "..", "build2"))
from bs4 import BeautifulSoup
import branches as B
from appdata import clean_addr

FX = os.path.join(HERE, "fixtures", "branches")
fails, n = [], 0


def cands(name):
    html = open(os.path.join(FX, name), encoding="utf-8").read()
    return B.addr_candidates(BeautifulSoup(html, "html.parser").get_text(" "))


class Page:
    """a Fetcher that answers every url with one saved page (from `start` on: the footer alone, as on a price page)"""
    def __init__(self, path, start=None):
        html = open(path, encoding="utf-8").read()
        self.text = html[html.index(start):] if start else html

    def get(self, url):
        return types.SimpleNamespace(text=self.text)


def check(label, got, want):
    global n
    n += 1
    ok = got == want
    print(("PASS" if ok else "FAIL"), "|", label, "|", got)
    if not ok:
        fails.append(label)


check("세종: 시군구 없는 도로명", cands("vands_sejong_location.html")[:1], ["세종특별자치시 나성북로 15"])
check("양산: 읍 다음 도로명", cands("vands_yangsan_location.html")[:1], ["경남 양산시 물금읍 범어로 96"])
rows = [{"brand": "유앤아이", "branch": b, "cands": [(a, a) for a in cands(f)]}
        for b, f in (("수원점", "uandi_suwon_direction.html"), ("광교점", "uandi_gwanggyo_direction.html"), ("목포점", "uandi_mokpo_direction.html"))]
got = {r["branch"]: r["address"] for r in B.pick_own(rows)}
check("수원: 회사 주소 다음의 자기 주소", got["수원점"], "경기도 수원시 팔달구 인계동 1113-5")
check("광교: 회사 주소 다음의 자기 주소", got["광교점"], "경기 수원시 영통구 이의동 1333")
check("목포: 회사 주소뿐 → 주소 없음(엉뚱한 지역 대신)", got["목포점"], "")
check("기존 패턴이 먼저: 도로명이 있으면 느슨한 패턴은 쓰지 않음", B.addr_candidates("서울 강남구 테헤란로 123 · 세종 나성북로 15"), ["서울 강남구 테헤란로 123"])

# --- address_full stops at the page footer (scrape/branches.py FOOTER)
check("쁨 부평(최소 페이지): 바닥글 주소 뒤 'Copyright ©2024 …' 없음",
      B.page_addr(Page(os.path.join(FX, "ppeum_bupyeong_min.html")), "https://bupyeong.ppeum.com/"),
      ("인천광역시 부평구 부평대로 11", "인천광역시 부평구 부평대로 11, 4층(부평동)"))
check("밴스 세종 바닥글(저장 페이지): '(나성동, MVG)'까지, 'Copyright © 2026 VANDS …' 없음",
      B.page_addrs(Page(os.path.join(FX, "vands_sejong_location.html"), '<div class="footer">'), "https://sejong.vandsclinics.com/web/product"),
      [("세종특별자치시 나성북로 15", "세종특별자치시 나성북로 15 (나성동, MVG)")])
check("유앤아이 광교(저장 페이지): 건물·층은 남고 '내 위치에서 길 찾기'는 없음",
      B.page_addrs(Page(os.path.join(FX, "uandi_gwanggyo_direction.html")), "https://www.gguni114.co.kr/direction/")[0][1],
      "경기 수원시 영통구 이의동 1333, 힐스테이트 광교중앙역 퍼스트 상가 3층")
check("셀린 분당정자(저장 페이지): 층까지, 바닥글 링크 '개인정보 취급방침 …' 없음",
      B.page_addrs(Page(os.path.join(HERE, "fixtures", "brands", "cellin_list.html")), "https://bdjj.cellinclinic.com/")[0][1],
      "경기 성남시 분당구 성남대로 349 3층")
t = "쁨의원 부천점 경기도 부천시 길주로 219, 2층 202호, 203호, 204호(중동, 드림빌딩) Copyright ©2024 PPEUMCLINIC. All rights reserved."
check("쁨 부천: 40자 창보다 먼저 바닥글에서 자름(반쪽 'Copyrigh' 없음)", B._full("경기도 부천시 길주로 219", t),
      "경기도 부천시 길주로 219, 2층 202호, 203호, 204호(중동, 드림빌딩)")
t = "서울특별시 마포구 양화로 140 H-cube 4층 2호선 홍대입구역 9번 출구 도보 2분 자세히보기 CONTACT 대표전화"
check("쁨 홍대: '자세히보기' 단추 앞까지(역 안내는 그대로)", B._full("서울특별시 마포구 양화로 140", t),
      "서울특별시 마포구 양화로 140 H-cube 4층 2호선 홍대입구역 9번 출구 도보 2분")
check("바닥글 낱말이 없으면 그대로(층·건물·괄호)", B._full("서울특별시 서초구 강남대로 423", "서울특별시 서초구 강남대로 423, 3층(서초동, 한승빌딩)"),
      "서울특별시 서초구 강남대로 423, 3층(서초동, 한승빌딩)")

# --- what JUNK cuts after an address (2026-10-16): TEL only as a word of its own ('HOTEL' was cut to 'HO' — data2/branches.csv
# 밴스 홍대 '… MERCURE 앰배서더 HO'); a phone number from its area code in any spacing, or cut short by the 40-character
# window (the old '0\d{2}' + a backspace byte never matched); never digits inside a building or lot number
t = "서울 마포구 양화로 144 (동교동, MERCURE 앰배서더 HOTEL) 3층 TEL 02-330-1234"
check("밴스 홍대: 'HOTEL'은 주소(전에는 'HO'까지), 뒤의 'TEL 02-…'은 자름", B._full("서울 마포구 양화로 144", t),
      "서울 마포구 양화로 144 (동교동, MERCURE 앰배서더 HOTEL) 3층")
for label, text in (("Hotel·INTEL", "서울 강남구 테헤란로 1 Grand Hotel 3층, INTEL빌딩"),
                    ("STELLA·Telecom", "서울 강남구 테헤란로 1 STELLA타워 Telecom센터 2층")):
    check(f"영어 낱말 속 TEL·Tel은 그대로 — {label}", B.JUNK.sub("", text), text)
for label, text in (("TEL.", "서울 강남구 테헤란로 1 3층 TEL.02-123-4567"), ("Tel:", "서울 강남구 테헤란로 1 3층 Tel: 02-123-4567"),
                    ("한글·숫자에 붙은 TEL", "서울 강남구 테헤란로 1 3층TEL031-123-4567"), ("TELEPHONE", "서울 강남구 테헤란로 1 3층 TELEPHONE (02) 123-4567")):
    check(f"전화 표시 TEL은 자름 — {label}", B.JUNK.sub("", text), "서울 강남구 테헤란로 1 3층")
for label, tail in (("(031) 647-6025", " (031) 647-6025 진료시간 안내"), ("031.647.6025", " 031.647.6025"),
                    ("031 647 6025", " 031 647 6025 평일 10시"), ("02)123-4567", ", 02)123-4567"), ("0507-1234-5678", " 0507-1234-5678")):
    check(f"지역번호부터 전화번호는 자름 — {label}", B._full("경기 수원시 팔달구 효원로 1", "경기 수원시 팔달구 효원로 1 3층" + tail),
          "경기 수원시 팔달구 효원로 1 3층")
t = "경기 수원시 팔달구 효원로 1 그랜드프라자 빌딩 3층 301호~305호 (인계동) 031-647-6025 진료시간"
check("40자 창이 자른 전화번호('031-647-60')도 자름", B._full("경기 수원시 팔달구 효원로 1", t),
      "경기 수원시 팔달구 효원로 1 그랜드프라자 빌딩 3층 301호~305호 (인계동)")
for label, text in (("쁨 범계 지번 1042-1", "경기도 안양시 동안구 시민대로 206 인탑스빌딩 6층 (호계동 1042-1) 4호선 범계역 1번 출구 도보"),
                    ("천호대로 1024", "서울 강동구 천호대로 1024 (성내동, 힐스테이트 천호역 젠트리스), 지하1층"),
                    ("원당대로 1035·401~405호", "인천광역시 검단구 원당대로 1035, 검단라페온빌 2차 4층 401~405호 (원당동)"),
                    ("서초대로 301·202호·B01호", "서울 서초구 서초대로 301, 2층 202호, 203호, B01호"),
                    ("1100로 3321·우편번호", "제주특별자치도 제주시 1100로 3321 (노형동) (우)06234"),
                    ("층 끝의 번호", "대전광역시 서구 둔산동 1046, 9F~10F 1호선 시청역 2번 출구 도보 15분")):
    check(f"건물·지번 번호는 그대로 — {label}", B.JUNK.sub("", text), text)
# the phone pattern starts only at a real area code, not right after a digit and ':' or ',', and an opening '(' does not
# hide what is before it — so no half-cut time, price or 1588 number is left where the window ends (review 2026-10-16)
for label, tail in (("시간 10:00", " 진료 10:00"), ("시간 09:00", " 진료 09:00"), ("시간 12:02", " 진료 12:02"),
                    ("금액 39,000", " 가격 39,000"), ("금액 1,031,000", " 가격 1,031,000"),
                    ("지역번호 아닌 1588 0119", " 1588 0119"), ("지역번호 아닌 09-14", " 토 09-14"), ("날짜 2024 01 05", " 2024 01 05"),
                    ("우편번호 조각", " (우)0623"), ("T.031.647.6025", " T.031.647.6025"), ("T.(031)647-6025", " T.(031)647-6025")):
    text = "경기 수원시 팔달구 효원로 1 3층" + tail
    check(f"창 끝 숫자는 그대로 — {label}", B.JUNK.sub("", text), text)
for label, tail, want in (("문의:031 647 6025", " 문의:031 647 6025", " 문의:"), ("문의:(031)647-6025", " 문의:(031)647-6025", " 문의:"),
                          (",031 647 6025", " ,031 647 6025", ""), ("0507 1234 5678", " 0507 1234 5678", ""),
                          ("070 1234 5678", " 070 1234 5678", "")):
    check(f"글자·쉼표 뒤 전화번호는 그대로 자름 — {label}",
          B._full("경기 수원시 팔달구 효원로 1", "경기 수원시 팔달구 효원로 1 3층" + tail), "경기 수원시 팔달구 효원로 1 3층" + want)

# --- the app's clean-up of texts saved before (build2/appdata.py clean_addr), stored data2/branches.csv texts
for label, full, addr, want in (
        ("쁨 부평", "인천광역시 부평구 부평대로 11, 4층(부평동) Copyright ©2024 PPEUMCLINIC. A", "인천광역시 부평구 부평대로 11",
         "인천광역시 부평구 부평대로 11, 4층(부평동)"),
        ("밴스 구월(지번)", "인천 남동구 구월동 1457 Copyright © 2026 VANDS CLINIC all right", "인천 남동구 구월동 1457", "인천 남동구 구월동 1457"),
        ("쁨 부천: 40자에서 잘린 'Copyrigh'", "경기도 부천시 길주로 219, 2층 202호, 203호, 204호(중동, 드림빌딩) Copyrigh", "경기도 부천시 길주로 219",
         "경기도 부천시 길주로 219, 2층 202호, 203호, 204호(중동, 드림빌딩)"),
        ("유앤아이 명동: 40자에서 잘린 '내 위'", "서울 중구 남대문로 78 (명동1가, 타임워크명동빌딩), 타임워크명동 3층 (F301호) 내 위", "서울 중구 남대문로 78",
         "서울 중구 남대문로 78 (명동1가, 타임워크명동빌딩), 타임워크명동 3층 (F301호)"),
        ("유앤아이 분당미금: 40자에서 잘린 '내'", "경기 성남시 분당구 돌마로 86 (구미동, 엘레강스프라자), 2동 201~207호 (엘레강스프라자) 내",
         "경기 성남시 분당구 돌마로 86", "경기 성남시 분당구 돌마로 86 (구미동, 엘레강스프라자), 2동 201~207호 (엘레강스프라자)"),
        ("데이뷰 대전: 바닥글 링크", "대전 서구 둔지로 32 개인정보취급방침 이용약관 제증명수수료 비급여수가표 환불규정 미성년자시술", "대전 서구 둔지로 32",
         "대전 서구 둔지로 32"),
        ("셀린 광명: 바닥글 메뉴", "경기 광명시 철산로 20 야우리빌딩 8층 병원소개 의료진소개 개인정보취급방침 이용약관 환자의권리", "경기 광명시 철산로 20",
         "경기 광명시 철산로 20 야우리빌딩 8층"),
        ("리엔장 목동: 팝업 단추(전부터)", "서울특별시 양천구 목동동로 293, 2층(목동,대학빌딩) 오늘 하루 그만 보기 닫기 팝업 닫기 제휴문의",
         "서울특별시 양천구 목동동로 293", "서울특별시 양천구 목동동로 293, 2층(목동,대학빌딩)"),
        ("40자를 다 채우지 않은 끝의 '내'는 그대로(건물 안)", "서울 송파구 올림픽로 300 롯데월드몰 내", "서울 송파구 올림픽로 300",
         "서울 송파구 올림픽로 300 롯데월드몰 내"),
        ("판교: 바닥글 낱말 없는 덧붙임은 그대로", "경기 성남시 분당구 분당내곡로 117 그레이츠판교 3층 │신한은행 건물 3층", "경기 성남시 분당구 분당내곡로 117",
         "경기 성남시 분당구 분당내곡로 117 그레이츠판교 3층 │신한은행 건물 3층")):
    check(f"앱 주소 정리 — {label}", clean_addr(full, addr), want)
print(f"PASS: {n - len(fails)} / {n}", "| 0 failing" if not fails else f"| failing: {fails}")
sys.exit(1 if fails else 0)
