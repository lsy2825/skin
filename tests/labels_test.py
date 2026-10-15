"""Spec labels in the compare tab (build2/labels.py): the rules, the causes fixed where they start, and the build guard.
2026-10-14: '피코토닝 20만원3921만재생' / '피코토닝 미백톤업색소토닝' reached the app (닥터에버스 section titles glued in front of item
names, leftover words joined without spaces).
  python3 tests/labels_test.py
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
import clean, labels, taxonomy  # noqa: E402

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
ok("제모 부위 고르기('or')는 '/'와 같은 묶음으로, 가나다순 '·'로 보임", hv and hv["famname"] == "발가락·손가락 제모", hv and hv["famname"])
hv2, _ = taxonomy.variant("[여성] 발가락/손가락 제모 1회", cat="제모")
ok("... '손가락 or 발가락'과 '발가락/손가락'은 같은 서명", hv and hv2 and hv["sig"] == hv2["sig"], (hv and hv["sig"], hv2 and hv2["sig"]))
hv3, _ = taxonomy.variant("겨드랑이 제모 중 택1 5회", cat="제모")
ok("'중 택1'은 부위가 아님", hv3 and hv3["area"] == "겨드랑이", hv3 and hv3["area"])
hv4, _ = taxonomy.variant("첫방문고객 겨드랑이 제모 1회", cat="제모")
ok("'첫방문고객'은 부위가 아님", hv4 and hv4["area"] == "겨드랑이", hv4 and hv4["area"])
for raw, disp in [("여성제모 소노케어 1회", "여성제모 · 소노케어 1회"), ("크라이오 제모 진정 1회", "여성제모 · 크라이오 진정 1회")]:
    nv, _ = taxonomy.variant(raw, cat="제모", display=disp)
    ok(f"제모 칸의 부위 없는 관리('{disp}')는 제모 부위 키가 아님", nv and not nv["sig"].startswith("hair|"), nv and nv["sig"])

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
p_, _ = taxonomy.variant("[여성] 손등 + 손가락제모 5회", cat="제모")
ok("E3 제모 괄호 안 '+'는 부위 나열: 여성·남성이 따로, '손 (손등 + 손가락)'은 '손등 + 손가락제모'와 같은 상품",
   w and m and p_ and w["label"] == "여성 손가락+손등 제모 5회" and w["sig"] != m["sig"] and w["sig"] == p_["sig"], (w and w["label"], m and m["label"]))
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
for n, d, want in [("[여성] 손등 + 손가락제모 5회", None, "여성 손가락+손등 제모 5회"), ("여성 바디 제모 [겨드랑이] 5회", "여성 바디 제모 · [겨드랑이] 5회", "여성 겨드랑이 제모 5회")]:
    v, _ = taxonomy.variant(n, cat="제모", display=d)
    ok(f"제모 부위: '{n}' → '{want}'", v and v["label"] == want, v and v["label"])
w, _ = taxonomy.variant("[여성] 발등+발가락 5회", cat="기타", display="젠틀맥스 제모 · 발등+발가락 5회")
m, _ = taxonomy.variant("[남성] 발등+발가락 5회", cat="기타", display="젠틀맥스 제모 · 발등+발가락 5회")
ok("이름에 성별이 없으면 묶음 제목의 성별을 서명·이름에(여성·남성이 '표기 n'이 아니라 이름으로 갈림)", w and m and w["sig"] != m["sig"] and w["label"].startswith("여성")
   and m["label"].startswith("남성"), (w and w["label"], m and m["label"]))
_, ks, _, st = taxonomy.build(fake(["[남성] 제모 10회"] * 3))
ok("'부위 미표기' 제모는 비교 묶음을 만들지 않음", not ks and st["label_rejected"] and st["label_rejected"][0]["why"] == ["부위 미표기"], st["label_rejected"])
ok("'!' 든 홍보 문구 이름은 막음", "기호" in labels.problems("초음파 리프팅 안에서 올려주고! 밖에서 당겨주는 더블업 리프팅"))

# 검증 4차(합치기·이용권 관점)
ok("'10+1회'는 11회, '12+1회'는 13회(1회 묶음에 들어가지 않음)", xkeys.sessions("[남성] 겨드랑이 제모 10+1회") == 11 and xkeys.sessions("다리전체 제모 12+1회") == 13
   and taxonomy.variant("[남성] 겨드랑이 제모 10+1회", cat="제모")[0]["sess"] == 11, xkeys.sessions("[남성] 겨드랑이 제모 10+1회"))
ok("'1+1'은 부위 나열이 아니라 묶음(1회 제모 묶음에 안 들어감)", taxonomy.variant("[남성] 겨드랑이 제모 1+1", cat="제모")[0]["fam"] == "package")
a, _ = taxonomy.variant("젠틀맥스 프로플러스 제모 겨드랑이 5회", cat="제모")
b, _ = taxonomy.variant("남성 젠틀맥스 프로플러스 제모 다리 전체 5회", cat="제모")
ok("장비 이름은 부위가 아님: '젠틀맥스 프로플러스 제모 겨드랑이' → 겨드랑이, 다리 전체 → 다리전체", a and b and a["area"] == "겨드랑이" and b["area"] == "다리전체", (a and a["area"], b and b["area"]))
for g, o, want in [("무제한 입술필러 나에게 맞는 입술", "무제한 입술필러", False), ("점 무제한", "[10월] 얼굴 무제한", False), ("무제한 실리프팅", "풀페이스 실리프팅 무제한", False),
                   ("젠틀맥스 프로 플러스 제모 무제한 이벤트", "겨드랑이", True), ("남성 1년 무제한제모 이벤트", "남자얼굴제모", True), ("3개월 무제한 패키지", "얼굴전체", True)]:
    ok(f"이용권 판정: '{g}' › '{o}' → {'이용권' if want else '1회'}", clean.pass_group(g, o) == want)
ok("'[EVENT] [옵션] …'처럼 행사 머리표 뒤의 [옵션]도 추가 옵션", bool(clean.OPTION_LABEL.match("[EVENT] [옵션] 이온토 미백관리 5회")) and not clean.OPTION_LABEL.match("[EVENT] 인모드 FX"))

# E4·E10: build2/clean.py on a made-up raw file (a temporary folder, the real data2/ is not touched)
import csv, tempfile  # noqa: E402
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
    ("제모", "제모 옵션", "[옵션] 제모 후 진정관리 10회", 200000, 0),                      # '[옵션]' → an add-on (addon=1)
    ("가다실", "평일한정이벤트", "가다실 9가 1회", 175000, 343100),
    ("건강", "10월 가을 맞이 혜택", "가다실 9가 1회", 175000, 205800),                      # two event pages → the smaller 정가
    ("필러", "[브랜드 10주년] 무한 페스타", "국산필러 1cc", 55000, 0),
    ("필러/실리프팅", "필러", "국산필러 1cc", 55000, 110000),                             # price list wins, but 보톡스·필러 stays (not 리프팅)
    ("제모", "젠틀맥스 여성 1년 이용권", "젠틀맥스 얼굴전체 1년이용권", 690000, 1200000),
    ("제모", "젠틀맥스 여성 제모", "얼굴전체", 690000, 1200000),                           # the pass listed again without the pass words
    ("제모", "여성 1년 무제한제모 이벤트", "브라질리언", 490000, 800000),
    ("제모", "1회 체험가", "브라질리언", 490000, 800000),                                # a pass and a per-session row never fold
    ("남성 바디 제모", "남성 바디 제모", "[겨드랑이] 5회", 100000, 0),
    ("남성 바디 제모", "남성 바디 제모", "[종아리] 5회", 100000, 0),                         # area only in the label, same price
    ("여성제모", "", "이마(헤어+삼자) 제모 1회", 50000, 0),
    ("남성제모", "", "이마(헤어+삼자) 제모1회", 50000, 0),                                    # sex only in the page name
    ("여성제모", "", "인중 1회", 9000, 0),
    ("남성제모", "", "인중 1회", 25000, 0),                                                   # 쁨 서울대입구: no '제모' in the option, an area only
    ("남성제모", "", "女) 겨드랑이 1회", 30000, 0),                                           # the option's own sex wins over the page's
    ("▼ 부가세 포함 10만원 19.6만 ▼", "10월 특가", "▼ 부가세 포함 10만원 19.6만 ▼ 1. 라라토닝 : 라라필+피코슈어토닝", 100000, 0)]   # heading glued in front
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
one = lambda opt: [r for r in out if r["option"] == opt]
dens = [r for r in out if r["option"] == "덴서티 리프팅 600샷 체험가"]
ok("E4 같은 상품·판매가, 정가만 다른 두 페이지 → 한 줄(카테고리 페이지의 정가)", len(dens) == 1 and dens[0]["orig"] == "3000000" and dens[0]["src_cat"] == "리프팅",
   [(r["src_cat"], r["orig"]) for r in dens])
ok("E10 띄어쓰기만 다른 같은 상품 → 한 줄", cnt(lambda r: r["option"].replace(" ", "") == "플라센타관리1회") == 1)
ok("E4 성별이 다르면 이름·가격이 같아도 두 줄", cnt(lambda r: r["option"] == "미간or코 제모 1회") == 2, [r["mname"] for r in out if r["option"] == "미간or코 제모 1회"])
ok("E4 여러 상품 페이지의 같은 추가 옵션 → 한 줄(예전 규칙 유지)", cnt(lambda r: r["option"].startswith("옵션5)")) == 1)
ok("E4 판매가가 다르면 두 줄", cnt(lambda r: r["option"] == "덴서티 리프팅 300샷") == 2)
ok("E4 새로 합친 줄은 issues.csv에 '합침'으로 남음(예전 규칙으로도 합쳐지던 줄은 기록 안 함)", sorted(i["reason"] for i in iss if i["action"] == "합침") ==
   ["같은 상품·판매가가 두 페이지에(정가 다름)"] * 5 + ["띄어쓰기·대소문자만 다른 같은 상품"], [(i["action"], i["reason"]) for i in iss])
g = one("가다실 9가 1회")
ok("두 행사 페이지의 정가가 다르면 작은 쪽", len(g) == 1 and g[0]["orig"] == "205800", [r["orig"] for r in g])
f_ = one("국산필러 1cc")
ok("가격표 페이지가 이겨도 분류는 첫 줄 것('필러/실리프팅' 페이지를 리프팅으로 안 읽음)", len(f_) == 1 and f_[0]["cat"] == "보톡스·필러" and f_[0]["orig"] == "110000", [(r["cat"], r["orig"]) for r in f_])
tw = one("얼굴전체")
ok("이용권과 판매가·정가가 같은 쌍둥이 줄은 이용권으로 봄", len(tw) == 1 and tw[0]["kind"] == "구독권" and any(i["action"] == "이용권으로 봄" for i in iss), [r["kind"] for r in tw])
ok("이용권 줄과 1회 줄은 가격이 같아도 합치지 않음", len(one("브라질리언")) == 2 and sorted(r["kind"] for r in one("브라질리언")) == ["구독권", "일반"], [r["kind"] for r in one("브라질리언")])
ax, cf = one("[겨드랑이] 5회"), one("[종아리] 5회")
ok("제모 페이지의 부위 대괄호('[겨드랑이] 5회')는 이름에 남고, 같은 값의 다른 부위와 합치지 않음", len(ax) == 1 and len(cf) == 1 and "[겨드랑이]" in ax[0]["name"]
   and taxonomy._area(ax[0]["name"]) == "겨드랑이", [(r["name"], r["option"]) for r in ax + cf])
im = [r for r in out if r["option"].replace(" ", "") == "이마(헤어+삼자)제모1회"]
ok("성별이 페이지 이름에만 있는 제모 줄(쁨 '여성제모'/'남성제모')은 합치지 않고 이름(mname)에 성별", len(im) == 2 and
   sorted(r["mname"][:4] for r in im) == ["[남성]", "[여성]"], [r["mname"] for r in im])
lt = [r for r in out if "라라토닝" in r["option"]]
ok("칸 제목('▼ 부가세 포함 … ▼')이 앞에 붙은 상품은 안내 문구가 아니라 상품, 부가세는 칸 제목대로 '포함'",
   len(lt) == 1 and lt[0]["option"].startswith("1. 라라토닝") and lt[0]["vat"] == "포함", [(r["option"], r["vat"]) for r in lt])
iz = one("인중 1회")
ok("'제모' 글자 없이 부위만 있는 제모 페이지 줄(쁨 서울대입구 '인중 1회')도 이름에 페이지 성별", len(iz) == 2 and
   sorted(r["mname"][:4] for r in iz) == ["[남성]", "[여성]"], [r["mname"] for r in iz])
fx = one("女) 겨드랑이 1회")
ok("옵션에 성별('女)')이 있으면 페이지 성별을 덧붙이지 않음", len(fx) == 1 and "[남성]" not in fx[0]["mname"], [r["mname"] for r in fx])
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

# 검증 5차(묶음 키·제모·이름·설명·변동 목록)
H = lambda n, d=None: taxonomy.variant(n, cat="제모", display=d)[0]
a, b = H("(남자) 손등/손가락 제모(아포지 플러스) 1회"), H("(남자) 손등 + 손가락 제모(아포지 플러스) 1회")
ok("제모 '/'(택1)와 '+'(두 부위 다)는 다른 상품", a and b and a["sig"] != b["sig"] and a["area"] == "손가락/손등" and b["area"] == "손가락+손등", (a and a["area"], b and b["area"]))
for n, d, want in [("레이저 제모 겨드랑이 5회", None, "겨드랑이"), ("여성제모 : 인중+겨드랑이", None, "겨드랑이+인중"), ("레이저 제모 인중+입가+앞턱 5회", None, "앞턱+인중+입가"),
                   ("레이저제모 남성)인중+앞턱 제모 1회", None, "앞턱+인중"), ("여성 얼굴 제모 · 1회", "여성 얼굴 제모 · 1회", "얼굴"), ("남성제모 (겨드랑이) 1회", None, "겨드랑이"),
                   ("(여자) 팔전체 제모 + 손등 + 손가락 제모(아포지 플러스) 5회", None, "손가락+손등+팔전체"),
                   ("손등+손가락 or 발등+발가락 제모 5회", None, "발가락+발등/손가락+손등"), ("[남성] 男) 인중 + 앞턱 1회", None, "앞턱+인중")]:
    v = H(n, d)
    ok(f"제모 부위 읽기: '{n}' → '{want}'", v and v["area"] == want, v and v["area"])
for n in ["[남성] 얼굴전체 제모 + 빙하팩 5회", "[EVENT] 겨드랑이제모+겨드랑이 미백레이저 [각5회]", "네오빔 + 스케일링 1회"]:
    v = H(n)
    ok(f"제모 페이지라도 '+' 뒤가 부위가 아니면 묶음: '{n}'", v and v["fam"] == "package", v and (v["fam"], v["label"]))
a, b, c = H("[여성] 女) 종아리 + 무릎 1회"), H("[여성] \uf981) 종아리 + 무릎 1회"), H("[여성] 종아리 + 무릎 제모 1회")
ok("'女)'·'男)'은 성별 표시(부위 아님, U+F981 포함)", a and b and c and a["sig"] == b["sig"] == c["sig"] and "女" not in a["label"], (a and a["label"], b and b["label"]))
d1, d2 = H("남성 얼굴 제모(젠틀맥스프로+) 男) 아래턱 5회", "남성 얼굴 제모(젠틀맥스프로+) · 男) 아래턱 5회"), H("남성 얼굴 제모(젠틀맥스 프로 플러스) 男) 아래턱 5회", "남성 얼굴 제모(젠틀맥스 프로 플러스) · 男) 아래턱 5회")
ok("장비 이름만 든 괄호 '(젠틀맥스프로+)'는 묶음이 아님 — '(젠틀맥스 프로 플러스)'와 같은 제모 규격", d1 and d2 and d1["fam"] == "hair" and d1["sig"] == d2["sig"], (d1 and d1["sig"], d2 and d2["sig"]))
ok("회차: 괄호·'*' 메모가 아니라 옵션의 회차('5회 (*10회 53만원)' → 5), 메모에만 있으면 메모('(10회)', '*5회')",
   xkeys.sessions("[젠틀맥스] 남성 인중 + 앞턱 제모 5회 (*10회 53만원)") == 5 and xkeys.sessions("[여성] 배꼽주변 제모 (10회)") == 10
   and xkeys.sessions("남성)브라질리언제모+항문 *5회") == 5)
ok("괄호 안 괄호의 '추가시'는 기본가를 추가 옵션으로 만들지 않음", not xkeys.addon_only("울쎄라 100샷 (부위 추가시 (최대 2부위) 가능)") and xkeys.addon_only("울쎄라 100샷 추가시"))
ok("'라인 모드'(브이로)는 인모드가 아님", (taxonomy.family_of("브이로 어드밴스 리프팅(고강도 집속 초음파) 라인 모드 100샷")[0] or {}).get("id") != "inmode"
   and taxonomy.family_of("인모드 FX 얼굴전체")[0]["id"] == "inmode")
ok("'E)' 목록 표시는 상품이 아님('체험가E) 크라이오' = '크라이오')", taxonomy.variant("체험가E) 크라이오")[0]["sig"] == taxonomy.variant("크라이오")[0]["sig"])
ok("판촉 문구는 병원 설명이 아님(인기 패키지·눈앞개봉·크기)", all(labels.desc_problems(t) for t in ["인기 패키지", "포텐자팁 눈앞개봉", "명함 크기"]))
ok("시술군 이름에 홀로 남은 '이내'·'당'은 뺌", taxonomy.fam_tidy("리팟레이저 이내") == "리팟레이저" and taxonomy.fam_tidy("편평사마귀 제거 당") == "편평사마귀 제거"
   and taxonomy.fam_tidy("리팟 레이저 - 이하") == "리팟 레이저")


def fake_g(items):
    """rows (brand, branch, name, group): name as clean.py writes it ('title · option'), mname without the ' · '"""
    return [dict(brand=b, branch=br, name=n, mname=n.replace(" · ", " "), group=g, addon="0", kind="일반", cat="기타", keys="") for b, br, n, g in items]


rk, ks, fs, st = taxonomy.build(fake_g([("밴스", f"{i}점", "THE 미희주사 꺼진 눈밑 시술 · 팔자 1회", "THE 미희주사 꺼진 눈밑 시술") for i in range(3)]
                                        + [("밴스", f"{i}점", "미희주사 팔자 1회", "") for i in range(3, 7)]))
ok("되살린 이름이 같은 상품의 기존 규격과 같으면 한 묶음('(표기 1)/(표기 2)' 없음)", len(ks) == 1 and ks[0]["label"] == "미희주사 팔자" and len(set(rk)) == 1 and ks[0]["n"] == 7,
   [(k["label"], k["n"]) for k in ks])
rk, ks, fs, st = taxonomy.build(fake_g([("밴스", f"{i}점", "퀵제로팻 · 얼굴 1부위", "퀵제로팻") for i in range(3)]))
ok("되살린 이름의 시술군 찾기 규칙은 상품 낱말('얼굴'만으로 지점의 얼굴 시술 전부를 잡지 않음)",
   [(f["name"], f["rx"]) for f in fs if f["keys"]] == [("퀵제로팻 얼굴", "퀵제로팻")], [(f["name"], f["rx"]) for f in fs])
rk, ks, fs, st = taxonomy.build(fake_g([("블리비", f"{i}점", "트리플 바디 1회", "") for i in range(3)]
                                        + [("블리비", f"{i}점", "트리플 바디(셀룰라이트 파괴 및 지방배출) 1회", "") for i in range(3, 6)]))
ok("설명이 없는 쪽 하나는 '(표기 n)' 없이 그대로", sorted(k["label"] for k in ks) == ["트리플 바디", "트리플 바디 (셀룰라이트 파괴 및 지방배출)"], [k["label"] for k in ks])
rk, ks, fs, st = taxonomy.build(fake_g([("블리비", f"{i}점", "울트라V 리프팅 (PDO 녹는 실) 10줄", "") for i in range(3)]
                                        + [("블리비", f"{i}점", "울트라V 리프팅 (PDO 녹는실) 10줄", "") for i in range(3, 5)]
                                        + [("블리비", "9점", "울트라V 리프팅 (끝부분 미니 라인) 10줄", "")] * 3))
dsc = [f["desc"] for f in fs if f["keys"]]
ok("병원 설명은 띄어쓰기만 다르면 하나로 세고, 한 지점에서만 나온 문구는 뺌", dsc and dsc[0] == ["PDO 녹는 실"], dsc)

rk, ks, fs, st = taxonomy.build(fake_g([("블리비", f"{i}점", "울쎄라피 프라임 리프팅(고강도 집속 초음파) 300샷 + 얼굴전체 스킨보톡스", "") for i in range(4)]
                                        + [("블리비", f"{i}점", "리쥬란힐러(PN 프리미엄 스킨부스터) 2cc + 포텐자 1회", "") for i in range(4)]))
pk = {f["name"]: f["desc"] for f in fs}
ok("묶음 시술군 설명은 자기 상품 낱말 바로 뒤 괄호만(보톡스 포함 패키지에 울쎄라 설명 안 붙음, 리쥬란 포함 패키지는 붙음)",
   not any("집속" in d for n, ds in pk.items() if "울쎄라" not in n for d in ds) and any("PN" in d for ds in pk.values() for d in ds), pk)

# E6 부가세: 행의 표기(옵션·묶음 제목·페이지 칸 제목) → 브랜드 기본값, 확인 못 한 지점은 '미확인' (2026-10-15)
vd = {"닥터에버스": ("excl", {"청담점"})}
row = lambda **k: dict({"brand": "닥터에버스", "branch": "미사점", "category": ""}, **k)
ok("부가세: 칸 제목의 '부가세 포함'이 브랜드 기본값(별도)보다 먼저", clean.vat_of(row(category="부가세 포함 만원(1회 한정) 1.96만"), "10월 2차", "국산 사각턱보톡스 50유닛", vd) == "포함")
ok("부가세: 표기 없으면 브랜드 기본값", clean.vat_of(row(), "", "리쥬란 2cc", vd) == "별도")
ok("부가세: 확인 못 한 지점은 미확인('')", clean.vat_of(row(branch="청담점"), "", "리쥬란 2cc", vd) == "")
ok("부가세: 행 표기는 확인 못 한 지점에서도 그대로", clean.vat_of(row(branch="청담점"), "", "리쥬란 2cc (VAT 별도)", vd) == "별도")

# E5 추가 옵션 (xkeys.addon_only → clean.csv addon → data.json addon): 790 newly marked rows were judged one by one (2026-10-15)
for n in ["레이저토닝 · 옵션8) 에어녹스(비수면 통증제어 마취 시스템) 추가", "(목필러 옵션) 슈링크 유니버스 100샷 추가", "미희주사 1cc 추가당",
          "염증주사 압출 (15개까지) (단독사용불가)", "(뉴비쥬 진행고객님 한정) 슈링크 300샷 당,", "스킨부스터 옵션 (옵션) 엠보케어 1회",
          "압출 1개 (*단독 불가 / 추가상품)", "관리 추가 (크라이오 or 비타민)", "추가) 더마샤인 팁", "무릎추가 5회"]:
    ok(f"추가 옵션: '{n}'", xkeys.addon_only(n))
for n in ["[국산] 헤어라인 다한증 보톡스 (면적에 따라 비용추가)", "남성 얼굴 제모 男) 얼굴전체 1회 (클라리티 기기로 변경 시 3만원 추가)",
          "신데렐라주사 1회 + 비타민C 앰플 추가", "올리지오 300샷+추가 30샷", "울쎄라 추가 20% 울쎄라 600샷",
          "패키지 진행시 회당 비용 -크롬레이저 (화이트닝2가지)1회 (적립금 적용가능)", "온다리프팅 6만줄 (# 3회 패키지 진행시 10% 추가할인)",
          "포텐자 (모공팁) + 크라이오 + 시트팩 3회 (※팁 포함 ※ 옵션) 리쥬란S1CC (흉터전용) 추가 시 1회 +140,000원)",
          "주름보톡스 국산 1부위 (1회 체험가 / 처음 이용고객 대상)", "ㄴ필링 1회 (부스터필/블랙필/밀크필 택1)",
          "보톡스 눈밑쫀쫀주사 or 눈밑촉촉주사 동시 시술 1회", "시그니처 내맘대로 관리 패키지 10회 옵션1) 1회 차감 : 아쿠아필",
          "내 마음대로 피부관리 프로그램 중 택 1 - 10회 ※압출단독불가", "리쥬란 HB 1cc (※옵션)LDM(6분) +30,000)"]:
    ok(f"추가 옵션 아님(메모가 붙은 시술 가격): '{n}'", not xkeys.addon_only(n))

hv = lambda raw, d=None: taxonomy.variant(raw, cat="제모", display=d)[0]
ok("라벨 안의 ' · '는 이름을 자르지 않음('[남성 EVENT · 주말제외] 인중' → 부위 인중)", hv("[남성 EVENT · 주말제외] 인중 제모 5회")["area"] == "인중")
ok("바깥 부위가 더 넓으면 괄호는 메모('팔하완(손등+손가락)' → 팔하완, '다리전체(발등+발가락)' → 다리전체)",
   [hv(x)["area"] for x in ("[EVENT] [여성] 팔하완(손등+손가락) 5회", "[남성] 다리전체(발등+발가락) 5회")] == ["팔하완", "다리전체"])
ok("'포함'·'제외' 괄호는 부위 나열이 아님('팔전체 (손등+손가락 포함)' → 팔전체, 묶음 아님)",
   [hv(x)["area"] for x in ("팔전체 (손등+손가락 포함) 1회", "팔전체 1회 (손등+손가락 제외)")] == ["팔전체", "팔전체"])
ok("괄호가 바깥 부위를 풀어 쓰면 그 부위들('손 (손등 + 손가락)', '겨드랑이 (겨드랑이 + 인중)')",
   [hv(x)["area"] for x in ("[여성]손 5회 (손등 + 손가락)", "겨드랑이 (겨드랑이 + 인중) 1회")] == ["손가락+손등", "겨드랑이+인중"])
ok("병원 표기 '구렛'·'윗못'도 부위('(턱+볼+구렛+인중+이중턱)'이 묶음이 아님)", hv("남자하관전체제모 (턱+볼+구렛+인중+이중턱) 1회")["sig"].startswith("hair|하관전체")
   and hv("남성 윗못or뒷목 제모 1회")["sig"].startswith("hair|"))
ok("대문자 'OR'도 택1('앞목 OR 뒷목' = '뒷목·앞목')", hv("[여성] 앞목 OR 뒷목 제모 1회")["sig"] == hv("[여성] 뒷목/앞목 제모 1회")["sig"])
ok("부위 철자 하나로(구렛나루=구레나룻, 배렛나루=배레나룻, 상완=팔상완)", hv("남성 구렛나루 제모 5회")["sig"] == hv("남성 구레나룻 제모 5회")["sig"]
   and hv("남성 배렛나루 제모")["sig"] == hv("남성 배레나룻 제모")["sig"] and hv("여성 상완 제모 1회")["sig"] == hv("여성 팔상완 제모 1회")["sig"])
ok("'(여자) 3자 제모'는 성별·장비가 있는 제모 키", hv("(여자) 3자 제모(아포지 플러스) 1회")["label"] == "여성 3자 제모 아포지 플러스")
ok("'브라질리언 (항문 포함)'은 브라질리언+항문, '(항문 미포함)'은 브라질리언", hv("[여성] 브라질리언 (항문 포함) 1회")["sig"] == hv("여성 브라질리언 + 항문 제모 1회")["sig"]
   and hv("[여성] 브라질리언(항문 미포함) 1회")["area"] == "브라질리언")
ok("이름 붙은 부위 묶음은 괄호가 부위('수염라인(인중+앞턱)' → 앞턱+인중, '손 전체 (손가락 + 손등)' → 손가락+손등)",
   hv("남성 수염라인(인중+앞턱) 제모 1회")["area"] == "앞턱+인중" and hv("[남성] 손 전체 (손가락 + 손등) 1회")["area"] == "손가락+손등")
ok("'택1 5회'의 택1은 부위가 아님('배/가슴 택1 5회' → 가슴·배)", hv("바디제모(여성) 여성 배/가슴 택1 5회", "바디제모(여성) · 여성 배/가슴 택1 5회")["area"] == "가슴/배")
ok("'택1회'의 1회는 횟수('인중/앞턱 택1회' → 부위 앞턱·인중)", hv("인중/앞턱 택1회 제모")["area"] == "앞턱/인중", hv("인중/앞턱 택1회 제모")["area"])
ok("목록에 없던 부위 낱말(힙·음경·유룬)도 제모 부위", hv("(남자) 힙 제모 1회")["label"] == "남성 힙 제모" and hv("남성 유룬 제모 1회")["area"] == "유륜")
ok("제모 밖에서도 'or'는 '/'와 같은 규격('미희주사 옆볼or앞볼' = '옆볼/앞볼')",
   taxonomy.variant("미희주사 옆볼or앞볼 1cc", cat="윤곽·필러")[0]["sig"] == taxonomy.variant("미희주사 옆볼/앞볼 1cc", cat="윤곽·필러")[0]["sig"])
ok("묶음 이름처럼 쓰는 부위('젠틀맥스 U라인 (…)')는 지점마다 다른 괄호 목록으로 쪼개지 않음",
   hv("(남자) 젠틀맨 U라인 제모(턱 + 볼 + 턱라인 + 인중 + 윗목) 1회")["sig"] == hv("(남자) 젠틀맨 U라인 제모(인중 + 턱라인 + 이중턱 + 턱끝 + 양볼 + 구렛나루) 1회")["sig"])
ok("'(진정관리+팩포함)'은 부위 메모가 아니라 묶음", hv("겨드랑이 제모 (진정관리+팩포함) 1회")["fam"] == "package")
pt = [taxonomy.variant(x, cat="여드름")[0] for x in ("에토좀PTT(압출+염증주사 포함/필요 시 여드름약 처방 포함) 1회", "에토좀PTT 1회")]
ok("제모 밖에서 괄호 속 '+'(띄어 쓰지 않음)는 묶음이 아님 — 에토좀 PTT 한 규격", pt[0] and pt[1] and pt[0]["sig"] == pt[1]["sig"], [v and v["sig"] for v in pt])
ok("... ' + '로 띄어 쓴 괄호는 예전처럼 묶음", taxonomy.variant("환절기 스킨 리커버리(A + B)", cat="피부")[0]["fam"] == "package")
dup = fake_g([("닥터에버스", f"{i}점", "레이저 제모 겨드랑이 5회", "월간 레이저") for i in range(3)]
             + [("닥터에버스", f"{i}점", "레이저 제모 겨드랑이 5회", "월간 레이저") for i in range(3)]
             + [("닥터에버스", f"{i}점", "레이저 제모 인중 5회", "월간 레이저") for i in range(3)])
for i, r in enumerate(dup):
    r.update(cat="제모", sale=str(13000 if i < 3 else 65000 if i < 6 else 9000), url="https://example.invalid/month")
rk, ks, fs, st = taxonomy.build(dup)
ok("한 페이지에 같은 이름·다른 가격(성별 제목을 못 읽음)인 제모 줄은 성별 없는 부위 키에 넣지 않음", rk[:6] == [""] * 6 and all(rk[6:9]), rk)
tw = fake_g([("톡스앤필", f"{i}점", n, "얼굴제모") for i in range(3) for n in ("얼굴전체 (이마제외) 5회", "얼굴전체 5회")])
for j, r in enumerate(tw):
    r.update(cat="제모", sale=str(300000 if j % 2 == 0 else 450000), url="https://example.invalid/face")
rk, ks, fs, st = taxonomy.build(tw)
ok("괄호만 다른 두 상품('얼굴전체 (이마제외)' / '얼굴전체')은 같은 이름 두 가격이 아님 — 키를 잃지 않음", all(rk), rk)
# 검증 8차 (제모)
ok("소문자 'u라인'도 묶음 이름(괄호 목록으로 쪼개지 않음)", hv("[EVENT] [남자제모] u라인 5회 (인중+입술밑+앞턱+턱라인+구렛나루)")["sig"] == hv("남자 U라인 제모 5회")["sig"])
ok("브라질리언 괄호의 다른 부위도 함께('(회음부, 항문 포함)' → 브라질리언+항문+회음부, '(항문,사타구니포함)' → +사타구니)",
   hv("여성 브라질리언 (회음부, 항문 포함) 제모 5회")["area"] == "브라질리언+항문+회음부"
   and hv("브라질리언 제모(항문,사타구니포함)")["area"] == "브라질리언+사타구니+항문")
ok("괄호 없는 '브라질리언 항문포함'·닫는 괄호 없는 '(항문포함 1회'도 브라질리언+항문",
   hv("브라질리언 항문포함 1회 (1회체험가)")["area"] == hv("브라질리언(항문포함 1회")["area"] == "브라질리언+항문")
ok("얼굴 제모의 괄호가 고를 부위('(인중/미간/3자 이마 택1)')나 한 부위('(이마전체)')면 그 부위 — 얼굴 전체 아님, '(목 포함/이마제외)'는 얼굴",
   hv("얼굴제모 5회 (인중/미간/3자 이마 택1)")["area"] == "3자이마/미간/인중" and hv("얼굴제모 5회 (이마전체)")["area"] == "이마"
   and hv("얼굴제모 5회 (목 포함/이마제외)")["area"] == "얼굴")
dv = fake_g([("셀린", f"{i}점", "여성 인중 + 겨드랑이 제모 5회", "제모") for i in range(3) for _ in range(2)])
for j, r in enumerate(dv):
    r.update(cat="제모", sale=str(150000 if j % 2 == 0 else 55000), url=f"https://example.invalid/{j % 2}",
             option=("[젠틀맥스] " if j % 2 == 0 else "[아포지] ") + r["name"])
rk, ks, fs, st = taxonomy.build(dv)
ok("이름에 기기가 없으면 묶음 제목·'[젠틀맥스]' 머리표의 기기 하나를 받음 — 한 지점 두 기기가 한 키에 섞이지 않음",
   len(set(rk)) == 2 and all(rk) and sorted(k["label"] for k in ks) == ["여성 겨드랑이+인중 제모 아포지 플러스 5회", "여성 겨드랑이+인중 제모 젠틀맥스 프로 플러스 5회"],
   [k["label"] for k in ks])
ok("'인중 택1'의 '중'은 지우지 않음('겨드랑이/인중 택1회' → 겨드랑이·인중, '인' 아님)",
   hv("겨드랑이/인중 택1회 제모")["area"] == "겨드랑이/인중" and hv("겨드랑이 제모 중 택1 5회")["area"] == "겨드랑이")
_mv = taxonomy.variant("미희주사 이마 or 관자 3회", cat="윤곽·필러")[0]
ok("'or'를 '/'로 바꾼 시술군도 rx는 원래 이름('… 이마 or 관자')에 맞음(같은 시술군 더 보기)",
   bool(re.search(_mv["rx"], taxonomy.comp("미희주사 이마 or 관자 3회"))) and bool(re.search(_mv["rx"], taxonomy.comp("미희주사 이마/관자 1회"))), _mv["rx"])
ok("'1부위당 독일산'에서 홀로 남은 '당'은 단위 뒤로('주름보톡스 독일산/영국산 1부위당')",
   taxonomy.word_order("주름보톡스 당 독일산/영국산 1부위") == "주름보톡스 독일산/영국산 1부위당")
rp = fake_g([("밴스", f"{i}점", "리팟 5mm 이내 1개", "") for i in range(3)])
for r in rp:
    r.update(cat="피부·레이저", sale="30000")
rk, ks, fs, st = taxonomy.build(rp)
ok("'이내'를 뗀 시술군 이름의 rx도 자기 상품 이름에 맞음(같은 시술군 더 보기)",
   bool(fs) and all(re.search(f["rx"], taxonomy.comp("리팟 5mm 이내 1개")) for f in fs), [(f["name"], f["rx"]) for f in fs])
ok("'(클라리티 기기로 변경 시 3만원 추가)'의 기기는 이 가격의 기기가 아님(C2 검토)",
   hv("女) 브라질리언 (항문 제외) 1회 (클라리티 기기로 변경 시 3만원 추가)")["sig"] == hv("女) 브라질리언 (항문 제외) 1회")["sig"]
   and "클라리티" not in hv("女) 브라질리언 (항문 제외) 1회 (클라리티 기기로 변경 시 3만원 추가)")["label"])
ok("... 괄호의 다른 조각(무엇이 들어 있는지)은 남김 — '(피코슈어토닝 + 크라이오관리 + 모델링팩 * LDM관리로 변경 시 2만원 추가)'",
   taxonomy.strip_upgrade("피코슈어 토닝 1회 (피코슈어토닝 + 크라이오관리 + 모델링팩 * LDM관리로 변경 시 2만원 추가)") == "피코슈어 토닝 1회 (피코슈어토닝 + 크라이오관리 + 모델링팩)"
   and taxonomy.strip_upgrade("피코슈어토닝 1회 (*피코 슈어 토닝 5회로 변경시 +39만원)").strip() == "피코슈어토닝 1회"
   and taxonomy.strip_upgrade("여성 겨드랑이 제모 (아포지) 5회") == "여성 겨드랑이 제모 (아포지) 5회")
ok("'젠맥'은 젠틀맥스", hv("[젠맥 여성] 겨드랑이 5회")["label"] == hv("젠틀맥스 여성 겨드랑이 제모 5회")["label"])

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
old_d = mini([("강남점", "남성 1년 무제한제모 · 가슴 전체", 490000, "구독권"), ("강남점", "라페라 리프팅 · 풀페이스 2000샷", 159000, "일반"),
              ("강남점", "(여자) 레이저 제모 · 옵션)에어녹스 추가", 70000, "일반"), ("강남점", "보톡스 · 옵션)에어녹스 추가", 70000, "일반")])
new_d = mini([("강남점", "남성 1년 무제한제모 · 가슴 전체", 490000, "구독권"), ("강남점", "여성 1년 무제한제모 · 가슴 전체", 490000, "구독권"),
              ("강남점", "라페라리프팅 풀페이스 2000샷", 159000, "일반"), ("강남점", "보톡스 · 옵션)에어녹스 추가", 70000, "일반")])
c = datameta.changes(old_d, new_d, "v")
ok("가격 변동 목록: 합치기가 풀리거나(성별) 묶음 제목·' · '만 바뀐 줄은 새로 생김/없어짐이 아님", not c["added"] and not c["removed"], c["counts"])


def dated(d, day):
    d = json.loads(json.dumps(d))
    d["s"].append(day)
    for b in d["branches"]:
        b += [0, 0, 0, 0, 0, len(d["s"]) - 1]
    return d


old_d = mini([("강남점", "리쥬란 2cc", 200000, "일반")])
new_d = mini([("강남점", "쥬베룩 2cc", 250000, "일반")])
same_day = datameta.changes(dated(old_d, "2026-10-14"), dated(new_d, "2026-10-14"), "v")["counts"]
next_day = datameta.changes(dated(old_d, "2026-10-14"), dated(new_d, "2026-10-21"), "v")["counts"]
ok("가격 변동 목록: 수집일이 같은 지점(규칙만 바꿔 다시 만든 빌드)은 변동 없음, 새로 모은 지점만", same_day == {"price": 0, "added": 0, "removed": 0, "new_chain": 0}
   and next_day == {"price": 0, "added": 1, "removed": 1, "new_chain": 0}, (same_day, next_day))
two = mini([("강남점", "리쥬란 2cc", 200000, "일반")])
two["meta"]["brands"] = [["A"], ["B"]]
two["s"] += ["역삼점", "쥬베룩 2cc"]
two["branches"].append([1, len(two["s"]) - 2])
for f, v in zip(two["cols"], [1, 0, len(two["s"]) - 1, 250000, 0, two["s"].index("일반")]):
    f.append(v)
nc = datameta.changes(old_d, two, "v")
ok("E9 가격 변동 목록: 처음 모은 체인(B)의 줄은 '새로 생김'이 아니라 new_chains로만 셈", nc["counts"]["new_chain"] == 1 and nc["new_chains"] == [["B", 1]]
   and all(r[0] != "B" for r in nc["added"]), nc)
import appdata as _ad, tempfile as _tf, gzip as _gz  # noqa: E402
with _tf.TemporaryDirectory() as h:
    json.dump({"X12|블리비|강남점": 1}, open(os.path.join(h, "2026-10-13.json"), "w"))
    json.dump({}, open(os.path.join(h, "2026-10-14.json"), "w"))
    with _gz.open(os.path.join(h, "2026-10-14.auto.json.gz"), "wt", encoding="utf-8") as f:
        json.dump({"g": ["라벨", {"밴스|천호": 1, "블리비|강남점": 1}]}, f)
    bf = _ad.brand_first(h, "2026-10-14")
ok("E9 체인을 처음 모은 날: 기록에서 그 체인이 처음 나온 날", bf == {"블리비": "2026-10-13", "밴스": "2026-10-14"}, bf)
dd = {"블리비": {"2026-10-13", "2026-10-14"}, "밴스": {"2026-10-14"}, "포에버": {"2026-10-06"}}
fs = _ad.first_seen(dd, ["블리비", "밴스", "셀린", "포에버", "리엔장"], {"블리비", "밴스", "셀린"}, "2026-10-21")
ok("E9 meta.brandFirst: 기록 없이 이번에 처음 모은 체인은 이번 날짜, 한 번도 안 모은 체인은 빠짐(C3 검토)",
   fs == {"블리비": "2026-10-13", "밴스": "2026-10-14", "셀린": "2026-10-21", "포에버": "2026-10-06"}, fs)
ok("E9 지난 기록에 없던 체인(새로 왔거나 쉬다 돌아옴)의 줄은 '새로 생김'에 하나씩 넣지 않음",
   _ad.chain_was_there(dd, "2026-10-14", "블리비") and not _ad.chain_was_there(dd, "2026-10-14", "포에버")
   and not _ad.chain_was_there(dd, "2026-10-13", "밴스") and _ad.chain_was_there(dd, "", "셀린"))
import appdata  # noqa: E402
prev = {"s": ["A", "강남점", "울쎄라 300샷", "평일 낮", "X14", ""], "branches": [[0, 1]], "meta": {"brands": [["A"]], "kinds": appdata.KINDS},
        "keys": [["X14", 0, "울쎄라 300샷"]]}
prow = [[0, 0, 2, 590000, 0, 0, 3, 4]]
now = [dict(brand="A", branch="강남점", name="울쎄라 300샷", sale="590000", kind="일반", tags="", keys="X14")]
prev_km = {"s": ["A", "강남점", "울쎄라 300샷", "", "T0AAAAAA", ""], "branches": [[0, 1]], "meta": {"brands": [["A"]], "kinds": appdata.KINDS},
           "keys": [["T0AAAAAA", 0, "옛 이름"]]}
rows_km = [dict(brand="A", branch="강남점", name="울쎄라 300샷", keys="TZZZZZZ TBBBBBB")]
ok("key_map: 새 id 둘이 같은 표를 받으면 작은 id (집합 순서·PYTHONHASHSEED와 무관)",
   all(appdata.key_map(prev_km, [[0, 0, 2, 590000, 0, 0, 3, 4]], rows_km, [["TZZZZZZ"], ["TBBBBBB"]])["T0AAAAAA"][0] == "TBBBBBB" for _ in range(3)))
ok("같은 줄·같은 가격인데 조건(tags)만 바뀌면 규칙 변경(recl)으로 봄 — 가짜 가격 변동 없음", appdata.reclassified(prev, prow, now) == {"X14"}
   and appdata.reclassified(prev, prow, [dict(now[0], tags="평일 낮")]) == set())
prev_t = {"s": ["A", "강남점", "울쎄라 300샷", "첫 방문", "X14", ""], "branches": [[0, 1]], "meta": {"brands": [["A"]], "kinds": appdata.KINDS},
          "keys": [["X14", 0, "울쎄라 300샷"]]}
ok("... 체험가 줄이 조건만 잃으면(일반가가 되는 게 아님) 규칙 변경으로 보지 않음",
   appdata.reclassified(prev_t, [[0, 0, 2, 590000, 0, 1, 3, 4]], [dict(now[0], kind="체험가", tags="")]) == set())
prev_2 = {"s": ["A", "건대점", "얼굴전체 더모톡신", "", "T0AAAAAA", ""], "branches": [[0, 1]], "meta": {"brands": [["A"]], "kinds": appdata.KINDS},
          "keys": [["T0AAAAAA", 0, "얼굴전체 더모톡신"]]}
two_now = [dict(brand="A", branch="건대점", name="얼굴전체 더모톡신", sale="290000", kind="일반", tags="", keys="T0AAAAAA"),
           dict(brand="A", branch="건대점", name="얼굴전체 더모톡신", sale="190000", kind="일반", tags="", keys="")]
ok("같은 이름 두 줄 중 한 줄만 키를 잃으면(추가 옵션이 됨) 규칙 변경 — 190,000 → 290,000 가짜 인상 없음(검증 8차)",
   appdata.reclassified(prev_2, [[0, 0, 2, 290000, 0, 0, 3, 4], [0, 0, 2, 190000, 0, 0, 3, 4]], two_now) == {"T0AAAAAA"}
   and appdata.reclassified(prev_2, [[0, 0, 2, 290000, 0, 0, 3, 4], [0, 0, 2, 190000, 0, 0, 3, 5]], two_now) == set())
prev_s = {"s": ["A", "강남점", "남성 목 제모 10회", "", "T0AAAAAA", "", "남성 목 제모 5회"], "branches": [[0, 1]],
          "meta": {"brands": [["A"]], "kinds": appdata.KINDS}, "keys": [["T0AAAAAA", 0, "남성 목 제모 10회"]]}
two = [[0, 0, 2, 396000, 0, 0, 3, 4], [0, 0, 6, 290000, 0, 0, 3, 4]]
km = appdata.key_map(prev_s, two, [dict(brand="A", branch="강남점", name="남성 목 제모 10회", keys=""),
                                   dict(brand="A", branch="강남점", name="남성 목 제모 5회", keys="TBBBBBB")], [["TBBBBBB", 0, "남성 목 제모 5회"]])
ok("key_map: 반만 옮겨 간 키가 횟수가 다르면 옮기지 않음('10회' → '5회' 아님, 옛 이름만 보여 줌)", km["T0AAAAAA"] == ["", "남성 목 제모 10회"], km)
km = appdata.key_map(prev_s, two[1:], [dict(brand="A", branch="강남점", name="남성 목 제모 5회", keys="TBBBBBB")], [["TBBBBBB", 0, "남성 목 제모 5회"]])
ok("... 옛 줄이 모두 옮겨 갔으면 옮김(옛 이름의 횟수가 틀렸던 것)", km["T0AAAAAA"][0] == "TBBBBBB", km)
prev_x = {"s": ["A", "강남점", "헤어라인 or 눈썹 제모", "", "T0AAAAAA", ""], "branches": [[0, 1]], "meta": {"brands": [["A"]], "kinds": appdata.KINDS},
          "keys": [["T0AAAAAA", 0, "남성 헤어라인 or 눈썹 제모"]]}
km = appdata.key_map(prev_x, [[0, 0, 2, 50000, 0, 0, 3, 4]], [dict(brand="A", branch="강남점", name="헤어라인 or 눈썹 제모", keys="TAAAAAA TBBBBBB")],
                     [["TAAAAAA", 0, "여성 눈썹·헤어라인 제모"], ["TBBBBBB", 0, "남성 눈썹·헤어라인 제모"]])
ok("key_map: 같은 표면 옛 이름의 성별 쪽으로, 다른 성별 키로는 안 옮김", km["T0AAAAAA"][0] == "TBBBBBB", km)
prev_b = {"s": ["A", "강남점", "브라질리언 5회", "", "T0AAAAAA", ""], "branches": [[0, 1]], "meta": {"brands": [["A"]], "kinds": appdata.KINDS},
          "keys": [["T0AAAAAA", 0, "여성 女 브라질리언 제모 5회"]]}
km = appdata.key_map(prev_b, [[0, 0, 2, 50000, 0, 0, 3, 4]], [dict(brand="A", branch="강남점", name="브라질리언 5회", keys="TAAAAAA TBBBBBB")],
                     [["TAAAAAA", 0, "여성 브라질리언+항문 제모 5회"], ["TBBBBBB", 0, "여성 브라질리언 제모 5회"]])
ok("key_map: 동점이면 옛 이름과 같은 말의 키로('브라질리언'은 '브라질리언+항문'이 아님, 검증 8차)", km["T0AAAAAA"][0] == "TBBBBBB", km)
prev_n = {"s": ["A", "강남점", "팔전체 제모", "", "T0AAAAAA", ""], "branches": [[0, 1]], "meta": {"brands": [["A"]], "kinds": appdata.KINDS},
          "keys": [["T0AAAAAA", 0, "팔전체 제모"]]}
km = appdata.key_map(prev_n, [[0, 0, 2, 50000, 0, 0, 3, 4]], [dict(brand="A", branch="강남점", name="팔전체 제모", keys="TAAAAAA TBBBBBB")],
                     [["TAAAAAA", 0, "남성 팔전체 제모"], ["TBBBBBB", 0, "여성 팔전체 제모"]])
km2 = appdata.key_map(prev_n, [[0, 0, 2, 50000, 0, 0, 3, 4]], [dict(brand="A", branch="강남점", name="팔전체 제모", keys="TAAAAAA TCCCCCC")],
                      [["TAAAAAA", 0, "남성 팔전체 제모"], ["TCCCCCC", 0, "팔전체 제모"]])
ok("key_map: 성별 없는 옛 이름이 여성·남성 키로 똑같이 갈리면 옮기지 않음(옛 이름만), 성별 없는 키가 있으면 그쪽으로",
   km["T0AAAAAA"] == ["", "팔전체 제모"] and km2["T0AAAAAA"][0] == "TCCCCCC", (km, km2))
prev_g = {"s": ["A", "건대점", "[울써마지 옵션] 얼굴전체 더모톡신", "", "", ""], "branches": [[0, 1]], "meta": {"brands": [["A"]], "kinds": appdata.KINDS}}
mv = appdata.group_moved(prev_g, [[0, 0, 2, 190000, 0, 0, 3, 4, 1, 5]],
                         [dict(brand="A", branch="건대점", name="[울써마지 옵션] 얼굴전체 더모톡신", sale="190000", kind="일반", tags="", addon="1")], [-1])
ok("자동 묶음: 같은 줄·같은 가격이 규칙 때문에 빠지면(추가 옵션이 됨) 그 가격은 '가격 변동'의 근거가 아님",
   mv == {("A|건대점", appdata.G.comp("[울써마지 옵션] 얼굴전체 더모톡신"), 190000)}, mv)

# 4) the data that ships: every compare label passes
D = json.load(open(os.path.join(ROOT, "app", "data.json"), encoding="utf-8"))
bad = [(k[2], labels.problems(k[2])) for k in D["keys"] if labels.problems(k[2])]
built_with = D["meta"].get("labelRules", 1)
if built_with == labels.RULES:
    ok(f"app/data.json: 비교 규격 {len(D['keys']):,}개 모두 가격·날짜·홍보 문구·기호·괄호 문제 없음", not bad, bad[:5])
else:
    # built by the factory before the rules changed (build2/labels.py RULES): the next factory run applies them
    ok(f"app/data.json은 이전 이름 규칙(판 {built_with})으로 만든 것 — 지금 규칙(판 {labels.RULES})에 걸리는 {len(bad)}개는 다음 공장 빌드에서 빠짐",
       built_with < labels.RULES, (built_with, labels.RULES))
    print(f"INFO | 다음 공장 빌드에서 빠질 규격 {len(bad)}개", bad[:5])
vp = os.path.join(ROOT, "data2", "variants.json")
if os.path.exists(vp):
    rej = json.load(open(vp, encoding="utf-8"))["stats"].get("label_rejected", [])
    print(f"INFO | 이번 빌드에서 이상한 이름이라 뺀 규격 {len(rej)}개", [r["label"] for r in rej[:5]])

print(f"{'FAIL: ' + str(len(fails)) + ' failing' if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
