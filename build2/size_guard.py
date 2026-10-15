"""Size guard for app/data.json (6.0 C4): the build fails when the file passes 20 MiB.
Cloudflare serves a static file of at most 25 MiB (Workers static assets, per file); app/data.json is 15 MB now and grows with
every brand added, so the build stops 5 MiB short of that wall instead of the deploy failing after the data was saved.
Run by build2/weekly.py right after appdata.py: a build over the limit counts as a failed build, so weekly.py falls back to the
last accepted brand files, and when those are over the limit too it exits 1 (nothing is published).
  python build2/size_guard.py [path]          exit 0 = within the limit, 1 = over it (or the file is missing)
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "app", "data.json")
MIB = 1024 * 1024
LIMIT = 20 * MIB          # build fails above this
WALL = 25 * MIB           # Cloudflare's per-file limit
WARN_SHARE = 0.85         # the weekly report warns from this share of the limit on, before the build starts failing


def _mb(n):
    return f"{n / MIB:.1f}MiB"


def _name(path):
    rel = os.path.relpath(path, ROOT)
    return path if rel.startswith("..") else rel


def problem(path=DATA, limit=LIMIT):
    """why the file must not be published, or '' (missing file, or larger than the limit)"""
    if not os.path.exists(path):
        return f"{_name(path)} 없음 — 앱 데이터가 만들어지지 않았어요"
    size = os.path.getsize(path)
    if size > limit:
        shown, cap = (_mb(size), _mb(limit)) if _mb(size) != _mb(limit) else (f"{size:,}바이트", f"{limit:,}바이트")
        return (f"{_name(path)} {shown} — 한도 {cap}를 넘었어요 "
                f"(Cloudflare 파일당 한도 {_mb(WALL)}). 배포 전에 줄여야 해요")
    return ""


def report_line(path=DATA, limit=LIMIT):
    """one line for data2/report.md: the size against the limit, with a warning once it is close"""
    if not os.path.exists(path):
        return ""
    size = os.path.getsize(path)
    line = f"- 앱 데이터 파일 크기: {_mb(size)} (한도 {_mb(limit)})"
    if size > limit:
        return f"- **{line[2:]} — 한도 초과**"
    if size >= int(limit * WARN_SHARE):
        line += " — **한도에 가까워요**: 다음 브랜드를 더하기 전에 줄일 곳을 봐 주세요"
    return line


def main(argv):
    path = argv[1] if len(argv) > 1 else DATA
    why = problem(path)
    if why:
        print(f"size_guard: {why}", file=sys.stderr)
        return 1
    print(f"size_guard: {_name(path)} {_mb(os.path.getsize(path))} (한도 {_mb(LIMIT)})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
