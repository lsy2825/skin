"""5.1: the weekly pipeline's value guard (build2/weekly.py malformed): a brand file whose prices stop reading, or whose
median price jumps 3x, never replaces the accepted file. Run: python3 tests/weekly_guard_test.py"""
import csv, os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "build2"))
import weekly

def write(path, prices):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f); w.writerow(["brand", "branch", "option", "sale"])
        for i, p in enumerate(prices): w.writerow(["쁨", f"b{i % 5}", f"opt{i}", p])

d = tempfile.mkdtemp(); old, new = os.path.join(d, "old.csv"), os.path.join(d, "new.csv")
write(old, [10000 + i * 100 for i in range(200)])
fails = 0
def check(name, prices, expect_bad):
    global fails
    write(new, prices); why = weekly.malformed(new, old)
    ok = bool(why) == expect_bad; fails += not ok
    print(("PASS" if ok else "FAIL"), name, why)
check("normal week", [10000 + i * 110 for i in range(200)], False)
check("prices stopped reading (blank / 0)", ["" if i % 4 == 0 else 0 if i % 4 == 1 else 12000 for i in range(200)], True)
check("currency/unit broke: all prices 1000x", [(10000 + i * 100) * 1000 for i in range(200)], True)
check("prices read as tiny numbers", [12 for _ in range(200)], True)
check("5% unreadable is tolerated", ["" if i % 20 == 0 else 11000 for i in range(200)], False)
check("first file of a brand (no old)", [9000] * 50, False) if os.remove(old) is None else None
print("weekly guard", "OK" if not fails else f"{fails} FAIL"); sys.exit(1 if fails else 0)
