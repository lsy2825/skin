"""밴스의원 (V&S, {지점}.vandsclinics.com — one sub-site per branch on a shared booking platform), read from the HTML.

usage: python scrape/vands.py [--branches 영등포,용산] [--workers 6] [--gap 1.0]
Branch list = the branch links on www.vandsclinics.com (host + Korean name); language sites (en, cn …), clinics abroad
(일본) and branches marked '개원예정' are left out. Per branch:
  /web/product                    -> category links (?categoryId=N, e.g. '이달의 이벤트', '보톡스/윤곽주사')
  /web/product?categoryId=N       -> div.listBox: .title = the group (an event name, may carry a date range),
                                     .listRelative = one option: .listTitle (name), .text (note), .priceAfter (price),
                                     .priceLine (list price before the discount)
Every group on the site says '(VAT : 별도)' (checked 2026-10-14 on the probe pages) -> data2/vat_policy.json.
A note that states a condition (선착순, 1인, 첫 방문, 체험 …) is kept with the option name; other notes are dropped.
robots.txt (checked 2026-10-14): Allow /, Disallow /manager/ /conf/ /migration/ /log/ … — /web/product is allowed.
"""
import argparse, datetime, re
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
from common import Fetcher, clean, now_iso, won, write_raw

MAIN = "https://www.vandsclinics.com/"
ABROAD = {"나고야", "시부야", "신주쿠", "요코하마"}
HANGUL = re.compile(r"^[가-힣0-9 ]+$")
COND = re.compile(r"선착순|1인|1회 한정|첫 ?방문|체험|신규|재방문|한정|평일|주말|카톡|회원")
RANGE = re.compile(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*[~\-–]\s*(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일")


def branch_hosts(html):
    """{Korean branch name: host} from the main site's branch links."""
    out = {}
    for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        m = re.match(r"https?://([a-z0-9-]+)\.vandsclinics?\.com", a["href"])
        name = clean(a.get_text(" "))
        if not m or m.group(1) == "www" or not name:
            continue
        if "개원" in name or not HANGUL.match(name) or name in ABROAD:
            continue
        out.setdefault(name, f"https://{m.group(1)}.vandsclinics.com")
    return out


def categories(html):
    out = {}
    for a in BeautifulSoup(html, "html.parser").select('a[href*="categoryId="]'):
        m = re.search(r"categoryId=(\d+)", a["href"])
        if m and clean(a.get_text(" ")):
            out.setdefault(m.group(1), clean(a.get_text(" ")))
    return out


def until_of(title, today):
    """'10월 1일~10월 31일 까지' -> '2026-10-31' (the year of the fetch, or the next one when the month has passed)."""
    m = RANGE.search(title or "")
    if not m:
        return ""
    mon = int(m.group(3) or m.group(1))
    day = int(m.group(4))
    year = today.year + (1 if mon < today.month - 6 else 0)
    try:
        return datetime.date(year, mon, day).isoformat()
    except ValueError:
        return ""


def items(html, branch, cname, url, ts, today):
    rows = []
    for box in BeautifulSoup(html, "html.parser").select("div.listBox"):
        t = box.select_one(".title")
        group = clean(t.get_text(" ")) if t else cname
        until = until_of(group, today)
        for it in box.select(".listRelative"):
            nm, sale = it.select_one(".listTitle"), it.select_one(".priceAfter")
            if not nm or not sale:
                continue
            for b in nm.select("a"):
                b.decompose()    # the '예약' button
            name, price = clean(nm.get_text(" ")), won(sale.get_text())
            if not name or not price:
                continue
            note = it.select_one(".text")
            note = clean(note.get_text(" ")) if note else ""
            if note and COND.search(note):
                name = f"{name} ({note})"
            orig = it.select_one(".priceLine")
            rows.append({"brand": "밴스", "branch": branch, "category": cname, "group": re.sub(r"\(VAT\s*:\s*별도\)", "", group).strip(),
                         "option": name, "sale": price, "orig": won(orig.get_text()) if orig else "", "addon": 0,
                         "until": until, "url": url, "fetched_at": ts})
    return rows


def scrape_branch(name, site, gap):
    f, ts, today = Fetcher(gap=gap), now_iso(), datetime.date.fromisoformat(now_iso()[:10])
    r = f.get(f"{site}/web/product")
    if not r:
        return name, [], {"branch": name, "ok": False, "error": "no product page", "fails": f.fails}
    cats, rows = categories(r.text), []
    for c, cname in cats.items():
        url = f"{site}/web/product?categoryId={c}"
        r = f.get(url)
        if r:
            rows += items(r.text, name, cname, url, ts, today)
    seen, out = set(), []
    for x in rows:    # the same option listed in two categories (e.g. '이달의 이벤트' and its own category) counts once
        k = (x["group"], x["option"], x["sale"])
        if k not in seen:
            seen.add(k)
            out.append(x)
    return name, out, {"branch": name, "site": site, "ok": not f.fails, "cats": len(cats), "rows": len(out), "requests": f.count, "fails": f.fails}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--branches")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--gap", type=float, default=1.0)
    ap.add_argument("--shard", help="i/n: only every n-th branch from i (split one run over several jobs)")
    a = ap.parse_args()
    r = Fetcher().get(MAIN)
    sites = branch_hosts(r.text) if r else {}
    if a.branches:
        sites = {k: v for k, v in sites.items() if k in a.branches.split(",")}
    if a.shard:
        i, n = map(int, a.shard.split("/"))
        sites = dict(sorted(sites.items())[i::n])
    rows, logs = [], []
    with ThreadPoolExecutor(a.workers) as ex:
        for name, got, log in ex.map(lambda kv: scrape_branch(kv[0], kv[1], a.gap), sites.items()):
            rows += got
            logs.append(log)
            print(f"{name}: {log.get('cats', 0)} categories, {len(got)} rows, fails {len(log.get('fails', []))}", flush=True)
    bad = [l for l in logs if not l["ok"]]
    path = write_raw("vands", rows, {"brand": "밴스", "branches": len(sites), "pages": logs, "bad": bad, "finished": now_iso()})
    print(f"wrote {path}: {len(rows)} rows, {len(sites)} branches, {len(bad)} with failures")


if __name__ == "__main__":
    main()
