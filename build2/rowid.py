"""Stable price-row ids (지시서 C8): the same id for a price row in every build while the clinic lists the same option, so a
later update can send only the rows that changed. The id is computed, not stored: data.json stays as it is (as a stored
column it cost +0.9 MB gzipped on every full download, 2026-10-15 measurement) and the app can compute the same id from
fields it already has. tests/fixtures/rowid_vectors.json holds rows and their ids for checking another implementation.

The rule (keep both implementations to it; every step is spelled out so Python and JavaScript agree to the character):
  name   = the option name with these characters removed — exactly JavaScript's /\\s/: U+0009-000D, U+0020, U+00A0, U+1680,
           U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF — and only the ASCII letters A-Z lower-cased
  base   = brand + '|' + branch + '|' + name + '|' + price kind
  hash   = FNV-1a 64-bit over the UTF-8 bytes of base (offset 0xcbf29ce484222325, prime 0x100000001b3)
  root   = the top 51 bits of hash in base 36 (0-9a-z), left-padded with '0' to 10 letters
  clash  = two different bases with one root (about once in 200,000 builds at 143,000 rows): bases are taken in code-point
           order (JavaScript's '<' on strings gives the same order for text without characters above U+FFFF); a base whose
           root an earlier base already has gets 'x' appended to its root, again until it is free
  repeat = rows with the same base (a branch lists the option twice) are ordered by their source address (url, code-point
           order), then by list price (orig, 정가; none = 0), then by sale price, then by their order in the data; the first
           gets root, the 2nd root + '~2', the 3rd '~3' … A price is read as whole won: the leading digits of its text after
           removing ',' (leading spaces allowed; no digits = 0), e.g. 23000 → 23000, '1,200,000' → 1200000, '' → 0.
  inputs in the app's data.json row r: brand meta.brands[branches[r[0]][0]][0], branch s[branches[r[0]][1]], name s[r[2]],
           kind meta.kinds[r[5]] (the name, not the number), orig r[4], sale r[3], url s[r[11]]

When an id moves (C8 검토 2026-10-16 — the ids are for telling which rows changed between two builds, not for anything a
person saves: favourites, carts and alerts keep comparison keys):
  - a new name, branch or price kind is a new base: the old id goes, a new id comes (spaces and A-Z case aside);
  - rows of one base on different pages never touch each other's ids (address first);
  - rows of one base on the same page with different list prices keep their ids when sale prices change (list price before
    sale); with the same list price, two rows whose sale prices cross swap ids, and so do rows equal in address, list and
    sale price when the site reorders them (data order);
  - a row of the same base added or removed on the same page moves the '~N' ids of the rows that sort after it.
A swap shows up as both rows changed, so an update that sends changed rows by id still ends with the right content.
usage: python build2/rowid.py   # self-test against the vectors
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VECTORS = os.path.join(ROOT, "tests", "fixtures", "rowid_vectors.json")
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
SPACE = re.compile("[\t\n\v\f\r    -     　﻿]")


def fnv1a64(data):
    h = 0xcbf29ce484222325
    for b in data:
        h = ((h ^ b) * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return h


def loose(name):
    return re.sub("[A-Z]", lambda m: m.group().lower(), SPACE.sub("", name or ""))


def base_of(brand, branch, name, kind):
    return f"{brand}|{branch}|{loose(name)}|{kind}"


def short_id(base):
    n, s = fnv1a64(base.encode("utf-8")) >> 13, ""
    while True:
        n, d = divmod(n, 36)
        s = DIGITS[d] + s
        if not n:
            return s.rjust(10, "0")


def row_ids(rows):
    """rows: dicts with brand, branch, name, kind, sale, orig and url → ids in the same order"""
    base = [base_of(r["brand"], r["branch"], r["name"], r["kind"]) for r in rows]
    roots, owner = {}, {}
    for b in sorted(set(base)):
        h = short_id(b)
        while h in owner:
            h += "x"
        owner[h] = b
        roots[b] = h
    order = sorted(range(len(rows)), key=lambda i: (base[i],) + repeat_key(rows[i]) + (i,))
    out, seen = [""] * len(rows), {}
    for i in order:
        seen[base[i]] = seen.get(base[i], 0) + 1
        out[i] = roots[base[i]] if seen[base[i]] == 1 else f"{roots[base[i]]}~{seen[base[i]]}"
    return out


def repeat_key(r):
    """how rows of one base are ordered before data order: address, list price, sale price"""
    return r.get("url") or "", r_num(r.get("orig")), r_num(r["sale"])


def r_num(x):
    m = re.match(r"\s*(\d+)", str(x or 0).replace(",", ""))
    return int(m.group(1)) if m else 0


def check(path=VECTORS):
    """the vectors' rows and the ids this rule gives them → [(row, id)] that differ"""
    v = json.load(open(path, encoding="utf-8"))
    got = row_ids(v["rows"])
    return [(r, g) for r, g in zip(v["rows"], got) if r["id"] != g], len(got)


if __name__ == "__main__":
    bad, n = check()
    print(f"row id vectors {n} · mismatches {len(bad)}")
    for r, g in bad[:5]:
        print("  ", r, "→", g)
    sys.exit(1 if bad else 0)
