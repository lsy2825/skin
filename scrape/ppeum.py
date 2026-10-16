"""쁨 (ppeum): two kinds of branch site, both read straight from the HTML.

usage: python scrape/ppeum.py [--only ppeum10,ppeum17] [--workers 4] [--gap 1.0] [--shard 0/2]
Branches = www.ppeum1.com .. www.ppeum{MAX_N}.com; each is followed to where it redirects:
  <name>.ppeum.com/          (new site) -> <name>.ppeum.com/selectSurgery: rendered product list.
      input[data-name][data-price][data-end] + label (full name) + select-box: first span = sale, .priceDecoration = list.
      Category = depth1 tab / depth2 tab; the depth2 tabs and the product boxes come in the same order.
  www.ppeumN.com/new/...     (old site) -> event.ppeum.com/v1/event/reserve?branch=ppeumN&type=homepage&directLink=onlineReserve
      li[data-num]: .cateName, strong (name), p b (sale), p > span (list). (The page's <h3> is a fixed label.)
  no answer / maintenance page -> skipped and logged.
Branch name = the site's <title> up to '점' (NAME_FIX for titles without it).
robots.txt (2026-10-16): every request — the branch search and the price pages — goes through the shared answer
(scrape/common.py Fetcher(robots=True)): a home whose robots.txt disallows it, or cannot be read (5xx, no answer, 401/403/429),
is skipped like a dead site, with the reason in the log. The answer is for the address asked; where it redirects
(<name>.ppeum.com/, www.ppeumN.com/new/...) is not checked again. The price page is checked on its own host.
"""
import argparse, re
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
from common import Fetcher, clean, now_iso, won, write_raw

NAME_FIX = {"changwon": "창원점"}
MAX_N = 40      # www.ppeum1.com .. www.ppeum40.com (35 was the highest in use on 2026-10-13)
EXTRA_SUBS = ["chuncheon", "changwon"]   # branches with only a <name>.ppeum.com site (no numbered domain)
OLD = "https://event.ppeum.com/v1/event/reserve?branch=ppeum{n}&type=homepage&directLink=onlineReserve"


def discover(f):
    # www.ppeum.com redirects browsers to one branch, so probe the numbered branch domains instead
    nums = range(1, MAX_N + 1)
    f.retries = 1
    out = []
    for n in list(nums) + EXTRA_SUBS:
        r = f.get(f"https://www.ppeum{n}.com/" if isinstance(n, int) else f"https://{n}.ppeum.com/")
        if not r:                       # no answer, or robots.txt says no / cannot be read: the reason goes to the log
            out.append({"n": n, "kind": "dead", "error": f.last_error})
            continue
        title = clean((BeautifulSoup(r.text, "html.parser").title or BeautifulSoup("<title></title>", "html.parser").title).get_text())
        m = re.match(r"https://([a-z]+)\.ppeum\.com(/|$)", r.url)
        sub = m.group(1) if m and m.group(1) != "www" else None
        nm = re.match(r"^(.*?점)", title)
        name = NAME_FIX.get(sub) or (nm.group(1).strip() if nm else "")
        if "|" in name or len(name) > 12:        # e.g. "울산피부과 | 예쁨주의쁨의원 울산점"
            name = name.split()[-1]
        kind = "new" if sub else ("old" if "/new/" in r.url else "other")
        if "점검" in title or not name:
            kind = "dead" if kind != "new" or not name else kind
        out.append({"n": n, "kind": kind, "sub": sub, "name": name, "title": title, "url": r.url})
    seen, uniq = set(), []
    for b in out:                       # an extra subdomain may also be reachable through a number
        k = b.get("sub") or b["n"]
        if b["kind"] == "dead" or k not in seen:
            seen.add(k)
            uniq.append(b)
    return uniq


def parse_new(html, name, url, ts):
    s = BeautifulSoup(html, "html.parser")
    d1 = s.select_one('[class*="SelectSurgery_depth1"]')
    d1 = [clean(x.get_text()) for x in d1.select(".swiper-slide")] if d1 else []
    tabs = [(d1[i] if i < len(d1) else "", clean(y.get_text()))
            for i, w in enumerate(s.select('[class*="SelectSurgery_depth2-wrap"]')) for y in w.select(".swiper-slide")]
    boxes = s.select('[class*="SelectSurgery_surgery-item-box"]')
    if len(tabs) != len(boxes):
        tabs = [("", "")] * len(boxes)      # cannot pair tabs with boxes: keep rows, leave category empty
    rows = []
    for (cat, sub), box in zip(tabs, boxes):
        for it in box.select('[class*="SelectSurgery_surgery-item__"]'):
            inp = it.select_one("input[data-price]")
            lab = it.find("label")
            sel = it.select_one('[class*="SelectSurgery_select-box"]')
            if not inp or not sel:
                continue
            spans = sel.find_all("span", recursive=False)
            sale = won(spans[0].get_text()) if spans else won(inp.get("data-price"))
            orig = sel.select_one(".priceDecoration")
            rows.append({"brand": "쁨", "branch": name, "category": cat, "group": sub,
                         "option": clean(lab.get_text()) if lab else clean(inp.get("data-name")),
                         "sale": sale, "orig": won(orig.get_text()) if orig else "",
                         "addon": 1 if cat == "옵션 상품" else 0,
                         "until": (inp.get("data-end") or "")[:10], "url": url, "fetched_at": ts})
    return rows


def parse_old(html, name, url, ts):
    s = BeautifulSoup(html, "html.parser")
    rows = []
    for li in s.select("li[data-num]"):
        nm, p = li.find("strong"), li.find("p")
        sale = p.find("b") if p else None
        if not nm or not sale:
            continue
        orig = p.find("span", recursive=False)
        cat = li.select_one(".cateName")
        rows.append({"brand": "쁨", "branch": name, "category": clean(cat.get_text()) if cat else "", "group": "",
                     "option": clean(nm.get_text()), "sale": won(sale.get_text()), "orig": won(orig.get_text()) if orig else "",
                     "addon": 0, "until": li.get("data-edate", ""), "url": url, "fetched_at": ts})
    return rows


def scrape(b, gap):
    f = Fetcher(gap=gap, robots=True)
    if b["kind"] == "new":
        url = f"https://{b['sub']}.ppeum.com/selectSurgery"
        r = f.get(url)
        rows = parse_new(r.text, b["name"], url, now_iso()) if r else []
    elif b["kind"] == "old":
        url = OLD.format(n=b["n"])
        r = f.get(url)
        rows = parse_old(r.text, b["name"], url, now_iso()) if r else []
    else:
        return b, [], {**b, "ok": False, "error": b.get("error") or "site not answering or not a branch site"}
    return b, rows, {**b, "ok": bool(rows), "rows": len(rows), "fails": f.fails}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--gap", type=float, default=1.0)
    ap.add_argument("--shard", help="i/n: only every n-th branch from i (split one run over several jobs)")
    a = ap.parse_args()
    found = discover(Fetcher(gap=0.5, robots=True))
    if a.only:
        found = [b for b in found if f"ppeum{b['n']}" in a.only.split(",")]
    if a.shard:
        i, n = map(int, a.shard.split("/"))
        found = found[i::n]
    rows, logs = [], []
    with ThreadPoolExecutor(a.workers) as ex:
        for b, got, log in ex.map(lambda b: scrape(b, a.gap), found):
            rows += got
            logs.append(log)
            print(f"ppeum{b['n']} {b.get('name', '')} [{b['kind']}]: {len(got)} rows", flush=True)
    bad = [l for l in logs if not l["ok"]]
    path = write_raw("ppeum", rows, {"brand": "쁨", "sites": logs, "bad": bad, "finished": now_iso()})
    print(f"wrote {path}: {len(rows)} rows, {sum(1 for l in logs if l['ok'])} branches, {len(bad)} skipped")


if __name__ == "__main__":
    main()
