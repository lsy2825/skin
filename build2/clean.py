"""Raw scraper output (data2/raw/*.csv) -> one clean, brand-neutral table (data2/clean.csv) + checks (data2/issues.csv).

usage: python build2/clean.py
Rules (each dropped or changed row is listed in issues.csv with the reason):
  drop   price missing/0 · option empty · notes (※, ▶) · paperwork fees (진단서·소견서·제증명·수수료) · price > 5천만원
         · event already over (until = YYYY-MM-DD before today, KST)
  fix    list price below the sale price, or 10x+ the sale price -> list price removed (typo on the site)
  dedupe the same (brand, branch, matching name, sale) shown on several pages of one branch -> kept once
         (a category page wins over the 기획전 page, so the row keeps its real category and list price; the matching name is
         compared without word breaks or letter case; folds the old rule didn't make are listed as '합침')
Columns added: kind (체험가 · 한정가 · 구독권 · 일반 · 고시가), cat (common category), name (display name),
mname (name used for matching), sess (sessions), tags (conditions such as 평일 낮 · 일요일 · 첫 방문), days / hours (the weekdays
and hours written for the price: visit_days / visit_hours), keys (matched comparison ids),
vat (포함 / 별도 / '' unknown: from the row's own wording, else the brand default in data2/vat_policy.json — set only with
evidence from the site, see data2/sources.json).
"""
import csv, datetime, json, os, re, sys, unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
from xkeys import X, match, ONCE, sessions, addon_only  # noqa: E402
import taxonomy  # noqa: E402

RAW = os.path.join(ROOT, "data2", "raw")
TODAY = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
VAT_IN = re.compile(r"(부가세|부가가치세|VAT)[^가-힣A-Za-z]{0,6}(\d{1,2}\s*%\s*)?(포함)", re.I)
VAT_EX = re.compile(r"(부가세|부가가치세|VAT)[^가-힣A-Za-z]{0,6}(\d{1,2}\s*%\s*)?(별도|미포함)", re.I)
VAT_POLICY = os.path.join(ROOT, "data2", "vat_policy.json")


def vat_policy():
    """brand → (default 'excl'/'incl'/'', branches the default is not confirmed for). A branch whose own pages were not read or
    say nothing (셀린 광명·분당정자, 2026-10-15) keeps 'unknown' instead of borrowing the brand's wording."""
    if not os.path.exists(VAT_POLICY):
        return {}
    return {b: (v.get("default", ""), set(v.get("branches_unconfirmed", [])))
            for b, v in json.load(open(VAT_POLICY, encoding="utf-8")).items() if not b.startswith("_")}
BRANDS = [("velyb", "블리비"), ("ppeum", "쁨"), ("toxnfill", "톡스앤필"), ("lienjang", "리엔장"), ("forever", "포에버"),
          ("vands", "밴스"), ("uandi", "유앤아이"), ("daybeau", "데이뷰"), ("drevers", "닥터에버스"), ("cellin", "셀린")]

PAPER = re.compile(r"진단서|소견서|제증명|증명서|수수료|사본|발급")
NOTE = re.compile(r"^[※▶▷★▼■●◆]|참조|참고하세요|가격표")
SUBS = re.compile(r"구독권|이용권|멤버십|정기권")
# a pass named only in the group title: a period word, or '무제한' on a hair-removal page. '무제한 입술필러' / '점 무제한' are one
# session with no cap on the amount, not a period (2026-10-15: 30 such rows were marked 구독권 and left the name groups)
PERIOD = re.compile(r"이용권|패스권|회원권|구독|(?<!\d)1\s*년|\d+\s*개월")
NO_CAP = re.compile(r"필러|실리프팅|실\s*리프팅|(?<![가-힣])실(?![가-힣])|점|염증|지방분해|주사|문신")


def pass_group(grp, opt):
    if PERIOD.search(grp):
        return True
    return "무제한" in grp and "제모" in f"{grp} {opt}" and not NO_CAP.search(f"{grp} {opt}")
# a page that is an event or sale rather than the clinic's price list for that category (fold: the price list row is kept)
EVENT_PAGE = re.compile(r"기획전|이벤트|EVENT|[Ee]vent|체험가|특가|한정|할인|세일|페스타|런칭|오픈|맞이|혜택|선착순|[★♥☆]|\d+\s*월\)|이달")
SEX = {"남자": "남성", "여자": "여성", "男": "남성", "女": "여성"}


def event_page(row):
    return bool(EVENT_PAGE.search(f"{row['src_cat']} {row['group']}"))
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
# 해피아워·'화/수/목'·'12시~17시'·'평일 한정' are weekday hours too (검증 8차: 126 such rows were compared as plain prices — 유앤아이 동탄점
# 온다 60KJ showed its 400,000 happy-hour price over the 450,000 regular one). Under the app's own tag ('평일 낮': app/domain/pricing.js
# condState) the visit-day filter drops them on weekends and holidays. The app reads every such tag as Monday-Friday: a '화/수/목'
# or all-day '평일한정' price is not told apart, and when the days stand only in the group title (501 rows on 2026-10-16) the
# name does not show them either — the row fields days / hours below carry them (2026-10-16)
TAGS = [("평일 낮", r"프라임\s*타임|평일\s*(낮|오전|오후|한정)|낮\s*시간|\d+시\s*이전|해피\s*아워|화\s*/?\s*수\s*/?\s*목(?!요일)|"
                  r"\d{1,2}\s*시\s*[~-]\s*\d{1,2}\s*시"), ("일요일", r"일요일|썬데이|선데이"),
        ("타임세일", r"타임\s*세일"), ("첫 방문", r"첫\s*방문|신규|웰컴|첫\s*시술|첫\s*구매"), ("1인 1회", r"1인\s*1회|1인당\s*1회")]
# The days and hours themselves (C1 다음, 2026-10-16 — data.json row fields 16 `days`, 17 `hours`), read from the same texts as TAGS
# (group title + option), so B's visit-day filter can tell a 화/수/목 or a 12시~17시 price from a Monday-Friday one:
#   days  = bit mask 월 1 · 화 2 · 수 4 · 목 8 · 금 16 · 토 32 · 일 64 (평일 31, 주말 96), 0 = no day written (every day is 0 too)
#   hours = 'HH:MM-HH:MM' (24 h), '' = no hours written (all day is '' too); 'N시 이전/까지' = '00:00-HH:MM', 'N시 이후' = 'HH:MM-24:00'
# Only what is written: '해피아워' / '프라임 타임' / '평일 오후' give no hours, a holiday ('공휴일') is no weekday and is not kept.
WEEK = "월화수목금토일"
ALL_DAYS = 127
ALL_HOURS = "00:00-24:00"
_D = "[월화수목금토일]"
# one item of a day list: a word for a set of days, a range ('월~금'), a run of day letters in week order ('화수목', '월목금'), one
# day letter with or without 요일. A lone day letter counts only with 요일 ('21(화) 입고', '앞 목 5회' are not days).
_ITEM = rf"(?:평일|주중|주말|공휴일|빨간\s*날|썬데이|선데이|{_D}(?:요일)?\s*[~\-–]\s*{_D}(?:요일)?|{_D}{{2,7}}(?:요일)?|{_D}(?:요일)?)"
_SEP = r"(?:\s*[/,·.ㆍ・&+]\s*|\s+(?:및|와|과|or)\s+|\s*및\s*)"
DAY_LIST = re.compile(rf"(?:(?<![가-힣0-9A-Za-z])(?=[월화수목금토일])|(?=평일|주중|주말|공휴일|빨간|썬데이|선데이)){_ITEM}(?:{_SEP}{_ITEM})*")
# after a list that ends in a bare day letter: no other Hangul, unless it is a word that goes with a day condition ('화,목,토이벤트',
# '화수목한정'; '화목한', '수일', '목주름' are not days)
_AFTER_DAY = re.compile(r"(?![가-힣])|(?=이벤트|한정|특가|타임|해피|반짝|적용|방문|만\b|에만|데이|오전|오후|파워|단독|내원|진행|할인|딜|찬스|이용|예약|가능)")
_NOT_DAYS = re.compile(r"\s*(?:은|는|엔|에는)?\s*(?:제외|불가|미적용|적용\s*불가|시술\s*불가|사용\s*불가|이용\s*불가|진행\s*불가|예약\s*불가|안\s*됨)")
# a sentence about the clinic, not about the price ('화요일 휴진 안내', '토요일 오전 진료'): says nothing about the days
_DAY_NOTICE = re.compile(r"\s*(?:은|는|엔|에는)?\s*(?:야간|오전|오후|정상)?\s*(?:휴진|휴무|휴원|진료|운영|영업|오픈|입고|정기\s*휴)")


def _day_bits(item):
    """bits of one list item; None when the letters are not days ('금일' = today, '일월' out of week order)"""
    it = re.sub(r"\s+", "", item)
    words = {"평일": 31, "주중": 31, "주말": 96, "공휴일": 0, "빨간날": 0, "썬데이": 64, "선데이": 64}
    if it in words:
        return words[it]
    it = it.replace("요일", "")
    m = re.fullmatch(rf"({_D})[~\-–]({_D})", it)
    if m:
        a, b = WEEK.index(m.group(1)), WEEK.index(m.group(2))
        return sum(1 << i for i in range(a, b + 1)) if a < b else None
    idx = [WEEK.index(c) for c in it]
    if any(b <= a for a, b in zip(idx, idx[1:])) or (len(it) == 2 and it[1] == "일" and it != "토일"):
        return None
    return sum(1 << i for i in idx)


def visit_days(text):
    """the weekdays a price is valid on (bit mask above; 0 = no day written). Every day phrase holds ('평일한정이벤트 월~목' = 월~목),
    days named before 제외 / 불가 are taken off ('공휴일, 주말 제외' = 평일, '*금요일, 주말, 공휴일 불가' with '월~목' = 월~목)."""
    text = unicodedata.normalize("NFKC", text or "")
    pos, neg, said = ALL_DAYS, 0, False
    for m in DAY_LIST.finditer(text):
        items = [x for x in re.split(_SEP, m.group(0)) if x.strip()]
        bits = [_day_bits(x) for x in items]
        tail = text[m.end():]
        if (len(items) == 1 and re.fullmatch(_D, items[0].strip())) or None in bits or _DAY_NOTICE.match(tail) \
                or (re.search(rf"{_D}$", items[-1].strip()) and not items[-1].strip().endswith("요일") and not _AFTER_DAY.match(tail)):
            continue
        mask = 0
        for b in bits:
            mask |= b
        if _NOT_DAYS.match(tail):
            neg |= mask
            said = said or bool(mask)
        elif mask:
            pos &= mask
            said = True
    out = pos & ~neg & ALL_DAYS if said else 0
    return 0 if out == ALL_DAYS else out


_AMPM = r"(?:(오전|오후|낮|저녁|밤|AM|PM|am|pm)\s*)?"
# one time: (am/pm, hour, ':', minutes, '시', minutes, '반'); '시간' / '시술' / '시린지' / '시즌' are not o'clock
_TIME = _AMPM + r"(\d{1,2})(?:\s*(:)\s*(\d{2})|\s*(시)(?![간술린작즌리세행트])(?:\s*(\d{1,2})\s*분|\s*(반))?)?"
HOUR_RANGE = re.compile(rf"(?<![\d./:]){_TIME}\s*(?:~|-|–|부터)\s*{_TIME}(?![\d./])(?:\s*시?\s*까지)?")
HOUR_EDGE = re.compile(rf"(?<![\d./:~\-]){_TIME}\s*(이전|전까지|전|까지|이후|부터)")
_HOUR_SKIP_BEFORE = re.compile(r"(?:점심|휴게|진료|운영|영업|상담|휴무)\s*시간[^0-9]{0,8}$")   # '(점심시간 13시~14시 제외)'
_HOUR_SKIP_AFTER = re.compile(r"\s*\)?\s*(?:제외|휴게|휴무)")


def _minutes(g, end=False, other=None):
    """one time (regex groups of _TIME) → minutes after midnight. A bare 1~8 o'clock is the afternoon (clinic hours: '12시~6시',
    '1시~5까지'); a start stays in the morning when the afternoon would come after the end ('8시~11시')."""
    ap, h, _, mm, _, mm2, half = g
    h, m = int(h), int(mm or mm2 or (30 if half else 0))
    if m > 59 or h > 24:
        return None
    if (ap in ("오후", "저녁", "밤", "PM", "pm") and h < 12) or (ap == "낮" and h <= 6):
        h += 12
    elif not ap and 1 <= h <= 8 and (end or other is None or (h + 12) * 60 + m < other):
        h += 12
    return h * 60 + m


def _span(a, b):
    return f"{a // 60:02d}:{a % 60:02d}-{b // 60:02d}:{b % 60:02d}"


def visit_hours(text):
    """the hours a price is valid in ('HH:MM-HH:MM', '' = none written): '11시~16시', '12:00~17:00', '오전 10시~오후 3시', '10-15시',
    '평일4시이전'. A time needs 시 or ':' on one side ('1~2회', '10/1~10/15' are not hours); a lunch break or a time 제외 is not the
    hours ('화/수/목 11시~16시 한정 (점심시간 13시~14시 제외)' = 11:00-16:00). Several times: the part they share."""
    text = unicodedata.normalize("NFKC", text or "")
    spans, used = [], []
    for m in HOUR_RANGE.finditer(text):
        g1, g2 = m.groups()[:7], m.groups()[7:]
        if not (g1[2] or g1[4] or g2[2] or g2[4]):
            continue
        used.append((m.start(), m.end()))
        if _HOUR_SKIP_BEFORE.search(text[:m.start()]) or _HOUR_SKIP_AFTER.match(text[m.end():]):
            continue
        b = _minutes(g2, end=True)
        a = _minutes(g1, other=b) if b is not None else None
        if a is not None and b is not None and b <= a and b + 720 <= 1440:
            b += 720                                         # '오후 1시~10시'
        if a is not None and b is not None and 0 <= a < b <= 1440:
            spans.append((a, b))
    for m in HOUR_EDGE.finditer(text):
        g = m.groups()[:7]
        if any(s <= m.start() < e for s, e in used) or not (g[2] or g[4]) \
                or _HOUR_SKIP_BEFORE.search(text[:m.start()]) or _HOUR_SKIP_AFTER.match(text[m.end():]):
            continue
        t = _minutes(g, end=m.group(8) not in ("이후", "부터"))
        if t is not None and 0 < t < 1440:
            spans.append((t, 1440) if m.group(8) in ("이후", "부터") else (0, t))
    if not spans:
        return ""
    a, b = max(s[0] for s in spans), min(s[1] for s in spans)
    out = _span(a, b) if a < b else _span(*spans[0])
    return "" if out == ALL_HOURS else out                   # '0시~24시' = all day: no hours, like 월~일 = no days


def _hours_and(x, y):
    (a1, b1), (a2, b2) = [[int(t[:2]) * 60 + int(t[3:]) for t in v.split("-")] for v in (x, y)]
    a, b = max(a1, a2), min(b1, b2)
    return _span(a, b) if a < b else ""


def visit_when(grp, opt):
    """(days, hours) of one price from its group title and option. Both hold (the group's '평일' and the option's '화,수,목' =
    화수목); when they share no day or hour, the option's — written next to the price — wins."""
    dg, do, hg, ho = visit_days(grp), visit_days(opt), visit_hours(grp), visit_hours(opt)
    days = (dg & do or do) if dg and do else dg or do
    hours = (_hours_and(hg, ho) or ho) if hg and ho else hg or ho
    return days, hours


def visit_merge(a, b):
    """the days/hours of one price shown on two pages: like the tags, a limit stays only when both pages state one; then the
    price is open on either page's days, in either page's hours"""
    (da, ha), (db, hb) = a, b
    days = da | db if da and db else 0
    if ha and hb:
        (a1, b1), (a2, b2) = [[int(t[:2]) * 60 + int(t[3:]) for t in v.split("-")] for v in (ha, hb)]
        hours = _span(min(a1, a2), max(b1, b2))
    else:
        hours = ""
    # a 평일 page and a 주말 page together are every day (an '00:00-14:00' and a '14:00-24:00' page all day): no limit, as
    # visit_days / visit_hours give — else the price would stay out of the plain prices (groups.plain, rule 2) for nothing
    return (0 if days == ALL_DAYS else days), ("" if hours == ALL_HOURS else hours)


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
# '[옵션] 제모 후 진정관리', '[리프팅 추가옵션] 수면마취': an add-on. The label is taken off the name like an event label (names and
# price history stay as they were), and the row is marked addon=1 so it is never compared as a procedure (2026-10-15)
OPTION_LABEL = re.compile(r"^(?:\s*\[[^\]]*\])*?\s*\[[^\]]*옵션[^\]]*\]")   # also behind an event label: '[EVENT] [옵션] …'


def addon_name(mname):
    """a price sold only on top of another procedure, read from the name the same way the compare keys read it
    (taxonomy.variant): '옵션5) 에어녹스 추가', '… 추가당', '… 추가 시' (2026-10-15, 개선 보고서 E5: the app keeps these out of
    ranges, medians and 'lowest', so the flag is stored, not guessed on screen)"""
    return addon_only(mname)


def strip_event_prefix(s, hair=False):
    """Drop leading event labels that only name a sale: '[메가세일] 주름보톡스' / '[EVENT] 벨라콜린 1cc' /
    '[브랜드 10주년 기념, 무한 페스타] 염증주사 1개' -> the procedure name. Labels that describe the product
    ('[대표원장]', '[국산]', '[남성]') stay, and on a 제모 page (hair=True) a label that is a body area: '[겨드랑이] 5회',
    '[종아리] 5회' (톡스앤필 인천부평) were all '5회' — no area to compare, and the same price folded two areas into one row (2026-10-15).
    Only when the rest names no area itself, so '[겨드랑이] 겨드랑이 제모' still folds with '겨드랑이 제모'."""
    while True:
        m = re.match(r"^\[([^\]]+)\]\s*(.+)$", s)
        if not m or KEEP_LABEL.search(m.group(1)) or (hair and taxonomy.hair_area(m.group(1), strict=True)
                                                      and not re.search(taxonomy.HAIR_PART, strip_event_prefix(m.group(2)))):
            return s
        s = m.group(2)


# Section titles are glued in front of an option that doesn't name its product ('슈링크 300샷' › '1회'). Titles that are
# event names, price tiers, notices or tag lists are not product words: glued in, they became spec labels such as
# '20만원3921만재생' and '미백톤업색소토닝' (2026-10-14, 닥터에버스 '20만원 39.21만' / '미백 | 톤업 | 색소 | 토닝' sections).
TITLE_PRICE = re.compile(r"\d+(?:[.,]\d+)?\s*만\s*원?(?![A-Za-z가-힣\d])|\d{1,3}(?:,\d{3})+\s*원|(?<![\d.,])\d{3,}\s*원(?!\s*(?:짜리\s*)?동전)|만원(?:으로|에|의)?")
TITLE_DATE = re.compile(r"\d{2,4}\s*년\s*\d{1,2}\s*월(?:\s*\d+\s*차)?\)?|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*/\s*\d{1,2}\s*[~-]\s*(?:\d{1,2}\s*/\s*)?\d{1,2}|\d{1,2}\s*월|까지")
TITLE_PROMO = re.compile(r"이벤트|EVENT|event|특가|할인|혜택|맞이|누림|기념|큰잔치|잔치|페스타|추천\s*조합|추천|플러스\s*친구|카카오톡|런칭|오픈|"
                         r"안내|한정|선착순|단독|최저가|[♥★☆※]")


def comp_name(s):
    return re.sub(r"\s+", "", s or "")


def title_words(s):
    """a section title as product words: itself when it reads as a product heading ('◆볼뉴머', '레이저 제모'); its product
    words when it mixes them with event / price / date wording ('볼뉴머/슈링크 유니버스 이벤트' → '볼뉴머/슈링크 유니버스');
    '' for a tag list ('미백 | 톤업 | 색소 | 토닝'), a price tier ('20만원 39.21만') or an event name ('26년 10월 2차) 한글날 맞이 …')"""
    s = re.sub(r"[◆◇■□●○]", " ", s or "").strip()
    if not s or re.search(r"[|｜]", s):
        return ""
    t = TITLE_PROMO.sub(" ", TITLE_PRICE.sub(" ", TITLE_DATE.sub(" ", s)))
    t = re.sub(r"\s+", " ", re.sub(r"^[\s)\]·,.:/-]+|[\s(\[·,.:/-]+$", "", t)).strip()
    if t == s:
        return s
    return t if t and PROC.search(t) else ""


SEX_WORD = re.compile(r"남성|남자|여성|여자")


def section_head(sec, grp):
    """the section title put in front of a 닥터에버스 item name (title_words), without its sex word when the menu heading the
    collector put in the group names the other sex: 미사점 lists its women's menu under the section '젠틀맥스 프로플러스 남성 제모'
    ('… · 여성 제모' › '비키니라인/회음부 5회'), and the name's own '남성' won over the group's '여성' (2026-10-16)"""
    head = title_words(sec)
    hs, gs = SEX_WORD.search(head), SEX_WORD.search(grp or "")
    if hs and gs and SEX.get(hs.group(), hs.group()) != SEX.get(gs.group(), gs.group()):
        head = re.sub(r"\s+", " ", SEX_WORD.sub(" ", head)).strip()
    return head


def price(x):
    """'99000' / '99000.0' / '99,000' -> 99000; empty or junk -> 0"""
    try:
        return int(round(float(str(x or "").replace(",", ""))))
    except ValueError:
        return 0


def vat_of(r, grp, opt, vdef):
    """the row's own wording first — its option, group title or the page's section heading ('부가세 포함 만원(1회 한정) 1.96만' is
    the 닥터에버스 미사점 heading of 9 rows, 2026-10-15) — then the brand default unless that branch is unconfirmed"""
    text = f"{r.get('category', '')} {grp} {opt}"
    if VAT_EX.search(text):
        return "별도"
    if VAT_IN.search(text):
        return "포함"
    default, unconfirmed = vdef.get(r["brand"], ("", set()))
    return "" if r["branch"] in unconfirmed else {"excl": "별도", "incl": "포함"}.get(default, "")


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
    issues, out, seen, seen_old, sex_of = [], [], {}, {}, {}
    for r in raw:
        opt, grp = norm_text(r["option"]), norm_text(r["group"])
        # the page's section heading written in front of each product ('▼ 부가세 포함 10만원 19.6만 ▼ 1. 라라토닝 : …', 닥터에버스 동탄):
        # the heading stays the section (category, read for VAT), the product is what follows — read whole, the '▼' made all ten
        # products a notice and they were dropped (2026-10-15)
        sec = norm_text(r.get("category", ""))
        # Only a '▼ … ▼' price heading: '※카카오톡 플러스친구 혜택' / '※항목별 1회씩 적용' headings are conditions (381 닥터에버스 rows
        # stay out as before — a condition tag for them is a separate change)
        if sec.startswith("▼") and len(sec) >= 4 and opt.startswith(sec) and opt[len(sec):].strip():
            opt = opt[len(sec):].strip()
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
        if r["brand"] == "닥터에버스":
            # the item name often leaves the product to its section ('◆볼뉴머' › '페이스 300샷'): put back only a section
            # that names a product (older raw files have every section glued in front by the collector — taken off first)
            sec = re.sub(r"\s+", " ", re.sub(r"[◆◇■□●○★☆♥]", " ", r["category"] or "")).strip()
            if sec and opt.startswith(sec + " "):
                opt = opt[len(sec) + 1:]
            head = section_head(sec, grp)
            if head and comp_name(head) not in comp_name(opt):
                opt = f"{head} {opt}"
        hair = bool(re.search(r"제모", f"{r['category']} {grp}"))
        name = strip_event_prefix(opt, hair)
        if name == "(대표가)" or not PROC.search(name):
            head = title_words(grp)
            name = (f"{head} · {name}" if head else name) if name != "(대표가)" else f"{grp} (최저가부터)"
        mname = name.replace(" · ", " ")
        g = re.search(r"(남성|남자|여성|여자)", grp)
        if not g and (re.search(r"제모", f"{grp} {opt}") or taxonomy.hair_area(opt)):
            # a 제모 item whose sex is only in the page name (쁨 범계 '여성제모' / '남성제모' › '이마(헤어+삼자) 제모 1회'): the same option at
            # the same price on both pages is two products, and one key held both (2026-10-15). Only for 제모 items — 유앤아이 lists every
            # procedure under its '남성제모' / '여성제모' pages.
            g = re.search(r"(남성|남자|여성|여자)", r["category"] or "")
        # the option's own sex mark wins ('女&男) 겨드랑이', '男) 인중'): the page's sex is not added on top (검증 6차: '여성 남성 브라질리언')
        if g and not re.search(r"남성|남자|여성|여자|男|女|\((?:남|여)\)|(?<![가-힣])(?:남|여)\)", unicodedata.normalize("NFKC", mname)):
            mname = f"[{g.group(1)}] {mname}"
        text = f"{r['category']} {grp} {opt}"
        if r["brand"] == "리엔장":
            kind = "고시가"
        elif SUBS.search(f"{grp} {opt}") or (pass_group(grp, opt) and not re.search(r"\d+\s*회", opt)):
            # a 1-year / unlimited pass named only in the group title ('남성 1년 무제한제모 이벤트' › '남자얼굴제모' 690,000원) is not a
            # one-session price; an option that states its sessions ('발등+발가락 5회') is (2026-10-15)
            kind = "구독권"
        elif re.search(r"체험", f"{opt}"):
            kind = "체험가"
        elif ONCE.search(opt):
            kind = "한정가"
        else:
            kind = "일반"
        cat = next((c for c, p in CATS if re.search(p, text)), "기타")
        # 유앤아이 lists peels, skin care and boosters on its 제모 pages ('여성 제모' › 'FCR 필링 얼굴전체 1회'): filed as 제모 they became
        # '… 제모' spec labels (2026-10-14). On a 제모 page the item's own words decide when they name another kind of procedure
        # (a body area alone — '종아리+무릎' — is still 제모 there)
        if cat == "제모" and not re.search(CATS[0][1], f"{grp} {opt}"):
            cat = next((c for c, p in CATS if c not in ("제모", "바디") and re.search(p, f"{grp} {opt}")), cat)
        tags = [t for t, p in TAGS if re.search(p, f"{grp} {opt}")]
        if re.search(r"일요일|선데이|썬데이", grp):
            tags.append("일요일")
        days, hours = visit_when(grp, opt)
        row = {"brand": r["brand"], "branch": r["branch"], "src_cat": r["category"], "group": grp, "option": opt,
               "name": name, "mname": mname, "cat": cat, "kind": kind, "sale": sale, "orig": orig or "",
               "addon": "1" if OPTION_LABEL.match(opt) or addon_name(mname) else r["addon"], "sess": sessions(mname), "tags": "·".join(dict.fromkeys(tags)),
               "days": days, "hours": hours,
               "until": r["until"], "url": r["url"], "fetched_at": r["fetched_at"],
               "vat": vat_of(r, grp, opt, vdef)}
        # the same item shown on two pages of one branch ('[메가세일] X 체험가' and 'X 체험가', same price) -> one row.
        # 2026-10-15 (개선 보고서 E4·E10): the list price no longer has to match — a 기획전 page and the category page often give the
        # same item at the same price with different list prices (블리비 덴서티 600샷 1,590,000원: 정가 3,100,000 / 3,000,000) —
        # and names that differ only in word breaks or letter case are one item ('플라센타관리' / '플라센타 관리'). mname, not the
        # option, decides: it carries the sex from the group title, so '남성 제모 › 미간or코 제모 1회' and '여성 제모 › 미간or코 제모
        # 1회' at the same price stay two rows. Two price-list pages (not events) with different group titles and list prices hold
        # different products whose name lacks the device or colour ('젠틀맥스 › 팔 하완 5회' / '아포지 › 팔 하완 5회'): not folded.
        # The older rule still folds too: same option, sale and list price (an add-on listed on several product pages, '온다 리프팅 ›
        # 옵션5) 덴서티 하이 300샷 추가' / '인모드 리프팅 › …'), within one sex (남자 = 남성) or with a row that names no sex.
        m = re.search(r"남성|남자|여성|여자|男|女", unicodedata.normalize("NFKC", mname))   # '女)' (유앤아이) is a sex too
        sex = SEX.get(m.group(), m.group()) if m else ""
        # a pass (구독권) never folds with a per-session row at the same price: both keys carry it
        is_pass = kind == "구독권"
        k_old = (r["brand"], r["branch"], strip_event_prefix(opt, hair), sale, orig, is_pass)
        k = (r["brand"], r["branch"], comp_name(strip_event_prefix(mname, hair)).casefold().replace("남자", "남성").replace("여자", "여성"), sale, is_pass)
        prev = seen.get(k)
        if prev is not None and prev["orig"] and orig and prev["orig"] != orig and prev["group"] != grp and not event_page(prev) \
                and not event_page(row):
            prev = None
        if prev is None:
            prev = next((p for p in seen_old.get(k_old, []) if not sex or sex_of[id(p)] in (sex, "")), None)
        if prev is not None:
            if not any(p is prev for p in seen_old.get(k_old, [])):     # the old rule (same option and list price) kept these apart
                other_orig = str(prev["orig"]) != str(orig or "")
                issues.append({**r, "action": "합침", "reason": "같은 상품·판매가가 두 페이지에(정가 다름)" if other_orig else
                               "띄어쓰기·대소문자만 다른 같은 상품"})
            # a condition stays only when every page says it: the same price on a page without it is open to anyone (a union
            # turned 블리비's category-page prices into '평일 낮' / '첫 방문' ones — the unconditional lowest price was lost)
            prev["tags"] = "·".join(t for t in prev["tags"].split("·") if t and t in row["tags"].split("·"))
            prev["days"], prev["hours"] = visit_merge((prev["days"], prev["hours"]), (row["days"], row["hours"]))
            if row["addon"] == "1":
                prev["addon"] = "1"
            if event_page(prev) and not event_page(row):
                # the price list row wins: its category, link, list price and end date (an event's end date expired the row); the
                # category stays when the first row's own words already gave one (a '필러/실리프팅' page read as 리프팅)
                prev.update({"src_cat": r["category"], "cat": cat if prev["cat"] == "기타" else prev["cat"], "url": r["url"],
                             "orig": orig or "", "until": r["until"]})
            elif not prev["orig"] and orig:
                prev["orig"] = orig
            elif orig and prev["orig"] and orig < prev["orig"] and event_page(prev) and event_page(row):
                prev["orig"] = orig              # two event pages, two list prices: the smaller one (닥터에버스 '평일한정' 343,100 vs 205,800)
            seen.setdefault(k, prev)
            if prev not in seen_old.setdefault(k_old, []):
                seen_old[k_old].append(prev)
            continue
        seen[k] = row
        seen_old.setdefault(k_old, []).append(row)
        sex_of[id(row)] = sex
        out.append(row)
    # a pass the branch lists again without the pass words: 밴스 창원 '얼굴전체' 690,000 / 정가 1,200,000원 next to '젠틀맥스프로플러스
    # 얼굴전체 1년이용권' at the same two prices — one-session prices do not match a year's pass to the won (2026-10-15)
    passes = defaultdict(list)
    for row in out:
        if row["kind"] == "구독권" and row["orig"]:
            passes[(row["brand"], row["branch"], row["sale"], row["orig"])].append(comp_name(strip_event_prefix(row["option"])))
    for row in out:
        if row["kind"] != "구독권" and row["orig"]:
            me = comp_name(strip_event_prefix(row["option"]))
            if len(me) >= 2 and any(me != p and me in p for p in passes.get((row["brand"], row["branch"], row["sale"], row["orig"]), [])):
                row["kind"] = "구독권"
                issues.append({**row, "action": "이용권으로 봄", "reason": "같은 지점의 이용권과 판매가·정가가 같음"})
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
