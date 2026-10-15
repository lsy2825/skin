#!/usr/bin/env python3
"""Treatment taxonomy: every price row → family (제품군) → variant (same spec), for the compare tab.

The 36 hand-made cross-brand keys in xkeys.py stay as they are (tested, used by carts and alerts). This module adds
variant keys for everything else, built from the names themselves:

  family    one product line (리쥬란, 슈링크, 보톡스, 겨드랑이 제모 …), found by `rx` on the name without (…) / […]
  tags      words that change what you get (국산/수입, 사각턱/주름/스킨, 아이/바디, FX/FORMA …), searched in the
            whole name; each family lists its own
  residual  any other word left in the short name (after the family, tags, amounts, sessions and filler words are
            removed). Unknown words are kept, so two rows are only merged when nothing in their names differs
  amount    50U / 2cc / 300샷 / 10KJ / 1부위 … (two different amounts of the same unit = unclear → no key)
  sessions  1회, 3회, 5회 … (이용권·무제한·구독 = no key)

Rows that are bundles (two families, '+', 패키지), add-on only options, conditional prices ('300샷 이상 시') or
subscriptions get no variant. A variant becomes a compare key when it is sold at 3 or more branches. Its id is a
hash of the variant signature, so it stays the same from week to week while the names stay the same.

usage: python build2/taxonomy.py            # self-test
       python build2/taxonomy.py --report   # variants found in data2/clean.csv → data2/variants_report.txt
"""
import hashlib, re, sys, unicodedata
from collections import Counter, defaultdict

from xkeys import ADDON, COND, addon_only, comp, sessions
import labels

# compare-tab categories (same names as xkeys categories)
CATS = ["톡신", "윤곽·필러", "리프팅", "부스터", "피부", "제모·바디", "패키지", "기타"]

def T(label, rx, where=None, split=None, scope="short"):
    """a tag. where: 'pre' (before the family name in labels), 'post' (after it) or 'hide' (signature only);
    split: family name the tag moves the row to ('사각턱 보톡스'); scope: 'short' = name without (…)/[…], 'full' = whole name"""
    return dict(label=label, rx=re.compile(rx), where=where or ("hide" if split else "pre"), split=split, scope=scope)


# origin / tier words: also inside brackets ('스킨보톡스(국산 일반형)', '[국내산]')
ORIGIN = [T("국산", r"(?<![미외])국산|국내산", scope="full"), T("독일산", r"독일산?|제오민", scope="full"), T("미국산", r"미국산?|엘러간|앨러간", scope="full"),
          T("수입", r"수입산?|외국산|외산", scope="full"), T("프리미엄", r"프리미엄|코어톡스|이노톡스|고순도|내성", scope="full"), T("파워", r"파워|용량업|두배")]
EYE = T("아이", r"아이(?!라인|돌)|눈가전용")
# 제모 devices as the clinics write them ('제모(아포지 플러스)', '[남성제모] 젠틀맥스 …'): a different device is a different
# treatment, so it is part of the variant (4.0 audit: one key mixed 아포지 플러스 9,900원 and 에일린 19,000원)
HAIR_DEVICES = [T("아포지 플러스", r"아포지", "post", scope="full"), T("젠틀맥스 프로 플러스", r"젠틀맥스", "post", scope="full"),
                T("포토나 아발란체", r"포토나|아발란체", "post", scope="full"), T("클라리티Ⅱ", r"클라리티", "post", scope="full"),
                T("에일린", r"에일린", "post", scope="full"), T("엘리트 플러스", r"엘리트", "post", scope="full"),
                T("프라임 레이즈", r"프라임레이즈", "post", scope="full"), T("소프라노", r"소프라노", "post", scope="full")]


def BODY(fam, cat="제모·바디"):
    return T("바디", r"바디", split=(f"바디 {fam}", cat))


def AREA(label, rx, fam, where="hide"):
    return T(label, rx, where=where, split=(fam, None))


FAMILIES = [
    # ---------------- 톡신: one family per area, so '주름 보톡스' and '스킨보톡스' are told apart
    dict(id="toxin", cat="톡신", name="보톡스", rx=r"톡신|모공톡스|더모톡|스킨톡|쁨킨톡", stop=r"톡신|톡스|일반형|정품|소분|단독|부위당|중택1|택1|당|부분",
         tags=ORIGIN + [
             AREA("스킨", r"스킨톡신|더모톡신|더마톡신|쁨킨톡신|스킨보톡|더모톡|스킨톡", "스킨보톡스"), AREA("모공", r"모공|나비존", "모공 보톡스"),
             AREA("다한증", r"다한증", "다한증 보톡스"), AREA("침샘", r"침샘", "침샘 보톡스"),
             AREA("바디", r"바디", "바디 보톡스"), AREA("승모근", r"승모근", "바디 보톡스", "post"), AREA("종아리", r"종아리", "바디 보톡스", "post"),
             AREA("허벅지", r"허벅지", "바디 보톡스", "post"), AREA("팔뚝", r"팔뚝", "바디 보톡스", "post"),
             AREA("턱라인", r"턱라인|탄력톡신", "턱라인 보톡스"), AREA("자갈턱", r"자갈턱", "자갈턱 보톡스"), AREA("이중턱", r"이중턱", "이중턱 보톡스"),
             AREA("사각턱", r"사각턱|^턱|(?<![자갈이중])턱(?!라인|끝)", "사각턱 보톡스"), AREA("측두근", r"측두", "측두근 보톡스"),
             AREA("입꼬리", r"입꼬리", "입꼬리 보톡스"), AREA("콧볼", r"콧볼", "콧볼 보톡스"), AREA("잇몸", r"잇몸|거미스마일", "잇몸 보톡스"),
             AREA("광경근", r"광경근", "목 광경근 보톡스"), AREA("목주름", r"목주름", "목주름 보톡스"), AREA("두피", r"두피|탈모", "두피 보톡스"),
             AREA("이마", r"이마", "주름 보톡스", "post"), AREA("미간", r"미간", "주름 보톡스", "post"), AREA("눈가", r"눈가", "주름 보톡스", "post"),
             AREA("주름", r"주름|한부위", "주름 보톡스"),
             T("얼굴전체", r"얼굴전체|풀페이스", "post"), T("겨드랑이", r"겨드랑이", "post"), T("손·발", r"손|발", "post"),
             AREA("광대", r"광대", "광대 보톡스"), AREA("특수부위", r"특수부위", "특수부위 보톡스")]),
    dict(id="watertox", cat="톡신", name="물톡스", rx=r"물톡스", stop=r"물톡스", tags=ORIGIN),
    # ---------------- 윤곽·필러
    dict(id="filler", cat="윤곽·필러", name="필러", rx=r"필러(?!녹이)|벨로테로(?!리바이브)|쥬비덤|레스틸렌|리쥬비엘", stop=r"필러|히알루론산|시린지당|1시린지당",
         tags=ORIGIN[:5] + [
             T("벨로테로", r"벨로테로", "post", scope="full"), T("쥬비덤", r"쥬비덤", "post", scope="full"), T("레스틸렌", r"레스틸렌", "post", scope="full"),
             T("리쥬비엘", r"리쥬비엘", "post", scope="full"), T("아띠에르", r"아띠에르", "post", scope="full"), T("뉴라미스", r"뉴라미스", "post", scope="full"),
             AREA("애교", r"애교", "애교 필러"), AREA("코", r"(?<![가-힣])코|^코|콧대", "코 필러"), AREA("턱끝", r"턱끝|V라인", "턱끝 필러"),
             AREA("입술", r"입술", "입술 필러"), AREA("눈밑", r"눈밑", "눈밑 필러"), AREA("팔자", r"팔자", "팔자 필러"), AREA("이마", r"이마", "이마 필러"),
             AREA("귀", r"귀|귓볼|귓", "귀 필러"), AREA("앞볼", r"앞볼|(?<!귓)볼(?!륨|뉴머)", "앞볼 필러"), AREA("관자", r"관자", "관자 필러"), AREA("목주름", r"목주름", "목주름 필러"),
             AREA("손등", r"손등", "손등 필러"), AREA("주름", r"주름", "주름 필러"), AREA("페이스", r"페이스|얼굴", "얼굴 필러")]),
    dict(id="hyal", cat="윤곽·필러", name="필러 녹이는 주사(히알라제)", rx=r"히알라제|필러녹이", stop=r"는주사|주사|히알라제|필러녹이는|녹이는", tags=[]),
    dict(id="contour", cat="윤곽·필러", name="윤곽주사", rx=r"윤곽주사|컨투어링주사|윤곽", stop=r"주사|윤곽|컨투어링",
         tags=ORIGIN[:5] + [T("V", r"V윤곽"), T("대용량", r"대용량"), T("풀페이스", r"풀페이스", "post"), BODY("윤곽주사")]),
    dict(id="accu", cat="윤곽·필러", name="아큐주사", rx=r"아큐주사", stop=r"주사", tags=[T("파워", r"파워"), T("대용량", r"대용량")]),
    dict(id="velyv", cat="윤곽·필러", name="블리비V주사", rx=r"블리비V주사", stop=r"주사", tags=[T("월 책임제", r"월책임제", "post")]),
    dict(id="chin2", cat="윤곽·필러", name="이중턱 주사", rx=r"이중턱(개선)?주사", stop=r"주사|개선", tags=[]),
    dict(id="ps", cat="윤곽·필러", name="PS주사", rx=r"PS주사", stop=r"주사", tags=[T("대용량", r"대용량")]),
    dict(id="sculpt", cat="윤곽·필러", name="조각주사", rx=r"조각주사", stop=r"주사",
         tags=[AREA("코", r"코", "코 조각주사"), AREA("민소매", r"민소매", "민소매 조각주사", ), AREA("종아리", r"종아리", "종아리 조각주사"), BODY("조각주사")]),
    dict(id="cheek", cat="윤곽·필러", name="광대주사", rx=r"광대주사", stop=r"주사", tags=[]),
    dict(id="girlgroup", cat="윤곽·필러", name="걸그룹주사", rx=r"걸그룹주사", stop=r"주사", tags=[]),
    dict(id="eyefat", cat="윤곽·필러", name="눈밑 주사", rx=r"눈밑(지방재배치|동안)?주사", stop=r"주사", tags=[T("지방재배치", r"지방재배치", "post"), T("동안", r"동안", "post")]),
    dict(id="neckline", cat="윤곽·필러", name="목주름 지우개 주사", rx=r"목주름지우개주사", stop=r"목주름지우개주사", tags=[]),
    dict(id="radiesse", cat="윤곽·필러", name="레디어스", rx=r"레디어스", stop=r"레디어스|1vial|vial", tags=[T("미세주름", r"미세주름"), T("손등·목주름", r"손등|목주름", "post")]),
    dict(id="sculptra", cat="윤곽·필러", name="스컬트라", rx=r"스컬트라", stop=r"스컬트라", tags=[]),
    dict(id="ellanse", cat="윤곽·필러", name="엘란쎄", rx=r"엘란쎄", stop=r"엘란쎄|리프팅코드", tags=[]),
    # ---------------- 리프팅
    dict(id="shrink", cat="리프팅", name="슈링크 유니버스", rx=r"슈링크", stop=r"슈링크|유니버스|리프팅",
         tags=[EYE, T("V", r"V슈링크|브이슈링크"), T("파워", r"파워"), T("울트라 부스터", r"울트라부스터|부스터", "post"), T("울트라F", r"울트라F", "post"),
               T("울트라", r"울트라", "post"), T("더마", r"더마", "post"), T("이중턱", r"이중턱", "post"), T("리미티드", r"리미티드", "post"), BODY("슈링크")]),
    dict(id="ulthera", cat="리프팅", name="울쎄라", rx=r"울쎄라", stop=r"울쎄라피|울쎄라|리프팅", tags=[EYE, T("파워", r"파워"), T("프라임", r"프라임", "post"), BODY("울쎄라")]),
    dict(id="thermage", cat="리프팅", name="써마지 FLX", rx=r"써마지", stop=r"써마지|FLX|리프팅", tags=[EYE, BODY("써마지")]),
    dict(id="inmode", cat="리프팅", name="인모드", rx=r"인모드", stop=r"인모드|리프팅|모드",
         tags=[T("파워", r"파워"), T("FX+FORMA", r"2가지|듀얼|FX\+FORMA|FORMA\+FX", "post"), T("FX", r"FX", "post"), T("FORMA", r"FORMA", "post"),
               T("얼굴전체", r"얼굴전체|풀페이스", "post"), T("이중턱", r"이중턱", "post"), BODY("인모드")]),
    dict(id="onda", cat="리프팅", name="온다 리프팅", rx=r"온다", stop=r"온다|리프팅|페이스|얼굴", tags=[BODY("온다 리프팅")]),
    dict(id="oligio", cat="리프팅", name="올리지오", rx=r"올리지오", stop=r"올리지오|리프팅", tags=[EYE, T("X", r"(?<=올리지오)X", "post")]),
    dict(id="volnewmer", cat="리프팅", name="볼뉴머", rx=r"볼뉴머", stop=r"볼뉴머|리프팅", tags=[EYE]),
    dict(id="titanium", cat="리프팅", name="티타늄 리프팅", rx=r"티타늄", stop=r"티타늄|리프팅", tags=[EYE]),
    dict(id="density", cat="리프팅", name="덴서티", rx=r"덴서티", stop=r"덴서티|리프팅", tags=[EYE, T("하이", r"하이", "post"), T("클래식", r"클래식", "post"), T("알파", r"알파", "post")]),
    dict(id="primeraise", cat="리프팅", name="프라임 레이즈", rx=r"프라임레이즈", stop=r"프라임레이즈|리프팅", tags=[T("포커스", r"포커스", "post"), BODY("프라임 레이즈")]),
    dict(id="bluerose", cat="리프팅", name="블루로즈 포르테", rx=r"블루로즈", stop=r"블루로즈|포르테|리프팅", tags=[]),
    dict(id="jamber", cat="리프팅", name="잼버", rx=r"잼버", stop=r"잼버|리프팅", tags=[T("실", r"잼버실", "post")]),
    dict(id="thread", cat="리프팅", name="실리프팅", rx=r"민트실|민트리프팅|실루엣소프트|하이코|실리프팅", stop=r"실리프팅|리프팅",
         tags=[T("민트", r"민트실|민트", "post"), T("실루엣소프트", r"실루엣소프트", "post"), T("하이코", r"하이코", "post")]),
    dict(id="ldm", cat="리프팅", name="물방울 리프팅(LDM)", rx=r"물방울리프팅|LDM", stop=r"물방울리프팅|물방울|LDM|리프팅", tags=[T("트리플 소닉", r"트리플소닉")]),
    dict(id="liftera", cat="리프팅", name="리프테라2", rx=r"리프테라", stop=r"리프테라2?|초음파", tags=[T("펜타입", r"펜타입", "post"), T("라인타입", r"라인타입", "post")]),
    dict(id="tensurma", cat="리프팅", name="텐써마", rx=r"텐써마", stop=r"텐써마|리프팅", tags=[EYE]),
    dict(id="neoface", cat="리프팅", name="네오페이스", rx=r"네오페이스", stop=r"네오페이스|리프팅", tags=[T("얼굴전체", r"얼굴전체", "post")]),
    # ---------------- 부스터
    dict(id="rejuran", cat="부스터", name="리쥬란", rx=r"리쥬란", stop=r"리쥬란|plus|플러스|PN",
         tags=[EYE, T("HB 플러스", r"HB", "post"), T("힐러", r"힐러", "post"), T("스킨부스터", r"스킨부스터|베이직", "post"), T("톤업", r"톤업", "post"), T("입술", r"입술", "post")]),
    dict(id="rejevan", cat="부스터", name="리제반PN", rx=r"리제반", stop=r"리제반|PN", tags=[EYE]),
    dict(id="juvelook", cat="부스터", name="쥬베룩", rx=r"쥬베룩", stop=r"쥬베룩|1vial|vial", tags=[EYE, T("볼륨", r"볼륨", "post"), T("스킨", r"스킨", "post")]),
    dict(id="mulgwang", cat="부스터", name="물광주사", rx=r"물광주사", stop=r"주사", tags=[]),
    dict(id="curestem", cat="부스터", name="큐어스템 엑소좀", rx=r"큐어스템", stop=r"큐어스템|엑소좀", tags=[]),
    dict(id="asce", cat="부스터", name="ASCE 엑소좀", rx=r"ASCE", stop=r"ASCE|크리스탈|엑소좀", tags=[]),
    dict(id="exosome", cat="부스터", name="엑소좀", rx=r"엑소좀", stop=r"엑소좀", tags=[]),
    dict(id="nmn", cat="부스터", name="NMN 스킨부스터", rx=r"NMN", stop=r"NMN", tags=[]),
    dict(id="filmed", cat="부스터", name="필메드135", rx=r"필메드", stop=r"필메드135|필메드", tags=[]),
    dict(id="rituo", cat="부스터", name="리투오", rx=r"리투오", stop=r"엘라비에|리투오", tags=[]),
    dict(id="skinvive", cat="부스터", name="스킨바이브", rx=r"스킨바이브", stop=r"스킨바이브", tags=[]),
    dict(id="celldm", cat="부스터", name="셀르디엠", rx=r"셀르디엠", stop=r"셀르디엠", tags=[]),
    dict(id="salmon", cat="부스터", name="연어주사", rx=r"연어주사", stop=r"주사", tags=[]),
    dict(id="pdrn", cat="부스터", name="PDRN 재생주사", rx=r"PDRN", stop=r"PDRN|재생주사|주사", tags=[]),
    dict(id="reedle", cat="부스터", name="리들부스터", rx=r"리들부스터", stop=r"리들부스터", tags=[T("EX", r"EX", "post"), T("PN", r"PN", "post"), T("BH", r"BH", "post")]),
    dict(id="revive", cat="부스터", name="벨로테로 리바이브", rx=r"리바이브", stop=r"벨로테로|리바이브", tags=[]),
    dict(id="velybooster", cat="부스터", name="블리비부스터", rx=r"블리비부스터", stop=r"블리비부스터", tags=[]),
    dict(id="retigen", cat="부스터", name="레티젠", rx=r"레티젠", stop=r"레티젠|순수콜라겐|99\.9%", tags=[]),
    dict(id="olidia", cat="부스터", name="올리디아", rx=r"올리디아", stop=r"올리디아", tags=[T("스킨", r"스킨", "post"), T("볼륨", r"볼륨", "post")]),
    dict(id="everkl", cat="부스터", name="에버클", rx=r"에버클", stop=r"에버클", tags=[T("V", r"(?<=에버클)V", "post"), T("S", r"(?<=에버클)S", "post")]),
    dict(id="lilyid", cat="부스터", name="릴리이드M", rx=r"릴리이드", stop=r"릴리이드M?", tags=[]),
    dict(id="ha", cat="부스터", name="히알루론산 주사", rx=r"^히알루론산주사", stop=r"히알루론산주사", tags=[]),
    dict(id="hilowave", cat="부스터", name="힐로웨이브", rx=r"힐로웨이브", stop=r"힐로웨이브", tags=[]),
    dict(id="filod", cat="부스터", name="필로드", rx=r"필로드", stop=r"필로드", tags=[EYE]),
    # ---------------- 피부
    dict(id="pico", cat="피부", name="피코토닝", rx=r"피코토닝", stop=r"피코토닝|피코세컨드레이저|레이저", tags=[T("듀얼", r"듀얼")]),
    dict(id="toning", cat="피부", name="레이저토닝", rx=r"(?<!피코|착색|바디|아큐|SI)토닝", stop=r"레이저토닝|토닝|레이저",
         tags=[T("메가", r"메가"), T("듀얼", r"듀얼"), T("제네시스", r"제네시스")]),
    dict(id="revlite", cat="피부", name="레블라이트SI 토닝", rx=r"레블라이트SI토닝", stop=r"레블라이트SI토닝", tags=[]),
    dict(id="accutoning", cat="피부", name="아큐토닝", rx=r"아큐토닝", stop=r"아큐토닝", tags=[]),
    dict(id="pigment", cat="피부", name="착색토닝", rx=r"착색토닝|바디토닝|바디착색", stop=r"토닝|착색", paren=True, tags=[T("바디", r"바디"), T("비키니라인", r"비키니", "post"), T("겨드랑이", r"겨드랑이", "post")]),
    dict(id="genesis", cat="피부", name="제네시스", rx=r"제네시스(?!토닝)", stop=r"제네시스|레이저", tags=[T("듀얼", r"듀얼")]),
    dict(id="capri", cat="피부", name="카프리 레이저", rx=r"카프리", stop=r"카프리|레이저", tags=[]),
    dict(id="aquapeel", cat="피부", name="아쿠아필", rx=r"아쿠아필", stop=r"아쿠아필|1/2/3제|1/2제|\d제", tags=[]),
    dict(id="potenza", cat="피부", name="포텐자", rx=r"포텐자", stop=r"포텐자", tags=[T("아크네", r"아크네"), T("얼굴전체", r"얼굴전체", "post", scope="full"),
         T("개당", r"개당", "post", scope="full"), T("부분", r"부분", "post", scope="full"),
         T("펌핑 모드", r"펌핑", "post", scope="full"), T("팁 별도", r"팁(값)?\s*(별도|미포함)", "post", scope="full")]),
    dict(id="secret", cat="피부", name="시크릿 레이저", rx=r"^시크릿", stop=r"시크릿|레이저", tags=[]),
    dict(id="sylfirm", cat="피부", name="실펌X", rx=r"실펌", stop=r"실펌X?|레이저", tags=[]),
    dict(id="mole", cat="피부", name="점 빼기", rx=r"점빼기|점제거|^점(?![가-힣])|얼굴점|돌출점", stop=r"점빼기|점제거|점|개당|얼굴",
         tags=[T("小", r"小|2mm", "post"), T("中", r"中", "post"), T("大", r"大", "post"), T("얼굴전체", r"얼굴전체", "post"), T("목전체", r"목전체", "post"),
               T("돌출점·사마귀·비립종·쥐젖", r"돌출점|사마귀|비립종|쥐젖", "post")]),
    dict(id="acneinj", cat="피부", name="염증주사", rx=r"염증주사", stop=r"주사|개당", tags=[T("얼굴전체", r"얼굴전체", "post"), T("무제한", r"무제한|개수무제한", "post")]),
    dict(id="lalapeel", cat="피부", name="라라필", rx=r"라라필", stop=r"라라필", tags=[]),
    dict(id="fraxel", cat="피부", name="프락셀", rx=r"(?<!피코)프락셀|프락셔널", stop=r"프락셀|프락셔널|레이저",
         tags=[T("코 모공", r"코모공"), T("나비존", r"나비존"), T("CO2", r"CO2", scope="full"), T("어븀글라스", r"어븀", scope="full"), T("얼굴전체", r"얼굴전체", "post")]),
    dict(id="picofrax", cat="피부", name="피코프락셀", rx=r"피코프락셀", stop=r"피코프락셀", tags=[]),
    dict(id="excelv", cat="피부", name="엑셀V", rx=r"엑셀V|엑셀브이", stop=r"엑셀V|레이저", tags=[T("플러스", r"플러스", "post")]),
    dict(id="agnes", cat="피부", name="아그네스", rx=r"아그네스", stop=r"아그네스", tags=[T("얼굴전체", r"얼굴전체", "post", scope="full"), T("개당", r"개당", "post", scope="full"), T("부분", r"부분", "post", scope="full"),
         T("펌핑 모드", r"펌핑", "post", scope="full"), T("팁 별도", r"팁(값)?\s*(별도|미포함)", "post", scope="full")]),
    dict(id="aladdin", cat="피부", name="알라딘필", rx=r"알라딘필", stop=r"알라딘필링|알라딘필", tags=[T("뉴", r"뉴알라딘|뉴"), BODY("알라딘필", "피부")]),
    dict(id="blackpeel", cat="피부", name="블랙필", rx=r"블랙필", stop=r"블랙필", tags=[T("베이직", r"베이직", "post")]),
    dict(id="milkpeel", cat="피부", name="밀크필", rx=r"밀크필", stop=r"밀크필", tags=[]),
    dict(id="vitamin", cat="피부", name="비타민관리", rx=r"^비타민관리$|^비타민관리(?!/)", stop=r"비타민관리", tags=[]),
    dict(id="tattoo", cat="피부", name="문신제거", rx=r"문신제거", stop=r"문신제거|인라이튼|피코|레블라이트SI|사이즈",
         tags=[T("인라이튼 피코", r"인라이튼"), T("레블라이트SI", r"레블라이트(SI)?"), T("눈썹", r"눈썹", "post"), T("아이라인", r"아이라인", "post"),
               T("500원 동전 크기", r"500원(동전)?", "post"), T("명함 1장 크기", r"명함1장", "post"), T("명함 2장 크기", r"명함2장", "post"), T("레터링 10×1cm", r"레터링10cm\*1cm|레터링", "post")]),
    dict(id="melasma", cat="피부", name="기미주사", rx=r"기미주사", stop=r"주사", tags=[]),
    dict(id="ipl", cat="피부", name="IPL", rx=r"IPL", stop=r"IPL", tags=[]),
    dict(id="clarity", cat="피부", name="클라리티", rx=r"클라리티", stop=r"클라리티", tags=[]),
    dict(id="vlaser", cat="피부", name="V레이저", rx=r"^V레이저", stop=r"V레이저", tags=[]),
    dict(id="vessel", cat="피부", name="모세혈관 레이저", rx=r"모세혈관레이저", stop=r"모세혈관레이저", tags=[]),
    dict(id="spot", cat="피부", name="잡티 스팟 레이저", rx=r"잡티스팟레이저", stop=r"잡티스팟레이저", tags=[]),
    dict(id="ptt", cat="피부", name="PTT", rx=r"PTT", stop=r"PTT", tags=[T("에토좀", r"에토좀"), T("골드", r"골드")]),
    dict(id="drip", cat="피부", name="영양 수액주사", rx=r"수액주사", stop=r"주사|수액|영양", paren=True, tags=[T("베이직", r"베이직"), T("프리미엄", r"프리미엄")]),
    dict(id="baekok", cat="피부", name="백옥주사", rx=r"백옥주사", stop=r"주사", tags=[]),
    dict(id="cinderella", cat="피부", name="신데렐라주사", rx=r"신데렐라주사", stop=r"주사", tags=[]),
    dict(id="garlic", cat="피부", name="마늘주사", rx=r"마늘주사", stop=r"주사", tags=[]),
    dict(id="placenta", cat="피부", name="태반주사", rx=r"태반주사", stop=r"주사", tags=[]),
    dict(id="gluta", cat="피부", name="글루타치온주사", rx=r"글루타치온", stop=r"주사|글루타치온", tags=[]),
    dict(id="thioctic", cat="피부", name="티옥트산주사", rx=r"티옥트산", stop=r"주사|티옥트산", tags=[]),
    dict(id="vitinj", cat="피부", name="비타민주사", rx=r"^비타민주사", stop=r"비타민주사", tags=[]),
    dict(id="licorice", cat="피부", name="감초주사", rx=r"감초주사", stop=r"감초주사", tags=[]),
    dict(id="pdt", cat="피부", name="PDT(여드름)", rx=r"PDT", stop=r"PDT", tags=[]),
    dict(id="subcision", cat="피부", name="서브시전", rx=r"서브시전", stop=r"서브시전", tags=[]),
    dict(id="o2derm", cat="피부", name="오투덤 산소테라피", rx=r"오투덤", stop=r"오투덤|산소테라피", tags=[]),
    # ---------------- 제모·바디: 제모 is one family per body area ('겨드랑이 제모'), variants = 여/남 × 회차
    dict(id="hair", cat="제모·바디", name="제모", rx=r"제모", stop=r"제모|레이저|부위", area=True,
         tags=[T("여성", r"여성|여자|\(여\)|\[여|여\)", scope="full"), T("남성", r"남성|남자|\(남\)|\[남|남\)", scope="full"), T("솜털", r"솜털")] + HAIR_DEVICES),
    dict(id="velys", cat="제모·바디", name="블리비S", rx=r"블리비S", stop=r"블리비S", tags=[T("라이트", r"라이트", "post")]),
    dict(id="carboxy", cat="제모·바디", name="카복시·지방분해주사", rx=r"카복시|지방분해주사", stop=r"카복시테라피|카복시|지방분해주사|주사", tags=[T("팔뚝", r"팔뚝")]),
    dict(id="miniskirt", cat="제모·바디", name="미니스커트주사", rx=r"미니스커트주사", stop=r"주사", tags=[]),
    dict(id="ss", cat="제모·바디", name="SS주사", rx=r"SS주사", stop=r"주사", tags=[]),
    dict(id="slimcut", cat="제모·바디", name="슬림컷주사", rx=r"슬림컷주사", stop=r"주사", tags=[]),
    dict(id="calf", cat="제모·바디", name="종아리성형주사", rx=r"종아리성형주사", stop=r"주사", tags=[]),
]
FAM_BY_ID = {f["id"]: f for f in FAMILIES}
for f in FAMILIES:
    f["_rx"] = re.compile(f["rx"])
    f["_stop"] = re.compile(f["stop"]) if f["stop"] else None

# vial in any case ('쥬베룩 볼륨 1Vial' and '1vial' are one spec — 2026-10-15, 개선 보고서 E2); unit() writes it 'vial'
AMOUNT = re.compile(r"(\d+(?:\.\d+)?)(U|cc|ml|샷|KJ|부위|개(?!월)|줄|시린지|[vV][iI][aA][lL]|분|mm)(?![a-zA-Z])")


def unit(u):
    return "vial" if u.lower() == "vial" else u
PACKAGE = re.compile(r"패키지|PKG|pkg|세트|SET|콤보|\+|&|(?<=[0-9샷cU])X(?=[가-힣])|결합|동시|코스")
# filler words that don't change the product (marketing, price kind, generic nouns)
STOP = re.compile(r"체험가|체험|한정가|한정|이벤트|EVENT|event|특가|할인|세일|첫방문|첫시술|1인1회|신규|웰컴|선착순|NEW|BEST|HOT|기획전|"
                  r"가을|페스타|추천|인기|당일|회당|1회당|[0-9]+회|1회|레이저|시술|관리|리프팅|주사|♥|★|☆|※|♡|◆|◇|■|□|▶|▷|#|-|·|/|,|\.|~|:|!|\?|_|=|\*|'|\"|“|”|‘|’")


def amounts_text(name):
    """comp() of a name with a model number kept apart from the amount after it ('리프테라2 3000샷' → '리프테라2/3000샷')"""
    return comp(re.sub(r"(?<=[A-Za-z가-힣])(\d+)\s+(?=\d)", r"\1/", name or ""))


def _strip(name):
    """name without […] labels, (…) explanations and an 'option N)' prefix, spaces kept"""
    s = re.sub(r"\[[^\]]*\]", " ", name or "")
    s = re.sub(r"\([^()]*\)", " ", s)
    s = re.sub(r"\([^()]*\)", " ", s)
    return re.sub(r"^\s*옵션\s*\d*\)\s*", "", s)


def short(name):
    """short name through comp() (spaces removed, units unified)"""
    return comp(_strip(name))


# a family that is only part of another family's word ('토닝' in '착색토닝') doesn't make a bundle
SHADOW = {"pigment": ["toning"], "picofrax": ["fraxel"], "pico": ["toning"], "revive": ["filler"], "hyal": ["filler"], "radiesse": ["filler"],
          "curestem": ["exosome"], "asce": ["exosome"], "chin2": ["toxin"], "tattoo": ["pico", "toning"], "carboxy": ["contour"], "sculpt": ["contour"],
          "ldm": ["liftera"], "aladdin": ["mole"], "revlite": ["toning"], "accutoning": ["toning"], "watertox": ["toxin"], "eyefat": ["filler"],
          "neckline": ["filler", "toxin"], "ptt": [], "velyv": ["contour"], "accu": ["contour"], "ellanse": ["thread"], "reedle": ["rejuran"],
          "vitinj": [], "vitamin": []}


def family_of(name):
    """(family, n) — the first family whose rx is in the short name, and how many different families appear there"""
    s = short(name)
    hits = [f for f in FAMILIES if f["_rx"].search(s)]
    ids = {f["id"] for f in hits}
    for f in list(ids):
        for g in SHADOW.get(f, []):
            ids.discard(g)
    hits = [f for f in hits if f["id"] in ids]
    return (hits[0] if hits else None), len(hits)


def _clean(text, fam):
    text = fam["_rx"].sub("", text)
    if fam["_stop"]:
        text = fam["_stop"].sub("", text)
    text = AMOUNT.sub("", text)
    text = STOP.sub("", text)
    # numbers with a unit we don't know ('4줄' before 줄 was added) stay, so different quantities never merge
    return re.sub(r"[^\w가-힣%]", "", text)


def _area(raw):
    """제모: the body area before '제모' ('겨드랑이/인중 제모' → '겨드랑이/인중', '상체 제모 · 겨드랑이' → '겨드랑이'). An area written
    only in square brackets ('[겨드랑이] 5회', 톡스앤필) is read from there (2026-10-15: it was '부위 미표기')."""
    raw = re.sub(r"\[(?:여성|남성|여자|남자)\]", " ", raw or "")
    got = _area_of(re.sub(r"\[[^\]]*\]|\([^()]*\)", " ", raw))
    return got or _area_of(re.sub(r"\([^()]*\)", " ", re.sub(r"\[([^\]]*)\]", r" \1 ", raw)))


def _area_of(a):
    segs = [x for x in re.split(r"\s+·\s+", a) if x.strip()]
    seg = segs[-1] if segs else a
    if "제모" in seg:
        seg = seg.split("제모")[0]
    elif len(segs) > 1 and "제모" in segs[-2]:
        pass
    seg = re.sub(r"\d+\s*회|1년|구독권|여성|남성|여자|남자|솜털|레이저|부위|[♥★☆]", " ", seg)
    parts = sorted(p for p in (re.sub(r"\s+", "", x) for x in re.split(r"[/,·&+]", seg)) if p)
    return "/".join(re.sub(r"[^\w가-힣]", "", p) for p in parts if re.sub(r"[^\w가-힣]", "", p))


# group-title words that can change what an option is (sex, body area): with these the group title stays in the signature
GROUP_MEANS = re.compile(r"남성|여성|남자|여자|바디|얼굴|전신|부위|팔|다리|겨드랑|가슴|등|복부|허벅지|종아리|목|이마|눈|코|입|턱|볼|두피|헤어|손|발|어깨|엉덩|브라질|비키니")
# 첫방문고객 / 첫시술고객 as one word: taking off only 첫방문 left '고객 비타민관리' (2026-10-15)
KINDWORDS = re.compile(r"체험가|체험|한정가|한정|이벤트|EVENT|event|특가|첫방문(?:고객)?|첫시술(?:고객)?|1인1회|선착순|NEW|BEST|HOT|웰컴|신규|[♥★☆※♡]|\d+회")
KINDONLY = re.compile(r"체험가|한정가|이벤트|EVENT|특가|선착순|NEW|BEST|HOT|[♥★☆※♡]")
# compare category for rows no family covers, from the clinic's own category (clean.py cat)
ROWCAT = {"리프팅": "리프팅", "스킨부스터": "부스터", "피부·레이저": "피부", "제모": "제모·바디", "바디": "제모·바디", "기타": "기타"}


def variant(name, addon=False, kind="", cat="", display=None):
    """→ (dict(fam, famname, cat, tags, area, residual, detail, amount, sess, sig, label, sub, rx), '') or (None, reason).
    cat: the row's own category (clean.py), used only for names no family covers; display: the shown name with its
    'group · option' separator (name is clean.py's mname, where ' · ' became a space)."""
    if addon or kind == "구독권":
        return None, "추가 옵션·구독권"
    raw = name or ""
    full = comp(raw)
    if re.search(r"옵션\s*\d*\)", raw) or addon_only(raw):
        return None, "추가 옵션"
    if COND.search(full):
        return None, "조건부 가격(○○ 이상 시)"
    sess = sessions(raw)
    if sess >= 99:
        return None, "이용권·무제한"
    fam, n = family_of(raw)
    # a bundle: two families, '+'/패키지 in the short name, or ' + ' between parts in the explanation ('환절기 스킨 리커버리(A + B)')
    # On a 제모 page '(손등 + 손가락)' lists the areas of one option, not two products: read as a bundle, '[여성]손 5회' and
    # '[남성]손 5회' shared one key labelled '손 5회 (손등 + 손가락)' (2026-10-15, 개선 보고서 E3)
    # The listed areas stay in the signature and the label ('여성 손 제모 5회 (손등 + 손가락)'), so only the same listing joins: the
    # 제모 rule reads its area outside brackets and would otherwise put '겨드랑이 (겨드랑이 + 인중)' with plain '겨드랑이'.
    areas_only = cat == "제모" and (not fam or fam["id"] == "hair")
    listed = re.findall(r"\(([^()]*\s\+\s[^()]*)\)", raw)
    # likewise '손등 + 손가락제모 5회' / '겨드랑이+인중 5회' on a 제모 page: '+' between areas, the only bundle mark — read by the
    # 제모 rule, which keeps 여성 and 남성 apart (as a package key they shared one key, 2026-10-15)
    plain = comp(_strip(raw))
    plus_only = "+" in plain and not PACKAGE.search(plain.replace("+", ""))
    bundle = n >= 2 or (bool(PACKAGE.search(plain)) and not (areas_only and plus_only)) or (bool(listed) and not areas_only)
    v = None
    if fam and not bundle:
        v, why = _family_variant(raw, fam, sess, display)
    elif not fam and not bundle and cat == "제모":
        # '얼굴 제모 · [여성] 이마 1회': the area is the option, '제모' only in the group name
        seg = re.split(r"\s+·\s+", display or raw)[-1]
        sex = " ".join(re.findall(r"\[(?:여성|남성)\]", raw))
        v, why = _family_variant(f"{sex} {seg} 제모", FAM_BY_ID["hair"], sess)
    if v:
        if listed and areas_only:
            parts = " + ".join(re.sub(r"\s+", " ", x).strip() for x in listed)
            v = dict(v, sig=f"{v['sig']}|{comp(parts)}", label=f"{v['label']} ({parts})", sub=f"{v['sub']} ({parts})")
        return v, ""
    sx = re.search(r"\[(여성|여자|남성|남자)\]", raw)
    return _exact(display or raw, sess, cat, bundle, {"여자": "여성", "남자": "남성"}.get(sx.group(1), sx.group(1)) if sx else "")


def _tidy(s):
    """a shown name without what removing price-kind words leaves behind: '피코토닝 10+10회 ()' / '(1회 )' → no empty or
    loose brackets; a leading list marker ('E) 비타민관리') dropped, '男) 인중' → '남성 인중' (2026-10-14)"""
    s = re.sub(r"[\uf900-\ufaff]", lambda m: unicodedata.normalize("NFKC", m.group()), s or "")   # '女' written as U+F981
    s = re.sub(r"^\s*[A-Z]\)\s*", "", s)
    # a bracket with no partner is a list marker ('첫방문) 비타민관리' once 첫방문 is taken off, '남성)인중'): a space instead
    out, depth = [], 0
    for ch in s:
        if ch == ")" and depth == 0:
            ch = " "
        depth += (ch == "(") - (ch == ")")
        out.append(ch)
    s = "".join(out)
    if depth > 0:
        s = s[::-1].replace("(", " ", depth)[::-1]
    s = re.sub(r"(?<![가-힣])男(?![가-힣])", "남성", s)
    s = re.sub(r"(?<![가-힣])女(?![가-힣])", "여성", s)
    s = re.sub(r"\(\s*\)|\[\s*\]", " ", s)
    s = re.sub(r"\(\s+", "(", s)
    s = re.sub(r"\s+\)", ")", s)
    return re.sub(r"\s+", " ", s).strip(" -·")


def _exact(raw, sess, rowcat, bundle, sex=""):
    """names no family rule covers (or that a rule can't read): same product only when the whole name is the same
    (labels and explanations included, price-kind words and session counts aside). Bundles go to '패키지'."""
    # a section title written 'name:' ('고주파 리프팅 텐텐듀얼리프팅: 1회', '내맘대로 스킨케어:'): the colon ends the title, it is not
    # part of the product — kept, it made a second key next to '고주파 리프팅 텐텐듀얼 리프팅' (2026-10-15)
    raw = re.sub(r"\s*[:：]\s*(?=(?:\d+\s*회)?\s*(?:\([^()]*\))?\s*$)", " ", raw).rstrip()
    nm = re.sub(r"\[[^\]]*\]", " ", raw)
    nm = nm if bundle else ADDON.sub("", nm)
    seg = [x for x in re.split(r"\s+·\s+", nm) if x.strip()]
    disp = (seg[-1] if seg else nm).strip()
    # a package's parts all count ('+ 크라이오셀' is a part here, not a free extra): keep '+' away from comp()'s add-on rule
    src = " ".join(seg) if seg else nm
    if not bundle and len(seg) > 1:
        # 'group · option' where the option repeats the product ('인라이튼 니플스 · 인라이튼 니플스(피코 프락셔널) 1회', '고우리 런칭 특가 ·
        # 고우리 1회'): the group title is the clinic's heading, not part of the product, so the option alone decides
        lb = KINDWORDS.sub("", AMOUNT.sub("", comp(re.sub(r"\([^()]*\)", " ", seg[-1]))))
        gb = comp(" ".join(seg[:-1]))
        if len(lb) >= 2 and lb in gb:
            src = seg[-1]
        elif len(lb) >= 3 and not GROUP_MEANS.search(gb):
            # '트러블 E · 여드름 옵션 · 여드름 약처방 2주', '스킨부스터 E · 재생주사 · 비타란 2CC 1회': the group titles are the clinic's page
            # sections and differ between branches of one chain; an option that names the product by itself decides alone.
            # Titles that say who or where ('남성 · …', '바디 · …') can change the product, so those keep the full name.
            src = seg[-1]
    sigtext = KINDWORDS.sub("", comp(src.replace("+", "＋") if bundle else src))
    # a list marker left by a price-kind word ('첫방문고객) 비타민관리' → ')비타민관리'): not part of the product (as _tidy does for labels)
    while sigtext.startswith(")") and sigtext.count(")") > sigtext.count("("):
        sigtext = sigtext[1:]
    if not sigtext:
        return None, "이름 없음"
    amounts = " ".join(dict.fromkeys(f"{v}{unit(u)}" for v, u in AMOUNT.findall(amounts_text(disp))))
    if bundle:
        first = next((f for f in FAMILIES if f["_rx"].search(comp(raw))), None)
        famname, cat = (f"{first['name']} 포함 패키지" if first else "기타 패키지"), "패키지"
        label = _tidy(KINDONLY.sub("", disp))
        sub = label
        rx = first["rx"] if first else re.escape(comp(label)[:6])
        fid = "package"
    else:
        base = re.sub(r"\([^()]*\)", " ", disp)
        base = AMOUNT.sub(" ", comp_spaces(base))
        base = _tidy(KINDWORDS.sub(" ", base))
        if not base:
            return None, "이름 없음"
        famname = base
        cat = ROWCAT.get(rowcat) or ("톡신" if re.search(r"톡신|보톡|톡스", comp(raw)) else "윤곽·필러" if rowcat == "보톡스·필러" else "기타")
        sub = " ".join(([amounts] if amounts else []) + ([f"{sess}회"] if sess > 1 else [])) or "기본"
        label = " ".join([famname] + ([amounts] if amounts else []) + ([f"{sess}회"] if sess > 1 else []))
        rx = re.escape(comp(famname))
        fid = "generic"
    sig = "|".join(["x", famname, sigtext, str(sess)])
    # the sex from the group title ('[여성] …' in mname) when the name itself doesn't say it: '발등 + 발가락 5회' for women and for
    # men were one key, or two told apart only by '표기 n' (2026-10-15)
    if sex and not re.search(r"남성|여성|남자|여자|男|女", sigtext):
        sig += f"|{sex}"
    if sex and not re.search(r"남성|여성|남자|여자|男|女|\((?:남|여)\)", label):
        label, sub = f"{sex} {label}", f"{sex} {sub}" if sub != label else f"{sex} {label}"
    desc = re.findall(r"\(([^()]{2,40})\)", disp)
    return dict(fam=fid, famname=famname, cat=cat, tags=[], area="", residual="", detail=desc[0] if desc else "", details=desc, amount=amounts,
                sess=sess, sig=sig, label=label, sub=sub, rx=rx), ""


def comp_spaces(s):
    """comp()-like unit spelling (50유닛 → 50U, 2 CC → 2cc) but spaces kept, for display names"""
    s = re.sub(r"(\d+)\s*(유닛|단위|unit|units|Unit|UNIT|u|U)(?![a-zA-Z])", r"\1U", s)
    s = re.sub(r"(\d)\s*(CC|cC|Cc|cc)", r"\1cc", s)
    s = re.sub(r"(\d)\s+(mm|ml)(?![a-zA-Z])", r"\1\2", s)     # '10 mm 이내' is '10mm 이내' (the size was shown twice, 2026-10-15)
    return re.sub(r"(\d),(\d{3})", r"\1\2", s)


def _spaced(word, text):
    """a residual with the name's word breaks put back for display ('비타민수분크라이오셀' out of '비타민 수분 크라이오셀 …' →
    '비타민 수분 크라이오셀'): each letter is found in order in the name, and anything skipped between two letters (a space
    or a word taken out) becomes a break — after first looking for the letters with only spaces between. The signature keeps
    the glued form, so key ids don't change."""
    src = comp_spaces(text or "")
    m = re.search(r"\s*".join(map(re.escape, word)), src) if word else None
    if m:                                                  # the words as they stand in the name, only spaces between
        return re.sub(r"\s+", " ", m.group(0))
    out, at = [], -1
    for ch in word:
        j = src.find(ch, at + 1)
        if j < 0:
            return word                                    # can't be lined up (a unit rewritten by comp()): as it was
        if out and j > at + 1:
            out.append(" ")
        out.append(ch)
        at = j
    return "".join(out)


def _family_variant(raw, fam, sess, display=None):
    full = comp(raw)
    st = _strip(raw)
    by_unit = defaultdict(set)
    for v, u in AMOUNT.findall(amounts_text(raw)):
        by_unit[unit(u)].add(float(v))
    if fam["id"] not in ("inmode", "ldm"):        # minutes are the dose for these two ('LDM … #6분' vs '#24분')
        by_unit.pop("분", None)
    if any(len(v) > 1 for v in by_unit.values()):
        return None, "용량이 둘 이상"
    amount = " ".join(f"{int(v) if v.is_integer() else v}{u}" for u, vs in sorted(by_unit.items()) for v in vs)
    # 'name - detail' (블리비: '바디 인모드 리프팅 - 팔뚝/허벅지/…', '다한증보톡스 - 겨드랑이/손/발')
    parts = re.split(r"\s+-\s+", st, maxsplit=1)
    main, detail = parts[0], (parts[1] if len(parts) > 1 else "")
    main_text, detail_text = main, detail
    main, detail = comp(main), comp(detail)
    rest_full = full
    tags, famname, cat = [], fam["name"], fam["cat"]
    for t in fam["tags"]:
        hit = False
        for where in ("main", "detail", "full") if t["scope"] == "full" else ("main", "detail"):
            txt = {"main": main, "detail": detail, "full": rest_full}[where]
            if t["rx"].search(txt):
                hit = True
                break
        if not hit:
            continue
        main, detail, rest_full = t["rx"].sub("", main), t["rx"].sub("", detail), t["rx"].sub("", rest_full)
        if t["split"] and t["where"] == "hide" and t["split"][0] == famname:
            continue                           # '이마 주름보톡스': 주름 only repeats the family already chosen by 이마
        if t["split"] and famname == fam["name"]:
            famname, cat = t["split"][0], t["split"][1] or cat
        elif t["split"] and t["split"][0] != famname and t["where"] == "hide":
            t = dict(t, where="post")          # a second area ('스킨보톡스 … 주름'): show it, it changes the product
        tags.append(t)
    lab = [t["label"] for t in tags]
    if "국산" in lab and ({"수입", "독일산", "미국산"} & set(lab)):
        return None, "원산지 둘 이상"
    rest = _clean(main, fam)
    det = "·".join(x for x in (re.sub(r"등$", "", _clean(p, fam)) for p in re.split(r"[/,·]", detail)) if x)
    rest_shown = _spaced(rest, main_text)
    det_shown = "·".join(_spaced(x, detail_text) for x in det.split("·")) if det else ""
    if fam.get("paren"):
        par = "·".join(x for p in re.findall(r"\(([^()]+)\)", raw) for x in (_clean(comp(y), fam) for y in re.split(r"[/,·]", p)) if x)
        det = "·".join(x for x in (det, par) if x)
        det_shown = "·".join(x for x in (det_shown, "·".join(_spaced(x, raw) for x in par.split("·")) if par else "") if x)
    area, sig_name = "", None
    if fam.get("area"):
        area = _area(display or raw) or "부위 미표기"        # '제모 · 여자': the clinic names no area
        sig_name = f"{area.replace('/', '·')} 제모"
        # shown with the clinic's word breaks ('손가락 or 발가락', '브라질리언 항문포함'); the signature keeps the glued form
        famname = "·".join(_spaced(a, display or raw) for a in area.split("/")) + " 제모" if area != "부위 미표기" else sig_name
        rest, det = "", ""
        rest_shown, det_shown = "", ""
    shown = lambda w: [t["label"] for t in tags if t["where"] == w]
    pre, post = shown("pre"), shown("post")
    tail = ([rest_shown] if rest else []) + ([f"({det_shown})"] if det else []) + ([amount] if amount else []) + ([f"{sess}회"] if sess > 1 else [])
    sig = "|".join([fam["id"], sig_name or famname, ",".join(lab), rest, det, amount, str(sess)])
    return dict(fam=fam["id"], famname=famname, cat=cat, tags=lab, area=area, residual=rest, detail=det, amount=amount, sess=sess, sig=sig,
                label=" ".join(pre + [famname] + post + tail), sub=" ".join(pre + post + tail) or "기본",
                rx=fam["rx"] + ("|보톡스|보툴" if fam["id"] == "toxin" else "")), ""


ORDER_UNIT = r"\d+(?:\.\d+)?(?:U|cc|ml|샷|KJ|부위|개|줄|시린지|vial|분|mm)(?![A-Za-z가-힣])"


def word_order(label):
    """a shown label with what taking the amount out of '1cc당' / '10mm 이내' left behind put back after the amount:
    '턱끝 필러 리쥬비엘 당 1cc' → '… 1cc당', '리팟 레이저 이내 10mm 1개' → '… 10mm 이내 1개' (2026-10-15). Display only — the
    signature and the id don't change."""
    s = re.sub(rf"(?<!\S)당\s+({ORDER_UNIT})", r"\1당", label or "")
    s = re.sub(rf"(?<!\S)(이내|이하)\s+({ORDER_UNIT})", r"\2 \1", s)
    return re.sub(r"\s+", " ", s).strip()


HEAD_SKIP = re.compile(r"(?:THE|The|the|NEW|New|BEST|Best|HOT|Hot|단|더|신|NO\.?1)")


def product_head(names, groups=None):
    """the product word every name shares in its section title ('리팟레이저 단 한번의 시술로 흑자 제거! 시술 · 5mm 이내 1개' →
    '리팟레이저', 'THE 미희주사 꺼진 눈밑 … · 팔자 1회' → '미희주사'), or '' when a name has none or they differ. A name with no
    title in front ('얼굴 1부위') uses its row's group title ('퀵제로팻 페이스 ★단 한 방…' → '퀵제로팻')."""
    heads = set()
    for n, g in zip(names, groups or [""] * len(names)):
        title = n.split(" · ")[0] if " · " in n else (g or "")
        if not title:
            return ""
        words = [re.sub(r"^[^\w가-힣]+|[^\w가-힣]+$", "", w) for w in title.split()]
        word = next((w for w in words if len(re.sub(r"[^가-힣A-Za-z]", "", w)) >= 2 and not HEAD_SKIP.fullmatch(w) and not KINDONLY.search(w)), "")
        if not word:
            return ""
        heads.add(word)
    return heads.pop() if len(heads) == 1 else ""


def loose_text(s):
    """a name with letter case and word breaks taken out ('HB Plus 2cc' → 'hbplus2cc')"""
    return re.sub(r"\s+", "", s or "").casefold()


def loose_sig(sig):
    """a signature with letter case, word breaks and the order of bracketed parts taken out — two specs with the same
    loose_sig are written differently but are the same product"""
    parts = sig.split("|")
    if parts[0] == "x" and len(parts) == 4:
        # exact names: '줄기세포페이스(손주사)3cc' and '줄기세포페이스3cc(손주사)' — the bracket moved, nothing else. In a bundle the
        # brackets move only within their part: '이마필러5cc(국산)＋이마보톡스' ≠ '이마필러5cc＋이마보톡스(국산)' (2026-10-15)
        parts[2] = "＋".join(re.sub(r"\([^()]*\)", "", p) + "".join(sorted(re.findall(r"\([^()]*\)", p))) for p in parts[2].split("＋"))
    return "|".join(loose_text(p) for p in parts)


def key_id(sig):
    return "T" + hashlib.sha1(sig.encode("utf-8")).hexdigest()[:7].upper()


def build(rows, min_branches=3):
    """rows: dicts with brand, branch, name, mname, addon, kind, keys (curated ids). Returns
    (row_keys: list of auto key id or '' per row, keys: [{id, cat, label, fam, famname, sub, sig, n}],
     families: [{name, cat, fam, keys: [ids], curated: [ids]}], stats)"""
    vs, why = [], Counter()
    for r in rows:
        v, reason = variant(r.get("mname") or r["name"], r.get("addon") == "1", r.get("kind", ""), r.get("cat", ""), r.get("name"))
        vs.append(v)
        if not v:
            why[reason] += 1
    # one way of writing each family name: '아르기닌 주사' / '아르기닌주사', '다리 전체 제모' / '다리전체 제모' were two families
    # (2026-10-15, 개선 보고서 E10). The spelling most rows use wins ('뒷목' 1,166 rows over one '뒷 목'), then the one with more
    # word breaks. Labels follow; signatures don't change. The glued-word check (labels.py) is given every name of the
    # spelling group, so a key whose own rows are spaced may carry the family's usual glued spelling.
    spell = defaultdict(Counter)
    for v in vs:
        if v:
            spell[(loose_text(v["famname"]), v["cat"], v["fam"])][v["famname"]] += 1
    canon = {g: sorted(c.items(), key=lambda x: (-x[1], -x[0].count(" "), x[0]))[0][0] for g, c in spell.items()}
    group_names = defaultdict(set)
    for i, v in enumerate(vs):
        if v:
            group_names[(loose_text(v["famname"]), v["cat"], v["fam"])].add(rows[i]["name"])
    for v in vs:
        if v:
            best = canon[(loose_text(v["famname"]), v["cat"], v["fam"])]
            if best != v["famname"]:
                if v["famname"] in v["label"]:
                    v["label"] = v["label"].replace(v["famname"], best, 1)
                v["famname"] = best
    by_sig = defaultdict(list)
    for i, v in enumerate(vs):
        if v:
            by_sig[v["sig"]].append(i)
    # specs that differ only in letter case, word breaks or where a bracket stands ('리쥬란 S'/'리쥬란 s', 'HB PLUS'/'HB Plus',
    # '아르기닌 주사'/'아르기닌주사', '줄기세포 페이스 (손주사) 3cc'/'… 3cc (손주사)') are one spec (2026-10-15, 개선 보고서 E2·E10).
    # They join the one sold at the most branches, which keeps its id; the ids that go away are followed by appdata's keymap.
    merged = []
    by_loose = defaultdict(list)
    for sig in by_sig:
        by_loose[loose_sig(sig)].append(sig)
    for sigs in by_loose.values():
        if len(sigs) < 2:
            continue
        sigs.sort(key=lambda s: (-len({(rows[i]["brand"], rows[i]["branch"]) for i in by_sig[s]}), -len(by_sig[s]), s))
        for s in sigs[1:]:
            merged.append(dict(into=vs[by_sig[sigs[0]][0]]["label"], label=vs[by_sig[s][0]]["label"], rows=len(by_sig[s])))
            by_sig[sigs[0]].extend(by_sig.pop(s))
    keys, row_keys, owned, rejected = {}, [""] * len(rows), {}, []
    details, rescued = {}, []
    for sig, idx in by_sig.items():
        branches = {(rows[i]["brand"], rows[i]["branch"]) for i in idx}
        if len(branches) < min_branches:
            continue
        cur = Counter(k for i in idx for k in (rows[i].get("keys") or "").split() if k.startswith("X"))
        top = cur.most_common(1)
        if top and top[0][1] >= len(idx) / 2:
            owned[sig] = top[0][0]          # this spec is one of the hand-made keys: keep using that key
            continue
        v = vs[idx[0]]
        names = [rows[i]["name"] for i in idx] + sorted(group_names[(loose_text(v["famname"]), v["cat"], v["fam"])])
        # 제모 with no readable area mixes every area and its add-ons in one key (진정관리, 마취 스프레이, 인중 … 다리 전체): none
        bad = ["부위 미표기"] if v.get("area") == "부위 미표기" else labels.problems(v["label"], names)
        if bad == ["부위만"]:
            # only the product word is missing from the label, and every row of the spec names the same product in its section
            # title ('리팟레이저 … · 5mm 이내 1개', 'THE 미희주사 … · 팔자 1회'): put it back instead of dropping a spec that never mixed
            # products. Rows with different or no product words ('풀커버' of 기본색소 / 프리미엄 반영구) still make no key.
            head = product_head([rows[i]["name"] for i in idx], [rows[i].get("group", "") for i in idx])
            if head:
                v = dict(v, famname=f"{head} {v['famname']}", label=f"{head} {v['label']}")
                bad = labels.problems(v["label"], names + [head])
                if not bad:
                    rescued.append(dict(label=v["label"], n=len(branches)))
        if bad:
            # a label that would show price / date / promotion words or words we glued (build2/labels.py): no compare key —
            # its prices stay in the app as single prices, and the label is listed for a person to fix the rule that made it
            rejected.append(dict(label=v["label"], why=bad, n=len(branches), example=rows[idx[0]]["name"]))
            why["규격 이름 이상(build2/labels.py)"] += len(idx)
            continue
        kid = key_id(sig)
        keys[sig] = dict(id=kid, cat=v["cat"], label=v["label"], fam=v["fam"], famname=v["famname"], sub=v["sub"], sig=sig, n=len(branches), rx=v["rx"],
                         detail=v["detail"])
        details[sig] = v.get("details") or ([v["detail"]] if v["detail"] else [])
        for i in idx:
            row_keys[i] = kid
    # families: auto keys + the curated keys whose rows mostly fall in that family
    fam_of_curated = defaultdict(Counter)
    for i, r in enumerate(rows):
        for k in (r.get("keys") or "").split():
            if not k.startswith("X"):
                continue
            if vs[i]:
                if vs[i]["fam"] in FAM_BY_ID:
                    fam_of_curated[k][(vs[i]["famname"], vs[i]["cat"], vs[i]["fam"])] += 1
            else:
                f, _ = family_of(r.get("mname") or r["name"])
                if f:
                    fam_of_curated[k][(f["name"], f["cat"], f["id"])] += 1
    # same label twice in a family (names that differ only in their explanation): show the explanation
    seen = defaultdict(list)
    for k in keys.values():
        seen[(k["famname"], k["cat"], k["label"])].append(k)
    for ks in seen.values():
        if len(ks) > 1:
            # the explanation that tells them apart: '(요정귀) (벨로테로)' / '(요정귀) (레스틸렌)' → 벨로테로 / 레스틸렌, not 요정귀 for all
            # three (2026-10-15); when none does, '표기 1', '표기 2'
            common = set.intersection(*(set(details.get(k["sig"], [])) for k in ks))
            ks = sorted(ks, key=lambda x: -x["n"])     # stable: ties keep build order, as before (the 표기 numbers don't move)
            extras = [next((d for d in details.get(k["sig"], []) if d not in common), "") for k in ks]
            for n, (k, extra) in enumerate(zip(ks, extras)):
                if not extra or extras.count(extra) > 1:
                    extra = f"표기 {n + 1}"
                k["label"], k["sub"] = f"{k['label']} ({extra})", f"{k['sub']} ({extra})"
    for k in keys.values():
        k["label"], k["sub"] = word_order(k["label"]), word_order(k["sub"])
    fams = {}
    new_fam = lambda name, cat, fid, rx: dict(name=name, cat=cat, fam=fid, keys=[], curated=[], desc=[], rx=rx)
    for k in keys.values():
        fams.setdefault((k["famname"], k["cat"]), new_fam(k["famname"], k["cat"], k["fam"], k["rx"]))["keys"].append(k["id"])
    from xkeys import X
    xlabel = {k[0]: re.sub(r"\s+", "", k[2]) for k in X}
    for cid, c in fam_of_curated.items():
        # prefer a family whose name is all in the key's label ('(여) 겨드랑이 제모 1회' → 겨드랑이 제모, not 겨드랑이·인중 제모)
        fit = [x for x, _ in c.most_common() if all(w in xlabel.get(cid, "") for w in re.split(r"[\s·]+", x[0]) if w)]
        (fname, fcat, fid) = fit[0] if fit else c.most_common(1)[0][0]
        fams.setdefault((fname, fcat), new_fam(fname, fcat, fid, FAM_BY_ID[fid]["rx"] + ("|보톡스|보툴" if fid == "toxin" else "")))["curated"].append(cid)
    # the clinics' own explanation in brackets ('리쥬란힐러(PN 프리미엄 스킨부스터)'), most common first
    said = defaultdict(Counter)
    for i, v in enumerate(vs):
        if v:
            for t in re.findall(r"\(([^()]{4,40})\)", rows[i]["name"]):
                t = t.strip()
                if " " in t and "," not in t and not labels.desc_problems(t) and not re.search(r"국산|국내산|수입|독일|미국|일반형|고순도|\d|회|체험|한정|이벤트|포함|별도|VAT|부가세|택|중|or|/|여|남|이상|이하|제외|소분|단독|본원|시술시|톡신|\+|전체", t):
                    said[(v["famname"], v["cat"])][t] += 1
    for key, f in fams.items():
        f["desc"] = [t for t, n in said[key].most_common(2) if n >= 3]
    covered = sum(1 for i, r in enumerate(rows) if row_keys[i] or any(k.startswith("X") for k in (r.get("keys") or "").split()))
    few = sum(1 for i, v in enumerate(vs) if v and not row_keys[i] and not any(k.startswith("X") for k in (rows[i].get("keys") or "").split()))
    why["판매 지점 3곳 미만(비교 대상 없음)"] = few
    stats = dict(rows=len(rows), covered=covered, auto_keys=len(keys), owned=len(owned), why=dict(why),
                 label_rejected=sorted(rejected, key=lambda x: -x["n"]), merged=sorted(merged, key=lambda x: -x["rows"]),
                 label_rescued=sorted(rescued, key=lambda x: -x["n"]))
    return row_keys, list(keys.values()), list(fams.values()), stats


def _order(k):
    m = re.search(r"(\d+(?:\.\d+)?)", k.get("amount", "") or "")
    return (k.get("sub", ""),)


if __name__ == "__main__":
    tests = [
        ("리쥬란힐러(PN 프리미엄 스킨부스터) 2cc 1회", "rejuran", "리쥬란 힐러 2cc"),
        ("리쥬란 힐러 2cc", "rejuran", "리쥬란 힐러 2cc"),
        ("리쥬란 HB 플러스(저통증 PN 프리미엄 스킨부스터) 1cc 3회", "rejuran", "리쥬란 HB 플러스 1cc 3회"),
        ("아이 리쥬란힐러(눈가 전용 PN 프리미엄 스킨부스터) 1cc 1회", "rejuran", "아이 리쥬란 힐러 1cc"),
        ("리쥬란 스킨부스터(PN 베이직 스킨부스터) 1cc", "rejuran", "리쥬란 스킨부스터 1cc"),
        ("쥬베룩 볼륨(PDLLA 콜라겐부스터) 8cc 3회", "juvelook", "쥬베룩 볼륨 8cc 3회"),
        ("스킨보톡스(국산 일반형) 얼굴전체 1회", "toxin", "국산 스킨보톡스 얼굴전체"),
        ("국산 턱보톡스 50U", "toxin", "국산 사각턱 보톡스 50U"),
        ("사각턱보톡스(국산 일반형) 50U 1회", "toxin", "국산 사각턱 보톡스 50U"),
        ("수입 독일산 턱보톡스 50U", "toxin", "독일산 수입 사각턱 보톡스 50U"),
        ("주름보톡스(국산 일반형) 1부위 1회", "toxin", "국산 주름 보톡스 1부위"),
        ("주름보톡스 이마(국산)", "toxin", "국산 주름 보톡스 이마"),
        ("다한증보톡스(국산 일반형) - 겨드랑이 50U 1회", "toxin", "국산 다한증 보톡스 겨드랑이 50U"),
        ("바디보톡스(국산 일반형) - 종아리/승모근 100U 1회", "toxin", "국산 바디 보톡스 승모근 종아리 100U"),
        ("슈링크 유니버스 리프팅(고강도 집속 초음파) 울트라F 300샷", "shrink", "슈링크 유니버스 울트라F 300샷"),
        ("슈링크 유니버스 울트라 300샷", "shrink", "슈링크 유니버스 울트라 300샷"),
        ("아이 슈링크 유니버스 리프팅 100샷", "shrink", "아이 슈링크 유니버스 100샷"),
        ("바디 인모드 리프팅 - 팔뚝/허벅지/상복부/하복부/옆구리/부유방 등 1부위", "inmode", "바디 인모드 (팔뚝·허벅지·상복부·하복부·옆구리·부유방) 1부위"),
        ("인모드 리프팅 FX 모드 - 얼굴전체", "inmode", "인모드 FX 얼굴전체"),
        ("코필러(국산) 1cc", "filler", "국산 코 필러 1cc"),
        ("[여성]겨드랑이 제모 1회", "hair", "여성 겨드랑이 제모"),
        ("겨드랑이/인중 제모 5회", "hair", "겨드랑이·인중 제모 5회"),
        ("상체 제모 · 겨드랑이 1회", "hair", "겨드랑이 제모"),
        ("필러 녹이는 주사", "hyal", "필러 녹이는 주사(히알라제)"),
        ("피코토닝 1회", "pico", "피코토닝"),
        ("레이저토닝 10회", "toning", "레이저토닝 10회"),
        ("듀얼토닝 체험가", "toning", "듀얼 레이저토닝"),
        ("아크네 포텐자(피지선 파괴술) 개당", "potenza", "아크네 포텐자 개당"),
    ]
    rejects = [("옵션2) 큐어스템 엑소좀 1회 추가", "추가 옵션"), ("울쎄라 프라임 100샷 *300샷 이상 시", "조건부 가격(○○ 이상 시)"),
               ("겨드랑이/인중 제모 1년 구독권", "이용권·무제한")]
    # bundles and names no rule covers: same product only when the whole name is the same → (category, family)
    exact = [("리쥬베룩 패키지(리쥬란힐러/리제반PN 2cc + 쥬베룩 스킨 2cc + 크라이오셀) 한정가", "패키지", "리쥬란 포함 패키지"),
             ("볼뉴머300샷X슈링크300샷", "패키지", "슈링크 유니버스 포함 패키지"),
             ("환절기 스킨 리커버리(제네시스 레이저 + 비타민관리 + 크라이오셀) 한정가", "패키지", "제네시스 포함 패키지"),
             ("인라이튼 니플스(피코 프락셔널) · 인라이튼 니플스(피코 프락셔널) 1회", "기타", "인라이튼 니플스"),
             ("리팟 레이저(VSLS 특화 색소 치료) - 5mm 이하", "피부", "리팟 레이저 - 이하")]
    bad = 0
    for name, fam, label in tests:
        v, why = variant(name)
        if not v or v["fam"] != fam or v["label"] != label:
            bad += 1
            print("FAIL", name, "→", v and (v["fam"], v["label"]), why)
    for name, want in rejects:
        v, why = variant(name)
        if v or why != want:
            bad += 1
            print("FAIL reject", name, "→", v and v["label"], why)
    rowcat = {"인라이튼": "기타", "리팟": "피부·레이저"}
    for name, cat, famname in exact:
        v, why = variant(name, cat=next((c for w, c in rowcat.items() if w in name), ""))
        if not v or v["cat"] != cat or v["famname"] != famname:
            bad += 1
            print("FAIL exact", name, "→", v and (v["cat"], v["famname"], v["label"]), why)
    v, _ = variant(" · [여성] 이마 1회", cat="제모")
    if not v or v["famname"] != "이마 제모" or "여성" not in v["tags"]:
        bad += 1
        print("FAIL hair area from option", v and v["label"])
    a, b = variant("환절기 스킨 리커버리(제네시스 레이저 + 비타민관리 + 크라이오셀) 한정가")[0], variant("환절기 스킨 리커버리(제네시스 레이저 + 비타민관리) 한정가")[0]
    if a["sig"] == b["sig"]:
        bad += 1
        print("FAIL package with different parts merged")
    # 4.0 audit (docs/PRODUCT_AUDIT.md): what one key must not mix
    for x, y, why in [("(남자) 겨드랑이/인중 제모(아포지 플러스) 체험가", "(남자) 겨드랑이/인중 제모(에일린) 1회", "device"),
                      ("아그네스 · 아그네스(개당)", "아그네스 · 아그네스(얼굴전체) 1회", "개당 vs 얼굴전체"),
                      ("바디 착색토닝(겨드랑이/팔꿈치/무릎) 체험가", "바디 착색토닝(등 전체) 1회", "area in brackets"),
                      ("나비존 프락셀 레이저(CO2 프락셔널) 1회", "나비존 프락셀 레이저(어븀글라스 프락셔널) 1회", "CO2 vs 어븀"),
                      ("LDM 물방울 리프팅 1회 #6분 시술", "LDM 물방울 리프팅(고밀도 저자극 초음파) 1회 #24분 시술", "minutes"),
                      ("프리미엄 영양 수액주사(감초/마늘)", "프리미엄 영양 수액주사(NAD+)", "ingredients"),
                      ("(남자) 종아리 + 무릎 제모(아포지 플러스) 10회 한정가", "(남자) 종아리 + 무릎 제모(아포지 플러스) 1회", "sessions")]:
        va, vb = variant(x)[0], variant(y)[0]
        if va and vb and va["sig"] == vb["sig"]:
            bad += 1
            print("FAIL merged", why, x, "|", y)
    v = variant("바디제모(여성) 팔전체", display="바디제모(여성) · 팔전체")[0]
    if not v or v["famname"] != "팔전체 제모":
        bad += 1
        print("FAIL hair area from the shown name", v and v["label"])
    v = variant("리프테라2 리프테라2 3000샷")[0]
    if not v or v["amount"] != "3000샷":
        bad += 1
        print("FAIL model number read into the amount", v and v["label"])
    v = variant("바디톡신 100유닛(외국산)")[0]
    if not v or "국산" in v["tags"] or "수입" not in v["tags"]:
        bad += 1
        print("FAIL 외국산 read as 국산", v and v["tags"])
    for x, y in [("인라이튼 니플스 · 인라이튼 니플스(피코 프락셔널) 1회", "인라이튼 니플스(피코 프락셔널) · 인라이튼 니플스(피코 프락셔널) 1회"),
                 ("세계 최초 액상형 콜라겐, 고우리 런칭 특가 · 고우리 1회 (5cc)", " · 고우리 1회 (5cc)")]:
        va, vb = variant(x, cat="기타")[0], variant(y, cat="기타")[0]
        if not va or not vb or va["sig"] != vb["sig"]:
            bad += 1
            print("FAIL same product under another group title", x, "|", y)
    a, b = variant("겨드랑이/인중 제모 5회")[0], variant("인중/겨드랑이 제모 5회")[0]
    if a["sig"] != b["sig"]:
        bad += 1
        print("FAIL area order")
    print("tests", len(tests) + len(rejects) + len(exact) + 15, "fail", bad)
    if bad and "--report" not in sys.argv:
        sys.exit(1)
    if "--report" in sys.argv:
        import csv, os
        ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        rows = list(csv.DictReader(open(os.path.join(ROOT, "data2", "clean.csv"), encoding="utf-8")))
        rk, keys, fams, st = build(rows)
        names = defaultdict(Counter)
        for r, k in zip(rows, rk):
            if k:
                names[k][r["name"]] += 1
        with open(os.path.join(ROOT, "data2", "variants_report.txt"), "w", encoding="utf-8") as f:
            f.write(f"{st}\n")
            for fm in sorted(fams, key=lambda x: (CATS.index(x["cat"]), x["name"])):
                f.write(f"\n## {fm['cat']} / {fm['name']}  curated={fm['curated']}\n")
                for kid in fm["keys"]:
                    k = next(x for x in keys if x["id"] == kid)
                    f.write(f"  {kid} [{k['n']}곳] {k['label']}\n")
                    for nm, c in names[kid].most_common(4):
                        f.write(f"      {c}× {nm}\n")
        print(st)
