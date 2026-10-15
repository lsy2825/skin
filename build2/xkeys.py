#!/usr/bin/env python3
"""Cross-brand comparison keys (같은 시술을 브랜드끼리 맞대어 보기).

Each key names one comparable unit (e.g. '국산 사각턱 보톡스 50U 1회'). A brand's price row matches a key
when its normalized name contains every `need` pattern, none of the `bad` patterns, and the session
count / unit checks pass. 블리비 can instead use the hand-checked benchmark ids from analyze.py (`bench`).

Every regex runs on `comp(name)`: spaces removed, 보톡스/보튤리눔 톡신 → 톡신, unit spellings unified
(50유닛/50unit/50 U → 50U, CC → cc, 100 샷 → 100샷, 10,000J / 10KJ / 1만줄 → 10KJ).
"""
import functools, re

# id, category, label (shown), need (all), bad (any), opts
#   bench: 블리비 benchmark ids (analyze.B) whose prices stand for this key
#   unit: (regex for the unit the key requires, regex for any unit of that kind) → a row that names another
#         unit of the same kind (e.g. 100U for a 50U key) is rejected; a row naming no unit is accepted
#   sess: required number of sessions (default 1)
X = [
    # 톡신
    ("X01", "톡신", "국산 사각턱 보톡스 50U", [r"(사각턱|^턱|[^자갈이중]턱)톡신|턱톡신"], [r"프리미엄|내성|코어|고순도|수입|독일|미국|비건|할랄|제오민|보툴렉스|나보타|침샘|측두|이중턱|자갈턱|턱라인|\+|1\+1|패키지|PKG|pkg|두배|용량업|파워|슬림핏|V핏|리프팅"],
     {"bench": ["P02"], "need_any": [r"(?<![미외영중])국산"], "unit": (r"50U", r"\d+U")}),
    ("X02", "톡신", "국산 주름 보톡스 1부위", [r"주름톡신|한부위톡신|1부위톡신|부위당|택1", r"톡신|톡스"], [r"침샘|귀밑|턱밑|두피|발모|탈모|MTS|연어|프리미엄|내성|코어|고순도|수입|독일|미국|비건|할랄|제오민|보툴렉스|나보타|[2-9]부위|10부위|\+|1\+1|패키지|PKG|목주름|이마전체|이마주름|이마톡신|이마\(|미간전체|눈가전체|얼굴위쪽|위쪽|아래쪽|얼굴전체|턱라인|텐션|특수|모공|스킨|세로|[2-9]회|다한증|[1-9]\d{2}U|풀페이스"],
     {"bench": ["P01"], "need_any": [r"(?<![미외영중])국산"]}),
    ("X03", "톡신", "국산 얼굴전체 스킨보톡스", [r"(얼굴전체|풀페이스|얼굴전체의)", r"(스킨톡신|더모톡신|더마톡신|쁨킨톡신)"], [r"프리미엄|내성|코어|고순도|수입|독일|미국|비건|할랄|제오민|\+|패키지|PKG|목"],
     {"bench": ["P03"], "need_any": [r"(?<![미외영중])국산"]}),
    ("X04", "톡신", "독일산(제오민) 사각턱 보톡스 50U", [r"턱톡신"], [r"침샘|측두|이중턱|자갈턱|턱라인|\+|1\+1|패키지|PKG|^(?!.*독일).*미국|코어|(?<![미외영중])국산"],
     {"bench": ["P07"], "need_any": [r"독일|제오민"], "unit": (r"50U", r"\d+U")}),
    ("X05", "톡신", "독일산(제오민) 주름 보톡스 1부위", [r"주름톡신|한부위톡신|1부위톡신|부위당"], [r"[2-9]부위|\+|1\+1|패키지|PKG|목주름|이마|미간전체|눈가전체|얼굴위쪽|얼굴전체|턱라인|눈밑|텐션|특수|스킨|^(?!.*독일).*미국|(?<![미외영중])국산|코어|콧볼|입꼬리|잇몸|측두|침샘|광대|눈썹|^목|목가로|가로주름|3대|10부위|풀페이스"],
     {"bench": ["P06"], "need_any": [r"독일|제오민"]}),
    ("X06", "톡신", "국산 바디 보톡스 100U", [r"바디톡신"], [r"프리미엄|내성|코어|고순도|수입|독일|미국|비건|할랄|\+|패키지|PKG|다한증"],
     {"bench": ["P04"], "need_any": [r"(?<![미외영중])국산"], "unit": (r"100U", r"\d+U")}),
    ("X07", "톡신", "국산 겨드랑이 다한증 보톡스 50U", [r"다한증"], [r"프리미엄|내성|코어|고순도|수입|독일|미국|비건|할랄|\+|수면|두피|헤어|얼굴|이마|두피|손|발|전두부|두부"],
     {"bench": ["P05"], "need_any": [r"(?<![미외영중])국산"], "unit": (r"50U", r"\d+U")}),
    # 윤곽·필러
    ("X08", "윤곽·필러", "윤곽주사 1회 (3cc 기준)", [r"윤곽주사"], [r"\+|프리미엄|파워|대용량|무제한|이용권|조각|VPL|울트라|패키지|PKG|제로|스테로이드|레드|V윤곽|바디|9cc|6cc|10cc|15cc|30cc|(?<!\d)(?!3ml)\d+ml"],
     {"unit": (r"3cc", r"\d+cc")}),
    ("X09", "윤곽·필러", "국산 필러 1cc", [r"필러"], [r"입술|입꼬리|귀|목주름|애교|눈밑|눈두덩|코|턱끝|이마|주름|흉터|프리미엄|리쥬비엘|채움|\+|패키지|PKG|무제한|4\+1|3\+1|녹이|히알라제|엘프|어깨|골반|힙|손등|수입|쥬비덤|벨로테로|레스틸렌|볼륨|동안|바디|풀페이스"],
     {"bench": ["P10", "P11"], "need_any": [r"국산|아띠에르|뉴라미스|레나필|엘라비에"], "unit": (r"1cc", r"\d+cc")}),
    ("X10", "윤곽·필러", "수입 필러 1cc (벨로테로·쥬비덤·레스틸렌)", [r"필러|벨로테로|쥬비덤|레스틸렌"], [r"입술|입꼬리|귀|귓볼|목주름|애교|눈밑|눈두덩|코|턱끝|이마|주름|흉터|\+|패키지|PKG|무제한|녹이|히알라제|엘프|어깨|골반|힙|손등|(?<![미외영중])국산|키스|볼륨|바디|리바이브|스킨|소프트|Soft|물광|볼벨라|Volbella"],
     {"bench": ["P12", "P13"], "need_any": [r"벨로테로|쥬비덤|레스틸렌"], "unit": (r"1cc", r"\d+cc")}),
    # 리프팅
    ("X11", "리프팅", "슈링크 유니버스 100샷", [r"슈링크", r"100샷"], [r"아이|더마|이중턱|리미티드|V슈링크|부스터|바디|\+|목주름|1000샷|특수|텐쎄라"],
     {"bench": ["L04"]}),
    ("X12", "리프팅", "슈링크 유니버스 300샷", [r"슈링크", r"300샷"], [r"아이|더마|이중턱|리미티드|V슈링크|부스터|바디|\+|목주름|1000샷|3000샷|특수|텐쎄라"],
     {"bench": ["L05"]}),
    ("X13", "리프팅", "울쎄라 100샷 (프라임 포함)", [r"울쎄라", r"100샷"], [r"아이|이중턱|바디|\+|써마지|울써마지|1000샷"],
     {"bench": ["L07", "L09"]}),
    ("X14", "리프팅", "울쎄라 300샷 (프라임 포함)", [r"울쎄라", r"300샷"], [r"아이|이중턱|바디|\+|써마지|울써마지|3000샷"],
     {"bench": ["L08", "L10"]}),
    ("X15", "리프팅", "써마지 FLX 300샷", [r"써마지", r"300샷"], [r"아이|\+|울써마지|울쎄라|바디"],
     {"bench": ["L11"]}),
    ("X16", "리프팅", "써마지 FLX 600샷", [r"써마지", r"600샷"], [r"아이|\+|울써마지|울쎄라|바디"],
     {"bench": ["L12"]}),
    ("X17", "리프팅", "인모드 얼굴전체 1가지 모드", [r"인모드", r"(얼굴전체|풀페이스)"], [r"2가지|듀얼|FX\+FORMA|FORMA\+FX|바디|\+|[2-9]회|이중턱"],
     {"bench": ["L02"]}),
    ("X18", "리프팅", "인모드 얼굴전체 2가지 모드 (FX+FORMA)", [r"인모드", r"(얼굴전체|풀페이스)", r"(2가지|듀얼|FX\+FORMA|FORMA\+FX)"], [r"바디|[2-9]회|슈링크|올리지오|VPL|윤곽|PS"],
     {"bench": ["L03"]}),
    ("X19", "리프팅", "인모드 1부위", [r"인모드", r"1부위|한부위"], [r"바디|\+|[2-9]회|얼굴전체"],
     {"bench": ["L01"]}),
    ("X20", "리프팅", "온다 리프팅 얼굴 10KJ", [r"온다", r"10KJ"], [r"바디|\+|[2-9]회|무제한|이용권|100KJ"],
     {"bench": ["L15"]}),
    ("X21", "리프팅", "올리지오 100샷", [r"올리지오", r"100샷"], [r"아이|\+|바디|1000샷"],
     {"bench": ["L18"]}),
    ("X22", "리프팅", "볼뉴머 100샷", [r"볼뉴머", r"100샷"], [r"아이|\+|바디|1000샷"], {}),
    ("X23", "리프팅", "티타늄 리프팅 40KJ", [r"티타늄", r"40KJ"], [r"\+|[2-9]회|울쎄라|나비존|목"], {}),
    # 부스터
    ("X24", "부스터", "리쥬란힐러 2cc", [r"리쥬란(힐러)?(?<!\d)2cc|리쥬란힐러.*(?<!\d)2cc|리쥬란.*(?<!\d)2cc"], [r"HB|아이|톤업|베이직|리쥬란스킨부스터|입술|[2-9]회|패키지|PKG|PDRN|토닝|\+(?!크라이오|진정)|쥬베룩|셀르디엠|베룩|리쥬하이"],
     {"bench": ["S01"]}),
    ("X25", "부스터", "리쥬란 HB 플러스 1cc", [r"리쥬란HB", r"1cc"], [r"입술|\+|[2-9]회|2cc|아이1cc|[iI]1cc|택\d"],
     {"bench": ["S03"]}),
    ("X26", "부스터", "쥬베룩 스킨 1cc", [r"쥬베룩", r"1cc"], [r"볼륨|아이|\+|1cc\+1cc|[2-9]회|리쥬|2cc|4cc|8cc"],
     {"bench": ["S04"]}),
    ("X27", "부스터", "쥬베룩 볼륨 1cc", [r"쥬베룩볼륨", r"1cc"], [r"아이|\+|1cc\+1cc|[2-9]회|2cc|4cc|8cc"],
     {"bench": ["S05"]}),
    # 피부
    ("X28", "피부", "피코토닝 1회", [r"피코토닝"], [r"프락셀|\+|패키지|PKG|pkg|바디|물광|리쥬란|듀얼|트리플|골드|PHA|겨드랑이|착색|프리미엄|패기지|올인원|기미|프로그램|\d+주(?![가-힣])|문신"], {}),
    ("X29", "피부", "레이저토닝 1회", [r"레이저토닝"], [r"\+|패키지|PKG|바디|듀얼|트리플|골드|겨드랑이|착색|피코|프로그램|\d+주(?![가-힣])"],
     {"bench": ["K02"]}),
    ("X30", "피부", "제네시스 1회", [r"제네시스"], [r"더마v|더마V|\d종|\+|패키지|PKG|바디|듀얼|트리플|토닝\+|피코|프로그램|\d+주(?![가-힣])|에일린|프락셔널"],
     {"bench": ["K04"]}),
    ("X31", "피부", "아쿠아필 1회", [r"아쿠아필"], [r"\+|패키지|PKG|바디|코코|LDM|MTS|피코|모공프락셀|Triple|트리플"], {}),
    ("X32", "피부", "포텐자 1회", [r"포텐자"], [r"\+|패키지|PKG|바디|펌핑|팁$|팁\)|팁값별도|팁별도|팁미포함|일회용팁|팁추가|팁\(|미백|모공소멸|엑소|쥬베룩|여드름패키지|아그네스|다이아|개당|부분|아크네|\d+개|프로그램|\d+주(?![가-힣])|\d{3,}샷"],
     {"bench": ["K07"]}),
    ("X33", "피부", "점 빼기 1개 (2mm 이하)", [r"점제거|점빼기|점,|점/|(?<![가-힣])점1개"], [r"얼굴전체|목전체|무제한|\+|대|中|中|5mm|바디|40개|10개|패키지|문신|흑자|검버섯|올클리어|제거쥐젖|제거비립종|제거사마귀|\d{2,}개|개미만|한관종|돌출"],
     {"bench": ["K01"]}),
    ("X34", "피부", "염증주사 1개", [r"염증주사"], [r"얼굴전체|\+|압출|10회|패키지|PKG|바디|\d+~\d+개|\d+주(?![가-힣])|솔루션|프로그램|사춘기|여드름관리|포함\)"],
     {"bench": ["K10"]}),
    # 제모·바디
    ("X35", "제모·바디", "(여) 겨드랑이 제모 1회", [r"겨드랑이"], [r"남성|남자|\[남|\+(?!인중)|토닝|착색|다한증|[2-9]회|10회|무제한|1년|\(남\)"],
     {"bench": ["H01"], "need_any": [r"제모"]}),
    ("X36", "제모·바디", "바디 인모드 1부위", [r"바디인모드"], [r"\+|[2-9]회|패키지|20분|10분"],
     {"bench": ["O03"], "unit": (r"1부위", r"\d+부위")}),
]

ADDON = re.compile(r"\s*\+\s*(진정관리|크라이오셀|크라이오|촉촉팩|LED\(5분\)|LED|모델링팩|모델링|재생관리|수분팩|수분관리|진정팩|미백관리|비타민관리|(?:LDM|ldm)\s*\d*분?|맞춤관리)(\s*\d+회)?", re.I)


@functools.lru_cache(maxsize=1 << 19)     # match() asks for the same name once per hand-made key (36x per row)
def comp(s):
    s = s or ""
    s = ADDON.sub("", s)
    s = s.replace("보툴리눔 톡신", "톡신").replace("보튤리눔 톡신", "톡신").replace("보톡스", "톡신")
    s = re.sub(r"\(([^()]*)제외\)", "", s)   # '(입술/애교제외)' names what is NOT included
    s = s.replace("국내산", "국산").replace("이마제외", "").replace("이마 제외", "").replace("벨로텔로", "벨로테로")
    # Korean toxin brands count as 국산 (premium ones such as 코어톡스·이노톡스 stay excluded by the keys' bad lists)
    s = re.sub(r"(?<!국산)(리즈톡스|리즈톡신|뉴럭스|보툴렉스|나보타|메디톡신|휴톡스|비에녹스)", r"국산\1", s)
    s = re.sub(r"(\d+)\s*(유닛|단위|unit|units|Unit|UNIT|u|U)(?![a-zA-Z])", r"\1U", s)
    s = re.sub(r"(\d)\s*(CC|cC|Cc)", r"\1cc", s)
    s = re.sub(r"(\d)\s*샷", r"\1샷", s)
    s = re.sub(r"(\d),(\d{3})", r"\1\2", s)
    s = re.sub(r"(\d+)\s*(KJ|kj|Kj|kJ)", lambda m: f"{m.group(1)}KJ", s)
    s = re.sub(r"(\d+)000\s*J\b", lambda m: f"{m.group(1)}KJ", s)
    s = re.sub(r"(\d+)만\s*줄", lambda m: f"{int(m.group(1)) * 10}KJ", s)
    s = re.sub(r"(\d+)K\b", r"\1KJ", s) if "온다" in s else s
    s = s.replace("FORMA", "FORMA").replace("forma", "FORMA").replace("Forma", "FORMA").replace("fx", "FX")
    s = re.sub(r"\s+", "", s)
    s = s.replace("얼굴전체의", "얼굴전체").replace("얼굴 전체", "얼굴전체")
    return s


# procedure families: a name that names two of them is a bundle
FAMS = [r"톡신", r"필러", r"슈링크", r"울쎄라", r"써마지", r"인모드", r"온다", r"올리지오", r"볼뉴머|볼링크", r"티타늄",
        r"리쥬란", r"쥬베룩", r"토닝|제네시스", r"아쿠아필", r"포텐자", r"스컬트라", r"리프테라", r"물광", r"엑소좀",
        r"실리프팅|민트실", r"텐써마", r"엑셀브이|엑셀V", r"윤곽주사", r"제모"]
COND = re.compile(r"\d+(샷|cc|U|회|부위|개)(이상|부터)")   # '(*300샷 이상 시)', '[4cc부터]', '(10개 이상부터 시술 가능)': a bigger purchase
#                                                       than the unit (개: 2026-10-15, '아그네스 1개당 (10개 이상부터 …)')
# add-on wording, read on the name without its round brackets and footnotes (2026-10-15, 개선 보고서 E5: 790 rows checked one by one —
# '(면적에 따라 비용추가)', '(클라리티 기기로 변경 시 3만원 추가)', '(※ 옵션) 리쥬란 … 추가 시 +14만원)', '(패키지 진행시 10% 추가할인)' are
# notes on a whole procedure's price, not add-ons). Not add-ons any more: '처음 이용고객' (a first-visit price), a bare 'ㄴ' row mark,
# '동시 시술 1회' (two procedures at one price), '패키지 진행시 회당 비용' (the per-session price), '추가 20%' (a discount)
ADDON_ONLY = re.compile(r"\[추가\]|^추가(?!\d+%)|추가\)|\d(샷|cc|U)추가시|추가구매|추가결제|추가비용|옵션\)|\(옵션|\[옵션|옵션\]|추가옵션|옵션할인|"
                        r"단독불가|단독사용불가|단독시술불가|동시시술(?:시|할)|함께시술|진행고객|시술고객|구매고객|결제고객|패키지진행시(?!회당)|패키지구매시|패키지결제시")
# '… 비타민관리 추가', '무릎추가 5회' — unless a whole item comes first ('올리지오 300샷+추가 30샷', '신데렐라주사 1회 + 비타민C 앰플 추가':
# one price for both)
ADDON_TAIL = re.compile(r"추가$|(?<![+＋])추가\d")
# meant even inside brackets or after '*': '(단독 사용 불가)', '(뉴비쥬 진행고객님 한정)', '(*단독 불가 / 추가상품)', '(옵션)'
ADDON_STRONG = re.compile(r"단독(?:사용|시술)?불가|진행고객|추가상품|추가결제시|\((?:시술|추가)?옵션\)")
ADDON_LEAD = re.compile(r"^\s*(?:\[[^\]]*\]\s*)*\((?:[^()]*옵션|추가[^()]*)\)")   # '(옵션) …', '(목필러 옵션) …', '(추가옵션) …' first
# 추가당 · 추가시 · 추가* (2026-10-15, 개선 보고서 E3): '미희주사 1cc 추가당', '가운데부위 추가시', '울쎄라피 프라임 100샷 추가 당' are
# prices on top of a base. Read outside brackets only: '염증주사 1부위 (1부위 추가 시 5000원)' is the base price, the bracket
# explains the next area (addon_only)
ADDON_PER = re.compile(r"추가당|추가\*|추가시(?!술)")


def outside(name):
    """a name without its footnote ('※ …', '* …' after the item) and round brackets (nested ones come off from the inside out)"""
    out, prev = re.sub(r"(?<=\S)\s*[※*].*$", " ", name or ""), None
    while out != prev:
        out, prev = re.sub(r"\([^()]*\)", " ", out), out
    return out


@functools.lru_cache(maxsize=1 << 19)
def addon_only(name):
    """True when a name is only sold on top of another procedure: '옵션5) 에어녹스 추가', '(목필러 옵션) 슈링크 100샷 추가',
    '… 추가당', '(단독 사용 불가)' — the compare keys skip it and the app keeps it out of ranges (data.json addon)"""
    if ADDON_STRONG.search(comp(name)) and not re.search(r"택\s*1", name or ""):     # '…중 택 1 - 10회 ※압출단독불가' is the program
        return True
    out = outside(name)
    if re.search(r"옵션\s*\d*\)", out) and not re.search(r"차감|택\s*1", out):     # '패키지 10회 옵션1) 1회 차감 : …' is the package
        return True
    if ADDON_LEAD.match(name or ""):
        return True
    c = re.sub(r"추가\d+%|추가할인", "", comp(out))
    if ADDON_ONLY.search(c) or ADDON_PER.search(c):
        return True
    return bool(ADDON_TAIL.search(c)) and not re.search(r"\d+(?:회|샷|cc|ml|U|줄|KJ)[+＋]", c)


ONCE = re.compile(r"체험가|체험|한정가|한정|첫방문|첫 방문|첫시술|첫 시술|1회한정|웰컴|첫구매|1인\s*1회|1인당\s*1회|신규고객|신규회원|신규방문|선착순")
# '10회 한정가' / '5회 체험가' = a 10 / 5-session price (only '1회 한정' means once per person, and 1 is the default anyway)
SESS = re.compile(r"(\d+)\s*회(?!\s*(차|이상|이내|당|째|분))")
# a program of N weeks ('여드름 집중케어 프로그램 (6주)', '피코토닝 플러스 프로그램 · … 5주') is a course, not one session
COURSE = re.compile(r"(?<![\d.])\d+\s*주(?![가-힣])")
COURSE_WORD = re.compile(r"프로그램|패키지|PKG|챌린지|솔루션|케어")


def sessions(name):
    name = name or ""
    if re.search(r"이용권|무제한|1년|1달|개월|\d+주\s*(패키지|PKG|프로그램|챌린지)", name) or (COURSE.search(name) and COURSE_WORD.search(name)):
        return 99
    # the option's own count, not a note in brackets or after '*': '[젠틀맥스] 남성 인중 + 앞턱 제모 5회 (*10회 53만원)' is a 5-session
    # price (2026-10-15: read as 10회, 셀린 청주 5회 prices sat in 10회 keys). A count written only in a note ('배꼽주변 제모 (10회)',
    # '브라질리언제모+항문 *5회') still counts.
    outside = re.sub(r"\([^()]*\)", " ", name)
    text = next((t for t in (outside.split("*")[0], outside) if SESS.search(t)), name)
    s = 1
    for m in SESS.finditer(text):
        try:
            s = max(s, int(m.group(1)))
        except ValueError:
            pass
    # '10+1회' / '12+1회' is a course of eleven / thirteen sessions, not one (2026-10-15: read as 1회, 셀린 '인중 제모 10+1회'
    # 50,000원 sat in the 1회 key whose median is 12,000원)
    for m in re.finditer(r"(\d+)\s*\+\s*(\d+)\s*회(?!\s*(차|이상|이내|당|째|분))", text):
        s = max(s, int(m.group(1)) + int(m.group(2)))
    return s


@functools.lru_cache(maxsize=1 << 19)
def _single(name):
    """the compared text of a name that can stand for some key's unit, or None — the checks every key shares, done once per name"""
    c = comp(name)
    if COND.search(c):
        return None    # '(*300샷 이상 시)': the price needs a bigger purchase than the key's unit
    if addon_only(name):
        return None    # '(목필러 옵션) 슈링크 100샷 추가': only sold on top of another procedure
    if sum(1 for f in FAMS if re.search(f, c)) >= 2:
        return None    # a bundle of two procedures ('볼뉴머300샷X슈링크300샷', '포텐자 + 쥬베룩') is not the key's unit
    return c


def match(key, name):
    """name: raw display name. returns True when the row stands for the key's unit."""
    kid, cat, label, need, bad, opt = key
    c = _single(name)
    if c is None:
        return False
    if any(not re.search(p, c) for p in need):
        return False
    if any(re.search(p, c) for p in bad):
        return False
    na = opt.get("need_any")
    if na and not any(re.search(p, c) for p in na):
        return False
    u = opt.get("unit")
    if u:
        want, kind = u
        found = re.findall(kind, c)
        if found and not any(re.fullmatch(want, f) for f in found):
            return False
    if sessions(name) != opt.get("sess", 1):
        return False
    return True


if __name__ == "__main__":
    tests = [
        # 5.1 audit: options that are not a 1-area wrinkle toxin / plain toning (were in X02 / X28 / X30)
        ("X02", "[국산] 귀밑샘/턱밑샘 보톡스 중 택 1", False), ("X02", "두피 발모톡스 (국산) / 정수리 또는 M자 중 택1", False),
        ("X02", "[연어주사/아기주사/필로르가135(국산)/엑소마지] 중 택 1, MTS 1회", False),
        ("X02", "[국산] 한 부위 보톡스 (미간/바깥눈가/안쪽눈가/콧등/자갈턱/ 중 택1)", True), ("X02", "미간/콧잔등/자갈턱 (국산 리즈톡스or뉴럭스) 부위당", True),
        ("X28", "[HOT] 강력한 피코토닝 · 피코프락셀 1회", False), ("X30", "더마v(홍조,혈관,제네시스 3종) 1회", False),
        ("X01", "국산 턱보톡스 50U", True), ("X01", "국산 프리미엄 턱보톡스 50U", False), ("X01", "사각턱 보톡스 50U (국산)", True),
        ("X01", "[용량업] 국산 턱보톡스 100U", False), ("X01", "턱보톡스 50unit(국산/소분)", True), ("X01", "이중턱 보톡스 (국산)", False),
        ("X01", "♥첫방문특가♥ 턱 보톡스 50u", False),
        ("X02", "국산 주름보톡스 1부위", True), ("X02", "주름보톡스 1부위 (국산)", True), ("X02", "국산 주름보톡스 3부위 [이마/미간]", False),
        ("X03", "국산 얼굴전체 스킨보톡스", True), ("X03", "풀페이스 스킨보톡스 (국산)", True), ("X03", "국산 프리미엄 얼굴전체 스킨보톡스", False),
        ("X04", "수입 독일산 턱보톡스 50U", True), ("X05", "수입 독일산 주름보톡스 1부위", True), ("X05", "수입 독일산 주름보톡스 1+1", False),
        ("X08", "윤곽주사 3cc", True), ("X08", "윤곽주사 3cc 1회", True), ("X08", "윤곽주사 (3cc) 3회", False), ("X08", "윤곽주사 1부위", True),
        ("X09", "국산필러 1cc", True), ("X09", "국산 아띠에르 필러 1cc", True), ("X09", "국산 입술필러 1cc", False), ("X09", "[1회 체험가] 국산필러 1cc", True),
        ("X10", "수입 벨로테로 1cc", True), ("X10", "수입필러 벨로테로 1cc", True), ("X10", "수입 레스틸렌 키스 1cc", False),
        ("X11", "슈링크 유니버스 울트라 100샷", True), ("X11", "슈링크 유니버스 부스터 100샷 (오로라앰플 GT38 포함)", False), ("X11", "슈링크 유니버스 아이리프팅 100샷", False),
        ("X13", "울쎄라 100샷", True), ("X13", "아이울쎄라 100샷", False), ("X13", "울쎄라 프라임 100샷", True), ("X14", "울쎄라피 프라임 300샷", True),
        ("X15", "써마지 FLX 300샷", True), ("X15", "아이써마지 FLX 300샷", False),
        ("X17", "얼굴전체 인모드 1가지 모드", True), ("X17", "얼굴전체 인모드 2가지 모드 (FX+FORMA)", False), ("X18", "얼굴전체 인모드 2가지 모드 (FX+FORMA)", True),
        ("X17", "[인모드] 얼굴전체 1가지 모드 (FX or FORMA)", True), ("X18", "[인모드] 얼굴전체 듀얼 인모드 (FX+FORMA)", True),
        ("X20", "페이스 온다 리프팅 10KJ", True), ("X20", "[1회 체험가] 페이스 온다 리프팅 10KJ 1회", True), ("X20", "바디 온다 리프팅 10KJ", False),
        ("X25", "리쥬란HB/리쥬란힐러/리쥬란아이 리쥬란아이 1cc 1회", False), ("X25", "리쥬란HB plus 1cc 1회", True),
        ("X12", "(뉴비쥬 진행고객님 한정) 슈링크 300샷 당,", False), ("X36", "(뉴비쥬 진행고객님 한정) 바디인모드fx or 풀페이스 인모드fx 1회", False),
        # brand expansion 2026-10-14 (tools/audit_data.js keyMixedQty): 12cc is not 2cc, a minimum purchase, other ml, a pick-one list
        ("X24", "리쥬란힐러 12cc", False), ("X24", "리쥬란힐러 12cc (2명이서 나누어 사용 가능 / 1인 1회 한정)", False),
        ("X10", "[4cc부터] 디자인필러 1cc (벨로테로)", False), ("X08", "윤곽주사ㅣ벨라콜린 벨라콜린(2ml) 1회", False),
        ("X08", "윤곽주사ㅣ이중턱삭제주사 이중턱삭제주사 DCA(한병/2ml) 1회", False),
        ("X25", "리투오 6cc / 스킨바이브 3cc / 리바이브 1cc / 셀르디엠 6cc / 티시보 6cc / 리즈네 6cc / 리쥬란HB 3CC 택 1", False),
        ("X24", "리쥬란힐러 2cc", True), ("X24", "리쥬란 HB 플러스 2cc", False), ("X24", "리쥬란힐러 2cc 1회 한정가", True), ("X24", "[재생 부스터 패키지] 리쥬란힐러 2cc + 아이리쥬란힐러 1cc 3회", False),
        ("X27", "쥬베룩 볼륨 1cc", True), ("X27", "[1회 체험가] 쥬베룩 볼륨 1CC(2CC이상)", False),
        ("X28", "피코토닝 1회", True), ("X28", "[1회 체험가] 피코토닝 1회 (팩 미포함)", True), ("X28", "피코토닝 + 촉촉팩 + LED(5분) 5회", False), ("X28", "피코토닝", True),
        ("X28", "피코토닝(피코 세컨드 레이저) + 진정관리", True),
        ("X31", "아쿠아필(1/2/3제) + 촉촉팩", True), ("X31", "아쿠아필(1/2제) 1회 한정가", True), ("X31", "아쿠아필(1/2/3제)10회", False),
        ("X33", "점제거小 (2mm이하)", True), ("X33", "얼굴 전체 점제거 (40개 이하)", False),
        ("X32", "포텐자 1회", True), ("X32", "아크네 포텐자(피지선 파괴술) 개당", False), ("X32", "아크네 포텐자 부분", False),
        ("X34", "염증주사 1개", True), ("X34", "염증주사 얼굴전체", False),
        ("X35", "[여성]겨드랑이 제모 1회", True), ("X35", "겨드랑이 제모 1회", True), ("X35", "[여성]겨드랑이 제모 5회", False), ("X35", "[남성]겨드랑이 제모 1회", False),
        ("X36", "바디인모드 FX모드(5분)", True), ("X36", "바디 인모드 FX (10분)", False),
        ("X02", "주름 톡신 [국산] 한 부위 보톡스 (미간/바깥눈가/안쪽눈가/콧등/자갈턱/ 중 택1)", True), ("X02", "주름톡신(더모톡신) 미간부분/바깥눈가/콧등/자갈턱 부위당 [국산]", True),
        ("X02", "주름톡신(더모톡신) 미간전체/눈가전체 부위당 [국산]", False), ("X02", "국산 이마 주름톡신", False),
        ("X05", "[수입/독일산/미국산] 한 부위 보톡스 (미간/바깥눈가/안쪽눈가/콧등/자갈턱 중 택1)", True), ("X04", "턱보톡스 50unit(프리미엄 독일산/소분)", True),
        ("X04", "턱보톡스 50unit(프리미엄 미국산/단독)", False),
        ("X01", "[EVENT] [국내산] 사각턱 보톡스 50U", True), ("X01", "사각턱톡신(사각턱보톡스) 사각턱보톡스 - 국산 50단위", True),
        ("X02", "[EVENT] [국내산]주름보톡스 (이마,미간,눈가,눈밑,콧등,턱끝 중 1부위)", True), ("X02", "주름보톡스1부위 이마제외(국산)", True),
        ("X02", "주름보톡스 이마(국산)", False), ("X02", "주름보톡스(더모톡신) 미간/콧등/콧볼/안쪽눈가/바깥눈가/자갈턱 택1 (국산)", True),
        ("X01", "사각턱보톡스(국산 보툴렉스/나보타) 50u", False),
        ("X12", "♥첫방문특가♥ 슈링크 울트라 100샷 (*300샷 이상시)", False), ("X14", "울쎄라 프라임 100샷 *300샷 이상 시", False),
        ("X10", "수입 쥬비덤 귓볼필러 1cc", False), ("X21", "올리지오 100샷 (300샷 이상 시)", False),
        # 4.0 audit (docs/PRODUCT_AUDIT.md): wrong merges found in the 2026-10-14 data
        ("X02", "다한증보톡스 · 200단위 [겨드랑이/손/발] (국산) 부위당", False), ("X06", "바디톡신 100유닛(외국산)", False),
        ("X06", "바디톡신 100유닛(국산)", True), ("X24", "리쥬하이 4cc (리쥬란 2cc) by 초극세니들 1회", False),
        ("X11", "초음파리프팅(슈링크/텐쎄라) · 텐쎄라100샷", False), ("X33", "점, 비립종, 편평사마귀, 한관종, 쥐젖제거 (100개미만)", False),
        ("X34", "사춘기 여드름 맞춤솔루션 5주(염증주사 포함)", False), ("X29", "메가 레이저토닝(화이트닝 레이저) 20회 한정가", False),
        ("X31", "아쿠아필/비타민관리/스케일링/수분관리/이온토/크라이오셀 20회 체험가", False), ("X29", "레이저토닝(화이트닝 레이저) 체험가", True),
        ("X28", "피코토닝 플러스 프로그램 · 피코플러스 클라리티 프로그램 5주", False), ("X07", "얼굴전체 다한증 보톡스 (국산)", False),
        ("X36", "바디 인모드 리프팅(고강도 양극성 고주파) 4부위 - 팔뚝/허벅지/상복부/하복부/옆구리/부유방 등", False),
        ("X02", "주름 보톡스 · 풀페이스 티엠버스(국산)1회 [이마,미간,눈가,눈밐,콧등,턱끝]", False), ("X34", "여드름관리 1회 (염증주사 포함)", False),
        ("X30", "에일린 플러스 제네시스 프락셔널(고강도 콜라겐 재생) 1회", False), ("X28", "피코토닝 · 문신제거 (범위에따라다름)", False),
        ("X32", "포텐자 1800샷 (샷수 나눠서 시술)", False), ("X07", "전두부 다한증 보톡스 (국산)", False), ("X05", "주름보톡스(독일 고순도) 10부위", False),
        ("X33", "점 제거 1개(돌출점)", False), ("X33", "얼굴 점빼기(2mm 이하) 개당", True),
        ("X30", "[브랜드 10주년 기념, 무한 페스타] 제네시스 레이저 + 촉촉팩 1회 한정가", True), ("X34", "[브랜드 10주년 기념, 무한 페스타] 염증주사 1개 1회 한정가", True),
    ]
    # sessions: 'N회 한정가/체험가' is N sessions; a program of weeks is a course (99)
    for name, want in [("(남자) 종아리 + 무릎 제모(아포지 플러스) 10회 한정가", 10), ("에버클V(PLLA 콜라겐부스터) 4cc 3회 체험가", 3),
                       ("셀르디엠(동종진피 ECM 부스터) 6cc 1회 체험가", 1), ("여성 겨드랑이 제모 1회 (1인1회/선결제 불가)", 1), ("1회한정 슈링크 100샷", 1),
                       ("포텐자 여드름 집중케어 프로그램 (6주)", 99), ("수액주사(멀티블루 5주) 1회", 1), ("레이저토닝 10회", 10)]:
        if sessions(name) != want:
            tests.append(("X01", name, None))   # counted as a failure below
            print("FAIL sessions", name, sessions(name), "want", want)
    K = {k[0]: k for k in X}
    bad = 0
    for kid, name, want in tests:
        got = match(K[kid], name)
        if got != want:
            bad += 1
            print("FAIL", kid, name, "got", got, "comp=", comp(name), "sess=", sessions(name))
    print("tests", len(tests), "fail", bad)
    if bad:
        raise SystemExit(1)
