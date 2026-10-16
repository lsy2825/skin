"""유앤아이의원 ({code}uni114.co.kr — one site per branch, same template), read from each branch's home page.

usage: python scrape/uandi.py [--branches 강남점,잠실점] [--workers 6] [--gap 1.0]
Branch list = a[data-domain] in the branch picker (data-domain = that branch's site, text = branch name). Per branch one
page: the home page holds every price in div.event_area — tab buttons (전체보기, 이달의 이벤트, 첫방문 이벤트, 보톡스·윤곽 …)
and one div.swiper per tab; the first swiper ('전체보기', id mainTab) repeats the others and is skipped. A tab button carries
data-cate="<n>" and its products sit in the swiper with id="tab<n>". The swipers are NOT in the buttons' order (강남점 2026-10-14:
buttons 197 이달의 이벤트 · 865 첫방문 이벤트 · … · 740 남성제모, swipers tab1096 쥬베룩 · tab1095 포텐자 · tab197 · …): pairing by
position gave 21 of 강남점's 22 tabs another tab's name — 남성 제모 under '쥬베룩', this month's events under '첫방문 이벤트'
(fixed 2026-10-16). A swiper whose button is not found gets no tab ('') — each branch's line in the run log shows how many
rows (no_tab), and a branch with more than half its rows without a tab is a run warning (tab_warning). A few are normal:
평택점 2026-10-16 had one swiper (tab658) without a button, 4 of 450 rows.
li.price_box: .prd_text (group), .prd_info (option), .origin .num (list price), .discount .num (price). A box without a
price ('지점문의') is not a price and is skipped.
The site says 'VAT 별도' next to the prices (probe 2026-10-14) -> data2/vat_policy.json.
robots.txt (2026-10-14): Allow /, Disallow /attach/ /common/ /images/ /pc/ /admin/ — the home page is allowed.
Earlier note (NOTES.md): '가격이 그림이라 보류' — the 2026-10-14 probe found the prices as text on every branch page.
"""
import argparse, os, re
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
from common import Fetcher, clean, now_iso, won, write_raw

MAIN = "https://www.uni114.co.kr/"


def branch_sites(html):
    out = {}
    for a in BeautifulSoup(html, "html.parser").select("a[data-domain]"):
        name, dom = clean(a.get_text(" ")), (a.get("data-domain") or "").strip()
        if name and re.fullmatch(r"(www\.)?[a-z0-9]*uni114\.co\.kr", dom):
            out.setdefault(name, f"https://{dom}")
    return out


def tab_names(area):
    """swiper id ('tab<n>') → the name on the tab button with data-cate="<n>" """
    names = {}
    for b in area.select("button[data-cate]"):
        c, t = (b.get("data-cate") or "").strip(), clean(b.get_text(" "))
        if c and t and t != "더보기":
            names.setdefault(f"tab{c}", t)
    return names


def items(html, branch, url, ts):
    soup = BeautifulSoup(html, "html.parser")
    area = soup.select_one("div.event_area")
    if not area:
        return []
    swipers = area.select("div.prd_list > div.swiper")
    names = tab_names(area)
    # 'LIMITED EVENT … 이벤트 기간 : 2026.10.01 ~ 2026.10.31 ※ VAT 별도' above the price area: the end date of every price shown
    m = re.search(r"이벤트\s*기간\s*:?\s*\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\s*~\s*(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})", soup.get_text(" "))
    until = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else ""
    rows, seen = [], set()
    for sw in swipers:
        if sw.get("id") == "mainTab":
            continue
        tab = names.get((sw.get("id") or "").strip(), "")
        for box in sw.select("li.price_box"):
            g, o = box.select_one(".prd_text"), box.select_one(".prd_info")
            sale, orig = box.select_one(".discount .num"), box.select_one(".origin .num")
            if not o or not sale or not won(sale.get_text()):
                continue
            group = clean(g.get_text(" ")) if g else tab
            if re.search(r"첫\s*방문", tab) and not re.search(r"첫\s*방문", group):
                group = f"{tab} · {group}"
            r = {"brand": "유앤아이", "branch": branch, "category": tab, "group": group, "option": clean(o.get_text(" ")),
                 "sale": won(sale.get_text()), "orig": won(orig.get_text()) if orig else "", "addon": 0, "until": until,
                 "url": url, "fetched_at": ts}
            k = (r["group"], r["option"], r["sale"])
            if k not in seen:
                seen.add(k)
                rows.append(r)
    return rows


def scrape_branch(name, site, gap):
    f, ts = Fetcher(gap=gap), now_iso()
    r = f.get(site + "/")
    rows = items(r.text, name, site + "/", ts) if r else []
    return name, rows, {"branch": name, "site": site, "ok": bool(r) and not f.fails, "rows": len(rows),
                        "no_tab": sum(1 for x in rows if not x["category"]), "requests": f.count, "fails": f.fails}


def tab_warning(logs):
    """the branches where most rows got no tab: their page no longer pairs button data-cate="<n>" with swiper id="tab<n>".
    The weekly guard counts rows, branches and prices only, so this is the one place that shows it ('' = nothing to say)"""
    lost = [f"{l['branch']} {l['no_tab']}/{l['rows']}" for l in logs if l.get("rows") and 2 * l.get("no_tab", 0) > l["rows"]]
    return (f"{len(lost)} branches lost their tab names (button data-cate <-> swiper id 'tab<n>' not found - page changed?): "
            + ", ".join(lost)) if lost else ""


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
            print(f"{name}: {len(got)} rows, no_tab {log['no_tab']}, fails {len(log.get('fails', []))}", flush=True)
    bad = [l for l in logs if not l["ok"]]
    warn = tab_warning(logs)
    if warn:   # an annotation in the weekly run's summary (GitHub), a plain line elsewhere
        print(("::warning title=uandi tabs::" if os.environ.get("GITHUB_ACTIONS") else "WARNING: ") + warn, flush=True)
    path = write_raw("uandi", rows, {"brand": "유앤아이", "branches": len(sites), "pages": logs, "bad": bad, "finished": now_iso()})
    print(f"wrote {path}: {len(rows)} rows, {len(sites)} branches, {len(bad)} with failures")


if __name__ == "__main__":
    main()
