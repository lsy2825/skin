"""블리비의원 (velyb.kr): every branch x 7 category pages, read straight from the HTML.

usage: python scrape/velyb.py [--branches 강남역점,홍대점] [--gap 1.0]
Page: /community/community01.php?tb=event_multi&etc5=<branch>&sField=<1..7>. The '더보기' toggle only folds rows
that are already in the HTML, so one GET per page has every option. Rows starting '옵션N)' are add-ons;
'※' rows are notes (no price) and are skipped.
"""
import argparse, re, sys
from urllib.parse import quote
from bs4 import BeautifulSoup
from common import Fetcher, clean, now_iso, won, write_raw

BASE = "https://www.velyb.kr/community/community01.php?tb=event_multi"
CATS = {1: "기획전", 2: "쁘띠성형", 3: "피부", 4: "리프팅", 5: "부스터", 6: "제모", 7: "비만"}


def page_url(branch, sf):
    return f"{BASE}&etc5={quote(branch)}&sField={sf}"


def branches(f):
    r = f.get(page_url("강남역점", 3))
    if not r:
        sys.exit("cannot read the branch list")
    soup = BeautifulSoup(r.text, "html.parser")
    out = []
    for a in soup.select("#tab_menu01 a"):
        m = re.search(r"etc5=([^&]+)&", a.get("href", ""))
        if m:
            out.append(clean(a.get_text()))
    return out


def parse(html, branch, sf, url, ts):
    soup = BeautifulSoup(html, "html.parser")
    rows, groups = [], 0
    for cont in soup.select("div.cont"):
        title = cont.select_one(".title .t01")
        if not title:
            continue
        shown = clean(cont.select_one(".top .branch").get_text()) if cont.select_one(".top .branch") else ""
        if shown and shown != branch:
            raise ValueError(f"page shows branch {shown!r}, expected {branch!r}")
        groups += 1
        group = clean(title.get_text())
        date = cont.select_one(".top .date")
        until = ""
        if date:
            m = re.search(r"(\d{4}-\d{2}-\d{2})", date.get_text())
            until = m.group(1) if m else clean(date.get_text())
        for li in cont.select("ul.slist > li"):
            name = li.find("strong")
            sale = li.select_one(".o_price01 b")
            if not name or not sale:
                continue
            orig = li.select_one(".s_price01 del")
            opt = clean(name.get_text())
            rows.append({
                "brand": "블리비", "branch": branch, "category": CATS[sf], "group": group, "option": opt,
                "sale": won(sale.get_text()), "orig": won(orig.get_text()) if orig else "",
                "addon": 1 if re.match(r"^옵션\s*\d*\s*\)", opt) else 0,
                "until": until, "url": url, "fetched_at": ts,
            })
    has_footer = soup.select_one("#footer") is not None
    return rows, groups, has_footer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--branches")
    ap.add_argument("--gap", type=float, default=1.0)
    a = ap.parse_args()
    f = Fetcher(gap=a.gap)
    names = a.branches.split(",") if a.branches else branches(f)
    rows, pages = [], []
    for bi, br in enumerate(names, 1):
        for sf in CATS:
            url = page_url(br, sf)
            r = f.get(url)
            if not r:
                pages.append({"branch": br, "sField": sf, "ok": False, "error": f.fails[-1]["error"]})
                continue
            try:
                got, groups, footer = parse(r.text, br, sf, url, now_iso())
            except ValueError as e:
                pages.append({"branch": br, "sField": sf, "ok": False, "error": str(e)})
                continue
            rows += got
            pages.append({"branch": br, "sField": sf, "ok": footer, "groups": groups, "rows": len(got)})
        print(f"[{bi}/{len(names)}] {br}: {sum(p.get('rows', 0) for p in pages if p['branch'] == br)} rows", flush=True)
    bad = [p for p in pages if not p["ok"]]
    path = write_raw("velyb", rows, {"brand": "블리비", "branches": len(names), "pages": pages, "bad": bad,
                                     "requests": f.count, "finished": now_iso()})
    print(f"wrote {path}: {len(rows)} rows, {len(pages)} pages, {len(bad)} bad")


if __name__ == "__main__":
    main()
