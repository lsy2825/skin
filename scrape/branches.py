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
from common import Fetcher, ROOT, clean, now_iso
import requests

OUT = os.path.join(ROOT, "data2", "branches.csv")
CACHE = os.path.join(ROOT, "data2", "geocache.json")
SIDO = r"(?:서울|경기|인천|부산|대구|대전|광주|울산|세종|충청남|충청북|충남|충북|전라남|전라북|전남|전북|전북특별자치|경상남|경상북|경남|경북|강원|강원특별자치|제주|제주특별자치)[가-힣]*"
ADDR = re.compile(SIDO + r"\s+[가-힣]+[시군구](?:\s+[가-힣]+[구군])?\s+[가-힣0-9]+(?:로|길)(?:\s*\d+(?:번)?길)?\s*\d+(?:-\d+)?")
# lot-number address (세종특별자치시 나성동 745) when the page has no road address
ADDR_LOT = re.compile(SIDO + r"\s+(?:[가-힣]+[시군구]\s+)?(?:[가-힣]+[구군]\s+)?[가-힣0-9]+[동리가]\s*\d+(?:-\d+)?")
# text that follows an address on some pages and is not part of it
JUNK = re.compile(r"\s*(네이버|카카오|지도|약도|전화|TEL|Tel|☎|오시는|주차|대표|사업자|\d{2,4}-\d{3,4}-\d{4}|0\d{2}).*$")


def first_addr(text):
    m = ADDR.search(text) or ADDR_LOT.search(text)
    return clean(m.group(0)) if m else ""


def velyb(f):
    r = f.get("https://www.velyb.kr/community/community02.php")
    out = []
    for tr in BeautifulSoup(r.text, "html.parser").select("table#address tr")[1:]:
        c = [clean(x.get_text(" ")) for x in tr.find_all(["td", "th"])]
        if len(c) >= 2:
            out.append(("블리비", c[0].replace("블리비의원", "").strip(), first_addr(c[1]) or c[1].split(",")[0], c[1]))
    return out


def from_log(brand, key):
    p = os.path.join(ROOT, "data2", "raw", f"{key}.log.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


def page_addr(f, url):
    r = f.get(url)
    if not r:
        return "", ""
    text = BeautifulSoup(r.text, "html.parser").get_text(" ")
    a = first_addr(text)
    full = a
    t = clean(text)
    if a and a in t:
        full = JUNK.sub("", t[t.index(a):][:len(a) + 40]).rstrip(" ,·|/")
    return a, full


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
    return out


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
    f = Fetcher(gap=0.7)
    rows = velyb(f) + others(f)
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    s = requests.Session()
    s.headers["User-Agent"] = "skin-clinic-price-compare/1.0 (personal, non-commercial; weekly)"
    out = []
    for brand, branch, addr, full in rows:
        g = geocode(addr, cache, s) if addr else None
        out.append({"brand": brand, "branch": branch, "address": addr, "address_full": full,
                    "lat": g["lat"] if g else "", "lng": g["lng"] if g else "", "geo_level": g["level"] if g else "none"})
        json.dump(cache, open(CACHE, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=0)
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
