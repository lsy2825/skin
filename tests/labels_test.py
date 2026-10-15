"""Spec labels in the compare tab (build2/labels.py): the rules, the causes fixed where they start, and the build guard.
2026-10-14: '피코토닝 20만원3921만재생' / '피코토닝 미백톤업색소토닝' reached the app (닥터에버스 section titles glued in front of item
names, leftover words joined without spaces).
  python3 tests/labels_test.py
"""
import json, os, re, sys

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
                    ("벨라콜린 | 지방세포파괴주사 2ml", ["기호"]), ("피코토닝 10+10회 ()", ["괄호"]), (") 비타민관리", ["괄호"]), ("리쥬란 HB 플러스 2cc", []), ("바디 온다 리프팅 8만 J 3회", []),
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

for raw, want in [("피코토닝 10+10회 ()", "피코토닝 10+10회"), ("피코토닝 1+1회 (1회 )", "피코토닝 1+1회 (1회)"), (") 비타민관리", "비타민관리"),
                  ("男) 인중 + 앞턱 1회", "남성 인중 + 앞턱 1회"), ("\uf981) 종아리 + 무릎 1회", "여성 종아리 + 무릎 1회"), ("스킨보톡스 (국산) 1회", "스킨보톡스 (국산) 1회")]:
    ok(f"괄호 정리: '{raw}' → '{want}'", taxonomy._tidy(raw) == want, taxonomy._tidy(raw))

# 3) the build guard: a label with a problem makes no compare key (its prices stay, not grouped) and is listed
rows = [dict(brand="A", branch=f"{i}점", name="피코토닝 20만원 39.21만 재생 5회", mname="피코토닝 20만원 39.21만 재생 5회", addon="0", kind="일반", cat="피부·레이저", keys="")
        for i in range(4)]
row_keys, keys, _, stats = taxonomy.build(rows)
ok("빌드 가드: 가격 글자가 든 규격은 비교 묶음을 만들지 않음", not any(row_keys) and not keys, [k["label"] for k in keys])
ok("빌드 가드: 뺀 규격은 stats.label_rejected에 남음", stats["label_rejected"] and stats["label_rejected"][0]["why"], stats["label_rejected"])

# 3b) 2026-10-15 정리 규칙 (개선 보고서 E1·E2·E3·E4·E10)
# E1: '병원 설명' keeps what the product is, not a sales condition or a pitch
for t in ["카톡플친 적용가", "리터치 불가", "자갈턱보톡스 병행 추천", "볼륨과 주름개선을 동시에 !", "디자인 미진행", "부위 무관"]:
    ok(f"E1 병원 설명에서 뺌: '{t}'", labels.desc_problems(t) != [], labels.desc_problems(t))
for t in ["고강도 집속 초음파", "PN 프리미엄 스킨부스터", "아포지 플러스", "스웨덴 레스틸렌", "RF 니들 프락셔널"]:
    ok(f"E1 병원 설명에 남김: '{t}'", labels.desc_problems(t) == [], labels.desc_problems(t))
# E3: a label with only an area / size / add-on word left has lost its product
for label in ["눈밑", "이마 3회", "이내 10mm 1개 (표기 2)", "얼굴 1부위", "바디 1부위", "풀커버", "가운데부위 추가시"]:
    ok(f"E3 부위만 남은 이름: '{label}'", "부위만" in labels.problems(label), labels.problems(label))
for label in ["겨드랑이 제모", "여성 손 제모 5회", "국산 사각턱 보톡스 50U", "리쥬란 HB 플러스 2cc", "DIA 500샷", "얼굴전체 압출", "도트필 개당"]:
    ok(f"E3 제품 이름이 있으면 괜찮음: '{label}'", "부위만" not in labels.problems(label), labels.problems(label))
for name, why in [("미희주사 1cc 추가당 (특수부위 제외)", "추가 옵션"), ("가운데부위 추가시", "추가 옵션"), ("미희주사 1cc추가*(특수부위 제외)", "추가 옵션"),
                  ("아그네스 1개당 (10개 이상부터 시술 가능)", "조건부")]:
    v, reason = taxonomy.variant(name)
    ok(f"E3 추가·조건 가격은 비교 묶음 없음: '{name}'", v is None and reason.startswith(why), reason)
import xkeys  # noqa: E402
x34 = next(k for k in xkeys.X if k[0] == "X34")
ok("E3 괄호 안 '추가 시' 설명은 기본가를 빼지 않음(톡스앤필 '염증주사 1부위 (1부위 추가 시 5000원)')",
   xkeys.match(x34, "[EVENT] 염증주사 1부위 (1부위 추가 시 5000원)") and taxonomy.variant("염증주사 1부위 (1부위 추가 시 5000원)")[0] is not None)
# as clean.py hands them over: mname with the group title in front ('상체 제모 [여성]손 …'), name with ' · '
w, _ = taxonomy.variant("상체 제모 [여성]손 5회 (손등 + 손가락)", cat="제모", display="상체 제모 · [여성]손 5회 (손등 + 손가락)")
m, _ = taxonomy.variant("상체 제모 [남성]손 5회 (손등 + 손가락)", cat="제모", display="상체 제모 · [남성]손 5회 (손등 + 손가락)")
ok("E3 제모 괄호 안 '+'는 부위 나열: 여성·남성이 따로", w and m and w["label"] == "여성 손 제모 5회 (손등 + 손가락)" and w["sig"] != m["sig"],
   (w and w["label"], m and m["label"]))
a, _ = taxonomy.variant("[여성] 겨드랑이 제모 5회 (겨드랑이 + 인중)", cat="제모")
b, _ = taxonomy.variant("[여성] 겨드랑이 제모 5회", cat="제모")
ok("E3 괄호 안 부위 목록이 다르면 따로(겨드랑이+인중 ≠ 겨드랑이)", a and b and a["sig"] != b["sig"], (a and a["label"], b and b["label"]))
# E2·E10: specs written differently (letter case, word breaks, where a bracket stands, 'Vial') are one key
ok("E2 1Vial = 1vial", taxonomy.variant("쥬베룩 볼륨 1Vial 1회")[0]["sig"] == taxonomy.variant("쥬베룩 볼륨 1vial 1회")[0]["sig"])


def fake(names):
    """rows at distinct branches, one per name"""
    return [dict(brand="A", branch=f"{i}점", name=n, mname=n, addon="0", kind="일반", cat="기타", keys="") for i, n in enumerate(names)]


for title, names, want_label in [
        ("E2 대소문자", ["리쥬란 S 1cc", "리쥬란 S 1cc", "리쥬란S 1cc", "리쥬란 s 1cc"], "리쥬란 S 1cc"),
        ("E2 대소문자(PLUS/Plus)", ["리쥬란 HB PLUS 2cc", "리쥬란 HB PLUS 2cc", "리쥬란 HB Plus 2cc"], "리쥬란 HB 플러스 PLUS 2cc"),
        ("E10 띄어쓰기", ["아르기닌 주사 5회", "아르기닌 주사 5회", "아르기닌주사 5회", "아르기닌주사 5회"], "아르기닌 주사 5회"),
        ("E10 괄호 자리", ["줄기세포 페이스 (손주사) 3cc", "줄기세포 페이스 (손주사) 3cc", "줄기세포 페이스 3cc (손주사)"], "줄기세포 페이스 3cc")]:
    rk, ks, _, st = taxonomy.build(fake(names))
    ok(f"{title}: 묶음 하나, 지점 {len(names)}곳", len(ks) == 1 and ks[0]["n"] == len(names) and len(set(rk)) == 1, [(k["label"], k["n"]) for k in ks])
    ok(f"{title}: 많은 쪽 이름 '{want_label}'", ks and ks[0]["label"].startswith(want_label), ks and ks[0]["label"])
rk, ks, _, st = taxonomy.build(fake(["리쥬란 S 1cc"] * 3 + ["리쥬란 s 1cc"]))
alone, _, _, _ = taxonomy.build(fake(["리쥬란 S 1cc"] * 3))
ok("E2 합쳐도 많은 쪽 id는 그대로(장바구니·알림 유지)", ks and set(rk) == set(alone), (rk, alone))
ok("E2 합친 규격은 stats.merged에 남음", st["merged"] and st["merged"][0]["rows"] == 1, st["merged"])
_, ks, _, _ = taxonomy.build(fake(["다른 제품 1cc"] * 3 + ["다른제품 2cc"] * 3))
ok("E10 용량이 다르면 합치지 않음", len(ks) == 2, [k["label"] for k in ks])
_, ks, _, _ = taxonomy.build(fake(["귓볼/귓바퀴/귀모서리(요정귀) (벨로테로) 1cc"] * 3 + ["귓볼/귓바퀴/귀모서리(요정귀) (레스틸렌) 1cc"] * 3))
ok("이름이 같아 보이는 두 규격은 서로 다른 설명으로 구분(벨로테로·레스틸렌)", sorted(k["label"] for k in ks) ==
   ["귓볼/귓바퀴/귀모서리 1cc (레스틸렌)", "귓볼/귓바퀴/귀모서리 1cc (벨로테로)"], [k["label"] for k in ks])

# 검증에서 찾은 것 (2026-10-15 2차)
ok("':'로 끝난 묶음 제목은 같은 상품과 한 묶음('텐텐듀얼리프팅:' = '텐텐듀얼리프팅')",
   taxonomy.variant("고주파 리프팅 텐텐듀얼리프팅: 1회")[0]["sig"] == taxonomy.variant("고주파 리프팅 텐텐듀얼리프팅 1회")[0]["sig"])
ok("'첫방문고객)'은 통째로 떼고 '고객'을 남기지 않음", taxonomy.variant("첫방문고객) 비타민관리 1회 체험가")[0]["label"] == "비타민관리",
   taxonomy.variant("첫방문고객) 비타민관리 1회 체험가")[0]["label"])
for a, b in [("턱끝 필러 리쥬비엘 당 1cc", "턱끝 필러 리쥬비엘 1cc당"), ("리팟 레이저 이내 10mm 1개", "리팟 레이저 10mm 이내 1개"),
             ("얼굴전체 병변 제거 이하 50개", "얼굴전체 병변 제거 50개 이하"), ("점 빼기 1개 (2mm 이하)", "점 빼기 1개 (2mm 이하)")]:
    ok(f"어순: '{a}' → '{b}'", taxonomy.word_order(a) == b, taxonomy.word_order(a))
_, ks, fams, _ = taxonomy.build(fake(["[여성] 뒷목 제모 1회"] * 5 + ["[여성] 뒷 목 제모 1회"]))
ok("철자는 많이 쓰인 쪽('뒷목' 5줄 > '뒷 목' 1줄)", [f["name"] for f in fams] == ["뒷목 제모"], [f["name"] for f in fams])
rk, ks, _, _ = taxonomy.build(fake(["손등 손가락 1회 (A)"] * 3 + ["손등 손가락 1회 (B)"] * 3 + ["손등 손가락 5회 (A)"] * 3 + ["손등 손가락 5회 (B)"] * 3))
lab = {k["id"]: k["label"] for k in ks}
pick = lambda i: re.search(r"표기 \d", lab.get(rk[i], "")) and re.search(r"표기 \d", lab[rk[i]]).group()
ok("'표기 n'으로 구분할 때 같은 상품은 1회·5회에서 같은 번호", pick(0) and pick(0) == pick(6) and pick(3) == pick(9) and pick(0) != pick(3),
   [lab.get(rk[i]) for i in (0, 3, 6, 9)])

for label in ["눈 밑", "마리오넷", "옆볼/앞볼"]:
    ok(f"E3 띄어 쓰거나 목록에 없던 부위도 '부위만': '{label}'", "부위만" in labels.problems(label), labels.problems(label))
for label in ["눈밑 필러", "미희주사 팔자 3회", "리팟레이저 5mm 이내 1개"]:
    ok(f"E3 상품 낱말이 있으면 괜찮음: '{label}'", labels.problems(label) == [], labels.problems(label))
lip = "리팟레이저 단 한번의 시술로 흑자 제거! 시술 · 5mm 이내 1개"
rk, ks, _, st = taxonomy.build([dict(brand="밴스", branch=f"{i}점", name=lip, mname=lip.replace(" · ", " "), addon="0", kind="일반", cat="피부·레이저", keys="")
                                for i in range(4)])
ok("E3 상품명이 묶음 제목에만 있으면 버리지 않고 이름에 되살림('리팟레이저 5mm 이내 1개')", ks and ks[0]["label"] == "리팟레이저 5mm 이내 1개" and st["label_rescued"],
   [k["label"] for k in ks])
ok("E3 묶음 제목의 상품이 없거나 서로 다르면 되살리지 않음('풀커버')",
   taxonomy.product_head(["풀커버", "기본색소 입술반영구 · 풀커버"]) == "" and
   taxonomy.product_head(["기본색소 입술반영구 · 풀커버", "프리미엄 입술반영구 · 풀커버"]) == "" and
   taxonomy.product_head(["THE 미희주사 꺼진 눈밑 볼륨 · 팔자 1회"] * 2) == "미희주사")
ok("E3 이름에 제목이 없으면 그 줄의 묶음 제목에서 상품명('퀵제로팻 페이스 ★…' · '얼굴 1부위' → 퀵제로팻), 이벤트 제목은 상품명 아님",
   taxonomy.product_head(["얼굴 1부위"] * 2, ["퀵제로팻 페이스 ★단 한 방, 퀵! 하게 뺀다★ 시술안내"] * 2) == "퀵제로팻" and
   taxonomy.product_head(["THE 미희주사 꺼진 눈밑 볼륨 · 눈밑 1회", "눈밑 1회"], ["THE 미희주사 꺼진 눈밑 볼륨", "★10월 한정이벤트★"]) == "")
ok("묶음 상품의 괄호는 제 부분 안에서만 정렬('이마필러(국산)+이마보톡스' ≠ '이마필러+이마보톡스(국산)')",
   taxonomy.loose_sig("x|f|이마필러5cc(국산)＋이마보톡스|1") != taxonomy.loose_sig("x|f|이마필러5cc＋이마보톡스(국산)|1"))
ok("'10 mm 이내'와 '10mm 이내'는 같은 규격",
   taxonomy.variant("리팟레이저 10 mm 이내 1개")[0]["sig"] == taxonomy.variant("리팟레이저 10mm 이내 1개")[0]["sig"])

# 검증 3차: 제모 부위 읽기·성별·부위 미표기·홍보 문구
for n, d, want in [("[여성] 손등 + 손가락제모 5회", None, "여성 손가락·손등 제모 5회"), ("여성 바디 제모 [겨드랑이] 5회", "여성 바디 제모 · [겨드랑이] 5회", "여성 겨드랑이 제모 5회")]:
    v, _ = taxonomy.variant(n, cat="제모", display=d)
    ok(f"제모 부위: '{n}' → '{want}'", v and v["label"] == want, v and v["label"])
w, _ = taxonomy.variant("[여성] 발등+발가락 5회", cat="기타", display="젠틀맥스 제모 · 발등+발가락 5회")
m, _ = taxonomy.variant("[남성] 발등+발가락 5회", cat="기타", display="젠틀맥스 제모 · 발등+발가락 5회")
ok("이름에 성별이 없으면 묶음 제목의 성별을 서명·이름에(여성·남성이 '표기 n'이 아니라 이름으로 갈림)", w and m and w["sig"] != m["sig"] and w["label"].startswith("여성")
   and m["label"].startswith("남성"), (w and w["label"], m and m["label"]))
_, ks, _, st = taxonomy.build(fake(["[남성] 제모 10회"] * 3))
ok("'부위 미표기' 제모는 비교 묶음을 만들지 않음", not ks and st["label_rejected"] and st["label_rejected"][0]["why"] == ["부위 미표기"], st["label_rejected"])
ok("'!' 든 홍보 문구 이름은 막음", "기호" in labels.problems("초음파 리프팅 안에서 올려주고! 밖에서 당겨주는 더블업 리프팅"))

# E4·E10: build2/clean.py on a made-up raw file (a temporary folder, the real data2/ is not touched)
import clean, csv, tempfile  # noqa: E402
raw = [  # category, group, option, sale, orig
    ("리프팅", "덴서티 리프팅", "덴서티 리프팅 600샷 체험가", 1590000, 3000000),
    ("기획전", "가을 세일 페스타", "덴서티 리프팅 600샷 체험가", 1590000, 3100000),       # same item, other page, other list price → one row
    ("스킨케어", "피부관리", "플라센타관리 1회", 50000, 0),
    ("스킨케어", "피부관리", "플라센타 관리 1회", 50000, 0),                            # word break only → one row
    ("제모", "젠틀맥스 남성 제모", "미간or코 제모 1회", 20000, 38000),
    ("제모", "젠틀맥스 여성 제모", "미간or코 제모 1회", 20000, 38000),                  # same name and prices, other sex → two rows
    ("리프팅", "온다 리프팅", "옵션5) 덴서티 하이 300샷 추가", 850000, 0),
    ("리프팅", "인모드 리프팅", "옵션5) 덴서티 하이 300샷 추가", 850000, 0),             # one add-on on two product pages → one row (as before)
    ("리프팅", "덴서티 리프팅", "덴서티 리프팅 300샷", 690000, 0),
    ("리프팅", "덴서티 리프팅", "덴서티 리프팅 300샷", 790000, 0),                       # other sale price → two rows
    ("이벤트", "★10월 이벤트★", "바디울쎄라 100샷", 490000, 600000),
    ("레이저리프팅", "바디울쎄라", "바디울쎄라 100샷", 490000, 950000),                  # an event page first, the price list second → its 정가
    ("리프팅", "인모드 리프팅", "인모드 FX 얼굴전체 체험가", 59000, 100000),
    ("기획전", "첫 시술 부탁해 이벤트", "인모드 FX 얼굴전체 체험가", 59000, 117000),        # '첫 방문' only on one page → no condition
    ("제모", "여자 레이저 제모", "브라질리언 1회", 59000, 100000),
    ("제모", "여성 레이저 제모", "브라질리언 1회", 59000, 100000),                       # 여자 = 여성 → one row
    ("제모", "젠틀맥스프로플러스 여성 제모", "[여성] 팔 하완 제모 5회", 340000, 600000),
    ("제모", "아포지엘리트플러스 여성 제모", "[여성] 팔 하완 제모 5회", 340000, 400000),   # two price lists, other device → two rows
    ("제모", "남성 1년 무제한제모 이벤트", "남자얼굴제모", 690000, 1200000),               # a 1-year pass named in the group → 구독권
    ("제모", "젠틀맥스 여성 제모 1년 무제한으로 확실한 제모효과!", "발등+발가락 5회", 250000, 400000),   # sessions stated → not a pass
    ("제모", "제모 옵션", "[옵션] 제모 후 진정관리 10회", 200000, 0)]                      # '[옵션]' → an add-on (addon=1)
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "data2", "raw"))
    with open(os.path.join(tmp, "data2", "raw", "velyb.csv"), "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["brand", "branch", "category", "group", "option", "sale", "orig", "addon", "until", "url", "fetched_at"])
        for c, g, o, s, p in raw:
            wr.writerow(["블리비", "강남점", c, g, o, s, p or "", "0", "", "https://example.invalid/", "2026-10-15T06:00:00+09:00"])
    root, rawdir = clean.ROOT, clean.RAW
    clean.ROOT, clean.RAW = tmp, os.path.join(tmp, "data2", "raw")
    try:
        import contextlib, io
        with contextlib.redirect_stdout(io.StringIO()):
            clean.main()
    finally:
        clean.ROOT, clean.RAW = root, rawdir
    out = list(csv.DictReader(open(os.path.join(tmp, "data2", "clean.csv"), encoding="utf-8")))
    iss = list(csv.DictReader(open(os.path.join(tmp, "data2", "issues.csv"), encoding="utf-8-sig")))
cnt = lambda pred: sum(1 for r in out if pred(r))
dens = [r for r in out if r["option"] == "덴서티 리프팅 600샷 체험가"]
ok("E4 같은 상품·판매가, 정가만 다른 두 페이지 → 한 줄(카테고리 페이지의 정가)", len(dens) == 1 and dens[0]["orig"] == "3000000" and dens[0]["src_cat"] == "리프팅",
   [(r["src_cat"], r["orig"]) for r in dens])
ok("E10 띄어쓰기만 다른 같은 상품 → 한 줄", cnt(lambda r: r["option"].replace(" ", "") == "플라센타관리1회") == 1)
ok("E4 성별이 다르면 이름·가격이 같아도 두 줄", cnt(lambda r: r["option"] == "미간or코 제모 1회") == 2, [r["mname"] for r in out if r["option"] == "미간or코 제모 1회"])
ok("E4 여러 상품 페이지의 같은 추가 옵션 → 한 줄(예전 규칙 유지)", cnt(lambda r: r["option"].startswith("옵션5)")) == 1)
ok("E4 판매가가 다르면 두 줄", cnt(lambda r: r["option"] == "덴서티 리프팅 300샷") == 2)
ok("E4 새로 합친 줄은 issues.csv에 '합침'으로 남음", sorted(i["reason"] for i in iss if i["action"] == "합침") ==
   ["같은 상품·판매가가 두 페이지에(정가 다름)"] * 3 + ["띄어쓰기·대소문자만 다른 같은 상품"], [(i["action"], i["reason"]) for i in iss])
one = lambda opt: [r for r in out if r["option"] == opt]
b = one("바디울쎄라 100샷")
ok("E4 행사 페이지가 먼저 와도 가격표 페이지의 정가·분류를 남김(블리비 '기획전'만이 아님)", len(b) == 1 and b[0]["orig"] == "950000" and b[0]["src_cat"] == "레이저리프팅",
   [(r["src_cat"], r["orig"]) for r in b])
i = one("인모드 FX 얼굴전체 체험가")
ok("E4 조건은 모든 페이지에 있을 때만 남김(한 페이지에만 '첫 방문' → 조건 없음)", len(i) == 1 and i[0]["tags"] == "", [r["tags"] for r in i])
ok("E4 '여자'와 '여성'은 같은 성별 → 한 줄", len(one("브라질리언 1회")) == 1, [r["mname"] for r in one("브라질리언 1회")])
ok("E4 가격표 두 곳(묶음 제목·정가 다름, 장비가 다른 상품)은 합치지 않음", len(one("[여성] 팔 하완 제모 5회")) == 2)
ok("1년 무제한 묶음의 회차 없는 옵션은 구독권, 회차가 적힌 옵션은 아님",
   one("남자얼굴제모")[0]["kind"] == "구독권" and one("발등+발가락 5회")[0]["kind"] != "구독권", [one("남자얼굴제모")[0]["kind"], one("발등+발가락 5회")[0]["kind"]])
opt_row = one("[옵션] 제모 후 진정관리 10회")
ok("'[옵션]' 머리표 줄은 이름은 그대로(머리표 뗌), addon=1이라 비교 키 없음", opt_row and opt_row[0]["addon"] == "1" and not opt_row[0]["keys"]
   and not opt_row[0]["name"].startswith("["), opt_row and (opt_row[0]["name"], opt_row[0]["addon"], opt_row[0]["keys"]))

# data-meta.json changes (build2/datameta.py): a price still at the branch under the same name is not 'gone' or 'new'
import datameta  # noqa: E402


def mini(rows):
    """a tiny data.json: rows (branch, name, price, kind) at brand A"""
    s = ["A"] + sorted({r[0] for r in rows} | {r[1] for r in rows} | {r[3] for r in rows})
    ix = {t: i for i, t in enumerate(s)}
    br = sorted({r[0] for r in rows})
    cols = [[br.index(r[0]) for r in rows], [0] * len(rows), [ix[r[1]] for r in rows], [r[2] for r in rows], [0] * len(rows), [ix[r[3]] for r in rows]]
    return {"s": s, "meta": {"brands": [["A"]]}, "branches": [[0, ix[b]] for b in br], "cols": cols}


old_d = mini([("강남점", "겨드랑이 1년 무제한", 99000, "일반"), ("강남점", "가다실9가 1회", 185000, "일반"), ("강남점", "리쥬란 2cc", 200000, "일반")])
new_d = mini([("강남점", "겨드랑이 1년 무제한", 99000, "구독권"), ("강남점", "가다실 9가 1회", 185000, "일반"), ("강남점", "쥬베룩 2cc", 250000, "일반")])
c = datameta.changes(old_d, new_d, "v")
ok("가격 변동 목록: 종류·띄어쓰기만 바뀐 같은 가격은 없어짐/새로 생김이 아님, 진짜로 바뀐 것만",
   [x[2] for x in c["added"]] == ["쥬베룩 2cc"] and [x[2] for x in c["removed"]] == ["리쥬란 2cc"], c)

# 4) the data that ships: every compare label passes
D = json.load(open(os.path.join(ROOT, "app", "data.json"), encoding="utf-8"))
bad = [(k[2], labels.problems(k[2])) for k in D["keys"] if labels.problems(k[2])]
ok(f"app/data.json: 비교 규격 {len(D['keys']):,}개 모두 가격·날짜·홍보 문구·기호·괄호 문제 없음", not bad, bad[:5])
vp = os.path.join(ROOT, "data2", "variants.json")
if os.path.exists(vp):
    rej = json.load(open(vp, encoding="utf-8"))["stats"].get("label_rejected", [])
    print(f"INFO | 이번 빌드에서 이상한 이름이라 뺀 규격 {len(rej)}개", [r["label"] for r in rej[:5]])

print(f"{'FAIL: ' + str(len(fails)) + ' failing' if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
