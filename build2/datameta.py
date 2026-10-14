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
              removed: [[brand, branch, name, price]], counts: {price, added, removed}} — lists capped at CAP each
Only what was really observed is listed: a row is matched by brand + branch + option name + price kind.
"""
import argparse, datetime, hashlib, json, os, sys
from collections import defaultdict

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
    """{(brand, branch, name, kind): sorted prices} for the listed (clinic-written) prices"""
    s, brands = data["s"], [b[0] for b in data["meta"]["brands"]]
    br = [(brands[b[0]], s[b[1]]) for b in data["branches"]]
    out = defaultdict(list)
    for r in rows_of(data):
        out[(br[r[0]][0], br[r[0]][1], s[r[2]], r[5])].append(r[3])
    return {k: sorted(v) for k, v in out.items()}


def version_of(txt_bytes, updated):
    return f"{updated}.{hashlib.sha256(txt_bytes).hexdigest()[:8]}"


def changes(prev, cur, prev_version):
    a, b = resolved(prev), resolved(cur)
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
    return {"from": prev_version, "price": price[:CAP], "added": added[:CAP], "removed": removed[:CAP],
            "counts": {"price": len(price), "added": len(added), "removed": len(removed)}}


def build(txt, prev_txt=None, home_txt=None):
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
            meta["changes"] = changes(prev, data, version_of(prev_txt.encode("utf-8"), prev["meta"]["updated"]))
        except (ValueError, KeyError, IndexError, TypeError) as e:     # an older layout: no change list, never a wrong one
            print(f"  data-meta: previous data.json not comparable ({e.__class__.__name__}); no change list")
    return meta


def write_meta(data_path, txt, prev_txt=None, home_txt=None):
    meta = build(txt, prev_txt, home_txt)
    out = os.path.join(os.path.dirname(data_path), "data-meta.json")
    open(out, "w", encoding="utf-8", newline="\n").write(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
    c = meta.get("changes", {}).get("counts")
    print(f"wrote {out}: version {meta['version']} | {meta['bytes'] / 1e6:.2f} MB | branches {meta['branches']} (stale {meta['stale']})"
          + (f" | changes price {c['price']} added {c['added']} removed {c['removed']}" if c else " | no previous data"))
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
