"""데이뷰의원 (daybeauclinicNN.com — one site per branch, same template), event pages read from the HTML.

usage: python scrape/daybeau.py [--branches 여의도점,분당점] [--workers 6] [--gap 1.0]
Branch list = links to daybeauclinicNN.com on any branch's /branch/index.php (text = branch name). daybeauclinic00.com
(the group site) is not a branch. Per branch:
  /branch/event.php           -> event links (event.php?uid=N)
  /branch/event.php?uid=N     -> <title> 'event name | 데이뷰의원 - 지점 | …'; div.event_cont = a section
                                 (.event_cont_title) with div.action items: h3.goods_title (option), .custPrice (price),
                                 .price (list price), .icon_btn badges ('카톡플친 적용가' is a condition, kept with the name)
'VAT는 별도입니다' on the event pages (probe 2026-10-14) -> data2/vat_policy.json. Prepaid vouchers (멤버십 … 원권, 적립금)
are not treatment prices and are skipped.
robots.txt (2026-10-14): User-agent: * Allow: / (daybeauclinic08, 11). daybeauclinic00.com did not answer over TLS: skipped.
"""
import argparse, re
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
from common import Fetcher, clean, now_iso, won, write_raw

SEED = "https://daybeauclinic08.com/branch/index.php"
COND_BADGE = re.compile(r"카톡|플친|첫\s*방문|신규|1인|선착순|평일|주말")
VOUCHER = re.compile(r"멤버십|적립금|\d+만원권")


def branch_sites(html):
    out = {}
    for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        m = re.match(r"https?://(daybeauclinic(\d+))\.com", a["href"])
        name = clean(a.get_text(" "))
        if m and name and m.group(2) != "00":
            out.setdefault(name, f"https://{m.group(1)}.com")
    return out


def event_uids(html):
    return list(dict.fromkeys(re.findall(r"event\.php\?uid=(\d+)", html)))


def items(html, branch, url, ts):
    soup = BeautifulSoup(html, "html.parser")
    title = clean(soup.title.get_text()) if soup.title else ""
    event = clean(title.split("|")[0]) if title else ""
    rows = []
    for cont in soup.select("div.event_cont"):
        h = cont.select_one(".event_cont_title")
        section = clean(h.get_text(" ")) if h else ""
        for a in cont.select("div.action"):
            nm, sale = a.select_one("h3.goods_title"), a.select_one(".custPrice")
            if not nm or not sale or not won(sale.get_text()):
                continue
            name = re.sub(r"^\[E\]\s*", "", clean(nm.get_text(" ")))
            if VOUCHER.search(name):
                continue
            badges = [clean(b.get_text()) for b in a.select(".icon_btn")]
            cond = [b for b in badges if COND_BADGE.search(b)]
            if cond:
                name = f"{name} ({' · '.join(cond)})"
            orig = a.select_one(".price_wrap .price")
            group = " · ".join(x for x in (event, section) if x)
            rows.append({"brand": "데이뷰", "branch": branch, "category": section or event, "group": group, "option": name,
                         "sale": won(sale.get_text()), "orig": won(orig.get_text()) if orig else "", "addon": 0, "until": "",
                         "url": url, "fetched_at": ts})
    return rows


def scrape_branch(name, site, gap):
    f, ts = Fetcher(gap=gap), now_iso()
    r = f.get(f"{site}/branch/event.php")
    if not r:
        return name, [], {"branch": name, "ok": False, "error": "no event list", "fails": f.fails}
    uids, rows = event_uids(r.text), []
    if not uids:
        rows += items(r.text, name, f"{site}/branch/event.php", ts)
    for u in uids:
        url = f"{site}/branch/event.php?uid={u}"
        p = f.get(url)
        if p:
            rows += items(p.text, name, url, ts)
    seen, out = set(), []
    for x in rows:
        k = (x["group"], x["option"], x["sale"])
        if k not in seen:
            seen.add(k)
            out.append(x)
    return name, out, {"branch": name, "site": site, "ok": not f.fails, "events": len(uids), "rows": len(out), "requests": f.count, "fails": f.fails}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--branches")
    ap.add_argument("--workers", type=int, default=6)
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
            print(f"{name}: {log.get('events', 0)} events, {len(got)} rows, fails {len(log.get('fails', []))}", flush=True)
    bad = [l for l in logs if not l["ok"]]
    path = write_raw("daybeau", rows, {"brand": "데이뷰", "branches": len(sites), "pages": logs, "bad": bad, "finished": now_iso()})
    print(f"wrote {path}: {len(rows)} rows, {len(sites)} branches, {len(bad)} with failures")


if __name__ == "__main__":
    main()
