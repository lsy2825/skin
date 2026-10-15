"""셀린의원 (www.cellinclinic{N}.com — one site per branch, same template), '시술 안내/가격' read from the HTML.

usage: python scrape/cellin.py [--branches 잠실점,명동점] [--workers 4] [--gap 1.0] [--shard i/n]
Branch list = the '지점안내' links on any branch page (a[title$='정보보기'] → www.cellinclinicN.com). Per branch:
  /clinicPriceSide/clinicSideList.php   -> the event list: li.cate#li_<idx> (.Name b = event name, .Info = period)
  /clinicPriceSide/_contentDetail.php   -> POST idx=<idx>, the same request the page sends when an event is clicked:
                                          li.ListBox (.Name item, .Info explanation, .Price b sale price, em list price)
Branches whose site moved to the new platform ({slug}.cellinclinic.com/ko — 2026-10-15: 연신내 본점, 다산, 홍대) are logged
as 'moved' and skipped until that platform is read; a foreign-language site (Cellin水原网浦店) is not a price list.
VAT wording: the event cards say 'VAT 별도' (2026-10-15 check) -> data2/vat_policy.json 셀린 (branches not confirmed stay unknown).
robots.txt (2026-10-15, YoonSiljangBot and *): the price pages are allowed (scrape/raw_probe.py index). Probe history and
why 셀린 was held back before: docs/DATA_AND_LEGAL.md §1.
"""
import argparse, datetime, re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from common import Fetcher, clean, now_iso, won, write_raw

SEED = "https://www.cellinclinic10.com/clinicPriceSide/clinicSideList.php"
LIST, DETAIL = "/clinicPriceSide/clinicSideList.php", "/clinicPriceSide/_contentDetail.php"
HOST = re.compile(r"^https?://www\.cellinclinic\d+\.com/?$")
PERIOD = re.compile(r"(\d{1,2})/(\d{1,2})\s*(?:\([^)]*\))?\s*[-~]\s*(?:(\d{1,2})/)?(\d{1,2})")


def branch_sites(html):
    """{branch name: site} from the '지점안내' links; names in Hangul only (a foreign-language site is skipped)"""
    out = {}
    for a in BeautifulSoup(html, "html.parser").select("a[title$='정보보기']"):
        name, href = clean(a.get_text(" ")), (a.get("href") or "").rstrip("/")
        if HOST.match(href + "/") and re.fullmatch(r"[가-힣0-9()\s]+", name):
            out.setdefault(re.sub(r"\s*\(본점\)", "", name), href)
    return out


def until_of(info, today):
    """'* 10/15(목)-10/17(토)' → '2026-10-17' (this year; next year when the end month is before today's); '' when none"""
    m = PERIOD.search(info or "")
    if not m:
        return ""
    em, ed = int(m.group(3) or m.group(1)), int(m.group(4))
    y = today.year + (1 if em < today.month - 6 else 0)
    try:
        return datetime.date(y, em, ed).isoformat()
    except ValueError:
        return ""


def events(html):
    """[(idx, event name, period text)] from the event list"""
    out = []
    for li in BeautifulSoup(html, "html.parser").select("li.cate[id^='li_']"):
        name = li.select_one(".Name b") or li.select_one(".Name")
        info = li.select_one(".Info")
        out.append((li["id"][3:], clean(name.get_text(" ")) if name else "", clean(info.get_text(" ")) if info else ""))
    return out


def items(html, branch, group, until, url, ts):
    rows = []
    for li in BeautifulSoup(html, "html.parser").select("li.ListBox"):
        nm, info, sale = li.select_one(".Name"), li.select_one(".Info"), li.select_one(".Price .ColorTxt b")
        if not (nm and sale) or won(sale.get_text()) is None:
            continue                                        # no price on the item ('상담 후 결정' and the like)
        orig = li.select_one(".Price em")
        name = clean(nm.get_text(" "))
        expl = clean(info.get_text(" ")) if info else ""
        rows.append({"brand": "셀린", "branch": branch, "category": "", "group": group,
                     "option": f"{name} ({expl})" if expl and len(expl) <= 60 else name,
                     "sale": won(sale.get_text()), "orig": won(orig.get_text()) if orig else "", "addon": 0, "until": until,
                     "url": url, "fetched_at": ts})
    return rows


def scrape_branch(name, site, gap):
    f, ts, today = Fetcher(gap=gap, retries=1), now_iso(), datetime.date.today()
    r = f.get(site + LIST)
    if not r:
        return name, [], {"branch": name, "site": site, "ok": False, "error": "no event list", "fails": f.fails}
    if urlparse(r.url).netloc != urlparse(site).netloc:
        return name, [], {"branch": name, "site": site, "ok": True, "moved": r.url, "rows": 0, "fails": []}
    evs, rows = events(r.text), []
    for idx, ev, info in evs:
        d = f.get(site + DETAIL, method="POST", data={"idx": idx})
        if d:
            rows += items(d.text, name, ev, until_of(info, today), f"{site}{LIST}#li_{idx}", ts)
    seen, out = set(), []
    for x in rows:
        k = (x["group"], x["option"], x["sale"])
        if k not in seen:
            seen.add(k)
            out.append(x)
    return name, out, {"branch": name, "site": site, "ok": not f.fails, "events": len(evs), "rows": len(out), "requests": f.count, "fails": f.fails}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--branches")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--gap", type=float, default=1.0)
    ap.add_argument("--shard", help="i/n: only every n-th branch from i (split one run over several jobs)")
    a = ap.parse_args()
    r = Fetcher().get(SEED)
    sites = branch_sites(r.text) if r else {}
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
            print(f"{name}: {log.get('events', 0)} events, {len(got)} rows{' (moved: ' + log['moved'] + ')' if log.get('moved') else ''}, fails {len(log.get('fails', []))}", flush=True)
    bad = [l for l in logs if not l["ok"]]
    path = write_raw("cellin", rows, {"brand": "셀린", "branches": len(sites), "pages": logs, "bad": bad, "finished": now_iso()})
    print(f"wrote {path}: {len(rows)} rows, {len(sites)} branches, {len(bad)} with failures")


if __name__ == "__main__":
    main()
