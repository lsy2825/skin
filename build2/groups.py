"""Automatic comparison groups: the same option (normalized name) sold at several branches.

The 36 hand-made keys (xkeys.py) match one procedure across brands; these groups cover everything else, mostly
branches of one brand selling identically named options (블리비 58 branches share most names), so ranks, branch
price levels, branch-vs-branch comparison and price changes work on ~60% of all rows instead of ~11%.

  group key   xkeys.comp(name) (spaces removed, units unified) — only rows that are not 구독권 / add-ons
  kept when   sold at >= MIN_BRANCHES branches
  regular     kind 일반/고시가 without condition tags (체험가·한정가·평일 낮 … are 'special')
  branch level geometric mean of (branch's lowest regular price / median of the branches' lowest regular prices)
              over groups sold at >= LEVEL_BRANCHES branches; needs >= LEVEL_MIN groups (per category >= CAT_MIN)
"""
import gzip, json, math, os
from collections import Counter, defaultdict
from xkeys import comp

MIN_BRANCHES, LEVEL_BRANCHES, LEVEL_MIN, CAT_MIN, CHEAP_BRANCHES = 3, 8, 10, 5, 5


def regular(r):
    return r["kind"] in ("일반", "고시가") and not r["tags"]


def median(v):
    v = sorted(v)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def build(rows, bi, cats):
    """rows: clean.csv dicts; bi: (brand, branch) -> branch index.
    returns gid per row (-1 = none), groups [[label, cat, branches, median regular, min, max]], gkeys (comp names),
    per-branch stats [reg level, all level, groups used, cheapest-count, sole-cheapest-count, {cat: level}]"""
    key = [comp(r["name"]) if r["kind"] != "구독권" and r["addon"] != "1" else "" for r in rows]
    where = defaultdict(set)
    for r, k in zip(rows, key):
        if k:
            where[k].add(bi[(r["brand"], r["branch"])])
    keep = sorted(k for k, v in where.items() if len(v) >= MIN_BRANCHES)
    gi = {k: i for i, k in enumerate(keep)}
    gid = [gi.get(k, -1) for k in key]
    names, gcat = defaultdict(Counter), defaultdict(Counter)
    low_all, low_reg = defaultdict(dict), defaultdict(dict)       # g -> branch -> lowest price
    for r, g in zip(rows, gid):
        if g < 0:
            continue
        b, p = bi[(r["brand"], r["branch"])], int(r["sale"])
        names[g][r["name"]] += 1
        gcat[g][r["cat"]] += 1
        low_all[g][b] = min(low_all[g].get(b, p), p)
        if regular(r):
            low_reg[g][b] = min(low_reg[g].get(b, p), p)
    groups = []
    for g, k in enumerate(keep):
        reg = list(low_reg[g].values())
        al = list(low_all[g].values())
        groups.append([names[g].most_common(1)[0][0], cats.index(gcat[g].most_common(1)[0][0]), len(where[k]),
                       round(median(reg)) if reg else 0, min(al), max(al)])

    nb = len({b for b in bi.values()})
    logs, logs_all, cat_logs = defaultdict(list), defaultdict(list), defaultdict(lambda: defaultdict(list))
    cheap, sole = Counter(), Counter()
    for g in range(len(keep)):
        c = groups[g][1]
        for src, out in ((low_reg[g], logs), (low_all[g], logs_all)):
            if len(src) >= LEVEL_BRANCHES:
                m = median(list(src.values()))
                for b, p in src.items():
                    out[b].append(math.log(p / m))
                    if out is logs:
                        cat_logs[b][c].append(math.log(p / m))
        if len(low_all[g]) >= CHEAP_BRANCHES:
            lo = min(low_all[g].values())
            win = [b for b, p in low_all[g].items() if p == lo]
            for b in win:
                cheap[b] += 1
            if len(win) == 1:
                sole[win[0]] += 1
    gm = lambda v: round(math.exp(sum(v) / len(v)), 4)
    stats = []
    for b in range(nb):
        stats.append([gm(logs[b]) if len(logs[b]) >= LEVEL_MIN else None,
                      gm(logs_all[b]) if len(logs_all[b]) >= LEVEL_MIN else None,
                      len(logs[b]), cheap[b], sole[b],
                      {c: gm(v) for c, v in cat_logs[b].items() if len(v) >= CAT_MIN}])
    return gid, groups, keep, stats, low_reg


def snapshot_and_changes(hist, date, keep, groups, low_reg, bkeys, prev_date_files):
    """write data2/history/<date>.auto.json.gz = {group key: [label, {"brand|branch": lowest regular price}]} and
    compare with the newest older one. returns (changes [[gid, branch, before, after]], new [[gid, branch, price]],
    gone [[label, branch, before]] (options no longer listed), prev date)"""
    snap = {k: [groups[g][0], {bkeys[b]: p for b, p in low_reg[g].items()}] for g, k in enumerate(keep) if low_reg[g]}
    with gzip.open(os.path.join(hist, f"{date}.auto.json.gz"), "wt", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    older = sorted(p for p in prev_date_files if os.path.basename(p)[:10] < date)
    if not older:
        return [], [], [], ""
    with gzip.open(older[-1], "rt", encoding="utf-8") as f:
        prev = json.load(f)
    bidx = {v: i for i, v in enumerate(bkeys)}
    gi = {k: i for i, k in enumerate(keep)}
    changes, new, gone = [], [], []
    for k, (_, now) in snap.items():
        before = prev.get(k, [None, {}])[1]
        for bk, p in now.items():
            if bk in before and before[bk] != p:
                changes.append([gi[k], bidx[bk], before[bk], p])
            elif bk not in before and before:
                new.append([gi[k], bidx[bk], p])
    for k, (label, before) in prev.items():
        now = snap.get(k, [None, {}])[1]
        for bk, p in before.items():
            if bk not in now and bk in bidx:
                gone.append([label, bidx[bk], p])
    return changes, new, gone[:500], os.path.basename(older[-1])[:10]
