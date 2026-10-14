"""Shared pieces for the direct scrapers: polite HTTP session, price parsing, CSV output.

Every scraper writes data2/raw/<brand>.csv with RAW_FIELDS and data2/raw/<brand>.log.json (pages, failures).
"""
import csv, datetime, json, os, re, time
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data2", "raw")
os.makedirs(RAW, exist_ok=True)

RAW_FIELDS = ["brand", "branch", "category", "group", "option", "sale", "orig", "addon", "until", "url", "fetched_at"]
# round-2 DATA02: the collector says who it is (it used to present itself as a desktop Chrome browser). A site that refuses
# this name is NOT retried under another one: that brand keeps its previous data (weekly guard) and is reviewed by a person.
UA = "YoonSiljangBot/1.0 (+https://lsy2825.github.io/skin/; weekly public price comparison; robots.txt respected)"


class Fetcher:
    """GET/POST with a minimum gap between requests, retries, and a failure list."""

    def __init__(self, gap=1.0, timeout=25, retries=3):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
        self.gap, self.timeout, self.retries = gap, timeout, retries
        self.last = 0.0
        self.fails = []
        self.count = 0

    def _wait(self):
        d = self.gap - (time.time() - self.last)
        if d > 0:
            time.sleep(d)
        self.last = time.time()

    def get(self, url, method="GET", **kw):
        for attempt in range(1, self.retries + 1):
            self._wait()
            try:
                r = self.s.request(method, url, timeout=self.timeout, **kw)
                self.count += 1
                if r.status_code == 200:
                    r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
                    return r
                err = f"HTTP {r.status_code}"
            except requests.RequestException as e:
                err = type(e).__name__
            time.sleep(2 * attempt)
        self.fails.append({"url": url, "error": err})
        return None


def won(s):
    """'1,290,000원' / '1290000' -> 1290000; anything else -> None."""
    if s is None:
        return None
    d = re.sub(r"[^\d]", "", str(s))
    return int(d) if d else None


def now_iso():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat(timespec="seconds")


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def write_raw(brand, rows, log):
    path = os.path.join(RAW, f"{brand}.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=RAW_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in RAW_FIELDS})
    with open(os.path.join(RAW, f"{brand}.log.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(log, f, ensure_ascii=False, indent=1)
    return path
