"""Raw pages (scripts kept) for working out how a site loads its price list — 2026-10-15: 셀린 fills the list by script, so
the lean pages of probe.py showed no prices. Runs on a GitHub runner (probe-brands.yml, task 'raw'): robots.txt first
(YoonSiljangBot, probe.allowed), 1 request/s per site. Saves each page as fetched plus the script files it loads from the
same site, and lists the request URLs that appear in its scripts (ajax/fetch/url: '…'). Then, when RAW_FOLLOW=1, fetches
those same-site URLs with GET if robots.txt allows them. Reading only; output for a person to read, not data.
  RAW_URLS='https://…,https://…' python scrape/raw_probe.py
"""
import json, os, re
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
import probe
from common import UA

OUT = os.path.join(os.environ.get("PROBE_OUT", "probe_out"), "raw_pages")
URLS = [u for u in os.environ.get("RAW_URLS", "").split(",") if u]
FOLLOW = os.environ.get("RAW_FOLLOW") == "1"
REQ = re.compile(r"""(?:url\s*:\s*|\.(?:get|post|load|getJSON)\(\s*|fetch\(\s*|action\s*=\s*)["']([^"'\s]{3,200}?\.(?:php|asp|aspx|jsp|json|html?)(?:\?[^"'\s]*)?)["']""", re.I)
MAX = 40
# never followed: anything that submits or acts (forms, contact/ask handlers, sign-in, orders) — reading only
ACTS = re.compile(r"proc|contact|ask|login|logout|member|join|order|pay|insert|write|save|delete|update|reserv|regist|send|mail", re.I)


def main():
    os.makedirs(OUT, exist_ok=True)
    pages, follow, n = [], [], 0
    def save(url, why):
        nonlocal n
        ok, rb = probe.allowed(url)
        rec = {"url": url, "why": why, "robots": rb}
        if not ok:
            pages.append(dict(rec, skipped=True))
            return None
        r, err = probe.get(url)
        if r is None:
            pages.append(dict(rec, error=err))
            return None
        fn = f"{n:02d}" + (".js" if url.split("?")[0].endswith(".js") else ".html")
        n += 1
        open(os.path.join(OUT, fn), "w", encoding="utf-8").write(r.text)
        pages.append(dict(rec, status=r.status_code, final_url=r.url, file=fn, bytes=len(r.content), content_type=r.headers.get("content-type", "")))
        return r
    for u in URLS:
        r = save(u, "seed")
        if not r or r.status_code != 200:
            continue
        host = urlparse(r.url).netloc
        soup = BeautifulSoup(r.text, "html.parser")
        srcs = [urljoin(r.url, s["src"]) for s in soup.find_all("script", src=True)]
        local = [s for s in srcs if urlparse(s).netloc == host][:6]
        texts = [r.text]
        for s in local:
            if len(pages) >= MAX:
                break
            rs = save(s, f"script of {u}")
            if rs and rs.status_code == 200:
                texts.append(rs.text)
        for t in texts:
            for m in REQ.finditer(t):
                v = urljoin(r.url, m.group(1))
                if urlparse(v).netloc == host and v not in follow and not ACTS.search(urlparse(v).path):
                    follow.append(v)
    # RAW_POST='url|key=v&…;…' — the same read request a page sends when an item is clicked (셀린 _contentDetail.php idx=…);
    # at most 3, never to an address that acts (ACTS), robots.txt first
    for spec in [x for x in os.environ.get("RAW_POST", "").split(";") if x][:3]:
        url, _, form = spec.partition("|")
        ok, rb = probe.allowed(url)
        rec = {"url": url, "why": "POST " + form, "robots": rb}
        if not ok or ACTS.search(urlparse(url).path):
            pages.append(dict(rec, skipped=True))
            continue
        probe.get(url.rsplit("/", 1)[0] + "/")       # keeps the 1 request/s spacing per site (probe.get records the time)
        try:
            r = probe.session.post(url, data=dict(x.split("=", 1) for x in form.split("&") if "=" in x), timeout=25)
            r.encoding = r.apparent_encoding or "utf-8"
            fn = f"{n:02d}.post.html"
            n += 1
            open(os.path.join(OUT, fn), "w", encoding="utf-8").write(r.text)
            pages.append(dict(rec, status=r.status_code, file=fn, bytes=len(r.content)))
        except Exception as e:
            pages.append(dict(rec, error=type(e).__name__))
    if FOLLOW:
        for v in follow[:12]:
            if len(pages) < MAX:
                save(v, "request url seen in a script")
    json.dump({"ua": UA, "pages": pages, "request_urls": follow}, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(len(pages), "pages;", len(follow), "request urls:", follow[:12])


if __name__ == "__main__":
    main()
