"""Address + map coordinates for one collector's branches -> CSV rows in data2/branches.csv's format.

The weekly run builds data2/branches.csv for every brand with scrape/branches.py. This does the same for one collector
run alone (a probe/** job on a GitHub runner, .github/workflows/probe-brands.yml): it reads data2/raw/<key>.log.json for
the branch sites, takes the address from the page the collector already read (branches.page_addr) and looks it up with
OpenStreetMap Nominatim (branches.geocode, 1 request/s, data2/geocache.json first).
  python scrape/branch_rows.py <key> <out.csv>
"""
import csv, json, os, sys
import requests
import branches
from common import Fetcher, UA

PAGES = {"vands": ("밴스", ""), "uandi": ("유앤아이", "/direction/"),
         "daybeau": ("데이뷰", "/branch/event.php"), "drevers": ("닥터에버스", "/event/"),
         "cellin": ("셀린", "/clinicPriceSide/clinicSideList.php")}


def main(key, out):
    brand, path = PAGES[key]
    f = Fetcher(gap=1.0)
    cache = json.load(open(branches.CACHE, encoding="utf-8")) if os.path.exists(branches.CACHE) else {}
    s = requests.Session()
    s.headers["User-Agent"] = UA
    rows = [{"brand": brand, "branch": p["branch"], "cands": branches.vands_addrs(f, p["site"]) if key == "vands" else branches.page_addrs(f, p["site"] + path)}
            for p in branches.from_log(brand, key).get("pages", []) if p.get("rows") and p.get("site")]
    for r in branches.pick_own(rows):
        g = branches.geocode(r["address"], cache, s) if r["address"] else None
        r.update(lat=g["lat"] if g else "", lng=g["lng"] if g else "", geo_level=g["level"] if g else "none")
        r.pop("cands", None)
    rows = branches.drop_shared(rows)
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["brand", "branch", "address", "address_full", "lat", "lng", "geo_level"])
        w.writeheader()
        w.writerows(rows)
    print(f"{key}: {len(rows)} branches, {sum(1 for r in rows if r['geo_level'] == 'road')} with a road-level point")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
