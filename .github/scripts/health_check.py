#!/usr/bin/env python3
"""Health checks for the price factory and the app; alerts go to Telegram (docs/SECURITY_ARCHITECTURE.md §9).

usage: python .github/scripts/health_check.py --report-only [--send]   # after a factory run (weekly.yml): files only
       python .github/scripts/health_check.py [--send] [--weekly-heartbeat] [--test]   # daily watchdog (monitor.yml)

Checks (each returns problems as short Korean lines; no problem → no message, so alerts stay rare and meaningful):
  freshness  app/data-meta.json brands[i] = [name, branches, verified, stale, oldest, newest date]: a brand whose newest
             collection is more than 8 days before today (KST), a brand with stale branches, an unreadable file
  guard      data2/report.md lines that build2/weekly.py writes when its data guard kept old data or skipped a brand
  factory    (watchdog) the latest weekly-prices runs on main, from the GitHub REST API: failed, missing for 26 hours, stuck
  live       (watchdog) the app URL answers 200 and its data-meta.json parses; the live file is then used for freshness —
             only when PUBLIC_DEPLOY is "on"; while public hosting is paused the frozen public copy is skipped and freshness
             is judged on the repository's app/data-meta.json
  workers    (watchdog) each URL in MONITOR_WORKER_URLS (space/comma separated, empty = skipped) answers GET /health with 200
             {"ok": true}; an alive alerts Worker (cf/alerts) adds a warning line when its body says capacity != "ok" (table
             nearly full / full), stale: true (no factory finish for 2+ days, or none ever since the first subscription),
             sending: false (VAPID key missing or unusable), refusing: true (phones that took our pushes refuse our VAPID
             token at a push service that took nothing else — kept for a few days, then counted), pairs: "capped" (the
             factory's watched list was cut at PAIR_CAP, or a new pair waited for a free row under it) or a "key" that is
             not app/config.js pushPublicKey (when that is set)

Messages hold brand names, dates, counts and the run link only — no personal data, no secrets. Standard library only.
--send without the Telegram secrets prints a ::notice and sends nothing. Exit 0 unless the arguments are wrong.
"""
import argparse, datetime, json, os, re, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import telegram  # noqa: E402  (.github/scripts/telegram.py, next to this file)

ROOT = os.path.dirname(os.path.dirname(HERE))
KST = datetime.timezone(datetime.timedelta(hours=9))
APP_URL = "https://yoonsiljang.lsy2825.workers.dev/"
MAX_DAYS = 8          # weekly collection on Mondays: 7 days is normal, one missed Monday shows up two days later
RUN_HOURS = 26        # the factory runs every day at 21:00 UTC; 26 h leaves room for GitHub's schedule delays
STUCK_HOURS = 3       # the factory job times out after 90 minutes
FAILED = {"failure": "실패", "timed_out": "시간 초과", "cancelled": "취소됨", "startup_failure": "시작 실패",
          "action_required": "승인 대기", "stale": "만료"}

# build2/weekly.py report lines when the data guard acted (read-only copy of its wording; that file belongs to the build)
GUARD = [
    re.compile(r"\*\*출처 정책 확인 실패, 이전 결과도 없음"),
    re.compile(r"출처 정책\(robots\.txt\) 확인 실패"),
    re.compile(r"\*\*[^*]+: robots\.txt가 수집 경로를 막아서"),
    re.compile(r"\*\*[^*]+: 지난 자료 유지\*\*"),
    re.compile(r"\*\*[^*]+: 수집 실패, 이전 자료도 없음\*\*"),
    re.compile(r"\*\*새 자료로 앱 데이터 만들기 실패"),
    re.compile(r"\*\*급변 가격 검토 대기 \d+개\*\*"),
]


# ---------- pure checks ----------

def today_kst(now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    return now.astimezone(KST).date()


def parse_date(s):
    try:
        return datetime.date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def parse_time(s):
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def kst_text(t):
    return t.astimezone(KST).strftime("%m-%d %H:%M") if t else "없음"


def check_freshness(meta, today, max_days=MAX_DAYS, where="app/data-meta.json"):
    if not isinstance(meta, dict):
        return [f"수집 정보({where})를 읽지 못했어요"]
    brands = meta.get("brands")
    if not isinstance(brands, list) or not brands:
        return [f"수집 정보({where})에 브랜드 목록이 없어요"]
    out = []
    for row in brands:
        if not isinstance(row, list) or len(row) < 6:
            out.append(f"수집 정보({where})의 브랜드 줄 형식이 달라요")
            continue
        name, total, _verified, stale, _oldest, newest = row[:6]
        name = str(name)[:30]
        d = parse_date(newest)
        if d is None:
            out.append(f"{name}: 확인된 수집 날짜가 없어요")
        elif (today - d).days > max_days:
            out.append(f"{name}: 마지막 수집 {d.isoformat()} ({(today - d).days}일 전, 기준 {max_days}일)")
        if isinstance(stale, int) and stale > 0:
            out.append(f"{name}: 이번 수집에 실패해 지난 자료를 쓰는 지점 {stale}곳 (전체 {total}곳)")
    return out


def check_report(text):
    if text is None:
        return ["이번 실행 보고서(data2/report.md)가 없어요"]
    out = []
    for line in text.splitlines():
        if any(rx.search(line) for rx in GUARD):
            clean = line.replace("**", "").strip().lstrip("-").strip()
            out.append(clean if len(clean) <= 160 else clean[:159] + "…")
    return out


def check_factory_runs(runs, now, run_hours=RUN_HOURS, stuck_hours=STUCK_HOURS):
    """runs = workflow_runs of weekly.yml on main (GitHub REST API), any order"""
    if not runs:
        return ["가격 공장(weekly.yml) 실행 기록이 없어요"]
    runs = sorted(runs, key=lambda r: parse_time(r.get("created_at")) or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc), reverse=True)
    hours = lambda t: (now - t).total_seconds() / 3600 if t else 1e9
    done = [r for r in runs if r.get("status") == "completed"]
    out = []
    latest = done[0] if done else None
    latest_sched = next((r for r in done if r.get("event") == "schedule"), None)
    seen = set()
    created = lambda r: parse_time(r.get("created_at")) or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
    fixed_later = lambda r: any(x.get("conclusion") == "success" and x.get("event") in ("schedule", "workflow_dispatch")
                                and created(x) > created(r) for x in done)
    for r, what in ((latest, "마지막"), (latest_sched, "마지막 예약")):
        if r is None or id(r) in seen:
            continue
        seen.add(id(r))
        if r.get("conclusion") == "cancelled" and r.get("event") != "schedule":
            continue                       # a manual run the user stopped is not a factory failure
        if r.get("conclusion") in FAILED and not fixed_later(r):
            out.append(f"가격 공장 {what} 실행 {FAILED[r['conclusion']]} ({kst_text(parse_time(r.get('created_at')))} KST) — "
                       "실패 알림을 이미 받았다면 다시 알려 드리는 거예요")
    ok = [r for r in done if r.get("conclusion") == "success"]
    running_now = any(r.get("status") != "completed" and hours(parse_time(r.get("created_at"))) <= run_hours for r in runs)
    if not out and not running_now and not any(hours(parse_time(r.get("updated_at"))) <= run_hours for r in ok):
        last_ok = parse_time(ok[0].get("updated_at")) if ok else None
        out.append(f"가격 공장: {run_hours}시간 안에 성공한 실행이 없어요 (마지막 성공 {kst_text(last_ok)})")
    sched = next((r for r in runs if r.get("event") == "schedule"), None)
    if sched is None:
        out.append("가격 공장: 최근 기록에 예약 실행이 없어요 (예약이 꺼졌는지 확인)")
    elif hours(parse_time(sched.get("created_at"))) > run_hours:
        out.append(f"가격 공장: 예약 실행이 {run_hours}시간 넘게 없어요 (마지막 {kst_text(parse_time(sched.get('created_at')))} KST, 예약이 꺼졌는지 확인)")
    for r in runs:
        if r.get("status") != "completed" and hours(parse_time(r.get("created_at"))) > stuck_hours:
            out.append(f"가격 공장 실행이 {int(hours(parse_time(r.get('created_at'))))}시간째 끝나지 않았어요 "
                       f"({kst_text(parse_time(r.get('created_at')))} KST 시작)")
            break
    return out


def check_live(fetch, app_url=APP_URL):
    """(problems, live data-meta or None). fetch(url, headers) -> (status, body bytes); it may raise."""
    out, meta = [], None
    base = app_url.rstrip("/") + "/"
    try:
        status, _ = fetch(base, {})
        if status != 200:
            out.append(f"앱 주소가 열리지 않아요 (HTTP {status})")
    except Exception as e:
        out.append(f"앱 주소에 연결하지 못했어요 ({type(e).__name__})")
    try:
        status, body = fetch(base + "data-meta.json", {})
        if status == 200:
            meta = json.loads(body.decode("utf-8"))
            if not isinstance(meta, dict) or not isinstance(meta.get("brands"), list):
                meta = None
                out.append("배포된 data-meta.json 형식이 달라요")
        else:
            out.append(f"배포된 data-meta.json을 받지 못했어요 (HTTP {status})")
    except ValueError:
        out.append("배포된 data-meta.json을 읽지 못했어요 (JSON 아님)")
    except Exception as e:
        out.append(f"배포된 data-meta.json에 연결하지 못했어요 ({type(e).__name__})")
    return out, meta


def worker_urls(text):
    return [u for u in re.split(r"[\s,]+", text or "") if u]


def app_push_key(root):
    """app/config.js pushPublicKey — the VAPID public key phones subscribe with (chat B's file, read only). '' when empty,
    missing or unreadable (then nothing is compared)."""
    m = re.search(r'\bpushPublicKey:\s*"([A-Za-z0-9_-]*)"', read_text(os.path.join(root, "app", "config.js")) or "")
    return m.group(1) if m else ""


def worker_warnings(host, data, app_key=""):
    """Warning lines from an ALIVE Worker's /health body (a missing field = no warning; no numbers or keys in the message).
    capacity: the alerts Worker (cf/alerts) never evicts a subscription, so a full table needs a person: 'nearly_full'
    (>= 80% of MAX_SUBS) or 'full' (503 FULL for new phones). stale: the price factory has not finished a run into that
    Worker for more than 2 days, or never since the first phone subscribed more than 2 days ago (finished: null)
    (cf/alerts/notify.mjs sends nothing when it fails, the job stays green). sending: false = no push can go out (the
    VAPID_PRIVATE_JWK secret is missing or cannot sign, or VAPID_PUBLIC_KEY is set to another key). refusing: true = a send
    run today or yesterday found phones that took our pushes refusing our VAPID token at a push service that took nothing
    else (kept, not counted, held back and tried again a few a run — cf/alerts rules.js PROBES — for up to
    REFUSING_GRACE_DAYS = 7 days; after that they are counted and removed). pairs: "capped" = the factory's watched (key, region) list was cut at PAIR_CAP today or
    yesterday, or a new pair had to wait a day for a free row under it (planted subscriptions, or more real ones than the
    cap) — some alerts were not computed.
    key: the VAPID public key the Worker pushes with; when app/config.js pushPublicKey is set and differs, every phone
    subscribes with a key the Worker cannot push to (the push services refuse, the subscriptions end up removed)."""
    out = []
    cap = data.get("capacity")
    if cap == "nearly_full":
        out.append(f"알림 Worker 구독 표가 거의 찼어요 ({host}): 정리하거나 MAX_SUBS를 올리세요")
    elif cap == "full":
        out.append(f"알림 Worker 구독 표가 가득 찼어요 — 새 구독을 못 받아요 ({host}): 정리하거나 MAX_SUBS를 올리세요")
    elif cap is not None and cap != "ok":
        out.append(f"알림 Worker 구독 표 상태를 알 수 없어요 ({host}): capacity={str(cap)[:20]}")
    if data.get("stale") is True:
        if "finished" in data and data.get("finished") is None:
            out.append(f"알림 Worker가 공장에서 숫자를 한 번도 못 받았어요. 첫 구독 뒤 2일 넘게 지났어요 ({host}): "
                       "ALERTS_URL·ALERTS_SECRET·ALERTS_CODE_SHA와 가격 공장의 price_alerts 단계를 확인하세요")
        else:
            out.append(f"알림 Worker가 2일 넘게 공장에서 숫자를 못 받았어요 ({host}): 가격 공장의 price_alerts 단계를 확인하세요")
    if data.get("sending") is False:
        out.append(f"알림 Worker가 푸시를 보낼 수 없어요 ({host}): VAPID_PRIVATE_JWK 비밀값이 없거나 쓸 수 없는 키예요 "
                   "(VAPID_PUBLIC_KEY를 넣었다면 그 키와 맞지 않아요)")
    if data.get("refusing") is True:
        out.append(f"알림 Worker: 푸시를 받던 휴대폰이 우리 VAPID 키를 거절하는데 그 푸시 서비스로 성공한 푸시가 없어요 ({host}). "
                   "우리 설정 고장일 수 있어 그 구독은 지우지 않고 미뤄 두며 실행마다 몇 개씩만 다시 시도해요(7일까지, 그 뒤에는 평소처럼 세어 지워요). "
                   "VAPID 키 쌍과 app/config.js pushPublicKey를 확인하세요")
    if data.get("pairs") == "capped":
        out.append(f"알림 Worker: 지켜보는 (시술, 지역) 쌍이 상한(PAIR_CAP)에 닿아 일부만 계산했어요(새 쌍은 빈 자리가 날 때까지 기다려요) ({host}). 심은 구독이 "
                   "있는지 보고 정리하거나 상한을 올리세요(D1 하루 쓰기 한도 때문에 둔 상한이에요)")
    key = data.get("key")
    if app_key and isinstance(key, str) and key and key != app_key:
        out.append(f"알림 Worker의 VAPID 공개키가 app/config.js pushPublicKey와 달라요 ({host}): 이대로면 휴대폰 구독이 "
                   "모두 거절돼요. 둘을 같은 키로 맞추세요")
    return out


def check_workers(fetch, urls_text, app_key=""):
    """(problems, notes). Each Worker answers GET <url>/health with 200 {"ok": true} after touching its bindings; anything
    else — 404 included — counts as down, because an API Worker can answer '/' while its real routes throw. app_key =
    app/config.js pushPublicKey (compared with the alerts Worker's "key")."""
    urls = worker_urls(urls_text)
    if not urls:
        return [], ["Worker 검사 건너뜀 (MONITOR_WORKER_URLS 비어 있음)"]
    out, notes = [], []
    for u in urls:
        host = re.sub(r"^https?://", "", u).split("/")[0][:80]
        if not u.startswith("https://"):
            out.append(f"Worker 주소는 https://로 시작해야 해요: {host}")
            continue
        try:
            status, body = fetch(u.rstrip("/") + "/health", {})
            data = None
            try:
                data = json.loads(body.decode("utf-8")) if status == 200 else None
                healthy = isinstance(data, dict) and data.get("ok") is True
            except (ValueError, AttributeError):
                healthy = False
            if healthy:
                notes.append(f"Worker 살아 있음: {host}")
                out += worker_warnings(host, data, app_key)
            else:
                out.append(f"Worker 상태 확인 실패: {host} (GET /health → HTTP {status})")
        except Exception as e:
            out.append(f"Worker에 연결하지 못했어요: {host} ({type(e).__name__})")
    return out, notes


def compose(title, problems, run_url=""):
    lines = [title, ""] + [f"- {p}" for p in problems]
    if run_url:
        lines += ["", f"실행 기록: {run_url}"]
    return "\n".join(lines)


def heartbeat_text(meta, runs, run_url="", paused=False):
    """the Monday 'still alive' line: silence on other days means healthy only while this keeps arriving"""
    lines = ["[주간 생존 신호] 윤실장 감시가 돌고 있어요. 지금 확인할 문제는 없어요."]
    if paused:
        lines.append("- 공개 주소 배포 멈춤 중(PUBLIC_DEPLOY): 공개 주소는 마지막 판 그대로이고 검사하지 않아요")
    if isinstance(meta, dict) and isinstance(meta.get("brands"), list):
        dates = sorted(d for d in (parse_date(r[5]) for r in meta["brands"] if isinstance(r, list) and len(r) >= 6) if d)
        if dates:
            lines.append(f"- 브랜드 {len(meta['brands'])}곳, 수집일 {dates[0].isoformat()} ~ {dates[-1].isoformat()}")
    ok = [r for r in runs or [] if r.get("status") == "completed" and r.get("conclusion") == "success"]
    if ok:
        last = max((parse_time(r.get("updated_at")) for r in ok if parse_time(r.get("updated_at"))), default=None)
        lines.append(f"- 마지막 가격 공장 성공: {kst_text(last)} KST")
    lines.append("월요일에 이 메시지나 문제 알림이 오지 않으면 감시가 멈춘 거예요. GitHub Actions의 monitor 실행 기록을 봐 주세요.")
    if run_url:
        lines.append(f"실행 기록: {run_url}")
    return "\n".join(lines)


# ---------- network and files (replaced in tests) ----------

def http_fetch(url, headers, timeout=20, limit=4 << 20):
    req = urllib.request.Request(url, headers={"User-Agent": "yoonsiljang-monitor", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(limit)
    except urllib.error.HTTPError as e:        # an HTTP answer, not a dead host
        body = e.read(limit) if e.fp else b""
        e.close()
        return e.code, body


def github_runs(fetch, env):
    """weekly.yml runs on main, newest first. Needs GITHUB_TOKEN with actions: read (monitor.yml)."""
    repo, token = env.get("GITHUB_REPOSITORY", ""), env.get("GITHUB_TOKEN", "")
    api = env.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
    url = f"{api}/repos/{repo}/actions/workflows/weekly.yml/runs?branch=main&per_page=100&exclude_pull_requests=true"
    status, body = fetch(url, {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                               "X-GitHub-Api-Version": "2022-11-28"})
    if status != 200:
        raise RuntimeError(f"HTTP {status}")
    return json.loads(body.decode("utf-8")).get("workflow_runs", [])


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def read_text(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None


def guarded(name, fn, problems, default=None):
    """one broken check must not hide the others"""
    try:
        return fn()
    except Exception as e:
        problems.append(f"검사 '{name}' 중 오류 ({type(e).__name__}{': ' + str(e)[:60] if isinstance(e, RuntimeError) else ''})")
        return default


def run(args, env, fetch=http_fetch, now=None, send=telegram.send):
    """returns (problems, notes, message or None). Sends only when args.send."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    today = datetime.date.fromisoformat(args.today) if args.today else today_kst(now)
    run_url = env.get("RUN_URL", "")
    problems, notes, runs = [], [], None
    file_meta = read_json(os.path.join(args.root, "app", "data-meta.json"))
    if args.test and args.send:
        send(f"윤실장 알림 시험: 텔레그램 연결이 잘 돼요.{chr(10) + '실행 기록: ' + run_url if run_url else ''}", env=env)
    if args.report_only:
        guard = guarded("guard", lambda: check_report(read_text(os.path.join(args.root, "data2", "report.md"))), problems, [])
        fresh = guarded("freshness", lambda: check_freshness(file_meta, today), problems, [])
        named = {g.split(":")[0].strip() for g in guard}
        problems += guard + [f for f in fresh if not ("지난 자료" in f and f.split(":")[0].strip() in named)]
        title = "윤실장 가격 공장: 확인할 것 {n}건"
    else:
        if env.get("GITHUB_REPOSITORY") and env.get("GITHUB_TOKEN"):
            runs = guarded("factory", lambda: github_runs(fetch, env), problems)
            if runs is not None:
                problems += guarded("factory", lambda: check_factory_runs(runs, now), problems, [])
        else:
            notes.append("가격 공장 실행 검사 건너뜀 (GITHUB_REPOSITORY/GITHUB_TOKEN 없음)")
        if env.get("PUBLIC_DEPLOY", "") == "on":
            live, live_meta = guarded("live", lambda: check_live(fetch, args.app_url), problems, ([], None))
            problems += live
        else:
            # public hosting paused (tools/factory.sh deploy): the public copy is frozen on purpose, so it is neither probed
            # nor used for the collection dates — the repository's data is what the factory keeps building
            live_meta = None
            notes.append("공개 주소 검사 건너뜀 (공개 배포 멈춤 — PUBLIC_DEPLOY가 on이 아님)")
        meta, where = (live_meta, "배포된 data-meta.json") if live_meta else (file_meta, "app/data-meta.json")
        notes.append(f"수집일 검사 기준: {where}")
        problems += guarded("freshness", lambda: check_freshness(meta, today, where=where), problems, [])
        # the key phones subscribe with: main's app/config.js (this checkout). While public hosting is paused the public app
        # is an older copy, so a key changed on main reaches phones only after the next public deploy.
        app_key = app_push_key(args.root)
        w_problems, w_notes = guarded("workers", lambda: check_workers(fetch, env.get("MONITOR_WORKER_URLS", ""), app_key), problems, ([], []))
        problems += w_problems
        notes += w_notes
        title = "윤실장 감시: 확인할 것 {n}건"
    message = None
    if problems:
        message = compose(title.format(n=len(problems)), problems, run_url)
    elif args.weekly_heartbeat and not args.report_only and today.weekday() == 0:
        message = heartbeat_text(meta, runs, run_url, paused=env.get("PUBLIC_DEPLOY", "") != "on")
    if message and args.send:
        send(message, env=env)
    return problems, notes, message


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="윤실장 가격 공장·앱 감시 (텔레그램 알림)")
    ap.add_argument("--report-only", action="store_true", help="files only (data-meta + report.md), no network")
    ap.add_argument("--send", action="store_true", help="send to Telegram (otherwise print only)")
    ap.add_argument("--weekly-heartbeat", action="store_true", help="on Mondays (KST) with no problem, send a labeled 'still alive' line")
    ap.add_argument("--test", action="store_true", help="with --send: send one test line first")
    ap.add_argument("--today", help="KST date YYYY-MM-DD (tests)")
    ap.add_argument("--root", default=ROOT, help="repository root")
    ap.add_argument("--app-url", default=os.environ.get("APP_URL") or APP_URL)
    return ap.parse_args(argv)


def main(argv=None, env=None):
    args = parse_args(argv)
    env = os.environ if env is None else env
    problems, notes, message = run(args, env)
    for n in notes:
        print(f"참고: {n}")
    print(f"문제 {len(problems)}건" + ("" if problems else " — 알림 보내지 않음"))
    if message:
        print("---- 메시지 ----")
        print(message)
    summary = env.get("GITHUB_STEP_SUMMARY")
    if summary and problems:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("\n### 감시 결과\n" + "\n".join(f"- {p}" for p in problems) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
