"""Stable price-row ids (지시서 C8): the same id for a price row in every build while the clinic lists the same option, so a
later update can send only the rows that changed. The id is computed, not stored: data.json stays as it is (as a stored
column it cost +0.9 MB gzipped on every full download, 2026-10-15 measurement) and the app can compute the same id from
fields it already has. tests/fixtures/rowid_vectors.json holds rows and their ids for checking another implementation.

The rule (keep both implementations to it):
  base   = brand + '|' + branch + '|' + name with all whitespace removed and lower-cased (str.casefold / toLowerCase on the
           Korean names gives the same result for these Latin letters) + '|' + price kind
  hash   = FNV-1a 64-bit over the UTF-8 bytes of base (offset 0xcbf29ce484222325, prime 0x100000001b3)
  id     = the top 41 bits of hash in base 36 (0-9a-z), left-padded with '0' to 8 letters
  order  = bases compare by code point (JavaScript's '<' on strings gives the same order for text without emoji)
  repeat = rows with the same base (one branch lists the option twice at different prices) are ordered by sale price, then
           by their order in the data; the 2nd gets id + '~2', the 3rd '~3' …
  clash  = two different bases with one id (about once in 6,000 builds at 143,000 rows): the base that sorts first keeps it,
           the other gets id + '~x'
usage: python build2/rowid.py   # self-test against the vectors
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VECTORS = os.path.join(ROOT, "tests", "fixtures", "rowid_vectors.json")
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"


def fnv1a64(data):
    h = 0xcbf29ce484222325
    for b in data:
        h = ((h ^ b) * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return h


def base_of(brand, branch, name, kind):
    loose = re.sub(r"\s+", "", name or "").lower()
    return f"{brand}|{branch}|{loose}|{kind}"


def short_id(base):
    n, s = fnv1a64(base.encode("utf-8")) >> 23, ""
    while True:
        n, d = divmod(n, 36)
        s = DIGITS[d] + s
        if not n:
            return s.rjust(8, "0")


def row_ids(rows):
    """rows: dicts with brand, branch, name, kind, sale → ids in the same order"""
    base = [base_of(r["brand"], r["branch"], r["name"], r["kind"]) for r in rows]
    order = sorted(range(len(rows)), key=lambda i: (base[i], int(r_num(rows[i]["sale"])), i))
    out, seen, owner = [""] * len(rows), {}, {}
    for i in order:
        seen[base[i]] = seen.get(base[i], 0) + 1
        h = short_id(base[i])
        rid = h if seen[base[i]] == 1 else f"{h}~{seen[base[i]]}"
        if owner.get(rid, base[i]) != base[i]:
            rid = f"{rid}~x"
        owner.setdefault(rid, base[i])
        out[i] = rid
    return out


def r_num(x):
    try:
        return int(float(str(x or 0).replace(",", "")))
    except ValueError:
        return 0


if __name__ == "__main__":
    v = json.load(open(VECTORS, encoding="utf-8"))
    got = row_ids(v["rows"])
    bad = [(r, g) for r, g in zip(v["rows"], got) if r["id"] != g]
    print(f"row id vectors {len(got)} · mismatches {len(bad)}")
    for r, g in bad[:5]:
        print("  ", r, "→", g)
    sys.exit(1 if bad else 0)
