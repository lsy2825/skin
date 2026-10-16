"""2026-10-15 (C5 re-check): how the collector treats a site's robots.txt and Crawl-delay, with no network.
  - Crawl-delay is a minimum gap between ANY two requests to the host across the steps of a run (the clock file),
  - Fetcher(robots=True) asks the shared robots.txt answer first and skips what it disallows — 리엔장, 쁨 (branch search and
    price pages) and 톡스앤필 (branch list, category and detail pages) read every page that way (2026-10-16),
  - the weekly gate skips only a brand that is blocked or missing from the source check, and the run goes on.
Run: python3 tests/crawl_manners_cases.py — tests/brand_parsers_test.py runs it too, so the PR checks (.github/scripts/pr_checks.sh,
'brand collectors') run it on every PR."""
import os, sys, tempfile, threading, time, types

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
    def __init__(self, status, text="", enc="utf-8", url=""):
        self.status_code, self.text, self.encoding, self.url = status, text, enc, url


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
    common._busy.clear()
    common._slowed.clear()
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
common.stamp("slow.example", end=True)            # that request ended at t=1180
T[0] = 1400
sleeps.clear()
common.wait_turn("slow.example")
ok("after the delay no more waiting", not sleeps, sleeps)
common.stamp("slow.example")                      # a request that did not take the turn …
ok("… does not give back the turn another request holds", "slow.example" in common._busy, common._busy)
common.stamp("slow.example", end=True)
ok("the request that took the turn gives it back", "slow.example" not in common._busy, common._busy)
common.wait_turn("other.example")
ok("a host without a delay never waits, whatever the clock says", not sleeps, sleeps)

# a turn taken and never given back (a caller that did not stamp) is given up after BUSY_MAX, not held for ever
reset()
common.set_delay("stuck.example", 5)
common.wait_turn("stuck.example")                 # takes the turn at t=1000, no stamp
common.wait_turn("stuck.example")
ok("a turn nobody gave back is given up after BUSY_MAX seconds", abs(T[0] - 1000 - common.BUSY_MAX) <= 1, (T[0], len(sleeps)))
common.stamp("stuck.example", end=True)
reset()
common.set_delay("stuck2.example", 180)
common.wait_turn("stuck2.example")                # a stuck request began at t=1000 (the clock had nothing before)
common.wait_turn("stuck2.example")
ok("after a stuck turn is given up, the next request still waits Crawl-delay from when that turn began", T[0] >= 1180, T[0])
common.stamp("stuck2.example", end=True)

# threads reading one host with a Crawl-delay at the same time go one by one (2026-10-16 검토: before, they all went together)
reset()
_fake = common._now, common._sleep, common.time
common._now, common._sleep, common.time = time.time, time.sleep, time
starts, ends = [], []


class SlowNet(Net):
    def request(self, method, url, timeout=0, **kw):
        starts.append(time.time())
        time.sleep(0.05)
        ends.append(time.time())
        return Resp(200, "ok")


try:
    common.set_delay("race.example", 0.2)
    fs = []
    for _ in range(4):
        fr_ = common.Fetcher(gap=0, retries=1)
        fr_.s = SlowNet({})
        fs.append(fr_)
    th = [threading.Thread(target=fr_.get, args=("https://race.example/p",)) for fr_ in fs]
    for x in th:
        x.start()
    for x in th:
        x.join()
finally:
    common._now, common._sleep, common.time = _fake
st, en = sorted(starts), sorted(ends)
ok("four threads on one host with Crawl-delay 0.2 s: each request starts ≥ 0.2 s after the one before ended",
   len(st) == 4 and all(st[k + 1] - en[k] >= 0.19 for k in range(3)), [round(st[k + 1] - en[k], 3) for k in range(len(st) - 1)])

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
for code in (401, 403, 429):
    reset()
    fz = fetcher({f"https://z.example/{code}": Resp(code), "https://z.example/next": Resp(200, "ok")}, retries=3)
    fz.get(f"https://z.example/{code}")
    ok(f"a page answering {code} is asked once, not retried in that fetch",
       sum(1 for _, u in fz.s.log if u == f"https://z.example/{code}") == 1 and fz.last_error == f"HTTP {code}", fz.s.log)
    got = fz.get("https://z.example/next")
    if code == 429:
        ok("after a 429 nothing more is asked of that host in this run", got is None
           and all(u != "https://z.example/next" for _, u in fz.s.log) and "429" in fz.last_error, fz.s.log)
    else:
        ok(f"a {code} on one page does not stop other pages of the host", got is not None, fz.s.log)
reset()

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


def patch(mod, net):
    """mod.Fetcher → real Fetchers on one fake network (so its log has every request in order); → kwargs of each one made"""
    made_ = []

    def make(*a, **kw):
        made_.append(kw)
        fr_ = common.Fetcher(*a, **kw)
        fr_.s = net
        return fr_
    mod.Fetcher = make
    return made_


# --- 쁨 asks the robots.txt answer before the branch search and before the price page (2026-10-16)
import ppeum  # noqa: E402

reset()
ppeum.MAX_N, ppeum.EXTRA_SUBS = 3, ["changwon"]
P = "https://www.ppeum{}.com"
net = Net({P.format(1) + "/robots.txt": Resp(200, "User-agent: *\nAllow: /\n"),
           P.format(1) + "/": Resp(200, "<title>강남점 | 쁨</title>", url="https://gangnam.ppeum.com/"),
           P.format(2) + "/robots.txt": Resp(200, "User-agent: *\nAllow: /\n\nUser-agent: YoonSiljangBot\nDisallow: /\n"),
           P.format(2) + "/": Resp(200, "<title>잠실점</title>", url="https://jamsil.ppeum.com/"),
           P.format(3) + "/robots.txt": Resp(503),
           P.format(3) + "/": Resp(200, "<title>부산점</title>", url="https://busan.ppeum.com/"),
           "https://changwon.ppeum.com/robots.txt": Resp(404),
           "https://changwon.ppeum.com/": Resp(200, "<title>예쁨주의쁨의원</title>", url="https://changwon.ppeum.com/")})
fd = common.Fetcher(gap=0.5, retries=1, robots=True)
fd.s = net
found = {b["n"]: b for b in ppeum.discover(fd)}
urls = [u for _, u in net.log]
ok("쁨 지점 찾기: robots.txt first, then the home", urls[:2] == [P.format(1) + "/robots.txt", P.format(1) + "/"]
   and found[1]["kind"] == "new" and found[1]["name"] == "강남점", (urls, found.get(1)))
ok("쁨 지점 찾기: a home robots.txt disallows for YoonSiljangBot is not requested; the branch is skipped with the reason",
   P.format(2) + "/" not in urls and found[2]["kind"] == "dead" and found[2]["error"] == "robots.txt disallows", (urls, found.get(2)))
ok("쁨 지점 찾기: a home whose robots.txt answers 5xx is not requested either (unreadable = disallowed)",
   P.format(3) + "/" not in urls and found[3]["kind"] == "dead" and "unreadable" in found[3]["error"], found.get(3))
ok("쁨 지점 찾기: no robots.txt (404) = the home is read", found["changwon"]["kind"] == "new" and found["changwon"]["name"] == "창원점", found.get("changwon"))
made_p = patch(ppeum, net)
_, got, log = ppeum.scrape(found[2], 1.0)
ok("쁨: a branch skipped by robots.txt keeps that reason in the collector log (not 'site not answering')",
   got == [] and log["error"] == "robots.txt disallows", log)
net.answers["https://gangnam.ppeum.com/robots.txt"] = Resp(200, "User-agent: *\nDisallow: /selectSurgery\n")
net.answers["https://gangnam.ppeum.com/selectSurgery"] = Resp(200, "<html></html>")
_, got, log = ppeum.scrape(found[1], 1.0)
urls = [u for _, u in net.log]
ok("쁨 가격 쪽: checked on its own host (where the home redirected) — disallowed there = not requested, logged",
   got == [] and "https://gangnam.ppeum.com/robots.txt" in urls and "https://gangnam.ppeum.com/selectSurgery" not in urls
   and log["fails"] == [{"url": "https://gangnam.ppeum.com/selectSurgery", "error": "robots.txt disallows"}]
   and made_p and all(m.get("robots") is True for m in made_p), (log, made_p))

# --- 톡스앤필 asks it before the branch list, every category page and every detail page (2026-10-16)
import toxnfill  # noqa: E402

reset()
S = "https://www.toxnfill9.com"
net = Net({S + "/robots.txt": Resp(200, "User-agent: *\nDisallow: /serviceInfo.php?c=7\n"),
           S + "/serviceInfo.php?c=": Resp(200, '<a href="serviceInfo.php?c=1">보톡스</a><a href="serviceInfo.php?c=7">필러</a>'),
           S + "/serviceInfo.php?c=1": Resp(200, '<a href="detail.php?c=1&amp;i=10"><b>사각턱 보톡스</b><span class="txt_num">50,000</span></a>'),
           S + "/serviceInfo.php?c=7": Resp(200, '<a href="detail.php?c=7&amp;i=70"><b>코 필러</b><span class="txt_num">99,000</span></a>'),
           S + "/detail.php?c=1&i=10": Resp(200, '<div class="name_price_container"><h2 class="name">사각턱 보톡스</h2></div>'
                                                 '<li class="treatment_item"><p class="name">50유닛</p><div class="treatment_price_wrap">'
                                                 '<span class="price"><strong>50,000</strong></span><del><b>90,000</b></del></div></li>')})
made_t = patch(toxnfill, net)
_, got, log = toxnfill.scrape_branch("홍대점", S, 0.7)
urls = [u for _, u in net.log]
ok("톡스앤필: robots.txt is asked once, before the first page of the site", urls[0] == S + "/robots.txt" and urls.count(S + "/robots.txt") == 1, urls)
ok("톡스앤필: a category page robots.txt disallows is not requested; the other categories are still read",
   S + "/serviceInfo.php?c=7" not in urls and [(r["option"], r["sale"], r["orig"]) for r in got] == [("50유닛", 50000, 90000)], (urls, got))
ok("톡스앤필: ... and the log says which page was skipped and why (that branch counts as 'with failures')",
   log["fails"] == [{"url": S + "/serviceInfo.php?c=7", "error": "robots.txt disallows"}] and log["ok"] is False
   and made_t and all(m.get("robots") is True for m in made_t), log)
reset()
net = Net({S + "/robots.txt": Resp(503), S + "/serviceInfo.php?c=": Resp(200, '<a href="serviceInfo.php?c=1">보톡스</a>')})
patch(toxnfill, net)
_, got, log = toxnfill.scrape_branch("홍대점", S, 0.7)
ok("톡스앤필: a site whose robots.txt cannot be read (5xx) is skipped after that one request (no category list)",
   got == [] and log["error"] == "no category list" and [u for _, u in net.log] == [S + "/robots.txt"]
   and "unreadable" in log["fails"][0]["error"], (log, net.log))
reset()
net = Net({"https://www.toxnfill1.com/robots.txt": Resp(200, "User-agent: *\nDisallow: /serviceInfo.php\n")})
fb = common.Fetcher(retries=1, robots=True)
fb.s = net
try:
    toxnfill.branch_sites(fb)
    stopped = ""
except SystemExit as e:
    stopped = str(e)
ok("톡스앤필: a branch list robots.txt disallows is not requested and stops the run with the reason (scrape/branches.py stops "
   "the same way, the old branches.csv stays)", "robots.txt disallows" in stopped and [u for _, u in net.log] == ["https://www.toxnfill1.com/robots.txt"],
   (stopped, net.log))

# --- several branches on one host (쁨's old sites on event.ppeum.com) starting at once ask its robots.txt once
reset()
_fake = common._now, common._sleep, common.time
common._now, common._sleep, common.time = time.time, time.sleep, time


class SlowRobots(Net):
    def request(self, method, url, timeout=0, **kw):
        if url.endswith("/robots.txt"):
            time.sleep(0.05)
        return super().request(method, url, timeout, **kw)


try:
    net = SlowRobots({"https://event.example/robots.txt": Resp(200, "User-agent: *\nAllow: /\n"), "https://event.example/p": Resp(200, "ok")})
    fs = []
    for _ in range(4):
        fr_ = common.Fetcher(gap=0, retries=1, robots=True)
        fr_.s = net
        fs.append(fr_)
    th = [threading.Thread(target=fr_.get, args=("https://event.example/p",)) for fr_ in fs]
    for x in th:
        x.start()
    for x in th:
        x.join()
finally:
    common._now, common._sleep, common.time = _fake
urls = [u for _, u in net.log]
ok("four Fetchers in parallel threads on one host: its robots.txt is asked once, every page is still read",
   urls.count("https://event.example/robots.txt") == 1 and urls.count("https://event.example/p") == 4, urls)
reset()

# the registry's rate text (shown on the app's 정보 screen) says what each chain really does (2026-10-16 검토: a check that only
# looked for the numbers somewhere in the file passed '쁨 1초 간격', a gap that never applies). What each chain does:
#   gap     the --gap of the branch Fetcher, written only where a branch Fetcher makes more than one request
#   workers the --workers default (None = one branch after another)
#   extra   other gaps that apply: 쁨's branch search Fetcher(gap=0.5)
#   delay   the chain waits out the site's Crawl-delay (리엔장)
#   robots  every Fetcher of the collector is Fetcher(..., robots=True): each request asks the robots.txt answer first
import re  # noqa: E402
import sources  # noqa: E402

DOES = {"velyb": dict(gap=1.0), "ppeum": dict(workers=4, extra=[0.5], one_page=True, robots=True),
        "toxnfill": dict(gap=0.7, workers=6, robots=True),
        "lienjang": dict(delay=True, robots=True), "forever": dict(gap=0.8, workers=4), "vands": dict(gap=1.0, workers=6),
        "uandi": dict(workers=6, one_page=True), "daybeau": dict(gap=1.0, workers=6), "drevers": dict(gap=1.0, workers=6),
        "cellin": dict(gap=1.0, workers=4)}
ok("every registry chain has a line in this test", set(DOES) == set(sources.REGISTRY), set(DOES) ^ set(sources.REGISTRY))
for key, reg in sources.REGISTRY.items():
    e, rate = DOES.get(key, {}), reg["rate"]
    code = open(os.path.join(ROOT, "scrape", f"{key}.py"), encoding="utf-8").read()
    d_gap = re.findall(r'"--gap",[^)]*default=([\d.]+)', code)
    d_workers = re.findall(r'"--workers",[^)]*default=(\d+)', code)
    made_f = re.findall(r"\bFetcher\(([^()]*)\)", code)
    code_ok = ((not e.get("gap") or [float(x) for x in d_gap] == [e["gap"]])
               and ([int(x) for x in d_workers] == ([e["workers"]] if e.get("workers") else []))
               and all(re.search(r"\bFetcher\(gap=" + re.escape(f"{x:g}") + r"[,)]", code) for x in e.get("extra", []))
               and (not e.get("delay") or "robots=True" in code)
               and (not e.get("robots") or (made_f and all("robots=True" in m for m in made_f))))
    ok(f"scrape/{key}.py does what this test says ({e})", code_ok, (d_gap, d_workers, made_f))
    said_gap = sorted(float(x) for x in re.findall(r"최소 ([\d.]+)초", rate))
    said_workers = [int(x) for x in re.findall(r"(\d+)곳 동시", rate)]
    text_ok = (said_gap == sorted(([e["gap"]] if e.get("gap") else []) + e.get("extra", []))
               and said_workers == ([e["workers"]] if e.get("workers") else [])
               and (e.get("workers") or "하나씩" in rate) and (not e.get("delay") or "Crawl-delay" in rate)
               and (not e.get("one_page") or "1쪽" in rate) and "req/s" not in rate and "간격," not in rate)
    ok(f"sources.py REGISTRY rate of {key} says what the code does ({rate})", text_ok, (said_gap, said_workers, e))

print("crawl manners", "OK" if not fails else f"{fails} FAIL")
sys.exit(1 if fails else 0)
