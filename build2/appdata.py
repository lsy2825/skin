"""data2/clean.csv + data2/branches.csv -> app/data.json (what the app loads) + a weekly snapshot for price changes.

usage: python build2/appdata.py [--date YYYY-MM-DD]
data.json (compact, strings interned in `s`):
  meta      updated = newest collection date (shown as '수집'), built = build date, row counts, brand list [name, color, note], kinds, cats, tags
  cols      the price rows, stored one list per field (cols[f][row]); like values sit together, so gzip makes the file about
            a quarter smaller than row arrays. Fields in colDelta are stored as differences from the row before (the app and
            the tools add them back up). A row = [branch, cat, name s, sale, orig, kind, tags s, keys s, sess, group, until s,
            url s, vat, review, parts s]
            keys = comparison ids, space separated; sess = sessions in the price, 1 = single, 99 = 이용권/무제한;
            group = auto group index or -1; until = event end YYYY-MM-DD ('' none, 'posted:…' = 고시표 date);
            url = source page; vat 0 unknown / 1 포함 / 2 별도; review 1 = price moved ≥90% (or ×10) since last week
            and nobody approved it yet (data2/review.csv, approvals in data2/review_ok.csv) — the app keeps it out of
            comparisons
            parts = for names with '+': comparison keys matched by each part, 'X12,X24;;X01' (package mode C)
  branches  [brand, name s, address s, lat, lng, region s, site s, verified date s, status s]  (status VERIFIED = read
            this run, STALE = previous data kept because this run's scrape failed or was blocked)
  groups    [label s, cat, branches, median regular price, min, max] (build2/groups.py)
  bstat     per branch [regular level, level incl. specials, groups used, cheapest count, sole cheapest, {cat: level}]
            (level = geometric mean of price / median, 0.81 = 19% cheaper than the middle branch)
  achg      auto-group changes since the previous snapshot {prev, chg [g, b, before, after], new [g, b, p], gone [label s, b, before]}
  meta.fam  procedure families (build2/taxonomy.py) for the compare picker and option switch: [name, regex for related rows
            at a branch (tested on the name without spaces), [[key id, variant label]...], compare category, base family id,
            [the clinics' own short explanations from the names]]
  meta.kb   Treatment Knowledge Base (knowledge/treatments.json via build2/knowledge.py): resolved entries with one-liner,
            purpose, areas, method, kinds, side effects, cautions, sources, review status; matched to families by name or base id
  keys      [id, cat, label] — hand-made X01..X36 (xkeys.py) first, then variant keys T… (taxonomy.py, data2/variants.json)
  changes   [key, branch, before, after] for comparison prices that moved since the previous snapshot
Snapshots: data2/history/<date>.json = {"<key>|<branch index name>": lowest regular price}; the newest older one is
the 'before'.
"""
import argparse, csv, datetime, glob, json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
from xkeys import X, match as xmatch  # noqa: E402
import groups as G  # noqa: E402
import knowledge  # noqa: E402
import datameta  # noqa: E402
import homedata  # noqa: E402

BRANDS = [("블리비", "#6a5ae0", "지점별 이벤트 페이지(기획전·카테고리 7쪽)의 모든 가격"),
          ("쁨", "#e8437f", "지점별 온라인 예약 페이지의 모든 상품"),
          ("톡스앤필", "#0fa3a3", "지점별 '시술안내/가격'의 시술 상세 옵션. 옵션이 없는 시술은 '최저가부터' 가격"),
          ("리엔장", "#e0902a", "지점별 비급여 진료비 고시표(정가). 이벤트가가 아니며 표의 최종변경일이 오래됐을 수 있어요"),
          ("포에버", "#3a7bd5", "지점별 '시술 안내'의 시술 상세 옵션(할인가, 없으면 정가). 부가세(VAT) 별도 가격"),
          # added 2026-10-14 — always appended (the app turns new brands on by their position: meta.brands index)
          ("밴스", "#2f9e44", "지점별 '시술소개' 카테고리의 이벤트·상시 가격. 부가세(VAT) 별도"),
          ("유앤아이", "#a0522d", "지점 홈의 이벤트 가격(탭별). 부가세(VAT) 별도"),
          ("데이뷰", "#1d3557", "지점별 이벤트 페이지의 가격. '카톡플친 적용가'처럼 조건이 붙은 가격은 이름에 표시. 부가세(VAT) 별도"),
          ("닥터에버스", "#c92a2a", "지점별 이벤트 페이지의 항목 가격. 카카오톡 친구 대상 이벤트는 이벤트 이름에 표시")]
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


def variant_keys():
    """hand-made keys (xkeys.X) + variant keys from build2/taxonomy.py (data2/variants.json, written by clean.py)"""
    vp = os.path.join(ROOT, "data2", "variants.json")
    v = json.load(open(vp, encoding="utf-8")) if os.path.exists(vp) else {"keys": [], "families": []}
    allk = [(k[0], k[1], k[2]) for k in X] + [(k["id"], k["cat"], k["label"]) for k in v["keys"]]
    lab = {k[0]: k[2] for k in allk}
    auto = {k["id"]: k for k in v["keys"]}
    num = lambda t: float(re.search(r"\d+(?:\.\d+)?", t).group(0)) if re.search(r"\d", t or "") else 0

    def sub(kid, fam):
        if kid in auto:
            return auto[kid]["sub"]
        # hand-made key label minus the family's words ('리쥬란힐러 2cc' in 리쥬란 → '힐러 2cc')
        fw = [w for w in re.split(r"[\s·]+", fam) if len(w) >= 2]
        out = []
        for w in lab[kid].split():
            for f in fw:
                if w == f:
                    w = ""
                    break
                if w.startswith(f):
                    w = w[len(f):]
                    break
            if w:
                out.append(w)
        return " ".join(out) or "기본"

    fams = []
    for f in sorted(v["families"], key=lambda f: (CATS_X.index(f["cat"]) if f["cat"] in CATS_X else 9, f["name"])):
        ks = sorted(f["keys"], key=lambda k: (re.sub(r"[\d.]+(U|cc|ml|샷|KJ|부위|개|줄|시린지|vial|분|mm)|\d+회", "", auto[k]["sub"]).strip(),
                                            num(auto[k].get("sub", "")), auto[k]["sig"].rsplit("|", 1)[-1].zfill(3)))
        fams.append([f["name"], f.get("rx", ""), [[k, sub(k, f["name"])] for k in sorted(f["curated"]) + ks], f["cat"], f.get("fam", ""), f.get("desc", [])])
    return allk, fams


CATS_X = ["톡신", "윤곽·필러", "리프팅", "부스터", "피부", "제모·바디"]


def save_snapshot(hist, date, best):
    """hand-made keys → <date>.json (small, readable diff); variant keys (T…) → <date>.keys.json.gz (gzip, mtime 0 so
    the same prices give the same bytes)"""
    x = {k: v for k, v in best.items() if not k.startswith("T")}
    t = {k: v for k, v in sorted(best.items()) if k.startswith("T")}
    json.dump(x, open(os.path.join(hist, f"{date}.json"), "w", encoding="utf-8", newline="\n"), ensure_ascii=False)
    import gzip, io
    raw = io.BytesIO()
    with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as f:
        f.write(json.dumps(t, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    open(os.path.join(hist, f"{date}.keys.json.gz"), "wb").write(raw.getvalue())


def load_snapshot(path):
    """<date>.json + its <date>.keys.json.gz companion (if any) as one dict"""
    import gzip
    d = json.load(open(path, encoding="utf-8"))
    gz = path[:-5] + ".keys.json.gz"
    if os.path.exists(gz):
        with gzip.open(gz, "rt", encoding="utf-8") as f:
            d.update(json.load(f))
    return d


def trend(hist, date, rows, since=None):
    """weekly price trend per comparison key from the snapshots in data2/history (regular prices only):
    {"dates": [...], "k": {key: [[median, min, branches] or None per date]}, "disc": {key: median % off the list price now}}"""
    files = sorted(p for p in glob.glob(os.path.join(hist, "*.json")) if os.path.basename(p)[:10] <= date)[-52:]
    dates, per = [], {}
    for i, p in enumerate(files):
        dates.append(os.path.basename(p)[:10])
        by = {}
        for kk, v in load_snapshot(p).items():
            by.setdefault(kk.split("|")[0], []).append(v)
        for k, vs in by.items():
            vs.sort()
            per.setdefault(k, [None] * len(files))[i] = [vs[len(vs) // 2], vs[0], len(vs)]
    for k in per:
        per[k] += [None] * (len(files) - len(per[k]))
    # since: {key: date} — the rows of the key were regrouped on that date; earlier weeks measured another mix of rows
    for k, d0 in (since or {}).items():
        if k in per:
            per[k] = [v if dates[i] >= d0 else None for i, v in enumerate(per[k])]
    offs = {}
    for r in rows:
        if r["orig"] and int(r["orig"]) > int(r["sale"]) and r["kind"] != "구독권":
            for k in r["keys"].split():
                offs.setdefault(k, []).append(round((int(r["orig"]) - int(r["sale"])) / int(r["orig"]) * 100))
    disc = {k: sorted(v)[len(v) // 2] for k, v in offs.items() if len(v) >= 3}
    return {"dates": dates, "k": per, "disc": disc}


def part_keys(name):
    """'슈링크 300샷 + 리쥬란 2cc' -> 'X12;X24': which comparison keys each '+' part is (same xkeys rules as whole rows)"""
    if "+" not in name:
        return ""
    parts = [re.sub(r"\[[^\]]*\]\s*", "", p).strip() for p in re.split(r"\s*\+\s*", name)]
    return ";".join(",".join(k[0] for k in X if p and xmatch(k, p)) for p in parts)


def about():
    """reference facts for the 안내 page: cleanup counts by reason, VAT evidence, robots.txt check per brand"""
    from collections import Counter
    ip = os.path.join(ROOT, "data2", "issues.csv")
    issues = Counter(f"{r['action']}: {r['reason'].split('(')[0] if r['reason'].startswith('이벤트 기간') else r['reason']}"
                     for r in csv.DictReader(open(ip, encoding="utf-8-sig"))) if os.path.exists(ip) else {}
    vp = os.path.join(ROOT, "data2", "vat_policy.json")
    vat = {b: v for b, v in json.load(open(vp, encoding="utf-8")).items() if not b.startswith("_")} if os.path.exists(vp) else {}
    sp = os.path.join(ROOT, "data2", "sources.json")
    src = {}
    if os.path.exists(sp):
        sj = json.load(open(sp, encoding="utf-8"))
        src = {"checked_at": sj.get("checked_at", ""), "brands": {v["brand"]: {"allowed": v.get("allowed"), "method": v.get("method", ""), "rate": v.get("rate", ""),
               "terms_reviewed": v.get("terms_reviewed"), "crawl_delay": max([h.get("crawl_delay") or 0 for h in v.get("hosts", [])] or [0])}
               for v in sj.get("brands", {}).values()}}
    rp = os.path.join(ROOT, "data2", "report.md")
    report = open(rp, encoding="utf-8").read() if os.path.exists(rp) else ""
    rv = os.path.join(ROOT, "data2", "review.csv")
    review = list(csv.DictReader(open(rv, encoding="utf-8-sig")))[:200] if os.path.exists(rv) else []
    return {"issues": dict(issues), "vat": vat, "sources": src, "report": report, "review": review}


def review_queue(rows, out_rows, bi, bkeys, gid, achg, changes, s, allk):
    """prices that moved ≥90% down or ×10 up since the previous snapshot are held back (row[13] = 1) until someone
    lists them in data2/review_ok.csv (brand,branch,name,price). Writes data2/review.csv. Returns pending count."""
    okp = os.path.join(ROOT, "data2", "review_ok.csv")
    ok = {(x["brand"], x["branch"], x["name"], int(x["price"])) for x in csv.DictReader(open(okp, encoding="utf-8-sig"))} if os.path.exists(okp) else set()
    big = lambda before, after: after <= before * 0.1 or after >= before * 10
    hits = {}
    for g, b, before, after in achg:
        if big(before, after):
            hits[("g", g, b, after)] = before
    for k, b, before, after in changes:
        if big(before, after):
            hits[("k", allk[k][0], b, after)] = before
    out = []
    for i, (r, row) in enumerate(zip(rows, out_rows)):
        b, sale = row[0], row[3]
        before = hits.get(("g", gid[i], b, sale))
        if before is None:
            before = next((hits[("k", k, b, sale)] for k in r["keys"].split() if ("k", k, b, sale) in hits), None)
        if before is None:
            continue
        approved = (r["brand"], r["branch"], r["name"], sale) in ok
        if not approved:
            row[13] = 1
        out.append({"status": "승인됨" if approved else "검토 대기", "brand": r["brand"], "branch": r["branch"], "name": r["name"],
                    "before": before, "price": sale, "change": f"{(sale / before - 1) * 100:+.0f}%", "url": r["url"]})
    with open(os.path.join(ROOT, "data2", "review.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["status", "brand", "branch", "name", "before", "price", "change", "url"])
        w.writeheader()
        w.writerows(out)
    return sum(1 for x in out if x["status"] == "검토 대기")


# words a clinic page puts after the address (a popup's buttons, a footer link) that the scraper read with it
ADDR_JUNK = re.compile(r"\s*(오늘\s*하루\s*(그만\s*)?(보기|열지)|팝업\s*닫기|제휴\s*문의|닫기\s*$).*$")


def clean_addr(a):
    """address as shown in the app: the scraped text minus page furniture (data2/branches.csv keeps the original)"""
    return ADDR_JUNK.sub("", a or "").strip()


def region(addr):
    for p, name in SIDO:
        if re.match(p, addr or ""):
            return name
    return ""


CHECK_CODES = {"FOUND": 1, "NAME_ONLY": 2, "NOT_FOUND": 3, "FETCH_ERROR": 4, "IN_BLOCK": 5}


def price_checks(rows, date):
    """source re-checks of low prices (scrape/verify_prices.py → data2/price_checks.csv) → [[row index, status code, date]].
    Matched on brand, branch, product name and listed price, so a price that changed after the check gets nothing.
    Checks older than 21 days are dropped. Codes: CHECK_CODES."""
    p = os.path.join(ROOT, "data2", "price_checks.csv")
    if not os.path.exists(p):
        return []
    got = {}
    for x in csv.DictReader(open(p, encoding="utf-8-sig")):
        d = (x.get("checked_at") or "")[:10]
        if x.get("status") not in CHECK_CODES or not re.match(r"\d{4}-\d{2}-\d{2}$", d):
            continue
        if (datetime.date.fromisoformat(date) - datetime.date.fromisoformat(d)).days > 21:
            continue
        got[(x["brand"], x["branch"], x["name"], int(x["listed_price"]))] = [CHECK_CODES[x["status"]], d]
    out = []
    for i, r in enumerate(rows):
        k = (r["brand"], r["branch"], r["name"], int(r["sale"]))
        if k in got:
            out.append([i] + got[k])
    return out


ROW_FIELDS = 15
COL_DELTA = [2]   # product name string ids: a branch's rows list names in order, so the differences are small numbers


def columns(rows):
    """price rows → one list per field (data.json "cols"), COL_DELTA fields as differences; rows_of() turns them back"""
    cols = [[r[f] for r in rows] for f in range(ROW_FIELDS)]
    for f in COL_DELTA:
        cols[f] = [v - (cols[f][j - 1] if j else 0) for j, v in enumerate(cols[f])]
    return cols


def rows_of(data):
    """data.json → price rows (accepts the older "rows" form too)"""
    if "rows" in data:
        return data["rows"]
    cols = [list(c) for c in data["cols"]]
    for f in data.get("colDelta", []):
        acc = 0
        for j, d in enumerate(cols[f]):
            acc += d
            cols[f][j] = acc
    return [list(r) for r in zip(*cols)]


def load_prev(prev_txt):
    """the previous app/data.json (the version the app has now) as (data, rows), or (None, []) if missing/unreadable"""
    if not prev_txt:
        return None, []
    try:
        prev = json.loads(prev_txt)
        return prev, rows_of(prev)
    except (ValueError, KeyError, TypeError, IndexError):
        return None, []


def row_keys_prev(prev, prow):
    """previous data: (brand, branch, name) → set of comparison ids"""
    ps, pb, pbrand = prev["s"], prev["branches"], [b[0] for b in prev["meta"]["brands"]]
    out = {}
    for r in prow:
        out.setdefault((pbrand[pb[r[0]][0]], ps[pb[r[0]][1]], ps[r[2]]), set()).update((ps[r[7]] or "").split())
    return out


def reclassified(prev, prow, rows):
    """comparison ids whose rows changed because the rules changed, not the prices: a row that is in both builds (same brand,
    branch and name) but joined or left the id. Their 'price change' since the last snapshot would only be the new mix of
    rows, so it is not reported, not sent to review, and the trend starts again from this date."""
    if not prev:
        return set()
    old = row_keys_prev(prev, prow)
    # both sides as name → all its ids (a branch can list the same name twice with different prices / ids)
    new = {}
    for r in rows:
        new.setdefault((r["brand"], r["branch"], r["name"]), set()).update(r["keys"].split())
    out = set()
    for ident, n in new.items():
        o = old.get(ident)
        if o is not None:
            out |= o ^ n
    # only ids that exist in both builds have a history to protect (a new id starts empty, a gone id is in keymap)
    before = {k[0] for k in prev.get("keys", [])}
    return out & before


def key_map(prev, prow, rows, allk):
    """old comparison id → [new id or "", old label] for ids the previous data.json had and this one doesn't (a taxonomy fix
    or renamed options change an auto key's signature). The app moves saved carts, favourites and alerts with it, and shows
    the old label for an id that has no successor instead of a bare 'T1234567'. Same row (brand, branch, name) decides: the
    new key that at least half of the old key's rows now carry. Older entries are kept and followed (A → B → C)."""
    if not prev:
        return {}
    ps, pb, pbrand = prev["s"], prev["branches"], [b[0] for b in prev["meta"]["brands"]]
    now = {k[0] for k in allk}
    plabel = {k[0]: k[2] for k in prev.get("keys", [])}
    newk = {}
    for r in rows:
        newk.setdefault((r["brand"], r["branch"], r["name"]), set()).update(r["keys"].split())
    votes, size = defaultdict(Counter), Counter()
    for r in prow:
        old = [k for k in (ps[r[7]] or "").split() if k not in now]
        if not old:
            continue
        nk = newk.get((pbrand[pb[r[0]][0]], ps[pb[r[0]][1]], ps[r[2]]), set())
        for k in old:
            size[k] += 1
            for n in nk:
                votes[k][n] += 1
    out = {}
    for k, n in size.items():
        best = votes[k].most_common(1)
        out[k] = [best[0][0] if best and best[0][1] * 2 >= n else "", plabel.get(k, k)]
    for k, (to, label) in (prev["meta"].get("keymap") or {}).items():
        if k in now or k in out:
            continue
        hops = 0
        while to and to not in now and hops < 10:
            to = out.get(to, (prev["meta"].get("keymap") or {}).get(to, ["", ""]))[0]
            hops += 1
        out[k] = [to if to in now else "", label]
    return dict(list(out.items())[-4000:])


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
    # region only, for branches whose pages carry no address of their own (data2/branch_region_hint.json, with evidence)
    hp = os.path.join(ROOT, "data2", "branch_region_hint.json")
    HINT = {k: v for k, v in json.load(open(hp, encoding="utf-8")).items() if not k.startswith("_")} if os.path.exists(hp) else {}
    branches, bi = [], {}
    for r in rows:
        k = (r["brand"], r["branch"])
        if k not in bi:
            g = geo.get(k, {})
            site = re.match(r"https?://[^/]+", r["url"]).group(0)
            bi[k] = len(branches)
            branches.append([bnames.index(r["brand"]), S(r["branch"]), S(clean_addr(g.get("address_full") or g.get("address", ""))),
                             float(g["lat"]) if g.get("lat") else None, float(g["lng"]) if g.get("lng") else None,
                             S(region(g.get("address", "")) or HINT.get(f"{r['brand']}|{r['branch']}", {}).get("region", "")), S(site), "", "",
                             # map pin precision: 0 building (road + number) · 1 street only · 2 district only · 3 none
                             {"road": 0, "street": 1, "district": 2}.get(g.get("geo_level"), 3)])
    # freshness: newest fetch date per branch; more than a day older than the newest collection in the data = this run did
    # not refresh it (its scrape failed or was blocked, previous data kept). Measured from the newest collection, not the
    # build date: a rebuild without scraping (a code push, --skip-scrape) the next day must not call every branch old.
    for r in rows:
        b = branches[bi[(r["brand"], r["branch"])]]
        d = (r["fetched_at"] or "")[:10]
        if d > b[7]:
            b[7] = d
    collected = max((b[7] for b in branches if b[7]), default="") or a.date
    for b in branches:
        b[8] = S("VERIFIED" if b[7] and (datetime.date.fromisoformat(collected) - datetime.date.fromisoformat(b[7])).days <= 1 else "STALE")
        b[7] = S(b[7])
    ALLK, VFAM = variant_keys()
    prev_txt = open(a.out, encoding="utf-8").read() if os.path.exists(a.out) else None   # the version the app has now
    prev_data, prev_rows = load_prev(prev_txt)
    recl_now = reclassified(prev_data, prev_rows, rows) & {k[0] for k in ALLK}
    # regrouped ids per date (newest last, 12 kept); the app re-bases alerts on them and the trend restarts there
    recl = [x for x in ((prev_data or {}).get("meta", {}).get("recl") or []) if x[0] != collected]
    same_day = next((x[1] for x in ((prev_data or {}).get("meta", {}).get("recl") or []) if x[0] == collected), [])
    if recl_now or same_day:
        recl.append([collected, sorted(set(same_day) | recl_now)])
    recl = recl[-12:]
    out_rows = []
    best = {}
    gid, groups, gkeys, bstat, low_reg = G.build(rows, bi, CATS)
    for r, g in zip(rows, gid):
        b = bi[(r["brand"], r["branch"])]
        kind = KINDS.index(r["kind"])
        out_rows.append([b, CATS.index(r["cat"]), S(r["name"]), int(r["sale"]), int(r["orig"]) if r["orig"] else 0,
                         kind, S(r["tags"]), S(r["keys"]), int(r["sess"] or 1), g, S(r["until"]), S(r["url"] if re.match(r"https?://", r["url"] or "") else ""),
                         {"포함": 1, "별도": 2}.get(r.get("vat", ""), 0), 0, S(part_keys(r["name"]))])
        if r["kind"] in ("일반", "고시가") and not r["tags"]:
            for k in r["keys"].split():
                kk = f"{k}|{r['brand']}|{r['branch']}"
                best[kk] = min(best.get(kk, 10 ** 12), int(r["sale"]))
    # weekly snapshot + changes against the previous one — dated by the collection, not the build: a rebuild without scraping
    # on a later day rewrites that collection's snapshot instead of adding an observation that never happened
    hist = os.path.join(ROOT, "data2", "history")
    os.makedirs(hist, exist_ok=True)
    prev_files = sorted(p for p in glob.glob(os.path.join(hist, "*.json")) if os.path.basename(p)[:10] < collected)
    save_snapshot(hist, collected, best)
    changes, prev_date = [], ""
    if prev_files:
        prev_date = os.path.basename(prev_files[-1])[:10]
        prev = load_snapshot(prev_files[-1])
        # every id regrouped after that snapshot (this build or an earlier build of a later day / the same day): its
        # 'change' since the snapshot is a new mix of rows, not a price change
        regrouped = {k for d, ks in recl for k in ks if d > prev_date} | recl_now
        kid = {k[0]: i for i, k in enumerate(ALLK)}
        for kk, after in best.items():
            before = prev.get(kk)
            if before and before != after:
                k, brand, branch = kk.split("|")
                if k in kid and k not in regrouped:
                    changes.append([kid[k], bi[(brand, branch)], before, after])
    checks = price_checks(rows, a.date)
    KB, CONCERNS = knowledge.export()   # treatment knowledge base + concern taxonomy (knowledge/)
    bkeys = [f"{BRANDS[b[0]][0]}|{s[b[1]]}" for b in branches]
    achg, anew, agone, aprev = G.snapshot_and_changes(hist, collected, gkeys, groups, low_reg, bkeys, glob.glob(os.path.join(hist, "*.auto.json.gz")))
    review = review_queue(rows, out_rows, bi, bkeys, gid, achg, changes, s, ALLK)
    keymap = key_map(prev_data, prev_rows, rows, ALLK)
    data = {
        # updated = the newest collection (what the app calls '수집'); built = the build date (expired events and the weekly
        # snapshot are counted from it)
        "meta": {"updated": collected, "built": a.date, "prev": prev_date, "review": review, "about": about(), "rows": len(out_rows), "branches": len(branches),
                 "brands": [list(b) for b in BRANDS], "kinds": KINDS, "cats": CATS,
                 "fam": VFAM, "kb": KB, "concerns": CONCERNS, "checks": checks, "keymap": keymap, "recl": recl},
        "branches": branches, "cols": columns(out_rows), "colDelta": COL_DELTA, "keys": [list(k) for k in ALLK], "changes": changes, "s": s,
        "trend": trend(hist, collected, rows, {k: d for d, ks in recl for k in ks}),
        "groups": [[S(x[0])] + x[1:] for x in groups], "bstat": bstat,
        "achg": {"prev": aprev, "chg": achg, "new": anew, "gone": [[S(x[0]), x[1], x[2]] for x in agone]},
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    txt = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    assert rows_of(json.loads(txt)) == out_rows, "price columns do not turn back into the same rows"
    open(a.out, "w", encoding="utf-8", newline="\n").write(txt)
    home_txt = homedata.write(a.out, txt)        # app/home.json: the home screen's rows, read first (round-2 O2)
    datameta.write_meta(a.out, txt, prev_txt, home_txt)   # app/data-meta.json: version, checksum, branch states, changed rows, home.json's checksum
    nogeo = [s[b[1]] for b in branches if b[3] is None]
    print(f"wrote {a.out}: {len(txt) / 1e6:.2f} MB | rows {len(out_rows)} | branches {len(branches)} (no map position: {len(nogeo)})"
          f" | strings {len(s)} | changes vs {prev_date or '-'}: {len(changes)} | review pending {review} | source re-checks matched {len(checks)}")
    if nogeo:
        print("  no position:", nogeo)


if __name__ == "__main__":
    main()
