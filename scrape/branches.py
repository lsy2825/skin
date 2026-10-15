"""Branch addresses + map coordinates for every brand -> data2/branches.csv

usage: python scrape/branches.py            (run after the price scrapers: it reads their logs for the branch sites)
Address sources: 블리비 = one table (community02.php, table#address); 톡스앤필 = <site>/map.php;
쁨 = each branch site's front page; 리엔장 = each branch site's front page; 포에버 = <code>.4-ever.co.kr/ko. The first road address
(시도 시군구 [구] ...로|길 번호) on the page is used.
Coordinates: OpenStreetMap Nominatim (1 request/second, results cached in data2/geocache.json so each address is
looked up once). Lookup tries the road address, then without the building number, then 시군구 only (marked approx).
"""
import csv, json, os, re, sys, time
from bs4 import BeautifulSoup
from common import Fetcher, ROOT, UA, clean, now_iso
import requests

OUT = os.path.join(ROOT, "data2", "branches.csv")
CACHE = os.path.join(ROOT, "data2", "geocache.json")
SIDO = r"(?:서울|경기|인천|부산|대구|대전|광주|울산|세종|충청남|충청북|충남|충북|전라남|전라북|전남|전북|전북특별자치|경상남|경상북|경남|경북|강원|강원특별자치|제주|제주특별자치)[가-힣]*"
ADDR = re.compile(SIDO + r"\s+[가-힣]+[시군구](?:\s+[가-힣]+[구군])?\s+[가-힣0-9]+(?:로|길)(?:\s*\d+(?:번)?길)?\s*\d+(?:-\d+)?")
# lot-number address (세종특별자치시 나성동 745) when the page has no road address
ADDR_LOT = re.compile(SIDO + r"\s+(?:[가-힣]+[시군구]\s+)?(?:[가-힣]+[구군]\s+)?[가-힣0-9]+[동리가]\s*\d+(?:-\d+)?")
# text that follows an address on some pages and is not part of it
JUNK = re.compile(r"\s*(네이버|카카오|지도|약도|전화|TEL|Tel|☎|오시는|주차|대표|사업자|\d{2,4}-\d{3,4}-\d{4}|0\d{2}).*$")


# last resort (2026-10-15): an address with no 시군구 (세종특별자치시 나성북로 15) or with 읍·면 before the road (경남 양산시 물금읍
# 범어로 96) — tried only when the two patterns above find nothing on the page
ADDR_LOOSE = re.compile(SIDO + r"\s+(?:[가-힣]+[시군구]\s+)?(?:[가-힣]+[구군]\s+)?(?:[가-힣]+[읍면]\s+)?[가-힣0-9]+(?:로|길)(?:\s*\d+(?:번)?길)?\s*\d+(?:-\d+)?")


def first_addr(text):
    m = ADDR.search(text) or ADDR_LOT.search(text) or ADDR_LOOSE.search(text)
    return clean(m.group(0)) if m else ""


def addr_candidates(text):
    """every address on the page in page order (road and lot-number forms; the loose form only when those find none)"""
    found = sorted([(m.start(), m.group(0)) for rx in (ADDR, ADDR_LOT) for m in rx.finditer(text)])
    if not found:
        found = [(m.start(), m.group(0)) for m in ADDR_LOOSE.finditer(text)]
    return list(dict.fromkeys(clean(x) for _, x in found))


def velyb(f):
    r = f.get("https://www.velyb.kr/community/community02.php")
    out = []
    if r is None:                      # robots.txt says no, or the page did not load: stop here, the old branches.csv stays as it is
        raise SystemExit(f"블리비 주소 페이지를 읽지 못함 ({f.last_error}) — data2/branches.csv는 그대로 둠")
    for tr in BeautifulSoup(r.text, "html.parser").select("table#address tr")[1:]:
        c = [clean(x.get_text(" ")) for x in tr.find_all(["td", "th"])]
        if len(c) >= 2:
            out.append(("블리비", c[0].replace("블리비의원", "").strip(), first_addr(c[1]) or c[1].split(",")[0], c[1]))
    return out


def from_log(brand, key):
    p = os.path.join(ROOT, "data2", "raw", f"{key}.log.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


def _full(a, t):
    return JUNK.sub("", t[t.index(a):][:len(a) + 40]).rstrip(" ,·|/") if a and a in t else a


def page_addr(f, url):
    r = f.get(url)
    if not r:
        return "", ""
    text = BeautifulSoup(r.text, "html.parser").get_text(" ")
    a = first_addr(text)
    return a, _full(a, clean(text))


def page_addrs(f, url):
    """[(address, full text)] for every address on the page, in page order (pick_own chooses the branch's own)"""
    r = f.get(url)
    if not r:
        return []
    text = BeautifulSoup(r.text, "html.parser").get_text(" ")
    t = clean(text)
    return [(a, _full(a, t)) for a in addr_candidates(text)]


def pick_own(rows):
    """rows with 'cands' (page_addrs): the first address on the page that no other branch of the brand shows — the
    branch's own, not the company footer (2026-10-15: 유앤아이 수원·광교 pages show 선릉로 614-1 first, their own lot-number
    address after it). No such address → empty (listed without a region rather than in the wrong one)."""
    from collections import Counter
    seen = Counter((r["brand"], a) for r in rows for a in {a for a, _ in r.get("cands") or []})
    for r in rows:
        if r.get("cands") is None:
            continue
        own = next(((a, full) for a, full in r["cands"] if seen[(r["brand"], a)] == 1), ("", ""))
        r["address"], r["address_full"] = own
    return rows


def others(f):
    out = []
    import toxnfill
    for name, site in toxnfill.branch_sites(f).items():
        a, full = page_addr(f, f"{site}/map.php")
        out.append(("톡스앤필", name, a, full))
    for s in from_log("쁨", "ppeum").get("sites", []):
        if s.get("ok"):
            url = f"https://{s['sub']}.ppeum.com/" if s.get("sub") else s["url"]
            a, full = page_addr(f, url)
            out.append(("쁨", s["name"], a, full))
    for p in from_log("리엔장", "lienjang").get("pages", []):
        if p.get("ok"):
            a, full = page_addr(f, f"https://{p['host']}/")
            out.append(("리엔장", p["branch"], a, full))
    for s in from_log("포에버", "forever").get("sites", []):
        if s.get("ok"):
            a, full = page_addr(f, f"https://{s['code']}.4-ever.co.kr/ko")
            out.append(("포에버", s["branch"], a, full))
    # brands added 2026-10-14 (probe: scrape/probe.py): the page each collector already reads carries the branch address
    for brand, key, path in (("밴스", "vands", ""), ("유앤아이", "uandi", "/direction/"),
                             ("데이뷰", "daybeau", "/branch/event.php"), ("닥터에버스", "drevers", "/event/"),
                             ("셀린", "cellin", "/clinicPriceSide/clinicSideList.php")):   # 셀린: the branch address is in the page footer
        for p in from_log(brand, key).get("pages", []):
            if p.get("rows") and p.get("site"):
                out.append((brand, p["branch"], vands_addrs(f, p["site"]) if key == "vands" else page_addrs(f, p["site"] + path)))
    return out


def vands_addrs(f, site):
    """밴스: '오시는길/진료시간' (/web/sub/location) first — 세종·양산 have their address only there (2026-10-15 probe) —
    then the price page the collector reads, where the other branches' addresses were found"""
    return page_addrs(f, site + "/web/sub/location") or page_addrs(f, site + "/web/product")


def drop_shared(rows):
    """One address on several branches of the same brand is a head-office or footer address, not theirs (seen 2026-10-14:
    four 유앤아이 branches whose pages show only the company address). Those rows lose the address and point, so the
    branch is listed without a region instead of in the wrong one."""
    from collections import Counter
    n = Counter((r["brand"], r["address"]) for r in rows if r["address"])
    for r in rows:
        if r["address"] and n[(r["brand"], r["address"])] > 1:
            r.update(address="", address_full="", lat="", lng="", geo_level="none")
    return rows


def geocode(addr, cache, s):
    if addr in cache:
        return cache[addr]
    tries = [(addr, "road"), (re.sub(r"\s*\d+(-\d+)?$", "", addr), "street"),
             (" ".join(addr.split()[:3 if re.search(r"[구군]$", addr.split()[2] if len(addr.split()) > 2 else "") else 2]), "district")]
    res = None
    for q, level in tries:
        time.sleep(1.1)
        try:
            r = s.get("https://nominatim.openstreetmap.org/search", params={"q": q, "format": "json", "limit": 1, "countrycodes": "kr"}, timeout=20)
            js = r.json() if r.status_code == 200 else []
        except Exception:
            js = []
        if js:
            res = {"lat": round(float(js[0]["lat"]), 6), "lng": round(float(js[0]["lon"]), 6), "level": level, "q": q}
            break
    cache[addr] = res
    return res


def main():
    f = Fetcher(gap=0.7, robots=True)      # 2026-10-15: these pages used to be read without looking at robots.txt
    rows = velyb(f) + others(f)
    for x in f.fails:                  # pages skipped this run (robots.txt, errors): the reason, so the log says why an address is old
        print("  not read:", x["url"], "—", x["error"])
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    s = requests.Session()
    s.headers["User-Agent"] = UA  # same self-identifying name as the price collector (round-2 DATA02)
    # (brand, branch, address, full) or (brand, branch, [candidates]) → the branch's own address first, then its point
    base = [{"brand": x[0], "branch": x[1], "address": x[2], "address_full": x[3]} if len(x) == 4 else {"brand": x[0], "branch": x[1], "cands": x[2]} for x in rows]
    out = []
    for r in pick_own(base):
        g = geocode(r["address"], cache, s) if r["address"] else None
        out.append({"brand": r["brand"], "branch": r["branch"], "address": r["address"], "address_full": r["address_full"],
                    "lat": g["lat"] if g else "", "lng": g["lng"] if g else "", "geo_level": g["level"] if g else "none"})
        json.dump(cache, open(CACHE, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=0)
    # a page that could not be read this time (robots.txt unreadable, a server error) must not wipe a branch's known address
    # and point: the last file's values stay until a page answers again
    last = {}
    if os.path.exists(OUT):
        last = {(r["brand"], r["branch"]): r for r in csv.DictReader(open(OUT, encoding="utf-8"))}
    for r in out:
        o = last.get((r["brand"], r["branch"]))
        if not r["address"] and o and o.get("address"):
            r.update({k: o.get(k, "") for k in ("address", "address_full", "lat", "lng", "geo_level")})
            print("  kept last address:", r["brand"], r["branch"])
    out = drop_shared(out)
    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    from collections import Counter
    print(f"wrote {OUT}: {len(out)} branches |", dict(Counter(r["geo_level"] for r in out)))
    for r in out:
        if r["geo_level"] != "road":
            print("  check:", r["brand"], r["branch"], r["address"] or "(no address found)", r["geo_level"])


if __name__ == "__main__":
    main()
