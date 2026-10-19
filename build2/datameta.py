"""app/data.json → app/data-meta.json: the small file the app reads first (docs/PRICE_SYNC_ARCHITECTURE.md).

usage: python build2/datameta.py [--data app/data.json] [--prev OLD_data.json] [--out app/data-meta.json]
       (build2/appdata.py calls write_meta() itself, with the data.json it is about to replace as `prev`)

data-meta.json:
  schema     1 = the data.json layout the app understands (meta, branches, cols + colDelta, keys, s …); the app refuses others
  version    "<updated>.<first 8 hex of sha256>" — the app downloads data.json only when this differs from its saved copy
  updated    data date (YYYY-MM-DD) · built: build time (UTC ISO)
  bytes      size of data.json (uncompressed) — the app's download progress is received / bytes
  sha256     of data.json — the app checks it before saving the file on the phone
  rows, branches, verified, stale   counts the app checks after reading (stale = branch kept from an earlier run because
             this run's collection failed)
  brands     per brand: [name, branches, verified, stale, oldest verified date, newest verified date]
  home       {bytes, sha256, rows} of app/home.json (build2/homedata.py: the home screen's rows, read first on a phone with
             no saved copy) — the app takes home.json only when its checksum is this one, i.e. from the same build
  changes    price rows that differ from the previous data.json (resolved names, not indexes):
             {from: previous version, price: [[brand, branch, name, before, after]], added: [[brand, branch, name, price]],
              removed: [[brand, branch, name, price]], counts: {price, added, removed, new_chain}, new_chains: [[brand, rows]]}
             — lists capped at CAP each. A brand the previous data.json did not have at all is a new chain: its rows are counted in
             new_chains, not listed as added (개선 보고서 E9; the alert Worker and the 가격 변동 screen read 'added'). A row a rule
             took back (build2/appdata.py came_back: the previous build dropped it for its words — 2026-10-16, 391 닥터에버스 prices
             under a '※…' heading) is not listed as added either: no clinic added it; nor is a row a rule only renamed (the same
             last part after ' · ' at the same price at the branch on the other side: build2/clean.py shared_titles).
             A price waiting for review (row[13] = 1: it moved ≥90% or ×10, build2/appdata.py review_queue — the app keeps it out
             until someone approves it) is not listed, nor anything else of that name at that branch; the build after counts it from
             the price before it (meta.about.review): approved, a change once (also on a rebuild of the same collection), back,
             nothing (2026-10-19: 블리비 대구 동성로점 '얼굴 점빼기(2mm 이하) 개당' 1,000 → 100 was listed while the row was held)
Only what was really observed is listed: a row is matched by brand + branch + option name + price kind.
"""
import argparse, datetime, hashlib, json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
SCHEMA = 1
CAP = 300


def rows_of(data):
    """columns (+ deltas) → row lists; same as appdata.rows_of, kept here so this file has no heavy imports"""
    cols = [list(c) for c in data["cols"]]
    for f in data.get("colDelta", []):
        acc = 0
        for j, d in enumerate(cols[f]):
            acc += d
            cols[f][j] = acc
    return [list(r) for r in zip(*cols)]


def resolved(data):
    """{(brand, branch, name, kind): sorted prices} for the listed (clinic-written) prices — not the ones waiting for review"""
    s, brands = data["s"], [b[0] for b in data["meta"]["brands"]]
    br = [(brands[b[0]], s[b[1]]) for b in data["branches"]]
    out = defaultdict(list)
    for r in rows_of(data):
        if not (len(r) > 13 and r[13]):
            out[(br[r[0]][0], br[r[0]][1], s[r[2]], r[5])].append(r[3])
    return {k: sorted(v) for k, v in out.items()}


def waiting(data):
    """the rows waiting for review (row[13] = 1): {(brand, branch, name, kind): {price: the price before it, or None}} — before =
    the price the build compared it with (meta.about.review, the build's data2/review.csv), None when that list does not say"""
    s, brands = data["s"], [b[0] for b in data["meta"]["brands"]]
    br = [(brands[b[0]], s[b[1]]) for b in data["branches"]]
    said = {}
    for x in ((data["meta"].get("about") or {}).get("review") or []):
        try:
            said[(x["brand"], x["branch"], x["name"], int(x["price"]))] = int(x["before"])
        except (KeyError, ValueError, TypeError):
            pass
    out = defaultdict(dict)
    for r in rows_of(data):
        if len(r) > 13 and r[13]:
            b, n = br[r[0]], s[r[2]]
            out[(b[0], b[1], n, r[5])][r[3]] = said.get((b[0], b[1], n, r[3]))
    return out


def fetched(data):
    """{(brand, branch): collected date} — '' when the build has no date for it"""
    s, brands = data["s"], [b[0] for b in data["meta"]["brands"]]
    return {(brands[b[0]], s[b[1]]): (s[b[7]] if len(b) > 7 and b[7] is not None else "") for b in data["branches"]}


# labels that tell products apart (build2/clean.py KEEP_LABEL): they stay in the name when matching
KEEP_LABEL = r"국산|수입|독일|미국|대표원장|원장|남|여|PKG|패키지|\d"


def version_of(txt_bytes, updated):
    return f"{updated}.{hashlib.sha256(txt_bytes).hexdigest()[:8]}"


def changes(prev, cur, prev_version, back=None):
    """back: {(brand, branch, name, price)} of the rows a rule took back (appdata.came_back) — never 'added'"""
    a, b = resolved(prev), resolved(cur)
    wa, wb = waiting(prev), waiting(cur)
    # a price waiting for review now: nothing of that name at that branch is listed (the price before it stands)
    for k in wb:
        a.pop(k, None)
        b.pop(k, None)
    # one that waited in the previous build stood for the price before it: approved now it is a change from that price (once —
    # also on a rebuild of the collection: `approved` passes the same-date rule below), back at that price it is nothing. A name
    # gone now lists only the prices that were shown; one whose price before the previous file does not say is left out
    approved = set()
    for k, ps in wa.items():
        if k in wb or k not in b:
            continue
        if None in ps.values():
            a.pop(k, None)
            b.pop(k, None)
            continue
        was = a.get(k, [])
        a[k] = sorted(was + [p for p in set(ps.values()) if p not in was])
        if any(p in b[k] for p in ps):
            approved.add(k[:3])
    price, added, removed = [], [], []
    for k in sorted(set(a) | set(b)):
        x, y = a.get(k), b.get(k)
        if x is None:
            added += [[k[0], k[1], k[2], p] for p in y]
        elif y is None:
            removed += [[k[0], k[1], k[2], p] for p in x]
        elif x != y:
            if len(x) == 1 and len(y) == 1:
                price.append([k[0], k[1], k[2], x[0], y[0]])
            else:                                            # several prices under one name: what left / what came
                added += [[k[0], k[1], k[2], p] for p in y if p not in x]
                removed += [[k[0], k[1], k[2], p] for p in x if p not in y]
    # a price still at the branch under the same name — its kind changed (일반 → 구독권), its word breaks, a ' · ' or a leading label
    # ('[옵션] …', '[EVENT] …') changed, or a duplicate row was folded into one written slightly differently — did not come or go: left
    # out of both lists (2026-10-15 — 300 닥터에버스 '1년 무제한' rows and the C1 folds would read as gone and new on the 가격 변동
    # screen and in price alerts). Labels that tell products apart ('[남성]', '[국산]') stay.
    def same(b, br, name, p):
        name = re.sub(r"\[옵션\]", "", name)
        while True:
            m = re.match(r"^\s*\[([^\]]*)\]\s*", name)
            if not m or re.search(KEEP_LABEL, m.group(1)):
                break
            name = name[m.end():]
        return (b, br, re.sub(r"[\s·]+", "", name).casefold(), p)
    before = {same(k[0], k[1], k[2], p) for k, ps in a.items() for p in ps}
    after = {same(k[0], k[1], k[2], p) for k, ps in b.items() for p in ps}
    added = [r for r in added if same(*r) not in before]
    removed = [r for r in removed if same(*r) not in after]
    # an option split off, folded in or renamed by a rule (2026-10-15: the old fold put '여성 … · 가슴 전체' 490,000원 under the 남성 row; an
    # add-on listed on two product pages kept one page's title; 2026-10-19: clean.shared_titles puts the group title in front of an
    # option line several products share — '제모데이 12회 이벤트 …' → '男) 인중 12회 · 제모데이 12회 이벤트 …' — and takes it off again when
    # their prices stop meeting): the same option words at the same price stay at the branch under another heading. A row counts
    # as new / gone only when no row of that branch with the same last part and price is on the other side — one row renamed
    # (1 → 1) as well as one split in several or several folded in one (the rule needed two rows on one side before 2026-10-19,
    # and listed each rename as gone and new)
    tail = lambda b, br, name, p: same(b, br, name.split(" · ")[-1], p)
    tb, ta = Counter(tail(*([k[0], k[1], k[2], p])) for k, ps in a.items() for p in ps), \
        Counter(tail(*([k[0], k[1], k[2], p])) for k, ps in b.items() for p in ps)
    added = [r for r in added if not tb[tail(*r)]]
    removed = [r for r in removed if not ta[tail(*r)]]
    # a branch collected on the same date in both builds has the same prices: what differs there comes from the rules
    da, db = fetched(prev), fetched(cur)
    fresh = lambda r: not (da.get((r[0], r[1])) and da.get((r[0], r[1])) == db.get((r[0], r[1]))) or tuple(r[:3]) in approved
    price, added, removed = [r for r in price if fresh(r)], [r for r in added if fresh(r)], [r for r in removed if fresh(r)]
    added = [r for r in added if tuple(r) not in (back or ())]
    old_brands = {k[0] for k in a}
    new_chain = Counter(r[0] for r in added if r[0] not in old_brands)
    added = [r for r in added if r[0] in old_brands]
    return {"from": prev_version, "price": price[:CAP], "added": added[:CAP], "removed": removed[:CAP],
            "counts": {"price": len(price), "added": len(added), "removed": len(removed), "new_chain": sum(new_chain.values())},
            "new_chains": [[b, n] for b, n in sorted(new_chain.items())]}


def build(txt, prev_txt=None, home_txt=None, back=None):
    data = json.loads(txt)
    raw = txt.encode("utf-8")
    s, brands = data["s"], [b[0] for b in data["meta"]["brands"]]
    st = [(b[0], s[b[7]] if len(b) > 7 and b[7] is not None else "", s[b[8]] if len(b) > 8 and b[8] is not None else "") for b in data["branches"]]
    per = []
    for bi, name in enumerate(brands):
        mine = [x for x in st if x[0] == bi]
        if not mine:
            continue
        dates = sorted(x[1] for x in mine if x[1])
        per.append([name, len(mine), sum(x[2] != "STALE" for x in mine), sum(x[2] == "STALE" for x in mine), dates[0] if dates else "", dates[-1] if dates else ""])
    meta = {"schema": SCHEMA, "version": version_of(raw, data["meta"]["updated"]), "updated": data["meta"]["updated"],
            "built": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
            "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "rows": data["meta"]["rows"], "branches": len(data["branches"]),
            "verified": sum(x[2] != "STALE" for x in st), "stale": sum(x[2] == "STALE" for x in st), "brands": per}
    if home_txt:
        hraw = home_txt.encode("utf-8")
        meta["home"] = {"bytes": len(hraw), "sha256": hashlib.sha256(hraw).hexdigest(), "rows": json.loads(home_txt)["meta"]["rows"]}
    if prev_txt:
        try:
            prev = json.loads(prev_txt)
            meta["changes"] = changes(prev, data, version_of(prev_txt.encode("utf-8"), prev["meta"]["updated"]), back)
        except (ValueError, KeyError, IndexError, TypeError) as e:     # an older layout: no change list, never a wrong one
            print(f"  data-meta: previous data.json not comparable ({e.__class__.__name__}); no change list")
    return meta


def write_meta(data_path, txt, prev_txt=None, home_txt=None, back=None):
    meta = build(txt, prev_txt, home_txt, back)
    out = os.path.join(os.path.dirname(data_path), "data-meta.json")
    open(out, "w", encoding="utf-8", newline="\n").write(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
    c = meta.get("changes", {}).get("counts")
    print(f"wrote {out}: version {meta['version']} | {meta['bytes'] / 1e6:.2f} MB | branches {meta['branches']} (stale {meta['stale']})"
          + (f" | changes price {c['price']} added {c['added']} removed {c['removed']} new-chain rows {c.get('new_chain', 0)}" if c else " | no previous data"))
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(ROOT, "app", "data.json"))
    ap.add_argument("--prev", default="")
    a = ap.parse_args()
    txt = open(a.data, encoding="utf-8").read()
    prev = open(a.prev, encoding="utf-8").read() if a.prev else None
    write_meta(a.data, txt, prev)


if __name__ == "__main__":
    main()
