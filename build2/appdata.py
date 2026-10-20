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
            (down: every plain row of that id or group there at a tenth or less) and nobody approved it yet, or it waited in
            the previous build at the same price (data2/review.csv, approvals in data2/review_ok.csv; review_queue) — the app
            keeps it out of comparisons. Until approved, what such a row moves is held (held / held_back, 2026-10-19: 블리비
            대구 동성로점·제주점 '얼굴 점빼기(2mm 이하) 개당' 1,000·5,000 → 100 stood in the 가격 변동 list while the rows were
            hidden): where it is the lowest of an id or group at that branch, this collection's snapshots count the price before
            it there (not where the rules moved that place's rows since), or a shown row's below that (held_price; neither: left
            out) — so the held price is no `changes` / achg entry, trend point or baseline, and no data-meta.json changes entry
            (meta.about.review 'was': the prices the name listed before). Approved, a change once; back, nothing. While it
            waits, a shown row of that id there that rose is not seen in changes (data-meta lists it)
            parts = for names with '+': comparison keys matched by each part, 'X12,X24;;X01' (package mode C)
            addon = 1 when the price is only sold on top of another procedure ('옵션5) 에어녹스 추가', '[…옵션] …', '… 추가당',
            '… 추가 시', or the site marks it so): not a procedure price — keep it out of ranges, medians and 'lowest'
            (2026-10-15, 개선 보고서 E5; data.json files from before have 15 fields, read a missing one as 0)
            days = the weekdays the price is valid on, written on the site (build2/clean.py visit_days): a bit mask 월 1 · 화 2 ·
            수 4 · 목 8 · 금 16 · 토 32 · 일 64 (평일 31, 주말 96, 화/수/목 14), 0 = no day written
            hours = the hours it is valid in (visit_hours): 'HH:MM-HH:MM' in 24 h ('12:00-17:00'; 'N시 이전' = '00:00-16:00',
            'N시 이후' = '16:00-24:00'), '' = no hours written. Read from the group title, the option and the site's category
            (tab / section; not for a chain in build2/clean.py CAT_UNPAIRED — none since 2026-10-19), the
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
            — not where the rules moved a row of that price into or out of the group's regular price (group_moved, meta.reclGroups);
            where a row waiting for review is the group's regular lowest at that branch, counted with the held price (review)
  meta.fam  procedure families (build2/taxonomy.py) for the compare picker and option switch: [name, regex for related rows
            at a branch (tested on the name without spaces), [[key id, variant label]...], compare category, base family id,
            [the clinics' own short explanations from the names]]
  meta.kb   Treatment Knowledge Base (knowledge/treatments.json via build2/knowledge.py): resolved entries with one-liner,
            purpose, areas, method, kinds, side effects, cautions, sources, review status; matched to families by name or base id
  keys      [id, cat, label] — hand-made X01..X36 (xkeys.py) first, then variant keys T… (taxonomy.py, data2/variants.json)
  changes   [key, branch, before, after] for comparison prices that moved since the previous snapshot — not where a rule moved the
            key's rows at that branch (meta.reclBranches; the key's other branches keep their changes); where a row waiting for
            review is the key's plain lowest at that branch, counted with the held price (review)
  meta.plainRules  [[rule version, first collection (YYYY-MM-DD) built with it], …] — the rule for a plain (regular) price: the
            weekly snapshot, trend and changes, the groups' median regular price and bstat (build2/groups.py plain). 2 = kind
            일반/고시가, no tag, days 0 and hours '' (2026-10-16: a price limited to some weekdays or hours is conditional even
            without a tag, as in the app's '특가 제외'); 1 = no days / hours check, in a file without the field and in snapshots
            dated before the first entry. The next build judges the previous rows by the rule they were counted with, so a rule
            change shows in meta.recl, not as price changes
  meta.recl  [[collection date, [ids]], …] (12 kept) — ids whose rows a rule moved (joined / left the id, or now count or no longer
            count as plain, or a price a rule took back — came_back — that is plain or the branch's first or lowest of the id):
            the trend restarts there and the app re-bases alerts on them (reclDate). A price a rule took back is no '새로 생김'
            either (achg.new, data-meta.json changes.added)
  meta.reclBranches  [[collection date, {id: [branch index, …]}], …], one entry per meta.recl entry — at which branches the
            rows of that id moved (2026-10-16): `changes` leaves out only those branches. An id of that meta.recl date with no
            entry here moved at every branch (an id that came back, or one a data.json from before this field listed). Read by
            the next build only: a later build of the same collection still counts from the older snapshot. Such a build also
            lists every branch whose plain lowest is not the earlier build's (same_collection_moved — rows a rule renamed)
  meta.reclGroups  [collection date, achg.prev, [[group key, branch index, price], …]] (2026-10-16) — the same for the automatic
            groups: prices the rules moved into or out of a group's regular price at that branch (a row of the same name and
            price that now counts and did not, or the other way round), found by this build and the earlier builds of the same
            collection (group_moved, group_memory). achg leaves out a change, new or gone entry whose before or after price is
            one of them. group key = xkeys.comp of the name (not in `s`); only keys of the achg.prev snapshot. Read by the next
            build only. A previous file of the same collection without it: still_listed (the snapshot's prices still sold there)
            and every '새로 생김' of that build (achg_moved — the snapshot cannot tell a row a rule moved in)
  meta.keymap  {old id: [new id or '', old label] or [new id, old label, 1]} (key_map) — ids an earlier build had: the app moves
            saved items to the new id and shows the old label where there is none. 1 (2026-10-19): the rename moved no row (carried),
            so the new id carries the old id's history — its snapshot points in `trend`, its price there in `changes` (carried_before)
            — except where the new id is regrouped itself (meta.recl / reclBranches). An id merged into one the previous file had
            always is, at the branches the old id's rows joined it, so a merge restarts its trend and drops those branches' changes
            (as without the mark: the 10-18 rebuild marked 29, 27 of them merges, and 8 real changes stayed out). Doing better needs
            the pairs read through the renames kept in data.json (a later build of the collection cannot tell them apart)
  meta.brandFirst  {brand: YYYY-MM-DD} the first collection in data2/history (개선 보고서 E9; a chain never collected is left out).
            A chain the previous snapshot did not have (new, or back after a gap) is new as a whole — its prices are not listed in
            achg.new ('새로 생김'). home.json carries the same meta.brandFirst
Snapshots: data2/history/<date>.json = {"<key>|<branch index name>": lowest plain price (groups.plain)}; the newest older one is
the 'before'. Where a row waiting for review is that price, the snapshot has the held price (review: held_price).
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


def check_family_names(fams):
    """the build guard on meta.fam (2026-10-19): two compare cards of one name (letter case and word breaks aside, labels.name_clashes)
    stop the build before app/data.json is written — weekly-prices run 39167274491 stopped a day later, on the shipped data, at
    tests/homedata.test.js ('에어녹스' three times). weekly.py then builds last week's data, and a rule that still makes them fails the run"""
    clash = labels.name_clashes([f[0] for f in fams])
    if clash:
        raise SystemExit(f"meta.fam: family names that read the same {clash[:5]} (build2/labels.py name_clashes, build2/taxonomy.py build)")


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


def trend(hist, date, rows, since=None, carry=None):
    """weekly price trend per comparison key from the snapshots in data2/history (regular prices only):
    {"dates": [...], "k": {key: [[median, min, branches] or None per date]}, "disc": {key: median % off the list price now}}
    carry: {old id: new id} — renames that moved no row (meta.keymap entries marked 1, key_map, carried): the old ids' snapshot
    points count for the successor (2026-10-19: an auto key whose representative spelling changed started its trend again while
    the app moved saved items on). A branch in two of them counts once, at the lowest (the successor's rows are theirs together);
    the history starts from the latest date any of them was regrouped (since). The snapshots stay as they were written"""
    files = sorted(p for p in glob.glob(os.path.join(hist, "*.json")) if os.path.basename(p)[:10] <= date)[-52:]
    point = lambda vs: [vs[len(vs) // 2], vs[0], len(vs)]
    fam = defaultdict(set)
    for o, n in (carry or {}).items():
        fam[n] |= {o, n}
    member = {x: n for n, xs in fam.items() for x in xs}
    dates, per, joined = [], {}, {}
    for i, p in enumerate(files):
        dates.append(os.path.basename(p)[:10])
        by, at = {}, defaultdict(dict)
        for kk, v in load_snapshot(p).items():
            k, place = kk.split("|", 1)
            by.setdefault(k, []).append(v)
            if k in member:
                m = at[member[k]]
                m[place] = min(m.get(place, v), v)
        for k, vs in by.items():
            vs.sort()
            per.setdefault(k, [None] * len(files))[i] = point(vs)
        for n, m in at.items():
            joined.setdefault(n, [None] * len(files))[i] = point(sorted(m.values()))
    per.update(joined)
    for k in per:
        per[k] += [None] * (len(files) - len(per[k]))
    # since: {key: date} — the rows of the key were regrouped on that date; earlier weeks measured another mix of rows
    since = dict(since or {})
    for n, xs in fam.items():
        since[n] = max(since.get(x, "") for x in xs)
    for k, d0 in since.items():
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
    review = list(csv.DictReader(open(rv, encoding="utf-8-sig")))[:REVIEW_KEEP] if os.path.exists(rv) else []
    return {"issues": dict(issues), "vat": vat, "sources": src, "report": report, "review": review}


REVIEW_KEEP = 200       # the rows of data2/review.csv data.json keeps (meta.about.review, the 운영 screen's 검토 큐)


def review_queue(rows, out_rows, bi, bkeys, gid, achg, changes, s, allk, was=None, waited=(), snaps=({}, {}, [])):
    """prices that moved ≥90% down or ×10 up since the previous snapshot are held back (row[13] = 1) until someone
    lists them in data2/review_ok.csv (brand,branch,name,price). Writes data2/review.csv. Returns pending count.
    The move is of an id's or group's plain lowest at a branch (changes, achg): up, the row of the new lowest waits; down,
    every plain row there at a tenth of the price before or less — not only the lowest, or the next one would be the new
    lowest unseen (검수 2026-10-19: '정품' 320,000 → 30,000 beside a held 300,000 → 29,000). A row the previous data.json held at the
    same price waits again (waited = prev_held) whatever its place's price did since: an approved row or a real cut beside it
    moves the snapshot it is compared with, and the held price would pass without anyone approving it (검수 2026-10-19:
    300,000 → 250,000 beside a held 29,000 let it through as -88% the next week).
    before = the price of the id or group at that branch in the previous snapshots (snaps = (ids {'id|brand|branch': price},
    groups {group key: {'brand|branch': price}}, group keys)): the one it moved from, or for a row only waiting since an earlier
    build its group's there, else its first id's (none: its own price). was (검토 대기 rows) = the prices the name (and price kind)
    listed before (name_was, space separated, '' none, '?' not known) — what data-meta.json counts the row from once it is approved
    or back (datameta.waiting). The next build reads it from meta.about.review only (REVIEW_KEEP rows): further down the file
    has '?' too, so a rebuild of the collection writes the same file (검수 2026-10-19: past 200 a guess came back as the name's
    prices). What the held rows move in changes, achg and the snapshots is counted after this (held)."""
    okp = os.path.join(ROOT, "data2", "review_ok.csv")
    ok = {(x["brand"], x["branch"], x["name"], int(x["price"])) for x in csv.DictReader(open(okp, encoding="utf-8-sig"))} if os.path.exists(okp) else set()
    big = lambda before, after: after <= before * 0.1 or after >= before * 10
    hits = {}
    for g, b, before, after in achg:
        if big(before, after):
            hits[("g", g, b)] = (before, after)
    for k, b, before, after in changes:
        if big(before, after):
            hits[("k", allk[k][0], b)] = (before, after)
    out = []
    for i, (r, row) in enumerate(zip(rows, out_rows)):
        b, sale = row[0], row[3]
        hit = lambda x: x in hits and (sale == hits[x][1] or (sale <= hits[x][0] * 0.1 and G.regular(r)))
        at = next((x for x in [("g", gid[i], b)] + [("k", k, b) for k in r["keys"].split()] if hit(x)), None)
        key = (r["brand"], r["branch"], r["name"], sale)
        if at is not None:
            before = hits[at][0]
        elif key in waited:
            ids, grs, gk = snaps
            before = next((p for p in [grs.get(gk[gid[i]], {}).get(bkeys[b]) if gid[i] >= 0 else None]
                           + [ids.get(f"{k}|{r['brand']}|{r['branch']}") for k in r["keys"].split()] if p), sale)
        else:
            continue
        approved = key in ok
        if not approved:
            row[13] = 1
        w = (was or {}).get((r["brand"], r["branch"], r["name"], r["kind"]), [])
        out.append({"status": "승인됨" if approved else "검토 대기", "brand": r["brand"], "branch": r["branch"], "name": r["name"],
                    "before": before, "price": sale, "change": f"{(sale / before - 1) * 100:+.0f}%", "url": r["url"],
                    "was": "" if approved else "?" if w is None else " ".join(map(str, w))})
    for x in out[REVIEW_KEEP:]:
        if x["status"] == "검토 대기":
            x["was"] = "?"
    with open(os.path.join(ROOT, "data2", "review.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["status", "brand", "branch", "name", "before", "price", "change", "url", "was"])
        w.writeheader()
        w.writerows(out)
    return sum(1 for x in out if x["status"] == "검토 대기")


def prev_held(prev):
    """review_queue's waited: {(brand, branch, name, price)} of the rows the previous data.json held for review (row[13] = 1)"""
    return {k[:3] + (p,) for k, (_, ps) in datameta.waiting(prev).items() for p in ps} if prev else set()


def name_was(prev):
    """review.csv 'was' for this build's rows: {(brand, branch, name, kind): [prices]} the previous data.json lists for that name
    and price kind — where it held the name for review, the prices the name stood for there (datameta.waiting: that file's own
    'was', so a rebuild of the collection and a week still waiting carry the prices from before the move; None where it cannot
    say). Not the id's or group's lowest ('before'): a name next to a cheaper one of the same id moved from its own price
    (검수 2026-10-19: '울쎄라 100샷 정품 1회' 320,000 → 29,000 beside a 300,000 row read as 300,000 → 320,000 when it came back)"""
    if not prev:
        return {}
    kinds = prev["meta"].get("kinds") or KINDS
    out = dict(datameta.resolved(prev))
    out.update({k: was for k, (was, _) in datameta.waiting(prev).items()})
    return {(k[0], k[1], k[2], kinds[k[3]] if 0 <= k[3] < len(kinds) else ""): v for k, v in out.items()}


def held(rows, out_rows, gid, best, low_reg):
    """what the rows waiting for review (row[13] = 1, review_queue) move: {'id|brand|branch': the plain lowest of the other rows
    there, None when there is none} where such a row is the plain lowest (best) and no shown row has that price, and
    {(group index, branch index): the same} for the groups' regular lowest (low_reg) — the moves review_queue found and the other
    ids of those rows. A row that waits is out of the app's comparisons: until someone approves it, these places are counted
    with the price before it (hold_back, groups.held_back)"""
    shown_k, shown_g = {}, defaultdict(dict)
    for r, row, g in zip(rows, out_rows, gid):
        if row[13] or not G.regular(r):
            continue
        p = row[3]
        for k in r["keys"].split():
            kk = f"{k}|{r['brand']}|{r['branch']}"
            shown_k[kk] = min(shown_k.get(kk, p), p)
        if g >= 0:
            shown_g[g][row[0]] = min(shown_g[g].get(row[0], p), p)
    return ({kk: shown_k.get(kk) for kk, p in best.items() if shown_k.get(kk) != p},
            {(g, b): shown_g[g].get(b) for g, m in low_reg.items() for b, p in m.items() if shown_g[g].get(b) != p})


def held_price(shown, before):
    """a held place's price (held): the lower of the snapshot's one before it and the lowest shown row there — the waiting row
    counts at the price before it, and a shown row below that is what the app shows (검수 2026-10-19: a row a rule brought back,
    a real cut next to a new waiting row); None where neither is. before is None too where the rules moved that place's rows
    since that snapshot: its price there is another mix of rows (검수 2026-10-19: kept, it came back as a change the next week)"""
    ps = [p for p in (shown, before) if p is not None]
    return min(ps) if ps else None


def hold_back(best, hk, before, moved=(set(), set())):
    """this collection's snapshot of the comparison ids, and what `changes` counts: best, but each held 'id|brand|branch' (held) at
    held_price with the snapshot it is compared with (before) — not where the rules moved its rows since (moved = regrouped:
    (ids at every branch, {(id, 'brand|branch')})) — left out where that is None. In best's order: the file's bytes do
    not depend on the hash seed (검수 2026-10-19). groups.held_back does the same for the automatic groups"""
    ids, pairs = moved
    out = {}
    for kk, p in best.items():
        if kk in hk:
            k, place = kk.split("|", 1)
            p = held_price(hk[kk], None if k in ids or (k, place) in pairs else before.get(kk))
            if p is None:
                continue
        out[kk] = p
    return out


def held_achg(chg, new, hg, snap, moved, gkeys, bkeys):
    """achg chg / new at the held (group, branch) places (held) counted with this collection's snapshot (groups.held_back): none
    where that is the 'before' price; where a shown row below it is the price now, that one — unless a rule moved a row of that
    price (achg_keep). The other entries stay as they are"""
    now = lambda g, b: snap.get(gkeys[g], ["", {}])[1].get(bkeys[b])
    at = lambda g, b, p: (bkeys[b], gkeys[g], p) in moved
    chg = [c if (c[0], c[1]) not in hg else [c[0], c[1], c[2], now(c[0], c[1])] for c in chg]
    new = [c if (c[0], c[1]) not in hg else [c[0], c[1], now(c[0], c[1])] for c in new]
    return ([c for c in chg if c[3] is not None and c[3] != c[2] and not at(c[0], c[1], c[3])],
            [c for c in new if c[2] is not None and not at(*c)])


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


def read_ids(text, ren=None):
    """the comparison ids of a keys field; with ren ({old id: new id}, this build's renames — carried) an id this build renamed
    reads as its successor"""
    return {(ren or {}).get(k, k) for k in (text or "").split()}


def row_keys_prev(prev, prow, ren=None):
    """previous data: (brand, branch, name) → set of comparison ids (ren: read_ids)"""
    ps, pb, pbrand = prev["s"], prev["branches"], [b[0] for b in prev["meta"]["brands"]]
    out = {}
    for r in prow:
        out.setdefault((pbrand[pb[r[0]][0]], ps[pb[r[0]][1]], ps[r[2]]), set()).update(read_ids(ps[r[7]], ren))
    return out


def prev_cond(prev, r):
    """(kind, tags, days, hours) of a previous data.json row — files from before 2026-10-16 have no days / hours fields"""
    ps, pkinds = prev["s"], prev["meta"].get("kinds") or KINDS
    return pkinds[r[5]], ps[r[6]] or "", r[16] if len(r) > 16 else 0, ps[r[17]] if len(r) > 17 else ""


def prev_rule(prev, date=None):
    """the plain-price rule (groups.plain) the previous data.json used for its own collection — or, given a date, for the
    snapshot of that date (meta.plainRules; 1 in files without it)"""
    return G.rule_at(prev["meta"].get("plainRules"), date or prev["meta"].get("updated", ""))


def came_back(prev, prow, rows):
    """(brand, branch, name, price) of this build's rows that a rule took back: the previous build dropped them for their words
    alone (clean.csv back — e.g. 391 닥터에버스 prices under '※카카오톡 플러스친구 혜택'-type headings, read as notices until
    2026-10-16) and the previous data.json does not have them. The clinic did not add them, so they are not '새로 생김'
    (data-meta.json changes.added, achg.new); where one moves what an id shows at its branch it is a rule's move (meta.recl:
    recl_pairs; the groups: group_moved)"""
    if not prev:
        return set()
    ps, pb, pbrand = prev["s"], prev["branches"], [b[0] for b in prev["meta"]["brands"]]
    had = {(pbrand[pb[r[0]][0]], ps[pb[r[0]][1]], ps[r[2]], int(r[3])) for r in prow}
    back = ((r["brand"], r["branch"], r["name"], int(r["sale"])) for r in rows if r.get("back") == "1")
    return {i for i in back if i not in had}


def reclassified(prev, prow, rows):
    """comparison ids whose rows changed because the rules changed, not the prices: a row that is in both builds (same brand,
    branch and name) but joined or left the id. Their 'price change' since the last snapshot would only be the new mix of
    rows, so it is not reported, not sent to review, and the trend starts again from this date (meta.recl)."""
    return {k for k, _ in recl_pairs(prev, prow, rows)}


def recl_pairs(prev, prow, rows, ren=None):
    """reclassified() per branch: {(id, 'brand|branch')} — the id's rows moved at that branch. A branch's plain lowest comes from
    its own rows only, so the other branches of the id keep their real price changes (2026-10-16: 쁨 울산점's '♥수목 해피아워♥'
    rows left TA42833F 쥬베룩 스킨 부스터 2cc by a rule, and 7 other 쁨 branches' 149,000 → 250,000 went out of `changes` with it).
    ren ({old id: new id}, carried): the previous rows' ids read as their successors, and a successor counts as an id of both
    builds — what a rename moved (none: the successor carries the old id's history)"""
    if not prev:
        return set()
    old = row_keys_prev(prev, prow, ren)
    # both sides as name → all its ids (a branch can list the same name twice with different prices / ids)
    new = {}
    for r in rows:
        new.setdefault((r["brand"], r["branch"], r["name"]), set()).update(r["keys"].split())
    out = set()
    at = lambda ident, ks: {(k, f"{ident[0]}|{ident[1]}") for k in ks}
    for ident, n in new.items():
        o = old.get(ident)
        if o is not None:
            out |= at(ident, o ^ n)
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
            out |= at(ident, new.get(ident[:3], set()) | old.get(ident[:3], set()))
    # a row at the same price that joined or left an id while a same-named row at another price kept it (검증 8차: 톡스앤필 건대점
    # '[울써마지 옵션] 얼굴전체 더모톡신' 190,000 became an add-on and left T2976BFB; the 290,000 row of the same name kept it, so the
    # name-level sets above were equal and the key read as a rise 190,000 → 290,000)
    wk, nk = defaultdict(set), defaultdict(set)
    for r in prow:
        wk[(pbrand[pb[r[0]][0]], ps[pb[r[0]][1]], ps[r[2]], int(r[3]))].update(read_ids(ps[r[7]], ren))
    for r in rows:
        nk[(r["brand"], r["branch"], r["name"], int(r["sale"]))].update(r["keys"].split())
    for ident in wk.keys() & nk.keys():
        out |= at(ident, wk[ident] ^ nk[ident])
    # a row a rule took back (came_back: the previous build dropped it for its words) joined its ids by that rule, not by a
    # clinic: where it moves what the id shows at that branch. A plain price moves the plain lowest (trend, `changes`); any price
    # moves the alerts' numbers when it is the branch's first row of the id or below its other rows — the app's watch and alerts
    # and the alert Worker count the listed prices with the specials (app/app.js watchNow; 검수 2026-10-16: 41 ids read as
    # '파는 지점이 늘면' / '새 최저가' from 첫 방문 prices the clinics had shown all along, T2545EC1 79,000 → 29,900)
    back = came_back(prev, prow, rows)
    if back:
        ident = lambda r: (r["brand"], r["branch"], r["name"], int(r["sale"]))
        rest = {}                        # (id, brand, branch) → its lowest listed price without the rows taken back
        for r in rows:
            if ident(r) not in back:
                for k in r["keys"].split():
                    rest[(k, r["brand"], r["branch"])] = min(rest.get((k, r["brand"], r["branch"]), 10 ** 12), int(r["sale"]))
        for r in rows:
            if ident(r) in back:
                out |= at(ident(r), [k for k in r["keys"].split()
                                     if G.regular(r) or int(r["sale"]) < rest.get((k, r["brand"], r["branch"]), 10 ** 12)])
    # only ids that exist in both builds have a history to protect (a new id starts empty, a gone id is in keymap — its successor
    # carries it only where the rename moved no row: carried)
    before = {k[0] for k in prev.get("keys", [])} | set((ren or {}).values())
    return {x for x in out if x[0] in before}


def same_collection_moved(prev, prow, best, date, ren=None):
    """a later build of the collection the previous data.json was built from: {(id, 'brand|branch')} whose plain lowest is not
    the earlier build's. That one is counted from the previous rows by the rule they were built with (meta.plainRules), without
    the rows whose event was over by `date` (clean.py drops those the same way). Both builds read the same collection, so the
    difference is the rules' — also where recl_pairs cannot match the row to the earlier one: a rule that renames it (a group
    title read into the name, two rows merged into one) or drops it and adds it back under another name (검증 2026-10-16: 블리비
    명동점 '[이벤트] 레이저토닝 10회' 149,000, renamed and untagged, read as 190,000 → 149,000 while 유앤아이 구로점 kept
    T6126905 in meta.recl). Only the earlier build's branches (a branch or chain added to the collection later is new, not
    moved) and ids (recl_pairs; ren as there). best: this build's 'id|brand|branch' → plain lowest."""
    ps, pb, pbrand = prev["s"], prev["branches"], [b[0] for b in prev["meta"]["brands"]]
    pkey = [f"{pbrand[b[0]]}|{ps[b[1]]}" for b in pb]
    rule, was = prev_rule(prev), {}
    for r in prow:
        until = ps[r[10]] or ""
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", until) and until < date:
            continue
        if G.plain(*prev_cond(prev, r), rule=rule):
            for k in read_ids(ps[r[7]], ren):
                kk = f"{k}|{pkey[r[0]]}"
                was[kk] = min(was.get(kk, 10 ** 12), int(r[3]))
    branch, ids = set(pkey), {k[0] for k in prev.get("keys", [])} | set((ren or {}).values())
    out = set()
    for kk in best.keys() | was.keys():
        k, b = kk.split("|", 1)
        if b in branch and k in ids and best.get(kk) != was.get(kk):
            out.add((k, b))
    return out


def rule_pairs(prev, prow, rows, best, collected, date, ren=None):
    """{(id, 'brand|branch')} the rules moved in this build: recl_pairs, and on a later build of the collection the previous
    data.json was built from (meta.updated) also same_collection_moved (ren: as in recl_pairs)"""
    out = recl_pairs(prev, prow, rows, ren)
    if prev and prev["meta"].get("updated") == collected:
        out |= same_collection_moved(prev, prow, best, date, ren)
    return out


def carried(prev, prow, rows, best, collected, date, keymap):
    """the ids the previous data.json had that this build renamed (keymap, key_map) without moving a row: rule_pairs with the
    previous rows' ids read as their successors finds the successor at no branch. Its successor carries its price history
    (meta.keymap mark 1: trend) unless it is regrouped (meta.recl — a merge into an id the previous file had always is, where the
    old rows joined it). A rename that moved rows anywhere starts again, as an id whose rows a rule moved does
    (meta.recl): '바디리니어지 100샷' T0D1AF59 → T11F7B37 (2026-10-19) lost 밴스 여의도's twin rows — the very rows whose going
    changed the id"""
    if not prev:
        return set()
    had = {k[0] for k in prev.get("keys", [])}
    ren = {k: v[0] for k, v in keymap.items() if v[0] and k in had}
    if not ren:
        return set()
    moved = {k for k, _ in rule_pairs(prev, prow, rows, best, collected, date, ren)}
    return {k for k, to in ren.items() if to not in moved}


def carried_before(before, carry):
    """the snapshot `changes` is counted from (and the review queue's and held prices' 'before'), with each carried old id's
    prices (carry {old id: new id}: meta.keymap marks, carried) under its successor too — at a branch two of them share, the
    lowest. Without it a renamed id has no 'before': on 10-18 '바디리니어지 500샷' (T2A7857E → T403E6F2) left 닥터에버스 마곡점·인천점·
    천호점·수원인계점 → 175,000 and 송도점 → 200,000 out of `changes`"""
    out = dict(before)
    for kk, v in before.items():
        k, place = kk.split("|", 1)
        if k in carry:
            nk = f"{carry[k]}|{place}"
            out[nk] = min(out.get(nk, v), v)
    return out


def carried_skip(skip, carry):
    """regrouped() with what the rules moved for a carried old id (an earlier build of the collection) at its successor too"""
    ids, pairs = skip
    return ids | {carry[k] for k in ids if k in carry}, pairs | {(carry[k], b) for k, b in pairs if k in carry}


def prev_recl_branches(prev):
    """meta.reclBranches of the previous data.json as {date: {id: {'brand|branch', …}}}; {} for a file without the field"""
    pm = (prev or {}).get("meta", {})
    if "reclBranches" not in pm:
        return {}
    ps, pbrand = prev["s"], [b[0] for b in pm["brands"]]
    pk = [f"{pbrand[b[0]]}|{ps[b[1]]}" for b in prev["branches"]]
    return {d: {k: {pk[i] for i in ix} for k, ix in m.items()} for d, m in pm["reclBranches"]}


def recl_branches(prev, collected, recl, pairs_now, whole_now, bkeys):
    """meta.reclBranches for this build, one entry per meta.recl entry: [date, {id: [branch index, …]}] — the branches where the
    rows of the id moved (recl_pairs). An id of that meta.recl date without an entry moved at every branch: an id that came back
    (whole_now), an id an earlier build of that date stored without branches (a data.json from before this field: the id-level
    fallback), or one of a branch this build does not have. A later build of the same collection keeps what the earlier ones
    found, as meta.recl does (the snapshot it counts from is still the older one). bkeys: this file's branches as 'brand|branch'."""
    old = prev_recl_branches(prev)
    was = {d: set(ks) for d, ks in ((prev or {}).get("meta", {}).get("recl") or [])}
    now = defaultdict(set)
    for k, b in pairs_now:
        now[k].add(b)
    bi = {b: i for i, b in enumerate(bkeys)}
    out = []
    for d, ks in recl:
        m, have = old.get(d), {}
        for k in ks:
            if d == collected and k in whole_now:
                continue
            if k in was.get(d, ()):
                if m is None or k not in m:
                    continue            # an earlier build of that date moved it at every branch
                bs = set(m[k])
            else:
                bs = set()
            if d == collected:
                bs |= now.get(k, set())
            if bs and bs <= bi.keys():
                have[k] = sorted(bi[b] for b in bs)
        out.append([d, have])
    return out


def regrouped(recl, rb, since, bkeys):
    """what the rules moved after the snapshot dated `since`: (ids moved at every branch, {(id, 'brand|branch')}) from meta.recl and
    meta.reclBranches (recl_branches)"""
    per = {d: m for d, m in rb}
    ids, pairs = set(), set()
    for d, ks in recl:
        if d <= since:
            continue
        m = per.get(d, {})
        for k in ks:
            if k in m:
                pairs |= {(k, bkeys[i]) for i in m[k]}
            else:
                ids.add(k)
    return ids, pairs


def price_changes(before, best, skip_ids, skip_pairs, kid, bi):
    """data.json changes: [key index, branch index, before, after] for each 'key|brand|branch' whose plain lowest differs from the
    snapshot `before` — except where the rules moved its rows (regrouped): the whole id, or only that branch of it"""
    out = []
    for kk, after in best.items():
        b = before.get(kk)
        if b and b != after:
            k, brand, branch = kk.split("|")
            if k in kid and k not in skip_ids and (k, f"{brand}|{branch}") not in skip_pairs:
                out.append([kid[k], bi[(brand, branch)], b, after])
    return out


def group_moved(prev, prow, rows, gid, since=None):
    """(brand|branch, group key, price) of rows that are in both builds at the same price but now count for their automatic
    group's regular price when they did not, or the other way round (2026-10-15: '[울써마지 옵션] 얼굴전체 더모톡신' 190,000 became
    an add-on, and the group read it as a price rise 190,000 → 290,000 at 톡스앤필 건대점). A change whose old or new price is such
    a row is the rules', not the clinic's. The previous rows count by the plain rule of the snapshot the changes are counted from
    (since = its date; 2026-10-16: a '토요일이벤트' price left the regular price without changing). Not by the previous file's own
    rule: a second build of the same collection has a previous file of the new rule but still counts from the older snapshot,
    and would list the moved prices as '없어짐'. What a tag or add-on change moved, a second build cannot see here (its previous
    file already has the new tags): it reads it from meta.reclGroups (group_memory)."""
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
    for ident in came_back(prev, prow, rows):
        was[ident] = False          # a rule took it back (not in the previous file): it did not count there
    return {(f"{i[0]}|{i[1]}", G.comp(i[2]), i[3]) for i, c in now.items() if i in was and was[i] != c}


def group_memory(prev, collected, since):
    """what the earlier builds of this collection found the rules moved for the automatic groups (meta.reclGroups of the
    previous data.json): {(brand|branch, group key, price)} — or None when the previous file is of this collection but cannot
    say (a file from before this field, or one counted from another snapshot). A later build of the same collection compares
    with the same older snapshot, but its previous file already has the new tags, so group_moved finds nothing there (2026-10-16:
    #83 tagged 쁨 울산점's '♥수목 해피아워♥' rows; the build after it kept them out of achg, the next one listed 79,000 → 100,000 and
    four more as price rises). A previous file of another collection: set() (its moves were counted from an older snapshot)."""
    pm = (prev or {}).get("meta", {})
    if not prev or pm.get("updated") != collected:
        return set()
    mem = pm.get("reclGroups")
    if not mem or mem[0] != collected or mem[1] != since:
        return None
    pbrand = [b[0] for b in pm["brands"]]
    pk = [f"{pbrand[b[0]]}|{prev['s'][b[1]]}" for b in prev["branches"]]
    return {(pk[b], k, p) for k, b, p in mem[2] if 0 <= b < len(pk)}


def still_listed(rows, gid, gkeys, before):
    """for a same-collection build whose previous file has no meta.reclGroups (group_memory None): the snapshot's regular
    prices that are no longer a regular price of their group at that branch but are still sold there under the same name
    (group key) — now with a condition tag, as an add-on or outside any group. {(brand|branch, group key, price)}. Such a
    'change from' or '없어짐' is a reclassification, as group_moved counts a same-name same-price row whose counted state
    changed; only the 'before' side can be read from the snapshot (a row that now counts is not in it: achg_moved). It reads
    prices only: a clinic that made its old regular price a conditional one of the same name between the collections is read
    as a rule's move too (none in that file: each was a tag or add-on change of the same collection). before = the snapshot
    {group key: {brand|branch: price}} (2026-10-16: main's file listed 쁨 울산점 79,000 → 100,000 and four more, 톡스앤필
    건대점 190,000 → 290,000, '포텐자펌핑 팁' 50,000 at 톡스앤필 부천점 as gone)"""
    counted, sold = defaultdict(set), defaultdict(set)
    for r, g in zip(rows, gid):
        b, p = f"{r['brand']}|{r['branch']}", int(r["sale"])
        if g >= 0 and G.regular(r):
            counted[(b, gkeys[g])].add(p)
        else:
            sold[(b, G.comp(r["name"]))].add(p)
    return {(b, k, p) for k, m in before.items() for b, p in m.items() if p not in counted[(b, k)] and p in sold[(b, k)]}


def achg_moved(prev, prow, rows, gid, gkeys, bkeys, collected, since, before, new):
    """{(brand|branch, group key, price)} the rules moved for the automatic groups since the snapshot `since` (before = that
    snapshot): group_moved, and on a later build of the same collection what the earlier ones found (group_memory).
    A previous file of this collection that cannot say (group_memory None — in practice main's file of 2026-10-16, built before
    meta.reclGroups): still_listed for the 'before' side, and every '새로 생김' (new = achg new [[gid, branch, price]] of this
    build, chains new as a whole left out). A row a rule moved into a group is not in the snapshot, so a new price cannot be
    told from one the rules made, and that file's 38 all were the rules' (검토 2026-10-16: 37 블리비 rows lost a wrong '평일 낮'
    tag in a rebuild of the collection, 1295f2a, listed as new from the next rebuild on; 쁨 부평점 lost '첫 방문'). A real new
    price of that week is left out with them — once: meta.reclGroups keeps them out of the later builds of the collection,
    and the next collection counts from this one's snapshot"""
    moved = group_moved(prev, prow, rows, gid, since)
    mem = group_memory(prev, collected, since)
    if mem is None:
        mem = still_listed(rows, gid, gkeys, before) | {(bkeys[b], gkeys[g], p) for g, b, p in new}
    return moved | mem


def recl_groups(moved, collected, since, before, bkeys):
    """meta.reclGroups: [collection date, snapshot date, [[group key, branch index, price], …]] — only group keys the snapshot
    has (no other key can have an achg entry against it, on this build or a later one of the same collection)"""
    bix = {b: i for i, b in enumerate(bkeys)}
    return [collected, since, sorted([k, bix[b], p] for b, k, p in moved if k in before and b in bix)]


def achg_keep(chg, new, gone, moved, bkeys, gkeys):
    """achg without the entries the rules made: a change whose before or after price is a moved row's (2026-10-15: '[울써마지
    옵션] 얼굴전체 더모톡신' 190,000 became an add-on — not a rise 190,000 → 290,000), and the same for '새로 생김' / '없어짐': a row
    the rules moved into or out of a group is not a new or a gone price (검증 7차). gone is not cut here (GONE_MAX after)"""
    at = lambda g, b, p: (bkeys[b], gkeys[g], p) in moved
    return ([c for c in chg if not at(c[0], c[1], c[2]) and not at(c[0], c[1], c[3])], [c for c in new if not at(*c)],
            [c for c in gone if (bkeys[c[1]], c[3], c[2]) not in moved])


def sex_word(label):
    """여성 / 남성 / '' from a label in any of the clinics' forms (NFKC: one clinic writes 女 as the compatibility letter U+F981)"""
    m = re.search(r"여성|여자|\(여\)|女|남성|남자|\(남\)|男", unicodedata.normalize("NFKC", label or ""))
    return "" if not m else "여성" if m.group() in ("여성", "여자", "(여)", "女") else "남성"


def bare_label(label):
    """a label without its sex words and spaces: '여성 女 브라질리언 제모 5회' and '여성 브라질리언 제모 5회' are the same"""
    return re.sub(r"\s+|여성|여자|남성|남자|\((?:여|남)\)|女|男", "", unicodedata.normalize("NFKC", label or ""))


def key_map(prev, prow, rows, allk, kept=()):
    """old comparison id → [new id or "", old label] for ids the previous data.json had and this one doesn't (a taxonomy fix
    or renamed options change an auto key's signature). The app moves saved carts, favourites and alerts with it, and shows
    the old label for an id that has no successor instead of a bare 'T1234567'. Same row (brand, branch, name) decides: the
    new key that at least half of the old key's rows now carry. Older entries are kept and followed (A → B → C).
    A third item 1 (2026-10-19): the successor carries the old id's price history (trend) unless it is regrouped (meta.recl) —
    the old ids in kept (carried: the rename moved no row), and an older entry only while every rename on its way did (A → B
    marked, B → C not: A → C unmarked)"""
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
        out[k] = [to, plabel.get(k, k)] + ([1] if to and k in kept else [])
    marked = lambda e: len(e) > 2 and e[2] == 1
    for k, e in (prev["meta"].get("keymap") or {}).items():
        if k in now or k in out:
            continue
        to, label, keep, hops = e[0], e[1], marked(e), 0
        while to and to not in now and hops < 10:
            e = out.get(to, (prev["meta"].get("keymap") or {}).get(to, ["", ""]))
            to, keep, hops = e[0], keep and marked(e), hops + 1
        out[k] = [to, label] + ([1] if keep else []) if to in now else ["", label]
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
    check_family_names(VFAM)
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
    live = {k[0] for k in ALLK}
    # the ids whose rows the rules moved, per branch; a revived id at every branch
    pairs_now = {x for x in rule_pairs(prev_data, prev_rows, rows, best, collected, a.date) if x[0] in live}
    whole_now = revived & live
    recl_now = {k for k, _ in pairs_now} | whole_now
    # regrouped ids per date (newest last, 12 kept); the app re-bases alerts on them and the trend restarts there
    recl = [x for x in ((prev_data or {}).get("meta", {}).get("recl") or []) if x[0] != collected]
    same_day = next((x[1] for x in ((prev_data or {}).get("meta", {}).get("recl") or []) if x[0] == collected), [])
    if recl_now or same_day:
        recl.append([collected, sorted(set(same_day) | recl_now)])
    recl = recl[-12:]
    bkeys = [f"{BRANDS[b[0]][0]}|{s[b[1]]}" for b in branches]
    # … and at which branches (meta.reclBranches): only those branches' price changes are the rules'
    reclb = recl_branches(prev_data, collected, recl, pairs_now, whole_now, bkeys)
    # old id → new id (meta.keymap), marked where the successor carries the old id's price history (a rename that moved no row):
    # the trend, and the snapshot changes are counted from (carried_before)
    keymap = key_map(prev_data, prev_rows, rows, ALLK)
    keymap = key_map(prev_data, prev_rows, rows, ALLK, carried(prev_data, prev_rows, rows, best, collected, a.date, keymap))
    carry = {k: v[0] for k, v in keymap.items() if len(v) > 2 and v[2] == 1}
    before = carried_before(prev, carry)
    # changes against the previous snapshot (for the review queue; counted again with the held prices after it, hold_back)
    changes, prev_date, skip, kid = [], "", (set(), set()), {k[0]: i for i, k in enumerate(ALLK)}
    if prev_files:
        prev_date = os.path.basename(prev_files[-1])[:10]
        # every id regrouped after that snapshot (this build or an earlier build of a later day / the same day): at the
        # branches where its rows moved, its 'change' since the snapshot is a new mix of rows, not a price change
        skip = carried_skip(regrouped(recl, reclb, prev_date, bkeys), carry)
        changes = price_changes(before, best, *skip, kid, bi)
    checks = price_checks(rows, a.date)
    KB, CONCERNS = knowledge.export()   # treatment knowledge base + concern taxonomy (knowledge/)
    vp = os.path.join(ROOT, "data2", "variants.json")
    vj = json.load(open(vp, encoding="utf-8")) if os.path.exists(vp) else {"keys": [], "families": []}
    KB["specs"] = spec_keys(KB["specs"], vj["keys"], {k[0] for k in ALLK}, vj.get("families", []), {k[0]: k[2] for k in ALLK})
    auto = G.snapshot(gkeys, groups, low_reg, bkeys)
    achg, anew, agone, aprev, asnap = G.changes_since(auto, collected, gkeys, bkeys, glob.glob(os.path.join(hist, "*.auto.json.gz")))
    # a chain the previous snapshot did not have is new as a whole: its prices are not '새로 생김' one by one (2026-10-15, 개선 보고서
    # E9 — 밴스·유앤아이·데이뷰·닥터에버스·셀린 filled the list on 10-14; a chain back after a gap too, C3 검토). Read before this
    # collection's snapshots are written: only older dates count here, and for meta.brandFirst a chain first seen now gets this date
    days = brand_days(hist, collected)
    anew = [c for c in anew if chain_was_there(days, aprev, bkeys[c[1]].split("|")[0])]
    moved = achg_moved(prev_data, prev_rows, rows, gid, gkeys, bkeys, collected, aprev, asnap, anew)
    reclg = recl_groups(moved, collected, aprev, asnap, bkeys)
    achg, anew, agone = achg_keep(achg, anew, agone, moved, bkeys, gkeys)
    agone = agone[:G.GONE_MAX]
    review = review_queue(rows, out_rows, bi, bkeys, gid, achg, changes, s, ALLK, name_was(prev_data), prev_held(prev_data),
                          (before, asnap, gkeys))
    # what the rows waiting for review move is held until approved: those places count with the price before it (or a shown row
    # below it) — in this collection's snapshots and so in changes and achg: the held price is no change, '새로 생김', trend point
    # or next week's baseline. Dated by the collection, not the build: a rebuild without scraping on a later day rewrites that
    # collection's snapshot instead of adding an observation that never happened — and, counted from the same older snapshot,
    # holds the same prices (a second build of the collection gives the same files)
    hk, hg = held(rows, out_rows, gid, best, low_reg)
    snap, auto = hold_back(best, hk, before, skip), G.held_back(auto, hg, asnap, gkeys, bkeys, moved)
    changes = price_changes(before, snap, *skip, kid, bi)
    achg, anew = held_achg(achg, anew, hg, auto, moved, gkeys, bkeys)
    save_snapshot(hist, collected, snap)
    G.write_snapshot(hist, collected, auto)
    data = {
        # updated = the collection (the day most branches were read; what the app calls '수집'); built = the build date (expired events and the weekly
        # snapshot are counted from it)
        "meta": {"updated": collected, "built": a.date, "prev": prev_date, "review": review, "about": about(), "rows": len(out_rows), "branches": len(branches),
                 "brands": [list(b) for b in BRANDS], "kinds": KINDS, "cats": CATS,
                 "fam": VFAM, "kb": KB, "concerns": CONCERNS, "checks": checks, "keymap": keymap, "recl": recl, "reclBranches": reclb,
                 "reclGroups": reclg,
                 "labelRules": labels.RULES,
                 "plainRules": G.rule_marks((prev_data or {}).get("meta", {}).get("plainRules"), collected),
                 "brandFirst": first_seen(days, [b for b, *_ in BRANDS], {r["brand"] for r in rows}, collected)},
        "branches": branches, "cols": columns(out_rows), "colDelta": COL_DELTA, "keys": [list(k) for k in ALLK], "changes": changes, "s": s,
        "trend": trend(hist, collected, [r for r, o in zip(rows, out_rows) if not o[13]], {k: d for d, ks in recl for k in ks}, carry),
        "groups": [[S(x[0])] + x[1:] for x in groups], "bstat": bstat,
        "achg": {"prev": aprev, "chg": achg, "new": anew, "gone": [[S(x[0]), x[1], x[2]] for x in agone]},
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    txt = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    assert rows_of(json.loads(txt)) == out_rows, "price columns do not turn back into the same rows"
    open(a.out, "w", encoding="utf-8", newline="\n").write(txt)
    home_txt = homedata.write(a.out, txt)        # app/home.json: the home screen's rows, read first (round-2 O2)
    # app/data-meta.json: version, checksum, branch states, changed rows (not the ones a rule took back), home.json's checksum
    datameta.write_meta(a.out, txt, prev_txt, home_txt, back=came_back(prev_data, prev_rows, rows))
    nogeo = [s[b[1]] for b in branches if b[3] is None]
    print(f"wrote {a.out}: {len(txt) / 1e6:.2f} MB | rows {len(out_rows)} | branches {len(branches)} (no map position: {len(nogeo)})"
          f" | strings {len(s)} | changes vs {prev_date or '-'}: {len(changes)} | review pending {review} | source re-checks matched {len(checks)}")
    if nogeo:
        print("  no position:", nogeo)


if __name__ == "__main__":
    main()
