"""Probe candidate clinic chains before writing a collector (docs/DATA_AND_LEGAL.md §1, brand expansion).

Runs on a GitHub runner (.github/workflows/probe-brands.yml): this project's dev container cannot reach clinic sites.
For each seed page it reads robots.txt first (our own name `YoonSiljangBot` and `*` must both be allowed), then saves
the page and a few same-site links that look like price / event / branch pages, one request per second per host, at most
MAX_PAGES per brand. Nothing is logged in to, no form is posted, no CAPTCHA or block is worked around: a refused or
unreadable robots.txt (5xx / no answer) means that host is skipped. Output: probe_out/<brand>/*.html + probe_out/index.json
with, per page, the HTTP status, size, how many '원' prices the visible text holds, how many images, and words that point
to a login wall or a CAPTCHA — enough to decide by hand whether a collector is possible and allowed.

  python scrape/probe.py [brand ...]      (default: every brand in SEEDS)
"""
import json, os, re, sys, time, urllib.robotparser
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
import requests
from common import UA

OUT = os.environ.get("PROBE_OUT", "probe_out")
MAX_PAGES = int(os.environ.get("PROBE_MAX", "40"))
GAP = 1.0
BOT = "YoonSiljangBot"

# seeds from a web search on 2026-10-14 (search results only — every site is unverified until this probe runs)
SEEDS = {
    "daybeau": ["https://daybeauclinic00.com/", "https://daybeauclinic00.com/main/m13.php", "https://daybeauclinic08.com/branch/index.php",
                "https://daybeauclinic11.com/eng/event.php"],
    "uandi": ["https://www.uni114.co.kr/", "https://www.jsuni114.co.kr/", "https://www.ujbuni114.co.kr/"],
    "vands": ["https://www.vandsclinic.co.kr/", "https://yeongdeungpo.vandsclinics.com/web/event", "https://yeongdeungpo.vandsclinics.com/web/product",
              "https://yongsan.vandsclinics.com/web/product"],
    "drevers": ["https://www.drevers.com/", "https://bucheon.drevers.com/event/", "https://nowon.drevers.com/event/"],
    "cellin": ["https://www.cellinclinic13.com/clinicPrice/clinicListLeft.php", "https://www.cellinclinic10.com/clinicPriceSide/clinicSideList.php",
               "https://www.cellinclinic01.com/"],
}
LINK_WORDS = re.compile(r"event|price|clinicprice|product|branch|지점|이벤트|가격|비급여|시술안내", re.I)
PRICE = re.compile(r"\d{1,3}(?:,\d{3})+\s*원|\d{4,7}\s*원")
WALL = re.compile(r"captcha|recaptcha|hcaptcha|cf-challenge|로그인 후|로그인이 필요|회원만|카카오톡 친구", re.I)

session = requests.Session()
session.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
last = {}


def get(url):
    host = urlparse(url).netloc
    d = GAP - (time.time() - last.get(host, 0))
    if d > 0:
        time.sleep(d)
    last[host] = time.time()
    try:
        r = session.get(url, timeout=25, allow_redirects=True)
        if r.encoding is None or r.encoding.lower() == "iso-8859-1":
            r.encoding = r.apparent_encoding or "utf-8"
        return r, None
    except requests.RequestException as e:
        return None, type(e).__name__


robots_cache = {}


def robots_for(url):
    host = urlparse(url).netloc
    if host in robots_cache:
        return robots_cache[host]
    r, err = get(f"https://{host}/robots.txt")
    if r is None or r.status_code >= 500:
        res = {"state": f"unreadable ({err or r.status_code}) — skip host", "rp": None, "ok": False}
    elif r.status_code >= 400:
        res = {"state": f"none (HTTP {r.status_code}) — allowed", "rp": None, "ok": True}
    else:
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(r.text.splitlines())
        res = {"state": "present", "rp": rp, "ok": True, "text": r.text[:4000], "crawl_delay": rp.crawl_delay(BOT) or rp.crawl_delay("*")}
    robots_cache[host] = res
    return res


def allowed(url):
    rb = robots_for(url)
    if not rb["ok"]:
        return False, rb["state"]
    if rb["rp"] is None:
        return True, rb["state"]
    ok = rb["rp"].can_fetch(BOT, url) and rb["rp"].can_fetch("*", url)
    return ok, rb["state"] + ("" if ok else " — path disallowed")


def visible_text(soup):
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    return re.sub(r"\s+", " ", soup.get_text(" "))


def probe(brand):
    os.makedirs(os.path.join(OUT, brand), exist_ok=True)
    queue, seen, pages = list(SEEDS[brand]), set(), []
    while queue and len(pages) < MAX_PAGES:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        ok, why = allowed(url)
        rec = {"url": url, "robots": why}
        if not ok:
            rec["skipped"] = True
            pages.append(rec)
            continue
        r, err = get(url)
        if r is None:
            rec["error"] = err
            pages.append(rec)
            continue
        rec.update(status=r.status_code, final_url=r.url, bytes=len(r.content), content_type=r.headers.get("content-type", ""))
        if r.status_code == 200 and "html" in rec["content_type"]:
            fn = f"{len(pages):02d}.html"
            with open(os.path.join(OUT, brand, fn), "w", encoding="utf-8") as f:
                f.write(r.text)
            soup = BeautifulSoup(r.text, "html.parser")
            imgs = len(soup.find_all("img"))
            links = [(urljoin(r.url, a["href"]), (a.get_text() or "").strip()) for a in soup.find_all("a", href=True)]
            text = visible_text(soup)
            rec.update(file=fn, prices_in_text=len(PRICE.findall(text)), images=imgs, scripts=len(soup.find_all("script")),
                       text_chars=len(text), wall_words=sorted(set(m.lower() for m in WALL.findall(r.text)))[:5],
                       vat_words=sorted(set(re.findall(r"VAT\s*(?:포함|별도)|부가세\s*(?:포함|별도)", text)))[:4])
            base = urlparse(r.url).netloc.split(".", 1)[-1]
            for u, t in links:
                pu = urlparse(u)
                if pu.scheme in ("http", "https") and pu.netloc.endswith(base) and LINK_WORDS.search(u + " " + t) and u not in seen:
                    queue.append(u.split("#")[0])
        pages.append(rec)
    hosts = {h: {k: v for k, v in rb.items() if k != "rp"} for h, rb in robots_cache.items() if any(urlparse(p["url"]).netloc == h for p in pages)}
    return {"brand": brand, "pages": pages, "robots": hosts}


def main():
    brands = sys.argv[1:] or list(SEEDS)
    out = {"ua": UA, "max_pages": MAX_PAGES, "brands": [probe(b) for b in brands]}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    for b in out["brands"]:
        got = [p for p in b["pages"] if p.get("status") == 200]
        print(b["brand"], "pages", len(b["pages"]), "ok", len(got), "with prices", sum(1 for p in got if p.get("prices_in_text", 0) >= 5))


if __name__ == "__main__":
    main()
