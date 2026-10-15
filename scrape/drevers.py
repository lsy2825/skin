"""닥터에버스의원 ({지점}.drevers.com — WordPress sites per branch), event pages read from the HTML.

usage: python scrape/drevers.py [--branches 부천점,노원점] [--workers 6] [--gap 1.0]
Branch list = links to {slug}.drevers.com on drevers.com (text = branch name; three links carry no text, their names
come from the branch list printed on the same page — NAMELESS below). Per branch:
  /event/                      -> event pages on the same host (/event/<slug>/, /event-month-<slug>/); a link to
                                  another branch's page (…-incheon) answers 404 and is skipped
  each event page              -> input.price-check: its @change handler carries the item as JSON
                                  {name, event_name, category, price, original_price, is_inquiry} — read as is.
                                  is_inquiry = 1 ('가격 문의') is not a price.
Events for 카카오톡 friends say so in their name ('해피아워 이벤트(카톡친구대상)'); the name is kept as the group.
VAT wording: the event cards say 'VAT 별도' (2026-10-15 check) -> data2/vat_policy.json 닥터에버스 (branches not confirmed stay unknown).
robots.txt (2026-10-14): Disallow /wp-admin/ /wp-json/ /backpg/ /shop/ — event pages are allowed. The words 'captcha' and
'로그인이 필요' seen by the probe were inside scripts (a consultation form), not a wall in front of the prices.
"""
import argparse, json, re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from common import Fetcher, clean, now_iso, write_raw

MAIN = "https://drevers.com/"
NAMELESS = {"yeonsinnae": "연신내점", "dongtan": "동탄점", "siheung-baegot": "시흥배곧점"}
TOGGLE = re.compile(r"toggle\((\{.*\})\)\s*$", re.S)


def branch_sites(html):
    out = {}
    for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        m = re.match(r"https?://([a-z0-9-]+)\.drevers\.com", a["href"])
        if not m or m.group(1) == "www":
            continue
        name = clean(a.get_text(" ")) or NAMELESS.get(m.group(1), "")
        if name and name.endswith("점"):
            out.setdefault(name, f"https://{m.group(1)}.drevers.com")
    return out


def event_paths(html, site):
    host, out = urlparse(site).netloc, []
    for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        p = urlparse(urljoin(site + "/event/", a["href"]))
        if p.netloc == host and p.path.startswith("/event") and p.path.rstrip("/") != "/event" and p.path not in out:
            out.append(p.path)
    return out


def items(html, branch, url, ts):
    rows = []
    for inp in BeautifulSoup(html, "html.parser").select("input.price-check"):
        m = TOGGLE.search(inp.get("@change", "") or "")
        if not m:
            continue
        try:
            x = json.loads(m.group(1))
        except ValueError:
            continue
        if x.get("is_inquiry") or not x.get("price"):
            continue
        # the item name as the site gives it; build2/clean.py puts the section ('◆볼뉴머' › '페이스 300샷') in front only when
        # the section names a product — sections such as '20만원 39.21만' or '미백 | 톤업 | 색소 | 토닝' are not product words
        cat, name = clean(x.get("category", "")), clean(x.get("name", ""))
        rows.append({"brand": "닥터에버스", "branch": branch, "category": cat,
                     "group": clean(x.get("event_name", "")), "option": name, "sale": int(x["price"]),
                     "orig": int(x["original_price"]) if x.get("original_price") else "", "addon": 0, "until": "",
                     "url": url, "fetched_at": ts})
    return rows


def scrape_branch(name, site, gap):
    f, ts = Fetcher(gap=gap, retries=1), now_iso()
    r = f.get(f"{site}/event/")
    if not r:
        return name, [], {"branch": name, "ok": False, "error": "no event list", "fails": f.fails}
    paths, rows = event_paths(r.text, site), []
    for p in paths:
        url = site + p
        page = f.get(url)
        if page:
            rows += items(page.text, name, url, ts)
    seen, out = set(), []
    for x in rows:
        k = (x["group"], x["option"], x["sale"])
        if k not in seen:
            seen.add(k)
            out.append(x)
    missing = [x for x in f.fails if not x["error"].startswith("HTTP 404")]   # other branches' links: 404, expected
    return name, out, {"branch": name, "site": site, "ok": not missing, "events": len(paths), "rows": len(out), "requests": f.count, "fails": missing}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--branches")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--gap", type=float, default=1.0)
    ap.add_argument("--shard", help="i/n: only every n-th branch from i (split one run over several jobs)")
    a = ap.parse_args()
    r = Fetcher().get(MAIN)
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
    path = write_raw("drevers", rows, {"brand": "닥터에버스", "branches": len(sites), "pages": logs, "bad": bad, "finished": now_iso()})
    print(f"wrote {path}: {len(rows)} rows, {len(sites)} branches, {len(bad)} with failures")


if __name__ == "__main__":
    main()
