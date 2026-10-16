#!/usr/bin/env python3
"""Monitoring alerts (.github/scripts/telegram.py, health_check.py): the bot token never reaches stdout/stderr, a send
failure never fails the step, and the checks find what they should. No network: Telegram is a fake server on 127.0.0.1
or a fake urlopen; GitHub, the app and Workers are a fake fetch. Prints PASS/FAIL lines; exit 1 on any failure.
Run: python3 tests/security/monitor_test.py
Kept in tests/security/ because the main property is a secret-handling one, next to scan_secrets.py (same suite)."""
import contextlib, datetime, http.server, io, json, os, re, socket, subprocess, sys, tempfile, threading, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS = os.path.join(ROOT, ".github", "scripts")
sys.path.insert(0, SCRIPTS)
import telegram, health_check as hc  # noqa: E402

# token-shaped test values built at run time (no literal that a secret scanner or a reader could mistake for a real one)
TOKENS = ["1234567" + "89:" + "Q" * 35, "fake" + "-tok-" + "zz9"]
fails = 0


def check(name, ok, detail=""):
    global fails
    fails += not ok
    print(("PASS" if ok else "FAIL"), name, ("— " + detail) if detail and not ok else "")


# ---------- fake Telegram server ----------

class Fake(http.server.BaseHTTPRequestHandler):
    plan, seen = [], []

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        Fake.seen.append((self.path, json.loads(body)))
        status, reply = Fake.plan.pop(0) if Fake.plan else (200, {"ok": True, "result": {}})
        data = json.dumps(reply).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def run_sender(token, plan, text="가격 공장 실패 테스트", base=BASE, extra_env=None):
    Fake.plan, Fake.seen = list(plan), []
    env = {k: v for k, v in os.environ.items() if not k.startswith("TELEGRAM_")}
    env.update({"NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost", "PYTHONUTF8": "1",
                "TELEGRAM_API_BASE": base, **(extra_env or {})})
    if token:
        env.update({"TELEGRAM_BOT_TOKEN": token, "TELEGRAM_CHAT_ID": "-1001234"})
    p = subprocess.run([sys.executable, os.path.join(SCRIPTS, "telegram.py"), "-"], input=text, env=env,
                       capture_output=True, text=True, timeout=60)
    return p, list(Fake.seen)


# ---------- telegram.py as a process ----------

p, seen = run_sender(None, [])
check("secrets missing → one ::notice, exit 0, nothing sent", p.returncode == 0 and "::notice" in p.stdout and not seen, p.stdout + p.stderr)

for token in TOKENS:
    tag = "real-shaped" if ":" in token else "odd-shaped"
    cases = [
        ("200 ok", [(200, {"ok": True, "result": {}})], 1, "보냈어요"),
        ("401", [(401, {"ok": False, "error_code": 401, "description": "Unauthorized"})], 1, "봇 토큰"),
        ("400 chat not found", [(400, {"ok": False, "error_code": 400, "description": "Bad Request: chat not found"})], 1, "TELEGRAM_CHAT_ID"),
        ("400 migrated", [(400, {"ok": False, "description": "Bad Request: group chat was upgraded", "parameters": {"migrate_to_chat_id": -100777}})], 1, "새 번호"),
        ("429 then ok (retry once after retry_after)", [(429, {"ok": False, "description": "Too Many Requests", "parameters": {"retry_after": 1}}), (200, {"ok": True})], 2, "보냈어요"),
        ("429 twice → warning after one retry", [(429, {"ok": False, "parameters": {"retry_after": 1}})] * 2, 2, "::warning"),
        ("500 twice → warning after one retry", [(500, {"ok": False, "description": "Internal"})] * 2, 2, "::warning"),
        ("error description echoing the token is redacted", [(400, {"ok": False, "description": f"bad /bot{token}/sendMessage"})], 1, "***"),
    ]
    for name, plan, n_req, expect in cases:
        p, seen = run_sender(token, plan)
        out = p.stdout + p.stderr
        ok = (p.returncode == 0 and token not in out and len(seen) == n_req and expect in out
              and all("parse_mode" not in b and b["text"] and b["link_preview_options"] == {"is_disabled": True} for _, b in seen))
        check(f"telegram {tag} token: {name}: exit 0, {n_req} request(s), token not printed", ok, out[-300:])
    p, seen = run_sender(token, [], base=f"http://127.0.0.1:{free_port()}")
    out = p.stdout + p.stderr
    check(f"telegram {tag} token: connection refused → retry once, ::warning, exit 0, token not printed",
          p.returncode == 0 and "::warning" in out and token not in out and "다시 보내요" in out, out[-300:])

p, seen = run_sender(TOKENS[0], [], text="x" * 9000 + "\n" + TOKENS[0])
check("long text is cut to the Telegram limit; a token inside the text is not sent",
      len(seen) == 1 and telegram.utf16_len(seen[0][1]["text"]) <= telegram.LIMIT and TOKENS[0] not in seen[0][1]["text"])
p, seen = run_sender(TOKENS[0], [], base="http://example.com")
check("TELEGRAM_API_BASE other than api.telegram.org or localhost → refused, exit 0", p.returncode == 0 and not seen and "::warning" in p.stdout)
p, seen = run_sender(TOKENS[0], [], base="https://evil.example")
check("TELEGRAM_API_BASE https://<other host> → refused (the token is in the URL)", p.returncode == 0 and not seen and "::warning" in p.stdout and TOKENS[0] not in p.stdout + p.stderr)


# ---------- telegram.send in process: errors whose own text carries the URL ----------

def capture(fn):
    o, e = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(o), contextlib.redirect_stderr(e):
        r = fn()
    return r, o.getvalue() + e.getvalue()


env = {"TELEGRAM_BOT_TOKEN": TOKENS[0], "TELEGRAM_CHAT_ID": "42"}
for label, make in [
    ("Exception(str has URL)", lambda req: Exception(f"boom {req.full_url}")),
    ("URLError(reason has URL)", lambda req: urllib.error.URLError(f"cannot reach {req.full_url}")),
    ("TimeoutError(str has URL)", lambda req: TimeoutError(req.full_url)),
    ("HTTPError(url=URL, no body)", lambda req: urllib.error.HTTPError(req.full_url, 502, f"bad gateway {req.full_url}", {}, None)),
]:
    calls, sleeps = [], []

    def opener(req, timeout=None, make=make):
        calls.append(1)
        raise make(req)
    r, out = capture(lambda: telegram.send("본문", env=env, urlopen=opener, sleep=sleeps.append))
    check(f"send(): {label} → 'failed', retried once, token never printed",
          r == "failed" and len(calls) == 2 and sleeps == [telegram.RETRY_WAIT] and TOKENS[0] not in out and "::warning" in out, out)


class Resp:
    def __init__(self, status, body):
        self.status, self._b = status, json.dumps(body).encode()

    def read(self, n=-1):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


seq, sleeps = [], []


def opener429(req, timeout=None):
    seq.append(1)
    if len(seq) == 1:
        raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {},
                                     io.BytesIO(json.dumps({"ok": False, "parameters": {"retry_after": 7}}).encode()))
    return Resp(200, {"ok": True})


r, out = capture(lambda: telegram.send("본문", env=env, urlopen=opener429, sleep=sleeps.append))
check("send(): 429 retry_after=7 → waits 7 s once, then sent", r == "sent" and sleeps == [7] and len(seq) == 2 and TOKENS[0] not in out, out)

seq.clear()
sleeps.clear()


def opener429long(req, timeout=None):
    seq.append(1)
    raise urllib.error.HTTPError(req.full_url, 429, "x", {}, io.BytesIO(json.dumps({"ok": False, "parameters": {"retry_after": 600}}).encode()))


r, out = capture(lambda: telegram.send("본문", env=env, urlopen=opener429long, sleep=sleeps.append))
check("send(): 429 asking for 600 s → no long wait in CI, one request, warning", r == "failed" and not sleeps and len(seq) == 1)

t = telegram.trim("가" * 5000)
check("trim(): Korean text over the limit → ≤ 4096 UTF-16 units with the cut note",
      telegram.utf16_len(t) <= 4096 and t.endswith(telegram.CUT.strip("\n")[-5:]))
t = telegram.trim("😀" * 3000)
check("trim(): characters outside the BMP count twice", telegram.utf16_len(t) <= 4096)
check("trim(): short text unchanged", telegram.trim("짧은 글") == "짧은 글")
check("redact(): raw and URL-encoded token removed",
      TOKENS[0] not in telegram.redact(f"a {TOKENS[0]} b {TOKENS[0].replace(':', '%3A')}", TOKENS[0]))


# ---------- health_check: freshness (KST, 8-day boundary) ----------

def meta_of(*brands):
    return {"brands": [list(b) for b in brands]}


m = meta_of(["블리비", 58, 58, 0, "2026-10-07", "2026-10-07"])
d = datetime.date
check("freshness: exactly 8 days → ok", hc.check_freshness(m, d(2026, 10, 15)) == [])
r = hc.check_freshness(m, d(2026, 10, 16))
check("freshness: 9 days → alert naming the brand", len(r) == 1 and "블리비" in r[0] and "9일" in r[0], str(r))
utc = datetime.timezone.utc
check("KST: 2026-10-15 14:59 UTC is still the 15th (8 days → ok)",
      hc.check_freshness(m, hc.today_kst(datetime.datetime(2026, 10, 15, 14, 59, tzinfo=utc))) == [])
check("KST: 2026-10-15 15:00 UTC is already the 16th (9 days → alert)",
      len(hc.check_freshness(m, hc.today_kst(datetime.datetime(2026, 10, 15, 15, 0, tzinfo=utc)))) == 1)
r = hc.check_freshness(meta_of(["쁨", 23, 20, 3, "2026-10-06", "2026-10-13"]), d(2026, 10, 15))
check("freshness: stale branches > 0 → alert", len(r) == 1 and "3곳" in r[0], str(r))
check("freshness: unreadable data-meta → alert", len(hc.check_freshness(None, d(2026, 10, 15))) == 1)
check("freshness: no brands → alert", len(hc.check_freshness({"brands": []}, d(2026, 10, 15))) == 1)
check("freshness: brand with no verified date → alert", len(hc.check_freshness(meta_of(["리엔장", 5, 0, 0, "", ""]), d(2026, 10, 15))) == 1)
real = hc.read_json(os.path.join(ROOT, "app", "data-meta.json"))
check("freshness: the repository's app/data-meta.json parses and has brands", isinstance(real, dict) and len(real.get("brands", [])) > 0)


# ---------- health_check: data guard lines (build2/weekly.py wording) ----------

clean = "# 주간 갱신 2026-10-13\n\n- 블리비: 53,313행 · 58개 지점 (지난번 53,000행 · 58개 지점)\n- 쁨: 9,500행 · 23개 지점\n\n- 앱 데이터: 가격 144,148개 · 지점 286곳\n"
hits = (clean
        + "- **출처 정책 확인 실패, 이전 결과도 없음 — 이번 주 수집 안 함**\n"
        + "- 출처 정책(robots.txt) 확인 실패 — 지난번 확인 결과 기준으로 진행\n"
        + "- **밴스: robots.txt가 수집 경로를 막아서 이번 주 수집 안 함** (data2/sources.json)\n"
        + "- **톡스앤필: 지난 자료 유지** (새로 읽은 행 0/지점 0 vs 지난번 11,888/32) — 사이트 확인 필요\n"
        + "- **셀린: 수집 실패, 이전 자료도 없음** — 이번 데이터에서 빠짐\n"
        + "- **새 자료로 앱 데이터 만들기 실패 → 지난 자료로 배포** (새로 읽은 브랜드: 쁨) — 오류는 실행 요약 참고\n"
        + "- **급변 가격 검토 대기 12개** (지난주보다 90% 넘게 내리거나 10배 넘게 오름) — data2/review.csv, 맞으면 추가\n")
check("guard: clean report → no problem", hc.check_report(clean) == [])
r = hc.check_report(hits)
check("guard: each of the 7 guard lines found once, without markdown", len(r) == 7 and not any("**" in x for x in r), "\n".join(r))
check("guard: brand names kept in the line", any(x.startswith("톡스앤필: 지난 자료 유지") for x in r) and any("급변 가격 검토 대기 12개" in x for x in r))
check("guard: missing report.md → problem", len(hc.check_report(None)) == 1)
check("guard: the repository's data2/report.md reads without error", isinstance(hc.check_report(hc.read_text(os.path.join(ROOT, "data2", "report.md"))), list))


# ---------- health_check: liveness and Workers (fake fetch) ----------

def fetcher(table):
    calls = []

    def fetch(url, headers):
        calls.append(url)
        v = table.get(url.split("?")[0])
        if isinstance(v, Exception):
            raise v
        if v is None:
            raise ConnectionRefusedError()
        return v
    fetch.calls = calls
    return fetch


f = fetcher({})
probs, notes = hc.check_workers(f, "")
check("workers: MONITOR_WORKER_URLS empty → skipped, no request", probs == [] and f.calls == [] and "건너뜀" in notes[0])
# each Worker is checked at <url>/health and only 200 {"ok": true} counts — a broken API Worker can still 404 on other paths
W1, W2, W3, W4, W5 = ("https://a.example.workers.dev/", "https://b.example.workers.dev", "https://c.example.workers.dev/",
                      "https://d.example.workers.dev/", "https://e.example.workers.dev/")
f = fetcher({"https://a.example.workers.dev/health": (200, b'{"ok":true}'), "https://b.example.workers.dev/health": (503, b""),
             "https://c.example.workers.dev/health": OSError(), "https://d.example.workers.dev/health": (404, b"not found"),
             "https://e.example.workers.dev/health": (200, b"<html>ok</html>")})
probs, notes = hc.check_workers(f, f"{W1}, {W2}\n{W3} {W4},{W5}")
check("workers: /health 200 {ok:true} → alive", any("a.example" in n for n in notes) and not any("a.example" in p for p in probs))
check("workers: 503 → down", any("b.example" in p and "503" in p for p in probs))
check("workers: connection error → down", any("c.example" in p for p in probs))
check("workers: 404 on /health → down (a 404 is not proof of life)", any("d.example" in p and "404" in p for p in probs))
check("workers: 200 without {ok:true} → down", any("e.example" in p for p in probs))
check("workers: only /health is requested", all(u.endswith("/health") for u in f.calls) and len(f.calls) == 5, str(f.calls))
check("workers: http:// URL refused", len(hc.check_workers(fetcher({}), "http://x.example")[0]) == 1)

# the alerts Worker never evicts subscriptions: /health "capacity" tells a person when the table is (nearly) full; "stale" =
# no factory finish for 2+ days. ok / missing field = alive and no warning; the message carries the host, never numbers.
def cap_probs(body):
    f = fetcher({"https://cap.example.workers.dev/health": (200, body)})
    return hc.check_workers(f, "https://cap.example.workers.dev/")
probs, notes = cap_probs(b'{"ok":true,"window":"08-21 KST","sending":true,"finished":"2026-10-15","capacity":"ok","stale":false}')
check("workers: capacity ok → alive, no warning", probs == [] and any("cap.example" in n for n in notes), str(probs))
probs, notes = cap_probs(b'{"ok":true,"finished":null}')
check("workers: capacity field missing (older Worker) → alive, no warning", probs == [] and any("cap.example" in n for n in notes), str(probs))
probs, notes = cap_probs(b'{"ok":true,"capacity":"nearly_full"}')
check("workers: capacity nearly_full → one warning line (still alive)", len(probs) == 1 and "거의 찼어요" in probs[0] and "MAX_SUBS" in probs[0]
      and "cap.example" in probs[0] and any("살아 있음" in n for n in notes), str(probs))
probs, notes = cap_probs(b'{"ok":true,"capacity":"full"}')
check("workers: capacity full → one warning line", len(probs) == 1 and "가득 찼어요" in probs[0] and "MAX_SUBS" in probs[0], str(probs))
probs, notes = cap_probs(b'{"ok":true,"capacity":"surprise"}')
check("workers: unknown capacity value → a warning (not silence)", len(probs) == 1 and "알 수 없어요" in probs[0], str(probs))
probs, notes = cap_probs(b'{"ok":true,"capacity":"ok","stale":true}')
check("workers: stale true → one warning line", len(probs) == 1 and "2일 넘게" in probs[0] and "price_alerts" in probs[0], str(probs))
# no finish EVER (finished: null) while phones subscribed more than 2 days ago: the factory → Worker link never worked
probs, notes = cap_probs(b'{"ok":true,"capacity":"ok","finished":null,"stale":true}')
check("workers: stale with finished null → 'never received' line naming the ALERTS_* settings",
      len(probs) == 1 and "한 번도" in probs[0] and "ALERTS_URL" in probs[0] and "price_alerts" in probs[0], str(probs))
probs, notes = cap_probs(b'{"ok":true,"capacity":"ok","finished":"2026-10-12","stale":true}')
check("workers: stale with an old finished day → the '2일 넘게' line", len(probs) == 1 and "2일 넘게" in probs[0] and "한 번도" not in probs[0], str(probs))
# sending false: the VAPID secret is missing / cannot sign / VAPID_PUBLIC_KEY is another key — no push can go out
probs, notes = cap_probs(b'{"ok":true,"capacity":"ok","sending":false,"key":null,"stale":false}')
check("workers: sending false → one warning line (VAPID), still alive", len(probs) == 1 and "보낼 수 없어요" in probs[0]
      and "VAPID_PRIVATE_JWK" in probs[0] and any("살아 있음" in n for n in notes), str(probs))
# refusing true: phones that took our pushes refused our VAPID token today or yesterday where nothing else went through — kept (grace days)
probs, notes = cap_probs(b'{"ok":true,"capacity":"ok","sending":true,"refusing":true}')
check("workers: refusing true → one warning line", len(probs) == 1 and "거절" in probs[0] and "pushPublicKey" in probs[0], str(probs))
probs, notes = cap_probs(b'{"ok":true,"capacity":"ok","sending":true,"refusing":false,"stale":false}')
check("workers: sending true, refusing false → no warning", probs == [], str(probs))
# pairs capped: the factory's watched list was cut at PAIR_CAP (D1 write bound) — some alerts not computed
probs, notes = cap_probs(b'{"ok":true,"capacity":"ok","sending":true,"refusing":false,"pairs":"capped"}')
check("workers: pairs capped → one warning line", len(probs) == 1 and "PAIR_CAP" in probs[0] and "심은 구독" in probs[0], str(probs))
check("workers: pairs capped → the narrow cleanup query (a user decision after a recent reclassification), the wide one only after a user decision",
      len(probs) == 1 and "좁은 정리 쿼리" in probs[0] and "넓은 정리 쿼리" in probs[0] and "사용자 결정" in probs[0]
      and "재분류" in probs[0], str(probs))
probs, notes = cap_probs(b'{"ok":true,"capacity":"ok","sending":true,"refusing":false,"pairs":"ok"}')
check("workers: pairs ok → no warning", probs == [], str(probs))
probs, notes = cap_probs(b'{"ok":true,"capacity":"full","sending":false,"refusing":true,"finished":null,"stale":true}')
check("workers: several problems in one body → one line each", len(probs) == 4, str(probs))

# the Worker's VAPID public key ("key", derived from its secret) against app/config.js pushPublicKey (the key phones use)
KA, KB = "B" + "a" * 86, "B" + "b" * 86


def key_probs(body, app_key):
    f = fetcher({"https://alerts.example.workers.dev/health": (200, body)})
    return hc.check_workers(f, "https://alerts.example.workers.dev", app_key)[0]


h = lambda key: json.dumps({"ok": True, "capacity": "ok", "sending": True, "key": key, "stale": False, "refusing": False}).encode()
r = key_probs(h(KB), KA)
check("workers: Worker key ≠ app/config.js pushPublicKey → one warning, no key printed",
      len(r) == 1 and "pushPublicKey" in r[0] and "달라요" in r[0] and KA not in r[0] and KB not in r[0], str(r))
check("workers: same key → no warning", key_probs(h(KA), KA) == [])
check("workers: pushPublicKey empty in app/config.js (push not switched on) → not compared", key_probs(h(KB), "") == [])
check("workers: Worker shows no key (null, or an older Worker / the metrics Worker without the field) → not compared",
      key_probs(h(None), KA) == [] and key_probs(b'{"ok":true}', KA) == [])
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "app"))
    check("app_push_key: no app/config.js → ''", hc.app_push_key(tmp) == "")
    open(os.path.join(tmp, "app", "config.js"), "w", encoding="utf-8").write(f'window.APP_CONFIG = {{\n  alertsApi: "https://x",\n  pushPublicKey: "{KA}",\n}};\n')
    check("app_push_key: reads pushPublicKey from app/config.js", hc.app_push_key(tmp) == KA)
    json.dump(meta_of(["블리비", 58, 58, 0, "2026-10-13", "2026-10-13"]), open(os.path.join(tmp, "app", "data-meta.json"), "w", encoding="utf-8"))
    for worker_key, want in ((KB, 1), (KA, 0)):
        f = fetcher({"https://alerts.example.workers.dev/health": (200, h(worker_key))})
        probs, notes, msg = hc.run(hc.parse_args(["--today", "2026-10-16", "--root", tmp]), {"MONITOR_WORKER_URLS": "https://alerts.example.workers.dev"},
                                   fetch=f, now=datetime.datetime(2026, 10, 16, 0, 30, tzinfo=datetime.timezone.utc), send=lambda *a, **k: None)
        check(f"run: the daily monitor compares the Worker key with the checkout's app/config.js ({'differs' if want else 'same'})",
              sum("pushPublicKey" in p for p in probs) == want, str(probs))
check("app_push_key: the repository's app/config.js reads without error", isinstance(hc.app_push_key(ROOT), str))

probs, notes = cap_probs(b'{"ok":false,"capacity":"full"}')
check("workers: ok:false stays 'down' (capacity of a dead Worker is not read)", len(probs) == 1 and "상태 확인 실패" in probs[0], str(probs))
probs, notes = cap_probs(b'[1,2]')
check("workers: a JSON list is not a health body → down, no crash", len(probs) == 1 and "상태 확인 실패" in probs[0], str(probs))

A = hc.APP_URL
meta_bytes = json.dumps(m).encode()
probs, live = hc.check_live(fetcher({A: (200, b"<html>"), A + "data-meta.json": (200, meta_bytes)}))
check("live: app 200 + data-meta parses → no problem", probs == [] and live == m)
probs, live = hc.check_live(fetcher({A: (500, b""), A + "data-meta.json": (200, b"not json")}))
check("live: app 500 and broken data-meta → two problems", len(probs) == 2 and live is None, str(probs))
probs, live = hc.check_live(fetcher({}))
check("live: no connection → two problems, no exception", len(probs) == 2 and live is None)


# ---------- health_check: factory runs (GitHub REST API shape) ----------

NOW = datetime.datetime(2026, 10, 16, 0, 30, tzinfo=utc)


def run_of(event, created, conclusion="success", status="completed", minutes=20):
    c = datetime.datetime.fromisoformat(created).replace(tzinfo=utc)
    return {"event": event, "status": status, "conclusion": conclusion if status == "completed" else None,
            "created_at": c.strftime("%Y-%m-%dT%H:%M:%SZ"), "updated_at": (c + datetime.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")}


ok_runs = [run_of("schedule", "2026-10-15T21:00:00"), run_of("push", "2026-10-15T02:00:00"), run_of("schedule", "2026-10-14T21:00:00")]
check("factory: last night's scheduled run succeeded → no problem", hc.check_factory_runs(ok_runs, NOW) == [])
r = hc.check_factory_runs([run_of("schedule", "2026-10-15T21:00:00", "failure")] + ok_runs[1:], NOW)
check("factory: last scheduled run failed → reminder line", any("실패" in x and "다시 알려" in x for x in r), str(r))
r = hc.check_factory_runs([run_of("push", "2026-10-15T23:00:00")] + [run_of("schedule", "2026-10-15T21:00:00", "timed_out")], NOW)
check("factory: a later push run succeeded but the scheduled one timed out → still reminded", any("예약" in x and "시간 초과" in x for x in r), str(r))
r = hc.check_factory_runs([run_of("schedule", "2026-10-13T21:00:00")], NOW)
check("factory: no run for 26+ hours → alert (no success, no schedule)", len(r) == 2, str(r))
r = hc.check_factory_runs([run_of("schedule", "2026-10-15T20:00:00", status="in_progress")] + ok_runs[1:], NOW)
check("factory: a run still going after 3+ hours → stuck alert", any("끝나지 않았어요" in x for x in r), str(r))
check("factory: empty run list → alert", len(hc.check_factory_runs([], NOW)) == 1)
r = hc.check_factory_runs([run_of("workflow_dispatch", "2026-10-15T23:00:00"), run_of("schedule", "2026-10-15T21:00:00", "failure"),
                           run_of("schedule", "2026-10-14T21:00:00")], NOW)
check("factory: failed scheduled run already fixed by a later manual run → no reminder", r == [], str(r))
r = hc.check_factory_runs([run_of("workflow_dispatch", "2026-10-15T23:00:00", "cancelled")] + ok_runs, NOW)
check("factory: a manual run the user cancelled → not reported", r == [], str(r))
r = hc.check_factory_runs([run_of("schedule", "2026-10-14T21:00:00", "failure"), run_of("schedule", "2026-10-13T21:00:00")], NOW)
check("factory: one failed run → one failure line, not also '26시간 성공 없음'", sum("26시간 안에 성공한" in x for x in r) == 0 and any("실패" in x for x in r), str(r))
r = hc.check_factory_runs([run_of("schedule", "2026-10-16T00:10:00", status="in_progress"), run_of("schedule", "2026-10-14T21:00:00", minutes=10)], NOW)
check("factory: today's run still going (late schedule) → no '26시간' alarm", not any("26시간 안에 성공한" in x for x in r), str(r))


# ---------- health_check.run: one combined message, only when needed ----------

API = "https://api.github.com/repos/o/r/actions/workflows/weekly.yml/runs"
gh_env = {"GITHUB_REPOSITORY": "o/r", "GITHUB_TOKEN": "gh-test", "RUN_URL": "https://github.com/o/r/actions/runs/1", "PUBLIC_DEPLOY": "on"}
fresh = meta_of(["블리비", 58, 58, 0, "2026-10-13", "2026-10-13"])
good = {API: (200, json.dumps({"workflow_runs": ok_runs}).encode()), A: (200, b"ok"), A + "data-meta.json": (200, json.dumps(fresh).encode())}


def monitor(table, extra_args=(), extra_env=None, today="2026-10-16"):
    sent = []
    args = hc.parse_args(["--send", "--weekly-heartbeat", "--today", today, *extra_args])
    probs, notes, msg = hc.run(args, {**gh_env, **(extra_env or {})}, fetch=fetcher(table), now=NOW,
                               send=lambda text, env=None: sent.append(text))
    return probs, notes, msg, sent


probs, notes, msg, sent = monitor(good)
check("run: all healthy on a Friday → nothing sent", probs == [] and sent == [], str(probs))
probs, notes, msg, sent = monitor(good, today="2026-10-19")
check("run: all healthy on a Monday → one labeled heartbeat", len(sent) == 1 and sent[0].startswith("[주간 생존 신호]"), str(sent))
bad = dict(good)
bad[A] = (502, b"")
bad[API] = (200, json.dumps({"workflow_runs": [run_of("schedule", "2026-10-15T21:00:00", "failure")]}).encode())
probs, notes, msg, sent = monitor(bad, extra_env={"MONITOR_WORKER_URLS": W2}, today="2026-10-19")
check("run: several problems → exactly one combined message with the run link, no heartbeat",
      len(sent) == 1 and len(probs) >= 3 and "실행 기록: https://github.com/o/r/actions/runs/1" in sent[0] and "생존 신호" not in sent[0], str(sent))
probs, notes, msg, sent = monitor(good, extra_args=["--test"])
check("run: --test sends a test line (and nothing else when healthy)", len(sent) == 1 and "시험" in sent[0])
probs, notes, msg, sent = monitor({**good, API: (403, b"{}")})
check("run: GitHub API refused → reported as a check problem, other checks still run",
      any("factory" in p and "403" in p for p in probs) and not any("앱" in p for p in probs), str(probs))

# public hosting paused (PUBLIC_DEPLOY not 'on'): the frozen public copy is neither probed nor used for the collection dates
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "app"))
    json.dump(fresh, open(os.path.join(tmp, "app", "data-meta.json"), "w", encoding="utf-8"))
    for pub in (None, "", "off", "ON"):
        env_p = {k: v for k, v in gh_env.items() if k != "PUBLIC_DEPLOY"}
        if pub is not None:
            env_p["PUBLIC_DEPLOY"] = pub
        f = fetcher({API: good[API], A: (502, b""), A + "data-meta.json": (200, json.dumps(meta_of(["블리비", 58, 58, 0, "2026-09-01", "2026-09-01"])).encode())})
        sent = []
        args = hc.parse_args(["--send", "--today", "2026-10-16", "--root", tmp])
        probs, notes, msg = hc.run(args, env_p, fetch=f, now=NOW, send=lambda text, env=None: sent.append(text))
        check(f"paused public ({pub!r}): no request to the public address, its 502 and its stale dates are ignored",
              probs == [] and not any(u.startswith(A) for u in f.calls) and sent == [], str((probs, f.calls)))
        check(f"paused public ({pub!r}): freshness judged on the repository's app/data-meta.json, and the skip is noted",
              any("공개 주소 검사 건너뜀" in n for n in notes) and any("app/data-meta.json" in n for n in notes), str(notes))
    stale_tmp = meta_of(["블리비", 58, 58, 0, "2026-09-01", "2026-09-01"])
    json.dump(stale_tmp, open(os.path.join(tmp, "app", "data-meta.json"), "w", encoding="utf-8"))
    f = fetcher({API: good[API]})
    probs, notes, msg = hc.run(hc.parse_args(["--today", "2026-10-16", "--root", tmp]), {k: v for k, v in gh_env.items() if k != "PUBLIC_DEPLOY"}, fetch=f, now=NOW, send=lambda *a, **k: None)
    check("paused public: stale data in the repository is still reported (the factory keeps building it)", any("블리비" in p for p in probs), str(probs))

wf_mon = open(os.path.join(os.path.dirname(SCRIPTS), "workflows", "monitor.yml"), encoding="utf-8").read()
check("monitor.yml hands PUBLIC_DEPLOY to the check step (paused/on must agree with weekly.yml)",
      re.search(r"^ {10}PUBLIC_DEPLOY: \$\{\{ vars\.PUBLIC_DEPLOY \}\}", wf_mon, re.M) is not None)
check("heartbeat says public hosting is paused when it is", "공개 주소 배포 멈춤" in hc.heartbeat_text(fresh, ok_runs, paused=True)
      and "공개 주소 배포 멈춤" not in hc.heartbeat_text(fresh, ok_runs))
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "app"))
    json.dump(fresh, open(os.path.join(tmp, "app", "data-meta.json"), "w", encoding="utf-8"))
    sent = []
    args = hc.parse_args(["--send", "--weekly-heartbeat", "--today", "2026-10-19", "--root", tmp])
    hc.run(args, {k: v for k, v in gh_env.items() if k != "PUBLIC_DEPLOY"}, fetch=fetcher({API: good[API]}), now=NOW, send=lambda text, env=None: sent.append(text))
    check("paused public: the Monday heartbeat carries the paused line", len(sent) == 1 and "공개 주소 배포 멈춤" in sent[0], str(sent))

with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "app"))
    os.makedirs(os.path.join(tmp, "data2"))
    json.dump(fresh, open(os.path.join(tmp, "app", "data-meta.json"), "w", encoding="utf-8"))
    open(os.path.join(tmp, "data2", "report.md"), "w", encoding="utf-8").write(hits)
    sent = []
    args = hc.parse_args(["--report-only", "--send", "--today", "2026-10-16", "--root", tmp])
    probs, notes, msg = hc.run(args, {}, fetch=fetcher({}), send=lambda text, env=None: sent.append(text))
    check("report-only: guard hits → one message, no network", len(sent) == 1 and len(probs) == 7 and "가격 공장" in sent[0], str(probs))
    open(os.path.join(tmp, "data2", "report.md"), "w", encoding="utf-8").write(clean)
    sent = []
    probs, notes, msg = hc.run(args, {}, fetch=fetcher({}), send=lambda text, env=None: sent.append(text))
    check("report-only: clean report and fresh data → nothing sent", probs == [] and sent == [])

p = subprocess.run([sys.executable, os.path.join(SCRIPTS, "health_check.py"), "--report-only"], capture_output=True, text=True,
                   env={**{k: v for k, v in os.environ.items() if not k.startswith("TELEGRAM_")}, "PYTHONUTF8": "1"}, timeout=60)
check("health_check.py --report-only on the repository files: exit 0", p.returncode == 0 and "문제" in p.stdout, p.stdout + p.stderr)

srv.shutdown()
print("monitor alerts", "OK" if not fails else f"{fails} FAIL")
sys.exit(1 if fails else 0)
