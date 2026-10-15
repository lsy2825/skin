"""6.0 C4: the size guard for app/data.json (build2/size_guard.py): the build fails above 20 MiB (Cloudflare serves a static
file of at most 25 MiB). Also that build2/weekly.py really runs it, and that the file as it is now is inside the limit.
  python3 tests/size_guard_test.py"""
import os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
import size_guard as g  # noqa: E402

fails = []


def ok(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} | {name} | {detail}")
    if not cond:
        fails.append(name)


d = tempfile.mkdtemp()


def sized(name, n):
    p = os.path.join(d, name)
    with open(p, "wb") as f:
        f.truncate(n)   # sparse: the size is what counts
    return p


def cli(path):
    r = subprocess.run([sys.executable, os.path.join(ROOT, "build2", "size_guard.py")] + ([path] if path else []),
                       capture_output=True, text=True, encoding="utf-8")
    return r.returncode, (r.stdout + r.stderr).strip()


MIB = 1024 * 1024
ok("한도는 20MiB, Cloudflare 파일당 한도(25MiB)보다 아래", g.LIMIT == 20 * MIB and g.LIMIT < g.WALL == 25 * MIB, f"{g.LIMIT} / {g.WALL}")
at, over, small = sized("at.json", g.LIMIT), sized("over.json", g.LIMIT + 1), sized("small.json", 15 * MIB)
ok("한도 딱 그 크기는 통과(넘어야 실패)", g.problem(at) == "")
ok("한도보다 1바이트 크면 실패", bool(g.problem(over)), g.problem(over))
ok("1바이트 넘은 실패 문장은 바이트로 적음('20.0MiB가 20.0MiB를 넘음'으로 안 읽히게)", all(x in g.problem(over) for x in ("20,971,521바이트", "20,971,520바이트", "25.0MiB")), g.problem(over))
big = sized("big.json", 22 * MIB)
ok("크게 넘은 실패 문장은 MiB로: 크기·한도·Cloudflare 한도", all(x in g.problem(big) for x in ("22.0MiB", "20.0MiB", "25.0MiB")), g.problem(big))
ok("한참 아래는 통과", g.problem(small) == "")
ok("파일이 없으면 실패(앱 데이터가 안 만들어짐)", "없음" in g.problem(os.path.join(d, "nope.json")), g.problem(os.path.join(d, "nope.json")))
# the way weekly.py runs it
rc, out = cli(small); ok("실행: 통과하면 종료 코드 0", rc == 0, out)
rc, out = cli(at); ok("실행: 한도 딱 그 크기도 0", rc == 0, out)
rc, out = cli(over); ok("실행: 넘으면 종료 코드 1 + 이유 출력", rc == 1 and "한도" in out, out)
rc, out = cli(os.path.join(d, "nope.json")); ok("실행: 파일 없으면 종료 코드 1", rc == 1, out)
# the weekly report line
ok("보고 줄: 여유 있으면 경고 없음", "가까워요" not in g.report_line(sized("r1.json", 10 * MIB)) and "초과" not in g.report_line(sized("r1.json", 10 * MIB)), g.report_line(sized("r1.json", 10 * MIB)))
ok("보고 줄: 한도의 85%부터 '가까워요'", "가까워요" in g.report_line(sized("r2.json", int(g.LIMIT * 0.85))), g.report_line(sized("r2.json", int(g.LIMIT * 0.85))))
ok("보고 줄: 84%는 아직 경고 없음", "가까워요" not in g.report_line(sized("r3.json", int(g.LIMIT * 0.84))))
ok("보고 줄: 넘으면 '한도 초과'", "한도 초과" in g.report_line(over), g.report_line(over))
ok("보고 줄: 파일이 없으면 빈 줄 대신 빈 문자열", g.report_line(os.path.join(d, "nope.json")) == "")
# wiring: weekly.py's build is clean -> appdata -> size_guard, so a too-big build takes the same road as a broken one
src = open(os.path.join(ROOT, "build2", "weekly.py"), encoding="utf-8").read()
m = re.search(r"^\s*build = lambda: (.+)$", src, re.M)
ok("weekly.py: 빌드 끝에 size_guard를 돌림(앱 데이터를 만든 다음)", bool(m) and m.group(1).find("appdata.py") != -1 and m.group(1).find("appdata.py") < m.group(1).find("size_guard.py") != -1, m and m.group(1))
ok("weekly.py: size_guard를 가져옴(보고 줄·되돌리기에 씀)", re.search(r"^import size_guard\b", src, re.M) is not None)
# the file the app serves now
real = g.DATA
if os.path.exists(real):
    size = os.path.getsize(real)
    ok(f"지금 app/data.json은 한도 안 ({size / MIB:.1f}MiB / {g.LIMIT / MIB:.0f}MiB)", g.problem() == "", g.report_line())
else:
    print("SKIP | app/data.json 없음")
print(f"size guard {'OK' if not fails else str(len(fails)) + ' FAIL'}")
sys.exit(1 if fails else 0)
