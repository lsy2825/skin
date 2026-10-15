"""app/data.json → app/home.json: the home screen's prices, read first on a phone with no saved copy (round-2 O2,
docs/PERFORMANCE.md). The full file is ~1.9 MB gzipped; the home screen needs the rows of about 90 comparison ids.

home.json has data.json's layout (meta, branches, cols + colDelta, keys, s, groups, changes, achg), so the app runs the
same code on it. It holds EVERY row of the ids the home screen can show — so each card's median, range and branch count
are the ones the full file gives, for any region, brand, VAT or location setting — and no other row:
  ids        the 6 sold at the most branches (인기), the main option of the 6 biggest families in each category (category
             tabs), the main option of the 80 biggest families outside 기타 (죠미의 오늘의 발견), the ids in `changes`
  families   only those whose main option is shipped, with their shipped options
  meta.partial  {rows, keys: counts in the full file, cats: every key category in the full file's order, fn: per shipped
             family the number of branches selling any of its options in the full file} — what the home screen would
             otherwise count from rows it does not have
Selection and counts follow app.js applyData / views.home (stable sorts, ties in file order); tests/homedata.test.js
checks home.json against data.json. data-meta.json carries home.json's size and SHA-256 (`home`), so the app takes it
only from the same build as the data.json it downloads next.
"""
import json, re
from collections import defaultdict

POPULAR, PER_CAT, FINDS = 6, 6, 80


def rows_of(data):
    cols = [list(c) for c in data["cols"]]
    for f in data.get("colDelta", []):
        acc = 0
        for j, d in enumerate(cols[f]):
            acc += d
            cols[f][j] = acc
    return [list(r) for r in zip(*cols)]


def columns(rows, n_cols, delta):
    cols = [[r[f] for r in rows] for f in range(n_cols)]
    for f in delta:
        prev = 0
        for j, v in enumerate(cols[f]):
            cols[f][j], prev = v - prev, v
    return cols


def families(data, kbr):
    """app.js applyData FAM: options present in keys; n = branches selling any option; main = the option sold at the most
    branches among those not ending in 'N회' (first one on ties); cat = the family's compare category or main's"""
    KI = {k[0]: i for i, k in enumerate(data["keys"])}
    size = lambda kid: len(kbr.get(kid, ()))
    out = []
    for fi, f in enumerate(data["meta"]["fam"]):
        vs = [v for v in f[2] if v[0] in KI]
        if not vs:
            continue
        n = len(set().union(*[kbr.get(v[0], set()) for v in vs]))
        pool = [v for v in vs if not re.search(r"\d+회$", v[1])] or vs
        main = pool[0]
        for v in pool[1:]:
            if size(v[0]) > size(main[0]):
                main = v
        out.append({"fi": fi, "n": n, "main": main[0], "cat": (f[3] if len(f) > 3 else "") or data["keys"][KI[main[0]]][1]})
    return out


def build(data):
    s, keys = data["s"], data["keys"]
    rows = rows_of(data)
    krows, kbr = defaultdict(list), defaultdict(set)
    for j, r in enumerate(rows):
        ks = s[r[7]]
        if ks:
            for kid in ks.split(" "):
                krows[kid].append(j)
                kbr[kid].add(r[0])
    F = families(data, kbr)
    by_n = sorted(F, key=lambda f: -f["n"])                                   # stable: ties keep file order (JS sort)
    want = [k[0] for k in sorted(keys, key=lambda k: -len(kbr.get(k[0], ())))[:POPULAR]]
    cats = list(dict.fromkeys(k[1] for k in keys))
    for c in cats:
        want += [f["main"] for f in by_n if f["cat"] == c][:PER_CAT]
    want += [f["main"] for f in by_n if f["cat"] != "기타"][:FINDS]
    want += [keys[c[0]][0] for c in data.get("changes", [])]
    want = set(want)
    # rows of those ids, in file order; ids and families in file order
    keep = sorted({j for kid in want for j in krows.get(kid, [])})
    old_i = [i for i, k in enumerate(keys) if k[0] in want]
    new_k = [keys[i] for i in old_i]
    kmap = {o: i for i, o in enumerate(old_i)}
    ship = {f["fi"]: f for f in F if f["main"] in want}
    fam = []
    fn = []
    for fi, f in enumerate(data["meta"]["fam"]):
        if fi in ship:
            g = list(f)
            g[2] = [v for v in f[2] if v[0] in want]
            fam.append(g)
            fn.append(ship[fi]["n"])
    # groups the kept rows and the auto-group changes point at
    achg = data.get("achg") or {}
    gwant = sorted({rows[j][9] for j in keep if rows[j][9] is not None and rows[j][9] >= 0}
                   | {x[0] for x in achg.get("chg", [])} | {x[0] for x in achg.get("new", [])})
    gmap = {g: i for i, g in enumerate(gwant)}
    # strings: interned again, only what the kept parts use
    ns, ni = [], {}

    def S(i):
        x = s[i]
        if x not in ni:
            ni[x] = len(ns)
            ns.append(x)
        return ni[x]
    branches = [[b[0], S(b[1]), S(b[2]), b[3], b[4], S(b[5]), S(b[6]), S(b[7]), S(b[8])] + b[9:] for b in data["branches"]]
    out_rows = []
    for j in keep:
        r = list(rows[j])
        for f in (2, 6, 7, 10, 11, 14):
            r[f] = S(r[f])
        r[9] = gmap[r[9]] if r[9] is not None and r[9] >= 0 else r[9]
        out_rows.append(r)
    pos = {j: i for i, j in enumerate(keep)}
    meta = {k: data["meta"][k] for k in ("updated", "built", "prev", "review", "about", "brands", "kinds", "cats", "recl", "brandFirst") if k in data["meta"]}
    meta.update({"rows": len(out_rows), "branches": len(branches), "fam": fam,
                 "checks": [[pos[c[0]]] + c[1:] for c in data["meta"].get("checks", []) if c[0] in pos],
                 "partial": {"rows": len(rows), "keys": len(keys), "cats": cats, "fn": fn}})
    groups = data.get("groups") or []
    home = {"meta": meta, "branches": branches, "cols": columns(out_rows, len(data["cols"]), data.get("colDelta", [])),
            "colDelta": data.get("colDelta", []), "keys": new_k,
            "changes": [[kmap[c[0]]] + c[1:] for c in data.get("changes", [])],
            "groups": [[S(groups[g][0])] + groups[g][1:] for g in gwant],
            "achg": {"prev": achg.get("prev", ""), "chg": [[gmap[x[0]]] + x[1:] for x in achg.get("chg", [])],
                     "new": [[gmap[x[0]]] + x[1:] for x in achg.get("new", [])],
                     "gone": [[S(x[0])] + x[1:] for x in achg.get("gone", [])]},
            "s": ns}
    return home


def write(data_path, txt):
    """data.json text → app/home.json next to it; returns home.json's text"""
    import os
    home = build(json.loads(txt))
    htxt = json.dumps(home, ensure_ascii=False, separators=(",", ":"))
    out = os.path.join(os.path.dirname(data_path), "home.json")
    open(out, "w", encoding="utf-8", newline="\n").write(htxt)
    print(f"wrote {out}: {len(htxt.encode('utf-8')) / 1e6:.2f} MB | rows {home['meta']['rows']} of {home['meta']['partial']['rows']}"
          f" | ids {len(home['keys'])} | families {len(home['meta']['fam'])}")
    return htxt


if __name__ == "__main__":
    # rebuild home.json for an existing data.json and put its checksum into the data-meta.json beside it — only when that
    # data-meta.json describes this very data.json (appdata.py does both in one go during the weekly build)
    import hashlib, os, sys
    p = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "data.json")
    txt = open(p, encoding="utf-8").read()
    mp = os.path.join(os.path.dirname(p), "data-meta.json")
    m = json.load(open(mp, encoding="utf-8"))
    if m.get("sha256") != hashlib.sha256(txt.encode("utf-8")).hexdigest():
        sys.exit(f"{mp} does not describe {p} (checksum differs): run build2/appdata.py instead")
    htxt = write(p, txt)
    m["home"] = {"bytes": len(htxt.encode("utf-8")), "sha256": hashlib.sha256(htxt.encode("utf-8")).hexdigest(), "rows": json.loads(htxt)["meta"]["rows"]}
    open(mp, "w", encoding="utf-8", newline="\n").write(json.dumps(m, ensure_ascii=False, separators=(",", ":")))
    print(f"updated {mp}: home {m['home']['bytes'] / 1e6:.2f} MB")
