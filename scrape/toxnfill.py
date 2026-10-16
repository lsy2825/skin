"""톡스앤필 (toxnfillN.com, one site per branch): categories -> items -> options, read straight from the HTML.

usage: python scrape/toxnfill.py [--branches 압구정점,홍대점] [--workers 6] [--gap 0.7] [--shard 0/2]
Branch list = the branch <select> on any page (option value = that branch's site). Per branch:
  serviceInfo.php?c=   -> category links (serviceInfo.php?c=N)
  serviceInfo.php?c=N  -> item cards (detail.php?c=N&i=M) with a 'from' price
  detail.php?c=N&i=M   -> li.treatment_item: p.name, span.price strong (sale), del b (list price)
An item with no real options (walk-in only, e.g. '예약X', or prices only in a free-form table in the body) keeps its
card price as one row with option '(대표가)'. Free-form tables are not parsed (layouts differ per page).
Branches run in parallel (each its own site); requests to one site are spaced by --gap.
robots.txt (2026-10-16): every request — the branch list, category pages and detail pages — goes through the shared answer
(scrape/common.py Fetcher(robots=True)): a disallowed page, or any page of a site whose robots.txt cannot be read (5xx, no
answer, 401/403/429), is skipped and logged (no category list = that branch is skipped; no branch list = the run stops).
The answer is for the address asked; a redirect's target is not checked again.
"""
import argparse, re
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
from common import Fetcher, clean, now_iso, won, write_raw

SEED = "https://www.toxnfill1.com/serviceInfo.php?c="
NOTE = re.compile(r"참조|참고|^[▶※★▼]|가격표")


def branch_sites(f):
    r = f.get(SEED)
    if r is None:                      # robots.txt says no, or the page did not load: stop (scrape/branches.py keeps its old file)
        raise SystemExit(f"톡스앤필 지점 목록을 읽지 못함 ({f.last_error})")
    soup = BeautifulSoup(r.text, "html.parser")
    out = {}
    for o in soup.select("select option"):
        v = (o.get("value") or "").strip()
        m = re.match(r"https?://(www\.toxnfill\d+\.com)", v)
        if m:
            out[clean(o.get_text())] = "https://" + m.group(1)
    return out


def scrape_branch(name, site, gap):
    f = Fetcher(gap=gap, robots=True)
    rows, items, ts = [], [], now_iso()
    r = f.get(f"{site}/serviceInfo.php?c=")
    if not r:
        return name, rows, {"branch": name, "ok": False, "error": "no category list", "fails": f.fails}
    soup = BeautifulSoup(r.text, "html.parser")
    cats = {}
    for a in soup.select('a[href*="serviceInfo.php?c="]'):
        m = re.search(r"serviceInfo\.php\?c=(\d+)$", a.get("href", ""))
        if m and clean(a.get_text()):
            cats.setdefault(m.group(1), clean(a.get_text()))
    seen = set()
    for c, cname in cats.items():
        r = f.get(f"{site}/serviceInfo.php?c={c}")
        if not r:
            continue
        for a in BeautifulSoup(r.text, "html.parser").select('a[href*="detail.php?c="]'):
            m = re.search(r"detail\.php\?c=(\d+)&i=(\d+)", a.get("href", ""))
            if not m or m.group(2) in seen:
                continue
            seen.add(m.group(2))
            title = a.find("b")
            price = a.select_one(".txt_num")
            items.append((c, cname, m.group(2), clean(title.get_text()) if title else "", won(price.get_text()) if price else None))
    for c, cname, i, title, from_price in items:
        url = f"{site}/detail.php?c={c}&i={i}"
        r = f.get(url)
        if not r:
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        h = soup.select_one(".name_price_container h2.name")
        group = clean(h.get_text()) if h else title
        got = 0
        for li in soup.select("li.treatment_item"):
            nm = li.select_one("p.name")
            sale = li.select_one(".treatment_price_wrap span.price strong")
            if not nm or not sale:
                continue
            if not won(sale.get_text()) or NOTE.search(clean(nm.get_text())):
                continue    # ₩0 notes and 'see the table below' placeholders are not prices
            orig = li.select_one(".treatment_price_wrap del b")
            date = li.select_one(".event_date")
            rows.append({"brand": "톡스앤필", "branch": name, "category": cname, "group": group, "option": clean(nm.get_text()),
                         "sale": won(sale.get_text()), "orig": won(orig.get_text()) if orig else "", "addon": 0,
                         "until": clean(date.get_text()) if date else "", "url": url, "fetched_at": ts})
            got += 1
        if not got and from_price:
            rows.append({"brand": "톡스앤필", "branch": name, "category": cname, "group": group, "option": "(대표가)",
                         "sale": from_price, "orig": "", "addon": 0, "until": "", "url": url, "fetched_at": ts})
    return name, rows, {"branch": name, "ok": not f.fails, "cats": len(cats), "items": len(items), "rows": len(rows),
                        "requests": f.count, "fails": f.fails}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--branches")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--gap", type=float, default=0.7)
    ap.add_argument("--shard", help="i/n: only every n-th branch from i (split one run over several jobs)")
    a = ap.parse_args()
    f = Fetcher(robots=True)
    try:
        sites = branch_sites(f)
    except SystemExit:                 # the log says why; no rows = the weekly run keeps the last accepted file
        write_raw("toxnfill", [], {"brand": "톡스앤필", "branches": 0, "pages": [], "bad": [{"branch": "(지점 목록)", "ok": False,
                  "error": f.last_error, "fails": f.fails}], "finished": now_iso()})
        raise
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
            print(f"{name}: {log.get('items', 0)} items, {len(got)} rows, fails {len(log.get('fails', []))}", flush=True)
    bad = [l for l in logs if not l["ok"]]
    path = write_raw("toxnfill", rows, {"brand": "톡스앤필", "branches": len(sites), "pages": logs, "bad": bad, "finished": now_iso()})
    print(f"wrote {path}: {len(rows)} rows, {len(sites)} branches, {len(bad)} with failures")


if __name__ == "__main__":
    main()
