"""Parsers of the collectors added 2026-10-14/15 (scrape/vands.py, uandi.py, daybeau.py, drevers.py, cellin.py), on trimmed copies of the
public price pages the robots-first probe read on a GitHub runner (scrape/probe.py; fixtures in tests/fixtures/brands).
The live sites are not reachable from the dev container, so these check the page layout as it was on 2026-10-14 —
when a site changes its markup the weekly guard (build2/weekly.py) keeps the last good file and this test shows where.
  python3 tests/brand_parsers_test.py
"""
import datetime, os, sys

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
# which section titles may go in front of a name (build2/clean.py title_words — 2026-10-14 '20만원3921만재생' spec labels)
sys.path.insert(0, os.path.join(ROOT, "build2"))
import clean  # noqa: E402
for title, want in [("◆국산 프리미엄 보톡스", "국산 프리미엄 보톡스"), ("레이저 제모", "레이저 제모"), ("볼뉴머/슈링크 유니버스 이벤트", "볼뉴머/슈링크 유니버스"),
                    ("20만원 39.21만", ""), ("만원 1.96만", ""), ("미백 | 톤업 | 색소 | 토닝", ""), ("콜라겐 재생｜스킨부스터", ""),
                    ("※카카오톡 플러스친구 혜택", ""), ("추천조합", ""), ("26년 10월 2차) 한글날 맞이 만원으로 맘껏누림 큰잔치", ""),
                    ("10월 리쥬란 특가", "리쥬란")]:
    ok(f"section title '{title}' → '{want}'", clean.title_words(title) == want, clean.title_words(title))

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

print(f"{'FAIL' if fails else 'PASS'}: {len(fails)} failing")
sys.exit(1 if fails else 0)
