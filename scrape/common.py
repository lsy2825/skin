"""Shared pieces for the direct scrapers: polite HTTP session, price parsing, CSV output.

Every scraper writes data2/raw/<brand>.csv with RAW_FIELDS and data2/raw/<brand>.log.json (pages, failures).
"""
import csv, datetime, json, os, re, threading, time, urllib.parse
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
#    scraper, branches.py are separate processes): the last request time per host is kept in data2/.host_clock.json. Inside one
#    process the threads take turns (wait_turn takes the host, stamp gives it back), so a scraper reading several branches of
#    one host at once still sends them one by one, the gap after the end of the one before (2026-10-16 검토).
#  - robots.txt texts read in the last 36 h are kept in data2/.robots_cache.json (sources.py writes it first in every run), so a
#    later step does not ask for the same file again.
#  - A Fetcher(robots=True) asks that rule set before every request and skips a path the file disallows for YoonSiljangBot
#    (RFC 9309: a 4xx answer = no rules, except 401/403/429 = disallowed; no answer or 5xx = treat as disallowed, same as
#    scrape/sources.py).
#  - A page answering 401, 403 or 429 (the site refusing us, or asking us to slow down) is not asked again in the same run.
CLOCK_PATH = os.path.join(ROOT, "data2", ".host_clock.json")
ROBOTS_PATH = os.path.join(ROOT, "data2", ".robots_cache.json")
ROBOTS_MAX_AGE = 36 * 3600
_lock = threading.Lock()
_clock = None                      # host → {"at": last request time, "delay": Crawl-delay}; CLOCK_PATH, read once per process
_busy = {}                         # host → when a request to it (this process) took its turn; stamp() ends the turn
BUSY_MAX = 120                     # a turn not ended in this long (a request is at most 25 s, plus redirects) is given up
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
        pass                       # a read-only disk loses only the memory between steps; this process keeps its own


def _clock_map():
    global _clock
    if _clock is None:
        _clock = {h: {"at": float(v.get("at", 0)), "delay": float(v.get("delay", 0))}
                  for h, v in _load(CLOCK_PATH).items() if isinstance(v, dict)}
    return _clock


def set_delay(host, seconds):
    """remember a host's Crawl-delay. The largest one seen stays: a later robots.txt answer that is not a readable file (429,
    5xx, no answer) must not make the collector forget it"""
    if host and seconds and seconds > 0:
        with _lock:
            e = _clock_map().setdefault(host, {"at": 0.0, "delay": 0.0})
            if seconds > e["delay"]:
                e["delay"] = float(seconds)
                _save(CLOCK_PATH, _clock)


def host_delay(host):
    e = _clock_map().get(host)
    return e["delay"] if e else 0.0


def wait_turn(host):
    """block until a request may go to this host: Crawl-delay seconds since the last request to it ended (any step of this run,
    and an earlier run on the same disk) and no other request to it under way in this process. The turn is taken under the
    lock, so threads that find the gap over at the same moment still go one at a time; stamp() ends the turn"""
    d = host_delay(host)
    if not d:
        return
    while True:
        with _lock:
            now = _now()
            since = _busy.get(host)
            if since is not None and now - since < BUSY_MAX:
                left = min(1.0, d)                 # another thread's request to this host is under way
            else:
                left = _clock_map()[host]["at"] + d - now
                if left <= 0:
                    _busy[host] = now
                    return
        _sleep(min(left, d))


def stamp(host):
    """a request to this host has ended: the Crawl-delay counts from now, and the next request may take its turn"""
    if host_delay(host):
        with _lock:
            _clock_map()[host]["at"] = _now()
            _busy.pop(host, None)
            _save(CLOCK_PATH, _clock)


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


# robots.txt read the same way on every Python (RFC 9309): Python's own robotparser changed between 3.12 (the factory) and 3.13
# (wildcards, Allow/Disallow order), matches user-agent names as substrings ('bot' would catch YoonSiljangBot) and keeps only the
# first group of a name. Here: the group named exactly YoonSiljangBot (case-insensitive, all such groups merged), else '*';
# '*' and '$' in paths; the longest matching rule wins, Allow on a tie; a blank Disallow means nothing.
def robots_group(text):
    """→ (rules [(allow, pattern)], crawl_delay or None) of the group that applies to us"""
    groups, names, in_rules = {}, [], False
    for line in (text or "").lstrip("\ufeff").splitlines():
        line = line.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        k, v = (x.strip() for x in line.split(":", 1))
        k = k.lower()
        if k == "user-agent":
            if in_rules:
                names, in_rules = [], False
            name = v.split("/")[0].strip().lower()
            names.append(name)
            groups.setdefault(name, {"rules": [], "delay": None})
        elif k in ("allow", "disallow", "crawl-delay"):
            in_rules = True
            for n in names:
                g = groups[n]
                if k == "crawl-delay":
                    try:
                        g["delay"] = max(g["delay"] or 0.0, float(v))
                    except ValueError:
                        pass
                elif v:
                    g["rules"].append((k == "allow", v))
    g = groups.get(BOT_NAME.lower()) or groups.get("*") or {"rules": [], "delay": None}
    return g["rules"], g["delay"]


def _rule_re(pattern):
    p = urllib.parse.unquote(pattern)
    end = p.endswith("$")
    return re.compile(re.escape(p[:-1] if end else p).replace(r"\*", ".*") + ("$" if end else ""))


def robots_path_allowed(rules, url):
    u = urlparse(url)
    path = urllib.parse.unquote((u.path or "/") + (f"?{u.query}" if u.query else ""))
    best = None                    # (length, allow)
    for allow, pattern in rules:
        if _rule_re(pattern).match(path):
            cand = (len(pattern), allow)
            if best is None or cand[0] > best[0] or (cand[0] == best[0] and allow):
                best = cand
    return True if best is None else best[1]


def robots_allows(status, text, url):
    """status: HTTP code of robots.txt (0 = no answer). 200 = its rules; 401/403/429 = treat as disallowed (a refusal or a rate
    limit is not 'no file' — the old 리엔장 code skipped such hosts too); other 4xx = no file, nothing disallowed; 5xx or no answer
    = disallowed (RFC 9309: unreachable)"""
    if status == 200:
        return robots_path_allowed(robots_group(text)[0], url)
    if status in (401, 403, 429):
        return False
    return 400 <= status < 500


def robots_delay(status, text):
    return robots_group(text)[1] if status == 200 else None


LONG_DELAY = 30          # seconds of Crawl-delay from which a failed page is not retried in the same run
REFUSED = (401, 403, 429)           # answers that mean 'not you' or 'slow down': no retry in the same run


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
                # no answer at all: keep why ('SSLError', 'ConnectTimeout') so the log still names the cause, not only 'unreadable'
                got = (status, r.text if r is not None and status == 200 else ("" if r is not None else err))
                robots_put(host, *got)
            self._rules[host] = got
            delay = robots_delay(*got)
            if delay:
                set_delay(host, delay)
                if fresh:
                    stamp(host)          # the robots.txt request just made is the first one the delay counts from
        return self._rules[host]

    def get(self, url, method="GET", **kw):
        if self.robots:
            host = urlparse(url).netloc
            status, text = self._robots(host)
            if not robots_allows(status, text, url):
                self.last_error = "robots.txt disallows" if status == 200 else \
                    f"robots.txt unreadable ({'HTTP %d' % status if status else 'no answer' + (': ' + text if text else '')})"
                self.fails.append({"url": url, "error": self.last_error})
                return None
        err = ""
        host = urlparse(url).netloc
        for attempt in range(1, self.retries + 1):
            r, err = self._request(url, method, **kw)
            if r is not None and not err:
                r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
                return r
            # a host that asks for a long Crawl-delay (리엔장 180 s) gets one try per page per run: every retry would wait the
            # whole delay again, and a few failing pages could push the run past its time limit (2026-10-15 검토: up to ~60 min).
            # The page is tried again next run.
            if host_delay(host) >= LONG_DELAY:
                break
            # a refusal or 'too many requests' is not asked again with the same name: the page is tried next run (2026-10-16
            # 검토 — before, 401/403/429 were retried twice like a timeout)
            if r is not None and r.status_code in REFUSED:
                break
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
