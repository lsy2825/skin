"""Parsers of the collectors added 2026-10-14/15 (scrape/vands.py, uandi.py, daybeau.py, drevers.py, cellin.py), on trimmed copies of the
public price pages the robots-first probe read on a GitHub runner (scrape/probe.py; fixtures in tests/fixtures/brands).
The live sites are not reachable from the dev container, so these check the page layout as it was on 2026-10-14 —
when a site changes its markup the weekly guard (build2/weekly.py) keeps the last good file and this test shows where.
  python3 tests/brand_parsers_test.py
"""
import datetime, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scrape"))
import vands, uandi, daybeau, drevers, cellin  # noqa: E402

FX = os.path.join(ROOT, "tests", "fixtures", "brands")
TODAY = datetime.date(2026, 10, 14)
fails = []


def fx(name):
    return open(os.path.join(FX, name), encoding="utf-8").read()


def ok(label, cond, info=""):
    print(("PASS" if cond else "FAIL"), "|", label, "|", info)
    if not cond:
        fails.append(label)


def common(label, rows):
    ok(f"{label}: every row has a name and a positive price", rows and all(r["option"] and int(r["sale"]) > 0 for r in rows), len(rows))
    ok(f"{label}: list price is empty or not below the price", all(r["orig"] == "" or int(r["orig"]) >= int(r["sale"]) for r in rows))
    ok(f"{label}: no duplicate (group, option, price)", len({(r["group"], r["option"], r["sale"]) for r in rows}) == len(rows))


# 밴스
hosts = vands.branch_hosts(fx("vands_main.html"))
ok("밴스: domestic branches only (no language sites, no Japan, no '개원예정')", len(hosts) >= 60 and "영등포" in hosts and not {"나고야", "ENG", "아산 11/1개원예정"} & set(hosts), len(hosts))
cats = vands.categories(fx("vands_product.html"))
ok("밴스: category links", cats.get("6183") == "이달의 이벤트" and len(cats) >= 10, len(cats))
rows = vands.items(fx("vands_product.html"), "영등포", "이달의 이벤트", "u", "t", TODAY)
common("밴스", rows)
r0 = next(r for r in rows if r["option"] == "스킨보톡스 1부위 1회")
ok("밴스: price, list price, end date from the group's '10월 1일~10월 31일'", (r0["sale"], r0["orig"], r0["until"]) == (40000, 750000, "2026-10-31"), r0)
ok("밴스: a condition note stays with the name", any("(★선착순 10명 한정)" in r["option"] for r in rows))
ok("밴스: '(VAT : 별도)' is not left in the group", not any("VAT" in r["group"] for r in rows))
ok("밴스: until_of rolls into next year only for a month long past", vands.until_of("1월 1일~1월 31일", datetime.date(2026, 11, 20)) == "2027-01-31" and vands.until_of("9월 1일~9월 30일", TODAY) == "2026-09-30")

# 유앤아이
sites = uandi.branch_sites(fx("uandi_home.html"))
ok("유앤아이: branch sites from data-domain", len(sites) >= 40 and sites.get("강남점") == "https://www.uni114.co.kr", len(sites))
rows = uandi.items(fx("uandi_home.html"), "강남점", "u", "t")
common("유앤아이", rows)
ok("유앤아이: '전체보기' copy skipped, tab names as categories", "전체보기" not in {r["category"] for r in rows} and "보톡스·윤곽" in {r["category"] for r in rows})
ok("유앤아이: end date from '이벤트 기간 : … ~ 2026.10.31'", {r["until"] for r in rows} == {"2026-10-31"})
ok("유앤아이: first-visit tab marked in the group (condition tags read group + option)", any(r["group"].startswith("첫방문") for r in rows if "첫방문" in r["category"]))
ok("유앤아이: '지점문의' boxes are not prices", not any(r["option"] == "소프웨이브 100샷" and not r["sale"] for r in rows))

# 데이뷰
sites = daybeau.branch_sites(fx("daybeau_branches.html"))
ok("데이뷰: 14 branches, group site 00 excluded", len(sites) == 14 and "https://daybeauclinic00.com" not in sites.values(), len(sites))
rows = daybeau.items(fx("daybeau_event.html"), "여의도점", "u", "t")
common("데이뷰", rows)
r0 = rows[0]
ok("데이뷰: event name from <title> + section", r0["group"] == "첫방문 이벤트 · 보톡스/윤곽주사", r0["group"])
ok("데이뷰: '카톡플친 적용가' badge kept as a condition", "(카톡플친 적용가)" in r0["option"] and (r0["sale"], r0["orig"]) == (900, 1700), r0["option"])
ok("데이뷰: prepaid vouchers skipped", not any("멤버십" in r["option"] or "적립금" in r["option"] for r in rows))
ok("데이뷰: '[E]' prefix removed", not any(r["option"].startswith("[E]") for r in rows))

# 닥터에버스
sites = drevers.branch_sites(fx("drevers_main.html"))
ok("닥터에버스: 34 branches incl. the three links without text", len(sites) == 34 and {"연신내점", "동탄점", "시흥배곧점"} <= set(sites), len(sites))
paths = drevers.event_paths(fx("drevers_events.html"), "https://bucheon.drevers.com")
ok("닥터에버스: event pages on the same host only", paths and all(p.startswith("/event") for p in paths) and "/event/" not in paths, len(paths))
rows = drevers.items(fx("drevers_event.html"), "부천점", "u", "t")
common("닥터에버스", rows)
r0 = next(r for r in rows if "사각턱보톡스" in r["option"])
ok("닥터에버스: item JSON read (name, event, category, prices)", (r0["sale"], r0["orig"], r0["group"]) == (39000, 76400, "파마리서치×닥터에버스 SALE FESTA"), r0)
ok("닥터에버스: item name kept as the site gives it, section in 'category' (clean.py decides what goes in front)",
   not r0["option"].startswith("국산 프리미엄 보톡스") and r0["category"].endswith("국산 프리미엄 보톡스"), (r0["option"], r0["category"]))
ok("닥터에버스: a page without headings keeps the event name alone as the group", {r["group"] for r in rows} == {"파마리서치×닥터에버스 SALE FESTA"})
# the monthly 제모 page (광주상무점 /event-month-laser-removal/, 2026-10-16 raw probe): headings between the item groups
# ('젠틀맥스 프로플러스 제모' › '여성) BEST' / '여성 제모' / '남성) BEST' / '남성 제모', then a description line and the same menus
# for the other device) — the women's and men's menus list one name at two prices, the JSON names no sex
hair = drevers.items(fx("drevers_hair.html"), "광주상무점", "u", "t")
common("닥터에버스 제모", hair)
EV = "26년 10월) 10월 가을 맞이 秋향 저격 혜택"
by = lambda g, o: [r["sale"] for r in hair if r["group"] == g and r["option"] == o]
ok("닥터에버스 제모: the women's / men's heading goes into the group after the event name, the name stays as the site gives it",
   by(f"{EV} · 젠틀맥스 프로플러스 제모 · 여성 제모", "겨드랑이 5회") == [135000] and by(f"{EV} · 젠틀맥스 프로플러스 제모 · 남성 제모", "겨드랑이 5회") == [120000],
   sorted({r["group"] for r in hair}))
ok("닥터에버스 제모: 'BEST' headings carry the sex too ('여성) BEST' › '겨드랑이+인중 5회')",
   by(f"{EV} · 젠틀맥스 프로플러스 제모 · 여성) BEST", "겨드랑이+인중 5회") == [175000] and by(f"{EV} · 남성) BEST", "인중+입가+앞턱+겨드랑이 5회") == [119000])
ok("닥터에버스 제모: the description line starts the second device's menus (no 젠틀맥스 heading on them)",
   by(f"{EV} · 여성 제모", "겨드랑이 1회") == [9000] and by(f"{EV} · 남성 제모", "겨드랑이 1회") == [11000])
ok("닥터에버스 제모: every item under a heading that names its sex, one price per group and name",
   all(re.search(r"여성|남성", r["group"]) for r in hair) and len({(r["group"], r["option"]) for r in hair}) == len(hair), len(hair))
ok("닥터에버스 제모: a note heading ('※얼굴제모시 … 추가') is not a menu", not any("※" in r["group"] for r in hair))
# headings seen on the 34 branches' pages (2026-10-16 collector probe)
for t, want in [("여성) BEST", ("sex", "여성) BEST")), ("[★남성제모★]", ("sex", "[★남성제모★]")),
                ("여성 제모 (5회 기준) : 얼굴 제모에는 '클라리티' 장비 사용", ("sex", "여성 제모 (5회 기준)")),
                ("젠틀맥스 프로플러스 제모", ("title", "젠틀맥스 프로플러스 제모")), ("커플", ("title", "커플")),
                ("평일 10:00~16:00 한정", ("title", "평일 10:00~16:00 한정")),
                ("아리온 : 자체 냉각시스템으로 통증최소화", ("new", "")), ("클라리티2 | 아리온 : 자체 냉각시스템으로", ("new", "")),
                ("※항목별 1회씩 적용", ("note", "")), ("[※항목별 1회씩 적용]", ("note", "")), ("*수면마취 추가: 20만원", ("note", ""))]:
    ok(f"닥터에버스 heading '{t[:24]}' → {want}", drevers.menu_heading(t) == want, drevers.menu_heading(t))
_item = lambda i, n, p: ('<div class="item-group"><div class="group-header"><span class="group-title">x</span></div><input class="price-check" '
                         f'@change=\'$store.booking.toggle({{"id":{i},"name":"{n}","event_name":"10월 이벤트","category":"고주파 리프팅","price":{p},'
                         '"original_price":0,"is_inquiry":0})\'/></div>')
_head = lambda t: f'<div class="item-group"><div class="group-header"><span class="group-title hp-mk-box">{t}</span></div></div>'
_page = (f'<div class="category-section"><div class="category-header">고주파 리프팅</div>{_head("올리지오 : RF고주파를 이용하여")}'
         f'{_item(1, "올리지오 300샷", 99000)}{_head("※항목별 1회씩 적용")}{_item(2, "써마지 300샷", 990000)}</div>'
         f'<div class="category-section"><div class="category-header">레이저 제모</div>{_head("여성")}{_item(3, "겨드랑이 5회", 13000)}'
         f'{_head("커플")}{_item(4, "겨드랑이 5회", 20000)}</div>')
_rows = drevers.items(_page, "x점", "u", "t")
ok("닥터에버스: a section whose headings name no sex keeps them out of the group (product notes: '올리지오 : RF고주파 …')",
   [r["group"] for r in _rows[:2]] == ["10월 이벤트"] * 2, [r["group"] for r in _rows])
ok("닥터에버스: a new section starts with no heading; a title after a sex heading replaces it ('여성' → '커플')",
   [r["group"] for r in _rows[2:]] == ["10월 이벤트 · 여성", "10월 이벤트 · 커플"], [r["group"] for r in _rows])
# which section titles may go in front of a name (build2/clean.py title_words — 2026-10-14 '20만원3921만재생' spec labels)
sys.path.insert(0, os.path.join(ROOT, "build2"))
import clean  # noqa: E402
for title, want in [("◆국산 프리미엄 보톡스", "국산 프리미엄 보톡스"), ("레이저 제모", "레이저 제모"), ("볼뉴머/슈링크 유니버스 이벤트", "볼뉴머/슈링크 유니버스"),
                    ("20만원 39.21만", ""), ("만원 1.96만", ""), ("미백 | 톤업 | 색소 | 토닝", ""), ("콜라겐 재생｜스킨부스터", ""),
                    ("※카카오톡 플러스친구 혜택", ""), ("추천조합", ""), ("26년 10월 2차) 한글날 맞이 만원으로 맘껏누림 큰잔치", ""),
                    ("10월 리쥬란 특가", "리쥬란")]:
    ok(f"section title '{title}' → '{want}'", clean.title_words(title) == want, clean.title_words(title))
# the section title in front of the name loses its sex word when the menu heading (group) names the other sex (미사점, 2026-10-16)
for sec, grp, want in [("젠틀맥스 프로플러스 남성 제모", "10월 이벤트 · 여성 제모", "젠틀맥스 프로플러스 제모"),
                       ("젠틀맥스 프로플러스 남성 제모", "10월 이벤트 · 남성 제모", "젠틀맥스 프로플러스 남성 제모"),
                       ("젠틀맥스 프로플러스 남성 제모", "젠틀맥스 프로 플러스 제모 무제한 이벤트", "젠틀맥스 프로플러스 남성 제모"),
                       ("여자 레이저 제모", "10월 이벤트 · 여성) BEST", "여자 레이저 제모")]:
    ok(f"section '{sec}' under '{grp[-12:]}' → '{want}'", clean.section_head(sec, grp) == want, clean.section_head(sec, grp))

# 셀린 (list page + the detail the page loads when an event is clicked, 2026-10-15 raw probe)
sites = cellin.branch_sites(fx("cellin_list.html"))
ok("셀린: 12 branch sites, Hangul names only (no foreign-language site), '(본점)' dropped", len(sites) == 12 and "연신내점" in sites and not any("Cellin" in n for n in sites), sorted(sites))
evs = cellin.events(fx("cellin_list.html"))
ok("셀린: event list (idx, name, period)", len(evs) >= 100 and evs[0][:2] == ("10411", "게릴라이벤트🎁"), evs[0])
ok("셀린: event period → end date", cellin.until_of(evs[0][2], datetime.date(2026, 10, 15)) == "2026-10-17", evs[0][2])
rows = cellin.items(fx("cellin_detail.html"), "분당정자점", "첫방문", "", "u", "t")
common("셀린", rows)
r0 = rows[0]
ok("셀린: item with sale and list price, condition kept in the name", (r0["option"], r0["sale"], r0["orig"]) == ("[카톡플친대상/첫방문] 턱보톡스 50U (국산)", 9900, 19000), r0)

# 셀린 new platform (<slug>.cellinclinic.com — 연신내·다산·홍대; pages as fetched 2026-10-16, trimmed to the payload scripts)
Y = "https://yeonsinnae.cellinclinic.com"
urls = cellin.page_urls(fx("cellin_new_sitemap.xml"), "yeonsinnae.cellinclinic.com")
ok("셀린 새 사이트: sitemap → procedure and event pages only (no category, about, 비급여 or home page)",
   urls == [Y + "/ko/procedures/jaw-botox", Y + "/ko/procedures/thermage-flx", Y + "/ko/events/52", Y + "/ko/events/55"], urls)
ok("셀린 새 사이트: another host in a sitemap is not followed", cellin.page_urls(fx("cellin_new_sitemap.xml"), "dasan.cellinclinic.com") == [])
rows = cellin.new_items(fx("cellin_new_event.html"), "연신내점", Y + "/ko/events/52", "t")
common("셀린 새 사이트 이벤트", rows)
ok("셀린 새 사이트 이벤트: the event's 10 options, title as the group, end date from '이벤트기간 : 26.09.24 ~ 26.10.31'",
   len(rows) == 10 and {r["group"] for r in rows} == {"10월 EVENT"} and {r["until"] for r in rows} == {"2026-10-31"}, (len(rows), rows[:1]))
r0 = rows[0]
ok("셀린 새 사이트 이벤트: name as the site gives it, explanation kept, prices", (r0["option"], r0["sale"], r0["orig"], r0["category"]) ==
   ("[10월]PA필+피코슈어프로+카프리레이저+모델링 (+피부 정밀 촬영)", 109000, 210000, ""), r0)
ok("셀린 새 사이트 이벤트: a two-line explanation becomes one line",
   any(r["option"] == "[10월](여)아이큐)얼굴전체+카프리레이저+모델링 (*아이큐 : 코,미간,헤어라인,눈썹 제외 *최대 3회 한정)" for r in rows))
rows = cellin.new_items(fx("cellin_new_procedure.html"), "연신내점", Y + "/ko/procedures/thermage-flx", "t")
common("셀린 새 사이트 시술", rows)
ok("셀린 새 사이트 시술: options and the package tab, page title as the group, menu label as the category, no end date",
   len(rows) == 6 and {r["group"] for r in rows} == {"써마지 FLX"} and {r["category"] for r in rows} == {"리프팅"} and {r["until"] for r in rows} == {""}
   and ("울쎄라피프라임 300샷+써마지FLX 300샷", 1840000, 3200000) in [(r["option"], r["sale"], r["orig"]) for r in rows], rows[:2])
_p = lambda s: "<script>self.__next_f.push([1,%s])</script>" % json.dumps(s)
odd = cellin.new_items(_p('7:["$","$L2",null,{"eventOptions":['
                          '{"id":"a","name":"아쿠아필","longDescription":"$undefined","originalPrice":0,"salePrice":29000,"isFirst":true},'
                          '{"id":"b","name":"상담 시술","originalPrice":100000,"salePrice":null},'
                          '{"id":"c","name":"이벤트 옵션","originalPrice":9,"salePrice":5,"eventHref":"/events/52"},'
                          '{"id":"a","name":"아쿠아필","salePrice":29000,"isFirst":true}],"packageOptions":null}]\n'), "x", Y + "/ko/procedures/p", "t")
ok("셀린 새 사이트: '첫방문' badge kept in the name; no price (상담) skipped; an event's option on a procedure page left to the event page; "
   "same option id once; list price 0 = none", [(r["option"], r["sale"], r["orig"]) for r in odd] == [("아쿠아필 (첫방문)", 29000, "")], odd)
ok("셀린 새 사이트: an event with no end date has none", cellin.new_until("이벤트기간 : 26.09.03 ~ ") == "" and cellin.new_until("이벤트기간 : {range}") == "")

# the collectors' robots.txt / Crawl-delay manners (scrape/common.py Fetcher, lienjang, branches, the weekly gate; no network):
# their own file, run from here so the PR checks run them (2026-10-16)
import subprocess  # noqa: E402
r = subprocess.run([sys.executable, os.path.join(ROOT, "tests", "crawl_manners_cases.py")], capture_output=True, text=True, timeout=240)
print(r.stdout, end="")
ok("수집 예절(robots.txt·Crawl-delay) — tests/crawl_manners_cases.py", r.returncode == 0, "" if r.returncode == 0 else (r.stdout + r.stderr)[-600:])

print(f"{'FAIL' if fails else 'PASS'}: {len(fails)} failing")
sys.exit(1 if fails else 0)
