"""Source Policy Registry: what we read from each clinic site and whether robots.txt lets us, plus evidence for
VAT wording and event-date wording on the pages. -> data2/sources.json

usage: python scrape/sources.py            (weekly.py runs it before the scrapers; a brand whose paths are
                                             disallowed is not scraped in that run and keeps its previous data)
Hand-maintained policy fields live in REGISTRY below (terms reviewed date, notes). Automatic fields:
  hosts[]        every host seen in the brand's accepted URLs (data2/accepted/<key>.csv) + extra seed URLs,
                 robots.txt status and whether our sample paths are allowed for YoonSiljangBot (its group, else '*')
  vat_evidence[] sentences on sample pages that mention 부가세/VAT with 포함/별도 (±60 chars)
  date_samples[] raw text of the event-period element (블리비) so the meaning of 'until' can be checked
Nothing here bypasses anything: one GET per robots.txt and a handful of sample pages, 1 s apart.
"""
import csv, json, os, re
from collections import OrderedDict
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from common import BOT_NAME, Fetcher, ROOT, clean, now_iso, robots_allows, robots_delay, robots_put, set_delay, stamp

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
    # added 2026-10-14 after a robots-first probe (scrape/probe.py); seeds = the pages the collectors start from
    ("vands", {"brand": "밴스", "method": "공개 HTML (지점별 시술소개 카테고리)", "rate": "1 req/s, 동시 6",
               "seeds": ["https://www.vandsclinics.com/", "https://yeongdeungpo.vandsclinics.com/web/product"], "terms_reviewed": None}),
    ("uandi", {"brand": "유앤아이", "method": "공개 HTML (지점 홈 이벤트 가격 영역)", "rate": "1 req/s, 동시 6",
               "seeds": ["https://www.uni114.co.kr/"], "terms_reviewed": None}),
    ("daybeau", {"brand": "데이뷰", "method": "공개 HTML (지점별 이벤트 페이지)", "rate": "1 req/s, 동시 6",
                 "seeds": ["https://daybeauclinic08.com/branch/index.php", "https://daybeauclinic08.com/branch/event.php"], "terms_reviewed": None}),
    ("drevers", {"brand": "닥터에버스", "method": "공개 HTML (지점별 이벤트 페이지의 항목 데이터)", "rate": "1 req/s, 동시 6",
                 "seeds": ["https://drevers.com/", "https://bucheon.drevers.com/event/"], "terms_reviewed": None}),
    ("cellin", {"brand": "셀린", "method": "공개 HTML (지점별 '시술 안내/가격' 목록 + 항목을 누를 때 페이지가 보내는 상세 요청)", "rate": "1 req/s, 동시 4",
                "seeds": ["https://www.cellinclinic10.com/clinicPriceSide/clinicSideList.php"], "terms_reviewed": None}),
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
    """robots.txt could not be read. RFC 9309: a 4xx answer means there is none (crawling allowed) — except 401/403 (a refusal)
    and 429 (a rate limit), treated like a 5xx answer or no answer at all: assume everything is disallowed, that brand is not
    scraped in this run (same rule as scrape/common.py robots_allows)."""
    if err.startswith("HTTP 4") and err not in ("HTTP 401", "HTTP 403", "HTTP 429"):
        return {"host": host, "robots": f"없음 ({err})", "allowed": True, "checked_paths": paths}
    return {"host": host, "robots": f"확인 실패 ({err}) — 수집 안 함", "allowed": False, "checked_paths": paths}


def robots(f, host, paths):
    r = f.get(f"https://{host}/robots.txt")
    if r is None:
        err = f.fails[-1]["error"] if f.fails and f.fails[-1]["url"].endswith("/robots.txt") else "응답 없음"
        code = int(err.split()[1]) if str(err).startswith("HTTP ") else 0
        robots_put(host, code, "" if code else str(err))     # later steps reuse this answer (no answer: why, for their logs)
        return robots_unread(host, str(err), paths)
    robots_put(host, 200, r.text)
    # asked as our own name: a group written for YoonSiljangBot wins over '*' (scrape/common.py, RFC 9309, any Python version)
    blocked = [p for p in paths if not robots_allows(200, r.text, f"https://{host}{p}")]
    delay = robots_delay(200, r.text)
    if delay:                                  # this read is the first request of the run to the host: later steps wait from here
        set_delay(host, delay)
        stamp(host)
    return {"host": host, "robots": "있음", "allowed": not blocked, "blocked_paths": blocked, "checked_paths": paths,
            "crawl_delay": delay}


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


def read_samples(f, key, sample, urls):
    """the VAT-wording and date sample pages, read through the robots.txt answers recorded just before (the shared cache, no
    second robots.txt request): a host that refused or did not answer, or a disallowed path, is not read (2026-10-15 검토:
    sources.py itself read /agree/info on 리엔장 hosts it had just recorded as '수집 안 함')"""
    f.robots = True
    try:
        ev = evidence(f, sample)
        ds = date_samples(f, urls[0]) if key == "velyb" and urls else None
    finally:
        f.robots = False
    return ev, ds


def main():
    f = Fetcher(gap=1.0, retries=1)
    out = {"checked_at": now_iso(), "user_agent_rule": f"{BOT_NAME} (그 이름의 묶음이 없으면 *)", "brands": OrderedDict()}
    for key, reg in REGISTRY.items():
        urls = accepted_urls(key)
        sample = (urls[:3] + reg["seeds"])[:6]
        hosts = OrderedDict()
        for u in urls + reg["seeds"]:
            pu = urlparse(u)
            hosts.setdefault(pu.netloc, set()).add((pu.path or "/") + (f"?{pu.query}" if pu.query else ""))
        hs = [robots(f, h, sorted(p)[:3]) for h, p in hosts.items()]   # every host the scraper reads
        # hosts asking for a long crawl delay (리엔장: 180 s) get no extra sample-page request: the scraper's price page
        # (and the address step's page) is all we read there in a run
        slow = {x["host"] for x in hs if (x.get("crawl_delay") or 0) >= 10}
        sample = [u for u in sample if urlparse(u).netloc not in slow]
        ev, ds = read_samples(f, key, sample, urls)
        entry = {**{k: v for k, v in reg.items() if k != "seeds"}, "hosts": hs, "hosts_total": len(hosts),
                 "allowed": all(x["allowed"] for x in hs), "vat_evidence": ev,
                 "skipped_samples_for_crawl_delay": sorted(slow)}
        if ds is not None:
            entry["date_samples"] = ds
        out["brands"][key] = entry
        print(f"{reg['brand']}: hosts {len(hosts)} (checked {len(hs)}), allowed={entry['allowed']}, vat evidence {len(entry['vat_evidence'])}", flush=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
