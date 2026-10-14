"""Spec labels in the compare tab (build2/labels.py): the rules, the causes fixed where they start, and the build guard.
2026-10-14: '피코토닝 20만원3921만재생' / '피코토닝 미백톤업색소토닝' reached the app (닥터에버스 section titles glued in front of item
names, leftover words joined without spaces).
  python3 tests/labels_test.py
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
import labels, taxonomy  # noqa: E402

fails = []


def ok(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} | {name} | {detail}")
    if not cond:
        fails.append(name)


# 1) the rules
for label, want in [("피코토닝 20만원3921만재생 5회", ["가격", "붙은 글자"]), ("피코토닝 미백톤업색소토닝", ["붙은 글자"]),
                    ("레디어스 10월1일10월31일까지 1시린지", ["날짜", "붙은 글자"]), ("필러 리쥬비엘 브랜드10주년기념무한 1cc", ["홍보", "붙은 글자"]),
                    ("벨라콜린 | 지방세포파괴주사 2ml", ["기호"]), ("리쥬란 HB 플러스 2cc", []), ("바디 온다 리프팅 8만 J 3회", []),
                    ("(단색) 피코문신제거 500원", []), ("국산 사각턱 보톡스 50U", [])]:
    names = ["리쥬란 HB 플러스 2cc", "바디온다리프팅 8만 J 3회", "피코문신제거 500원", "국산 사각턱 보톡스 50유닛", "벨라콜린 | 지방세포파괴주사 2ml"]
    got = labels.problems(label, names)
    ok(f"규칙: '{label}' → {want or '문제 없음'}", got == want, got)
ok("규칙: 병원이 원래 붙여 쓴 말은 괜찮음", labels.problems("여성 어깨or배꼽주변or허리 제모", ["[여성] 어깨or배꼽주변or허리 1회"]) == [])

# 2) the causes, fixed where they start: no section title glued in, word breaks kept in what is left
v, _ = taxonomy.variant("피코토닝 재생 1회 5회", cat="피부·레이저")
ok("남은 말은 띄어 씀 ('비타민 수분 크라이오셀')", taxonomy._spaced("비타민수분크라이오셀", "아쿠아필 비타민 수분 크라이오셀 5회") == "비타민 수분 크라이오셀",
   taxonomy._spaced("비타민수분크라이오셀", "아쿠아필 비타민 수분 크라이오셀 5회"))
ok("띄어 써도 키(서명)는 붙인 그대로 — 묶음 id가 바뀌지 않음",
   taxonomy.variant("아쿠아필 비타민 수분 크라이오셀 5회", cat="피부·레이저")[0]["sig"] == taxonomy.variant("아쿠아필 비타민수분크라이오셀 5회", cat="피부·레이저")[0]["sig"])
hv, _ = taxonomy.variant("[여성] 손가락 or 발가락 제모 1회", cat="제모")
ok("제모 부위는 병원 표기대로 띄어 씀", hv and hv["famname"] == "손가락 or 발가락 제모", hv and hv["famname"])

# 3) the build guard: a label with a problem makes no compare key (its prices stay, not grouped) and is listed
rows = [dict(brand="A", branch=f"{i}점", name="피코토닝 20만원 39.21만 재생 5회", mname="피코토닝 20만원 39.21만 재생 5회", addon="0", kind="일반", cat="피부·레이저", keys="")
        for i in range(4)]
row_keys, keys, _, stats = taxonomy.build(rows)
ok("빌드 가드: 가격 글자가 든 규격은 비교 묶음을 만들지 않음", not any(row_keys) and not keys, [k["label"] for k in keys])
ok("빌드 가드: 뺀 규격은 stats.label_rejected에 남음", stats["label_rejected"] and stats["label_rejected"][0]["why"], stats["label_rejected"])

# 4) the data that ships: every compare label passes
D = json.load(open(os.path.join(ROOT, "app", "data.json"), encoding="utf-8"))
bad = [(k[2], labels.problems(k[2])) for k in D["keys"] if labels.problems(k[2])]
ok(f"app/data.json: 비교 규격 {len(D['keys']):,}개 모두 가격·날짜·홍보 문구·기호 없음", not bad, bad[:5])
vp = os.path.join(ROOT, "data2", "variants.json")
if os.path.exists(vp):
    rej = json.load(open(vp, encoding="utf-8"))["stats"].get("label_rejected", [])
    print(f"INFO | 이번 빌드에서 이상한 이름이라 뺀 규격 {len(rej)}개", [r["label"] for r in rej[:5]])

print(f"{'FAIL: ' + str(len(fails)) + ' failing' if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
