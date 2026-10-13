"""리엔장 (<branch>.lienjang.net): the posted non-covered fee table (/agree/info), read straight from the HTML.

usage: python scrape/lienjang.py
These are the clinic's legally posted fees ('비급여 진료비용'), not event prices; the table carries its own
'최종변경일', kept in the 'until' column as 'posted:YYYY-MM-DD' so the app can show how old it is.
Rows use rowspans, so the item name is the cell just before the first price cell and the group is carried down.
Prices are written like '3.9만원' / '1,200,000원'; a range (최저~최고) keeps the minimum as sale.
robots.txt: each branch host is checked; Crawl-delay is respected (one page per host, hosts in sequence).
"""
import re, urllib.robotparser
from bs4 import BeautifulSoup
from common import Fetcher, clean, now_iso, write_raw

SUBS = {"incheon": "인천점", "myeongdong": "명동점", "mokdong": "목동점", "hongdae": "홍대점", "hanam": "하남점",
        "gangnam": "강남점", "jamsil": "잠실점"}
PRICE = re.compile(r"^\s*([\d.,]+)\s*(만\s*원|원)\s*~?\s*$")


def price(s):
    m = PRICE.match(s or "")
    if not m:
        return None
    v = float(m.group(1).replace(",", ""))
    return int(round(v * 10000)) if "만" in m.group(2) else int(v)


def allowed(host):
    rp = urllib.robotparser.RobotFileParser(f"https://{host}/robots.txt")
    try:
        rp.read()
    except Exception:
        return True, None
    return rp.can_fetch("*", f"https://{host}/agree/info"), rp.crawl_delay("*")


def parse(html, branch, url, ts):
    s = BeautifulSoup(html, "html.parser")
    rows, group, seen = [], "", set()
    for t in s.find_all("table"):
        for tr in t.find_all("tr"):
            cells = [clean(c.get_text(" ")) for c in tr.find_all(["td", "th"])]
            idx = next((i for i, c in enumerate(cells) if price(c) is not None), None)
            if idx is None or idx == 0:
                continue
            # cells before the first price: 코드 · 명칭 (same on every row), then [group,] name; the 비용 cell is
            # empty when only 최저~최고 is given, and the group cell is missing under a rowspan
            words = [c for c in cells[2:idx] if c]
            if not words:
                continue
            name = words[-1]
            if len(words) >= 2:
                group = words[-2]
            vals = [price(c) for c in cells[idx:idx + 3] if price(c) is not None]
            date = next((c for c in reversed(cells) if re.match(r"\d{4}\.\d{2}\.\d{2}", c)), "")
            key = (group, name, vals[0])
            if not name or key in seen:          # the same table is printed twice (PC + mobile)
                continue
            seen.add(key)
            rows.append({"brand": "리엔장", "branch": branch, "category": group, "group": group, "option": name,
                         "sale": min(vals), "orig": "", "addon": 0,
                         "until": "posted:" + date.replace(".", "-") if date else "", "url": url, "fetched_at": ts})
    return rows


def main():
    rows, logs = [], []
    for sub, name in SUBS.items():
        host = f"{sub}.lienjang.net"
        ok, delay = allowed(host)
        if not ok:
            logs.append({"branch": name, "host": host, "ok": False, "error": "robots.txt disallows /agree/info"})
            print(f"{name}: skipped (robots)")
            continue
        f = Fetcher(gap=0, retries=2)
        url = f"https://{host}/agree/info"
        r = f.get(url)
        got = parse(r.text, name, url, now_iso()) if r else []
        rows += got
        logs.append({"branch": name, "host": host, "ok": bool(got), "rows": len(got), "crawl_delay": delay, "fails": f.fails})
        print(f"{name}: {len(got)} rows" + ("" if r else f" ({f.fails[-1]['error']})"))
    bad = [l for l in logs if not l["ok"]]
    path = write_raw("lienjang", rows, {"brand": "리엔장", "pages": logs, "bad": bad, "finished": now_iso()})
    print(f"wrote {path}: {len(rows)} rows, {len(logs) - len(bad)} branches, {len(bad)} skipped")


if __name__ == "__main__":
    main()
