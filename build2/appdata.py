"""data2/clean.csv + data2/branches.csv -> app/data.json (what the app loads) + a weekly snapshot for price changes.

usage: python build2/appdata.py [--date YYYY-MM-DD]
data.json (compact, strings interned in `s`):
  meta      updated = collection date (the day most branches were read, shown as '수집'), built = build date, row counts, brand list [name, color, note], kinds, cats, tags
  cols      the price rows, stored one list per field (cols[f][row]); like values sit together, so gzip makes the file about
            a quarter smaller than row arrays. Fields in colDelta are stored as differences from the row before (the app and
            the tools add them back up). A row = [branch, cat, name s, sale, orig, kind, tags s, keys s, sess, group, until s,
            url s, vat, review, parts s, addon, days, hours s]
            keys = comparison ids, space separated; sess = sessions in the price, 1 = single, 99 = 이용권/무제한;
            group = auto group index or -1; until = event end YYYY-MM-DD ('' none, 'posted:…' = 고시표 date);
            url = source page; vat 0 unknown / 1 포함 / 2 별도; review 1 = price moved ≥90% (or ×10) since last week
            and nobody approved it yet (data2/review.csv, approvals in data2/review_ok.csv) — the app keeps it out of
            comparisons
            parts = for names with '+': comparison keys matched by each part, 'X12,X24;;X01' (package mode C)
            addon = 1 when the price is only sold on top of another procedure ('옵션5) 에어녹스 추가', '[…옵션] …', '… 추가당',
            '… 추가 시', or the site marks it so): not a procedure price — keep it out of ranges, medians and 'lowest'
            (2026-10-15, 개선 보고서 E5; data.json files from before have 15 fields, read a missing one as 0)
            days = the weekdays the price is valid on, written on the site (build2/clean.py visit_days): a bit mask 월 1 · 화 2 ·
            수 4 · 목 8 · 금 16 · 토 32 · 일 64 (평일 31, 주말 96, 화/수/목 14), 0 = no day written
            hours = the hours it is valid in (visit_hours): 'HH:MM-HH:MM' in 24 h ('12:00-17:00'; 'N시 이전' = '00:00-16:00',
            'N시 이후' = '16:00-24:00'), '' = no hours written. Read from the group title, the option and the site's category
            (tab / section; for 유앤아이 only next to the item's own day / time words — build2/clean.py CAT_UNPAIRED), the
            texts the '평일 낮' / '시간대' tags read (2026-10-16, C1 다음: the app read every '평일 낮' as 월~금). data.json
            files from before have 16 fields: read a missing days as 0 and hours as ''
            tags = conditions joined by '·': 평일 낮 (the site limits the days: weekdays only, often some hours) · 시간대 (a time
            limit that is not weekdays-only: no days written, or a weekend day — since 2026-10-16; before, most were 평일 낮) ·
            일요일 · 타임세일 · 첫 방문 · 1인 1회 (build2/clean.py TAGS / time_tags). Any tag = not a plain price. A row with hours
            always has 평일 낮 or 시간대
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
  meta.plainRules  [[rule version, first collection (YYYY-MM-DD) built with it], …] — the rule for a plain (regular) price: the
            weekly snapshot, trend and changes, the groups' median regular price and bstat (build2/groups.py plain). 2 = kind
            일반/고시가, no tag, days 0 and hours '' (2026-10-16: a price limited to some weekdays or hours is conditional even
            without a tag, as in the app's '특가 제외'); 1 = no days / hours check, in a file without the field and in snapshots
            dated before the first entry. The next build judges the previous rows by the rule they were counted with, so a rule
            change shows in meta.recl, not as price changes
  meta.brandFirst  {brand: YYYY-MM-DD} the first collection in data2/history (개선 보고서 E9; a chain never collected is left out).
            A chain the previous snapshot did not have (new, or back after a gap) is new as a whole — its prices are not listed in
            achg.new ('새로 생김'). home.json carries the same meta.brandFirst
Snapshots: data2/history/<date>.json = {"<key>|<branch index name>": lowest plain price (groups.plain)}; the newest older one is
the 'before'.
"""
import argparse, csv, datetime, glob, json, os, re, sys, unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
from xkeys import X, match as xmatch, sessions as xsessions  # noqa: E402
import groups as G  # noqa: E402
import knowledge  # noqa: E402
import datameta  # noqa: E402
import homedata  # noqa: E402
import labels  # noqa: E402

BRANDS = [("블리비", "#6a5ae0", "지점별 이벤트 페이지(기획전·카테고리 7쪽)의 모든 가격"),
          ("쁨", "#e8437f", "지점별 온라인 예약 페이지의 모든 상품"),
          ("톡스앤필", "#0fa3a3", "지점별 '시술안내/가격'의 시술 상세 옵션. 옵션이 없는 시술은 '최저가부터' 가격"),
          ("리엔장", "#e0902a", "지점별 비급여 진료비 고시표(정가). 이벤트가가 아니며 표의 최종변경일이 오래됐을 수 있어요"),
          ("포에버", "#3a7bd5", "지점별 '시술 안내'의 시술 상세 옵션(할인가, 없으면 정가). 부가세(VAT) 별도 가격"),
          # added 2026-10-14 — always appended (the app turns new brands on by their position: meta.brands index)
          ("밴스", "#2f9e44", "지점별 '시술소개' 카테고리의 이벤트·상시 가격. 부가세(VAT) 별도"),
          ("유앤아이", "#a0522d", "지점 홈의 이벤트 가격(탭별). 부가세(VAT) 별도"),
          ("데이뷰", "#1d3557", "지점별 이벤트 페이지의 가격. '카톡플친 적용가'처럼 조건이 붙은 가격은 이름에 표시. 부가세(VAT) 별도"),
          ("닥터에버스", "#c92a2a", "지점별 이벤트 페이지의 항목 가격. 카카오톡 친구 대상 이벤트는 이벤트 이름에 표시"),
          # added 2026-10-15 (appended, as above)
          ("셀린", "#ae3ec9", "지점별 '시술 안내/가격'의 항목 가격(정가·할인가). '[카톡플친대상/첫방문]' 같은 조건은 이름에 그대로 표시")]
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


def spec_keys(specs, vkeys, live, families=(), labels=None):
    """each spec note (knowledge/specs.json) → the comparison keys of this data.json whose signature carries that word in that
    family. The app attaches a note by these ids, not by matching text: '국산' is inside '미국산', and many words sit only in
    the family name or inside a longer word (C7 검토, 2026-10-16)"""
    tok = defaultdict(set)
    for k in vkeys:
        for part in k["sig"].split("|")[2:]:
            for w in part.split(","):
                if w.strip():
                    tok[(k["fam"], w.strip())].add(k["id"])
    # hand-made keys (X01 '국산 사각턱 보톡스 50U'): the words of their label, in the family they are filed under
    for f in families:
        for cid in f.get("curated", []):
            for w in re.split(r"[\s·()/]+", (labels or {}).get(cid, "")):
                if w:
                    tok[(f["fam"], w)].add(cid)
    return [dict(e, keys=sorted(tok.get((e["fid"], e["spec"]), set()) & live)) for e in specs]


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


def brand_days(hist, upto):
    """brand → the dates of the snapshots in data2/history that have it (comparison and automatic-group snapshots)"""
    import gzip
    days = defaultdict(set)
    for p in sorted(glob.glob(os.path.join(hist, "*.json")) + glob.glob(os.path.join(hist, "*.auto.json.gz"))):
        d = os.path.basename(p)[:10]
        if d > upto:
            continue
        if p.endswith(".auto.json.gz"):
            with gzip.open(p, "rt", encoding="utf-8") as f:
                brands = {bk.split("|")[0] for _, per in json.load(f).values() for bk in per}
        else:
            brands = {kk.split("|")[1] for kk in load_snapshot(p) if kk.count("|") >= 2}
        for b in brands:
            days[b].add(d)
    return days


def brand_first(hist, upto):
    """brand → the date of the first snapshot in data2/history that has it"""
    return {b: min(ds) for b, ds in brand_days(hist, upto).items()}


def first_seen(days, brands, present, collected):
    """meta.brandFirst: a chain's first collection; one with rows this time but no history is new today; a chain never collected
    (no history, no rows — 포에버 while paused) is left out, not given a date that moves every week (C3 검토, 2026-10-16)"""
    return {b: min(days[b]) if days.get(b) else collected for b in brands if days.get(b) or b in present}


def chain_was_there(days, aprev, brand):
    """the previous snapshot had the chain: if not — new, or back after a gap (포에버 resumed) — its rows are new as a whole, not
    '새로 생김' one by one; the same rule as data-meta.json changes (a brand the previous data.json lacked → new_chains)"""
    return not aprev or aprev in days.get(brand, ())


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


# words a clinic page puts after the address (a popup's buttons, a footer link) that the scraper read with it — and, from
# 2026-10-16, the page footer: 'Copyright © 2024 PPEUMCLINIC. All…' (쁨·밴스), '개인정보취급방침 이용약관 …' (데이뷰·셀린),
# '내 위치에서 길 찾기' (유앤아이), '자세히보기' (쁨). scrape/branches.py FOOTER cuts the same words before it saves.
ADDR_JUNK = re.compile(r"\s*(오늘\s*하루\s*(그만\s*)?(보기|열지)|팝업\s*닫기|제휴\s*문의|닫기\s*$"
                       r"|(?i:copyright)|©|ⓒ|(?i:all\s+rights?\s+reserved)|사업자\s*등록\s*번호|개인정보\s*(취급|처리)\s*방침"
                       r"|이용\s*약관|병원\s*소개|의료진\s*소개|내\s*위치에서\s*길\s*찾기|자세히\s*보기).*$")
# before 2026-10-16 scrape/branches.py kept 40 characters after the address and cut the footer word there in half
# ('… Copyrigh', '… 내 위'): a saved text that fills those 40 characters loses its last word when that word is how one of
# these begins
SCRAPE_WINDOW = 40
FOOTER_WORDS = ("Copyright", "내 위치에서 길 찾기", "자세히보기", "개인정보 취급방침", "개인정보취급방침")


def clean_addr(a, addr=""):
    """address as shown in the app: the scraped text a (address_full) minus page furniture; addr = the bare address the
    text starts with (data2/branches.csv keeps the original)"""
    out = ADDR_JUNK.sub("", a or "").strip()
    if addr and out == (a or "").strip() and out.startswith(addr) and len(out) - len(addr) == SCRAPE_WINDOW:
        for w in FOOTER_WORDS:
            cut = next((k for k in range(len(w) - 1, 0, -1) if out.endswith(" " + w[:k])), 0)
            if cut:
                return out[:-cut].rstrip(" ,·|/")
    return out


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


ROW_FIELDS = 18
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


def prev_cond(prev, r):
    """(kind, tags, days, hours) of a previous data.json row — files from before 2026-10-16 have no days / hours fields"""
    ps, pkinds = prev["s"], prev["meta"].get("kinds") or KINDS
    return pkinds[r[5]], ps[r[6]] or "", r[16] if len(r) > 16 else 0, ps[r[17]] if len(r) > 17 else ""


def prev_rule(prev, date=None):
    """the plain-price rule (groups.plain) the previous data.json used for its own collection — or, given a date, for the
    snapshot of that date (meta.plainRules; 1 in files without it)"""
    return G.rule_at(prev["meta"].get("plainRules"), date or prev["meta"].get("updated", ""))


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
    # a row at the same price whose kind or condition tags changed (2026-10-15: a page-wide '평일 낮' / '첫 방문' tag dropped by the
    # fold rule) moves the key's plain lowest price without any clinic changing a price: 울쎄라 300샷 read as three price cuts
    # The same holds for a change of the rule itself (2026-10-16: a price with days / hours but no tag is no longer plain): the
    # previous rows are judged by the rule the previous file was built with (meta.plainRules), these by today's. A later build of
    # the same collection finds nothing new here and keeps the ids through meta.recl's entry of that date
    ps, pb, pbrand = prev["s"], prev["branches"], [b[0] for b in prev["meta"]["brands"]]
    was, now = defaultdict(set), defaultdict(set)
    for r in prow:
        was[(pbrand[pb[r[0]][0]], ps[pb[r[0]][1]], ps[r[2]], int(r[3]))].add(prev_cond(prev, r))
    for r in rows:
        now[(r["brand"], r["branch"], r["name"], int(r["sale"]))].add((r["kind"], r["tags"] or "", int(r.get("days") or 0), r.get("hours") or ""))
    # only when that changes whether the row counts as a plain price (a 체험가 row losing '첫 방문' moves nothing: 검증 7차)
    rule = prev_rule(prev)
    plain = lambda st, rule=G.PLAIN_RULE: any(G.plain(*c, rule=rule) for c in st)
    for ident, x in now.items():
        if ident in was and plain(was[ident], rule) != plain(x):
            out |= new.get(ident[:3], set()) | old.get(ident[:3], set())
    # a row at the same price that joined or left an id while a same-named row at another price kept it (검증 8차: 톡스앤필 건대점
    # '[울써마지 옵션] 얼굴전체 더모톡신' 190,000 became an add-on and left T2976BFB; the 290,000 row of the same name kept it, so the
    # name-level sets above were equal and the key read as a rise 190,000 → 290,000)
    wk, nk = defaultdict(set), defaultdict(set)
    for r in prow:
        wk[(pbrand[pb[r[0]][0]], ps[pb[r[0]][1]], ps[r[2]], int(r[3]))].update((ps[r[7]] or "").split())
    for r in rows:
        nk[(r["brand"], r["branch"], r["name"], int(r["sale"]))].update(r["keys"].split())
    for ident in wk.keys() & nk.keys():
        out |= wk[ident] ^ nk[ident]
    # only ids that exist in both builds have a history to protect (a new id starts empty, a gone id is in keymap)
    before = {k[0] for k in prev.get("keys", [])}
    return out & before


def group_moved(prev, prow, rows, gid, since=None):
    """(brand|branch, group key, price) of rows that are in both builds at the same price but now count for their automatic
    group's regular price when they did not, or the other way round (2026-10-15: '[울써마지 옵션] 얼굴전체 더모톡신' 190,000 became
    an add-on, and the group read it as a price rise 190,000 → 290,000 at 톡스앤필 건대점). A change whose old or new price is such
    a row is the rules', not the clinic's. The previous rows count by the plain rule of the snapshot the changes are counted from
    (since = its date; 2026-10-16: a '토요일이벤트' price left the regular price without changing). Not by the previous file's own
    rule: a second build of the same collection has a previous file of the new rule but still counts from the older snapshot
    (keys keep such ids in meta.recl; groups have no such list), and would list the moved prices as '없어짐'."""
    if not prev:
        return set()
    ps, pb, pbrand = prev["s"], prev["branches"], [b[0] for b in prev["meta"]["brands"]]
    rule = prev_rule(prev, since)
    was = {}
    for r in prow:
        counted = len(r) > 9 and r[9] >= 0 and G.plain(*prev_cond(prev, r), rule=rule)
        ident = (pbrand[pb[r[0]][0]], ps[pb[r[0]][1]], ps[r[2]], int(r[3]))
        was[ident] = was.get(ident, False) or counted
    now = {}
    for r, g in zip(rows, gid):
        ident = (r["brand"], r["branch"], r["name"], int(r["sale"]))
        now[ident] = now.get(ident, False) or (g >= 0 and G.regular(r))
    return {(f"{i[0]}|{i[1]}", G.comp(i[2]), i[3]) for i, c in now.items() if i in was and was[i] != c}


def sex_word(label):
    """여성 / 남성 / '' from a label in any of the clinics' forms (NFKC: one clinic writes 女 as the compatibility letter U+F981)"""
    m = re.search(r"여성|여자|\(여\)|女|남성|남자|\(남\)|男", unicodedata.normalize("NFKC", label or ""))
    return "" if not m else "여성" if m.group() in ("여성", "여자", "(여)", "女") else "남성"


def bare_label(label):
    """a label without its sex words and spaces: '여성 女 브라질리언 제모 5회' and '여성 브라질리언 제모 5회' are the same"""
    return re.sub(r"\s+|여성|여자|남성|남자|\((?:여|남)\)|女|男", "", unicodedata.normalize("NFKC", label or ""))


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
            for n in sorted(nk):          # same order on every run (set order changed with PYTHONHASHSEED)
                votes[k][n] += 1
    nlabel = {k[0]: k[2] for k in allk if len(k) > 2}
    out = {}
    for k, n in size.items():
        c = votes[k]
        top = max(c.values()) if c else 0
        # a tie goes to the key of the old label's sex, then to the key with the old label's words ('브라질리언', not '브라질리언+항문':
        # 검증 8차), then to the smaller id (not to the order rows came in)
        sx, bare = sex_word(plabel.get(k, "")), bare_label(plabel.get(k, ""))
        tied = sorted((i for i, x in c.items() if x == top),
                      key=lambda i: (sex_word(nlabel.get(i, "")) != sx, bare_label(nlabel.get(i, "")) != bare, i))
        to = tied[0] if tied and top * 2 >= n else ""
        # an old label without a sex whose rows split evenly between a 여성 and a 남성 key has no successor (the id order would
        # pick a sex for the saved item: '팔전체 제모' 4:4 → 남성, 검증 8차)
        if to and not sx and sex_word(nlabel.get(to, "")) and {"여성", "남성"} <= {sex_word(nlabel.get(i, "")) for i in tied}:
            to = ""
        # never to another session count: '남성 목 제모 10회' is not '남성 목 제모 5회' even when half its old rows (5회 rows the
        # old build keyed wrong) went there (검증 6차) — unless every old row went there (then the old label's count was the bug);
        # never to the other sex ('남성 헤어라인 or 눈썹 제모' → a 여성 key on a tie, 검증 7차)
        old_l, new_l = plabel.get(k, ""), nlabel.get(to, "")
        if to and top < n and xsessions(old_l) != xsessions(new_l):
            to = ""
        if to and {"여성", "남성"} == {sex_word(old_l), sex_word(new_l)}:
            to = ""
        out[k] = [to, plabel.get(k, k)]
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
            branches.append([bnames.index(r["brand"]), S(r["branch"]), S(clean_addr(g.get("address_full") or g.get("address", ""), g.get("address", ""))),
                             float(g["lat"]) if g.get("lat") else None, float(g["lng"]) if g.get("lng") else None,
                             S(region(g.get("address", "")) or HINT.get(f"{r['brand']}|{r['branch']}", {}).get("region", "")), S(site), "", "",
                             # map pin precision: 0 building (road + number) · 1 street only · 2 district only · 3 none
                             {"road": 0, "street": 1, "district": 2}.get(g.get("geo_level"), 3)])
    # freshness: newest fetch date per branch; more than a day older than the collection = this run did not refresh it (its
    # scrape failed or was blocked, previous data kept). The collection is the day most branches were read (newest on a
    # tie) — not the build date (a rebuild without scraping the next day must not call every branch old) and not the newest
    # date (one brand added mid-week, 2026-10-15 셀린, must not call the others old or add a snapshot to their history).
    for r in rows:
        b = branches[bi[(r["brand"], r["branch"])]]
        d = (r["fetched_at"] or "")[:10]
        if d > b[7]:
            b[7] = d
    days = Counter(b[7] for b in branches if b[7])
    collected = max(days, key=lambda d: (days[d], d)) if days else a.date
    for b in branches:
        b[8] = S("VERIFIED" if b[7] and (datetime.date.fromisoformat(collected) - datetime.date.fromisoformat(b[7])).days <= 1 else "STALE")
        b[7] = S(b[7])
    ALLK, VFAM = variant_keys()
    prev_txt = open(a.out, encoding="utf-8").read() if os.path.exists(a.out) else None   # the version the app has now
    prev_data, prev_rows = load_prev(prev_txt)
    hist = os.path.join(ROOT, "data2", "history")
    os.makedirs(hist, exist_ok=True)
    prev_files = sorted(p for p in glob.glob(os.path.join(hist, "*.json")) if os.path.basename(p)[:10] < collected)
    prev = load_snapshot(prev_files[-1]) if prev_files else {}
    # an id the app's data.json does not have but the last snapshot does (gone in an earlier rules change, back now with other
    # rows): its snapshot prices are another mix of rows, so it is regrouped too (검증 6차: 'TAE6F24F 남성 얼굴 제모' read as
    # 톡스앤필 목동 30,000 → 100,000)
    prev_ids = {k[0] for k in (prev_data or {}).get("keys", [])}
    revived = ({kk.split("|")[0] for kk in prev} - prev_ids) if prev_data else set()
    recl_now = (reclassified(prev_data, prev_rows, rows) | revived) & {k[0] for k in ALLK}
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
                         {"포함": 1, "별도": 2}.get(r.get("vat", ""), 0), 0, S(part_keys(r["name"])), int(r["addon"] == "1"),
                         int(r.get("days") or 0), S(r.get("hours", ""))])
        if G.regular(r):            # plain price: no tag, no weekday / hour limit (groups.plain)
            for k in r["keys"].split():
                kk = f"{k}|{r['brand']}|{r['branch']}"
                best[kk] = min(best.get(kk, 10 ** 12), int(r["sale"]))
    # weekly snapshot + changes against the previous one — dated by the collection, not the build: a rebuild without scraping
    # on a later day rewrites that collection's snapshot instead of adding an observation that never happened
    save_snapshot(hist, collected, best)
    changes, prev_date = [], ""
    if prev_files:
        prev_date = os.path.basename(prev_files[-1])[:10]
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
    vp = os.path.join(ROOT, "data2", "variants.json")
    vj = json.load(open(vp, encoding="utf-8")) if os.path.exists(vp) else {"keys": [], "families": []}
    KB["specs"] = spec_keys(KB["specs"], vj["keys"], {k[0] for k in ALLK}, vj.get("families", []), {k[0]: k[2] for k in ALLK})
    bkeys = [f"{BRANDS[b[0]][0]}|{s[b[1]]}" for b in branches]
    achg, anew, agone, aprev = G.snapshot_and_changes(hist, collected, gkeys, groups, low_reg, bkeys, glob.glob(os.path.join(hist, "*.auto.json.gz")))
    moved = group_moved(prev_data, prev_rows, rows, gid, aprev)
    achg = [c for c in achg if (bkeys[c[1]], gkeys[c[0]], c[2]) not in moved and (bkeys[c[1]], gkeys[c[0]], c[3]) not in moved]
    # the same for '새로 생김' / '없어짐': a row the rules moved into or out of a group is not a new or a gone price (검증 7차)
    anew = [c for c in anew if (bkeys[c[1]], gkeys[c[0]], c[2]) not in moved]
    agone = [c for c in agone if (bkeys[c[1]], c[3], c[2]) not in moved][:G.GONE_MAX]
    # a chain the previous snapshot did not have is new as a whole: its prices are not '새로 생김' one by one (2026-10-15, 개선 보고서
    # E9 — 밴스·유앤아이·데이뷰·닥터에버스·셀린 filled the list on 10-14; a chain back after a gap too, C3 검토)
    days = brand_days(hist, collected)
    anew = [c for c in anew if chain_was_there(days, aprev, bkeys[c[1]].split("|")[0])]
    review = review_queue(rows, out_rows, bi, bkeys, gid, achg, changes, s, ALLK)
    keymap = key_map(prev_data, prev_rows, rows, ALLK)
    data = {
        # updated = the collection (the day most branches were read; what the app calls '수집'); built = the build date (expired events and the weekly
        # snapshot are counted from it)
        "meta": {"updated": collected, "built": a.date, "prev": prev_date, "review": review, "about": about(), "rows": len(out_rows), "branches": len(branches),
                 "brands": [list(b) for b in BRANDS], "kinds": KINDS, "cats": CATS,
                 "fam": VFAM, "kb": KB, "concerns": CONCERNS, "checks": checks, "keymap": keymap, "recl": recl, "labelRules": labels.RULES,
                 "plainRules": G.rule_marks((prev_data or {}).get("meta", {}).get("plainRules"), collected),
                 "brandFirst": first_seen(days, [b for b, *_ in BRANDS], {r["brand"] for r in rows}, collected)},
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
