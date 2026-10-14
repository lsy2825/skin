"""Addresses for branches whose collector page gave none (2026-10-15: 밴스 세종·양산, 유앤아이 수원·광교·목포·화성봉담 — no
address, so no region and no map pin; the 유앤아이 four showed only the company address, branches.drop_shared).

Runs on a GitHub runner (probe-brands.yml, task 'addr'): robots.txt first (YoonSiljangBot, probe.allowed), 1 request/s
per site, the branch home page plus up to 6 same-site pages whose link says where the clinic is (오시는 길, 병원 소개 …).
Every address candidate on every page is kept in index.json with the page it came from (lean HTML saved beside it), so
the choice can be checked by hand; the chosen one is the first candidate that is not shared with another branch of the
brand, looked up with OpenStreetMap Nominatim (branches.geocode, 1 request/s). Nothing here is written into
data2/branches.csv — that is a separate, reviewed step.
  python scrape/addr_probe.py            (PROBE_OUT = output folder)
"""
import json, os, re, sys
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup
import branches
import probe
from common import UA

SITES = [("밴스", "세종", "https://sejong.vandsclinics.com/"), ("밴스", "양산", "https://yangsan.vandsclinics.com/"),
         ("유앤아이", "수원점", "https://www.swuni114.co.kr/"), ("유앤아이", "광교점", "https://www.gguni114.co.kr/"),
         ("유앤아이", "목포점", "https://www.mpuni114.co.kr/"), ("유앤아이", "화성봉담점", "https://www.bduni114.co.kr/")]
# addresses the collector already saw on several branches of the brand (company / footer addresses), never a branch's own
SHARED = {"유앤아이": ["선릉로 614-1"]}
WHERE = re.compile(r"오시는|찾아오|위치|location|map|direction|contact|병원\s*소개|병원\s*안내|소개|intro|about|info", re.I)
OUT = os.environ.get("PROBE_OUT", "probe_out")
MAX_LINKS = 6


def candidates(html):
    text = re.sub(r"\s+", " ", BeautifulSoup(html, "html.parser").get_text(" "))
    found = [m.group(0) for rx in (branches.ADDR, branches.ADDR_LOT) for m in rx.finditer(text)]
    return list(dict.fromkeys(branches.clean(x) for x in found))


def site(brand, name, home):
    folder = os.path.join(OUT, "addr", urlparse(home).netloc)
    os.makedirs(folder, exist_ok=True)
    queue, seen, pages = [home], set(), []
    while queue and len(pages) < MAX_LINKS + 1:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        ok, why = probe.allowed(url)
        rec = {"url": url, "robots": why}
        if not ok:
            pages.append(dict(rec, skipped=True))
            continue
        r, err = probe.get(url)
        if r is None:
            pages.append(dict(rec, error=err))
            continue
        rec.update(status=r.status_code, final_url=r.url)
        if r.status_code == 200 and "html" in r.headers.get("content-type", ""):
            fn = f"{len(pages):02d}.html"
            open(os.path.join(folder, fn), "w", encoding="utf-8").write(probe.lean(r.text))
            rec.update(file=fn, candidates=candidates(r.text))
            if url == home:
                soup = BeautifulSoup(r.text, "html.parser")
                for a in soup.find_all("a", href=True):
                    u = urljoin(r.url, a["href"]).split("#")[0]
                    if urlparse(u).netloc == urlparse(r.url).netloc and WHERE.search(u + " " + (a.get_text() or "")) and u not in seen and u not in queue:
                        queue.append(u)
        pages.append(rec)
    shared = SHARED.get(brand, [])
    chosen = next((c for p in pages for c in p.get("candidates", []) if not any(s in c for s in shared)), "")
    return {"brand": brand, "branch": name, "home": home, "pages": pages, "chosen": chosen}


def main():
    cache = json.load(open(branches.CACHE, encoding="utf-8")) if os.path.exists(branches.CACHE) else {}
    s = requests.Session()
    s.headers["User-Agent"] = UA
    out = []
    for brand, name, home in SITES:
        rec = site(brand, name, home)
        g = branches.geocode(rec["chosen"], cache, s) if rec["chosen"] else None
        rec["geo"] = g
        out.append(rec)
        print(brand, name, "|", rec["chosen"] or "(주소 못 찾음)", "|", g)
    os.makedirs(OUT, exist_ok=True)
    json.dump({"ua": UA, "sites": out}, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.exit(main())
