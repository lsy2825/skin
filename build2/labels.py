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
"""
import re

PRICE = re.compile(r"\d+(?:[.,]\d+)?\s*만\s*원|\d+(?:\.\d+)?만(?!\s*[J샷줄]|[a-zA-Z가-힣])|\d{1,3}(?:,\d{3})+\s*원|(?<![\d.,])\d{4,}\s*원|만원")
DATE = re.compile(r"\d{1,2}\s*월\s*\d{1,2}\s*일|\d{2,4}\s*년\s*\d{1,2}\s*월|까지")
PROMO = re.compile(r"이벤트|특가|할인|혜택|맞이|누림|기념|잔치|페스타|추천|플러스친구|카카오톡|런칭|안내|선착순|최저가")
MARK = re.compile(r"[|｜※♥★☆]")
WORD = re.compile(r"[\s·()/,+\[\]]+")
LONG = 8


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
    if names is not None:
        src = [_norm(n) for n in names]
        for w in WORD.split(label):
            if len(re.sub(r"[^가-힣A-Za-z0-9]", "", w)) >= LONG and not any(w in s for s in src):
                out.append("붙은 글자")
                break
    return out
