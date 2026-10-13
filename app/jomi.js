// 죠미(Jomi) — 윤실장 공식 안내냥. One registry for every image and line of hers the app shows (docs/JOMI_*.md).
// Every file is cut from the official artwork (brand/yoonsiljang-icon-original.webp, never overwritten) by
// brand/make_mascot.py: nothing is redrawn or generated. The artwork has ONE pose — a smiling wink with the tongue out
// and the heart collar — so 'default', 'happy' and 'wink' are that pose itself, and the other expressions show the same
// pose until approved artwork of that expression is added (art: "pending"; what is needed: docs/JOMI_ASSET_INVENTORY.md).
// To add one: put the files in app/assets/jomi/, give the entry { face: "...", portrait: "..." } and set art: "approved".
window.JOMI = {
  name: "죠미",
  en: "Jomi",
  role: "윤실장 공식 안내냥 · 피부시술 정보 도우미",
  files: {
    face: "assets/jomi/jomi-face-96.webp",          // head in a circle (shown at 20–48 px)
    faceLg: "assets/jomi/jomi-face-160.png",        // head in a circle, PNG (PIN screen)
    portrait: "assets/jomi/jomi-portrait-360.webp", // head, paws, heart collar (intro sheet, empty states)
  },
  expressions: {
    default: { art: "original", mood: "기본 미소", use: "홈·헤더" },
    welcome: { art: "pending", mood: "반가운 표정", use: "자기소개" },
    curious: { art: "pending", mood: "궁금한 표정", use: "피부 고민 가이드" },
    thinking: { art: "pending", mood: "생각하는 표정", use: "정보 찾는 중" },
    explaining: { art: "pending", mood: "안경 쓴 설명 표정", use: "시술 사전" },
    happy: { art: "original", mood: "신나는 표정", use: "담기·저장 완료" },
    wink: { art: "original", mood: "윙크", use: "가격 알림 설정 완료" },
    empty: { art: "pending", mood: "시무룩한 표정", use: "검색 결과 없음" },
    cart: { art: "pending", mood: "장바구니를 든 표정", use: "빈 장바구니" },
    sleeping: { art: "pending", mood: "졸린 표정", use: "로딩·대기" },
    error: { art: "pending", mood: "곤란한 표정", use: "오류 복구" },
  },
  // her lines (docs/JOMI_COPYWRITING.md): friendly 반말, short, never a diagnosis, a dose or a pick for the user
  lines: {
    intro: ["안녕! 난 죠미야!", "시술 이름도 어렵고 가격도 헷갈리지?",
      "내가 다양한 시술 정보를 쉽게 알려주고, 병원별 가격도 비교할 수 있도록 도와줄게.", "궁금한 게 있으면 언제든 찾아와!"],
    back: "또 왔네! 오늘은 어떤 시술이 궁금해?",
    homeFirst: "안녕! 오늘은 어떤 피부 고민이 있어?",
    homeBack: "또 왔네! 오늘은 어떤 시술이 궁금해?",
    does: ["어려운 시술 이름을 쉽게 풀어 줘", "같은 용량·회차끼리 병원별 가격을 비교해", "가격이 내려가면 앱을 열 때 알려 줘"],
    doesNot: "나는 의료진이 아니라서 진단이나 시술 추천은 하지 않아. 정보만 정리해 줄게.",
    loading: "오늘의 가격을 살펴보는 중…",
    slow: "평소보다 오래 걸리고 있어. 인터넷 연결을 확인해 줄래?",
    error: "잠깐 문제가 생겼어. 다시 시도해 볼까?",
    concernAsk: "어떤 점이 고민인지 편하게 적어줘. 관련된 일반 정보와 시술 설명, 확인할 위험과 한계를 찾아볼게.",
    concernFound: "적어 준 말과 관련된 정보를 찾아봤어. 결정은 꼭 의료진과 상담해서 해 줘.",
    guideTip: "스킨보톡스랑 주름보톡스는 뭐가 다를까? 이름이 비슷한 시술을 쉽게 정리했어.",
    emptySearch: "아직 찾지 못했어. 검색 조건을 바꿔볼까?",
    emptyCart: "아직 담은 시술이 없네!",
    emptyCartSub: "관심 있는 시술을 담으면 병원별 비용을 비교할 수 있어.",
    saved: "저장했어! 관심 탭에서 다시 볼 수 있어.",
    added: "담았어! 장바구니에서 병원별로 비교해 볼 수 있어.",
    alertSet: "좋아! 조건이 맞으면 알려줄게.",
    easter: ["비교는 내가, 결정은 네가!", "같은 용량끼리만 비교하는 게 내 원칙이야.", "가격표 읽는 게 제일 재밌어.", "체험가는 보통 1인 1회야. 꼭 확인해!", "간지러워!"],
  },
};
