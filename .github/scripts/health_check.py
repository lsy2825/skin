#!/usr/bin/env python3
"""Health checks for the price factory and the app; alerts go to Telegram (docs/SECURITY_ARCHITECTURE.md §9).

usage: python .github/scripts/health_check.py --report-only [--send]   # after a factory run (weekly.yml): files only
       python .github/scripts/health_check.py [--send] [--weekly-heartbeat] [--test]   # daily watchdog (monitor.yml)

Checks (each returns problems as short Korean lines; no problem → no message, so alerts stay rare and meaningful):
  freshness  app/data-meta.json brands[i] = [name, branches, verified, stale, oldest, newest date]: a brand whose newest
             collection is more than 8 days before today (KST), a brand with stale branches, an unreadable file
  guard      data2/report.md lines that build2/weekly.py writes when its data guard kept old data or skipped a brand
  factory    (watchdog) the latest weekly-prices runs on main, from the GitHub REST API: failed, missing for 26 hours, stuck
  live       (watchdog) the app URL answers 200 and its data-meta.json parses; the live file is then used for freshness
  workers    (watchdog) each URL in MONITOR_WORKER_URLS (space/comma separated, empty = skipped) answers below HTTP 500

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


def check_workers(fetch, urls_text):
    """(problems, notes). Each Worker answers GET <url>/health with 200 {"ok": true} after touching its bindings; anything
    else — 404 included — counts as down, because an API Worker can answer '/' while its real routes throw."""
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
            try:
                healthy = status == 200 and json.loads(body.decode("utf-8")).get("ok") is True
            except (ValueError, AttributeError):
                healthy = False
            if healthy:
                notes.append(f"Worker 살아 있음: {host}")
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


def heartbeat_text(meta, runs, run_url=""):
    """the Monday 'still alive' line: silence on other days means healthy only while this keeps arriving"""
    lines = ["[주간 생존 신호] 윤실장 감시가 돌고 있어요. 지금 확인할 문제는 없어요."]
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
        live, live_meta = guarded("live", lambda: check_live(fetch, args.app_url), problems, ([], None))
        problems += live
        meta, where = (live_meta, "배포된 data-meta.json") if live_meta else (file_meta, "app/data-meta.json")
        notes.append(f"수집일 검사 기준: {where}")
        problems += guarded("freshness", lambda: check_freshness(meta, today, where=where), problems, [])
        w_problems, w_notes = guarded("workers", lambda: check_workers(fetch, env.get("MONITOR_WORKER_URLS", "")), problems, ([], []))
        problems += w_problems
        notes += w_notes
        title = "윤실장 감시: 확인할 것 {n}건"
    message = None
    if problems:
        message = compose(title.format(n=len(problems)), problems, run_url)
    elif args.weekly_heartbeat and not args.report_only and today.weekday() == 0:
        message = heartbeat_text(meta, runs, run_url)
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
