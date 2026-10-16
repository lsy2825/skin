"""Automatic comparison groups: the same option (normalized name) sold at several branches.

The 36 hand-made keys (xkeys.py) match one procedure across brands; these groups cover everything else, mostly
branches of one brand selling identically named options (블리비 58 branches share most names), so ranks, branch
price levels, branch-vs-branch comparison and price changes work on ~60% of all rows instead of ~11%.

  group key   xkeys.comp(name) (spaces removed, units unified) — only rows that are not 구독권 / add-ons
  kept when   sold at >= MIN_BRANCHES branches
  regular     plain(): kind 일반/고시가 without condition tags (체험가·한정가·평일 낮 … are 'special') and, from 2026-10-16
              (PLAIN_RULE 2), without a weekday or hour limit written on the site (row days 0, hours '': 닥터에버스
              '토요일이벤트', 톡스앤필 청주 '주말제외' carry no tag but are not valid every day — the app's '특가 제외' leaves
              them out too). The same rule picks the weekly snapshot's plain lowest (build2/appdata.py)
  branch level geometric mean of (branch's lowest regular price / median of the branches' lowest regular prices)
              over groups sold at >= LEVEL_BRANCHES branches; needs >= LEVEL_MIN groups (per category >= CAT_MIN)
"""
import gzip, json, math, os
from collections import Counter, defaultdict
from xkeys import comp

MIN_BRANCHES, LEVEL_BRANCHES, LEVEL_MIN, CAT_MIN, CHEAP_BRANCHES = 3, 8, 10, 5, 5
# achg 'gone' entries kept. Cut after the rule-moved ones are dropped (2026-10-16: cut before, the plain-rule change pushed
# 4 real '없어짐' entries out of the list while its own were dropped)
GONE_MAX = 500


# the rule for a plain (regular) price, by version. data.json meta.plainRules = [[version, first collection built with it], …]
# (a file without it, and every snapshot before its first entry: 1). The next build judges the previous rows by the rule
# their build or snapshot used, so a rule change is not read as price changes (build2/appdata.py reclassified / group_moved).
#   1  kind 일반/고시가, no condition tag
#   2  … and no weekday or hour limit (days 0, hours '') — 2026-10-16, chat B's decision for the app's '특가 제외'
PLAIN_RULE = 2


def plain(kind, tags, days=0, hours="", rule=PLAIN_RULE):
    """a plain price under that rule version: kind 일반/고시가 with no condition tag (and, rule 2, no days / hours limit)"""
    if kind not in ("일반", "고시가") or tags:
        return False
    return rule < 2 or (not int(days or 0) and not hours)


def rule_at(marks, date):
    """the plain rule the build of the collection `date` used; marks = meta.plainRules of a data.json (None: all were 1)"""
    v = 1
    for ver, since in marks or []:
        if since <= date:
            v = ver
    return v


def rule_marks(prev_marks, collected):
    """meta.plainRules for this build: the previous file's list, plus [PLAIN_RULE, collected] the first time this rule is used"""
    m = [list(x) for x in prev_marks or []]
    if not m or m[-1][0] != PLAIN_RULE:
        m.append([PLAIN_RULE, collected])
    return m


def regular(r):
    """plain() of a clean.csv row (days / hours missing in rows from before 2026-10-16: none written)"""
    return plain(r["kind"], r["tags"], r.get("days"), r.get("hours"))


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
    gone [[label, branch, before, group key]] (options no longer listed — all of them: the caller drops the ones a rule moved
    out of the group, then keeps GONE_MAX), prev date, that snapshot {group key: {"brand|branch": price}}: a group key it does
    not have has no change, new or gone entry against it)"""
    snap = {k: [groups[g][0], {bkeys[b]: p for b, p in low_reg[g].items()}] for g, k in enumerate(keep) if low_reg[g]}
    body = json.dumps(snap, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    with open(os.path.join(hist, f"{date}.auto.json.gz"), "wb") as raw:      # mtime=0: same data -> same bytes
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as f:
            f.write(body)
    older = sorted(p for p in prev_date_files if os.path.basename(p)[:10] < date)
    if not older:
        return [], [], [], "", {}
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
                gone.append([label, bidx[bk], p, k])
    return changes, new, gone, os.path.basename(older[-1])[:10], {k: m for k, (_, m) in prev.items()}
