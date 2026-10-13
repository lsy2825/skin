"""The whole weekly update: scrape every brand -> safety checks -> clean -> app/data.json. Exit code 1 = do not publish.

usage: python build2/weekly.py [--skip-scrape] [--date YYYY-MM-DD]
Safety: each brand's new raw file is compared with the last accepted one (data2/accepted/<brand>.csv). If a brand
lost more than 30% of its rows or branches, or its scraper failed, the last accepted file is used for that brand
and the report says so (the app then shows that brand's older date). If every brand failed, nothing is published.
Report: data2/report.md (also printed) — what changed, what was kept, issues fixed.
"""
import argparse, csv, datetime, json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, ACC = os.path.join(ROOT, "data2", "raw"), os.path.join(ROOT, "data2", "accepted")
SCRAPERS = [("velyb", "블리비"), ("ppeum", "쁨"), ("toxnfill", "톡스앤필"), ("lienjang", "리엔장"), ("forever", "포에버")]
PY = sys.executable


def run(args):
    """run a step, echo its output; on failure also print the last lines as a GitHub annotation (readable in the
    run's summary/API even when the full log can't be downloaded)"""
    print("$", " ".join(args), flush=True)
    p = subprocess.Popen([PY] + args, cwd=ROOT, env={**os.environ, "PYTHONUTF8": "1"}, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    tail = []
    for line in p.stdout:
        print(line, end="", flush=True)
        tail = (tail + [line.rstrip()])[-25:]
    ok = p.wait() == 0
    if not ok and os.environ.get("GITHUB_ACTIONS"):
        msg = "%0A".join(s.replace("%", "%25").replace("\r", "") for s in tail)
        print(f"::error title={' '.join(args)} failed::{msg}", flush=True)
    return ok


def stats(path):
    if not os.path.exists(path):
        return 0, 0
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    return len(rows), len({r["branch"] for r in rows})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-scrape", action="store_true")
    ap.add_argument("--date", default=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat())
    a = ap.parse_args()
    os.makedirs(ACC, exist_ok=True)
    os.makedirs(RAW, exist_ok=True)
    report = [f"# 주간 갱신 {a.date}", ""]
    used_new, fresh = 0, []
    for key, brand in SCRAPERS:
        new = os.path.join(RAW, f"{key}.csv")
        old = os.path.join(ACC, f"{key}.csv")
        ok = True if a.skip_scrape else run([f"scrape/{key}.py"])
        n_new, b_new = stats(new) if ok else (0, 0)
        n_old, b_old = stats(old)
        bad = (not ok or n_new == 0 or (n_old and (n_new < 0.7 * n_old or b_new < 0.7 * b_old)))
        if a.skip_scrape and n_old:
            shutil.copy(old, new)
            report.append(f"- {brand}: 저장된 자료 {n_old:,}행 · {b_old}개 지점 (이번엔 수집 안 함)")
            continue
        if bad and n_old:
            shutil.copy(old, new)
            report.append(f"- **{brand}: 지난 자료 유지** (새로 읽은 행 {n_new:,}/지점 {b_new} vs 지난번 {n_old:,}/{b_old}) — 사이트 확인 필요")
        elif bad:
            report.append(f"- **{brand}: 수집 실패, 이전 자료도 없음** — 이번 데이터에서 빠짐")
            if os.path.exists(new):
                os.remove(new)
        else:
            fresh.append((key, brand))      # saved to data2/accepted only after the build below works
            used_new += 1
            report.append(f"- {brand}: {n_new:,}행 · {b_new}개 지점" + (f" (지난번 {n_old:,}행 · {b_old}개 지점)" if n_old else ""))
    if not used_new and not any(os.path.exists(os.path.join(ACC, f"{k}.csv")) for k, _ in SCRAPERS):
        print("\n".join(report))
        sys.exit("no brand has data: nothing to publish")
    if not a.skip_scrape:
        run(["scrape/branches.py"])
    build = lambda: run(["build2/clean.py"]) and run(["build2/appdata.py", "--date", a.date])
    if not build():
        # the new data broke the build: publish last week's data instead, so the app keeps working
        for key, brand in fresh:
            new, old = os.path.join(RAW, f"{key}.csv"), os.path.join(ACC, f"{key}.csv")
            if os.path.exists(old):
                shutil.copy(old, new)
            elif os.path.exists(new):
                os.remove(new)
        report.append(f"- **새 자료로 앱 데이터 만들기 실패 → 지난 자료로 배포** (새로 읽은 브랜드: {', '.join(b for _, b in fresh) or '-'}) — 오류는 실행 요약 참고")
        fresh = []
        if not build():
            print("\n".join(report))
            sys.exit("build failed: nothing to publish")
    for key, _ in fresh:
        shutil.copy(os.path.join(RAW, f"{key}.csv"), os.path.join(ACC, f"{key}.csv"))
    issues = list(csv.DictReader(open(os.path.join(ROOT, "data2", "issues.csv"), encoding="utf-8-sig")))
    meta = json.load(open(os.path.join(ROOT, "app", "data.json"), encoding="utf-8"))["meta"]
    report += ["", f"- 앱 데이터: 가격 {meta['rows']:,}개 · 지점 {meta['branches']}곳",
               f"- 정리한 줄: {len(issues)}개 (data2/issues.csv)"]
    open(os.path.join(ROOT, "data2", "report.md"), "w", encoding="utf-8", newline="\n").write("\n".join(report) + "\n")
    print("\n".join(report))


if __name__ == "__main__":
    main()
