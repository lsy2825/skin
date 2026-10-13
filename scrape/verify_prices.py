"""Re-read the source page of unusually low prices and check that the option and its price are really there.

usage: python scrape/verify_prices.py [--max 40] [--also 100,800,990] [--dry]
Targets (from app/data.json, the data the app shows):
  - prices at or below 30% of the same comparison key's median (each branch's lowest listed price), or below 3,000원
  - every row whose listed price is in --also (the examples people asked about)
Only hosts that data2/sources.json marks as allowed and that ask for no crawl delay are read; one GET per page (pages
are shared by many rows), 1.5 s apart. Nothing is changed in the app data — this only reports.
Writes data2/price_checks.csv and data2/price_checks.md (also to $GITHUB_STEP_SUMMARY when set). The next app build
(build2/appdata.py) reads the csv: a FOUND price counts as checked against its source and may be a headline price again.
Status per row:
  FOUND         the option name and the price (as written on the site, e.g. '100원' / '2,500') are close together
  NAME_ONLY     the option name is on the page but that price is not next to it (changed? shown differently?)
  NOT_FOUND     the option name is not on the page (event over or renamed since the weekly scrape)
  FETCH_ERROR   the page could not be read
"""
import argparse, csv, json, os, re, statistics, sys
from collections import defaultdict
from urllib.parse import urlparse
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Fetcher, ROOT, now_iso  # noqa: E402

CONDS = re.compile(r"첫\s*방문|신규|1\s*인\s*1\s*회|체험가?|한정가?|선착순|평일|이상\s*(결제|구매|시)|단독\s*불가|추가|옵션|부가세\s*(별도|포함)|VAT")


def squash(s):
    return re.sub(r"\s+", "", s or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=40)
    ap.add_argument("--also", default="100,800,990")
    ap.add_argument("--dry", action="store_true", help="list the targets only, read nothing")
    a = ap.parse_args()
    D = json.load(open(os.path.join(ROOT, "app", "data.json"), encoding="utf-8"))
    S, rows, br = D["s"], D["rows"], D["branches"]
    brands = [b[0] for b in D["meta"]["brands"]]
    src = json.load(open(os.path.join(ROOT, "data2", "sources.json"), encoding="utf-8")) if os.path.exists(os.path.join(ROOT, "data2", "sources.json")) else {"brands": {}}
    ok_hosts = {h["host"] for v in src.get("brands", {}).values() if v.get("allowed") for h in v.get("hosts", []) if not h.get("crawl_delay")}
    # each branch's lowest listed price per key → key median
    low = defaultdict(dict)
    for r in rows:
        for k in S[r[7]].split():
            if r[13] or r[3] <= 0:
                continue
            low[k][r[0]] = min(low[k].get(r[0], 10 ** 12), r[3])
    med = {k: statistics.median(v.values()) for k, v in low.items() if len(v) >= 3}
    also = {int(x) for x in a.also.split(",") if x.strip()}
    picked, seen = [], set()
    for i, r in enumerate(rows):
        url, name = S[r[11]], S[r[2]]
        if not url or urlparse(url).hostname not in ok_hosts:
            continue
        ks = [k for k in S[r[7]].split() if k in med]
        share = min((r[3] / med[k] for k in ks), default=None)
        reason = "asked" if r[3] in also else "low" if (share is not None and share <= 0.3) or r[3] < 3000 else ""
        if not reason or (name, r[3]) in seen:
            continue
        seen.add((name, r[3]))
        picked.append((0 if reason == "asked" else 1, share if share is not None else 1, i, reason))
    picked.sort()
    picked = picked[: a.max]
    if a.dry:
        for _, share, i, reason in picked:
            r = rows[i]
            print(reason, f"{share:.0%}" if share != 1 else "-", r[3], brands[br[r[0]][0]], S[br[r[0]][1]], S[r[2]][:50], S[r[11]][:60])
        return
    f = Fetcher(gap=1.5)
    pages, out = {}, []
    for _, share, i, reason in picked:
        r = rows[i]
        url, name, price = S[r[11]], S[r[2]], r[3]
        if url not in pages:
            resp = f.get(url)
            pages[url] = squash(BeautifulSoup(resp.text, "html.parser").get_text(" ")) if resp else None
        text = pages[url]
        status, snippet = "FETCH_ERROR", ""
        if text is not None:
            cands = [squash(name), squash(re.sub(r"\s*(체험가|한정가)\s*$", "", name))]
            pos = next((text.find(c) for c in cands if c and text.find(c) >= 0), -1)
            if pos < 0:
                status = "NOT_FOUND"
            else:
                window = text[pos: pos + len(cands[0]) + 160]
                pat = re.compile(rf"(?<![\d,]){re.escape(f'{price:,}')}(?![\d,])|(?<!\d){price}(?!\d)")
                status = "FOUND" if pat.search(window) else "NAME_ONLY"
                snippet = window[:160]
        b = br[r[0]]
        out.append({"status": status, "checked_at": now_iso()[:10], "reason": reason, "brand": brands[b[0]], "branch": S[b[1]], "name": name, "listed_price": price,
                    "vat": {1: "포함", 2: "별도"}.get(r[12], "미확인"), "kind": D["meta"]["kinds"][r[5]], "conditions_in_app": S[r[6]],
                    "conditions_on_page": " ".join(sorted(set(m.group(0) for m in CONDS.finditer(snippet)))),
                    "share_of_median": f"{share:.0%}" if share is not None and share != 1 else "", "url": url, "page_snippet": snippet})
    path = os.path.join(ROOT, "data2", "price_checks.csv")
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out[0].keys()) if out else ["status"])
        w.writeheader()
        w.writerows(out)
    cnt = defaultdict(int)
    for x in out:
        cnt[x["status"]] += 1
    lines = [f"# 초저가 원본 대조 {now_iso()[:10]}", "", f"- 대상 {len(out)}개 (요청 예시 + 중간값의 30% 이하 또는 3,000원 미만), 페이지 {len(pages)}개 · 요청 {f.count}번",
             "- " + " · ".join(f"{k} {v}" for k, v in sorted(cnt.items())), "", "| 상태 | 지점 | 상품 | 병원 표시가 | 부가세 | 종류 | 앱의 조건 | 원본 근처 조건 문구 |", "|---|---|---|---|---|---|---|---|"]
    for x in out:
        lines.append(f"| {x['status']} | {x['brand']} {x['branch']} | {x['name'][:40]} | {x['listed_price']:,}원 | {x['vat']} | {x['kind']} | {x['conditions_in_app'] or '-'} | {x['conditions_on_page'] or '-'} |")
    md = "\n".join(lines) + "\n"
    open(os.path.join(ROOT, "data2", "price_checks.md"), "w", encoding="utf-8").write(md)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8").write(md)
    print(md)


if __name__ == "__main__":
    main()
