"""Shared pieces for the direct scrapers: polite HTTP session, price parsing, CSV output.

Every scraper writes data2/raw/<brand>.csv with RAW_FIELDS and data2/raw/<brand>.log.json (pages, failures).
"""
import csv, datetime, json, os, re, threading, time, urllib.robotparser
from urllib.parse import urlparse
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data2", "raw")
os.makedirs(RAW, exist_ok=True)

RAW_FIELDS = ["brand", "branch", "category", "group", "option", "sale", "orig", "addon", "until", "url", "fetched_at"]
# round-2 DATA02: the collector says who it is (it used to present itself as a desktop Chrome browser). A site that refuses
# this name is NOT retried under another one: that brand keeps its previous data (weekly guard) and is reviewed by a person.
BOT_NAME = "YoonSiljangBot"
# The address a site operator can open to see who is behind the name. The old one (lsy2825.github.io/skin) went away with GitHub
# Pages on 2026-10-15; this is the app itself (interim — behind its lock screen; a contact page or address is the owner's call).
BOT_INFO_URL = "https://yoonsiljang.lsy2825.workers.dev/"
UA = f"{BOT_NAME}/1.0 (+{BOT_INFO_URL}; weekly public price comparison; robots.txt respected)"

# 2026-10-15 (C5 re-check): what the collector does about robots.txt, in one place.
#  - A host's Crawl-delay is a minimum gap between ANY two requests to it, across the steps of one run (sources.py, the price
#    scraper, branches.py are separate processes): the last request time per host is kept in data2/.host_clock.json.
#  - robots.txt texts read in the last 36 h are kept in data2/.robots_cache.json (sources.py writes it first in every run), so a
#    later step does not ask for the same file again.
#  - A Fetcher(robots=True) asks that rule set before every request and skips a path the file disallows for YoonSiljangBot
#    (RFC 9309: a 4xx answer = no rules; no answer or 5xx = treat as disallowed, same as scrape/sources.py).
CLOCK_PATH = os.path.join(ROOT, "data2", ".host_clock.json")
ROBOTS_PATH = os.path.join(ROOT, "data2", ".robots_cache.json")
ROBOTS_MAX_AGE = 36 * 3600
_lock = threading.Lock()
_delays = {}                       # host → Crawl-delay seconds, learned from robots.txt in this process
_now, _sleep = time.time, time.sleep      # replaced by tests


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(path, d):
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(d, f)
        os.replace(tmp, path)
    except OSError:
        pass                       # a read-only checkout only loses the cross-step memory


def set_delay(host, seconds):
    if host and seconds and seconds > 0:
        _delays[host] = float(seconds)


def host_delay(host):
    return _delays.get(host, 0.0)


def wait_turn(host):
    """block until Crawl-delay seconds have passed since the last request to this host (any step of this run)"""
    d = host_delay(host)
    if not d:
        return
    while True:
        with _lock:
            left = _load(CLOCK_PATH).get(host, 0) + d - _now()
        if left <= 0:
            return
        _sleep(min(left, d))


def stamp(host):
    if host_delay(host):
        with _lock:
            clock = _load(CLOCK_PATH)
            clock[host] = _now()
            _save(CLOCK_PATH, clock)


def robots_get(host):
    """cached robots.txt of a host: (status, text) or None when nothing fresh is kept"""
    e = _load(ROBOTS_PATH).get(host)
    if e and _now() - e.get("at", 0) < ROBOTS_MAX_AGE:
        return e.get("status"), e.get("text", "")
    return None


def robots_put(host, status, text):
    with _lock:
        c = _load(ROBOTS_PATH)
        c[host] = {"at": _now(), "status": status, "text": text}
        _save(ROBOTS_PATH, c)


def robots_rules(status, text):
    """→ (RobotFileParser or None, allow_all). status: HTTP code of robots.txt, or 0 for no answer"""
    if status == 200:
        rp = urllib.robotparser.RobotFileParser()
        rp.parse((text or "").splitlines())
        return rp, False
    if 400 <= status < 500:
        return None, True          # no robots.txt: nothing is disallowed
    return None, False             # no answer / 5xx: assume everything is disallowed


def robots_allows(status, text, url):
    rp, allow_all = robots_rules(status, text)
    return allow_all if rp is None else rp.can_fetch(BOT_NAME, url)


class Fetcher:
    """GET/POST with a minimum gap between requests, retries, and a failure list."""

    def __init__(self, gap=1.0, timeout=25, retries=3, robots=False):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
        self.gap, self.timeout, self.retries, self.robots = gap, timeout, retries, robots
        self.last = 0.0
        self.fails = []
        self.count = 0
        self.last_error = ""
        self._rules = {}                 # host → (status, text) for this Fetcher

    def _wait(self, host=""):
        d = self.gap - (time.time() - self.last)
        if d > 0:
            time.sleep(d)
        wait_turn(host)                  # Crawl-delay of that host, counted over every step of the run
        self.last = time.time()

    def _request(self, url, method="GET", **kw):
        """one request with the gaps; → (response or None, error text)"""
        host = urlparse(url).netloc
        self._wait(host)
        try:
            r = self.s.request(method, url, timeout=self.timeout, **kw)
            self.count += 1
            return r, "" if r.status_code == 200 else f"HTTP {r.status_code}"
        except requests.RequestException as e:
            return None, type(e).__name__
        finally:
            stamp(host)

    def _robots(self, host):
        """(status, text) of a host's robots.txt — this Fetcher's memory, the shared cache, or one request; learns Crawl-delay"""
        if host not in self._rules:
            got = robots_get(host)
            fresh = got is None
            if fresh:
                r, err = self._request(f"https://{host}/robots.txt")
                status = r.status_code if r is not None else (int(err.split()[1]) if err.startswith("HTTP ") else 0)
                got = (status, r.text if r is not None and status == 200 else "")
                robots_put(host, *got)
            self._rules[host] = got
            rp, _ = robots_rules(*got)
            if rp is not None:
                set_delay(host, rp.crawl_delay(BOT_NAME))
                if fresh:
                    stamp(host)          # the robots.txt request just made is the first one the delay counts from
        return self._rules[host]

    def get(self, url, method="GET", **kw):
        if self.robots:
            host = urlparse(url).netloc
            status, text = self._robots(host)
            if not robots_allows(status, text, url):
                self.last_error = "robots.txt disallows" if status == 200 else f"robots.txt unreadable ({'HTTP %d' % status if status else 'no answer'})"
                self.fails.append({"url": url, "error": self.last_error})
                return None
        err = ""
        for attempt in range(1, self.retries + 1):
            r, err = self._request(url, method, **kw)
            if r is not None and not err:
                r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
                return r
            time.sleep(2 * attempt)
        self.last_error = err
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
