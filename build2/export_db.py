"""Current data -> CSV files per table of supabase/schema_platform.sql (data2/db/, not committed).

usage: python build2/export_db.py [--date YYYY-MM-DD]
       psql "$DATABASE_URL" -f supabase/schema_platform.sql && psql "$DATABASE_URL" -f supabase/load_platform.sql
Sources: data2/clean.csv (offers), data2/branches.csv, data2/vat_policy.json, data2/sources.json, build2/xkeys.py + data2/variants.json (variants),
build2/appdata.py FAM (products), data2/review.csv (PENDING_REVIEW). Integer KRW only. One price snapshot per offer for the
export date (history before that stays in data2/history, key/group level).
"""
import argparse, csv, datetime, hashlib, json, os, re, sys
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
from xkeys import X, comp, match as xmatch  # noqa: E402
from appdata import BRANDS, CATS, FAM, KINDS  # noqa: E402
OUT = os.path.join(ROOT, "data2", "db")
SLUG = {"블리비": "velyb", "쁨": "ppeum", "톡스앤필": "toxnfill", "리엔장": "lienjang", "포에버": "forever"}
COND = ["평일 낮", "일요일", "타임세일", "첫 방문", "1인 1회"]
UNIT = re.compile(r"(\d+)\s*(샷|cc|U|KJ)")


def write(name, header, rows):
    with open(os.path.join(OUT, f"{name}.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat())
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    rows = list(csv.DictReader(open(os.path.join(ROOT, "data2", "clean.csv"), encoding="utf-8")))
    geo = {(r["brand"], r["branch"]): r for r in csv.DictReader(open(os.path.join(ROOT, "data2", "branches.csv"), encoding="utf-8"))}
    vat = json.load(open(os.path.join(ROOT, "data2", "vat_policy.json"), encoding="utf-8"))
    src = json.load(open(os.path.join(ROOT, "data2", "sources.json"), encoding="utf-8"))
    review = {(r["brand"], r["branch"], r["name"], int(r["price"])) for r in csv.DictReader(open(os.path.join(ROOT, "data2", "review.csv"), encoding="utf-8-sig"))
              if r["status"] == "검토 대기"} if os.path.exists(os.path.join(ROOT, "data2", "review.csv")) else set()
    counts = OrderedDict()

    brands = [b for b, _, _ in BRANDS]
    bid = {b: i + 1 for i, b in enumerate(brands)}
    counts["clinic_brands"] = write("clinic_brands", ["id", "slug", "name", "homepage", "vat_default", "vat_evidence", "vat_checked"],
        [[bid[b], SLUG[b], b, "", vat.get(b, {}).get("default", ""), vat.get(b, {}).get("evidence", ""), vat.get(b, {}).get("checked", "")] for b in brands])
    branch_keys = OrderedDict()
    for r in rows:
        branch_keys.setdefault((r["brand"], r["branch"]), r["url"])
    brid = {k: i + 1 for i, k in enumerate(branch_keys)}
    from appdata import region  # noqa: E402
    counts["clinic_branches"] = write("clinic_branches", ["id", "brand_id", "name", "address", "region", "lat", "lng", "site_url", "status"],
        [[brid[k], bid[k[0]], k[1], (geo.get(k, {}).get("address_full") or geo.get(k, {}).get("address", "")), region(geo.get(k, {}).get("address", "")),
          geo.get(k, {}).get("lat", ""), geo.get(k, {}).get("lng", ""), re.match(r"https?://[^/]+", u).group(0), "ACTIVE"] for k, u in branch_keys.items()])
    counts["treatment_categories"] = write("treatment_categories", ["id", "name", "sort"], [[i + 1, c, i] for i, c in enumerate(CATS)])
    pid = {}
    prod_rows = []
    for i, (name, rx, vs) in enumerate(FAM):
        pid[name] = i + 1
        cat = next((r["cat"] for r in rows if r["keys"] and any(v[0] in r["keys"].split() for v in vs)), "기타")
        prod_rows.append([i + 1, CATS.index(cat) + 1, name, "{}"])
    counts["treatment_products"] = write("treatment_products", ["id", "category_id", "name", "aliases"], prod_rows)
    key_prod = {v[0]: name for name, _, vs in FAM for v in vs}
    # hand-made keys (xkeys.X) + variant keys from build2/taxonomy.py (data2/variants.json, written by clean.py)
    vp = os.path.join(ROOT, "data2", "variants.json")
    auto = json.load(open(vp, encoding="utf-8"))["keys"] if os.path.exists(vp) else []
    allk = [(k[0], k[2], 1) for k in X] + [(v["id"], v["label"], int(v["sig"].rsplit("|", 1)[-1])) for v in auto]
    vid = {k[0]: i + 1 for i, k in enumerate(allk)}
    var_rows = []
    for kid, label, sess in allk:
        m = UNIT.search(label)
        var_rows.append([vid[kid], pid.get(key_prod.get(kid, ""), ""), kid, label, m.group(2) if m else "", m.group(1) if m else "", sess, "{}"])
    counts["treatment_variants"] = write("treatment_variants", ["id", "product_id", "code", "label", "unit", "qty", "sessions", "attrs"], var_rows)
    reg_rows = []
    for i, (key, s) in enumerate(src.get("brands", {}).items()):
        if s["brand"] not in bid:
            continue
        reg_rows.append([len(reg_rows) + 1, bid[s["brand"]], s.get("method", ""), "{" + ",".join(h["host"] for h in s.get("hosts", [])) + "}",
                         s.get("allowed"), max([h.get("crawl_delay") or 0 for h in s.get("hosts", [])] or [0]) or "", s.get("rate", ""),
                         s.get("terms_reviewed") or "", src.get("checked_at", ""), ""])
    counts["source_registry"] = write("source_registry", ["id", "brand_id", "method", "hosts", "robots_allowed", "crawl_delay_s", "rate_limit", "terms_reviewed", "checked_at", "notes"], reg_rows)

    offers, conds, pkgs, items, snaps = [], [], [], [], []
    seen = set()
    for r in rows:
        k = (r["brand"], r["branch"])
        price, lst = int(r["sale"]), (int(r["orig"]) if r["orig"] else "")
        h = hashlib.sha256(f"{r['brand']}|{r['branch']}|{r['option']}|{price}|{lst}|{r['url']}".encode()).hexdigest()
        if (brid[k], h) in seen:
            continue
        seen.add((brid[k], h))
        oid = len(offers) + 1
        until = r["until"] if re.match(r"^\d{4}-\d{2}-\d{2}$", r["until"] or "") and r["until"] < "9000" else ""
        status = "PENDING_REVIEW" if (r["brand"], r["branch"], r["name"], price) in review else "EXPIRED" if until and until < a.date else "VERIFIED"
        v = {"포함": "incl", "별도": "excl"}.get(r.get("vat", ""), "unknown")
        keys = r["keys"].split()
        offers.append([oid, brid[k], vid.get(keys[0], "") if keys else "", comp(r["name"]) if r["kind"] != "구독권" else "", r["name"], r["option"], r["group"],
                       r["src_cat"], CATS.index(r["cat"]) + 1, price, lst, v, r["kind"], int(r["sess"] or 1), r["addon"] == "1", until,
                       r["url"], h, (r["fetched_at"] or a.date)[:10], (r["fetched_at"] or a.date)[:10], status])
        for c in r["tags"].split("·"):
            if c in COND:
                conds.append([oid, c, ""])
        if "+" in r["name"]:
            pkgs.append([len(pkgs) + 1, oid])
            parts = [re.sub(r"\[[^\]]*\]\s*", "", p).strip() for p in re.split(r"\s*\+\s*", r["name"])]
            for pos, part in enumerate(p for p in parts if p):        # '울쎄라 300샷 +' ends with an empty part
                hit = next((x[0] for x in X if part and xmatch(x, part)), None)
                items.append([len(pkgs), pos, part, vid[hit] if hit else ""])
        norm = round(price * 1.1) if v == "excl" else price
        snaps.append([a.date, oid, brid[k], vid.get(keys[0], "") if keys else "", offers[-1][3], price, norm, status, r["url"],
                      "{" + ",".join(c for c in r["tags"].split("·") if c in COND) + "}", r["fetched_at"] or f"{a.date}T00:00:00+09:00"])
    counts["offers"] = write("offers", ["id", "branch_id", "variant_id", "auto_group", "name", "raw_name", "raw_group", "source_category", "category_id",
                                        "price_krw", "list_price_krw", "vat", "kind", "sessions", "is_addon", "valid_until", "source_url", "source_hash",
                                        "first_seen", "last_seen", "verification_status"], offers)
    counts["offer_conditions"] = write("offer_conditions", ["offer_id", "condition", "detail"], conds)
    counts["official_packages"] = write("official_packages", ["id", "offer_id"], pkgs)
    counts["official_package_items"] = write("official_package_items", ["package_id", "position", "part_text", "variant_id"], items)
    counts["price_snapshots"] = write("price_snapshots", ["observed_on", "offer_id", "branch_id", "variant_id", "auto_group", "price_krw", "normalized_krw",
                                                          "verification_status", "source_url", "conditions", "collected_at"], snaps)
    print("wrote", OUT, dict(counts))


if __name__ == "__main__":
    main()
