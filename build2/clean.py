"""Raw scraper output (data2/raw/*.csv) -> one clean, brand-neutral table (data2/clean.csv) + checks (data2/issues.csv).

usage: python build2/clean.py
Rules (each dropped or changed row is listed in issues.csv with the reason):
  drop   price missing/0 · option empty · notes (※, ▶) · paperwork fees (진단서·소견서·제증명·수수료) · price > 5천만원
         · event already over (until = YYYY-MM-DD before today, KST). A section heading written in front of the item name
         ('※카카오톡 플러스친구 혜택 …', '▼ … ▼ …') is taken off first: priced items under it are no notes (NOTE_SECTION)
  fix    list price below the sale price, or 10x+ the sale price -> list price removed (typo on the site)
  dedupe the same (brand, branch, matching name, sale) shown on several pages of one branch -> kept once
         (a category page wins over the 기획전 page, so the row keeps its real category and list price; the matching name is
         compared without word breaks or letter case; folds the old rule didn't make are listed as '합침'). One option line
         that a branch writes under several product titles at several prices is no item of its own: when two of its products
         meet at one price, they take their group title in front of the name and fold only with the same title (shared_titles)
Columns added: kind (체험가 · 한정가 · 구독권 · 일반 · 고시가 — from the option's words, else the section's: section_kind),
cat (common category), name (display name), mname (name used for matching), sess (sessions), tags (conditions such as 평일 낮 ·
시간대 · 일요일 · 첫 방문), days / hours (the weekdays and hours written for the price: visit_days / visit_hours), keys (matched
comparison ids),
vat (포함 / 별도 / '' unknown: from the row's own wording, else the brand default in data2/vat_policy.json — set only with
evidence from the site, see data2/sources.json), back ('1' = the previous build dropped this item, at any price, for its words
alone — its data2/issues.csv, read before this build writes its own — so a rule took it back: not a new price, prev_dropped).
"""
import csv, datetime, json, os, re, sys, unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build2"))
from xkeys import X, match, ONCE, COURSE, sessions, addon_only, comp  # noqa: E402
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
# Condition tags read from the group title + option and the condition words of the site's category (see CAT_UNPAIRED below;
# cond_tags). The time-of-day ones come from time_tags() below (they need the days / hours):
#   '평일 낮'  — a price for weekdays only (often some hours). Under this tag the app's visit-day filter (app/domain/pricing.js condState)
#               drops it on weekends and holidays, so it is given only when the site limits the days (C1 시간, 2026-10-16): the
#               item's words name weekdays (WEEKDAY_WORDS), weekdays only (row field days) stand next to a time window ('★밴스타임
#               월목금 이벤트 12시~6시', '[평일 11:00~17:00]'), or the item uses a word its chain defines as day-limited (DAY_WORDS).
#   '시간대'  — a time limit that is not a weekdays-only one: a time window with no days written ('[런치 타임 EVENT] … (12시-3시)',
#               '[10:30~16:00] 아쿠아필 1회(타임이벤트)', '해피아워' where the chain's pages say no days) or with a weekend day in it
#               ('토요일 10시~2시'). Before 2026-10-16 most of these were '평일 낮' (all but the '[HH:MM~HH:MM]'-only ones, which had no
#               tag): 톡스앤필 삼성점's lunch-time price was dropped on Saturdays although the site never says weekdays. The name has
#               no '한정' on purpose — the app drops conditions with that word from its '가격 적용 조건' sheet (app/app.js eligOf).
#               Any tag keeps a price out of the plain comparison (groups.regular, the app's isSpecial). Until the app knows this
#               tag (B: Pricing.condState / condLabel), it shows such a price on every day and at every hour with no '시간 확인 필요'.
# Why time conditions are tags at all (검증 8차): 126 such rows were compared as plain prices — 유앤아이 동탄점 온다 60KJ showed its
# 400,000 happy-hour price over the 450,000 regular one.
# '1인 1회' (once per person): '1인 1회', '1인당 1회', '1인 최대 1회', '1인1한정' (톡스앤필 천안불당점 '(1인1한정이벤트)…'), and a
# once-per-item section: 닥터에버스 연신내점 '각 항목 별로 1회 적용가능 KakaoTalk 플러스친구 …' (78 rows, 76 of them already '평일 낮';
# the chain's 목동점 writes the same as '*각 항목별 1인 1회 한정', 분당·구로점 as '※항목별 1회씩 적용'). '항목별 1회' needs 적용 / 한정
# after it — '각 항목별 1회씩 진행' would say what a package holds. A '1회 한정' alone: ONE_LIMIT below.
# '첫 방문' reads '첫경험' like '첫 시술' — a once-only price (유앤아이 인천검단점's tab '첫경험 이벤트' › '… 첫경험 체험가', 부평점's
# '1회 첫경험 체험가', 2026-10-19). Both branches have a '첫방문' tab too (부평점 인모드 FX 얼굴전체 32,000 there, 39,000 here), so it may
# mean the first time with that treatment, not a new patient — not known. '첫체험' is not read: 데이뷰 인천구월점 puts it under '[재진]'.
TAGS = [("일요일", r"일요일|썬데이|선데이"),
        ("타임세일", r"타임\s*세일"), ("첫 방문", r"첫\s*방문|신규|웰컴|첫\s*시술|첫\s*경험|첫\s*구매"),
        ("1인 1회", r"(?<!\d)1\s*인\s*(?:당\s*)?(?:최대\s*)?1\s*(?:회|한정)|항목\s*별\s*(?:로\s*)?1\s*회\s*(?:씩\s*)?(?:적용|한정)")]
WEEKDAY_WORDS = re.compile(r"평일\s*(낮|오전|오후|한정|점심|런치|저녁|야간|타임)|화\s*/?\s*수\s*/?\s*목(?!요일)")
# a time of day: '해피아워' (also 'HAPPY HOUR'), '뷰티아워' (닥터에버스: '화,수,목 11:00~17:00' next to it on 공덕·잠실·수원인계, alone
# on 검단·인천·천호·청량리 — 44 rows were plain prices), '프라임 타임', '낮 시간', '데이타임' (the word alone, not '원데이 타임…'),
# 'N시 이전', 'N시~M시' (with ':' the hours field finds it)
TIME_WORDS = re.compile(r"해피\s*아워|happy\s*hour|뷰티\s*아워|프라임\s*타임|낮\s*시간|(?<![가-힣])데이\s*타임|\d+시\s*이전|"
                        r"\d{1,2}\s*시\s*[~-]\s*\d{1,2}\s*시", re.I)
# chain words for a day-limited offer, defined on the chain's own pages rather than next to the item (chat C read these pages on
# 2026-10-16; the sentences below are not saved in the repo):
#   블리비 '프라임 타임' — every event page: '※프라임 타임 셀렉션 항목은 평일 오후 2시(강남역점) / 5시(구로점·대전점)까지 진행됩니다'
#   데이뷰 '해피 아워' — 수원점: '오후 2:00 ~ 6:00에 적용되는 이벤트입니다. (단, 토요일, 공휴일은 제외)'; the other branches write
#                       화/수/목 next to it. The branch is open on Sunday 10:00–16:30, which the app's only day-limited tag loses —
#                       better than showing it on a Saturday
#   쁨 '해피아워' — 서울대입구점's section is '평일 해피아워', 울산점's '♥수목 해피아워♥'
# Not here, so '시간대': 유앤아이 (창동점's tab is '해피아워 (평일 한정)', 광주점's '화/수/목(10~17시) 해피아워 이벤트' — '평일 낮' from those words; 동탄·여의도·잠실·평택점
# say nothing about the days, in the tab or the items, collection of 2026-10-18) and 닥터에버스 (its event list has '해피아워 이벤트' next to
# a separate '평일한정 이벤트', tests/fixtures/brands/drevers_events.html; the days note on the happy-hour page could not be read again
# from chat C's cloud session — Cloudflare 403, NOTES.md 2026-10-15; the factory did not try). A chain whose pages are found to
# say weekdays is one line here.
DAY_WORDS = {"블리비": re.compile(r"프라임\s*타임"), "데이뷰": re.compile(r"해피\s*아워"), "쁨": re.compile(r"해피\s*아워")}
WEEKEND = 96   # 토 32 · 일 64 (row field days)
TIME_ONLY = "시간대"
TIME_TAGS = ("평일 낮", TIME_ONLY)
# the site says the hour does not matter (the words of app/domain/pricing.js ANY_TIME, and '관계없이'): with days written and no
# hours, the days alone are the condition — no time tag (time_tags). 밴스 '화수목 시간 상관 없이 방문 고객 대상 1인 1회' (30 rows) and
# 닥터에버스 강남점 '※시간 상관없이 적용가능' over its '화/수/목 이벤트' (15) were '평일 낮' with no hours, and the app, which looks for
# these words in the name only, asked for the hour ('시간 확인 필요') of a price the site gives at any hour (검수 2026-10-16). The days
# keep such a price out of the plain ones (groups.plain rule 2) and the app shows it on those days only ('화·수·목만')
ANY_TIME = re.compile(r"시간\s*(?:상관\s*(?:없이|없음|없는)|무관|관계\s*(?:없이|없음))")
# The site's category (raw column category = row src_cat: the tab, menu or section a collector found the item under) is read for
# the conditions too — its condition words only (C1 시간 칸, 2026-10-16): 쁨 울산점 lists its happy-hour prices under the section
# '♥수목 해피아워♥' with names that say nothing ('쥬베룩볼륨2CC'), and 16 of them were compared as plain prices. Only the words of the
# rules (TIME_WORDS · WEEKDAY_WORDS · DAY_WORDS and the days / hours for time_tags / visit_when, the TAGS patterns for cond_tags)
# are taken from it, so a plain menu name ('리프팅', '보톡스·윤곽', '이달의 이벤트') changes nothing. What each collector writes there
# (scrape/*.py): 블리비 one of seven menu names (피부 · 제모 · 부스터 · 리프팅 · 쁘띠성형 · 기획전 · 비만), 쁨 the depth-1 tab (new sites)
# or the item's own .cateName (old sites), 톡스앤필 · 밴스 the menu name, 리엔장 the group title again, 데이뷰 the section or event
# name, 닥터에버스 the section heading over the items (the item name alone in the option; older raw files glued the heading in front
# and clean.main takes it off), 셀린 the menu or '', 유앤아이 the tab button's name.
# In the saved data of 2026-10-16 (accepted/*.csv) every category with a time / day word is a real condition section ('화수목
# 이벤트', '해피아워/한정이벤트', '토요일 한정 EVENT'); the menu names with look-alike words hold none ('타임 리버스 리프팅', '48시간
# 수분관리', '※시간 상관없이 적용가능' — 블리비's '프라임 타임' and 쁨's '해피아워' (DAY_WORDS) are no menu name), and so it is for
# 유앤아이's tabs of 2026-10-18 (CAT_UNPAIRED below; '원데이 패키지' is no day). Its 대전점 tab '데이타임 이벤트' (items '데이타임E) …',
# 18 rows, plain prices until 2026-10-19) is a daytime offer by its name: '시간대' (TIME_WORDS), no days or hours — it states none;
# 일산점 puts its items titled '데이타임 이벤트' under the tab '평일 이벤트 (10~17시)', so 대전점's may be weekdays too, not known.
# The TAGS words stand in condition sections ('첫방문 이벤트' 데이뷰 26 · 밴스 42 rows, whose items repeat it in their group title;
# 닥터에버스 목동점 '*각 항목별 1인 1회 한정' over '① 아쿠아필(1,2,3단계)+LED+모델링팩' — 15 rows compared as plain prices) and in
# new-device sections ('덴서티리프팅 알파팁 신규런칭' 쁨, 'NMN X 나드샷 신규 런칭' 데이뷰): NEW_ITEM below.
# Outside 쁨 울산점 (16 rows; and the days of 쁨 서울대입구점's '평일 해피아워' 8, already '평일 낮') and 닥터에버스 목동점 (15) the items
# repeat the section's words in their own group title, so nothing else changed (build of 2026-10-16, --skip-scrape).
# A chain in CAT_UNPAIRED (below; none now) has a collector that pairs the category with the wrong items: its category is not
# read for the conditions at all, nor for the price kind (section_texts).
#   유앤아이 was in it from 2026-10-16 to 2026-10-19: scrape/uandi.py paired the tab names with the wrong product lists
#             (saved data of 2026-10-16: on every branch most tabs held another tab's products — 과천점's '화수목 이벤트' tab held the 보톡스
#             price list; read whole, the tabs gave a time tag to 895 prices, 869 of them another tab's products), so its tab was
#             read for the days / hours only next to the item's own day or time words. The collector pairs a tab button with its
#             own product box since lsy2825/skin#88 (button data-cate="<n>" ↔ swiper id "tab<n>"), and data2/accepted/uandi.csv
#             comes from it since the collection of 2026-10-18 (44 branches, 18,511 rows). Its 28 tab names with a condition word
#             (1,395 rows, 90 tabs on 43 branches; and 5 trial tab names, '체험가 이벤트' / '1회 체험가 이벤트' …, 142 rows on 7 tabs, read for
#             the price kind alone) all hold their own items. 1,315 of the 1,395 state the condition or a trial offer in their own words ('화수목 이벤트' ›
#             '화수목) 물광주사 2.5cc', or the group title '화수목 이벤트' / '화/수/목 한정', on 27 of its 28 branches; '첫방문 체험가' / '첫방문 이벤트' ›
#             '첫방문고객) … 1회 체험가'; '1인 1회 체험가', '일요일 특가 이벤트', '💫해피썬데이EVENT💫' as the group title). The other 80 (광교점 '해피위크
#             (매주 월~목)' 21, 광명점 '평일 이벤트' 18, 왕십리점 '⏰평일 타임 이벤트' 16, 일산점 '평일 이벤트 (10~17시)' 12, 의정부점 '화수목 타임 이벤트' 8, 명동점
#             '화수목 이벤트' 5) state nothing themselves but are no other tab's list: no other tab of the branch has them at that price
#             (but 광명점's showcase tab, 2 rows — SHOWCASE_SHARE), some are dearer there (광교점 '물광주사 2cc' 80,000 / '스킨부스터' 99,000; 광명점
#             '콜라움 240 6cc 1회' 350,000 / 500,000), and 일산점 puts its items titled '데이타임 이벤트' under the tab '평일 이벤트 (10~17시)'. Read from the saved data
#             only, not the site again: that 명동점's 5 (on no other tab; its '쥬베룩' tab sells '쥬베룩 2cc' at 149,000 against the tab's
#             '쥬베룩 스킨 2cc' 129,000, maybe not one product) are the tab's own is a guess. The 제모 signs of a wrong pair
#             fell from 1,900 rows (a 제모 tab over an item without '제모') / 4,413 (an item with '제모' under another tab) to 54 / 139,
#             all of them right: a 제모 tab's '인기 패키지 (겨드랑이 + 인중)' and '女) 겨드랑이 토닝', 제모 items in event tabs ('첫방문 체험가', '화수목 이벤트',
#             '해피아워 이벤트', '무제한 이벤트') and packages with a 제모 part ('겨드랑이토닝 + 겨드랑이 제모'). Items with their own condition words under
#             a tab without one fell from 1,183 rows to 167: trial cards each menu tab repeats (광주점 '레이저리프팅' › '첫 시술 체험가)슈링크유니버스
#             100샷 1회 체험가', the same price on its '첫시술 체험가' tab) and the items' own notes ('(1인 1회 가능)', '화수목) 리투오 6cc + …' in an
#             event tab). So 유앤아이's tab is read like any chain's category. Build of 2026-10-19 (--skip-scrape) against the old
#             rule (with the showcase rule, SHOWCASE_SHARE): 114 prices change — 112 유앤아이, 2 쁨 — and 83 of them leave the plain
#             comparison (20 with a comparison key), 2 enter it (쁨 부산점, 1 with a key). 41 get '평일 낮' (왕십리점 '⏰평일 타임 이벤트' 16, 일산점
#             '평일 이벤트 (10~17시)' 12 with 10:00-17:00, 의정부점 '화수목 타임 이벤트' 8, 명동점 '화수목 이벤트' 5); 42 the days alone with no tag
#             (groups.plain rule 2: 광교점 '해피위크 (매주 월~목)' 21 = 월~목, 광명점 '평일 이벤트' 18 = 평일, and 3 of its '수목 이벤트' prices = 수목 —
#             광명점's showcase tab '🏆인기 TOP 리프팅' repeats 5 of these at the same price, and took the condition away until the showcase rule;
#             it no longer stands for their tab either, 6 rows); 25 under '첫방문 체험가' (천안점 23, 건대·부천점 1) become 체험가 (section_kind;
#             they were 첫 방문 already by the tab name the collector glues in front of the group title). The 2 쁨 부산점 rows are the
#             showcase rule alone: '[가을 한정 컬렉션] 울트라인 100샷' 249,000 and '… 풀페이스 셀르디엠 1vial' 490,000 were 한정가 by the '한정' of the
#             copy on its '이벤트' page (a showcase) and are 일반 as the category pages list them, also without the label ('울트라인 100샷' 249,000).
CAT_UNPAIRED = set()
# '신규 런칭' / '신규입고' / '신규 도입': a new device or product, not a first visit — taken out of the category, the group title and
# the option before the TAGS read them. The first-visit words stay: '신규 고객', '신규 회원', '신규가입', '신규 방문', '첫방문 신규'
# (and '신규 런칭 기념 신규 고객' keeps its second '신규'). Until 2026-10-16 only the category lost them, and every '신규' of the
# group title and option made a price 첫 방문: 64 rows of the saved data, all of them a new device (data2/accepted/*.csv and
# clean.csv have no other '신규'): 밴스 36 ('★울쎄라피프라임 신규런칭★ …' 15, '(알파팁 신규도입)'), 쁨 16 ('[신규입고] 스킨핏팅
# 고주파, 세르프', '[신규런칭] 슈링크 유니버스 울트라 300샷'), 톡스앤필 7 ('[신규런칭] 엘라비에 RE2O', '[신규런칭이벤트]덴서티 300샷'),
# 데이뷰 3 ('NMN X 나드샷 신규 런칭'; '첫방문 이벤트 · 호남권 신규 런칭 …' stays 첫 방문 by its own '첫방문'), 닥터에버스 2 ('탄생주사
# 신규 런칭 : …'). Read in all three (build of 2026-10-16, --skip-scrape): the 64 lose 첫 방문 (2 keep their own 1인 1회), 58 enter
# the plain comparison, 22 of them with a comparison key — 쁨 부평점 '[신규런칭] 슈링크 유니버스 울트라 100샷 / 300샷' (X11 / X12), 밴스
# 광주's price list under '울쎄라피프라임 ★… 신규런칭★' / '써마지 FLX ★… 신규런칭★' (X13–X16), 톡스앤필 제주점 덴서티 300샷 / 600샷.
NEW_ITEM = re.compile(r"신규\s*(?:런칭|입고|도입|오픈|출시)")
# '1회 한정' (once only) is a 1인 1회 condition where it limits the price, not where it is the item's own count — read as
# build2/xkeys.py reads 'N회 한정' (LIMIT_NOTE, lsy2825/skin#80: a purchase limit in a note, the option's count in its own words):
#   in the category or group title (a section heading over the items): 닥터에버스 미사점 '부가세 포함 만원(1회 한정) 1.96만' (9 prices of
#     10,000원 — 국산 사각턱보톡스 50유닛 stood for 미사점 in X01 at 10,000원 instead of its 14,000원), 데이뷰 인천구월점 '골라골라 리프팅 페스티벌 (1회 한정)' (7),
#     데이뷰 여의도점 '1회한정 써마지FLX' (13)
#   in the option only as a note — in brackets, closing a label, or after '*': '[1회 한정] 쥬베룩볼륨 4cc', '레스틸렌 1cc (1회 한정)',
#     '리투오 1회 (초진/재진 1회 한정)', '1회 한정) 울쎄라피 프라임 100샷', '페이스 온다리프팅 40KJ [1회 한정]'
# Not: '아쿠아필 1회 한정' / '비타민 관리 1회 한정' (유앤아이: the option's count, like '1회 한정가'), '1회 한정가' / '1회 한정 특가' /
# '1회 한정 체험가' (the price of one session: '10회 한정가' is ten), a frequency ('(*주 1회 한정)' on 쁨 '바디 착색토닝 3개월
# 이용권' — how often a pass is used; '월별 1회', '연 1회'), and one choice in a choose-N list ('택4 - 라인리페어필(1회한정)/프리미엄
# 블랙필', 'LDM 6분(재생)(1회한정) 中 선택 4회' — that choice once within the package, 셀린). The tag never changes the session
# count (sessions() reads the name, and a '1회 한정' there stays the count or a purchase limit as before).
ONE_LIMIT = re.compile(r"(?<![\d.])(?<![주월년연달일별루]\s)(?<![주월년연달일별루])1\s*회\s*한정(?!\s*(?:특\s*|체험\s*)?가(?!\s*능))")
CHOICE = re.compile(r"택\s*\d|中|선택\s*\d")


def bracket_span(text, j):
    """text from the bracket opening at j to its close (the end when it never closes)"""
    d = 0
    for k in range(j, len(text)):
        if text[k] in "([":
            d += 1
        elif text[k] in ")]":
            d -= 1
            if not d:
                return text[j:k + 1]
    return text[j:]


def in_choice(text, m):
    """whether the '1회 한정' at match m is one item of a choose-N list: its bracket, past the note's own '(1회한정)', holds the
    택N / 中 / 선택 N ('(택4 - 라인리페어필(1회한정)/…/라라필)' in any place of the list, '…/LDM 6분(1회한정), 크라이오)'), or
    outside brackets it runs on into the list ('LDM 6분(재생)(1회한정) 中 선택 4회', '…(1회한정)/아쿠아필')"""
    st = []                             # brackets open at the match, innermost last
    for j, ch in enumerate(text[:m.start()]):
        if ch in "([":
            st.append(j)
        elif ch in ")]" and st:
            st.pop()
    close = re.match(r"\s*[)\]]", text[m.end():])
    rest = text[m.end():]
    if st and close:                    # the note's own bracket: '(1회한정)'
        st.pop()
        rest = rest[close.end():]
    if st:
        return bool(CHOICE.search(bracket_span(text, st[-1])))
    return bool(re.match(r"\s*(?:[/,·]|中)", rest))


def once_only(text, heading=False):
    """whether a '1회 한정' in text is a once-per-person limit (see ONE_LIMIT): anywhere in a heading (category / group title),
    only as a note in an option"""
    for m in ONE_LIMIT.finditer(text or ""):
        before, after = text[:m.start()], text[m.end():]
        if CHOICE.search(text) and in_choice(text, m):
            continue                    # one choice of a choose-N list
        if heading or "*" in before or re.match(r"\s*[)\]]", after) or before.count("(") > before.count(")") \
                or before.count("[") > before.count("]"):
            return True
    return False
# The price kind from the section a price is listed under (C, 2026-10-16). The kind rule read the option alone ('[1회 체험가] X',
# 'X (1회체험가)'), so a price under a trial or returning-customer section whose own name says nothing was compared as a plain price:
#   trial (체험가) — the section's title says it is a trial-price section: '1회 체험' / '첫 체험' (닥터에버스 홍대점 '언제나 가능한 1회 체험
#     이벤트', 셀린 노원점 '💚10월 바디1회체험&패키지💚'), or '체험' with 가 / 특가 / 초특가 / 이벤트 / EVENT / 쿠폰 (닥터에버스 부산서면점
#     '체험가이벤트', 밴스 '★1회체험가★', '피부관리 체험가 택 1 시술안내', 쁨 안산점's '1회 체험가' section). Not: '체험 후기' / '체험단' /
#     '체험 가능', '…체험가와 중복 적용가능' (밴스 '[첫방문 이벤트] … *1회체험가와 중복 적용가능*' is a first-visit section that says the
#     two offers add up), '체험전' (블리비 강남역점 '수입 레이저 체험전': a 기획전 whose one trial price says so itself). Only a price for
#     one visit (one_visit) is the trial: a package in the same section ('내맘대로 피부관리 5회 패키지', '피코토닝 10+10회', '피코토닝
#     10+10', '베이직 퀵 슬림바디 3주', '여성 팔 전체 제모 1년 무제한') is the section's other offer; '피코토닝 1+1회' and '얼굴 점제거(…개수
#     무제한)' are trials.
#   returning customers (한정가 — the app's '기간·수량·첫 방문 등 조건'; no tag of its own, user decision 2026-10-16) — '재방문' / '재내원' /
#     '기존 고객·회원·환자' (not '기존 고객 감사 이벤트', a thank-you) / '재구매' / '재진' in the option or the section: 쁨 천안점 '재방문
#     이벤트' (8 prices, plain until now), 밴스 '(재진고객한정)' (already 한정가 by its '한정'). Not when 초진 stands next to it: '초진/재진
#     모두가능', '(초재진가능)', '재진도 초진도', '[카톡플친대상/초진재진1회체험]', '(초진/재진SNS등록시)' are open to new and returning
#     customers alike. 데이뷰 '[재진] 1회 체험 이벤트' is 체험가 already (its options say 체험). The app's 내 견적 counts every 체험가 /
#     한정가 as one time per person (app/domain/pricing.js condClass 'once'): a first-time visitor gets the returning price for the first
#     session and '전에 이 시술을 받아 봤어요' leaves it out — the wrong way round for these 8 prices; the user decides (PR, ask to B).
# The option's own words come first (its 체험 / 한정 / 재방문), then the section's. A kind read from the section alone holds only when
# every page with that price says it (clean.main, like the tags): the same price on a page without the section is open to anyone —
# also under a slightly different name in the branch's plain price list (loose_name: 밴스 동탄 '피부스케일링' / '스케일링 1회' 39,000) — but
# a showcase page's copy is no such page (SHOWCASE_SHARE).
# Which section texts (section_texts): the group title always; the site's category too, except
#   a chain in CAT_UNPAIRED (none now; 유앤아이 until 2026-10-19, when its tabs held other tabs' products): the tab name a collector
#            glues in front of the group title ('첫방문 체험가 · 리쥬란 힐러' — scrape/uandi.py adds it to every '첫방문' tab's group) is
#            taken off as well
#   밴스 (CAT_MENU): the site menu '1회 체험가' also shows the branch's price-list cards, and the collector keeps the first menu a card is
#            seen in (scrape/vands.py), which is '1회 체험가' (or '이달의 이벤트') on nearly every branch. In the saved data of 2026-10-16
#            강남·구로점's '부위별 필러 시술안내' card under '1회 체험가' has the 필러/실리프팅 menu's prices (무제한 입술필러 89,000 · 무제한
#            애교필러 89,000 · 턱끝필러 1cc 49,000 in both), and inside one card the site marks each trial price itself ('바디리니어지 1부위
#            (1회체험가)' next to '바디인모드 1부위' — the collector keeps that note in the option). Of the menu's 689 saved prices with
#            no such note under a card title that says nothing, 295 have the same price in a price-list card of the branch (names compared
#            without brackets, 국산/수입, 1회 and sex words); read as a trial section with the rules here, the menu would make 311 of its
#            445 일반 prices under such titles 체험가 (242 with a comparison key; menus '1회 체험가' 261, '★1회체험가★' 43, '1회체험가' 7 —
#            the other 134 are packages or price-list twins). The collector could keep every menu a card is in (one that is only in
#            '1회 체험가' is a trial card) — a change for a later collection.
# Build of the saved data (collection 2026-10-14, --skip-scrape on 2026-10-17): 387 prices change kind — 379 → 체험가 (밴스 275 under
# trial card titles, 닥터에버스 80, 셀린 18, 쁨 3, 유앤아이 3), 8 → 한정가 (쁨 천안점) — and 220 of them leave the plain comparison (137
# with a comparison key); the others carried a condition tag already. 22 밴스 prices under a trial title stay plain: the branch's
# price list has them at the same price (the fold, or loose_name). Session counts do not change.
_TRIAL_SUF = r"(?:가(?!\s*능)|특가|초특가|이벤트|event|쿠폰)"
TRIAL_HEAD = re.compile(rf"(?:(?<![\d.])1\s*회|첫)\s*체험(?!\s*(?:후기|단|관|기|담))(?:\s*{_TRIAL_SUF})?|체험\s*{_TRIAL_SUF}", re.I)
TRIAL_NOTE = re.compile(r"\s*(?:와|과)?\s*(?:중복|함께|병행|제외|불가|미적용)")
RETURN = re.compile(r"재\s*방문|재\s*내원|기존\s*(?:고객|회원|환자)(?!\s*(?:님\s*)?(?:께\s*)?감사)|재\s*구매|재\s*진(?![행료단])")
NEW_OR_RETURN = re.compile(r"초\s*[/·,.]?\s*재\s*진|초\s*진")
CAT_MENU = {"밴스"}
# one_visit: a bare 'N+M' (N ≥ 2) with no amount after it is N+M sessions — '피코토닝 10+10' 650,000 (밴스 광주 '… 1인 1회 체험가'
# card), which sessions() reads as 1; '3+1부위', '300+300샷', '3+1 4cc', '3+1(4부위)', '2+2+콧대' are amounts of one session
PLUS_PACK = re.compile(r"(?<![\d.+])(?:[2-9]|\d{2,})\s*\+\s*\d+(?!\s*\(?\s*[\d.+]|\s*(?:cc|㏄|ml|샷|shot|부위|줄|유닛|unit|u(?![a-z])|개|kj|j(?![a-z])"
                       r"|앰플|바이알|만|천))", re.I)
FIRST_PLUS = re.compile(r"(?<![\d.+])1\s*\+\s*1\s*회")
COUNT_FREE = re.compile(r"개수\s*무제한|(?<![\d.+])1\s*회")
TERM = re.compile(r"이용권|패스권|회원권|(?<![\d.])\d+\s*(?:년|달|개월|주)")       # a pass or a period, not one visit


def trial_head(text):
    """whether a section title names a trial-price section (TRIAL_HEAD, not a note about another offer: TRIAL_NOTE)"""
    return any(not TRIAL_NOTE.match(text[m.end():]) for m in TRIAL_HEAD.finditer(text or ""))


def returning(text):
    """whether a text limits the price to returning customers ('재방문 이벤트'; not '초진/재진', '초재진', '재진도 초진도')"""
    return any(not NEW_OR_RETURN.search(text[max(0, m.start() - 8):m.end() + 8]) for m in RETURN.finditer(text or ""))


def section_texts(brand, grp, cat):
    """the section titles over a price that the kind rule reads (see above): the group title, and the category unless the chain is
    in CAT_UNPAIRED or CAT_MENU; for CAT_UNPAIRED without the tab name glued in front of the group title"""
    if brand in CAT_UNPAIRED:
        return [grp[len(cat) + 3:] if cat and grp.startswith(f"{cat} · ") else grp]
    return [grp] if brand in CAT_MENU else [grp, cat]


def one_visit(mname):
    """whether a price under a trial section is for one visit (section_kind): one session and no course — not '5회 패키지',
    '10+10회', a bare '10+10' (PLUS_PACK) or '3주' — or the trial's own forms: '1+1회', the first session and one more (밴스 이태원
    '피코토닝 1+1회' 9,900 — the same card lists '피코토닝 1+1회 (1회 체험가)' 9,900), and one visit with no limit on the count
    ('얼굴 점제거(2mm이하/개당, 개수 무제한)' 100, '무제한 염증주사 1회' 9,000; not a period or a pass: '1년 무제한', '…이용권')"""
    if COURSE.search(mname) or PLUS_PACK.search(mname):
        return False
    s = sessions(mname)
    return s == 1 or (s == 2 and bool(FIRST_PLUS.search(mname))) or \
        (s == 99 and bool(COUNT_FREE.search(mname)) and not TERM.search(mname))


def loose_name(opt):
    """an option as the plain-twin check of clean.main compares it: no word breaks, brackets or '·,/★♥*', no '1회' or 'THE' —
    '피부스케일링' / '스케일링 1회', 'THE 미희주사 눈밑 1회' / '미희주사 눈밑 1회', '블랙헤드관리(나비존)' / '블랙헤드 관리(나비존) 1회'"""
    n = unicodedata.normalize("NFKC", strip_event_prefix(opt or "")).casefold()
    n = re.sub(r"(?<![\d.+])1\s*회|(?<![a-z])the(?![a-z])", " ", n)
    return re.sub(r"[\s·,/★☆♥*()\[\]{}]+", "", n)


def section_kind(brand, grp, cat, mname):
    """the kind a price gets from its section alone: '체험가' for a one-session price under a trial section, '한정가' under a
    returning-customer section, '' otherwise (grp / cat normalized, mname = the matching name, for the session count)"""
    texts = section_texts(brand, grp, cat)
    if any(trial_head(t) for t in texts) and one_visit(mname):
        return "체험가"
    return "한정가" if any(returning(t) for t in texts) else ""
# The days and hours themselves (C1 다음, 2026-10-16 — data.json row fields 16 `days`, 17 `hours`), read from the same texts as the
# time tags (category + group title + option), so B's visit-day filter can tell a 화/수/목 or a 12시~17시 price from a Monday-Friday one:
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


def visit_when(grp, opt, cat=""):
    """(days, hours) of one price from its group title and option, and the site's category above them (cat: '' for a chain in
    CAT_UNPAIRED). All hold (the group's '평일' and the option's '화,수,목' = 화수목; the section '♥수목 해피아워♥' over a name
    with no days = 수목); when two share no day or hour, the text nearer the price wins (option over group title over category)."""
    days, hours = visit_days(cat), visit_hours(cat)
    for text in (grp, opt):
        d, h = visit_days(text), visit_hours(text)
        days = (days & d or d) if days and d else days or d
        hours = (_hours_and(hours, h) or h) if hours and h else hours or h
    return days, hours


def time_tags(brand, grp, opt, days, hours, cat=""):
    """the time-of-day condition of one price (see TAGS): ['평일 낮'] when the site limits the days to weekdays, ['시간대'] for a
    time limit that is not weekdays-only ('12시-3시', '해피아워', '토요일 10시~2시' — a weekend day in the days field never gives
    '평일 낮', whatever the words: the app would drop the price on the one day it is for), [] otherwise. days / hours =
    visit_when(grp, opt, cat); cat = the site's category, '' for a chain in CAT_UNPAIRED (only its condition words count: the
    regexes below and the days / hours). A day limit with no time window that WEEKDAY_WORDS do not name
    ('[평일 특가]', '토요일이벤트') gets neither: a day condition, not decided here (still untagged, as before 2026-10-16) — nor does a
    day limit the site says holds at any hour (ANY_TIME)."""
    text = f"{cat} {grp} {opt}"
    if days and not hours and ANY_TIME.search(text):
        return []
    window = bool(TIME_WORDS.search(text) or hours)
    day_word = brand in DAY_WORDS and DAY_WORDS[brand].search(text)
    weekday = bool(WEEKDAY_WORDS.search(text) or day_word)
    if days & WEEKEND:
        return [TIME_ONLY] if window or weekday else []
    if weekday or (window and days):
        return ["평일 낮"]
    return [TIME_ONLY] if window else []


def cond_tags(grp, opt, cat=""):
    """the TAGS of one price (첫 방문 · 일요일 · 타임세일 · 1인 1회) from its group title and option and the site's category (cat: ''
    for a chain in CAT_UNPAIRED). Only the TAGS words count in the category, and a new device ('…신규런칭', in any of the three)
    is no first visit: 닥터에버스 목동점 '*각 항목별 1인 1회 한정' › '① 아쿠아필(1,2,3단계)+LED+모델링팩' = 1인 1회, 쁨 '[신규입고]
    스킨핏팅 고주파, 세르프' › '세르프 리프팅 600샷' = none. A '1회 한정' is 1인 1회 in the category or group title, and in the option
    as a note only (once_only)"""
    text = " ".join(NEW_ITEM.sub(" ", t) for t in (cat, grp, opt))
    out = [t for t, p in TAGS if re.search(p, text)]
    if "1인 1회" not in out and (once_only(cat, True) or once_only(grp, True) or once_only(opt)):
        out.append("1인 1회")
    return out


def merge_tags(a, b):
    """tags of one price shown on two pages: a condition stays only when both pages state one — but the two time tags are one
    condition here: both '평일 낮' → '평일 낮', '평일 낮' and '시간대' → '시간대' (one page does not limit the days to weekdays;
    2026-10-16 review: the plain intersection made such a price a plain one)"""
    a, b = [t for t in a.split("·") if t], [t for t in b.split("·") if t]
    out = [t for t in a if t in b and t not in TIME_TAGS]
    ta, tb = [t for t in a if t in TIME_TAGS], [t for t in b if t in TIME_TAGS]
    if ta and tb:
        out.insert(0, "평일 낮" if ta == tb == ["평일 낮"] else TIME_ONLY)
    return "·".join(out)


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


# A showcase page repeats cards of the branch's other pages: at least SHOWCASE_SHARE of its items (and SHOWCASE_MIN or more) the
# branch also lists on another page at the same price under the same name (the option as written, spaces aside), taken from
# SHOWCASE_SOURCES or more other pages. The copy often loses the card's own group title: 유앤아이 광명점's tab '🏆인기 TOP 리프팅'
# (18 of its 19 items from 5 other tabs, collection of 2026-10-18) shows '울쎄라피프라임 600샷' twice under one title, at 1,680,000
# (the '수목 이벤트' price, group title '수목 이벤트') and 1,900,000 (the '레이저리프팅' menu price), and '볼뉴머 600샷 + 울쎄라피프라임
# 600샷' 2,100,000 from its '평일 이벤트' tab. So a showcase copy is no sign that a price is open to anyone: in the fold (clean.main)
# the other pages decide the condition (tags, days / hours) and the price kind as if the copy were not there, and the copy
# does not stand for the price list (nor for the plain twin of a section kind). The saved data of 2026-10-18 has 24 such pages: 쁨's '이벤트' page on 11 branches, 8 of
# 데이뷰 ('TOP 10', option lists that repeat each other), 블리비 부산 경성대점's '기획전', and 유앤아이 광명점's TOP tab, 광주점 '첫시술 체험가',
# 수원점 '입고 연장 이벤트', 시흥배곧점 '첫방문 이벤트' (whose items the menu tabs repeat, '첫방문E) …' in their own words). Only 광명점's 9 rows
# and 2 of 쁨 부산점 change (build of 2026-10-19; CAT_UNPAIRED above). A page whose items are all its own is never one.
SHOWCASE_SHARE, SHOWCASE_MIN, SHOWCASE_SOURCES = 0.8, 4, 3


def showcase_pages(raw):
    """{(brand, branch, category)} of the showcase pages in the raw rows (see SHOWCASE_SHARE)"""
    pages = defaultdict(lambda: defaultdict(set))       # (brand, branch) -> (name, sale) -> its categories
    for r in raw:
        name, sale = comp_name(strip_event_prefix(norm_text(r["option"]))).casefold(), price(r["sale"])
        if name and sale:
            pages[(r["brand"], r["branch"])][(name, sale)].add(r["category"] or "")
    out = set()
    for (brand, branch), items in pages.items():
        held = defaultdict(list)                         # category -> the category sets of its items
        for cats in items.values():
            for c in cats:
                held[c].append(cats)
        for c, lists in held.items():
            shared = [cats for cats in lists if len(cats) > 1]
            if len(lists) >= SHOWCASE_MIN and len(shared) >= SHOWCASE_SHARE * len(lists) \
                    and len(set().union(*shared) - {c}) >= SHOWCASE_SOURCES:
                out.add((brand, branch, c))
    return out


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
    '' for a tag list ('미백 | 톤업 | 색소 | 토닝'), a price tier ('20만원 39.21만') or an event name ('26년 10월 2차) 한글날 맞이 …').
    A new device's '신규 런칭 / 입고 / 도입' (NEW_ITEM) goes whole: TITLE_PROMO took only '런칭' and left '신규', which the app reads
    as 첫 방문 in the name — 밴스 수원망포 '셀르디엠 … 신규런칭!!! 시술안내' › '셀르디엠 1vial 캐뉼라 1회' (4 rows, 2026-10-16); a bracket
    left empty goes too ('[이벤트] …', '[신규입고] …')"""
    s = re.sub(r"[◆◇■□●○]", " ", s or "").strip()
    if not s or re.search(r"[|｜]", s):
        return ""
    t = TITLE_PROMO.sub(" ", TITLE_PRICE.sub(" ", TITLE_DATE.sub(" ", NEW_ITEM.sub(" ", s))))
    t = re.sub(r"\[\s*\]|\(\s*\)", " ", t)
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


# A section heading that starts with a note mark stands over priced items: '▼ 부가세 포함 10만원 19.6만 ▼' (2026-10-15), and the
# 닥터에버스 headings '※카카오톡 플러스친구 혜택' (19 branches), '※항목별 1회씩 적용' (구로·분당), '※시간 상관없이 적용가능' (강남, over its
# '화/수/목 이벤트'), '※카카오톡 플러스 친구로 예약 시 적용!' (천호, over '해피아워이벤트'). The collector before 2026-10-15 wrote the
# heading in front of every item name ('※카카오톡 플러스친구 혜택 올타이트 400샷 1회'; data2/accepted/drevers.csv of 2026-10-14), and
# NOTE read the name as a notice: 391 prices of 21 branches were dropped (2026-10-16). The heading is taken off the name (unglue)
# and stays the row's category, where the rules read its words like any section's: '항목별 1회씩 적용' → 1인 1회 (TAGS), VAT words
# (vat_of); a price heading is no product word (title_words). Its items all sit under a condition of their own as well
# (group '첫방문이벤트' → 첫 방문, '화/수/목 이벤트' → 평일 낮 · 화수목, '해피아워이벤트' → 시간대), so none is a plain price.
# '카카오톡 플러스친구 혜택' itself is no condition here: the price is for whoever adds the clinic's KakaoTalk channel (free, at once,
# no limit written) — like 데이뷰's '카톡플친 적용가' and 셀린's '[카톡플친대상/첫방문]' (shown in the name) and 닥터에버스's
# '해피아워 이벤트(카톡친구대상)' (the event name), none of which is a tag or a 한정가. What follows the heading is still checked as
# a notice (NOTE), and an item without a price never gets here (the collector skips it, '가격 없음(0원)'). The collector since
# 2026-10-15 keeps the name alone (scrape/drevers.py), so a new collection needs none of this.
NOTE_SECTION = re.compile(r"^[※▼]")
# the reasons a row is dropped for its words alone (NOTE, PAPER): a later rule can take such a row back without any clinic adding it
WORD_DROPS = ("안내 문구(가격 아님)", "서류 발급비(시술 아님)")


def unglue(opt, sec):
    """the option without the section heading written in front of it ('※카카오톡 플러스친구 혜택 올타이트 400샷 1회' under the
    section '※카카오톡 플러스친구 혜택' → '올타이트 400샷 1회'); as it is when the heading is not in front or nothing follows it"""
    if sec and len(sec) >= 4 and opt.startswith(sec) and opt[len(sec):].strip():
        return opt[len(sec):].strip()
    return opt


def back_key(r):
    """(brand, branch, section, item words) of a raw row — the same for the row an older collector wrote with its section heading
    in front of the name and for the one a later collection writes without it. The group title is left out: a later collection
    may title the item otherwise (scrape/drevers.py puts the 제모 menu headings there since 2026-10-16). So is the price: the item
    the previous build dropped is still no new one when its price moved before the next collection (검수 2026-10-16: 마곡점
    '울쎄라피 프라임 100샷 1회' 239,000 → 249,000 was listed as added) — the price change is not shown either, the app never had
    the old one"""
    sec = norm_text(r.get("category", ""))
    opt = unglue(norm_text(r.get("option", "")), sec)
    return r.get("brand", ""), r.get("branch", ""), comp_name(sec).casefold(), comp_name(opt).casefold()


def prev_dropped(path):
    """back_key of the rows a build dropped for their words alone (WORD_DROPS), from its issues.csv; empty when there is none.
    A row of this build with such a key is marked back (clean.csv): a rule took it back, the clinic did not add it — the app data
    (build2/appdata.py came_back) keeps it out of '새로 생김' (data-meta.json changes.added, achg.new). The key ignores the group
    title (back_key): a new collection writes the same item without the heading in front, and may title it otherwise."""
    if not os.path.exists(path):
        return set()
    try:
        with open(path, encoding="utf-8-sig") as f:
            return {back_key(r) for r in csv.DictReader(f) if r.get("action") == "제외" and r.get("reason") in WORD_DROPS}
    except (OSError, csv.Error, UnicodeDecodeError, KeyError):
        return set()


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


def prepare(r):
    """a raw row read as far as its names: {opt, grp, sale, orig, why, fix, hair, name} — why = the reason it is dropped (else
    None; the rest is then not read), fix = the list-price note for issues.csv (else None). Read twice: by shared_titles
    (before the fold) and by main, so both read every item the same way"""
    opt, grp = norm_text(r["option"]), norm_text(r["group"])
    # the page's section heading written in front of each product ('▼ 부가세 포함 10만원 19.6만 ▼ 1. 라라토닝 : …', 닥터에버스 동탄):
    # the heading stays the section (category, read for VAT and the conditions), the product is what follows — read whole, the
    # mark made the products a notice and they were dropped (NOTE_SECTION)
    sec = norm_text(r.get("category", ""))
    if NOTE_SECTION.match(sec):
        opt = unglue(opt, sec)
    sale, orig = price(r["sale"]), price(r["orig"])
    it = {"opt": opt, "grp": grp, "sale": sale, "orig": orig, "why": None, "fix": None, "hair": False, "name": ""}
    if not opt:
        it["why"] = "옵션 이름 없음"
    elif not sale:
        it["why"] = "가격 없음(0원)"
    elif NOTE.search(opt):
        it["why"] = "안내 문구(가격 아님)"
    elif PAPER.search(opt) or PAPER.search(grp):
        it["why"] = "서류 발급비(시술 아님)"
    elif sale > 50_000_000:
        it["why"] = "가격 비정상(5천만원 초과)"
    elif ISO.match(r.get("until") or "") and r["until"] < TODAY:
        it["why"] = f"이벤트 기간 지남({r['until']} 종료)"
    if it["why"]:
        return it
    if orig and orig < sale:
        it["fix"], orig = "정가가 판매가보다 낮음(사이트 표기 오류)", 0
    elif orig and orig >= sale * 10 and sale >= 1000:
        it["fix"], orig = "정가가 판매가의 10배 이상(사이트 오기 의심)", 0
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
    it.update({"opt": opt, "orig": orig, "hair": hair, "name": name})
    return it


def match_name(r, grp, opt, name):
    """the name used for matching (mname): the display name without ' · ', with the page's sex in front when the name has none"""
    mname = name.replace(" · ", " ")
    g = re.search(r"(남성|남자|여성|여자)", grp)
    if not g and (re.search(r"제모", f"{grp} {opt}") or taxonomy.hair_area(opt)):
        # a 제모 item whose sex is only in the page name (쁨 범계 '여성제모' / '남성제모' › '이마(헤어+삼자) 제모 1회'): the same option at
        # the same price on both pages is two products, and one key held both (2026-10-15). Only for 제모 items — 유앤아이's '여성제모'
        # tabs hold '女) 겨드랑이 토닝 1회' too (산본·안산점), and held every procedure while its collector paired the tabs wrong
        # (before lsy2825/skin#88).
        g = re.search(r"(남성|남자|여성|여자)", r["category"] or "")
    # the option's own sex mark wins ('女&男) 겨드랑이', '男) 인중'): the page's sex is not added on top (검증 6차: '여성 남성 브라질리언')
    if g and not re.search(r"남성|남자|여성|여자|男|女|\((?:남|여)\)|(?<![가-힣])(?:남|여)\)", unicodedata.normalize("NFKC", mname)):
        mname = f"[{g.group(1)}] {mname}"
    return mname


def pass_item(grp, opt):
    """a 1-year / unlimited pass (구독권): pass words, or a pass group title over an option that states no sessions"""
    return bool(SUBS.search(f"{grp} {opt}") or (pass_group(grp, opt) and not re.search(r"\d+\s*회", opt)))


def fold_name(mname, hair):
    """the matching name as the fold compares it: no word breaks or letter case, 남자 = 남성, 여자 = 여성"""
    return comp_name(strip_event_prefix(mname, hair)).casefold().replace("남자", "남성").replace("여자", "여성")


def title_own(title, name):
    """the words of a group title (title_words) that the item name does not hold already: what the title adds to the name"""
    n = comp_name(unicodedata.normalize("NFKC", name)).casefold()
    return frozenset(w for w in re.split(r"[\W_]+", unicodedata.normalize("NFKC", title).casefold()) if w and w not in n)


ADD_WORD = re.compile(r"추가")
MIN_SOLD = 3          # branches selling a name for the automatic groups to compare it (build2/groups.py MIN_BRANCHES)


def shared_titles(raw, items):
    """{row index: group title} for items whose product is their group title, not the option (2026-10-19). A branch writes one
    option line under several product titles: 유앤아이 광주점's tab '평일 제모데이 12회 (젠틀맥스 프로 플러스)' gives each product
    ('男) 팔전체 12회', '男) 다리전체 12회', '女) 팔전체 12회' …) the same line '제모데이 12회 이벤트 (평일 내원 고객 대상 / 젠틀맥스 프로
    플러스)'; 블리비 포항점 sells '바디 착색토닝(겨드랑이/팔꿈치/무릎) 1부위 1회' on its 레이저토닝 / 클라리티Ⅱ / 헐리우드 스펙트라 토닝 /
    스타워커 포토나 토닝 … pages; 톡스앤필 세종점 '[EVENT] 국산 필러 1cc' on its 턱 / 마리오네트 / 이마·관자 … 필러 pages. The line
    names a procedure, so the title stayed out of the name (prepare: only for a name without one), and the fold took products of
    one price for one item shown twice: 5 of 광주점's 579,000 products became one row, and 4 were gone.
    Such a line is one option of several products when (a) the branch sells it under two or more titles at two or more prices
    (one product shown on two pages has one price), and (b) two of its titles at one price — that the fold would join: no two
    different list prices — each add words the line lacks (title_own) and neither title's words hold the other's: a body area,
    sex, device or amount of its own ('男) 팔전체' / '男) 다리전체', '클라리티Ⅱ' / '헐리우드 스펙트라'). Then its rows take their
    title in front of the shown name (title_words; main keeps it out of mname): all of them when fewer than MIN_SOLD branches sell
    the line under that name (광주점's tab text names no product anywhere), else only the products that met an earlier row of
    their price: the rows the fold kept keep the line. A line other branches sell ('바디 착색토닝(…) 1부위 1회' at 60 블리비
    branches, on their device pages too, at prices that never met) is a name the automatic groups compare (build2/groups.py, by
    name): the branch's rows under it stay what they were, and the group still reads the branch's lowest price there (measured
    2026-10-19 — every row titled: 포항·천안점 left 6 착색토닝 groups, achg listed 14 '없어짐' and 88 branches' price levels moved;
    every row at a meeting price titled: 밴스 수원망포's '얼굴전체 스킨보톡스' went 139,000 → 159,000 in its group, a rise no
    clinic made). A row at the price of an earlier row whose title words agree with its own takes that row's title: one product
    on two pages (a title that is a part of the other, or names only the line's own product: 유앤아이 광명 '울쎄라피 프라임' ›
    '울쎄라피프라임 600샷' also on '🏆인기TOP리프팅'), which still folds. Neither counts: an add-on, sold the same
    on top of each product ('옵션5) 덴서티 하이 300샷 추가', '[추가] 포텐자 …' — the older rule folds it), nor a row of an event page
    (EVENT_PAGE: the same product at an event price beside the price list's — no sign of two products)."""
    sets, sold = defaultdict(list), defaultdict(set)
    for i, (r, it) in enumerate(zip(raw, items)):
        if it["why"]:
            continue
        opt, grp, name = it["opt"], it["grp"], it["name"]
        mname = match_name(r, grp, opt, name)
        sold[comp(name)].add((r["brand"], r["branch"]))
        if OPTION_LABEL.match(opt) or addon_name(mname) or r.get("addon") == "1" or ADD_WORD.search(opt) \
                or EVENT_PAGE.search(f"{r['category']} {grp}"):
            continue
        is_pass = r["brand"] != "리엔장" and pass_item(grp, opt)
        sets[(r["brand"], r["branch"], fold_name(mname, it["hair"]), is_pass)].append(i)
    out = {}
    for idx in sets.values():
        gkey = lambda i: comp_name(items[i]["grp"]).casefold()
        if len({gkey(i) for i in idx}) < 2 or len({items[i]["sale"] for i in idx}) < 2:
            continue
        own = {i: title_own(title_words(items[i]["grp"]), items[i]["name"]) for i in idx}
        # the fold would join them: one sale, and not two different list prices (main keeps those apart already)
        joins = lambda i, j: items[i]["sale"] == items[j]["sale"] \
            and not (items[i]["orig"] and items[j]["orig"] and items[i]["orig"] != items[j]["orig"])
        apart = lambda i, j: own[i] and own[j] and not (own[i] <= own[j] or own[j] <= own[i])
        if not any(joins(i, j) and gkey(i) != gkey(j) and apart(i, j) for n, i in enumerate(idx) for j in idx[n + 1:]):
            continue
        # a line MIN_SOLD or more branches sell under that name (the name as the automatic groups key it, xkeys.comp) is a name
        # the comparisons read there too (build2/groups.py): it stays on the rows the fold kept
        shared = any(len(sold[comp(items[i]["name"])]) >= MIN_SOLD for i in idx)
        title = {}
        for n, i in enumerate(idx):
            j = next((j for j in idx[:n] if joins(i, j) and not apart(i, j)), None)
            if j is not None:
                title[i] = title[j]                     # one product on two pages: one row, as before
            elif not shared or any(joins(i, x) for x in idx[:n]):
                title[i] = title_words(items[i]["grp"])
            else:
                title[i] = ""                           # a row the fold kept, of a line other branches sell
            if title[i] and comp_name(title[i]).casefold() not in comp_name(items[i]["name"]).casefold():
                out[i] = title[i]
    return out


def main():
    raw = load()
    # what the previous build dropped by its words alone, from its data2/issues.csv (the factory saves it with every build; this
    # build writes its own at the end) — a row of it that this build keeps is marked back
    dropped_before = prev_dropped(os.path.join(ROOT, "data2", "issues.csv"))
    vdef = vat_policy()
    issues, out, seen, seen_old, sex_of, sect_of, weak_of = [], [], {}, {}, {}, {}, {}
    showcase = showcase_pages(raw)
    items = [prepare(r) for r in raw]
    titled = shared_titles(raw, items)
    for i, r in enumerate(raw):
        it = items[i]
        if it["why"]:
            issues.append({**r, "action": "제외", "reason": it["why"]})
            continue
        if it["fix"]:
            issues.append({**r, "action": "정가 삭제", "reason": it["fix"]})
        opt, grp, sale, orig, hair, name = it["opt"], it["grp"], it["sale"], it["orig"], it["hair"], it["name"]
        mname = match_name(r, grp, opt, name)
        # one option line of several products: the product is its group title (shared_titles) — in the shown name and in both fold
        # keys below, not in mname: the comparison reads the line as before, as it reads it on the branches where its pages gave
        # other prices and nothing met (블리비 강남역 '바디 착색토닝 …' on its 레블라이트 / 레이저토닝 pages, 59,000 / 29,000 — no
        # title). Read with the title, the rows of only the branches where two prices met left their specs (6 착색토닝 keys at
        # 포항·천안점, 2 스킨보톡스 keys at 밴스 수원망포, measured 2026-10-19) and tagline titles became spec words
        title = titled.get(i, "")
        if title:
            name = f"{title} · {name}"
        text = f"{r['category']} {grp} {opt}"
        by_sect = False
        if r["brand"] == "리엔장":
            kind = "고시가"
        elif pass_item(grp, opt):
            # a 1-year / unlimited pass named only in the group title ('남성 1년 무제한제모 이벤트' › '남자얼굴제모' 690,000원) is not a
            # one-session price; an option that states its sessions ('발등+발가락 5회') is (2026-10-15)
            kind = "구독권"
        elif re.search(r"체험", f"{opt}"):
            kind = "체험가"
        elif ONCE.search(opt) or returning(opt):
            kind = "한정가"
        else:
            # the section's trial / returning-customer words (section_kind), read only when the option says nothing
            kind = section_kind(r["brand"], grp, norm_text(r["category"]), mname) or "일반"
            by_sect = kind != "일반"
        cat = next((c for c, p in CATS if re.search(p, text)), "기타")
        # 유앤아이 listed peels, skin care and boosters on its 제모 pages ('여성 제모' › 'FCR 필링 얼굴전체 1회' — another tab's items, before
        # lsy2825/skin#88; '여성제모(아포지플러스)' › '女) 겨드랑이 토닝 1회' on 2026-10-18): filed as 제모 they became '… 제모' spec labels
        # (2026-10-14). On a 제모 page the item's own words decide when they name another kind of procedure
        # (a body area alone — '종아리+무릎' — is still 제모 there)
        if cat == "제모" and not re.search(CATS[0][1], f"{grp} {opt}"):
            cat = next((c for c, p in CATS if c not in ("제모", "바디") and re.search(p, f"{grp} {opt}")), cat)
        # the category's condition words only (none for a chain in CAT_UNPAIRED)
        cond_cat = "" if r["brand"] in CAT_UNPAIRED else norm_text(r["category"])
        days, hours = visit_when(grp, opt, cond_cat)
        tags = time_tags(r["brand"], grp, opt, days, hours, cond_cat) + cond_tags(grp, opt, cond_cat)
        if re.search(r"일요일|선데이|썬데이", grp):
            tags.append("일요일")
        row = {"brand": r["brand"], "branch": r["branch"], "src_cat": r["category"], "group": grp, "option": opt,
               "name": name, "mname": mname, "cat": cat, "kind": kind, "sale": sale, "orig": orig or "",
               "addon": "1" if OPTION_LABEL.match(opt) or addon_name(mname) else r["addon"], "sess": sessions(mname), "tags": "·".join(dict.fromkeys(tags)),
               "days": days, "hours": hours,
               "until": r["until"], "url": r["url"], "fetched_at": r["fetched_at"],
               "vat": vat_of(r, grp, opt, vdef), "back": "1" if back_key(r) in dropped_before else ""}
        # the same item shown on two pages of one branch ('[메가세일] X 체험가' and 'X 체험가', same price) -> one row.
        # 2026-10-15 (개선 보고서 E4·E10): the list price no longer has to match — a 기획전 page and the category page often give the
        # same item at the same price with different list prices (블리비 덴서티 600샷 1,590,000원: 정가 3,100,000 / 3,000,000) —
        # and names that differ only in word breaks or letter case are one item ('플라센타관리' / '플라센타 관리'). mname, not the
        # option, decides: it carries the sex from the group title, so '남성 제모 › 미간or코 제모 1회' and '여성 제모 › 미간or코 제모
        # 1회' at the same price stay two rows. Two price-list pages (not events) with different group titles and list prices hold
        # different products whose name lacks the device or colour ('젠틀맥스 › 팔 하완 5회' / '아포지 › 팔 하완 5회'): not folded.
        # The older rule still folds too: same option, sale and list price (an add-on listed on several product pages, '온다 리프팅 ›
        # 옵션5) 덴서티 하이 300샷 추가' / '인모드 리프팅 › …'), within one sex (남자 = 남성) or with a row that names no sex.
        # One option line of several products took its group title (shared_titles, 2026-10-19): both keys carry the title (mname
        # does not), so neither rule folds '男) 팔전체 12회 · 제모데이 …' with '男) 다리전체 12회 · 제모데이 …' by their shared line.
        m = re.search(r"남성|남자|여성|여자|男|女", unicodedata.normalize("NFKC", mname))   # '女)' (유앤아이) is a sex too
        sex = SEX.get(m.group(), m.group()) if m else ""
        # a pass (구독권) never folds with a per-session row at the same price: both keys carry it
        is_pass = kind == "구독권"
        weak = (r["brand"], r["branch"], r["category"] or "") in showcase      # a showcase page's copy (SHOWCASE_SHARE)
        k_old = (r["brand"], r["branch"], strip_event_prefix(opt, hair), sale, orig, is_pass, title)
        k = (r["brand"], r["branch"], fold_name(mname, hair), sale, is_pass, title)
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
            if weak and not weak_of[id(prev)]:
                pass     # a showcase page's copy: the other page's condition and kind stand (SHOWCASE_SHARE)
            elif weak_of[id(prev)] and not weak:
                # the card a showcase page showed first: this page's condition and kind decide
                prev.update({"tags": row["tags"], "days": row["days"], "hours": row["hours"], "kind": kind})
                sect_of[id(prev)], weak_of[id(prev)] = by_sect, False
            else:
                # a condition stays only when every page says it: the same price on a page without it is open to anyone (a
                # union turned 블리비's category-page prices into '평일 낮' / '첫 방문' ones — the unconditional lowest price was lost)
                prev["tags"] = merge_tags(prev["tags"], row["tags"])
                # a kind read from the section alone (section_kind) stays only when every page says it, like the tags
                if sect_of.get(id(prev)) and kind == "일반":
                    prev["kind"], sect_of[id(prev)] = "일반", False
                elif sect_of.get(id(prev)) and not by_sect and kind == prev["kind"]:
                    sect_of[id(prev)] = False
                prev["days"], prev["hours"] = visit_merge((prev["days"], prev["hours"]), (row["days"], row["hours"]))
            if row["addon"] == "1":
                prev["addon"] = "1"
            if row["back"] != "1":
                prev["back"] = ""        # one of its pages was kept by the previous build too: the price was there
            if event_page(prev) and not event_page(row) and not weak:
                # the price list row wins (a showcase page is none): its category, link, list price and end date (an event's end
                # date expired the row); the category stays when the first row's own words already gave one (a '필러/실리프팅' page
                # read as 리프팅)
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
        sect_of[id(row)] = by_sect
        weak_of[id(row)] = weak
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
    # a kind read from the section alone (section_kind) is not the price's own when the branch's plain price list sells the same
    # product at the same price under a slightly different name (the fold above needs the same name): 밴스 동탄's '피부관리 체험가
    # 시술안내' cards repeat its '베이직 / 프리미엄 피부관리' cards ('피부스케일링' / '스케일링 1회' 39,000, '블랙필' / '블랙필 1회' 49,000),
    # 이태원's '★1회체험가★' card its price list ('미희주사 눈밑 1회' / 'THE 미희주사 눈밑 1회' 290,000, '편평사마귀 제거 1개당' /
    # '편평사마귀제거' 2,900; 밴스 천안 '[1회 체험가 초특가]' › '얼굴 점제거(2mm이하/개당, 개수 무제한)' / '점제거 (2mm이하)' 100 a mole).
    # Same branch, sale and visits (sessions; one for a visit with no limit on the count, one_visit), one sex (or none named), a plain
    # row (kind 일반 not from a section, no tag, no days / hours, not only on a showcase page — SHOWCASE_SHARE), one loose name
    # inside the other (loose_name)
    plain_names = defaultdict(list)
    visits = lambda row: 1 if row["sess"] == 99 and one_visit(row["mname"]) else row["sess"]
    for row in out:
        if row["kind"] == "일반" and not sect_of.get(id(row)) and not row["tags"] and not row["days"] and not row["hours"] \
                and not weak_of[id(row)]:
            plain_names[(row["brand"], row["branch"], row["sale"], visits(row))].append((sex_of[id(row)], loose_name(row["option"])))
    for row in out:
        if sect_of.get(id(row)):
            me, sx = loose_name(row["option"]), sex_of[id(row)]
            if len(me) >= 2 and any(len(p) >= 2 and (me in p or p in me) and (x == sx or "" in (x, sx))
                                    for x, p in plain_names.get((row["brand"], row["branch"], row["sale"], visits(row)), [])):
                row["kind"], sect_of[id(row)] = "일반", False
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
    print(f"one option line of several products: {len(titled)} rows took their group title (shared_titles)",
          dict(Counter(raw[i]["brand"] for i in titled)))
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
