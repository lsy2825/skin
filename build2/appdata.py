"""data2/clean.csv + data2/branches.csv -> app/data.json (what the app loads) + a weekly snapshot for price changes.

usage: python build2/appdata.py [--date YYYY-MM-DD]
data.json (compact, strings interned in `s`):
  meta      updated date, row counts, brand list [name, color, note], kinds, cats, tags
  branches  [brand, name s, address s, lat, lng, region s, site s]
  rows      [branch, cat, name s, sale, orig, kind, tags s, keys s, sess]  (keys = comparison ids, space separated;
            sess = sessions in the price, 1 = single, 99 = 이용권/무제한)
  meta.fam  procedure families for the option picker: [name, regex for related rows at a branch, [[key id, variant label]...]]
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
# keys grouped into one procedure with selectable variants (cart / compare option picker). The regex finds a branch's
# related rows (packages, other doses) when the user switches the option for one branch.
FAM = [("국산 보톡스", r"톡신|보톡스|보툴|스킨보톡|다한증", [("X01", "사각턱 50U"), ("X02", "주름 1부위"), ("X03", "얼굴전체 스킨보톡스"), ("X06", "바디 100U"), ("X07", "겨드랑이 다한증 50U")]),
       ("독일산(제오민) 보톡스", r"제오민|독일", [("X04", "사각턱 50U"), ("X05", "주름 1부위")]),
       ("윤곽주사", r"윤곽", [("X08", "1회 (3cc)")]),
       ("필러", r"필러|벨로테로|쥬비덤|레스틸렌", [("X09", "국산 1cc"), ("X10", "수입 1cc")]),
       ("슈링크 유니버스", r"슈링크", [("X11", "100샷"), ("X12", "300샷")]),
       ("울쎄라", r"울쎄라", [("X13", "100샷"), ("X14", "300샷")]),
       ("써마지 FLX", r"써마지", [("X15", "300샷"), ("X16", "600샷")]),
       ("인모드", r"인모드", [("X19", "1부위"), ("X17", "얼굴전체 1가지 모드"), ("X18", "얼굴전체 2가지 모드"), ("X36", "바디 1부위")]),
       ("온다 리프팅", r"온다", [("X20", "얼굴 10KJ")]),
       ("올리지오", r"올리지오", [("X21", "100샷")]),
       ("볼뉴머", r"볼뉴머", [("X22", "100샷")]),
       ("티타늄 리프팅", r"티타늄", [("X23", "40KJ")]),
       ("리쥬란", r"리쥬란", [("X24", "힐러 2cc"), ("X25", "HB 플러스 1cc")]),
       ("쥬베룩", r"쥬베룩", [("X26", "스킨 1cc"), ("X27", "볼륨 1cc")]),
       ("피코토닝", r"피코", [("X28", "1회")]), ("레이저토닝", r"토닝", [("X29", "1회")]), ("제네시스", r"제네시스", [("X30", "1회")]),
       ("아쿠아필", r"아쿠아필", [("X31", "1회")]), ("포텐자", r"포텐자", [("X32", "1회")]),
       ("점 빼기", r"점\s*빼|점제거|^점|\s점", [("X33", "1개 (2mm 이하)")]), ("염증주사", r"염증", [("X34", "1개")]),
       ("겨드랑이 제모", r"제모", [("X35", "(여) 1회")])]
CATS = ["보톡스·필러", "리프팅", "스킨부스터", "피부·레이저", "제모", "바디", "기타"]
SIDO = [("전남광주", "광주"), ("서울", "서울"), ("경기", "경기"), ("인천", "인천"), ("부산", "부산"), ("대구", "대구"), ("대전", "대전"), ("광주", "광주"),
        ("울산", "울산"), ("세종", "세종"), ("강원", "강원"), ("충청북|충북", "충북"), ("충청남|충남", "충남"), ("전라북|전북", "전북"),
        ("전라남|전남", "전남"), ("경상북|경북", "경북"), ("경상남|경남", "경남"), ("제주", "제주")]


def trend(hist, date, rows):
    """weekly price trend per comparison key from the snapshots in data2/history (regular prices only):
    {"dates": [...], "k": {key: [[median, min, branches] or None per date]}, "disc": {key: median % off the list price now}}"""
    files = sorted(p for p in glob.glob(os.path.join(hist, "*.json")) if os.path.basename(p)[:10] <= date)[-52:]
    dates, per = [], {}
    for i, p in enumerate(files):
        dates.append(os.path.basename(p)[:10])
        by = {}
        for kk, v in json.load(open(p, encoding="utf-8")).items():
            by.setdefault(kk.split("|")[0], []).append(v)
        for k, vs in by.items():
            vs.sort()
            per.setdefault(k, [None] * len(files))[i] = [vs[len(vs) // 2], vs[0], len(vs)]
    for k in per:
        per[k] += [None] * (len(files) - len(per[k]))
    offs = {}
    for r in rows:
        if r["orig"] and int(r["orig"]) > int(r["sale"]) and r["kind"] != "구독권":
            for k in r["keys"].split():
                offs.setdefault(k, []).append(round((int(r["orig"]) - int(r["sale"])) / int(r["orig"]) * 100))
    disc = {k: sorted(v)[len(v) // 2] for k, v in offs.items() if len(v) >= 3}
    return {"dates": dates, "k": per, "disc": disc}


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
                         kind, S(r["tags"]), S(r["keys"]), int(r["sess"] or 1)])
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
                 "brands": [list(b) for b in BRANDS], "kinds": KINDS, "cats": CATS,
                 "fam": [[n, rx, [list(v) for v in vs]] for n, rx, vs in FAM]},
        "branches": branches, "rows": out_rows, "keys": [[k[0], k[1], k[2]] for k in X], "changes": changes, "s": s,
        "trend": trend(hist, a.date, rows),
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
