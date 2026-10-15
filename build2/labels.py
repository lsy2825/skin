"""Spec labels shown in the compare tab ('리쥬란 HB 플러스 2cc', '피코토닝 재생 5회') — what one may not contain.

2026-10-14: labels such as '피코토닝 20만원3921만재생' and '피코토닝 미백톤업색소토닝' reached the app. A clinic's section
title (a price tier '20만원 39.21만', a tag list '미백 | 톤업 | 색소 | 토닝', an event name '26년 10월 2차) 한글날 맞이 …') had
been glued in front of the item name, and the leftover words were joined without spaces. The causes are fixed where they
start (clean.title_words, taxonomy._spaced); this check stops the next new kind of noise at the build:
taxonomy.build() makes no compare key from a label with a problem (its prices stay in the app, just not grouped) and lists
it in data2/variants.json stats.label_rejected; tests/labels_test.py runs the same rules on the shipped data.

Rules
  가격    '20만원', '39.21만', '99,000원', '3921만' (energy '8만 J' and a coin size '500원' are not prices)
  날짜    '10월 1일', '26년 10월', '까지'
  홍보    이벤트·특가·할인·혜택·맞이·누림·기념·추천·안내·카카오톡 …
  기호    | ｜ ※ ♥ ★ ☆
  괄호    빈 괄호 '()', 괄호 안쪽 끝 공백 '(1회 )', 짝이 안 맞는 괄호 ('E) 비타민관리')
  붙은 글자 a word of 8+ letters that is not written that way (spaces and all) in any of the key's own price names —
          i.e. words we joined, not the clinic ('울쎄라피프라임300샷' is how a clinic wrote it)
  부위만  nothing but a body area, a size or an add-on word is left ('눈밑', '이마 3회', '이내 10mm 1개', '풀커버',
          '가운데부위 추가시'): the product was only in the clinic's section title, so different products (기본색소 / 프리미엄색소
          반영구, 미희주사 / other injections) would share one key (2026-10-15, 개선 보고서 E3)

2026-10-15 (개선 보고서 E1): the clinics' own explanation in brackets is shown as '병원 설명' (taxonomy.build, family desc).
desc_problems() keeps out what is a sales condition or a pitch rather than a description: '카톡플친 적용가', '리터치 불가',
'자갈턱보톡스 병행 추천', '볼륨과 주름개선을 동시에 !'.
"""
import re

PRICE = re.compile(r"\d+(?:[.,]\d+)?\s*만\s*원|\d+(?:\.\d+)?만(?!\s*[J샷줄]|[a-zA-Z가-힣])|\d{1,3}(?:,\d{3})+\s*원|(?<![\d.,])\d{4,}\s*원|만원")
DATE = re.compile(r"\d{1,2}\s*월\s*\d{1,2}\s*일|\d{2,4}\s*년\s*\d{1,2}\s*월|까지")
PROMO = re.compile(r"이벤트|특가|할인|혜택|맞이|누림|기념|잔치|페스타|추천|플러스친구|카카오톡|런칭|안내|선착순|최저가")
MARK = re.compile(r"[|｜※♥★☆]")
WORD = re.compile(r"[\s·()/,+\[\]]+")
LONG = 8
# words that name where or how much, never what: a label made only of these has lost its product (rule 부위만)
AREA_ONLY = re.compile(r"(?:얼굴|페이스|바디|전신|전체|얼굴전체|부분|부위|\d*부위|특수부위|가운데부위|이마|미간|눈밑|눈가|눈썹|애교|팔자|관자|볼|앞볼|뒷볼|"
                       r"광대|앞광대|턱|턱끝|턱선|턱라인|이중턱|코|콧등|입술|입꼬리|인중|목|목주름|귀|귓볼|두피|헤어라인|구렛나루|가슴|등|배|복부|옆구리|"
                       r"허리|엉덩이|팔|팔뚝|겨드랑이|손|손등|발|발등|다리|허벅지|종아리|무릎|풀커버|하프커버|이내|이하|이상|미만|추가|추가시|추가당|당|개당|"
                       r"추가\*|기본|1개|개)")
UNIT = re.compile(r"\d+(?:\.\d+)?\s*(?:U|cc|ml|샷|KJ|부위|개|줄|시린지|vial|분|mm|회)(?![a-zA-Z])", re.I)
# a bracketed explanation that is a sales condition or a pitch, not what the product is (desc_problems)
DESC_PROMO = re.compile(r"적용가|플친|플러스\s*친구|카톡|카카오|첫\s*만남|첫\s*방문|이벤트|특가|할인|혜택|추천|병행|불가|가능|무관|상관\s*없|"
                        r"진행|미진행|동시에|한정|선착순|증정|무료|[!?~]")


def _norm(s):
    s = re.sub(r"(\d+)\s*(유닛|단위|unit|units|Unit|UNIT|u|U)(?![a-zA-Z])", r"\1U", s or "")
    s = re.sub(r"(\d)\s*(CC|cC|Cc|cc)", r"\1cc", s)
    return re.sub(r"(\d),(\d{3})", r"\1\2", s)


def problems(label, names=None):
    """→ list of problem names ('' list = fine). names: the key's own price names, for the glued-word rule (skipped when None)"""
    out = []
    if PRICE.search(label):
        out.append("가격")
    if DATE.search(label):
        out.append("날짜")
    if PROMO.search(label):
        out.append("홍보")
    if MARK.search(label):
        out.append("기호")
    if re.search(r"\(\s*\)|\[\s*\]|\(\s|\s\)", label) or label.count("(") != label.count(")"):
        out.append("괄호")
    core = UNIT.sub(" ", re.sub(r"\([^()]*\)|\[[^\]]*\]", " ", label))
    words = [w for w in re.split(r"[\s·/,+]+", core) if w]
    if not words or all(AREA_ONLY.fullmatch(w) for w in words):
        out.append("부위만")
    if names is not None:
        src = [_norm(n) for n in names]
        for w in WORD.split(label):
            if len(re.sub(r"[^가-힣A-Za-z0-9]", "", w)) >= LONG and not any(w in s for s in src):
                out.append("붙은 글자")
                break
    return out


def desc_problems(text):
    """→ list of problem names for one bracketed explanation shown as '병원 설명' ('' list = fine)"""
    out = []
    if DESC_PROMO.search(text or ""):
        out.append("판촉·조건")
    if PRICE.search(text or "") or DATE.search(text or ""):
        out.append("가격·날짜")
    return out
