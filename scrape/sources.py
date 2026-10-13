"""Source Policy Registry: what we read from each clinic site and whether robots.txt lets us, plus evidence for
VAT wording and event-date wording on the pages. -> data2/sources.json

usage: python scrape/sources.py            (weekly.py runs it before the scrapers; a brand whose paths are
                                             disallowed is not scraped that week and keeps its previous data)
Hand-maintained policy fields live in REGISTRY below (terms reviewed date, notes). Automatic fields:
  hosts[]        every host seen in the brand's accepted URLs (data2/accepted/<key>.csv) + extra seed URLs,
                 robots.txt status and whether our sample paths are allowed for user-agent '*'
  vat_evidence[] sentences on sample pages that mention 부가세/VAT with 포함/별도 (±60 chars)
  date_samples[] raw text of the event-period element (블리비) so the meaning of 'until' can be checked
Nothing here bypasses anything: one GET per robots.txt and a handful of sample pages, 1 s apart.
"""
import csv, json, os, re, urllib.robotparser
from collections import OrderedDict
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from common import Fetcher, ROOT, clean, now_iso

OUT = os.path.join(ROOT, "data2", "sources.json")
ACC = os.path.join(ROOT, "data2", "accepted")

# key: scraper name (scrape/<key>.py). terms_reviewed: date a person read the site's terms (None = not yet)
REGISTRY = OrderedDict([
    ("velyb", {"brand": "블리비", "method": "공개 HTML (지점별 이벤트 페이지 7쪽)", "rate": "1 req/s, 동시 4",
               "seeds": ["https://www.velyb.kr/", "https://www.velyb.kr/community/community02.php"], "terms_reviewed": None}),
    ("ppeum", {"brand": "쁨", "method": "공개 HTML (지점별 온라인 예약 페이지)", "rate": "1 req/s, 동시 4",
               "seeds": ["https://www.ppeum1.com/", "https://event.ppeum.com/"], "terms_reviewed": None}),
    ("toxnfill", {"brand": "톡스앤필", "method": "공개 HTML (시술안내/가격 상세)", "rate": "1 req/s, 동시 4",
                  "seeds": ["https://www.toxnfill1.com/"], "terms_reviewed": None}),
    ("lienjang", {"brand": "리엔장", "method": "공개 HTML (비급여 진료비 고시표)", "rate": "1 req/s",
                  "seeds": [], "terms_reviewed": None}),
    ("forever", {"brand": "포에버", "method": "공개 HTML (Next.js 내장 데이터) — 일시 중지", "rate": "0.8 req/s, 동시 4",
                 "seeds": ["https://www.4-ever.co.kr/", "https://gn.4-ever.co.kr/ko/treatments"], "terms_reviewed": None}),
])
VAT = re.compile(r"(부가세|부가가치세|VAT|vat)[^가-힣A-Za-z]{0,6}(\d{1,2}\s*%\s*)?[^.\n]{0,12}?(별도|포함|미포함)")


def accepted_urls(key):
    p = os.path.join(ACC, f"{key}.csv")
    if not os.path.exists(p):
        return []
    seen = OrderedDict()
    for r in csv.DictReader(open(p, encoding="utf-8")):
        u = r.get("url") or ""
        host = urlparse(u).netloc
        if host and host not in seen:
            seen[host] = u
    return list(seen.values())


def robots_unread(host, err, paths):
    """robots.txt could not be read. RFC 9309: a 4xx answer means there is none (crawling allowed); a 5xx answer or no
    answer at all (timeout, connection error) means assume everything is disallowed — that brand is not scraped this week."""
    if err.startswith("HTTP 4"):
        return {"host": host, "robots": f"없음 ({err})", "allowed": True, "checked_paths": paths}
    return {"host": host, "robots": f"확인 실패 ({err}) — 수집 안 함", "allowed": False, "checked_paths": paths}


def robots(f, host, paths):
    r = f.get(f"https://{host}/robots.txt")
    if r is None:
        err = f.fails[-1]["error"] if f.fails and f.fails[-1]["url"].endswith("/robots.txt") else "응답 없음"
        return robots_unread(host, str(err), paths)
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(r.text.splitlines())
    blocked = [p for p in paths if not rp.can_fetch("*", f"https://{host}{p}")]
    return {"host": host, "robots": "있음", "allowed": not blocked, "blocked_paths": blocked, "checked_paths": paths,
            "crawl_delay": rp.crawl_delay("*")}


def evidence(f, urls):
    out = []
    for u in urls:
        r = f.get(u)
        if not r:
            continue
        text = clean(BeautifulSoup(r.text, "html.parser").get_text(" "))
        for m in VAT.finditer(text):
            snip = text[max(0, m.start() - 60):m.end() + 60]
            if snip not in (x["text"] for x in out):
                out.append({"url": u, "text": snip})
            if len(out) >= 12:
                return out
    return out


def date_samples(f, url):
    r = f.get(url)
    if not r:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    out = [clean(d.get_text(" ")) for d in soup.select("div.cont .top .date")][:5]
    # wording around '프라임 타임' (weekday-daytime prices): the hours, if the page states them
    text = clean(soup.get_text(" "))
    for m in re.finditer(r"프라임\s*타임", text):
        snip = text[max(0, m.start() - 40):m.end() + 80]
        if snip not in out:
            out.append(snip)
        if len(out) >= 10:
            break
    return out


def main():
    f = Fetcher(gap=1.0, retries=1)
    out = {"checked_at": now_iso(), "user_agent_rule": "*", "brands": OrderedDict()}
    for key, reg in REGISTRY.items():
        urls = accepted_urls(key)
        sample = (urls[:3] + reg["seeds"])[:6]
        hosts = OrderedDict()
        for u in urls + reg["seeds"]:
            pu = urlparse(u)
            hosts.setdefault(pu.netloc, set()).add((pu.path or "/") + (f"?{pu.query}" if pu.query else ""))
        hs = [robots(f, h, sorted(p)[:3]) for h, p in hosts.items()]   # every host the scraper reads
        # hosts asking for a long crawl delay (리엔장: 180 s) get no extra sample-page request: the scraper's one weekly
        # page per host is all we read there
        slow = {x["host"] for x in hs if (x.get("crawl_delay") or 0) >= 10}
        sample = [u for u in sample if urlparse(u).netloc not in slow]
        entry = {**{k: v for k, v in reg.items() if k != "seeds"}, "hosts": hs, "hosts_total": len(hosts),
                 "allowed": all(x["allowed"] for x in hs), "vat_evidence": evidence(f, sample),
                 "skipped_samples_for_crawl_delay": sorted(slow)}
        if key == "velyb" and urls:
            entry["date_samples"] = date_samples(f, urls[0])
        out["brands"][key] = entry
        print(f"{reg['brand']}: hosts {len(hosts)} (checked {len(hs)}), allowed={entry['allowed']}, vat evidence {len(entry['vat_evidence'])}", flush=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
