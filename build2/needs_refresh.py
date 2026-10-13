"""Should today's scheduled run scrape? (daily 06:00 KST trigger in .github/workflows/weekly.yml)

usage: python build2/needs_refresh.py      -> prints the decision; writes run=true|false to $GITHUB_OUTPUT if set
Monday: always (the regular weekly update). Other days: only when the saved prices of some brand have expired —
>= SHARE of its rows carry an event end date (until = YYYY-MM-DD) before today — so the app doesn't run out of valid
prices between Mondays (블리비 events end on Fridays, for example).
"""
import csv, datetime, glob, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARE = 0.2
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def main():
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    today = now.date().isoformat()
    run, why = now.weekday() == 0, ["월요일 정기 갱신"] if now.weekday() == 0 else []
    for p in sorted(glob.glob(os.path.join(ROOT, "data2", "accepted", "*.csv"))):
        rows = list(csv.DictReader(open(p, encoding="utf-8")))
        if not rows:
            continue
        over = sum(1 for r in rows if ISO.match(r.get("until") or "") and r["until"] < today)
        if over / len(rows) >= SHARE:
            run = True
            why.append(f"{os.path.basename(p)[:-4]}: 저장된 가격 {over:,}/{len(rows):,}개의 이벤트 기간이 끝남")
    print(f"{today}: {'수집함' if run else '수집 안 함'}" + (f" — {'; '.join(why)}" if why else ""))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"run={'true' if run else 'false'}\n")


if __name__ == "__main__":
    main()
