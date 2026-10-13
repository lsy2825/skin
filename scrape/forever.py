"""포에버의원 (<code>.4-ever.co.kr): categories -> treatments -> options, read from the page's embedded data.

usage: python scrape/forever.py [--only gn,bd] [--workers 4] [--gap 0.8]
The sites are Next.js; every page carries its data in self.__next_f.push([1, "<chunk>"]) scripts. The chunks are
JSON string literals; joined, they contain plain JSON objects:
  /ko/treatments            -> "categories":[{slug, label, treatments:[{slug, name, priceNumeric, ...}]}]
  /ko/treatments/<cat>/<slug> -> "options":[{name, price (list, 0 = none), discountPrice (sale, 0 = none), isEvent}]
Branch list = the <code>.4-ever.co.kr links on www.4-ever.co.kr; branch name from the page <title> ('… | 포에버의원 강남').
Prices on these sites are VAT-exclusive ('부가세(VAT) 별도'); the app says so in the brand note (build2/appdata.py).
"""
import argparse, json, re
from concurrent.futures import ThreadPoolExecutor
from common import Fetcher, clean, now_iso, write_raw

PUSH = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)')


def payload(html):
    out = []
    for m in PUSH.finditer(html):
        try:
            out.append(json.loads(m.group(1)))
        except ValueError:
            pass
    return "".join(out)


def json_after(text, key):
    """the JSON value right after '"key":' (array or object), bracket-matched"""
    i = text.find(f'"{key}":')
    if i < 0:
        return None
    j = i + len(key) + 3
    open_c = text[j]
    if open_c not in "[{":
        return None
    close_c = "]" if open_c == "[" else "}"
    depth, k, in_s, esc = 0, j, False, False
    while k < len(text):
        ch = text[k]
        if in_s:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_s = False
        elif ch == '"':
            in_s = True
        elif ch == open_c:
            depth += 1
        elif ch == close_c:
            depth -= 1
            if depth == 0:
                return json.loads(text[j:k + 1])
        k += 1
    return None


def sites(f):
    r = f.get("https://www.4-ever.co.kr/")
    return sorted({c for c in re.findall(r"https://([a-z]{2,4})\.4-ever\.co\.kr", r.text) if c != "www"}) if r else []


def scrape(code, gap):
    f = Fetcher(gap=gap)
    base = f"https://{code}.4-ever.co.kr"
    r = f.get(f"{base}/ko/treatments")
    if not r:
        return code, "", [], {"code": code, "ok": False, "error": "no treatment list", "fails": f.fails}
    m = re.search(r"<title>[^<]*포에버의원\s*([^<|]+?)\s*</title>", r.text)
    name = (m.group(1).strip() + "점") if m else code
    name = name.replace("점점", "점")
    cats = json_after(payload(r.text), "categories") or []
    rows, ts, n_items = [], now_iso(), 0
    for c in cats:
        for t in c.get("treatments") or []:
            n_items += 1
            url = f"{base}/ko/treatments/{t['category']}/{t['slug']}"
            d = f.get(url)
            opts = json_after(payload(d.text), "options") if d else None
            if not opts:
                if t.get("priceNumeric"):
                    rows.append({"brand": "포에버", "branch": name, "category": c["label"], "group": clean(t["name"]),
                                 "option": "(대표가)", "sale": t["priceNumeric"], "orig": t.get("originalPriceNumeric") or "",
                                 "addon": 0, "until": "", "url": url, "fetched_at": ts})
                continue
            for o in opts:
                sale = o.get("discountPrice") or o.get("price") or 0
                orig = o.get("price") if o.get("discountPrice") and o.get("price") else ""
                rows.append({"brand": "포에버", "branch": name, "category": c["label"], "group": clean(t["name"]),
                             "option": clean(o.get("name")), "sale": sale, "orig": orig, "addon": 0,
                             "until": "", "url": url, "fetched_at": ts})
    return code, name, rows, {"code": code, "branch": name, "ok": bool(rows), "cats": len(cats), "items": n_items,
                              "rows": len(rows), "requests": f.count, "fails": f.fails}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--gap", type=float, default=0.8)
    a = ap.parse_args()
    codes = a.only.split(",") if a.only else sites(Fetcher())
    rows, logs = [], []
    with ThreadPoolExecutor(a.workers) as ex:
        for code, name, got, log in ex.map(lambda c: scrape(c, a.gap), codes):
            rows += got
            logs.append(log)
            print(f"{code} {name}: {log.get('items', 0)} treatments, {len(got)} rows", flush=True)
    bad = [l for l in logs if not l["ok"]]
    path = write_raw("forever", rows, {"brand": "포에버", "sites": logs, "bad": bad, "finished": now_iso()})
    print(f"wrote {path}: {len(rows)} rows, {len(logs) - len(bad)} branches, {len(bad)} without data")


if __name__ == "__main__":
    main()
