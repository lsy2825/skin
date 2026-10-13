"""data2/clean.csv + data2/branches.csv -> app/data.json (what the app loads) + a weekly snapshot for price changes.

usage: python build2/appdata.py [--date YYYY-MM-DD]
data.json (compact, strings interned in `s`):
  meta      updated date, row counts, brand list [name, color, note], kinds, cats, tags
  branches  [brand, name s, address s, lat, lng, region s, site s]
  rows      [branch, cat, name s, sale, orig, kind, tags s, keys s]  (keys = comparison ids, space separated)
  keys      [id, cat, label]
  changes   [key, branch, before, after] for comparison prices that moved since the previous snapshot
Snapshots: data2/history/<date>.json = {"<key>|<branch index name>": lowest regular price}; the newest older one is
the 'before'.
"""
import argparse, csv, datetime, glob, json, os, re, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
from xkeys import X  # noqa: E402

BRANDS = [("블리비", "#6a5ae0", "지점별 이벤트 페이지(기획전·카테고리 7쪽)의 모든 가격"),
          ("쁨", "#e8437f", "지점별 온라인 예약 페이지의 모든 상품"),
          ("톡스앤필", "#0fa3a3", "지점별 '시술안내/가격'의 시술 상세 옵션. 옵션이 없는 시술은 '최저가부터' 가격"),
          ("리엔장", "#e0902a", "지점별 비급여 진료비 고시표(정가). 이벤트가가 아니며 표의 최종변경일이 오래됐을 수 있어요"),
          ("포에버", "#3a7bd5", "지점별 '시술 안내'의 시술 상세 옵션(할인가, 없으면 정가). 부가세(VAT) 별도 가격")]
KINDS = ["일반", "체험가", "한정가", "구독권", "고시가"]
CATS = ["보톡스·필러", "리프팅", "스킨부스터", "피부·레이저", "제모", "바디", "기타"]
SIDO = [("전남광주", "광주"), ("서울", "서울"), ("경기", "경기"), ("인천", "인천"), ("부산", "부산"), ("대구", "대구"), ("대전", "대전"), ("광주", "광주"),
        ("울산", "울산"), ("세종", "세종"), ("강원", "강원"), ("충청북|충북", "충북"), ("충청남|충남", "충남"), ("전라북|전북", "전북"),
        ("전라남|전남", "전남"), ("경상북|경북", "경북"), ("경상남|경남", "경남"), ("제주", "제주")]


def region(addr):
    for p, name in SIDO:
        if re.match(p, addr or ""):
            return name
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--out", default=os.path.join(ROOT, "app", "data.json"))
    a = ap.parse_args()
    rows = list(csv.DictReader(open(os.path.join(ROOT, "data2", "clean.csv"), encoding="utf-8")))
    geo = {(r["brand"], r["branch"]): r for r in csv.DictReader(open(os.path.join(ROOT, "data2", "branches.csv"), encoding="utf-8"))}
    s, si = [], {}

    def S(x):
        x = x or ""
        if x not in si:
            si[x] = len(s)
            s.append(x)
        return si[x]

    bnames = [b for b, _, _ in BRANDS]
    branches, bi = [], {}
    for r in rows:
        k = (r["brand"], r["branch"])
        if k not in bi:
            g = geo.get(k, {})
            site = re.match(r"https?://[^/]+", r["url"]).group(0)
            bi[k] = len(branches)
            branches.append([bnames.index(r["brand"]), S(r["branch"]), S(g.get("address_full") or g.get("address", "")),
                             float(g["lat"]) if g.get("lat") else None, float(g["lng"]) if g.get("lng") else None,
                             S(region(g.get("address", ""))), S(site)])
    out_rows = []
    best = {}
    for r in rows:
        b = bi[(r["brand"], r["branch"])]
        kind = KINDS.index(r["kind"])
        out_rows.append([b, CATS.index(r["cat"]), S(r["name"]), int(r["sale"]), int(r["orig"]) if r["orig"] else 0,
                         kind, S(r["tags"]), S(r["keys"])])
        if r["kind"] in ("일반", "고시가") and not r["tags"]:
            for k in r["keys"].split():
                kk = f"{k}|{r['brand']}|{r['branch']}"
                best[kk] = min(best.get(kk, 10 ** 12), int(r["sale"]))
    # weekly snapshot + changes against the previous one
    hist = os.path.join(ROOT, "data2", "history")
    os.makedirs(hist, exist_ok=True)
    prev_files = sorted(p for p in glob.glob(os.path.join(hist, "*.json")) if os.path.basename(p)[:10] < a.date)
    json.dump(best, open(os.path.join(hist, f"{a.date}.json"), "w", encoding="utf-8", newline="\n"), ensure_ascii=False)
    changes, prev_date = [], ""
    if prev_files:
        prev_date = os.path.basename(prev_files[-1])[:10]
        prev = json.load(open(prev_files[-1], encoding="utf-8"))
        kid = {k[0]: i for i, k in enumerate(X)}
        for kk, after in best.items():
            before = prev.get(kk)
            if before and before != after:
                k, brand, branch = kk.split("|")
                changes.append([kid[k], bi[(brand, branch)], before, after])
    data = {
        "meta": {"updated": a.date, "prev": prev_date, "rows": len(out_rows), "branches": len(branches),
                 "brands": [list(b) for b in BRANDS], "kinds": KINDS, "cats": CATS},
        "branches": branches, "rows": out_rows, "keys": [[k[0], k[1], k[2]] for k in X], "changes": changes, "s": s,
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    txt = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    open(a.out, "w", encoding="utf-8", newline="\n").write(txt)
    nogeo = [s[b[1]] for b in branches if b[3] is None]
    print(f"wrote {a.out}: {len(txt) / 1e6:.2f} MB | rows {len(out_rows)} | branches {len(branches)} (no map position: {len(nogeo)})"
          f" | strings {len(s)} | changes vs {prev_date or '-'}: {len(changes)}")
    if nogeo:
        print("  no position:", nogeo)


if __name__ == "__main__":
    main()
