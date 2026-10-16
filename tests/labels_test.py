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
# 검수 2026-10-16: 손으로 만든 키(X17)가 규격의 주인인지는 전체 줄과 일반가 줄 모두에서 절반 이상일 때만. 한 체인의 첫 방문 줄이 몰려
# 들어와 전체만 절반을 넘으면(닥터에버스 '※' 칸 9줄로 'inmode|인모드|FORMA' 25/46) 자동 키가 사라지고 X17 없는 일반가 줄이 키를 잃었음
_ow = lambda i, x, tag: dict(brand="B" if tag else "A", branch=f"{i}점", name="인모드 FORMA 1회", mname="인모드 FORMA 1회", addon="0", kind="일반",
                             tags=tag, days="0", hours="", cat="리프팅", keys=x)
_own1 = [_ow(i, "", "") for i in range(4)] + [_ow(4 + i, "X17", "") for i in range(2)] + [_ow(6 + i, "X17", "첫 방문") for i in range(4)]
_own2 = [_ow(i, "", "") for i in range(2)] + [_ow(2 + i, "X17", "") for i in range(4)] + [_ow(6 + i, "X17", "첫 방문") for i in range(4)]
rk1, ks1, _, st1 = taxonomy.build(_own1)
rk2, ks2, _, st2 = taxonomy.build(_own2)
ok("X17이 전체 6/10이어도 일반가 2/6이면 자동 키를 둠(모든 줄에), 일반가도 4/6이면 X17의 규격(자동 키 없음)",
   len(ks1) == 1 and all(rk1) and st1["owned"] == 0 and not ks2 and not any(rk2) and st2["owned"] == 1,
   ([k["label"] for k in ks1], rk1, st1["owned"], [k["label"] for k in ks2], st2["owned"]))

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
# the per-session row stands under the group title '1회 체험가': a trial price since 2026-10-16 (clean.section_kind), 일반 before
ok("이용권 줄과 1회 줄은 가격이 같아도 합치지 않음", len(one("브라질리언")) == 2 and sorted(r["kind"] for r in one("브라질리언")) == ["구독권", "체험가"], [r["kind"] for r in one("브라질리언")])
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
# audit40 A1 (2026-10-16): '*N회 한정가·체험가'는 그 가격이 N회분 — 쁨 천안 '풀페이스 리투오 1회 (6cc) *3회 한정가' 1,450,000원이 1회 묶음에 있었음
for n, want in [("스킨부스터 · 풀페이스 리투오 1회 (6cc) *3회 한정가", 3), ("풀페이스 리투오 1회 (6cc) (*3회 체험가)", 3), ("올리지오 300샷 1회 *3회 특가", 3),
                ("피코 MLA(얼굴전체)1회 *1회한정가", 1)]:
    ok(f"회차: '*N회 한정가·체험가'는 N회 — '{n}' → {want}", xkeys.sessions(n) == want, xkeys.sessions(n))
# 반대 방향: '*' 메모와 구매 제한(최대 N회 · 1인 N회 · 메모 속 N회 한정)은 회차가 아님, 괄호 안이든 밖이든 (lsy2825/skin#74 검토: 셀린 새 수집기는
# 설명을 괄호에 붙임)
for n, want in [("스킨부스터 · 풀페이스 리투오 1회 (6cc) *이마제외", 1), ("리쥬란 1cc (*최대 3회 한정)", 1),
                ("[10월](여)아이큐)얼굴전체+카프리레이저+모델링 (*아이큐 : 코,미간,헤어라인,눈썹 제외 *최대 3회 한정)", 1), ("리쥬란 1cc (*3회 한정)", 1), ("리쥬란 1cc *3회 한정", 1),
                ("리쥬란 2cc 5회 (*최대 3회 한정)", 5), ("리쥬란 1cc *최대 3회 한정가", 1), ("울트라콜4CC 1회 (* 1인 최대 5회까지만 적용가능)", 1),
                ("LDM · 내맘대로 LDM (최대10회) 120분", 1), ("슈링크 300샷 *1인 1회 한정", 1), ("레디어스 3회 (1인1회한정)", 3), ("[1인1회] 쥬베룩볼륨 1cc", 1),
                ("피코토닝 1회 *3회 체험 가능", 1), ("[10월 EVENT] 쥬베룩 아이 2cc 3회 (*3회 진행 시 눈밑스킨보톡스(영국산) 포함)", 3),
                ("베이직 내맘대로 피부패키지 10+10회 (※ 재방 고객 한정/1인 1회)", 20), ("(남자) 종아리 + 무릎 제모(아포지 플러스) 10회 한정가", 10)]:
    ok(f"회차: 메모·구매 제한은 회차가 아님 — '{n}' → {want}", xkeys.sessions(n) == want, xkeys.sessions(n))
# audit40 A3 (2026-10-16): tools/audit_data.js도 빌드처럼 'N+M회'를 N+M회로 읽음('피코토닝 10+10회' = 20, '1+1회 (1회)' = 2) — 만든 자료로
import shutil, subprocess  # noqa: E402
if shutil.which("node"):
    _js = r"""
const { audit } = require(process.argv[1] + '/tools/audit_data.js');
const s = ['', '피코토닝 10+10회', '피코토닝 1+1회 (1회 체험가)', 'K1', 'K2', '지점', '주소', 'VERIFIED', 'https://x'];
const row = (name, key, sess) => [0, 0, name, 100000, 0, 0, 0, key, sess, 0, 0, 8, 2, 0, 0, 0];
const d = { s, meta: { updated: '2026-10-16', brands: [['밴스']], fam: [] }, branches: [[0, 5, 6, 37.5, 127, 0, 0, 0, 7]], groups: [],
  keys: [['K1', '피부', '피코토닝 10+10회'], ['K2', '피부', '피코토닝 1+1회 (1회)']] };
d.rows = [row(1, 3, 20), row(2, 4, 2)];
const good = (audit(d).keyMixedSess || []).length;
d.rows = [row(1, 3, 10), row(2, 4, 1)];
console.log(JSON.stringify([good, (audit(d).keyMixedSess || []).map((x) => x.id)]));
"""
    _r = subprocess.run(["node", "-e", _js, ROOT], capture_output=True, text=True, timeout=60)
    _got = json.loads(_r.stdout) if _r.returncode == 0 and _r.stdout.strip() else None
    ok("tools/audit_data.js: 'N+M회' 묶음은 N+M회 줄과 맞음(10+10회 = 20, 1+1회 = 2), 10회·1회 줄은 다른 횟수로 잡음",
       _got == [0, ["K1", "K2"]], _got if _got is not None else _r.stderr[-300:])
    # 2026-10-16: the audit's branch labels are '<브랜드> <지점>' — meta.brands[i] is [name, color, how collected], and the
    # whole entry used to go into them ('밴스,#2f9e44,지점별 … 홍대')
    _js = r"""
const { audit } = require(process.argv[1] + '/tools/audit_data.js');
const s = ['', '시술 1회', 'K1', '홍대', '홍대점', '신촌', '주소', 'VERIFIED', 'https://x'];
const row = (b, price) => [b, 0, 1, price, 0, 0, 0, 2, 1, 0, 0, 8, 2, 0, 0, 0];
const d = { s, meta: { updated: '2026-10-16', brands: [['밴스', '#2f9e44', '지점별 시술소개 가격'], ['쁨', '#e8437f', '지점별 온라인 예약']], fam: [] },
  branches: [[0, 3, 6, 37.5, 127, 0, 0, 0, 7], [1, 4, 6, 37.5, 127, 0, 0, 0, 7], [0, 5, 6, null, null, 0, 0, 0, 7], [0, 3, 6, 37.6, 127.1, 0, 0, 0, 7]],
  groups: [], keys: [['K1', '피부', '시술 1회']] };
d.rows = [row(0, 1000), row(0, 1000), row(3, 10000), row(1, 100000)];
const o = audit(d), m = (k, f) => (o[k] || []).map(f);
console.log(JSON.stringify([m('dupBranch', (x) => x.branch), m('sameCoords', (x) => [x.a, x.b]), m('branchNoGeo', (x) => x.branch),
  m('keyWideSpread', (x) => [x.lo.branch, x.hi.branch]), m('dupRow', (x) => x.branch)]));
"""
    _r = subprocess.run(["node", "-e", _js, ROOT], capture_output=True, text=True, timeout=60)
    _got = json.loads(_r.stdout) if _r.returncode == 0 and _r.stdout.strip() else None
    ok("tools/audit_data.js: 지점 이름은 '<브랜드> <지점>'(같은 좌표·좌표 없음·가격 폭·같은 줄), 같은 지점 두 번은 '<브랜드>|<지점>'",
       _got == [["밴스|홍대"], [["밴스 홍대", "쁨 홍대점"]], ["밴스 신촌"], [["밴스 홍대", "쁨 홍대점"]], ["밴스 홍대"]],
       _got if _got is not None else _r.stderr[-300:])
else:
    print("INFO | node 없음 — tools/audit_data.js 검사('N+M회'·지점 이름) 건너뜀")
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
# 괄호 속 '+'는 띄어쓰기가 아니라 내용으로 읽음(C1 후속, 2026-10-16: ' + '만 묶음이라 블리비 '듀얼토닝(제네시스 토닝 + 레이저토닝)'은
# 블리비 전용 묶음, 붙여 쓴 '듀얼토닝(피코토닝+제네시스)'는 '듀얼토닝 1회'와 같은 '듀얼 레이저토닝' 규격이었음)
TV = lambda n, c="피부": taxonomy.variant(n, cat=c)[0]
for sp, un, fam, why in [
        ("듀얼토닝(제네시스 토닝 + 레이저토닝) 1회", "듀얼토닝(제네시스토닝+레이저토닝) 1회", "package", "토닝 두 가지"),
        ("듀얼토닝(피코토닝 + 제네시스) 1회", "듀얼토닝(피코토닝+제네시스) 1회", "package", "피코토닝 + 제네시스"),
        ("리쥬란 콤플렉스(리쥬란힐러 2cc + 물광주사 2cc)", "리쥬란 콤플렉스(리쥬란힐러 2cc+물광주사 2cc)", "package", "리쥬란 + 물광주사"),
        ("슈퍼 하이코(PDO실 2줄 + 국산 뉴라미스 1cc)", "슈퍼 하이코(PDO실 2줄+국산 뉴라미스 1cc)", "package", "실 + 필러(계열 규칙에 없는 필러 이름)"),
        ("환절기 스킨 리커버리(제네시스 레이저 + 비타민관리 + 크라이오셀) 한정가", "환절기 스킨 리커버리(제네시스 레이저+비타민관리+크라이오셀) 한정가",
         "package", "계열 없는 이름 + 시술 + 관리"),
        ("[국산] 얼굴위쪽 보톡스 (이마 + 미간 + 눈가 + 콧등)", "[국산] 얼굴위쪽 보톡스 (이마+미간+눈가+콧등)", "toxin", "부위 나열"),
        ("디클래시 동안필러 (앞볼 + 옆볼) 3cc", "디클래시 동안필러 (앞볼+옆볼) 3cc", "filler", "부위 나열"),
        ("얼굴전체 인모드 2가지모드 (FX + FORMA)", "얼굴전체 인모드 2가지모드 (FX+FORMA)", "inmode", "한 기기의 두 모드"),
        ("슈링크 유니버스 울트라 300샷 (울트라F 300샷 + 울트라부스터 300샷)", "슈링크 유니버스 울트라 300샷 (울트라F 300샷+울트라부스터 300샷)", "shrink",
         "한 기기의 팁"),
        ("LDM 물방울 리프팅(속건조개선 + 탄력 + 재생) 1회", "LDM 물방울 리프팅(속건조개선+탄력+재생) 1회", "ldm", "효과 나열"),
        ("리쥬란힐러 2cc (크라이오 + 모델링)", "리쥬란힐러 2cc (크라이오+모델링)", "rejuran", "함께 하는 관리"),
        ("태반주사 11회(태반주사 10회 + 태반주사 1회)", "태반주사 11회(태반주사 10회+태반주사 1회)", "placenta", "10+1회 행사"),
        ("에토좀PTT(압출 + 염증주사 포함) 1회", "에토좀PTT(압출+염증주사 포함) 1회", "ptt", "포함 메모"),
        ("[대표원장님] 포텐자 RF (* 아기주사3cc 추가시 + 3만원)", "[대표원장님] 포텐자 RF (* 아기주사3cc 추가시 +3만원)", "potenza", "추가 요금"),
        ("시그니처 부스터(아르기닌 + L-카르니틴 + 덱스판테놀) 1회", "시그니처 부스터(아르기닌+L-카르니틴+덱스판테놀) 1회", "generic", "성분 나열")]:
    a, b = TV(sp), TV(un)
    ok(f"괄호 '+' 띄어쓰기와 무관 — {why}: '{un}'", a and b and a["sig"] == b["sig"] and a["fam"] == fam, (a and (a["fam"], a["sig"]), b and b["sig"]))
ok("... 붙여 쓴 '듀얼토닝(피코토닝+제네시스)'는 괄호 없는 '듀얼토닝 1회' 규격에 안 들어감",
   TV("듀얼토닝(피코토닝+제네시스) 1회")["sig"] != TV("듀얼토닝 1회")["sig"])
ok("... '슈퍼 하이코(PDO실 2줄+…)'의 필러가 다르면 다른 규격(뉴라미스 ≠ 벨로테로)",
   TV("슈퍼 하이코(PDO실 2줄+국산 뉴라미스 1cc)")["sig"] != TV("슈퍼 하이코(PDO실 2줄+독일 벨로테로 1cc)")["sig"])
ok("... 괄호가 더 좁은 계열을 말하면('가을 톤업 토닝 (피코토닝 + 크라이오 + 모델링팩)') 레이저토닝 규격으로 읽지 않음",
   TV("가을 톤업 토닝 (피코토닝 + 크라이오 + 모델링팩)")["fam"] == "package")
ok("... 관리만 덧붙은 괄호는 같은 규격('피코토닝 10회 (피코토닝 + 촉촉팩)' = '피코토닝 10회')",
   TV("피코토닝 10회 (피코토닝 + 촉촉팩)")["sig"] == TV("피코토닝 10회")["sig"])
ok("... 이름의 '+'(NAD+·ASCE+)는 나열이 아님",
   TV("NMN(NAD+ 활성화 스킨부스터) 2.5cc 1회", "스킨부스터")["fam"] == "nmn" and TV("엑소좀 1병 (ASCE+) (팁 별도)", "스킨부스터")["fam"] == "exosome")
ok("... '(+ 이마,미간보톡스)'는 다른 시술을 더한 묶음", TV("리쥬비엘 (국산) 5cc (+ 이마,미간보톡스)", "보톡스·필러")["fam"] == "package")
ok("... 성분 나열 'X(성분A + 성분B)'는 한 상품('쥬베룩볼륨 아이 2CC (PDLLA + HA 성분 …)')",
   TV("쥬베룩볼륨 아이 2CC (눈밑) 1회 (PDLLA + HA 성분으로 눈밑 꺼짐 개선)", "스킨부스터")["fam"] == "juvelook")
ok("... 부위만 적은 괄호(계열 없는 이름)도 한 상품('노메스턱 (턱 + 침샘보톡스)' = '(턱+침샘보톡스)')",
   TV("노메스턱 (턱 + 침샘보톡스)", "보톡스·필러")["fam"] == "generic"
   and TV("노메스턱 (턱 + 침샘보톡스)", "보톡스·필러")["sig"] == TV("노메스턱 (턱+침샘보톡스)", "보톡스·필러")["sig"])
im2, im1 = TV("풀페이스 인모드(FX + FORMA) 3회", "리프팅"), TV("풀페이스 인모드 3회", "리프팅")
ok("... 괄호에만 적힌 인모드 두 모드('(FX + FORMA)', '(FORMA+FX-풀페이스)', '(FX+포마)')는 FX+FORMA — 한 모드 규격과 섞이지 않음",
   "FX+FORMA" in im2["tags"] and im2["sig"] != im1["sig"] and "FX+FORMA" in TV("고주파 리프팅 인모드(FORMA+FX-풀페이스) 3회", "리프팅")["tags"]
   and "FX+FORMA" in TV("(대표X)인모드리프팅(FX+포마)3회", "리프팅")["tags"]
   and TV("인모드 Forma(풀페이스) 1회 ([인모드Forma + Fx])", "리프팅")["tags"] == ["FX+FORMA"], (im2["tags"], im1["tags"]))
hs, hu = hv("[여성]손 5회 (손등 + 손가락)"), hv("[여성]손 5회 (손등+손가락)")
ok("... 제모 부위 나열은 그대로(띄어쓰기와 무관, 부위 '손가락+손등')", hs and hu and hs["sig"] == hu["sig"] and hs["fam"] == "hair" and hs["area"] == "손가락+손등",
   (hs and hs["area"], hu and hu["area"]))
ok("... 제모 포함 메모 '팔전체(손등+손가락 포함)'도 그대로(부위 '팔전체')", hv("팔전체(손등 + 손가락 포함) 5회")["area"] == "팔전체"
   and hv("팔전체(손등+손가락 포함) 5회")["sig"] == hv("팔전체(손등 + 손가락 포함) 5회")["sig"])
dup = fake_g([("닥터에버스", f"{i}점", "레이저 제모 겨드랑이 5회", "월간 레이저") for i in range(3)]
             + [("닥터에버스", f"{i}점", "레이저 제모 겨드랑이 5회", "월간 레이저") for i in range(3)]
             + [("닥터에버스", f"{i}점", "레이저 제모 인중 5회", "월간 레이저") for i in range(3)])
for i, r in enumerate(dup):
    r.update(cat="제모", sale=str(13000 if i < 3 else 65000 if i < 6 else 9000), url="https://example.invalid/month")
rk, ks, fs, st = taxonomy.build(dup)
ok("한 페이지에 같은 이름·다른 가격(성별 제목을 못 읽음)인 제모 줄은 성별 없는 부위 키에 넣지 않음", rk[:6] == [""] * 6 and all(rk[6:9]), rk)
# 2026-10-16: scrape/drevers.py keeps the 여성·남성 headings in the group, clean.py puts the sex in mname — the same page's two menus
sx = fake_g([("닥터에버스", f"{i}점", "레이저 제모 겨드랑이 5회", f"월간 레이저 · {s} 제모(5회 기준)") for s in ("여성", "남성") for i in range(3)])
for i, r in enumerate(sx):
    r.update(cat="제모", sale=str(13000 if i < 3 else 65000), url="https://example.invalid/month", mname=f"[{'여성' if i < 3 else '남성'}] {r['name']}")
rk, ks, fs, st = taxonomy.build(sx)
ok("성별 제목을 읽은 두 메뉴(같은 이름·다른 가격)는 여성·남성 키로 나뉘어 비교에 들어감", all(rk) and len(set(rk)) == 2
   and sorted(k["label"] for k in ks) == ["남성 겨드랑이 제모 5회", "여성 겨드랑이 제모 5회"], [k["label"] for k in ks])
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
# C8 가격 줄 번호: 빌드가 바뀌어도 같은 번호(바뀐 줄만 받는 업데이트 준비)
r8 = [dict(brand="A", branch="강남점", name="리쥬란 2cc", kind="일반", sale="200000", url="u/a"),
      dict(brand="A", branch="강남점", name="리쥬란\u3000 2CC", kind="일반", sale="190000", url="u/b"),
      dict(brand="A", branch="강남점", name="쥬베룩 2cc", kind="일반", sale="250000", url="u/a"), dict(brand="B", branch="강남점", name="리쥬란 2cc", kind="일반", sale="200000", url="u/a")]
import rowid  # noqa: E402
i1 = rowid.row_ids(r8)
i2 = rowid.row_ids(list(reversed(r8)))[::-1]
ok("C8 같은 줄은 순서가 바뀌어도 같은 번호", i1 == i2, (i1, i2))
ok("C8 번호는 줄마다 다름(같은 이름이 두 줄이면 주소 순으로 '~2' — 전각 공백·대문자는 같은 이름)", len(set(i1)) == 4 and i1[1] == i1[0] + "~2", i1)
i3 = rowid.row_ids([dict(r8[0], sale="500000"), dict(r8[1], sale="10000")] + r8[2:] + [dict(brand="A", branch="강남점", name="새 시술", kind="일반", sale="1", url="u/c")])
ok("C8 다른 페이지의 같은 이름 줄은 가격이 엇갈려도 번호 그대로, 다른 이름 줄이 생겨도 그대로", i3[:4] == i1, (i1, i3))
# the same page lists one option twice (C8 검토 2026-10-16): list price before sale price, so a sale change alone does not swap
p8 = [dict(brand="A", branch="강남점", name="착색토닝 1회", kind="일반", orig="39000", sale="29000", url="u/a"),
      dict(brand="A", branch="강남점", name="착색토닝 1회", kind="일반", orig="80000", sale="59000", url="u/a")]
j1 = rowid.row_ids(p8)
ok("C8 같은 페이지·같은 이름 두 줄: 정가가 다르면 판매가가 엇갈려도 번호 그대로",
   rowid.row_ids([dict(p8[0], sale="60000"), p8[1]]) == j1 == [j1[0], j1[0] + "~2"], (j1, rowid.row_ids([dict(p8[0], sale="60000"), p8[1]])))
q8 = [dict(r, orig="") for r in p8]
k1, k2 = rowid.row_ids(q8), rowid.row_ids([dict(q8[0], sale="60000"), q8[1]])
ok("C8 (알고 있는 한계) 같은 페이지·같은 이름·같은 정가 두 줄은 판매가가 엇갈리면 번호가 맞바뀜 — 저장 열쇠로 쓰지 않음",
   k1 == [k1[0], k1[0] + "~2"] and k2 == [k1[0] + "~2", k1[0]], (k1, k2))
k3 = rowid.row_ids(q8 + [dict(q8[0], sale="10000")])
ok("C8 (알고 있는 한계) 같은 페이지에 같은 이름 줄이 더 생기면 그 뒤 줄의 '~N'이 옮겨 감", k3 == [k1[0] + "~2", k1[0] + "~3", k1[0]], k3)
ok("C8 번호는 10글자(숫자·소문자)", all(re.fullmatch(r"[0-9a-z]{10}(~\d+)?", x) for x in i1), i1)
_sid = rowid.short_id
rowid.short_id = lambda b: "0000000001"                # every base on one root: the clash rule
try:
    ic = rowid.row_ids([dict(brand="A", branch="x", name="가", kind="일반", sale="1", url=""), dict(brand="A", branch="x", name="나", kind="일반", sale="1", url=""),
                        dict(brand="A", branch="x", name="나", kind="일반", sale="2", url="")])
finally:
    rowid.short_id = _sid
ok("C8 다른 바탕이 같은 번호면 뒤 바탕에 'x'를 붙이고, 그 바탕의 반복은 그 뒤에 '~2'", ic == ["0000000001", "0000000001x", "0000000001x~2"], ic)
bad_v, n_v = rowid.check()
ok(f"C8 다른 구현 확인용 예시 {n_v}줄이 지금 규칙과 같음(tests/fixtures/rowid_vectors.json)", not bad_v, bad_v[:2])
_rk, _lo = rowid.repeat_key, rowid.loose
_wrong = {"주소 무시": lambda r: (_rk(r)[1], _rk(r)[2]), "정가 무시": lambda r: (_rk(r)[0], _rk(r)[2]),
          "판매가를 정가보다 먼저": lambda r: (_rk(r)[0], _rk(r)[2], _rk(r)[1]), "데이터 순서만": lambda r: (),
          "비싼 순": lambda r: (_rk(r)[0], -_rk(r)[1], -_rk(r)[2]),
          "정가 없음을 맨 뒤로": lambda r: (_rk(r)[0], _rk(r)[1] or float("inf"), _rk(r)[2]),
          "주소 대소문자 무시(localeCompare 비슷)": lambda r: (_rk(r)[0].lower(), _rk(r)[1], _rk(r)[2])}
_ro = rowid.roots_of


def _roots_utf16(bs):                  # the clash rule with bases in UTF-16 unit order (what JS '<' and sort() give)
    out, owner = {}, set()
    for b in sorted(set(bs), key=lambda s: s.encode("utf-16-be")):
        h = rowid.short_id(b)
        while h in owner:
            h += "x"
        owner.add(h)
        out[b] = h
    return out


_wrong_roots = {"겹침 무시": lambda bs: {b: rowid.short_id(b) for b in bs}, "UTF-16 순(JS '<'·sort())": _roots_utf16}
_caught = {}
try:
    for _name, _key in _wrong.items():
        rowid.repeat_key = _key
        _caught[_name] = len(rowid.check()[0])
    rowid.repeat_key = _rk
    for _name, _f in _wrong_roots.items():
        rowid.roots_of = _f
        _caught[_name] = len(rowid.check()[0])
    rowid.roots_of = _ro
    for _name, _f in {"파이썬 \\s": lambda s: re.sub("[A-Z]", lambda m: m.group().lower(), re.sub(r"\s", "", s or "")),
                      "전체 lower()": lambda s: rowid.SPACE.sub("", s or "").lower()}.items():
        rowid.loose = _f
        _caught[_name] = len(rowid.check()[0])
finally:
    rowid.repeat_key, rowid.loose, rowid.roots_of = _rk, _lo, _ro
ok(f"C8 예시가 틀린 구현 {len(_caught)}가지를 모두 잡음", all(_caught.values()), _caught)
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

# 일반가 규칙 2(2026-10-16, B 결정): 태그가 없어도 요일·시간이 적힌 가격('토요일이벤트', '주말제외')은 조건부 가격
_G = appdata.G
_pr = lambda **kw: dict(dict(kind="일반", tags="", days="0", hours=""), **kw)
ok("일반가 규칙: 요일만·시간만·태그·체험가는 일반가 아님, 고시가·옛 clean.csv(요일·시간 칸 없음)는 일반가",
   _G.regular(_pr()) and _G.regular(_pr(kind="고시가")) and _G.regular(dict(kind="일반", tags=""))
   and not _G.regular(_pr(days="32")) and not _G.regular(_pr(days="96")) and not _G.regular(_pr(hours="12:00-17:00"))
   and not _G.regular(_pr(kind="고시가", days="31")) and not _G.regular(_pr(tags="평일 낮")) and not _G.regular(_pr(kind="체험가")))
ok("... 규칙 1(예전)은 요일·시간을 보지 않음 — 이전 data.json·스냅숏을 그 규칙으로 읽기 위해",
   _G.plain("일반", "", 32, "", rule=1) and _G.plain("일반", "", 0, "11:00-17:00", rule=1) and not _G.plain("일반", "평일 낮", 0, "", rule=1)
   and not _G.plain("일반", "", 32, "") and _G.plain("고시가", "", 0, ""))
ok("meta.plainRules: 처음 쓴 수집일부터 규칙 2, 그 전 스냅숏은 1, 다음 빌드는 목록을 그대로 이어 감",
   _G.rule_at(None, "2026-10-20") == 1 and _G.rule_at([[2, "2026-10-14"]], "2026-10-13") == 1 and _G.rule_at([[2, "2026-10-14"]], "2026-10-14") == 2
   and _G.rule_marks(None, "2026-10-14") == [[2, "2026-10-14"]] and _G.rule_marks([[2, "2026-10-14"]], "2026-10-20") == [[2, "2026-10-14"]])
# a previous data.json row: [branch, cat, name, sale, orig, kind, tags, keys, sess, group, until, url, vat, review, parts, addon, days, hours]
prev_d = {"s": ["A", "청주점", "토요일이벤트 슈링크 300샷", "", "X12"], "branches": [[0, 1]],
          "meta": {"brands": [["A"]], "kinds": appdata.KINDS, "updated": "2026-10-14"}, "keys": [["X12", 0, "슈링크 300샷"]]}
prow_d = [[0, 0, 2, 99000, 0, 0, 3, 4, 1, 5, 3, 3, 0, 0, 3, 0, 32, 3]]
now_d = [dict(brand="A", branch="청주점", name="토요일이벤트 슈링크 300샷", sale="99000", kind="일반", tags="", keys="X12", days="32", hours="", addon="0")]
prev_d2 = dict(prev_d, meta=dict(prev_d["meta"], plainRules=[[2, "2026-10-14"]]))
ok("규칙이 바뀐 첫 빌드: 이전 data.json(plainRules 없음)의 같은 줄·같은 가격은 옛 규칙으로 일반가 → 지금 아님 → recl(가짜 가격 변동 없음)",
   appdata.reclassified(prev_d, prow_d, now_d) == {"X12"})
ok("... 다음 빌드(이전 파일이 규칙 2): 그 줄은 양쪽 다 일반가 아님 → recl 다시 안 생김(같은 날 recl은 main()이 이어 붙임)",
   appdata.reclassified(prev_d2, prow_d, now_d) == set())
ok("... 요일·시간 칸 전의 16칸 data.json도 읽음(요일 없음 = 일반가, 지금도 요일 없으면 바뀐 것 없음)",
   appdata.reclassified(prev_d, [r[:16] for r in prow_d], now_d) == {"X12"}
   and appdata.reclassified(prev_d, [r[:16] for r in prow_d], [dict(now_d[0], days="0")]) == set())
_mk = ("A|청주점", appdata.G.comp("토요일이벤트 슈링크 300샷"), 99000)
ok("자동 묶음: 비교 기준 스냅숏이 규칙 1이면(그날 두 번째 빌드라 이전 파일은 규칙 2여도) 그 줄은 '없어짐'·'가격 변동'의 근거가 아님",
   appdata.group_moved(prev_d, prow_d, now_d, [5], "2026-10-13") == {_mk} and appdata.group_moved(prev_d2, prow_d, now_d, [5], "2026-10-13") == {_mk}
   and appdata.group_moved(prev_d2, prow_d, now_d, [5], "2026-10-14") == set())

# 가격 변동(changes)은 (id, 지점)마다 거름(2026-10-16): 쁨 울산점 줄이 규칙으로 TA42833F에서 빠졌다고(#83 칸 이름 '♥수목 해피아워♥')
# 같은 id의 다른 지점 진짜 변동(강남본점 149,000 → 250,000, 이벤트 끝)까지 빼지 않음
_D = "2026-10-14"
prev_p = {"s": ["쁨", "울산점", "강남본점", "쥬베룩 스킨부스터 2CC", "", "TA42833F", "쥬베룩 스킨부스터 2cc", "평일 낮"], "branches": [[0, 1], [0, 2]],
          "meta": {"brands": [["쁨"]], "kinds": appdata.KINDS, "updated": _D, "plainRules": [[2, _D]], "recl": [[_D, ["X14"]]]},
          "keys": [["TA42833F", 2, "쥬베룩 스킨 부스터 2cc"], ["X14", 1, "울쎄라 300샷"]]}
prow_p = [[0, 2, 3, 149000, 0, 0, 4, 5, 1, -1, 4, 4, 0, 0, 4, 0, 0, 4], [1, 2, 6, 250000, 0, 0, 4, 5, 1, -1, 4, 4, 0, 0, 4, 0, 0, 4]]
_row = lambda branch, name, sale, tags="", days="0": dict(brand="쁨", branch=branch, name=name, sale=str(sale), kind="일반", tags=tags, keys="TA42833F",
                                                       days=days, hours="", addon="0")
now_p = [_row("울산점", "쥬베룩 스킨부스터 2CC", 149000, "평일 낮", "12"), _row("강남본점", "쥬베룩 스킨부스터 2cc", 250000)]
pairs_p = appdata.recl_pairs(prev_p, prow_p, now_p)
ok("recl_pairs: 한 지점 줄만 조건이 바뀌면 그 (id, 지점)만 — reclassified(앱 meta.recl)는 지금처럼 id",
   pairs_p == {("TA42833F", "쁨|울산점")} and appdata.reclassified(prev_p, prow_p, now_p) == {"TA42833F"}, pairs_p)
ok("... 줄이 id에 들어오거나 나가도(이름·가격이 같은 줄의 키) 그 지점만",
   appdata.recl_pairs(prev_p, prow_p, [_row("울산점", "쥬베룩 스킨부스터 2CC", 149000), dict(_row("강남본점", "쥬베룩 스킨부스터 2cc", 250000), keys="")])
   == {("TA42833F", "쁨|강남본점")})
bk_p = ["쁨|강남본점", "쁨|울산점"]          # this build lists the branches in another order than the previous file
recl_p = [[_D, ["TA42833F", "X14"]]]        # meta.recl of this build: the same day's ids of the previous file + this build's
rb_p = appdata.recl_branches(prev_p, _D, recl_p, pairs_p, set(), bk_p)
before_p = {"TA42833F|쁨|강남본점": 149000, "TA42833F|쁨|울산점": 149000, "X14|쁨|강남본점": 990000}
best_p = {"TA42833F|쁨|강남본점": 250000, "TA42833F|쁨|울산점": 250000, "X14|쁨|강남본점": 890000}
kid_p, bi_p = {"TA42833F": 0, "X14": 1}, {("쁨", "강남본점"): 0, ("쁨", "울산점"): 1}
chg = lambda rb, since="2026-10-13": appdata.price_changes(before_p, best_p, *appdata.regrouped(recl_p, rb, since, bk_p), kid_p, bi_p)
ok("이전 파일에 meta.reclBranches가 없으면 그 파일의 같은 날 id(X14)는 모든 지점(id 단위) — 이번에 찾은 것만 지점 단위",
   rb_p == [[_D, {"TA42833F": [1]}]] and appdata.regrouped(recl_p, rb_p, "2026-10-13", bk_p) == ({"X14"}, {("TA42833F", "쁨|울산점")}), rb_p)
ok("changes: 울산점(규칙)과 X14(id 단위)는 빼고 강남본점 149,000 → 250,000은 남김 — 예전 id 단위로는 0건",
   chg(rb_p) == [[0, 0, 149000, 250000]] and chg([]) == [], (chg(rb_p), chg([])))
prev_p2 = {"s": ["쁨", "강남본점", "울산점"], "branches": [[0, 1], [0, 2]], "meta": {"brands": [["쁨"]], "recl": recl_p, "reclBranches": rb_p}}
ok("같은 수집 다시 빌드(이전 파일에 칸 있음, 새로 찾은 것 없음): 지점을 기억해 같은 결과",
   appdata.recl_branches(prev_p2, _D, recl_p, set(), set(), bk_p) == rb_p and chg(appdata.recl_branches(prev_p2, _D, recl_p, set(), set(), bk_p)) == [[0, 0, 149000, 250000]])
prev_p3 = dict(prev_p2, meta={k: v for k, v in prev_p2["meta"].items() if k != "reclBranches"})
ok("... 이전 파일에 칸이 없으면(이 고침 전 data.json) 그날 id는 모두 id 단위 — 가짜 변동이 다시 나오지 않음",
   appdata.recl_branches(prev_p3, _D, recl_p, set(), set(), bk_p) == [[_D, {}]] and chg([[_D, {}]]) == [])
ok("... 기억한 지점이 이번 빌드에 없으면 그 id는 모든 지점, 되살아난 id(whole_now)도 모든 지점",
   appdata.recl_branches(prev_p2, _D, recl_p, set(), set(), ["쁨|강남본점"]) == [[_D, {}]]
   and appdata.recl_branches(None, _D, [[_D, ["T0AAAAAA"]]], {("T0AAAAAA", "쁨|강남본점")}, {"T0AAAAAA"}, bk_p) == [[_D, {}]])
recl_n = [[_D, ["TA42833F", "X14"]], ["2026-10-21", ["X14"]]]
rb_n = appdata.recl_branches(prev_p2, "2026-10-21", recl_n, {("X14", "쁨|강남본점")}, set(), list(reversed(bk_p)))
ok("다음 수집: 지난 날짜 칸은 지점 이름으로 다시 번호를 매겨 이어 가고, 비교 기준 스냅숏(10-14) 이전·당일 것은 거르지 않음",
   rb_n == [[_D, {"TA42833F": [0]}], ["2026-10-21", {"X14": [1]}]]
   and appdata.regrouped(recl_n, rb_n, _D, list(reversed(bk_p))) == (set(), {("X14", "쁨|강남본점")}), rb_n)
# 예전 파일의 같은 날 id를 이번 빌드가 어느 지점에서 또 찾아도 id 단위 그대로(검토 2026-10-16: 이 경우를 지나는 시험이 없었음 —
# 지점 단위로 바꾸면 c626e66 위 빌드에서 블리비 X14 부산 경성대·안양·청주, 톡스앤필 X24·X31 같은 예전 가짜 변동 5건이 돌아옴)
_x14 = {("X14", "쁨|울산점")}               # this build finds X14 at 울산점; its change is at 강남본점 (990,000 → 890,000)
rb_o1 = appdata.recl_branches(prev_p, _D, recl_p, pairs_p | _x14, set(), bk_p)
ok("... 칸이 없는 이전 파일의 같은 날 recl에 있던 X14는 이번에 한 지점에서 찾아도 모든 지점 — 강남본점 X14 변동도 빠짐",
   rb_o1 == [[_D, {"TA42833F": [1]}]] and chg(rb_o1) == [[0, 0, 149000, 250000]], (rb_o1, chg(rb_o1)))
rb_o2 = appdata.recl_branches(prev_p2, _D, recl_p, _x14, set(), bk_p)
ok("... 칸이 있는 이전 파일이라도 그날 항목에 X14가 없으면(모든 지점으로 적힘) 같음",
   rb_o2 == rb_p and chg(rb_o2) == [[0, 0, 149000, 250000]], (rb_o2, chg(rb_o2)))

# 같은 수집을 다시 빌드할 때의 그물(same_collection_moved, 검토 2026-10-16): 규칙이 줄 이름을 바꾸면(칸 제목 읽기·합치기) recl_pairs는
# 이전 줄을 찾지 못함. 같은 수집이라 지점 최저가가 이전 판과 다르면 규칙 탓 — 블리비 명동점 '[이벤트] 레이저토닝 10회' 149,000
# (이름이 바뀌고 '일요일' 태그를 잃음)이 190,000 → 149,000 가짜 인하로 나오던 일
prev_n = {"s": ["블리비", "유앤아이", "명동점", "구로점", "", "레이저토닝 10회", "레이저토닝 10회 A", "레이저토닝 10회 이벤트", "토닝 1회", "일요일",
                "T6126905", "T0BBBBBB", "2026-10-15"],
          "branches": [[0, 2], [1, 3]], "keys": [["T6126905", 0, "레이저토닝 10회"], ["T0BBBBBB", 0, "토닝 1회"]],
          "meta": {"brands": [["블리비"], ["유앤아이"]], "kinds": appdata.KINDS, "updated": _D, "plainRules": [[2, _D]], "recl": []}}
_pr = lambda b, name, sale, tags=4, keys=10, until=4: [b, 0, name, sale, 0, 0, tags, keys, 1, -1, until, 4, 0, 0, 4, 0, 0, 4]
prow_n = [_pr(0, 5, 149000, tags=9), _pr(0, 6, 190000), _pr(1, 5, 250000), _pr(1, 7, 200000, until=12), _pr(1, 8, 80000, keys=11)]
_nr = lambda brand, branch, name, sale, keys="T6126905", tags="": dict(brand=brand, branch=branch, name=name, sale=str(sale), kind="일반", tags=tags,
                                                                      keys=keys, days="0", hours="", addon="0")
now_n = [_nr("블리비", "명동점", "[이벤트] 레이저토닝 10회", 149000), _nr("블리비", "명동점", "레이저토닝 10회 A", 190000),
         _nr("유앤아이", "구로점", "레이저토닝 10회", 250000), _nr("유앤아이", "구로점", "토닝 1회 (첫 방문)", 80000, "T0BBBBBB", "첫 방문"),
         _nr("블리비", "신규점", "레이저토닝 10회", 99000), _nr("블리비", "명동점", "새 시술", 50000, "TNEW0000")]
best_n = {}
for _r in now_n:
    if appdata.G.regular(_r):
        for _k in _r["keys"].split():
            best_n[f"{_k}|{_r['brand']}|{_r['branch']}"] = min(best_n.get(f"{_k}|{_r['brand']}|{_r['branch']}", 10 ** 12), int(_r["sale"]))
_mv = {("T6126905", "블리비|명동점"), ("T0BBBBBB", "유앤아이|구로점")}
sc_n = appdata.same_collection_moved(prev_n, prow_n, best_n, "2026-10-16")
ok("same_collection_moved: 이름이 바뀐 줄(명동점)·일반가를 잃은 줄(구로점 T0BBBBBB)을 찾음 — recl_pairs는 못 찾음. 새 지점(신규점)·새 id는 빼고, "
   "빌드 날짜에 끝난 이벤트 줄(구로점 200,000, 10-15까지)은 이전 판에서도 빼서 진짜 변동으로 둠",
   appdata.recl_pairs(prev_n, prow_n, now_n) == set() and sc_n == _mv
   and appdata.same_collection_moved(prev_n, prow_n, best_n, "2026-10-15") == _mv | {("T6126905", "유앤아이|구로점")}, sc_n)
ok("rule_pairs: 그물은 이전 판과 같은 수집일 때만(다음 수집에서는 가격이 정말 바뀌니 recl_pairs만)",
   appdata.rule_pairs(prev_n, prow_n, now_n, best_n, _D, "2026-10-16") == _mv
   and appdata.rule_pairs(prev_n, prow_n, now_n, best_n, "2026-10-21", "2026-10-16") == set()
   and appdata.rule_pairs(None, [], now_n, best_n, _D, "2026-10-16") == set())
bk_c = ["블리비|명동점", "유앤아이|구로점", "블리비|신규점"]
recl_c = [[_D, sorted({k for k, _ in _mv})]]
rb_c = appdata.recl_branches(prev_n, _D, recl_c, _mv, set(), bk_c)
before_c = {"T6126905|블리비|명동점": 190000, "T6126905|유앤아이|구로점": 200000}
kid_c, bi_c = {"T6126905": 0, "T0BBBBBB": 1, "TNEW0000": 2}, {("블리비", "명동점"): 0, ("유앤아이", "구로점"): 1, ("블리비", "신규점"): 2}
chg_c = lambda rb: appdata.price_changes(before_c, best_n, *appdata.regrouped(recl_c, rb, "2026-10-13", bk_c), kid_c, bi_c)
ok("... changes: 명동점 190,000 → 149,000(규칙)은 빼고 구로점 200,000 → 250,000(이벤트 끝)은 남김 — recl_pairs만으로는 가짜가 나옴",
   rb_c == [[_D, {"T0BBBBBB": [1], "T6126905": [0]}]] and chg_c(rb_c) == [[0, 1, 200000, 250000]]
   and appdata.price_changes(before_c, best_n, set(), set(), kid_c, bi_c) == [[0, 0, 190000, 149000], [0, 1, 200000, 250000]], (rb_c, chg_c(rb_c)))

# 자동 묶음 변동(achg)도 같은 수집 다시 빌드에서 기억(meta.reclGroups, 2026-10-16): #83이 쁨 울산점 '♥수목 해피아워♥' 줄에 태그를
# 붙인 다음 빌드는 그 줄을 achg에서 뺐지만, 그다음 빌드(이전 파일에 이미 태그)는 79,000 → 100,000 등 5건을 가격 인상으로 보였음.
# 부평점 '첫 방문'을 잃은 줄은 가짜 '새로 생김', 톡스앤필 부천점 '포텐자 펌핑팁'(추가 옵션이 됨)은 가짜 '없어짐'
_P = "2026-10-13"
_k1, _k2, _k3 = (appdata.G.comp(x) for x in ("국산 얼굴전체 스킨보톡스", "슈링크 유니버스 울트라 100샷", "포텐자 펌핑팁"))
bk_g = ["쁨|울산점", "쁨|강남본점", "쁨|부평점", "톡스앤필|부천점"]
_gr = lambda brand, branch, name, sale, tags="", days="0", addon="0": dict(brand=brand, branch=branch, name=name, sale=str(sale), kind="일반", tags=tags,
                                                                          keys="", days=days, hours="", addon=addon)
now_g = [_gr("쁨", "울산점", "국산 얼굴전체 스킨보톡스", 79000, "평일 낮", "12"), _gr("쁨", "울산점", "국산 얼굴전체 스킨보톡스", 100000),
         _gr("쁨", "강남본점", "국산 얼굴전체 스킨보톡스", 110000), _gr("쁨", "부평점", "슈링크 유니버스 울트라 100샷", 59000),
         _gr("톡스앤필", "부천점", "포텐자 펌핑팁", 50000, addon="1")]
gid_g, gkeys_g = [0, 0, 0, 1, -1], [_k1, _k2]
import glob as _glob  # noqa: E402
with tempfile.TemporaryDirectory() as _h:     # the 10-13 snapshot, then this collection's against it (groups.snapshot_and_changes)
    appdata.G.snapshot_and_changes(_h, _P, [_k1, _k2, _k3], [["국산 얼굴전체 스킨보톡스"], ["슈링크 유니버스 울트라 100샷"], ["포텐자펌핑 팁"]],
                                   [{0: 79000, 1: 100000}, {1: 49000}, {3: 50000, 1: 60000}], bk_g, [])
    chg_g, new_g, gone_g, aprev_g, asnap_g = appdata.G.snapshot_and_changes(
        _h, _D, gkeys_g, [["국산 얼굴전체 스킨보톡스"], ["슈링크 유니버스 울트라 100샷"]], [{0: 100000, 1: 110000}, {2: 59000}], bk_g,
        _glob.glob(os.path.join(_h, "*.auto.json.gz")))
ok("snapshot_and_changes: 비교 기준 스냅숏(10-13)도 돌려줌 — 이번 원자료(태그 전 79,000 · 첫 방문 59,000 · 추가 옵션 50,000)가 변동·새로 생김·없어짐에 있음",
   aprev_g == _P and asnap_g == {_k1: {"쁨|울산점": 79000, "쁨|강남본점": 100000}, _k2: {"쁨|강남본점": 49000}, _k3: {"톡스앤필|부천점": 50000, "쁨|강남본점": 60000}}
   and chg_g == [[0, 0, 79000, 100000], [0, 1, 100000, 110000]] and new_g == [[1, 2, 59000]]
   and sorted(x[:3] for x in gone_g) == sorted([["포텐자펌핑 팁", 1, 60000], ["포텐자펌핑 팁", 3, 50000], ["슈링크 유니버스 울트라 100샷", 1, 49000]]),
   (chg_g, new_g, gone_g))
# previous data.json files of the same collection (meta.updated = _D). Branches in another order than this build's
_gs = ["쁨", "톡스앤필", "부평점", "울산점", "부천점", "강남본점", "", "국산 얼굴전체 스킨보톡스", "슈링크 유니버스 울트라 100샷", "포텐자 펌핑팁", "평일 낮", "첫 방문"]
_prow = lambda b, name, sale, g, tags=6, addon=0, days=0: [b, 0, name, sale, 0, 0, tags, 6, 1, g, 6, 6, 0, 0, 6, addon, days, 6]
prow_g0 = [_prow(1, 7, 79000, 0), _prow(1, 7, 100000, 0), _prow(3, 7, 110000, 0), _prow(0, 8, 59000, 1, tags=11), _prow(2, 9, 50000, -1, addon=1)]
prow_g1 = [_prow(1, 7, 79000, 0, tags=10, days=12), _prow(1, 7, 100000, 0), _prow(3, 7, 110000, 0), _prow(0, 8, 59000, 1), _prow(2, 9, 50000, -1, addon=1)]
_gfile = lambda mem, updated=_D: {"s": _gs, "branches": [[0, 2], [0, 3], [1, 4], [0, 5]], "keys": [],
                                  "meta": dict({"brands": [["쁨"], ["톡스앤필"]], "kinds": appdata.KINDS, "updated": updated, "plainRules": [[2, _D]]},
                                               **({"reclGroups": mem} if mem is not None else {}))}
# the file before #83, built after this field: an earlier build of the collection found '포텐자 펌핑팁' (prev index 2 = 부천점)
prev_g0 = _gfile([_D, _P, [[_k3, 2, 50000]]])
moved_g1 = appdata.achg_moved(prev_g0, prow_g0, now_g, gid_g, gkeys_g, bk_g, _D, _P, asnap_g, new_g)
keep_g1 = appdata.achg_keep(chg_g, new_g, gone_g, moved_g1, bk_g, gkeys_g)
rg1 = appdata.recl_groups(moved_g1, _D, _P, asnap_g, bk_g)
_real = ([[0, 1, 100000, 110000]], [], [x for x in gone_g if x[1] == 1])     # 강남본점: the clinic's
ok("#83 다음 빌드: 태그가 붙은 울산점 79,000(가짜 인상)·첫 방문을 잃은 부평점 59,000(가짜 새로 생김)을 찾고, 이전 빌드가 찾은 부천점 50,000"
   "(가짜 없어짐)은 meta.reclGroups로 기억 — 강남본점 100,000 → 110,000·없어진 가격은 남김",
   moved_g1 == {("쁨|울산점", _k1, 79000), ("쁨|부평점", _k2, 59000), ("톡스앤필|부천점", _k3, 50000)} and keep_g1 == _real
   and rg1 == [_D, _P, sorted([[_k1, 0, 79000], [_k2, 2, 59000], [_k3, 3, 50000]])], (moved_g1, keep_g1, rg1))
# the next build of the same collection: its previous file (the build above) already has the tags. Branch indices of that file
prev_g1 = _gfile([_D, _P, [[k, {0: 1, 2: 0, 3: 2}[b], p] for k, b, p in rg1[2]]])
moved_g2 = appdata.achg_moved(prev_g1, prow_g1, now_g, gid_g, gkeys_g, bk_g, _D, _P, asnap_g, new_g)
ok("같은 수집 다시 빌드: group_moved는 아무것도 못 찾지만(예전엔 가짜 5건이 돌아온 까닭) meta.reclGroups로 같은 것을 빼서 같은 결과·같은 칸",
   appdata.group_moved(prev_g1, prow_g1, now_g, gid_g, _P) == set() and moved_g2 == moved_g1
   and appdata.achg_keep(chg_g, new_g, gone_g, moved_g2, bk_g, gkeys_g) == _real and appdata.recl_groups(moved_g2, _D, _P, asnap_g, bk_g) == rg1,
   moved_g2)
ok("... 예전처럼 기억 없이 거르면 가짜 울산점 인상·부평점 새로 생김·부천점 없어짐이 돌아옴(고치기 전 main)",
   appdata.achg_keep(chg_g, new_g, gone_g, appdata.group_moved(prev_g1, prow_g1, now_g, gid_g, _P), bk_g, gkeys_g) == (chg_g, new_g, gone_g))
_new_r = new_g + [[1, 0, 70000]]          # + a new price the clinic added (울산점, 슈링크 유니버스 울트라 100샷 70,000)
ok("... 기억이 있으면 진짜 새로 생김(울산점 70,000)은 남김 — 다 빼는 것은 칸이 없는 파일 위 한 번뿐",
   appdata.achg_moved(prev_g1, prow_g1, now_g, gid_g, gkeys_g, bk_g, _D, _P, asnap_g, _new_r) == moved_g1
   and appdata.achg_keep(chg_g, _new_r, gone_g, moved_g1, bk_g, gkeys_g)[1] == [[1, 0, 70000]])
prev_g1o = _gfile(None)
moved_o = appdata.achg_moved(prev_g1o, prow_g1, now_g, gid_g, gkeys_g, bk_g, _D, _P, asnap_g, new_g)
ok("이전 파일에 칸이 없으면(이 고침 전 data.json, 같은 수집) 스냅숏 가격이 같은 이름으로 아직 팔리는데 일반가가 아닌 것(태그·추가 옵션)을 뺌 — "
   "울산점 인상·부천점 없어짐은 빠지고, 강남본점은 남음. 지금 일반가가 된 줄(부평점 새로 생김)은 스냅숏에 없어 가릴 수 없으니 새로 생김은 모두 뺌"
   "(검토 2026-10-16: 그 파일의 38건 모두 규칙 탓 — 블리비 37건은 잘못 붙은 '평일 낮'을 잃음)",
   appdata.group_memory(prev_g1o, _D, _P) is None
   and moved_o == {("쁨|울산점", _k1, 79000), ("톡스앤필|부천점", _k3, 50000), ("쁨|부평점", _k2, 59000)}
   and appdata.achg_keep(chg_g, new_g, gone_g, moved_o, bk_g, gkeys_g) == ([[0, 1, 100000, 110000]], [], _real[2]), moved_o)
_mo_r = appdata.achg_moved(prev_g1o, prow_g1, now_g, gid_g, gkeys_g, bk_g, _D, _P, asnap_g, _new_r)
_rg_r = appdata.recl_groups(_mo_r, _D, _P, asnap_g, bk_g)
_mem_r = appdata.group_memory(_gfile([_D, _P, [[k, {0: 1, 2: 0, 3: 2}[b], p] for k, b, p in _rg_r[2]]]), _D, _P)
ok("... 그 한 번은 진짜 새로 생김(울산점 70,000)도 함께 빠지고(알면서 고른 값), meta.reclGroups에 적혀 다음 다시 빌드에서도 빠짐",
   _mo_r == moved_o | {("쁨|울산점", _k2, 70000)} and appdata.achg_keep(chg_g, _new_r, gone_g, _mo_r, bk_g, gkeys_g)[1] == []
   and _mem_r == _mo_r, (_mo_r, _mem_r))
ok("... 다른 스냅숏을 기준으로 적힌 칸도 못 믿음(None) → 같은 대체",
   appdata.group_memory(_gfile(["2026-10-14", "2026-10-12", [[_k1, 3, 100000]]]), _D, _P) is None
   and appdata.achg_moved(_gfile(["2026-10-14", "2026-10-12", [[_k1, 3, 100000]]]), prow_g1, now_g, gid_g, gkeys_g, bk_g, _D, _P, asnap_g,
                          new_g) == moved_o)
prev_gp = _gfile([_P, "2026-10-06", [[_k1, 3, 100000]]], updated=_P)        # the last build of the 10-13 collection (rows as in prev_g0)
ok("다음 수집의 첫 빌드: 이전 파일(지난 수집)의 칸은 쓰지 않음(그 스냅숏 기준) — 지난 판 줄과 직접 견줘서(group_moved) 찾음, 강남본점 100,000·"
   "진짜 새로 생김은 안 뺌",
   appdata.group_memory(prev_gp, _D, _P) == set()
   and appdata.achg_moved(prev_gp, prow_g0, now_g, gid_g, gkeys_g, bk_g, _D, _P, asnap_g, _new_r) == {("쁨|울산점", _k1, 79000), ("쁨|부평점", _k2, 59000)}
   and appdata.achg_moved(None, [], now_g, gid_g, gkeys_g, bk_g, _D, _P, asnap_g, _new_r) == set())
_sl = appdata.still_listed([_gr("쁨", "울산점", "국산 얼굴전체 스킨보톡스", 79000, "평일 낮", "12"), _gr("쁨", "울산점", "국산 얼굴전체스킨보톡스", 79000),
                            _gr("쁨", "강남본점", "국산 얼굴전체 스킨보톡스", 99000, "첫 방문"), _gr("쁨", "강남본점", "국산 얼굴전체 스킨보톡스", 90000)],
                           [0, 0, 0, 0], [_k1], {_k1: {"쁨|울산점": 79000, "쁨|강남본점": 100000}})
ok("still_listed: 그 가격이 아직 일반가로 있으면(띄어쓰기만 다른 줄) 빼지 않고, 그 가격의 줄이 없으면(강남본점 100,000 → 90,000) 진짜 변동",
   _sl == set(), _sl)
ok("meta.reclGroups 칸: 스냅숏에 없는 묶음 키·이번 빌드에 없는 지점은 적지 않음(그 키엔 변동 항목이 생길 수 없음)",
   appdata.recl_groups(moved_g1 | {("쁨|울산점", "없는키", 1), ("쁨|폐점", _k1, 1)}, _D, _P, asnap_g, bk_g) == rg1
   and appdata.recl_groups(moved_g1, _D, "", {}, bk_g) == [_D, "", []])

# C1 다음(검증 8차, 예전부터 있던 것)
def tg(s, brand="A"):
    """the condition tags clean.main gives an item whose group title is s (time_tags + TAGS)"""
    d, h = clean.visit_when(s, "")
    return clean.time_tags(brand, s, "", d, h) + [t for t, p in clean.TAGS if re.search(p, s)]
ok("해피아워·'화/수/목'·'12시~17시'·'평일 한정'은 시간 조건 — 일반가로 비교하지 않음(요일이 적힌 것은 '평일 낮')",
   all(tg(s) == ["평일 낮"] for s in ("♥화/수/목 해피아워 이벤트♥ 11시~16시 한정", "해피아워 (평일 한정) 슈링크 300샷", "화수목 해피아워 리쥬란"))
   and tg("리쥬란힐러 2cc") == [] and tg("화요일 휴진 안내") == [])
# C1 시간(2026-10-16): '평일 낮'은 사이트가 요일을 정할 때만 — 시간만 적힌 가격은 '시간대'(톡스앤필 삼성점 런치 타임이 토요일에 빠졌음)
_tw = [("[평일 11:00~17:00] 겨드랑이 5회", "A", ["평일 낮"]), ("★밴스타임 월목금 이벤트 12시~6시", "A", ["평일 낮"]),
       ("[평일4시이전] 아쿠아필 1회", "A", ["평일 낮"]), ("평일 해피아워 특가", "A", ["평일 낮"]), ("화·수·목 HAPPY HOUR", "A", ["평일 낮"]),
       ("[런치 타임 EVENT] 색소 올인원 1회 (12시-3시)", "톡스앤필", ["시간대"]), ("[10:30~16:00] 아쿠아필 1회(타임이벤트)", "톡스앤필", ["시간대"]),
       ("4시 이전 아쿠아필", "A", ["시간대"]), ("토요일 10시~2시 이벤트", "A", ["시간대"]),
       ("온다 해피아워 이벤트 온다 리프팅 60KJ", "유앤아이", ["시간대"]), ("해피아워이벤트 허니꿀광보습 1회", "닥터에버스", ["시간대"]),
       # 체인이 자기 페이지에서 요일을 정한 낱말(clean.DAY_WORDS)
       ("[프라임 타임] 울쎄라피 프라임 300샷", "블리비", ["평일 낮"]), ("해피 아워 이벤트 · 관리", "데이뷰", ["평일 낮"]), ("[해피아워]리모드", "쁨", ["평일 낮"]),
       ("[프라임 타임] 울쎄라피 프라임 300샷", "A", ["시간대"]),
       # 요일 칸에 주말이 있으면 낱말이 무엇이든 '평일 낮'이 아님(앱이 그 가격이 되는 날에 뺌 — 2026-10-16 검토)
       ("토요일 해피아워 리모드", "쁨", ["시간대"]), ("화/수/목/토 해피아워 이벤트", "A", ["시간대"]), ("[주말 프라임 타임] 울쎄라피", "블리비", ["시간대"]),
       ("평일점심 이벤트 아쿠아필 1회", "A", ["평일 낮"]), ("뷰티아워이벤트 아쿠아필 1회", "닥터에버스", ["시간대"]),
       # 요일만 있는 조건은 시간 태그가 아님, 병원 안내는 조건이 아님
       ("[평일 특가] 온다 리프팅", "A", []), ("토요일이벤트", "A", []), ("화요일 휴진 안내", "A", []), ("토요일 오전 진료", "A", []), ("리쥬란힐러 2cc", "A", [])]
_tb = [(s, b, want, tg(s, b)) for s, b, want in _tw if tg(s, b) != want]
ok(f"시간 조건 {len(_tw)}개: 요일이 적히면 '평일 낮', 시간만이면 '시간대', 체인 낱말은 그 체인만, '화요일 휴진 안내'는 없음", not _tb, _tb)
ok("같은 가격 두 페이지 합치기: 시간 태그 둘은 한 조건(평일 낮+평일 낮=평일 낮, 평일 낮+시간대=시간대, 한쪽만이면 없음, 다른 태그는 교집합)",
   clean.merge_tags("평일 낮", "평일 낮") == "평일 낮" and clean.merge_tags("평일 낮", "시간대") == "시간대" and clean.merge_tags("시간대", "평일 낮") == "시간대"
   and clean.merge_tags("평일 낮·첫 방문", "시간대·첫 방문") == "시간대·첫 방문" and clean.merge_tags("평일 낮", "") == "" and clean.merge_tags("첫 방문", "1인 1회") == ""
   and clean.merge_tags("일요일", "일요일") == "일요일")
ok("'평일 낮'은 TAGS가 아니라 time_tags에서만(요일·시간 칸과 같은 글로 정함)", not [t for t, _ in clean.TAGS if t in ("평일 낮", "시간대")])
ok("'영국산' 톡신은 '국산'이 아니라 수입", "국산" not in taxonomy.variant("주름 보톡스 2부위 (영국산)")[0]["label"].split()
   and taxonomy.variant("주름 보톡스 2부위 (국산)")[0]["label"].startswith("국산"))
ok("'집중 국산'·'진행중 국산'은 그대로 국산('중국산'으로 읽지 않음)", taxonomy.variant("보톡스 집중 국산 주름보톡스 3부위")[0]["label"].startswith("국산")
   and "X02" in [k[0] for k in xkeys.X if xkeys.match(k, "이벤트 진행중 국산 주름보톡스 1부위")])
ok("... 큐레이션 '국산' 키(X02·X07)에도 안 들어감", not [k[0] for k in xkeys.X if xkeys.match(k, "주름보톡스 1부위 (영국산)")]
   and "X02" in [k[0] for k in xkeys.X if xkeys.match(k, "주름보톡스 1부위 (국산)")], [k[0] for k in xkeys.X if xkeys.match(k, "주름보톡스 1부위 (영국산)")])

# C7 규격 설명 → 키 id: 글자가 아니라 서명의 낱말로('국산' 설명이 '미국산' 키에 붙지 않음)
_vk = [dict(id="T1", fam="toxin", sig="toxin|보톡스|국산,사각턱||||1"), dict(id="T2", fam="toxin", sig="toxin|보톡스|미국산,사각턱||||1"),
       dict(id="T3", fam="filler", sig="filler|필러|국산||||1")]
_sk = appdata.spec_keys([dict(fid="toxin", spec="국산", one_liner="."), dict(fid="toxin", spec="사각턱", one_liner=".")], _vk, {"T1", "T2", "T3"})
ok("C7 규격 설명마다 붙는 키 id(서명의 낱말·같은 제품군만)", [e["keys"] for e in _sk] == [["T1"], ["T1", "T2"]], _sk)
_sk2 = appdata.spec_keys([dict(fid="toxin", spec="국산", one_liner=".")], _vk, {"T1", "T2", "X01", "X04"},
                         [dict(fam="toxin", curated=["X01", "X04"])], {"X01": "국산 사각턱 보톡스 50U", "X04": "독일산(제오민) 사각턱 보톡스 50U"})
ok("C7 ... 큐레이션 키도 이름 낱말로('국산 사각턱 보톡스 50U'만, '미국산'·'독일산(제오민)'은 아님)", _sk2[0]["keys"] == ["T1", "X01"], _sk2)

# C1 다음(2026-10-16): 요일·시간 칸 — data.json 줄의 16 days(월 1 · 화 2 · 수 4 · 목 8 · 금 16 · 토 32 · 일 64), 17 hours('HH:MM-HH:MM')
_when = [("화/수/목", 14, ""), ("화수목 이벤트", 14, ""), ("화.수.목", 14, ""), ("화·수·목 HAPPY HOUR", 14, ""), ("수목 이벤트", 12, ""),
         ("월~목", 15, ""), ("월-금", 31, ""), ("월·수·금", 21, ""), ("ONLY 월/화/수/목 이벤트", 15, ""), ("★밴스타임 월목금 이벤트 12시~6시", 25, "12:00-18:00"),
         ("[EVENT] ★★(화,목,토이벤트)리쥬란힐러 2CC", 42, ""), ("SUPER SALE 금토이벤트", 48, ""), ("평일", 31, ""), ("주말특가 이벤트", 96, ""),
         ("토·일", 96, ""), ("[주말, 공휴일]아쿠아필 1회", 96, ""), ("일요일 특가전", 64, ""), ("토요일이벤트", 32, ""), ("[EVENT · 주말제외] 겨드랑이 제모 5회", 31, ""),
         ("평일 단독 이벤트♥ 공휴일, 주말 제외 / 오전 11시 - 오후 4시 (타임한정)", 31, "11:00-16:00"),
         ("평일한정이벤트 월~목 오전 11시~오후4시까지 평일 방문 고객 한정! *금요일, 주말, 공휴일 불가", 15, "11:00-16:00"),
         ("♥화/수/목 해피아워 이벤트♥ 화/수/목 11시~16시 한정 (점심시간 13시~14시 제외)", 14, "11:00-16:00"),
         ("⭐♥10월 화수목 해피아워⭐♥ 매주 화/수/목 적용 / 이외 요일 및 공휴일 불가 *10/1~10/15*", 14, ""),
         ("*일요일 가능/이외 요일 불가/당일소진 원칙*", 64, ""), ("첫방문 이벤트 - 스킨케어 토요일 시술 불가", 95, ""),
         ("11시~16시", 0, "11:00-16:00"), ("12:00~17:00", 0, "12:00-17:00"), ("오전 10시~오후 3시", 0, "10:00-15:00"), ("10-15시", 0, "10:00-15:00"),
         ("화수목 10~17시 한정! 특가 EVENT", 14, "10:00-17:00"), ("화,수,목 오전 11시~오후 5시30분 인모드FX(1부위)", 14, "11:00-17:30"),
         ("[EVENT] (평일한정 10시30분~6시까지/이벤트)얼굴전체보톡스", 31, "10:30-18:00"), ("[EVENT] (1회체험/평일한정 10:30~6:00) 조각주사 1부위", 31, "10:30-18:00"),
         ("미백관리 택 1 *화.수.목 1시~5까지 적용 가능", 14, "13:00-17:00"), ("[런치 타임 EVENT] 색소 올인원 1회 (12시-3시)", 0, "12:00-15:00"),
         ("[평일4시이전] 아쿠아필 1회", 31, "00:00-16:00"), ("★주중 타임할인이벤트★ 주중 6시까지 특별 타임할인", 31, "00:00-18:00"),
         # not a price's days or hours
         ("화요일 휴진 안내", 0, ""), ("토요일 오전 진료", 0, ""), ("4월 21(화)입고예정/사전예약", 0, ""), ("앞 목 5회", 0, ""), ("턱/목/일자주름", 0, ""),
         ("금일 한정 특가", 0, ""), ("화목한 분위기", 0, ""), ("이벤트 기간 10/1~10/15", 0, ""), ("시술 2~3시간 소요", 0, ""), ("1~2회 권장", 0, ""),
         ("프라임 타임 셀렉션", 0, ""), ("해피아워이벤트", 0, ""), ("평일 오후 반짝이벤트", 31, ""), ("데이타임 이벤트", 0, ""), ("원데이 트러블 패키지", 0, ""),
         ("월~금 월~금 월~금 토 일", 31, ""), ("월화수목금토일", 0, "")]
_bad = [(t, d, h, clean.visit_days(t), clean.visit_hours(t)) for t, d, h in _when if (clean.visit_days(t), clean.visit_hours(t)) != (d, h)]
ok(f"요일·시간 읽기 예시 {len(_when)}개('화요일 휴진 안내'·'21(화) 입고'·'목 주름'·'10/1~10/15'·'2~3시간'은 아님)", not _bad, _bad)
ok("요일·시간: 묶음 제목과 이름이 둘 다 맞음(제목 '평일' + 이름 '화,수,목' = 화수목), 겹치지 않으면 이름 쪽",
   clean.visit_when("평일한정이벤트", "화,수,목 11:00 ~17:00 물광필") == (14, "11:00-17:00")
   and clean.visit_when("평일 10~17시 한정", "[12시-3시] 아쿠아필") == (31, "12:00-15:00")
   and clean.visit_when("토요일이벤트", "[일요일 특가] 리쥬란") == (64, "") and clean.visit_when("화수목 이벤트", "리쥬란 힐러 2cc") == (14, ""))
ok("요일·시간: 두 페이지의 같은 가격은 둘 다 조건이 있을 때만 남고(태그처럼), 그때는 어느 쪽 요일·시간이든 됨",
   clean.visit_merge((14, "11:00-16:00"), (31, "10:00-15:00")) == (31, "10:00-16:00") and clean.visit_merge((14, "11:00-16:00"), (0, "")) == (0, ""))
ok("... 평일 페이지 + 주말 페이지 = 매일 → 요일 0(시간도 00:00~24:00이면 ''), 그래서 일반가 규칙 2에서도 일반가. 월~토(63)는 조건부 그대로",
   clean.visit_merge((31, ""), (96, "")) == (0, "") and clean.visit_merge((31, "00:00-14:00"), (31, "14:00-24:00")) == (31, "")
   and clean.visit_hours("0시~24시") == "" and _G.plain("일반", "", *clean.visit_merge((31, ""), (96, "")))
   and clean.visit_merge((31, ""), (32, "")) == (63, "") and not _G.plain("일반", "", *clean.visit_merge((31, ""), (32, ""))))
_raw_w = [("이벤트", "화수목 이벤트", "리쥬란 힐러 2cc", 199000), ("이벤트", "평일한정이벤트 월~목 오전 11시~오후4시까지 *금요일, 주말, 공휴일 불가", "온다 리프팅 6만줄", 150000),
          ("이벤트", "토요일이벤트", "울쎄라피 프라임 300샷", 990000), ("이벤트", "화수목 이벤트", "슈링크 유니버스 300샷", 250000),
          ("리프팅", "슈링크", "슈링크 유니버스 300샷", 250000), ("스킨케어", "평일 해피아워 특가", "아쿠아필 1회", 30000),
          ("스킨케어", "화/수/목 해피아워 이벤트 (10시~15시)", "아쿠아필 1회", 30000), ("스킨케어", "화요일 휴진 안내", "라라필 1회", 40000),
          ("색소", "색소 올인원", "[런치 타임 EVENT] 색소 올인원 1회 (12시-3시)", 220000), ("색소", "레이저토닝", "[평일 11:00~17:00] 레이저토닝 1회", 19000),
          ("스킨케어", "평일 오전 이벤트", "라라필 2회", 50000), ("스킨케어", "런치 타임 이벤트 (12시-3시)", "라라필 2회", 50000)]
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "data2", "raw"))
    with open(os.path.join(tmp, "data2", "raw", "velyb.csv"), "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["brand", "branch", "category", "group", "option", "sale", "orig", "addon", "until", "url", "fetched_at"])
        for c, g, o, s in _raw_w:
            wr.writerow(["블리비", "강남점", c, g, o, s, "", "0", "", "https://example.invalid/", "2026-10-15T06:00:00+09:00"])
    root, rawdir = clean.ROOT, clean.RAW
    clean.ROOT, clean.RAW = tmp, os.path.join(tmp, "data2", "raw")
    try:
        import contextlib, io
        with contextlib.redirect_stdout(io.StringIO()):
            clean.main()
    finally:
        clean.ROOT, clean.RAW = root, rawdir
    _wr = list(csv.DictReader(open(os.path.join(tmp, "data2", "clean.csv"), encoding="utf-8")))
    _w = {(r["option"], r["group"].split()[0]): (r["days"], r["hours"]) for r in _wr}
    _wt = {(r["option"], r["group"].split()[0]): r["tags"] for r in _wr}
ok("clean.csv days·hours: 요일이 묶음 제목에만 있어도 줄에 남음(예전 501줄), 같은 상품이 조건 없는 페이지에도 있으면 0(평일 + 화수목 10~15시 = 평일·시간 없음), '휴진 안내'는 0",
   _w.get(("리쥬란 힐러 2cc", "화수목")) == ("14", "") and _w.get(("온다 리프팅 6만줄", "평일한정이벤트")) == ("15", "11:00-16:00")
   and _w.get(("울쎄라피 프라임 300샷", "토요일이벤트")) == ("32", "") and _w.get(("슈링크 유니버스 300샷", "화수목")) == ("0", "")
   and _w.get(("아쿠아필 1회", "평일")) == ("31", "") and _w.get(("라라필 1회", "화요일")) == ("0", ""), _w)
ok("clean.csv tags: 요일이 적힌 시간 가격은 '평일 낮'(요일 칸 31·14), 시간만 적힌 런치 타임은 '시간대'(요일 칸 0·시간 12:00-15:00), '휴진 안내'는 없음",
   _wt.get(("[평일 11:00~17:00] 레이저토닝 1회", "레이저토닝")) == "평일 낮" and _wt.get(("리쥬란 힐러 2cc", "화수목")) == "평일 낮" and _wt.get(("슈링크 유니버스 300샷", "화수목")) == ""
   and _wt.get(("[런치 타임 EVENT] 색소 올인원 1회 (12시-3시)", "색소")) == "시간대"
   and _w.get(("[런치 타임 EVENT] 색소 올인원 1회 (12시-3시)", "색소")) == ("0", "12:00-15:00")
   and _wt.get(("아쿠아필 1회", "평일")) == "평일 낮" and _wt.get(("라라필 1회", "화요일")) == ""
   and [r["tags"] for r in _wr if r["option"] == "라라필 2회"] == ["시간대"], _wt)
# C1 시간 칸(2026-10-16): 요일·시간이 사이트 칸 이름(category)에만 있는 가격 — 쁨 울산점 '♥수목 해피아워♥' › '쥬베룩볼륨2CC'가 일반가로
# 비교됐음. 칸 이름은 시간·요일 낱말만 읽고(time_tags·visit_when), 메뉴 이름은 아무것도 바꾸지 않음


def tgc(cat, grp, opt, brand="A"):
    """(days, hours, time tags) clean.main gives an item under the site's category cat (as clean.main reads it: norm_text)"""
    c = clean.norm_text(cat)
    d, h = clean.visit_when(grp, opt, c)
    return d, h, clean.time_tags(brand, grp, opt, d, h, c)


_cw = [  # 조건 칸 → 태그
       ("♥수목 해피아워♥", "", "쥬베룩볼륨2CC", "쁨", (12, "", ["평일 낮"])), ("평일 해피아워", "", "릴리이드 물광주사 5cc", "쁨", (31, "", ["평일 낮"])),
       ("화수목 이벤트", "인모드", "인모드 FX 1부위", "A", (14, "", ["평일 낮"])),
       ("화/수/목(10~17시) 해피아워 이벤트", "레이저토닝", "레이저토닝 1회", "A", (14, "10:00-17:00", ["평일 낮"])),
       ("해피아워 (평일 한정)", "단독 이벤트", "아이 볼뉴머 200샷", "A", (31, "", ["평일 낮"])), ("평일 이벤트 (10~17시)", "스킨케어", "아쿠아필 1회", "A", (31, "10:00-17:00", ["평일 낮"])),
       ("해피아워 이벤트", "실리프팅", "잼버실 1줄", "A", (0, "", ["시간대"])), ("런치 타임 (12시-3시)", "색소", "레이저토닝 1회", "A", (0, "12:00-15:00", ["시간대"])),
       ("SUPER SALE 토요일 이벤트", "", "온다 리프팅 6만줄", "A", (32, "", [])), ("평일 1회체험 특가", "", "아쿠아필 1회", "쁨", (31, "", [])),
       # 이름 쪽이 가까운 글: 칸과 요일이 겹치면 둘 다, 안 겹치면 이름 쪽
       ("평일 이벤트", "", "화,수,목 11:00 ~17:00 물광필", "A", (14, "11:00-17:00", ["평일 낮"])), ("화수목 이벤트", "", "화,목 리쥬란 힐러 2cc", "A", (10, "", ["평일 낮"])),
       ("평일 이벤트", "토요일이벤트", "리쥬란 힐러 2cc", "A", (32, "", [])),
       # 메뉴 이름·안내 문구는 아무것도 바꾸지 않음(조건 낱말과 닮은 칸 이름 포함)
       ("리프팅", "", "슈링크 유니버스 300샷", "쁨", (0, "", [])), ("보톡스·윤곽", "", "턱보톡스", "A", (0, "", [])), ("이달의 이벤트", "", "리쥬란 2cc", "A", (0, "", [])),
       ("타임 리버스 리프팅", "", "울쎄라피 300샷", "쁨", (0, "", [])), ("데이타임 이벤트", "", "온다 6만줄", "A", (0, "", [])), ("48시간 수분관리", "", "아쿠아필", "데이뷰", (0, "", [])),
       ("※시간 상관없이 적용가능", "", "아쿠아필", "닥터에버스", (0, "", [])), ("제모 : 시술 전날 취침 전 또는 당일 오전 면도 부탁드립니다.", "", "겨드랑이 5회", "데이뷰", (0, "", [])),
       ("피부", "", "울쎄라피 프라임 300샷", "블리비", (0, "", [])), ("기획전", "[프라임 타임]", "울쎄라피 프라임 300샷", "블리비", (0, "", ["평일 낮"])),
       ("화요일 휴진 안내", "", "라라필 1회", "A", (0, "", [])), ("", "", "리쥬란 힐러 2cc", "A", (0, "", []))]
_cb = [(c, g, o, b, want, tgc(c, g, o, b)) for c, g, o, b, want in _cw if tgc(c, g, o, b) != want]
ok(f"칸 이름의 시간·요일 {len(_cw)}개: 조건 칸('화수목 이벤트'·'♥수목 해피아워♥'·'해피아워 이벤트')은 태그, 메뉴 이름('리프팅'·'타임 리버스 리프팅'·'데이타임 이벤트')은 그대로",
   not _cb, _cb)
# 검수 2026-10-16: 사이트가 '시간 상관없이'라고 쓴 요일 조건은 요일 칸만(시간 태그 없음). '평일 낮'에 시간 칸이 비면 앱이 이름에서만 이
# 낱말을 찾아 '시간 확인 필요'로 보였음(닥터에버스 강남점 15, 밴스 30줄). 요일 칸이 있으니 여전히 일반가가 아님(groups.plain 2)
_at = [("※시간 상관없이 적용가능", "화/수/목 이벤트", "턱끝필러 1cc(리쥬비엘) 1회", "닥터에버스", (14, "", [])),
       ("", "화수목 시간 상관 없이 방문 고객 대상 1인 1회 / KEEP 불가", "여성) 인중+겨드랑이제모", "밴스", (14, "", [])),
       ("", "♥화수목 해피아워♥ 시간 상관 없이 화/수/목요일 방문 고객님 대상 (1인 1회, keep 불가)", "아쿠아필 1회", "밴스", (14, "", [])),
       ("", "토요일 시간 무관 이벤트", "아쿠아필 1회", "A", (32, "", [])),
       # 요일이 없으면 시간 태그를 그대로(빼면 일반가가 됨), 시간이 적혀 있으면 그 시간이 조건
       ("", "해피아워 시간 상관없이", "아쿠아필 1회", "A", (0, "", ["시간대"])),
       ("", "화/수/목 11:00~16:00 (시간 관계없이 예약 가능)", "아쿠아필 1회", "A", (14, "11:00-16:00", ["평일 낮"]))]
_ab = [(c, g, o, b, want, tgc(c, g, o, b)) for c, g, o, b, want in _at if tgc(c, g, o, b) != want]
import groups as _grp  # noqa: E402
ok(f"'시간 상관없이' {len(_at)}개: 요일이 적히고 시간이 없으면 요일 칸만(시간 태그 없음, 일반가 아님), 요일이 없거나 시간이 적히면 그대로",
   not _ab and not _grp.plain("일반", "", 14, ""), _ab)
_plain = [("", "화수목 이벤트", "리쥬란 힐러 2cc"), ("", "[해피아워]리모드", "리모드"), ("", "평일한정이벤트 월~목 오전 11시~오후4시까지", "온다 리프팅 6만줄")]
ok("칸 이름이 메뉴 이름이면 묶음 제목·이름만 읽을 때와 같음", all(tgc(m, g, o, "쁨") == tgc("", g, o, "쁨") for m in ("리프팅", "보톡스·윤곽", "이달의 이벤트", "기획전")
                                                       for _, g, o in _plain))
ok("유앤아이 칸 이름은 제 글에 요일·시간이 있을 때만 읽음(수집기가 탭 이름과 상품 목록을 어긋나게 짝지음 — 과천점 '화수목 이벤트' 탭에 보톡스 가격표)",
   "유앤아이" in clean.CAT_UNPAIRED)
# C1 시간 칸 검토(2026-10-16): 다른 태그(첫 방문·일요일·타임세일·1인 1회)도 칸 이름의 그 낱말을 읽음 — 닥터에버스 목동점 '*각 항목별 1인 1회
# 한정' 칸 15줄(규격 있는 줄 5)이 일반가로 비교됐음(clean.main이 옵션 앞에 붙은 칸 이름을 떼고 태그를 읽음). 새 장비 칸('…신규런칭')은 첫 방문 아님
_tw = [("*각 항목별 1인 1회 한정", "3주년 기념 고객 감사 이벤트", "① 아쿠아필(1,2,3단계)+LED+모델링팩", ["1인 1회"]),
       ("첫방문 이벤트", "", "아쿠아필 1회", ["첫 방문"]), ("[첫방문한정]", "", "피코토닝 1회", ["첫 방문"]),
       ("일요일 특가", "", "레이저토닝 1회", ["일요일"]), ("타임세일", "", "슈링크 100샷", ["타임세일"]),
       ("덴서티리프팅 알파팁 신규런칭", "", "덴서티 알파 600샷", []), ("NMN X 나드샷 신규 런칭", "", "NMN 나드샷 1회", []),
       ("호남권 신규 런칭 프리미엄 더블쿨링 제모", "", "겨드랑이 5회", []), ("신규입고", "", "리투오 1cc", []), ("신규 도입", "", "리니어지 300샷", []),
       ("덴서티 신규런칭", "첫방문 이벤트", "덴서티 300샷", ["첫 방문"]),
       ("리프팅", "", "슈링크 유니버스 300샷", []), ("기획전", "", "울쎄라피 프라임 300샷", []), ("이달의 이벤트", "", "리쥬란 2cc", []),
       ("피부", "", "아쿠아필 1회", []), ("", "", "리쥬란 힐러 2cc", [])]
_tb = [(c, g, o, want, clean.cond_tags(g, o, clean.norm_text(c))) for c, g, o, want in _tw if clean.cond_tags(g, o, clean.norm_text(c)) != want]
ok(f"칸 이름의 첫 방문·일요일·타임세일·1인 1회 {len(_tw)}개: 조건 칸('*각 항목별 1인 1회 한정'·'첫방문 이벤트')은 태그, 새 장비 칸('…신규런칭')·메뉴 이름은 없음",
   not _tb, _tb)
ok("메뉴 이름 칸은 칸 없이 읽은 첫 방문·1인 1회 태그와 같음", all(clean.cond_tags(g, o, m) == clean.cond_tags(g, o) for m in ("리프팅", "보톡스·윤곽", "이달의 이벤트", "기획전")
                                                      for g, o in (("[첫방문] 아쿠아필", "아쿠아필 1회"), ("1인 1회 한정", "리쥬란 2cc"), ("", "피코토닝 1회"))))
_ow = [("평일 이벤트", "울쎄라피 프라임 300샷", True), ("화수목 이벤트", "인모드 FX 1부위", True), ("[해피아워]리모드", "리모드", True),
       ("", "아쿠아필 1회 (11시~16시)", True), ("국산 보톡스", "주름보톡스(국산) 1부위", False), ("레이저리프팅", "울쎄라피 프라임 300샷", False),
       ("첫방문 체험가 · 레이저토닝", "레이저토닝 1회", False), ("", "리쥬란 힐러 2cc", False)]
ok("own_when: 제 묶음 제목·이름에 요일·시간 조건이 있는지('평일 이벤트'·'화수목'·'해피아워'·'11시~16시' 있음, '국산 보톡스'·'첫방문 체험가' 없음)",
   all(clean.own_when("유앤아이", g, o) == w for g, o, w in _ow), [(g, o) for g, o, w in _ow if clean.own_when("유앤아이", g, o) != w])
# clean.main: 칸 이름에만 조건이 있는 줄, 같은 가격 두 페이지 합치기, 유앤아이 탭(제 글에 조건이 있을 때만 요일·시간), 닥터에버스 '1인 1회' 칸,
# '…신규런칭' 칸은 새 장비
import contextlib, io  # noqa: E402
_raw_c = [("ppeum", "쁨", "울산점", "♥수목 해피아워♥", "", "쥬베룩볼륨2CC", 129000), ("ppeum", "쁨", "울산점", "리프팅", "", "슈링크 유니버스 300샷", 250000),
          # 같은 상품·가격이 조건 칸과 메뉴 칸에: 아무나 받는 가격(조건 없음)
          ("ppeum", "쁨", "울산점", "♥수목 해피아워♥", "", "릴리이드 물광주사 5CC", 139000), ("ppeum", "쁨", "울산점", "스킨부스터", "", "릴리이드 물광주사 5CC", 139000),
          # 두 조건 칸에: 조건이 남고 어느 쪽 요일이든 됨(수목 + 평일 = 평일)
          ("ppeum", "쁨", "울산점", "♥수목 해피아워♥", "", "SS주사 40CC", 69000), ("ppeum", "쁨", "울산점", "평일 해피아워", "", "SS주사 40CC", 69000),
          # '평일 낮' 칸 + '시간대' 칸 = 시간대
          ("ppeum", "쁨", "울산점", "♥수목 해피아워♥", "", "슬림컷주사 200CC", 99000), ("ppeum", "쁨", "울산점", "런치 타임 (12시-3시)", "", "슬림컷주사 200CC", 99000),
          ("ppeum", "쁨", "분당점", "덴서티리프팅 알파팁 신규런칭", "", "덴서티 알파 600샷 + 온다 60KJ", 590000),
          ("uandi", "유앤아이", "과천점", "화수목 이벤트", "국산 보톡스", "주름보톡스(국산) 1부위", 8900),
          ("uandi", "유앤아이", "과천점", "보톡스/윤곽", "화수목 이벤트", "화수목) 탄력 고주파 케어", 20000),
          # 유앤아이 탭은 제 글에 요일·시간이 있을 때만 읽음: 선릉점 '평일 10~16시 타임이벤트' › '평일 이벤트' = 평일 낮·10~16시, 조건 없는 상품은 그대로,
          # 탭은 제 조건을 좁히기만(평일 + 화수목 = 화수목). 첫 방문·일요일·1인 1회 탭 이름은 안 읽음
          ("uandi", "유앤아이", "선릉점", "평일 10~16시 타임이벤트", "평일 이벤트", "울쎄라피 프라임 300샷", 990000),
          ("uandi", "유앤아이", "선릉점", "평일 10~16시 타임이벤트", "레이저리프팅", "울쎄라피 프라임 100샷", 450000),
          ("uandi", "유앤아이", "과천점", "화수목 이벤트", "평일 이벤트", "아쿠아필 1회", 30000),
          ("uandi", "유앤아이", "과천점", "💫해피썬데이EVENT💫", "국산 보톡스", "사각턱 보톡스 50U", 39000),
          ("uandi", "유앤아이", "과천점", "1인 1회 체험가", "레이저토닝", "레이저토닝 1회", 9900),
          # 닥터에버스 '1인 1회' 칸: 옛 raw(칸 이름이 옵션 앞에 붙음)·새 raw(이름만) 모두 1인 1회, 칸 없는 페이지에 같은 가격이 있으면 조건 없음
          ("drevers", "닥터에버스", "목동점", "*각 항목별 1인 1회 한정", "3주년 기념 고객 감사 이벤트", "*각 항목별 1인 1회 한정 ① 아쿠아필(1,2,3단계)+LED+모델링팩", 19000),
          ("drevers", "닥터에버스", "목동점", "*각 항목별 1인 1회 한정", "3주년 기념 고객 감사 이벤트", "⑦ 리쥬란힐러(2cc)", 159000),
          ("drevers", "닥터에버스", "목동점", "*각 항목별 1인 1회 한정", "3주년 기념 고객 감사 이벤트", "⑤ 피코토닝+모델링팩", 29000),
          ("drevers", "닥터에버스", "목동점", "", "10월 이벤트", "⑤ 피코토닝+모델링팩", 29000)]
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "data2", "raw"))
    for key in ("ppeum", "uandi", "drevers"):
        with open(os.path.join(tmp, "data2", "raw", f"{key}.csv"), "w", newline="", encoding="utf-8") as f:
            wr = csv.writer(f)
            wr.writerow(["brand", "branch", "category", "group", "option", "sale", "orig", "addon", "until", "url", "fetched_at"])
            for k, b, br, c, g, o, s in _raw_c:
                if k == key:
                    wr.writerow([b, br, c, g, o, s, "", "0", "", "https://example.invalid/", "2026-10-16T06:00:00+09:00"])
    root, rawdir = clean.ROOT, clean.RAW
    clean.ROOT, clean.RAW = tmp, os.path.join(tmp, "data2", "raw")
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            clean.main()
    finally:
        clean.ROOT, clean.RAW = root, rawdir
    _cc = {(r["branch"], r["option"]): (r["tags"], r["days"], r["hours"]) for r in csv.DictReader(open(os.path.join(tmp, "data2", "clean.csv"), encoding="utf-8"))}
_want_c = {("울산점", "쥬베룩볼륨2CC"): ("평일 낮", "12", ""), ("울산점", "슈링크 유니버스 300샷"): ("", "0", ""),
           ("울산점", "릴리이드 물광주사 5CC"): ("", "0", ""), ("울산점", "SS주사 40CC"): ("평일 낮", "31", ""), ("울산점", "슬림컷주사 200CC"): ("시간대", "0", ""),
           ("분당점", "덴서티 알파 600샷 + 온다 60KJ"): ("", "0", ""),
           ("과천점", "주름보톡스(국산) 1부위"): ("", "0", ""), ("과천점", "화수목) 탄력 고주파 케어"): ("평일 낮", "14", ""),
           ("선릉점", "울쎄라피 프라임 300샷"): ("평일 낮", "31", "10:00-16:00"), ("선릉점", "울쎄라피 프라임 100샷"): ("", "0", ""),
           ("과천점", "아쿠아필 1회"): ("평일 낮", "14", ""), ("과천점", "사각턱 보톡스 50U"): ("", "0", ""), ("과천점", "레이저토닝 1회"): ("", "0", ""),
           ("목동점", "① 아쿠아필(1,2,3단계)+LED+모델링팩"): ("1인 1회", "0", ""), ("목동점", "⑦ 리쥬란힐러(2cc)"): ("1인 1회", "0", ""),
           ("목동점", "⑤ 피코토닝+모델링팩"): ("", "0", "")}
ok("clean.csv: 칸 이름에만 있는 조건('♥수목 해피아워♥' → 평일 낮·수목), 메뉴 칸과 같은 가격이면 조건 없음, 두 조건 칸이면 남음(평일 낮+시간대=시간대), "
   "'…신규런칭' 칸은 첫 방문 아님, 유앤아이 탭은 제 글에 요일·시간이 있을 때만(선릉점 평일 이벤트 → 10~16시, 평일+화수목 = 화수목, 조건 없는 상품·"
   "첫 방문/일요일/1인 1회 탭은 그대로), 닥터에버스 '*각 항목별 1인 1회 한정' 칸 → 1인 1회(옛·새 raw), 칸 없는 페이지와 같은 가격이면 조건 없음",
   _cc == _want_c, {k: (v, _cc.get(k)) for k, v in _want_c.items() if _cc.get(k) != v} or sorted(set(_cc) - set(_want_c)))
# C 태그 낱말(2026-10-16). (a) '신규 런칭·입고·도입'은 묶음 제목·옵션에서도 새 장비라 첫 방문이 아님 — 저장 자료의 '신규' 64줄이 모두
# 새 장비인데 첫 방문이었음(58줄이 일반가로 돌아옴). 첫 방문 낱말('신규 고객'·'신규 회원'·'신규가입'·'신규 방문'·'첫방문 신규'·'웰컴')은 그대로.
# (b) 한 사람이 한 번만 받는 가격: 닥터에버스 연신내점 '각 항목 별로 1회 적용가능 …'(78줄)·톡스앤필 '1인1한정'·'1회 한정'(칸 이름·묶음
# 제목은 어디서나, 옵션은 괄호·'*' 뒤 메모로만 — build2/xkeys.py가 'N회 한정'을 읽는 방법(LIMIT_NOTE, #80)과 같음). '1회 한정가'·
# '주 1회 한정'(이용권 쓰는 횟수)·고르기 목록 한 칸('택4 - 라인리페어필(1회한정)/…')·옵션 제 글의 '아쿠아필 1회 한정'(회수)은 아님
_nw = [("", "[신규입고] 스킨핏팅 고주파, 세르프", "[[신규입고] 스킨핏팅 고주파, 세르프] 세르프 리프팅 600샷", []),
       ("", "울쎄라피프라임 ★울쎄라피프라임 신규런칭★ 정밀한 타겟층 시술안내", "울쎄라피프라임 300샷 1회", []),
       ("", "셀르디엠 차세대 ECM 스킨부스터 셀르디엠 신규런칭!!! 시술안내", "셀르디엠 1vial 캐뉼라 1회", []),
       ("", "", "[EVENT] [신규런칭이벤트]덴서티 300샷", []), ("", "", "덴서티 300샷 (알파팁 신규도입)", []),
       ("", "NMN X NAD 런칭 이벤트 · NMN X 나드샷 신규 런칭", "얼전 피코프락셀 + NMN X 나드샷 1vial", []),
       ("", "", "[춘천점 단독! 라스트 썸머 페스타] [신규 런칭] dca바디주사", []), ("", "", "EGF 리젠셀크림 100ml (★신규런칭★)", []),
       ("", "파마리서치×닥터에버스 SALE FESTA", "탄생주사 신규 런칭 : 에버클 탄생주사(2cc)+물광주사(2.5cc)+모델링팩 1회", []),
       # 첫 방문 낱말은 그대로, 새 장비 낱말과 함께여도
       ("", "신규 고객 이벤트", "아쿠아필 1회", ["첫 방문"]), ("", "", "[신규회원] 피코토닝 1회", ["첫 방문"]), ("", "신규가입 혜택", "LDM 12분", ["첫 방문"]),
       ("", "", "아쿠아필 (신규 방문 고객)", ["첫 방문"]), ("", "첫방문 신규", "라라필 1회", ["첫 방문"]), ("", "웰컴 이벤트", "슈링크 100샷", ["첫 방문"]),
       ("", "신규런칭 기념 신규 고객 특가", "덴서티 300샷", ["첫 방문"]),
       ("", "첫방문 이벤트 · 호남권 신규 런칭 프리미엄 더블쿨링 제모", "겨드랑이 5회", ["첫 방문"]),
       ("", "★덴서티 이벤트★ 이벤트 내용은 원장님 지정 불가 / 1인 1회 체험가 시술안내", "덴서티 100샷 (알파팁 신규도입)", ["1인 1회"]),
       # (b) 한 사람 한 번
       ("각 항목 별로 1회 적용가능 KakaoTalk 플러스친구 @닥터에버스_연신내", "평일한정이벤트", "주름보톡스(1부위) 국산 1회", ["1인 1회"]),
       ("※항목별 1회씩 적용", "첫방문이벤트", "국산 주름보톡스1부위", ["첫 방문", "1인 1회"]),
       ("*각 항목별 1인 1회 한정", "3주년 기념 고객 감사 이벤트", "② 라라필(1,2제)+크라이오+모델링팩", ["1인 1회"]),
       ("부가세 포함 만원(1회 한정) 1.96만", "26년 10월 2차) 한글날 맞이 만원으로 맘껏누림 큰잔치", "국산 사각턱보톡스 50유닛", ["1인 1회"]),
       ("골라골라 리프팅 페스티벌 (1회 한정)", "데이뷰티랜드 프리 페스티벌 · 골라골라 리프팅 페스티벌 (1회 한정)", "슈링크 300샷 (카톡플친 적용가)", ["1인 1회"]),
       ("1회한정 써마지FLX", "★써마지&덴서티 게릴라 이벤트★ · 1회한정 써마지FLX", "[1회체험] 써마지FLX 300샷 (카톡플친 적용가)", ["1인 1회"]),
       ("", "", "[EVENT] (1인1한정이벤트)겨드랑이제모+겨드랑이토닝5회", ["1인 1회"]),
       ("", "", "[어텀 꿀세일] [1회 한정] 슈링크 유니버스 울트라 100샷", ["1인 1회"]), ("", "", "[1회한정] 쥬베룩 볼륨 2cc", ["1인 1회"]),
       ("", "", "레스틸렌 1cc (1회 한정)", ["1인 1회"]), ("", "", "리투오 1회 (초진/재진 1회 한정)", ["1인 1회"]),
       ("", "", "1회 한정) 울쎄라피 프라임 100샷", ["1인 1회"]), ("", "", "주름보톡스 (하이톡스) 1부위 [1회 한정] (*이마, 미간)", ["1인 1회"]),
       ("", "", "리쥬란 1cc (*최대 1회 한정)", ["1인 1회"]),
       ("", "", "[1회 한정] 택2 패키지 (아쿠아필/LDM)", ["1인 1회"]), ("", "", "골라받는 수액패키지 5회 (감초/아르기닌 中 택1) (1회한정)", ["1인 1회"]), ("", "", "리쥬란 2cc (1인 최대 1회)", ["1인 1회"]), ("", "", "아르기닌주사 1인당 1회", ["1인 1회"]),
       # 한 사람 한 번이 아님
       ("", "", "아쿠아필 1회 한정", []), ("", "", "비타민 관리 1회 한정", []), ("", "", "쥬베룩 스킨 1cc 1회 한정가", []),
       ("", "", "울쎄라피 프라임 300샷 (*1회한정가)", []), ("", "", "센스 or 더블타이트 (물광부스터 + 기본관리 포함) 1회 한정 체험가", []),
       ("", "", "리쥬란 1cc (*11회 한정)", []), ("", "", "리쥬란 1cc (*3회 한정)", []),
       ("", "", "바디 착색토닝 3개월 이용권 (*주 1회 한정)(*부위 : 겨드랑이/무릎/팔꿈치 中 택1)", []),
       ("", "", "메디컬 필링케어 스페셜 4주 (택4 - 라인리페어필(1회한정)/프리미엄 블랙필/라라필/물톡스/예스필)", []),
       # 고르기 목록 한 칸은 목록 어디에 있어도(마지막 칸·쉼표 뒤·괄호 없는 칸·목록이 괄호 밖) 아님 — 칸 순서만 바꿔 1인 1회가 되던 것(검토 2026-10-16)
       ("", "", "메디컬 필링케어 스페셜 4주 (택4 - 프리미엄 블랙필/라라필/물톡스/예스필/라인리페어필(1회한정))", []),
       ("", "", "스킨케어 4주 (택2 - 아쿠아필/LDM 6분(1회한정), 크라이오)", []), ("", "", "스킨케어 4주 (택2 - 아쿠아필 1회한정/LDM)", []),
       ("", "", "아쿠아필(1회한정)/라라필 택1", []),
       ("", "", "메디컬스킨케어 스페셜 4주 ((라라필/물톡스/LDM12분(1회한정)/이온자임 中 선택 4회))", []),
       ("", "", "메디컬 스킨케어 베이직 4주 (빛타민케어/크라이오셀/워터풀케어/LDM 6분(재생)(1회한정) 中 선택 4회)", []),
       ("", "화수목 이벤트 오후 1시 ~ 4시 타임한정 이벤트! 월별 1회만 사용가능, 선결제 불가", "라라필+제네시스+LDM 6분", []),
       ("", "리팟레이저 1회만으로 말끔한 흑자 제거! 시술안내", "리팟레이저 5mm이내", []),
       ("", "", "아쿠아필+LDM+모델링팩 (각 항목별 1회씩 진행)", []), ("", "", "[EVENT] [체험이벤트] 블랙필,산소필,호박필 각 1회 가능", []),
       ("", "", "[화수목] 써마지 FLX 300샷 + 더모톡신(국산) (1년에 한번만 시술하는 프리미엄 특가♥)", []),
       ("", "세계 최초 액상형 콜라겐, 고우리 런칭 특가", "고우리 1cc", [])]
_nb = [(c, g, o, want, clean.cond_tags(g, o, clean.norm_text(c))) for c, g, o, want in _nw if clean.cond_tags(g, o, clean.norm_text(c)) != want]
ok(f"태그 낱말 {len(_nw)}개: '신규 런칭·입고·도입'은 묶음 제목·옵션에서도 첫 방문 아님('신규 고객'·'웰컴'은 첫 방문), '각 항목 별로 1회 적용가능'·"
   "'1인1한정'·칸·묶음 제목·메모의 '1회 한정'은 1인 1회, '1회 한정가'·'주 1회 한정'·고르기 목록 한 칸·옵션 제 글의 '1회 한정'은 아님", not _nb, _nb)
_tw2 = [("셀르디엠 차세대 ECM 스킨부스터 셀르디엠 신규런칭!!! 시술안내", "셀르디엠 차세대 ECM 스킨부스터 셀르디엠 !!! 시술"),
        ("[신규입고] 스킨핏팅 고주파, 세르프", "스킨핏팅 고주파, 세르프"), ("[신규런칭] 슈링크 유니버스 울트라", "슈링크 유니버스 울트라"),
        ("★울쎄라피프라임 신규런칭★ 울쎄라", "울쎄라피프라임 울쎄라"), ("★신규런칭 특가 이벤트★", ""), ("[이벤트] 슈링크 유니버스", "슈링크 유니버스"),
        ("신규 고객 이벤트 아쿠아필", "신규 고객 아쿠아필"), ("◆볼뉴머", "볼뉴머"), ("볼뉴머/슈링크 유니버스 이벤트", "볼뉴머/슈링크 유니버스")]
_tb2 = [(s, want, clean.title_words(s)) for s, want in _tw2 if clean.title_words(s) != want]
ok("묶음 제목을 이름에 붙일 때 '신규 런칭·입고'는 통째로 빠짐('런칭'만 빠져 이름에 '신규'가 남으면 앱이 첫 방문으로 읽음), 빈 괄호도 빠짐, "
   "'신규 고객'은 남음", not _tb2, _tb2)
ok("'1회 한정' 태그는 회수를 바꾸지 않음(xkeys.sessions: 메모의 'N회 한정'은 구매 제한, 옵션 제 글은 회수 — #80)",
   [xkeys.sessions(n) for n in ("레스틸렌 1cc (1회 한정)", "아이리쥬란 1cc 3회 (1회 한정)", "[1회 한정] 슈링크 유니버스 울트라 100샷",
                                 "아쿠아필 1회 한정", "리쥬란 2cc 5회 (*1회 한정)", "[EVENT] (1인1한정이벤트)겨드랑이제모+겨드랑이토닝5회")] == [1, 3, 1, 1, 5, 5])
# clean.main: 옛 raw(닥터에버스 칸 이름이 옵션 앞에 붙음)·새 raw 모두, 새 장비 줄은 일반가(groups.regular), '1회 한정' 칸·메모 줄은 1인 1회
# (옵션에 '한정'이 있으면 종류가 이미 한정가라 일반가가 아님 — 태그가 바꾸는 일반가는 칸·묶음 제목에만 쓰인 줄)
_raw_n = [("ppeum", "쁨", "대구점", "", "[신규입고] 스킨핏팅 고주파, 세르프", "[[신규입고] 스킨핏팅 고주파, 세르프] 세르프 리프팅 600샷", 1590000),
          ("ppeum", "쁨", "부평점", "초음파", "", "[신규런칭] 슈링크 유니버스 울트라 300샷", 160000),
          ("ppeum", "쁨", "하남미사점", "지점 단독 특가", "", "[1회한정] 쥬베룩 볼륨 2cc", 99000),
          ("ppeum", "쁨", "하남미사점", "지점 단독 특가", "", "바디 착색토닝 3개월 이용권 (*주 1회 한정)", 290000),
          ("vands", "밴스", "광주", "레이저리프팅", "울쎄라피프라임 ★울쎄라피프라임 신규런칭★ 정밀한 타겟층 시술안내", "울쎄라피프라임 300샷 1회", 1050000),
          ("vands", "밴스", "광주", "이달의 이벤트", "신규 고객 이벤트", "아쿠아필 1회", 19000),
          ("drevers", "닥터에버스", "연신내점", "각 항목 별로 1회 적용가능 KakaoTalk 플러스친구 @닥터에버스_연신내", "평일한정이벤트",
           "각 항목 별로 1회 적용가능 KakaoTalk 플러스친구 @닥터에버스_연신내 주름보톡스(1부위) 국산 1회", 6900),
          ("drevers", "닥터에버스", "연신내점", "각 항목 별로 1회 적용가능 KakaoTalk 플러스친구 @닥터에버스_연신내", "평일한정이벤트", "가다실 9가 3회", 490000),
          ("drevers", "닥터에버스", "미사점", "부가세 포함 만원(1회 한정) 1.96만", "26년 10월 2차) 한글날 맞이 만원으로 맘껏누림 큰잔치",
           "부가세 포함 만원(1회 한정) 1.96만 국산 사각턱보톡스 50유닛", 10000),
          ("uandi", "유앤아이", "구로점", "필러", "점제거", "점제거 1mm 이하 1개 (1회 한정)", 1000),
          ("uandi", "유앤아이", "신촌점", "평일 이벤트 (10~17시)", "스킨케어", "아쿠아필 1회 한정", 9900),
          ("cellin", "셀린", "노원점", "", "[10월 필링]", "메디컬 필링케어 스페셜 4주 (택4 - 라인리페어필(1회한정)/프리미엄 블랙필/라라필/물톡스/예스필)", 290000),
          ("cellin", "셀린", "노원점", "", "[10월 필링]", "메디컬 필링케어 스페셜 4주 (택4 - 프리미엄 블랙필/라라필/물톡스/예스필/라인리페어필(1회한정))", 290000),
          ("vands", "밴스", "수원망포", "스킨부스터", "셀르디엠 차세대 ECM 스킨부스터 셀르디엠 신규런칭!!! 시술안내", "셀르디엠 1vial 캐뉼라 1회", 190000)]
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "data2", "raw"))
    for key in sorted({x[0] for x in _raw_n}):
        with open(os.path.join(tmp, "data2", "raw", f"{key}.csv"), "w", newline="", encoding="utf-8") as f:
            wr = csv.writer(f)
            wr.writerow(["brand", "branch", "category", "group", "option", "sale", "orig", "addon", "until", "url", "fetched_at"])
            for k, b, br, c, g, o, s in _raw_n:
                if k == key:
                    wr.writerow([b, br, c, g, o, s, "", "0", "", "https://example.invalid/", "2026-10-16T06:00:00+09:00"])
    root, rawdir = clean.ROOT, clean.RAW
    clean.ROOT, clean.RAW = tmp, os.path.join(tmp, "data2", "raw")
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            clean.main()
    finally:
        clean.ROOT, clean.RAW = root, rawdir
    _rows_n = list(csv.DictReader(open(os.path.join(tmp, "data2", "clean.csv"), encoding="utf-8")))
    _cn = {(r["branch"], r["option"]): (r["tags"], r["sess"], appdata.G.regular(r)) for r in _rows_n}
_want_n = {("대구점", "[[신규입고] 스킨핏팅 고주파, 세르프] 세르프 리프팅 600샷"): ("", "1", True),
           ("부평점", "[신규런칭] 슈링크 유니버스 울트라 300샷"): ("", "1", True),
           ("하남미사점", "[1회한정] 쥬베룩 볼륨 2cc"): ("1인 1회", "1", False),
           ("하남미사점", "바디 착색토닝 3개월 이용권 (*주 1회 한정)"): ("", "99", False),
           ("광주", "울쎄라피프라임 300샷 1회"): ("", "1", True), ("광주", "아쿠아필 1회"): ("첫 방문", "1", False),
           ("연신내점", "주름보톡스(1부위) 국산 1회"): ("평일 낮·1인 1회", "1", False), ("연신내점", "가다실 9가 3회"): ("평일 낮·1인 1회", "3", False),
           ("미사점", "국산 사각턱보톡스 50유닛"): ("1인 1회", "1", False),
           ("구로점", "점제거 1mm 이하 1개 (1회 한정)"): ("1인 1회", "1", False), ("신촌점", "아쿠아필 1회 한정"): ("", "1", False),
           ("노원점", "메디컬 필링케어 스페셜 4주 (택4 - 라인리페어필(1회한정)/프리미엄 블랙필/라라필/물톡스/예스필)"): ("", "99", False),
           ("노원점", "메디컬 필링케어 스페셜 4주 (택4 - 프리미엄 블랙필/라라필/물톡스/예스필/라인리페어필(1회한정))"): ("", "99", False),
           ("수원망포", "셀르디엠 1vial 캐뉼라 1회"): ("", "1", True)}
ok("clean.csv: 새 장비('[신규입고]'·'신규런칭★' 묶음 제목·'[신규런칭]' 옵션)는 조건 없는 일반가, '신규 고객'은 첫 방문, 닥터에버스 '각 항목 별로 1회 "
   "적용가능' 칸(옛 raw·새 raw)·'부가세 포함 만원(1회 한정)' 칸·메모의 '(1회 한정)'·'[1회한정]'은 1인 1회(회수 그대로), '주 1회 한정'·고르기 목록 한 칸·"
   "옵션 제 글의 '아쿠아필 1회 한정'은 태그 없음", _cn == _want_n,
   {k: (v, _cn.get(k)) for k, v in _want_n.items() if _cn.get(k) != v} or sorted(set(_cn) - set(_want_n)))
_nm_n = {r["option"]: r["name"] for r in _rows_n if r["branch"] == "수원망포"}
ok("clean.csv: 묶음 제목을 붙인 이름에 '신규'가 남지 않음(밴스 수원망포 '셀르디엠 … 신규런칭!!! 시술안내' › '셀르디엠 1vial 캐뉼라 1회')",
   _nm_n == {"셀르디엠 1vial 캐뉼라 1회": "셀르디엠 차세대 ECM 스킨부스터 셀르디엠 !!! 시술 · 셀르디엠 1vial 캐뉼라 1회"}, _nm_n)
# clean.main: 닥터에버스 '※…' 칸 아래 가격(2026-10-16, 391줄이 안내 문구로 빠졌음). 옛 raw는 칸 이름이 이름 앞에 붙고, 새 raw(수집기
# 2026-10-15~)는 이름만. 칸 이름을 떼고 조건은 칸·묶음 제목대로, 칸 이름만 있거나 뒤가 다시 안내 문구면 그대로 뺌. 지난 빌드의
# issues.csv가 글자로 뺀 줄이 돌아오면 back=1(새로 생김 아님) — 같은 가격이 빠지지 않은 페이지에도 있으면 back 없음
_DV = [("마곡점", "※카카오톡 플러스친구 혜택", "첫방문이벤트", "※카카오톡 플러스친구 혜택 울쎄라피 프라임 100샷 1회", 239000),
       ("구로점", "※항목별 1회씩 적용", "첫방문이벤트", "※항목별 1회씩 적용 국산 주름보톡스(1부위)", 5900),
       ("강남점", "※시간 상관없이 적용가능", "화/수/목 이벤트", "※시간 상관없이 적용가능 턱끝필러 1cc(리쥬비엘) 1회", 126000),
       ("천호점", "※카카오톡 플러스 친구로 예약 시 적용!", "해피아워이벤트", "※카카오톡 플러스 친구로 예약 시 적용! 온다리프팅 5만줄 1회", 250000),
       ("마곡점", "※카카오톡 플러스친구 혜택", "첫방문이벤트", "※카카오톡 플러스친구 혜택 ※1인 1회 적용, 중복 할인 불가", 1000),
       ("마곡점", "※주의사항", "첫방문이벤트", "※주의사항", 1000),
       ("청담점", "※카카오톡 플러스친구 혜택", "첫방문이벤트", "울쎄라 100샷 1회", 190000),           # new raw: the name alone
       ("광교점", "※카카오톡 플러스친구 혜택", "첫방문이벤트", "※카카오톡 플러스친구 혜택 포텐자(RF)+크라이오+모델링팩 1회", 99000),
       ("광교점", "10월 혜택", "10월 이벤트", "포텐자(RF)+크라이오+모델링팩 1회", 99000)]   # same item and price on another page
_DROP = [("마곡점", "※카카오톡 플러스친구 혜택", "※카카오톡 플러스친구 혜택 울쎄라피 프라임 100샷 1회", 239000),
         ("구로점", "※항목별 1회씩 적용", "※항목별 1회씩 적용 국산 주름보톡스(1부위)", 5900),
         ("청담점", "※카카오톡 플러스친구 혜택", "※카카오톡 플러스친구 혜택 울쎄라 100샷 1회", 179000),   # its price moved since
         ("광교점", "※카카오톡 플러스친구 혜택", "※카카오톡 플러스친구 혜택 포텐자(RF)+크라이오+모델링팩 1회", 99000)]
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "data2", "raw"))
    with open(os.path.join(tmp, "data2", "raw", "drevers.csv"), "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["brand", "branch", "category", "group", "option", "sale", "orig", "addon", "until", "url", "fetched_at"])
        for br, c, g, o, s in _DV:
            wr.writerow(["닥터에버스", br, c, g, o, s, "", "0", "", "https://example.invalid/", "2026-10-19T06:00:00+09:00"])
    with open(os.path.join(tmp, "data2", "issues.csv"), "w", newline="", encoding="utf-8-sig") as f:   # the previous build's
        wr = csv.writer(f)
        wr.writerow(["action", "reason", "brand", "branch", "category", "group", "option", "sale", "orig", "url"])
        for br, c, o, s in _DROP:
            wr.writerow(["제외", "안내 문구(가격 아님)", "닥터에버스", br, c, "첫방문이벤트", o, s, "", "https://example.invalid/"])
    root, rawdir = clean.ROOT, clean.RAW
    clean.ROOT, clean.RAW = tmp, os.path.join(tmp, "data2", "raw")
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            clean.main()
    finally:
        clean.ROOT, clean.RAW = root, rawdir
    _rows_dv = list(csv.DictReader(open(os.path.join(tmp, "data2", "clean.csv"), encoding="utf-8")))
    _iss_dv = list(csv.DictReader(open(os.path.join(tmp, "data2", "issues.csv"), encoding="utf-8-sig")))
_got_dv = {(r["branch"], r["option"]): (r["name"], r["tags"], int(r["days"]), r["hours"], r["back"]) for r in _rows_dv}
_want_dv = {("마곡점", "울쎄라피 프라임 100샷 1회"): ("울쎄라피 프라임 100샷 1회", "첫 방문", 0, "", "1"),
            ("구로점", "국산 주름보톡스(1부위)"): ("국산 주름보톡스(1부위)", "첫 방문·1인 1회", 0, "", "1"),
            ("강남점", "턱끝필러 1cc(리쥬비엘) 1회"): ("턱끝필러 1cc(리쥬비엘) 1회", "", 14, "", ""),
            ("천호점", "온다리프팅 5만줄 1회"): ("온다리프팅 5만줄 1회", "시간대", 0, "", ""),
            ("청담점", "울쎄라 100샷 1회"): ("울쎄라 100샷 1회", "첫 방문", 0, "", "1"),
            ("광교점", "포텐자(RF)+크라이오+모델링팩 1회"): ("포텐자(RF)+크라이오+모델링팩 1회", "", 0, "", "")}
ok("닥터에버스 '※…' 칸(옛 raw는 이름 앞에 붙음) 아래 가격은 안내 문구가 아니라 상품: 칸 이름을 떼고, 조건은 칸·묶음 제목대로(첫 방문 · "
   "'항목별 1회씩 적용' 1인 1회 · '화/수/목 이벤트'는 '※시간 상관없이 적용가능' 칸이라 요일 칸만 · 해피아워 시간대), "
   "'카카오톡 플러스친구 혜택'은 조건 아님, 새 raw도 같음",
   _got_dv == _want_dv, {k: (v, _got_dv.get(k)) for k, v in _want_dv.items() if _got_dv.get(k) != v} or sorted(set(_got_dv) - set(_want_dv)))
ok("... 칸 이름만 있는 줄·뒤가 다시 안내 문구인 줄은 그대로 안내 문구로 뺌",
   sorted(i["option"] for i in _iss_dv if i["reason"] == "안내 문구(가격 아님)") == ["※주의사항", "※카카오톡 플러스친구 혜택 ※1인 1회 적용, 중복 할인 불가"],
   [(i["action"], i["option"]) for i in _iss_dv])
ok("... 지난 빌드가 글자로 뺀 줄만 back=1(옛 raw·새 raw 모두, 그 뒤 가격이 바뀐 청담점도), 같은 가격이 다른 페이지에 남아 있던 줄(광교점)과 "
   "처음 보는 줄은 back 없음",
   sorted(r["branch"] for r in _rows_dv if r["back"] == "1") == ["구로점", "마곡점", "청담점"])
# appdata.came_back → data-meta.json changes.added, meta.recl(recl_pairs), achg(group_moved)
prev_cb = {"s": ["A", "강남점", "울쎄라 300샷", "", "X14", ""], "branches": [[0, 1]], "meta": {"brands": [["A"]], "kinds": appdata.KINDS},
           "keys": [["X14", 0, "울쎄라 300샷"]]}
prow_cb = [[0, 0, 2, 590000, 0, 0, 3, 4, 1, 5]]
_r = lambda name, sale, tags="", back="1": dict(brand="A", branch="강남점", name=name, sale=str(sale), kind="일반", tags=tags, keys="X14", back=back,
                                               addon="0", days="0", hours="")
now_cb = [_r("울쎄라 300샷", 590000), _r("울쎄라 300샷 1회", 490000), _r("울쎄라 300샷 첫방문", 290000, "첫 방문"), _r("울쎄라 300샷 1회차", 390000, back="")]
cb = appdata.came_back(prev_cb, prow_cb, now_cb)
ok("came_back: back=1이고 지난 data.json에 없던 줄만(이미 있던 줄·back 없는 줄은 아님)",
   cb == {("A", "강남점", "울쎄라 300샷 1회", 490000), ("A", "강남점", "울쎄라 300샷 첫방문", 290000)}, cb)
_hi = _r("울쎄라 300샷 첫방문 (2회차)", 690000, "첫 방문")      # a conditional price above the branch's 590,000
ok("... 돌아온 줄은 규칙이 id를 옮긴 것(meta.recl): 일반가면 언제나, 조건부(첫 방문)는 그 지점 그 id의 첫 줄이거나 다른 줄보다 쌀 때 — 알림은 "
   "특가까지 넣은 표시가로 셈(앱 watchNow·알림 Worker, 검수 2026-10-16: 41개 id가 '새 최저가'·'파는 지점이 늘면'으로 읽힘). 더 비싼 조건부 줄은 아님",
   appdata.recl_pairs(prev_cb, prow_cb, now_cb[:2]) == {("X14", "A|강남점")}
   and appdata.recl_pairs(prev_cb, prow_cb, [now_cb[0], now_cb[2]]) == {("X14", "A|강남점")}
   and appdata.recl_pairs(prev_cb, prow_cb, [now_cb[0], _hi]) == set()
   and appdata.recl_pairs(prev_cb, prow_cb, [dict(_r("울쎄라 300샷 첫방문", 790000, "첫 방문"), branch="역삼점")]) == {("X14", "A|역삼점")},
   [appdata.recl_pairs(prev_cb, prow_cb, x) for x in (now_cb[:2], [now_cb[0], now_cb[2]], [now_cb[0], _hi])])
_mv = appdata.group_moved(prev_cb, prow_cb, now_cb[:3], [0, 0, 0])
ok("... 자동 묶음: 일반가로 돌아온 가격은 '새로 생김'·'가격 변동'의 근거가 아님(조건부는 원래 묶음 가격이 아님)",
   _mv == {("A|강남점", appdata.G.comp("울쎄라 300샷 1회"), 490000)}, _mv)
_old = dated(mini([("강남점", "리쥬란 2cc", 200000, "일반")]), "2026-10-14")
_new = dated(mini([("강남점", "리쥬란 2cc", 200000, "일반"), ("강남점", "쥬베룩 2cc", 250000, "일반"), ("강남점", "울쎄라 100샷 1회", 190000, "일반")]),
             "2026-10-19")
_c0, _c1 = datameta.changes(_old, _new, "v"), datameta.changes(_old, _new, "v", back={("A", "강남점", "울쎄라 100샷 1회", 190000)})
ok("data-meta.json changes.added: 규칙이 되살린 줄(came_back)은 새 수집이어도 '새로 생김'이 아님, 진짜 새 줄은 그대로",
   [x[2] for x in _c0["added"]] == ["울쎄라 100샷 1회", "쥬베룩 2cc"] and [x[2] for x in _c1["added"]] == ["쥬베룩 2cc"]
   and _c1["counts"] == {"price": 0, "added": 1, "removed": 0, "new_chain": 0}, (_c0["added"], _c1["added"]))
# 끝-끝(검수 2026-10-16): clean.main → appdata.main을 임시 폴더에서 두 번(10-14 수집, 10-19 새 수집). 10-14 빌드는 옛 규칙처럼 마곡점
# '※카카오톡 플러스친구 혜택' 칸의 울쎄라 줄을 안내 문구로 뺐고(issues.csv), 10-19 수집은 그 줄을 이름만으로(새 수집기), 값도 바꿔 가져옴.
# appdata.main이 그 줄을 data-meta.json changes.added에 넣지 않고(진짜 새 줄은 넣음), 마곡점의 첫 X13 줄이라 meta.recl에 넣는지 봄 —
# main()이 datameta.write_meta에 came_back을 넘기지 않으면 이 시험이 실패함
_E_COLS = ["brand", "branch", "category", "group", "option", "sale", "orig", "addon", "until", "url", "fetched_at"]
_e_base = [("강남점", "리프팅", "울쎄라", "울쎄라 100샷 1회", 300000), ("마곡점", "리프팅", "슈링크", "슈링크 유니버스 300샷 1회", 99000)]
_e_back = ("마곡점", "※카카오톡 플러스친구 혜택", "첫방문이벤트", "울쎄라 100샷 1회", 199000)
_e_new = ("강남점", "부스터", "리쥬란", "리쥬란 힐러 2cc 1회", 250000)


def _e_build(tmp, rows, day):
    with open(os.path.join(tmp, "data2", "raw", "drevers.csv"), "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(_E_COLS)
        for br, c, g, o, s in rows:
            wr.writerow(["닥터에버스", br, c, g, o, s, "", "0", "", "https://example.invalid/", f"{day}T06:00:00+09:00"])
    saved = clean.ROOT, clean.RAW, appdata.ROOT, sys.argv
    clean.ROOT, clean.RAW, appdata.ROOT = tmp, os.path.join(tmp, "data2", "raw"), tmp
    sys.argv = ["appdata.py", "--date", day, "--out", os.path.join(tmp, "app", "data.json")]
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            clean.main()
            appdata.main()
    finally:
        clean.ROOT, clean.RAW, appdata.ROOT, sys.argv = saved
    return json.load(open(os.path.join(tmp, "app", "data.json"), encoding="utf-8")), json.load(open(os.path.join(tmp, "app", "data-meta.json"), encoding="utf-8"))


with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "data2", "raw"))
    os.makedirs(os.path.join(tmp, "app"))
    with open(os.path.join(tmp, "data2", "branches.csv"), "w", newline="", encoding="utf-8") as f:
        f.write("brand,branch,address,lat,lng\n")
    _e_prev, _ = _e_build(tmp, _e_base, "2026-10-14")
    with open(os.path.join(tmp, "data2", "issues.csv"), "a", newline="", encoding="utf-8-sig") as f:   # what the old rule dropped
        csv.writer(f).writerow(["제외", "안내 문구(가격 아님)", "닥터에버스", "마곡점", _e_back[1], _e_back[2], f"{_e_back[1]} {_e_back[3]}", 189000, "",
                                "https://example.invalid/"])
    _e_cur, _e_meta = _e_build(tmp, _e_base + [_e_back, _e_new], "2026-10-19")
_e_added = [(x[1], x[3]) for x in _e_meta["changes"]["added"]]
_e_raw = [(x[1], x[3]) for x in datameta.changes(_e_prev, _e_cur, "v")["added"]]       # the same two files, without came_back
_e_recl = dict((d, ks) for d, ks in _e_cur["meta"]["recl"])
ok("끝-끝 clean.main → appdata.main: 규칙이 되살린 줄(값이 바뀐 것도)은 data-meta.json changes.added에 없고 진짜 새 줄만 있음, "
   "마곡점의 첫 X13 줄이라 meta.recl(10-19)에 X13",
   _e_added == [("강남점", 250000)] and _e_meta["changes"]["counts"]["added"] == 1 and sorted(_e_raw) == [("강남점", 250000), ("마곡점", 199000)]
   and "X13" in _e_recl.get("2026-10-19", []) and len(datameta.rows_of(_e_cur)) == 4,
   (_e_added, _e_raw, _e_cur["meta"]["recl"], len(datameta.rows_of(_e_cur))))
import homedata  # noqa: E402
_hd = {"s": ["", "A", "강남점", "리쥬란 2cc", "평일 낮", "X24", "11:00-16:00", "리쥬란 힐러 2cc"], "keys": [["X24", "스킨부스터", "리쥬란 힐러 2cc"]],
       "meta": {"fam": [], "brands": [["A"]], "updated": "2026-10-16"}, "branches": [[0, 2, 0, None, None, 0, 0, 0, 0, 3]], "colDelta": [2], "groups": [],
       "cols": [[0, 0], [2, 2], [3, -3], [199000, 190000], [0, 0], [0, 0], [4, 0], [5, 5], [1, 1], [-1, -1], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0],
                [14, 0], [6, 0]]}
_h18 = homedata.build(_hd)
_r18 = homedata.rows_of(_h18)
_h16 = homedata.build(dict(_hd, cols=_hd["cols"][:16]))
ok("home.json: days는 그대로, hours는 글자표(s)를 다시 만들어도 같은 글자 — 16칸짜리 옛 data.json도 그대로 됨",
   [(r[16], _h18["s"][r[17]]) for r in _r18] == [(14, "11:00-16:00"), (0, "")] and {len(r) for r in homedata.rows_of(_h16)} == {16},
   [(r[16], _h18["s"][r[17]]) for r in _r18])
ok("appdata.ROW_FIELDS = 18(days·hours를 더함), home.json의 글자 칸에 hours(17)", appdata.ROW_FIELDS == 18 and 17 in homedata.STR_FIELDS)
# 칸이 정하는 가격 종류(C, 2026-10-16, clean.section_kind): 옵션에 아무 말이 없어도 '1회 체험'·'체험가' 칸의 한 회 가격은 체험가, '재방문
# 이벤트' 칸은 한정가(새 태그 없음 — 사용자 결정). 읽는 칸: 묶음 제목, 그리고 사이트 칸(유앤아이는 짝이 틀려서, 밴스는 '1회 체험가' 메뉴에
# 가격표 카드도 섞여서 빼고). 옵션 제 글이 먼저, 여러 회·기간 묶음은 체험가 아님, 같은 가격이 칸 없는 페이지에도 있으면 일반.
_th = {"1회 체험가": True, "★1회체험가★": True, "체험가이벤트": True, "언제나 가능한 1회 체험 이벤트": True, "💚10월 바디1회체험&패키지💚": True,
       "피부관리 체험가 택 1 시술안내": True, "[1회 체험 초특가]": True, "첫체험 EVENT · 리프팅": True, "1회 체험 쿠폰": True, "평일 1회체험 특가": True,
       "★보톡스 이벤트★ 이벤트 내용은 원장님 지정 불가 / 1인 1회 체험가 시술안내": True, "체험 후기": False, "1회 체험 후기": False,
       "체험단 모집": False, "수입 레이저 체험전": False, "체험 가능": False, "11회 체험": False, "체험관": False, "아쿠아필 1회": False,
       "[첫방문 이벤트] *처음 내원하시는 고객님들을 위한 특가* *1회체험가와 중복 적용가능*": False}
ok(f"trial_head 낱말 {len(_th)}개: '1회 체험'·'첫체험'·'체험가'·'체험 이벤트/초특가/쿠폰'은 체험가 칸, '체험 후기'·'체험단'·'체험 가능'·'체험전'·"
   "'…1회체험가와 중복 적용가능'(다른 행사 이야기)은 아님", all(clean.trial_head(clean.norm_text(t)) == w for t, w in _th.items()),
   [t for t, w in _th.items() if clean.trial_head(clean.norm_text(t)) != w])
_rt = {"재방문 이벤트": True, "[재방문 이벤트 ] ★재방문 이벤트★ 물톡스 1회": True, "(재진고객한정)": True, "재내원 고객 특가": True,
       "기존 고객 전용": True, "재구매 고객": True, "첫방문 이벤트 (초진/재진 모두가능, 조기종료될 수 있음)": False, "인모드FX 1부위 (초재진가능)": False,
       "재진도 초진도": False, "[카톡플친대상/초진재진1회체험] 골드테라피": False, "[EVENT] (초진/재진SNS등록시)슈링크 300샷 이벤트": False,
       "기존 고객 감사 이벤트": False, "재진행 예정": False, "리터치 포함": False}
ok(f"returning 낱말 {len(_rt)}개: '재방문'·'재내원'·'기존 고객'·'재구매'·'재진고객한정'은 다시 오는 손님 가격, 옆에 초진이 있으면('초진/재진'·"
   "'초재진'·'재진도 초진도') 누구나, '기존 고객 감사'·'재진행'은 아님", all(clean.returning(t) == w for t, w in _rt.items()),
   [t for t, w in _rt.items() if clean.returning(t) != w])
_ov = {"비타민관리": True, "피코토닝 10+10": False, "피코토닝+모델링팩+진정관리 10+10": False, "피코토닝10+10(피부관리포함)": False,
       "피코토닝 10+10회": False, "피코토닝 2+1회": False, "내맘대로 피부관리 5회 패키지": False, "베이직 퀵 슬림바디 3주": False,
       "수입 주름 보톡스 3+1부위": True, "써마지 FLX 300+300샷": True, "영국산 얼굴 전체 스킨 보톡스 3+1 4cc": True,
       "독일산 주름보톡스 3+1(4부위)": True, "바디보톡스 국산 100+100 유닛": True, "국산 목주름 보톡스 1+1줄": True, "피코토닝 1+1회": True,
       "얼굴 점제거(2mm이하/개당, 개수 무제한)": True, "여드름ㅣ모공ㅣ흉터 무제한 염증주사 1회": True, "입술필러 무제한 (입꼬리 포함)": False,
       "여성 팔 전체 제모 1년 무제한": False, "무제한 1회 이용권": False}
ok(f"one_visit {len(_ov)}개: 한 회('3+1부위'·'300+300샷'·'3+1 4cc'·'1+1줄'은 한 번에 받는 양), '1+1회'(첫 회+1회), 개수 무제한 한 번은 체험가 칸의 "
   "한 회, '10+10'(회 없음)·'10+10회'·'2+1회'·5회 패키지·3주·'1년 무제한'·이용권·'입술필러 무제한'은 아님",
   all(clean.one_visit(n) == w for n, w in _ov.items()), [n for n, w in _ov.items() if clean.one_visit(n) != w])
_ln = [("피부스케일링", "스케일링 1회", True), ("미희주사 눈밑 1회", "THE 미희주사 눈밑 1회", True), ("블랙헤드관리(나비존)", "블랙헤드 관리(나비존) 1회", True),
       ("편평사마귀 제거 1개당", "편평사마귀제거", True), ("수입 독일산 주름 보톡스 1회", "주름보톡스 (국산)", False),
       ("수입 주름 보톡스 1부위", "주름보톡스 1부위 국산프리미엄", False), ("Theraphy 관리", "rapy 관리", False)]
ok("loose_name: 띄어쓰기·괄호·'1회'·'THE'만 떼고 한쪽이 다른 쪽 안에 들어가는지('국산'·'수입'은 그대로)",
   all(((lambda x, y: x in y or y in x)(clean.loose_name(a), clean.loose_name(b))) == w for a, b, w in _ln),
   [(a, b, clean.loose_name(a), clean.loose_name(b)) for a, b, w in _ln if ((lambda x, y: x in y or y in x)(clean.loose_name(a), clean.loose_name(b))) != w])
_sk = [("밴스", "피부관리 체험가 택 1 시술안내", "1회 체험가", "비타민관리", "체험가"),
       ("밴스", "피부관리 체험가 택 1 시술안내", "1회 체험가", "내맘대로피부관리 프리미엄 5회 패키지", ""),
       ("밴스", "★1회체험가★ ★1회체험가★", "★1회체험가★", "피코토닝 10+10회", ""),
       ("밴스", "부위별 필러 시술안내", "1회 체험가", "눈밑필러 한쪽", ""),
       ("쁨", "", "1회 체험가", "쥬베룩 볼륨 1cc", "체험가"),
       ("셀린", "💚10월 바디1회체험&패키지💚", "", "바디인모드FX(1부위) 1회 (#양쪽손바닥크기)", "체험가"),
       ("셀린", "💚10월 바디1회체험&패키지💚", "", "베이직 퀵 슬림바디 3주", ""),
       ("유앤아이", "1회 체험가", "다이어트/활력주사", "리바이브 1cc", "체험가"),
       ("유앤아이", "첫방문 체험가 · 리쥬란 힐러", "첫방문 체험가", "리쥬란 힐러 2cc", ""),
       ("유앤아이", "레이저토닝", "🎉1회 체험가 이벤트", "레이저토닝 1회", ""),
       ("닥터에버스", "체험가이벤트", "스킨부스터", "스킨부스터 리쥬란아이 1cc 1회", "체험가"),
       ("쁨", "재방문 이벤트", "보톡스/윤곽주사", "국산 얼굴전체 스킨보톡스", "한정가"),
       ("밴스", "첫방문 이벤트 (초진/재진 모두가능, 조기종료될 수 있음)", "첫방문 이벤트", "아쿠아필 1회", ""),
       ("블리비", "수입 레이저 체험전", "기획전", "엑셀V 레이저(색소/홍조 모드) - 얼굴전체", ""),
       ("밴스", "★바디토닝 이벤트★ 이벤트 내용은 원장님 지정 불가 / 1인 1회 체험가 시술안내", "수량한정 1회체험가", "피코토닝 10+10", ""),
       ("밴스", "★1회체험가★ ★1회체험가★", "★1회체험가★", "피코토닝 1+1회", "체험가"),
       ("닥터에버스", "체험가이벤트", "여드름ㅣ모공ㅣ흉터", "여드름ㅣ모공ㅣ흉터 무제한 염증주사 1회", "체험가")]
ok("section_kind: 묶음 제목·칸의 체험가 칸은 한 회 가격만 체험가(5회 패키지·10+10회·3주 코스는 아님), 밴스 '1회 체험가' 메뉴·유앤아이 탭(묶음 제목 앞에 "
   "붙은 탭 이름도)은 안 읽음, '재방문 이벤트'는 한정가",
   all(clean.section_kind(b, clean.norm_text(g), clean.norm_text(c), m) == w for b, g, c, m, w in _sk),
   [(b, g, m, clean.section_kind(b, clean.norm_text(g), clean.norm_text(c), m)) for b, g, c, m, w in _sk
    if clean.section_kind(b, clean.norm_text(g), clean.norm_text(c), m) != w])
_raw_k = [("drevers", "닥터에버스", "부산서면점", "스킨부스터", "체험가이벤트", "스킨부스터 리쥬란아이 1cc 1회", 89000),
          ("drevers", "닥터에버스", "홍대점", "피부레이저", "언제나 가능한 1회 체험 이벤트", "제네시스레이저 1회", 29000),
          ("vands", "밴스", "강남", "1회 체험가", "피부관리 체험가 택 1 시술안내", "아쿠아필 2단계 (1회 체험가)", 4900),
          ("vands", "밴스", "강남", "1회 체험가", "피부관리 체험가 택 1 시술안내", "비타민관리", 9900),
          ("vands", "밴스", "부산", "1회 체험가", "피부관리 체험가 택 1 시술안내", "내 맘대로 피부관리 5회 패키지", 119000),
          # 밴스 '1회 체험가' 메뉴의 가격표 카드(강남·구로점 '부위별 필러'는 필러/실리프팅 메뉴와 같은 가격): 일반 그대로
          ("vands", "밴스", "강남", "1회 체험가", "부위별 필러 시술안내", "눈밑필러 한쪽", 49000),
          # 같은 가격이 칸 없는 페이지에도: 일반(체험가 칸이 먼저 나오든 나중에 나오든)
          ("vands", "밴스", "동탄", "1회 체험가", "프리미엄 피부관리 체험가 시술안내", "신데렐라주사", 40000),
          ("vands", "밴스", "동탄", "수액", "신데렐라주사 시술안내", "신데렐라주사", 40000),
          ("vands", "밴스", "동탄", "스킨케어", "프리미엄 피부관리 시술안내", "블랙필", 49000),
          ("vands", "밴스", "동탄", "1회 체험가", "프리미엄 피부관리 체험가 시술안내", "블랙필", 49000),
          # 두 페이지 모두 체험가 칸: 체험가
          ("vands", "밴스", "시흥", "1회 체험가", "피부관리 체험가 택 1 시술안내", "이온자임", 9900),
          ("vands", "밴스", "시흥", "이달의 이벤트", "♥10월 체험가 모음zip♥ 1회체험가 BEST 모음", "이온자임", 9900),
          ("vands", "밴스", "신사", "첫방문 이벤트", "[첫방문 이벤트] *처음 내원하시는 고객님들을 위한 특가* *1회체험가와 중복 적용가능*", "아쿠아필 2단계", 9900),
          ("vands", "밴스", "구로", "첫방문 이벤트", "첫방문 이벤트 (초진/재진 모두가능, 조기종료될 수 있음)", "인모드 FX 1부위", 19000),
          ("vands", "밴스", "신사", "1회 체험가", "리프팅 1회체험가 시술안내", "세르프 300샷 + LDM관리 6분 + LED + 시트팩 (재진고객한정)", 990000),
          ("ppeum", "쁨", "천안점", "보톡스/윤곽주사", "재방문 이벤트", "[재방문 이벤트 ] ★재방문 이벤트★ 국산 얼굴전체 스킨보톡스", 99000),
          ("ppeum", "쁨", "천안점", "스킨부스터", "재방문 이벤트", "쥬베룩 볼륨 8cc 1회", 590000),
          ("ppeum", "쁨", "안산점", "1회 체험가", "", "쥬베룩 볼륨 1cc", 49000),
          ("uandi", "유앤아이", "화성봉담점", "다이어트/활력주사", "1회 체험가", "[수분 + 탄력 + 광채 올인원 피부 컨디션 UP!] 리바이브 1cc", 350000),
          ("uandi", "유앤아이", "경기광주점", "첫방문 체험가", "첫방문 체험가 · 지방분해주사", "바디 아쎄라 20cc 1회", 100000),
          ("uandi", "유앤아이", "강남점", "🎉1회 체험가 이벤트", "레이저토닝", "레이저토닝 1회", 9900),
          ("cellin", "셀린", "노원점", "", "💚10월 바디1회체험&패키지💚", "베이직 퀵 슬림바디 3주", 590000),
          ("cellin", "셀린", "노원점", "", "💚10월 바디1회체험&패키지💚", "바디인모드FX(1부위) 1회 (#양쪽손바닥크기)", 110000),
          ("velyb", "블리비", "강남역점", "기획전", "수입 레이저 체험전", "엑셀V 레이저(색소/홍조 모드) - 얼굴전체", 79000),
          # 체험가 카드가 가격표 카드를 이름만 조금 바꿔 되풀이(같은 지점·같은 판매가·loose_name): 일반. 성별이 다르거나 값이 다르면 체험가 그대로
          ("vands", "밴스", "동탄", "1회 체험가", "피부관리 체험가 시술안내", "피부스케일링", 39000),
          ("vands", "밴스", "동탄", "스킨케어", "베이직 피부관리 시술안내", "스케일링 1회", 39000),
          ("vands", "밴스", "이태원", "★1회체험가★", "★1회체험가★", "남성 다리 전체 제모(발등+발가락 포함)", 99000),
          ("vands", "밴스", "이태원", "여성제모", "아포지플러스 여성제모 아포지플러스로 확실한 제모효과! 시술안내", "다리 전체 제모 1회", 99000),
          ("vands", "밴스", "부산해운대", "이달의 이벤트", "미백/기미/홍조/색소 레이저 체험가", "카프리 레이저 1회", 95000),
          ("vands", "밴스", "부산해운대", "색소레이저", "카프리레이저", "카프리레이저", 99000),
          ("vands", "밴스", "시흥", "1회 체험가", "피부관리 체험가 택 1 시술안내", "피코토닝 1회", 9900),
          ("vands", "밴스", "시흥", "레이저토닝", "피코토닝 시술안내", "피코토닝 10회", 9900),
          ("vands", "밴스", "천안", "1회 체험가", "[1회 체험가 초특가]", "얼굴 점제거(2mm이하/개당, 개수 무제한)", 100),
          ("vands", "밴스", "천안", "여드름치료/점제거", "점제거/비립종제거 시술안내", "점제거 (2mm이하)", 100),
          ("vands", "밴스", "양산", "1회 체험가", "[1회 체험 초특가]", "얼굴 점제거(2mm이하/개당, 개수 무제한)", 100),
          # '1+1회'는 체험가(회수 2 그대로), 회 없는 '10+10'은 여러 회 묶음
          ("vands", "밴스", "이태원", "★1회체험가★", "★1회체험가★", "피코토닝 1+1회", 9900),
          ("vands", "밴스", "광주", "수량한정 1회체험가", "★바디토닝 이벤트★ 이벤트 내용은 원장님 지정 불가 / 1인 1회 체험가 시술안내", "피코토닝 10+10", 650000)]
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "data2", "raw"))
    for key in sorted({x[0] for x in _raw_k}):
        with open(os.path.join(tmp, "data2", "raw", f"{key}.csv"), "w", newline="", encoding="utf-8") as f:
            wr = csv.writer(f)
            wr.writerow(["brand", "branch", "category", "group", "option", "sale", "orig", "addon", "until", "url", "fetched_at"])
            for k, b, br, c, g, o, s in _raw_k:
                if k == key:
                    wr.writerow([b, br, c, g, o, s, "", "0", "", "https://example.invalid/", "2026-10-16T06:00:00+09:00"])
    root, rawdir = clean.ROOT, clean.RAW
    clean.ROOT, clean.RAW = tmp, os.path.join(tmp, "data2", "raw")
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            clean.main()
    finally:
        clean.ROOT, clean.RAW = root, rawdir
    _rows_k = list(csv.DictReader(open(os.path.join(tmp, "data2", "clean.csv"), encoding="utf-8")))
_ck = {(r["branch"], r["option"]): (r["kind"], r["tags"], r["sess"], appdata.G.regular(r)) for r in _rows_k}
_want_k = {("부산서면점", "스킨부스터 리쥬란아이 1cc 1회"): ("체험가", "", "1", False), ("홍대점", "피부레이저 제네시스레이저 1회"): ("체험가", "", "1", False),
           ("강남", "아쿠아필 2단계 (1회 체험가)"): ("체험가", "", "1", False), ("강남", "비타민관리"): ("체험가", "", "1", False),
           ("부산", "내 맘대로 피부관리 5회 패키지"): ("일반", "", "5", True), ("강남", "눈밑필러 한쪽"): ("일반", "", "1", True),
           ("동탄", "신데렐라주사"): ("일반", "", "1", True), ("동탄", "블랙필"): ("일반", "", "1", True), ("시흥", "이온자임"): ("체험가", "", "1", False),
           ("신사", "아쿠아필 2단계"): ("일반", "첫 방문", "1", False), ("구로", "인모드 FX 1부위"): ("일반", "첫 방문", "1", False),
           ("신사", "세르프 300샷 + LDM관리 6분 + LED + 시트팩 (재진고객한정)"): ("한정가", "", "1", False),
           ("천안점", "[재방문 이벤트 ] ★재방문 이벤트★ 국산 얼굴전체 스킨보톡스"): ("한정가", "", "1", False),
           ("천안점", "쥬베룩 볼륨 8cc 1회"): ("한정가", "", "1", False), ("안산점", "쥬베룩 볼륨 1cc"): ("체험가", "", "1", False),
           ("화성봉담점", "[수분 + 탄력 + 광채 올인원 피부 컨디션 UP!] 리바이브 1cc"): ("체험가", "", "1", False),
           ("경기광주점", "바디 아쎄라 20cc 1회"): ("일반", "첫 방문", "1", False), ("강남점", "레이저토닝 1회"): ("일반", "", "1", True),
           ("노원점", "베이직 퀵 슬림바디 3주"): ("일반", "", "1", True), ("노원점", "바디인모드FX(1부위) 1회 (#양쪽손바닥크기)"): ("체험가", "", "1", False),
           ("강남역점", "엑셀V 레이저(색소/홍조 모드) - 얼굴전체"): ("일반", "", "1", True),
           ("동탄", "피부스케일링"): ("일반", "", "1", True), ("동탄", "스케일링 1회"): ("일반", "", "1", True),
           ("이태원", "남성 다리 전체 제모(발등+발가락 포함)"): ("체험가", "", "1", False), ("이태원", "다리 전체 제모 1회"): ("일반", "", "1", True),
           ("부산해운대", "카프리 레이저 1회"): ("체험가", "", "1", False), ("부산해운대", "카프리레이저"): ("일반", "", "1", True),
           ("시흥", "피코토닝 1회"): ("체험가", "", "1", False), ("시흥", "피코토닝 10회"): ("일반", "", "10", True),
           ("천안", "얼굴 점제거(2mm이하/개당, 개수 무제한)"): ("일반", "", "99", True), ("천안", "점제거 (2mm이하)"): ("일반", "", "1", True),
           ("양산", "얼굴 점제거(2mm이하/개당, 개수 무제한)"): ("체험가", "", "99", False),
           ("이태원", "피코토닝 1+1회"): ("체험가", "", "2", False), ("광주", "피코토닝 10+10"): ("일반", "1인 1회", "1", False)}
ok("clean.csv: 체험가 칸(닥터에버스 '체험가이벤트'·'언제나 가능한 1회 체험 이벤트', 밴스 '피부관리 체험가 택 1', 쁨 '1회 체험가' 칸, 유앤아이 묶음 제목 "
   "'1회 체험가', 셀린 '바디1회체험&패키지'의 1회)의 한 회 가격은 체험가, 5회 패키지·3주 코스·밴스 메뉴만·유앤아이 탭·'체험전'은 일반, 같은 가격이 칸 "
   "없는 페이지에도 있으면 일반(두 페이지 모두 체험가 칸이면 체험가), 이름이 조금 다른 같은 지점·같은 값의 가격표 줄이 있어도 일반(성별·값·회수가 다르면 아님), "
   "'1+1회'는 체험가·회 없는 '10+10'은 아님, 쁨 천안점 '재방문 이벤트'는 한정가, '초진/재진 모두가능'은 아님, 회수는 그대로",
   _ck == _want_k, {k: (v, _ck.get(k)) for k, v in _want_k.items() if _ck.get(k) != v} or sorted(set(_ck) - set(_want_k)))

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
# meta.reclGroups in the data that ships (2026-10-16; a data.json built before has none — the next factory build adds it): format and
# consistency only — achg was filtered by these same prices in the build that wrote them, so this cannot catch a build that forgot
# what an earlier one moved (검토 2026-10-16). That is the unit tests' job above (achg_moved · group_memory · still_listed)
if "reclGroups" in D["meta"]:
    _rg, _a = D["meta"]["reclGroups"], D["achg"]
    _bk = [f"{D['meta']['brands'][b[0]][0]}|{D['s'][b[1]]}" for b in D["branches"]]
    _gk = [xkeys.comp(D["s"][g[0]]) for g in D["groups"]]
    _ok = len(_rg) == 3 and _rg[0] == D["meta"]["updated"] and _rg[1] == _a.get("prev") and all(
        isinstance(k, str) and isinstance(b, int) and 0 <= b < len(_bk) and isinstance(p, int) for k, b, p in _rg[2])
    _mv = {(_bk[b], k, p) for k, b, p in _rg[2]} if _ok else set()
    _hit = ([c for c in _a["chg"] if (_bk[c[1]], _gk[c[0]], c[2]) in _mv or (_bk[c[1]], _gk[c[0]], c[3]) in _mv]
            + [c for c in _a["new"] if (_bk[c[1]], _gk[c[0]], c[2]) in _mv]
            + [c for c in _a["gone"] if (_bk[c[1]], xkeys.comp(D["s"][c[0]]), c[2]) in _mv])
    ok(f"app/data.json meta.reclGroups: 수집 {_rg[0] if _rg else '-'} · 기준 {_rg[1] if len(_rg) > 1 else '-'} · 규칙이 옮긴 가격 {len(_mv)}개 — "
       "형식·일관성(같은 수집·같은 기준, achg에 그 가격의 항목 없음)", _ok and not _hit, _hit[:5])
else:
    print("INFO | app/data.json에 meta.reclGroups 없음(이 칸 전 빌드) — 다음 공장 빌드에서 더해짐")
# days·hours in the data that ships: 18 fields; a data.json built before 2026-10-16 has 16 (the next factory build adds them)
if len(D["cols"]) >= 18:
    _days, _hrs = D["cols"][16], [D["s"][i] for i in D["cols"][17]]
    ok(f"app/data.json days·hours: 요일 칸 {sum(1 for d in _days if d):,}줄 · 시간 칸 {sum(1 for h in _hrs if h):,}줄 모두 형식대로",
       all(isinstance(d, int) and 0 <= d < 127 for d in _days) and all(h == "" or (h != clean.ALL_HOURS and re.fullmatch(r"([01]\d|2[0-4]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d", h)) for h in _hrs))
else:
    print(f"INFO | app/data.json은 {len(D['cols'])}칸(요일·시간 칸 전) — 다음 공장 빌드에서 days·hours가 더해짐")
cp = os.path.join(ROOT, "data2", "clean.csv")
if os.path.exists(cp):
    _cr = list(csv.DictReader(open(cp, encoding="utf-8")))
    if _cr and "days" in _cr[0]:
        # '평일 낮' rows whose days (화/수/목, 월~목 …, not just 평일) stand only in the group title — 501 on 2026-10-16, read as 월~금
        _g = [r for r in _cr if "평일 낮" in r["tags"].split("·") and clean.visit_days(r["group"]) not in (0, 31) and not clean.visit_days(r["name"])]
        ok(f"data2/clean.csv: 요일이 묶음 제목에만 있는 '평일 낮' {len(_g)}줄 모두 요일 칸이 있음", _g and all(int(r["days"]) for r in _g),
           [(r["group"], r["name"]) for r in _g if not int(r["days"])][:5])
        # C1 시간(2026-10-16): 태그와 요일·시간 칸이 서로 맞음 — 시간 칸이 있으면 시간 태그가 있고, '시간대'에는 평일만의 요일이
        # 없고, '평일 낮'에는 주말 요일이 없음
        _tt = lambda r: set(r["tags"].split("·"))
        _x = [(r["brand"], r["option"][:30], r["days"], r["hours"], r["tags"]) for r in _cr
              if (r["hours"] and not _tt(r) & {"평일 낮", "시간대"})
              or ("시간대" in _tt(r) and int(r["days"]) and not int(r["days"]) & clean.WEEKEND)
              or ("평일 낮" in _tt(r) and int(r["days"]) & clean.WEEKEND) or {"평일 낮", "시간대"} <= _tt(r)]
        _n = sum(1 for r in _cr if "시간대" in _tt(r))
        ok(f"data2/clean.csv: 시간 칸이 있는 {sum(1 for r in _cr if r['hours']):,}줄 모두 시간 태그, '시간대' {_n}줄·'평일 낮'의 요일 칸이 태그와 맞음",
           not _x, _x[:5])

print(f"{'FAIL: ' + str(len(fails)) + ' failing' if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
