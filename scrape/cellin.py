"""셀린의원 (www.cellinclinic{N}.com — one site per branch, same template), '시술 안내/가격' read from the HTML.

usage: python scrape/cellin.py [--branches 잠실점,명동점] [--workers 4] [--gap 1.0] [--shard i/n]
Branch list = the '지점안내' links on any branch page (a[title$='정보보기'] → www.cellinclinicN.com). Per branch:
  /clinicPriceSide/clinicSideList.php   -> the event list: li.cate#li_<idx> (.Name b = event name, .Info = period)
  /clinicPriceSide/_contentDetail.php   -> POST idx=<idx>, the same request the page sends when an event is clicked:
                                          li.ListBox (.Name item, .Info explanation, .Price b sale price, em list price)
Branches on the new platform (2026-10-15: 연신내 본점, 다산, 홍대): the old list address redirects to <slug>.cellinclinic.com/ko,
a Next.js site whose HTML shows no price as text — the prices travel inside the page itself, in the data the server writes
for the page's script (self.__next_f.push([1, "…"]), the React Server Components payload). Read the same way per branch:
  /sitemap.xml                          -> the procedure pages /ko/procedures/<slug> and event pages /ko/events/<id>
  each of those pages                   -> its option list (eventOptions + packageOptions: name, longDescription,
                                          originalPrice, salePrice, isFirst), the page title (breadcrumb), the procedure's
                                          category (breadcrumb link → menu label), an event's '이벤트기간 : 26.09.24 ~ 26.10.31'
  No /api/ address is asked (robots.txt of those hosts disallows /api/, /ko/search, /ko/cart, /ko/login, /ko/appointment …;
  2026-10-16 probe), nothing is logged in to, no script is run.
A foreign-language site (Cellin水原网浦店) is not a price list.
Every request goes through robots.txt of its own host (scrape/common.py Fetcher(robots=True), Reader below): the branch list,
each list page, every detail POST, the new-platform pages, and each address a redirect points to.
VAT wording: the event cards say 'VAT 별도' (2026-10-15 check) -> data2/vat_policy.json 셀린 (branches not confirmed stay unknown);
the new-platform option box says '＊모든 시술 가격은 부가세 별도입니다.' (2026-10-16 probe).
robots.txt (2026-10-15/16, YoonSiljangBot and *): the price pages are allowed (scrape/raw_probe.py index). Probe history and
why 셀린 was held back before: docs/DATA_AND_LEGAL.md §1.
"""
import argparse, datetime, json, re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from common import Fetcher, clean, now_iso, won, write_raw

SEED = "https://www.cellinclinic10.com/clinicPriceSide/clinicSideList.php"
LIST, DETAIL = "/clinicPriceSide/clinicSideList.php", "/clinicPriceSide/_contentDetail.php"
HOST = re.compile(r"^https?://www\.cellinclinic\d+\.com/?$")
PERIOD = re.compile(r"(\d{1,2})/(\d{1,2})\s*(?:\([^)]*\))?\s*[-~]\s*(?:(\d{1,2})/)?(\d{1,2})")
REDIRECT = (301, 302, 303, 307, 308)
NEW_HOST = re.compile(r"^[a-z0-9-]+\.cellinclinic\.com$")                    # the new platform (not www.cellinclinicN.com)
NEW_PAGE = re.compile(r"/ko/(?:procedures/(?!category/)[a-z0-9-]+|events/\d+)/?$")
PUSH = re.compile(r'self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)')
NEW_PERIOD = re.compile(r"이벤트기간\s*:\s*(\d{2})\.(\d{1,2})\.(\d{1,2})\s*~\s*(?:(\d{2})\.(\d{1,2})\.(\d{1,2}))?")


class Reader(Fetcher):
    """common.Fetcher(robots=True) that does not follow a redirect by itself (2026-10-16): the 30x answer comes back and read()
    asks for the next address with get() again, so that address too passes robots.txt of its own host and the gap. The moved
    branches answer the old list address with a redirect to <branch>.cellinclinic.com — before, requests followed it with no
    look at that host's robots.txt. A robots.txt request itself may still be redirected (RFC 9309 follows up to five)."""

    def __init__(self, gap=1.0, retries=1):
        super().__init__(gap=gap, retries=retries, robots=True)

    def _request(self, url, method="GET", **kw):
        if urlparse(url).path != "/robots.txt":
            kw["allow_redirects"] = False
        r, err = super()._request(url, method, **kw)
        if r is not None and r.status_code in REDIRECT and r.headers.get("location"):
            return r, ""
        return r, err

    def read(self, url, method="GET", hops=3, **kw):
        """get() that follows up to `hops` redirects one by one → (response or None, the address that answered)"""
        for _ in range(hops + 1):
            r = self.get(url, method, **kw)
            if r is None or r.status_code not in REDIRECT:
                return r, url
            if r.status_code in (301, 302, 303):
                method, kw = "GET", {}
            url = urljoin(url, r.headers["location"])
        self.last_error = "too many redirects"
        self.fails.append({"url": url, "error": self.last_error})
        return None, url


# --- new platform (<slug>.cellinclinic.com)
def flight(html):
    """the page's own data: the strings the server hands to the page's script in self.__next_f.push([1, "…"]), joined"""
    out = []
    for m in PUSH.finditer(html or ""):
        try:
            out.append(json.loads(m.group(1)))
        except ValueError:
            pass
    return "".join(out)


def _values(text, start):
    """every JSON value that begins at a match of `start` (a regex) in the payload text"""
    dec, out = json.JSONDecoder(), []
    for m in re.finditer(start, text):
        try:
            out.append(dec.raw_decode(text, m.start())[0])
        except ValueError:
            pass
    return out


def _texts(node):
    """the text children of a React element tree in order (['$', tag, key, props] nodes; '$…' strings are references)"""
    if isinstance(node, str):
        return [] if node.startswith("$") else [node]
    if isinstance(node, list):
        if len(node) == 4 and node[0] == "$" and isinstance(node[3], dict):
            return _texts(node[3].get("children"))
        return [t for x in node for t in _texts(x)]
    return []


def _keys(node):
    """the element keys in a React element tree ('/procedures/category/lifting' on a breadcrumb link)"""
    if isinstance(node, list):
        own = [node[2]] if len(node) == 4 and node[0] == "$" and isinstance(node[2], str) else []
        kids = node[3].get("children") if len(node) == 4 and node[0] == "$" and isinstance(node[3], dict) else node
        return own + [k for x in (kids if isinstance(kids, list) else [kids]) for k in _keys(x)]
    return []


def page_urls(xml, host):
    """the procedure and event pages of a new-platform branch from its sitemap.xml (its robots.txt points to it)"""
    out = []
    for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml or ""):
        u = urlparse(loc)
        if u.netloc == host and NEW_PAGE.search(u.path) and loc not in out:
            out.append(loc)
    return out


def new_until(text):
    """'이벤트기간 : 26.09.24 ~ 26.10.31' → '2026-10-31'; '' when there is no end date"""
    m = NEW_PERIOD.search(text or "")
    if not m or not m.group(4):
        return ""
    try:
        return datetime.date(2000 + int(m.group(4)), int(m.group(5)), int(m.group(6))).isoformat()
    except ValueError:
        return ""


def new_items(html, branch, url, ts):
    """rows of one new-platform page (a procedure or an event): its option boxes as the site gives them. The group is the page
    title, the category the procedure's menu label ('리프팅', '제모'); '첫방문' (isFirst) and the explanation stay with the name"""
    text = flight(html)
    boxes = [v for v in _values(text, r'\{"eventOptions":\[') if isinstance(v, dict)]
    crumbs = _values(text, r'\["\$","nav",null,\{"aria-label":"breadcrumb"')
    titles = _texts(crumbs[0]) if crumbs else []
    group = clean(titles[-1]) if titles else ""
    cat_key = next((k.rsplit("/", 1)[1] for k in (_keys(crumbs[0]) if crumbs else []) if k.startswith("/procedures/category/")), "")
    category = ""
    if cat_key:
        m = re.search(r'"href":"/procedures/category/%s","label":"((?:[^"\\]|\\.)*)"' % re.escape(cat_key), text) or \
            re.search(r'"key":"%s","header":"((?:[^"\\]|\\.)*)"' % re.escape(cat_key), text)
        category = clean(json.loads(f'"{m.group(1)}"')) if m else ""
    until = new_until(text) if "/events/" in url else ""
    rows, seen = [], set()
    for box in boxes:
        for o in (box.get("eventOptions") or []) + (box.get("packageOptions") or []):
            if not isinstance(o, dict) or o.get("id") in seen:
                continue
            seen.add(o.get("id"))
            if isinstance(o.get("eventHref"), str) and o["eventHref"].startswith("/"):
                continue                                    # an event's option shown on a procedure page: read on the event page
            sale = o.get("salePrice") if isinstance(o.get("salePrice"), int) else won(o.get("salePrice"))
            if not sale:
                continue                                    # no price ('상담')
            orig = o.get("originalPrice") if isinstance(o.get("originalPrice"), int) else won(o.get("originalPrice"))
            name = clean(str(o.get("name") or ""))
            expl = o.get("longDescription")
            expl = clean(expl) if isinstance(expl, str) and not expl.startswith("$") else ""
            if not name:
                continue
            if o.get("isFirst") is True and "첫방문" not in name:
                name += " (첫방문)"
            rows.append({"brand": "셀린", "branch": branch, "category": category, "group": group,
                         "option": f"{name} ({expl})" if expl and len(expl) <= 60 else name,
                         "sale": sale, "orig": orig if orig and orig > 0 else "", "addon": 0, "until": until,
                         "url": url, "fetched_at": ts})
    return rows


def scrape_new(f, name, home, old_site, ts):
    """a branch on the new platform: its sitemap, then each procedure and event page (same Reader: robots.txt, 1 s gap)"""
    u = urlparse(home)
    base, host = f"{u.scheme}://{u.netloc}", u.netloc
    sm, _ = f.read(base + "/sitemap.xml")
    pages = page_urls(sm.text, host) if sm else []
    rows = []
    for p in pages:
        r, at = f.read(p)
        if r is not None and r.status_code == 200 and urlparse(at).netloc == host:
            rows += new_items(r.text, name, at, ts)
    seen, out = set(), []
    for x in rows:
        k = (x["group"], x["option"], x["sale"])
        if k not in seen:
            seen.add(k)
            out.append(x)
    # branches.py / branch_rows.py read the address from addr_url (the footer of a light page, robots.txt first)
    return name, out, {"branch": name, "site": base, "old_site": old_site, "platform": "new", "addr_url": base + "/ko/events",
                       "ok": bool(sm) and not f.fails, "events": len(pages), "rows": len(out), "requests": f.count,
                       "fails": f.fails}


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
    f, ts, today = Reader(gap=gap, retries=1), now_iso(), datetime.date.today()
    r, at = f.read(site + LIST)
    if not r:
        return name, [], {"branch": name, "site": site, "ok": False, "error": f"no event list ({f.last_error})", "fails": f.fails}
    if urlparse(at).netloc != urlparse(site).netloc:
        if NEW_HOST.match(urlparse(at).netloc):
            return scrape_new(f, name, at, site, ts)
        return name, [], {"branch": name, "site": site, "ok": True, "moved": at, "rows": 0, "requests": f.count, "fails": f.fails}
    evs, rows = events(r.text), []
    for idx, ev, info in evs:
        d = f.get(site + DETAIL, method="POST", data={"idx": idx})
        if d is not None and d.status_code == 200:
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
    r, _ = Reader(retries=3).read(SEED)
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
