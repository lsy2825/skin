"""Raw scraper output (data2/raw/*.csv) -> one clean, brand-neutral table (data2/clean.csv) + checks (data2/issues.csv).

usage: python build2/clean.py
Rules (each dropped or changed row is listed in issues.csv with the reason):
  drop   price missing/0 · option empty · notes (※, ▶) · paperwork fees (진단서·소견서·제증명·수수료) · price > 5천만원
         · event already over (until = YYYY-MM-DD before today, KST)
  fix    list price below the sale price, or 10x+ the sale price -> list price removed (typo on the site)
  dedupe the same (brand, branch, option, sale, list) shown on several pages of one branch -> kept once
         (a category page wins over the 기획전 page, so the row keeps its real category)
Columns added: kind (체험가 · 한정가 · 구독권 · 일반 · 고시가), cat (common category), name (display name),
mname (name used for matching), sess (sessions), tags (conditions such as 평일 낮 · 일요일 · 첫 방문), keys (matched comparison ids),
vat (포함 / 별도 / '' unknown: from the row's own wording, else the brand default in data2/vat_policy.json — set only with
evidence from the site, see data2/sources.json).
"""
import csv, datetime, json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
from xkeys import X, match, ONCE, sessions  # noqa: E402
import taxonomy  # noqa: E402

RAW = os.path.join(ROOT, "data2", "raw")
TODAY = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
VAT_IN = re.compile(r"(부가세|부가가치세|VAT)[^가-힣A-Za-z]{0,6}(\d{1,2}\s*%\s*)?(포함)", re.I)
VAT_EX = re.compile(r"(부가세|부가가치세|VAT)[^가-힣A-Za-z]{0,6}(\d{1,2}\s*%\s*)?(별도|미포함)", re.I)
VAT_POLICY = os.path.join(ROOT, "data2", "vat_policy.json")


def vat_policy():
    if not os.path.exists(VAT_POLICY):
        return {}
    return {b: v.get("default", "") for b, v in json.load(open(VAT_POLICY, encoding="utf-8")).items() if not b.startswith("_")}
BRANDS = [("velyb", "블리비"), ("ppeum", "쁨"), ("toxnfill", "톡스앤필"), ("lienjang", "리엔장"), ("forever", "포에버"),
          ("vands", "밴스"), ("uandi", "유앤아이"), ("daybeau", "데이뷰"), ("drevers", "닥터에버스"), ("cellin", "셀린")]

PAPER = re.compile(r"진단서|소견서|제증명|증명서|수수료|사본|발급")
NOTE = re.compile(r"^[※▶▷★▼■●◆]|참조|참고하세요|가격표")
SUBS = re.compile(r"구독권|이용권|멤버십|정기권")
PROC = re.compile(r"톡신|톡스|보톡스|필러|벨로테로|쥬비덤|레스틸렌|슈링크|울쎄라|써마지|인모드|온다|올리지오|볼뉴머|티타늄|리쥬란|쥬베룩|"
                  r"토닝|제네시스|아쿠아필|포텐자|제모|주사|점|레이저|리프팅|필링|관리|부스터|스킨|윤곽|실|엑소좀|물광")
CATS = [  # first match wins; tested on category + group + option
    ("제모", r"제모|겨드랑이.*(1회|5회)|브라질리언"),
    ("스킨부스터", r"리쥬란|쥬베룩|스킨부스터|엑소좀|물광|PN|스킨바이브|고우리|리투오|셀르디엠|볼라이트|프로파일로|연어|샤넬주사|힐러"),
    ("리프팅", r"슈링크|울쎄라|써마지|인모드|온다|올리지오|티타늄|볼뉴머|리프팅|텐써마|텐쎄라|덴서티|엑셀브이|소프웨이브|리니어지"),
    ("보톡스·필러", r"톡신|톡스|보톡스|보툴|필러|벨로테로|쥬비덤|레스틸렌|윤곽주사|실리프팅|민트실|코그|스컬트라|쁘띠"),
    ("바디", r"바디|비만|지방|다이어트|셀룰|체형|복부|팔뚝|허벅지|종아리"),
    ("피부·레이저", r"토닝|레이저|제네시스|포텐자|여드름|필링|점|아쿠아필|모공|기미|색소|홍조|흉터|피부|관리|스킨"),
]
TAGS = [("평일 낮", r"프라임\s*타임|평일\s*(낮|오전|오후)|낮\s*시간|\d+시\s*이전"), ("일요일", r"일요일|썬데이|선데이"),
        ("타임세일", r"타임\s*세일"), ("첫 방문", r"첫\s*방문|신규|웰컴|첫\s*시술|첫\s*구매"), ("1인 1회", r"1인\s*1회|1인당\s*1회")]
EMOJI = re.compile(r"[♥️❤♡]+")


def norm_text(s):
    s = EMOJI.sub("♥", s or "")
    s = re.sub(r"♥\s*([^♥]{1,12})\s*♥", r"[\1] ", s)          # ♥메가세일♥ -> [메가세일]
    s = re.sub(r"◆\s*([^◆]{1,12})\s*◆", r"[\1] ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\(\s+", "(", s)
    s = re.sub(r"\s+\)", ")", s)
    return s


KEEP_LABEL = re.compile(r"국산|수입|독일|미국|대표원장|원장|남|여|PKG|패키지|\d")


def strip_event_prefix(s):
    """Drop leading event labels that only name a sale: '[메가세일] 주름보톡스' / '[EVENT] 벨라콜린 1cc' /
    '[브랜드 10주년 기념, 무한 페스타] 염증주사 1개' -> the procedure name. Labels that describe the product
    ('[대표원장]', '[국산]', '[남성]') stay."""
    while True:
        m = re.match(r"^\[([^\]]+)\]\s*(.+)$", s)
        if not m or KEEP_LABEL.search(m.group(1)):
            return s
        s = m.group(2)


def price(x):
    """'99000' / '99000.0' / '99,000' -> 99000; empty or junk -> 0"""
    try:
        return int(round(float(str(x or "").replace(",", ""))))
    except ValueError:
        return 0


def load():
    rows = []
    for key, brand in BRANDS:
        p = os.path.join(RAW, f"{key}.csv")
        if os.path.exists(p):
            rows += list(csv.DictReader(open(p, encoding="utf-8")))
    return rows


def main():
    raw = load()
    vdef = vat_policy()
    issues, out, seen = [], [], {}
    for r in raw:
        opt, grp = norm_text(r["option"]), norm_text(r["group"])
        sale, orig = price(r["sale"]), price(r["orig"])
        why = None
        if not opt:
            why = "옵션 이름 없음"
        elif not sale:
            why = "가격 없음(0원)"
        elif NOTE.search(opt):
            why = "안내 문구(가격 아님)"
        elif PAPER.search(opt) or PAPER.search(grp):
            why = "서류 발급비(시술 아님)"
        elif sale > 50_000_000:
            why = "가격 비정상(5천만원 초과)"
        elif ISO.match(r.get("until") or "") and r["until"] < TODAY:
            why = f"이벤트 기간 지남({r['until']} 종료)"
        if why:
            issues.append({**r, "action": "제외", "reason": why})
            continue
        if orig and orig < sale:
            issues.append({**r, "action": "정가 삭제", "reason": "정가가 판매가보다 낮음(사이트 표기 오류)"})
            orig = 0
        elif orig and orig >= sale * 10 and sale >= 1000:
            issues.append({**r, "action": "정가 삭제", "reason": "정가가 판매가의 10배 이상(사이트 오기 의심)"})
            orig = 0
        elif orig == sale:
            orig = 0
        name = strip_event_prefix(opt)
        if name == "(대표가)" or not PROC.search(name):
            name = f"{grp} · {name}" if name != "(대표가)" else f"{grp} (최저가부터)"
        mname = name.replace(" · ", " ")
        g = re.search(r"(남성|남자|여성|여자)", grp)
        if g and not re.search(r"남성|남자|여성|여자", mname):
            mname = f"[{g.group(1)}] {mname}"
        text = f"{r['category']} {grp} {opt}"
        if r["brand"] == "리엔장":
            kind = "고시가"
        elif SUBS.search(f"{grp} {opt}"):
            kind = "구독권"
        elif re.search(r"체험", f"{opt}"):
            kind = "체험가"
        elif ONCE.search(opt):
            kind = "한정가"
        else:
            kind = "일반"
        cat = next((c for c, p in CATS if re.search(p, text)), "기타")
        tags = [t for t, p in TAGS if re.search(p, f"{grp} {opt}")]
        if re.search(r"일요일|선데이|썬데이", grp):
            tags.append("일요일")
        row = {"brand": r["brand"], "branch": r["branch"], "src_cat": r["category"], "group": grp, "option": opt,
               "name": name, "mname": mname, "cat": cat, "kind": kind, "sale": sale, "orig": orig or "",
               "addon": r["addon"], "sess": sessions(mname), "tags": "·".join(dict.fromkeys(tags)),
               "until": r["until"], "url": r["url"], "fetched_at": r["fetched_at"],
               "vat": "별도" if VAT_EX.search(f"{grp} {opt}") else "포함" if VAT_IN.search(f"{grp} {opt}") else
                      {"excl": "별도", "incl": "포함"}.get(vdef.get(r["brand"], ""), "")}
        # the same item shown in two events of one branch ('[메가세일] X 체험가' and 'X 체험가', same price) -> one row
        k = (r["brand"], r["branch"], strip_event_prefix(opt), sale, orig)
        if k in seen:
            prev = seen[k]
            if row["tags"] and row["tags"] not in prev["tags"]:
                prev["tags"] = "·".join(dict.fromkeys([t for t in (prev["tags"] + "·" + row["tags"]).split("·") if t]))
            if prev["src_cat"] == "기획전" and r["category"] != "기획전":
                prev.update({"src_cat": r["category"], "cat": cat, "url": r["url"]})
            continue
        seen[k] = row
        out.append(row)
    # comparison keys
    for row in out:
        if row["addon"] == "1" or row["kind"] == "구독권":
            row["keys"] = ""
            continue
        ks = [k[0] for k in X if match(k, row["mname"])]
        row["keys"] = " ".join(ks)
    # variant keys for everything else (build2/taxonomy.py): same family, tags, amount and sessions, sold at 3+ branches
    auto, vkeys, vfams, vstat = taxonomy.build(out)
    for row, k in zip(out, auto):
        if k:
            row["keys"] = (row["keys"] + " " + k).strip()
    json.dump({"keys": vkeys, "families": vfams, "stats": vstat}, open(os.path.join(ROOT, "data2", "variants.json"), "w", encoding="utf-8", newline="\n"),
              ensure_ascii=False, indent=0)
    print(f"variant keys: {vstat['auto_keys']} (+{len(X)} hand-made) · rows with a comparison key {vstat['covered']}/{vstat['rows']}")
    os.makedirs(os.path.join(ROOT, "data2"), exist_ok=True)
    with open(os.path.join(ROOT, "data2", "clean.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    with open(os.path.join(ROOT, "data2", "issues.csv"), "w", newline="", encoding="utf-8-sig") as f:
        fields = ["action", "reason", "brand", "branch", "category", "group", "option", "sale", "orig", "url"]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(issues)
    print(f"raw {len(raw)} -> clean {len(out)} (duplicates folded {len(raw) - len(out) - sum(1 for i in issues if i['action'] == '제외')})")
    print("issues:", dict(Counter(f"{i['action']}: {i['reason']}" for i in issues)))
    print("by brand:", dict(Counter(r["brand"] for r in out)))
    print("by cat:", dict(Counter(r["cat"] for r in out)))
    print("by kind:", dict(Counter(r["kind"] for r in out)))
    cov = defaultdict(lambda: defaultdict(set))
    for r in out:
        for k in r["keys"].split():
            cov[k][r["brand"]].add(r["branch"])
    for k in X:
        print(f"  {k[0]} {k[2][:22]:<24}", " ".join(f"{b}={len(cov[k[0]][b])}" for _, b in BRANDS))


if __name__ == "__main__":
    main()
