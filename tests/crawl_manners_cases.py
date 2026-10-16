"""2026-10-15 (C5 re-check): how the collector treats a site's robots.txt and Crawl-delay, with no network.
  - Crawl-delay is a minimum gap between ANY two requests to the host across the steps of a run (the clock file),
  - Fetcher(robots=True) asks the shared robots.txt answer first and skips what it disallows,
  - the weekly gate skips only a brand that is blocked or missing from the source check, and the run goes on.
Run: python3 tests/crawl_manners_cases.py — tests/brand_parsers_test.py runs it too, so the PR checks (.github/scripts/pr_checks.sh,
'brand collectors') run it on every PR."""
import os, sys, tempfile, types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scrape"))
sys.path.insert(0, os.path.join(ROOT, "build2"))
import common  # noqa: E402

fails = 0


def ok(name, cond, extra=""):
    global fails
    fails += not cond
    print(("PASS" if cond else "FAIL"), "|", name, "|", "" if cond else extra)


tmp = tempfile.mkdtemp()
common.CLOCK_PATH = os.path.join(tmp, "clock.json")
common.ROBOTS_PATH = os.path.join(tmp, "robots.json")
T = [1000.0]
sleeps = []


def fake_sleep(s):
    sleeps.append(s)
    T[0] += s


common._now = lambda: T[0]
common._sleep = fake_sleep
common.time = types.SimpleNamespace(time=lambda: T[0], sleep=fake_sleep)


class Resp:
    def __init__(self, status, text="", enc="utf-8"):
        self.status_code, self.text, self.encoding = status, text, enc


class Net:
    """a stand-in for requests.Session: answers by URL, remembers every request with the time it was made"""

    def __init__(self, answers):
        self.answers, self.log = answers, []
        self.headers = {}

    def request(self, method, url, timeout=0, **kw):
        self.log.append((T[0], url))
        a = self.answers.get(url, Resp(404))
        if isinstance(a, Exception):
            raise a
        return a


def fetcher(answers, **kw):
    f = common.Fetcher(gap=0, retries=kw.pop("retries", 1), **kw)
    f.s = Net(answers)
    return f


def reset():
    for p in (common.CLOCK_PATH, common.ROBOTS_PATH):
        if os.path.exists(p):
            os.remove(p)
    common._clock = None
    sleeps.clear()
    T[0] = 1000.0


# --- identity
ok("the name says who we are and does not point at the Pages address that is gone", common.BOT_NAME in common.UA and "github.io" not in common.UA, common.UA)

# --- Crawl-delay clock
reset()
common.set_delay("slow.example", 180)
common.stamp("slow.example")                      # a request made at t=1000
T[0] = 1100
common.wait_turn("slow.example")
ok("a host with Crawl-delay 180 is not asked again before 180 s have passed (waited the missing 80 s)", abs(sum(sleeps) - 80) < 1e-6 and T[0] == 1180, (sleeps, T[0]))
sleeps.clear()
common.wait_turn("slow.example")
ok("after the delay no more waiting", not sleeps, sleeps)
common.wait_turn("other.example")
ok("a host without a delay never waits, whatever the clock says", not sleeps, sleeps)

# --- gate: robots.txt answers
reset()
RB = "https://h.example/robots.txt"
f = fetcher({RB: Resp(200, "User-agent: *\nDisallow: /private/\nCrawl-delay: 180\n"), "https://h.example/ok": Resp(200, "fine"),
             "https://h.example/private/x": Resp(200, "no")}, robots=True)
r1 = f.get("https://h.example/ok")
t_robots = next(t for t, u in f.s.log if u == RB)
t_page = next(t for t, u in f.s.log if u == "https://h.example/ok")
ok("allowed path is fetched", r1 is not None and r1.text == "fine")
ok("the page request waited Crawl-delay after the robots.txt request (same host, same run)", t_page - t_robots >= 180, (t_robots, t_page))
r2 = f.get("https://h.example/private/x")
ok("a disallowed path is not requested", r2 is None and all(u != "https://h.example/private/x" for _, u in f.s.log) and f.last_error == "robots.txt disallows", (f.last_error, f.s.log))
ok("robots.txt was asked for once for the host", sum(1 for _, u in f.s.log if u == RB) == 1)

reset()
f2 = fetcher({RB: Resp(200, "User-agent: *\nAllow: /\n\nUser-agent: YoonSiljangBot\nDisallow: /\n"), "https://h.example/ok": Resp(200, "x")}, robots=True)
ok("a rule written for our own name wins over '*'", f2.get("https://h.example/ok") is None and f2.last_error == "robots.txt disallows")

reset()
f3 = fetcher({RB: Resp(404), "https://h.example/ok": Resp(200, "x")}, robots=True)
ok("no robots.txt (4xx) = nothing is disallowed", f3.get("https://h.example/ok") is not None)

reset()
f4 = fetcher({RB: Resp(503), "https://h.example/ok": Resp(200, "x")}, robots=True)
ok("robots.txt answers 5xx = assume disallowed (same as the source check)", f4.get("https://h.example/ok") is None and "unreadable" in f4.last_error and all(u == RB for _, u in f4.s.log), (f4.last_error, f4.s.log))

reset()
import requests  # noqa: E402
f5 = fetcher({RB: requests.ConnectionError("down"), "https://h.example/ok": Resp(200, "x")}, robots=True)
ok("no answer at all = assume disallowed", f5.get("https://h.example/ok") is None and "unreadable" in f5.last_error)

ok("... and the log keeps why it had no answer (ConnectionError, SSLError), not only 'unreadable'", "ConnectionError" in f5.last_error, f5.last_error)

# --- a long Crawl-delay host is not retried in the same run (each retry would wait the whole delay)
reset()
fr = fetcher({RB: Resp(200, "User-agent: *\nCrawl-delay: 180\n"), "https://h.example/p": Resp(500)}, robots=True, retries=3)
ok("Crawl-delay 180 + a 500 page = one try, the next run tries again", fr.get("https://h.example/p") is None
   and sum(1 for _, u in fr.s.log if u == "https://h.example/p") == 1 and fr.last_error == "HTTP 500", (fr.last_error, fr.s.log))
reset()
fq = fetcher({"https://q.example/p": Resp(500)}, retries=3)
fq.get("https://q.example/p")
ok("a host without a long delay still gets its retries", sum(1 for _, u in fq.s.log if u == "https://q.example/p") == 3, fq.s.log)

# --- shared robots answer between steps
reset()
common.robots_put("h.example", 200, "User-agent: *\nDisallow: /nope/\nCrawl-delay: 120\n")
f6 = fetcher({"https://h.example/ok": Resp(200, "x")}, robots=True)
f6.get("https://h.example/ok")
ok("a robots.txt answer from an earlier step is reused (no second request)", all(u != RB for _, u in f6.s.log), f6.s.log)
ok("... and its Crawl-delay is known to this step", common.host_delay("h.example") == 120.0, common._clock)
T[0] += common.ROBOTS_MAX_AGE + 1
f7 = fetcher({RB: Resp(200, "User-agent: *\nAllow: /\n"), "https://h.example/ok": Resp(200, "x")}, robots=True)
f7.get("https://h.example/ok")
ok("an answer older than 36 h is asked for again", any(u == RB for _, u in f7.s.log))

# --- refusals and rate limits; the delay is not forgotten
reset()
common.set_delay("h.example", 180)
common.stamp("h.example")
for code in (403, 429, 401):
    common._clock = None                               # a new step reads the clock file again
    fx = fetcher({RB: Resp(code), "https://h.example/ok": Resp(200, "x")}, robots=True)
    ok(f"robots.txt answers {code} = treat as disallowed", fx.get("https://h.example/ok") is None and "unreadable" in fx.last_error, fx.last_error)
ok("... and the Crawl-delay learned earlier is kept (a non-file answer does not erase it)", common.host_delay("h.example") == 180)
T[0] += 10
sleeps.clear()
common._clock = None
os.remove(common.ROBOTS_PATH)                      # a new run: no cached answer, so robots.txt itself is asked for again
fy = fetcher({RB: Resp(200, "User-agent: *\nAllow: /\n"), "https://h.example/ok": Resp(200, "x")}, robots=True)
fy.get("https://h.example/ok")
ok("the next run's first request (robots.txt) still waits out the remembered delay", sum(sleeps) >= 170, sleeps)

# --- robots.txt read the same on every Python (RFC 9309)
ga = lambda txt, path: common.robots_allows(200, txt, "https://h.example" + path)
ok("'Disallow: /*' blocks everything", not ga("User-agent: *\nDisallow: /*\n", "/a"))
ok("the longest rule wins: Allow /map.php over Disallow /", ga("User-agent: *\nDisallow: /\nAllow: /map.php\n", "/map.php") and not ga("User-agent: *\nDisallow: /\nAllow: /map.php\n", "/x"))
ok("same length: Allow wins", ga("User-agent: *\nDisallow: /a\nAllow: /a\n", "/a"))
ok("'Allow: /' then 'Disallow: /map.php' blocks /map.php", not ga("User-agent: *\nAllow: /\nDisallow: /map.php\n", "/map.php"))
ok("wildcard in the middle (리엔장 '/*?testpage=*')", not ga("User-agent: *\nDisallow: /*?testpage=*\n", "/agree/info?testpage=1") and ga("User-agent: *\nDisallow: /*?testpage=*\n", "/agree/info"))
ok("'$' ends the pattern", not ga("User-agent: *\nDisallow: /*.pdf$\n", "/a.pdf") and ga("User-agent: *\nDisallow: /*.pdf$\n", "/a.pdf?x=1"))
ok("a group called 'bot' is not ours (no substring match)", not ga("User-agent: bot\nAllow: /\n\nUser-agent: *\nDisallow: /\n", "/a"))
ok("two '*' groups are merged, with their Crawl-delay", common.robots_delay(200, "User-agent: *\nDisallow: /x\n\nUser-agent: *\nCrawl-delay: 1.5\n") == 1.5
   and not ga("User-agent: *\nDisallow: /x\n\nUser-agent: *\nCrawl-delay: 1.5\n", "/x"))
ok("a byte-order mark at the start does not hide the first line", not ga("\ufeffUser-agent: *\nDisallow: /\n", "/a"))
ok("our own group with a version ('YoonSiljangBot/1.0') counts as ours", not ga("User-agent: YoonSiljangBot/1.0\nDisallow: /\n\nUser-agent: *\nAllow: /\n", "/a"))

# --- the other scrapers are unchanged: no robots request unless asked for
reset()
f8 = fetcher({"https://h.example/ok": Resp(200, "x")})
f8.get("https://h.example/ok")
ok("Fetcher() without robots=True makes only the one request", [u for _, u in f8.s.log] == ["https://h.example/ok"], f8.s.log)

# --- source check: robots answer is written for later steps; asked as our own name
import sources  # noqa: E402

reset()
f9 = fetcher({RB: Resp(200, "User-agent: *\nAllow: /\nCrawl-delay: 180\n")})
e = sources.robots(f9, "h.example", ["/event/"])
ok("source check records the Crawl-delay and starts the clock", e["crawl_delay"] == 180 and common.host_delay("h.example") == 180 and "h.example" in common._load(common.CLOCK_PATH), e)
ok("... and leaves the answer for the next step", common.robots_get("h.example") is not None)
reset()
f10 = fetcher({RB: Resp(200, "User-agent: *\nAllow: /\n\nUser-agent: YoonSiljangBot\nDisallow: /event/\n")})
ok("source check asks as YoonSiljangBot, not only '*'", sources.robots(f10, "h.example", ["/event/"])["allowed"] is False)

# --- source check: its own sample pages go through the answer it just recorded
for code, rtext, label in [(503, "", "5xx"), (429, "", "429"), (200, "User-agent: *\nDisallow: /\n", "Disallow: /")]:
    reset()
    fs = fetcher({RB: Resp(code, rtext), "https://h.example/event/1": Resp(200, "VAT 별도")})
    sources.robots(fs, "h.example", ["/event/1"])
    ev, ds = sources.read_samples(fs, "x", ["https://h.example/event/1"], ["https://h.example/event/1"])
    ok(f"source check does not read sample pages on a host it records as not to be scraped ({label})",
       ev == [] and all(u == RB for _, u in fs.s.log) and fs.robots is False, fs.s.log)
reset()
fs = fetcher({RB: Resp(200, "User-agent: *\nAllow: /\n"), "https://h.example/event/1": Resp(200, "부가세 10% 별도")})
sources.robots(fs, "h.example", ["/event/1"])
ev, ds = sources.read_samples(fs, "x", ["https://h.example/event/1"], [])
ok("... and still reads them where robots.txt allows (no second robots.txt request)", len(ev) == 1 and sum(1 for _, u in fs.s.log if u == RB) == 1, (ev, fs.s.log))

# --- weekly gate
import weekly  # noqa: E402

ok("gate: allowed brand", weekly.gate({"a": {"allowed": True}}, "a") == "")
ok("gate: robots.txt blocks", weekly.gate({"a": {"allowed": False}}, "a") == "blocked")
ok("gate: brand missing from the source check is skipped, not scraped", weekly.gate({"b": {"allowed": True}}, "a") == "no_record")

# --- lienjang goes through the gate; branches stops when its first page is not readable
import lienjang  # noqa: E402

made = []


class FakeFetcher:
    def __init__(self, *a, **kw):
        made.append(kw)
        self.fails = [{"url": "u", "error": "robots.txt disallows"}]
        self.last_error = "robots.txt disallows"

    def get(self, url, **kw):
        return None


lienjang.Fetcher = FakeFetcher
lienjang.write_raw = lambda *a, **k: "x"
lienjang.main()
ok("lienjang reads every host through Fetcher(robots=True)", made and all(m.get("robots") is True for m in made), made)
import branches  # noqa: E402

try:
    branches.velyb(FakeFetcher())
    raised = False
except SystemExit:
    raised = True
ok("branches: an unreadable 블리비 address page stops the step (the old branches.csv stays)", raised)

# the registry's rate text (shown on the app's 정보 screen) states the code's own numbers
import re  # noqa: E402
import sources  # noqa: E402

for key, reg in sources.REGISTRY.items():
    code = open(os.path.join(ROOT, "scrape", f"{key}.py"), encoding="utf-8").read()
    gaps = {float(x) for x in re.findall(r'"--gap",[^)]*default=([\d.]+)', code) + re.findall(r"Fetcher\(gap=([\d.]+)", code)}
    workers = {int(x) for x in re.findall(r'"--workers",[^)]*default=(\d+)', code)}
    said_gap = {float(x) for x in re.findall(r"([\d.]+)초 간격", reg["rate"])}
    said_workers = {int(x) for x in re.findall(r"(\d+)곳 동시", reg["rate"])}
    ok(f"sources.py REGISTRY rate of {key} matches scrape/{key}.py ({reg['rate']})",
       said_gap <= gaps and said_workers <= workers and (said_workers or "하나씩" in reg["rate"] or not workers)
       and "req/s" not in reg["rate"], (gaps, workers, reg["rate"]))

print("crawl manners", "OK" if not fails else f"{fails} FAIL")
sys.exit(1 if fails else 0)
