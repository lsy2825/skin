// 죠미와 대화 — 사용자가 적은 말이 무엇을 묻는지 알아듣는 규칙 엔진 (화면 없음, 저장 없음, 모델 호출 없음).
// window.JomiChat in the app (needs window.Search, window.Concern, window.Stats); require()d by tests and tools.
//
// 2026-10-15 사고: 대화 화면이 '피부 고민 낱말 사전'(domain/concern.js)만 알아서 "카프리"처럼 시술 이름을 적으면 아무것도 못
// 찾았어요(평가 세트 215문장 중 17.7%만 알아들음: 시술 14% · 가격 0% · 도움말 0% · 이어 묻기 0%). 이 엔진은 한 문장에서 다음을
// 차례로 읽어요.
//   안전     응급 신호 → 의료진 안내만(다른 답 없음). 개인 판단(나한테 맞는지·용량) → 안내 + 일반 정보만
//   도움말   부가세·장바구니·체험가·중간값·데이터 날짜·신고·지도·알림·예약 … (앱 사용법, 의학 문장 아님)
//   인사     안녕·고마워·누구야
//   시술     묶음 이름(data.json meta.fam)과 별칭(search.js ALIASES + 아래 CHAT_ALIASES), 오타는 자모 거리로 '혹시 ○○?'
//   가격     얼마·가격·최저·싼 곳 → 그 시술의 묶음 하나를 규격(2cc·300샷·50U·3회·1부위)대로 골라 모은 가격(최저·중간·최고·지점 수)
//   지역     서울·강남·블리비 … (search.js interpret) → 그 지역·브랜드 지점의 가격만
//   두 시술  '차이·비교·vs' + 시술 둘 → 둘 다
//   고민     concern.js 그대로(고민 낱말만으로 시술을 고른 경우는 고민 카드가 먼저)
//   이어 묻기 시술 없이 '그럼 4cc는?', '강남은?', '얼마야?' → 바로 앞에 말한 시술(memory)에 붙여서
// 의학 설명은 지식 파일(knowledge/treatments.json) 문장과 병원이 상품명에 적은 설명만 써요. 가격은 모은 가격 그대로예요.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./search.js"), require("./concern.js"), require("./stats.js"));
  else root.JomiChat = factory(root.Search, root.Concern, root.Stats);
})(typeof self !== "undefined" ? self : this, function (Search, Concern, Stats) {
  "use strict";
  const MAX_LEN = 200;

  // words people use in chat that the price-search aliases don't cover
  // a second, independent check for emergency signs (the knowledge file's pattern is the first): '숨이 막혀요' must never get
  // a price answer (2026-10-15 held-out set: the old pattern knew '막히' but not '막혀')
  const URGENT = /숨\s*(이|쉬기)?\s*(가|를)?\s*(차|막|힘들|힘드|답답|안\s*쉬)|호흡\s*곤란|의식\s*(이)?\s*(없|흐려|잃)|실신|쓰러졌|시야\s*(가)?\s*(흐|가려|좁)|실명|피가\s*안\s*멈|괴사|아나필락시스/;
  const URGENT_MSG = { id: "urgent", level: "emergency", title: "지금 바로 의료진에게 연락하세요", message: "숨쉬기 어려움·의식 저하·시야 이상 같은 증상은 빨리 처치가 필요할 수 있어요. 시술받은 병원에 바로 연락하거나 119·응급실을 이용하세요. 죠미는 증상을 판단할 수 없어요." };
  const CHAT_ALIASES = [[/엑셀\s*브이/g, "엑셀V"], [/에프엑스/g, "FX"], [/(^|[^각])턱\s*보톡스/g, "$1사각턱 보톡스"], [/써마지\s*에프엘엑스/g, "써마지 FLX"], [/겨털/g, "겨드랑이 "], [/코필러/g, "코 필러"], [/레이져/g, "레이저"], [/리프트(?!팅)/g, "리프팅"], [/보톡(?!스)/g, "보톡스"],
    [/점\s*빼(기|는|고)?/g, "점빼기 "], [/물광(?!주사)/g, "물광주사"], [/써마지\s*flx/gi, "써마지 FLX"]];

  // what the message asks for (checked on the text with spaces removed)
  const PRICE = /얼마|가격|비용|시세|최저|싸|싼|저렴|비싸|금액|견적|평균|중간값|가격대|원이야|원임|돈/;
  const INFO = /뭐야|뭐임|뭔가요|뭐에요|뭐예요|뭔데|무엇|어떤|어때|설명|효과|궁금|원리|방식|알려|란\?|이란/;
  const VERSUS = /차이|비교|vs|다른점|다른거|다른데|다르|뭐가달라|달라|어느게|어떤게나아|뭐가나아|중에뭐/i;
  // function words dropped before the treatment is looked up (a word that names nothing but the question)
  const STOP = new Set(["가격", "얼마", "얼마야", "얼마임", "얼마에요", "얼마예요", "얼마정도", "얼마정도해", "얼마나", "비용", "시세", "최저가", "최저", "제일", "가장", "싼", "싼곳",
    "싼데", "곳", "곳은", "어디", "어디야", "알려줘", "알려", "줘", "뭐야", "뭐임", "뭔가요", "뭐에요", "뭐예요", "어떤", "어떤거", "어떤거야", "시술", "효과", "궁금", "궁금해",
    "설명", "설명해줘", "해줘", "정도", "좀", "평균", "가격대", "비교", "차이", "차이가", "vs", "그럼", "그리고", "그러면", "은", "는", "요", "들어", "드나요", "해", "해요", "임",
    "이야", "인가요", "있어", "있나요", "추천", "어때", "알고", "싶어", "싶어요", "대해", "에", "대해서", "얼마에", "받으면", "하면", "비싸", "저렴한", "가격은", "가격이",
    "얼마인가요", "얼만가요", "얼만데", "싸요", "다른", "달라", "뭐가", "랑", "이랑", "하고", "와", "과", "레이저는", "가요", "할까", "할래", "보여줘", "찾아줘"]);
  const PARTICLE = /(이랑|하고|에서|으로|이야|이에요|예요|에요|인가요|이란|이요|은|는|이|가|을|를|도|만|랑|와|과|로|야|요|임)$/;

  // app help — how the app works (never medical); `go` is a route the answer offers as a button
  const HELP = [
    { id: "vat", rx: /부가세|부가가치세|vat/i, say: "병원마다 가격에 부가세(10%)를 넣기도 하고 빼기도 해요. 설정의 '가격 표시'에서 '부가세 포함 예상가'를 고르면 별도로 적은 곳에 10%를 더해서 같이 견줘요. 확인 못 한 곳은 그대로 둬요.", go: ["me", "설정 열기"] },
    { id: "cart", rx: /장바구니|담기|담으면|담아/, say: "시술을 장바구니에 담으면 그 시술들을 한 곳에서 다 받을 때 어느 지점이 합계가 얼마인지, 섞어서 받으면 얼마인지 계산해 줘요. 예산 상한도 정할 수 있어요.", go: ["cart", "장바구니 열기"] },
    { id: "event", rx: /체험가|첫방문|첫\s*방문|한정가|이벤트가|선착순/, say: "체험가·첫 방문가·한정가는 조건이 붙은 가격이에요(처음 한 번만, 수량 한정 등). 가격 옆에 조건 표시가 붙고, 비교 화면에서 '조건 없는 가격만' 보기를 고를 수 있어요." },
    { id: "median", rx: /중간값|중앙값|평균값|중간가격/, say: "중간값은 지점별 가격을 싼 것부터 줄 세웠을 때 가운데 가격이에요. 아주 싸거나 비싼 몇 곳에 덜 흔들려서 '보통 이 정도'를 볼 때 써요." },
    { id: "data", rx: /언제\s*(업데이트|갱신|모은|수집|바뀌)|업데이트|갱신|최신|데이터\s*(날짜|언제)|언제\s*가격|수집\s*날짜|언제\s*모|(며칠|몇\s*일|얼마)\s*마다|가격\s*(은|이)?\s*(자주\s*)?바뀌/, say: "가격은 병원 공식 홈페이지에서 매주 모아요. 화면 위 날짜가 가장 많은 지점을 모은 날이에요. 실제 가격은 병원에 꼭 확인하세요.", go: ["about", "데이터 안내"] },
    { id: "report", rx: /틀린\s*가격|(가격|금액).{0,10}(달라|다르|틀려|틀리|안\s*맞|이상해)|실제(랑|와)\s*달|신고|잘못된\s*가격|오류\s*제보/, say: "가격 옆 '가격 근거'에서 병원 원문 주소와 모은 날을 볼 수 있고, 거기서 '틀린 가격 알리기'를 누르면 기록돼요. 병원이 가격을 바꿨을 수 있어요." },
    { id: "map", rx: /지도|가까운|근처|위치|어디\s*있|내\s*주변/, say: "지도에서 지점 위치와 가격을 같이 볼 수 있어요. 기준 위치를 정하면 가까운 순으로도 볼 수 있어요.", go: ["map", "지도 열기"] },
    { id: "alert", rx: /알림|알려\s*줘.*(내리|떨어|싸지)|가격\s*(내리|떨어)|싸지면/, say: "시술을 관심에 저장하면, 앱을 열 때 모은 가격이 내려간 곳이 있으면 알려 드려요(이 기기 안에서).", go: ["saved", "관심 열기"] },
    { id: "brands", rx: /어떤\s*병원|어느\s*(병원|브랜드)|몇\s*(군데|곳|개)\s*(병원)?|병원\s*(목록|리스트)|브랜드\s*(목록|뭐)/, say: "공장형 피부과 여러 브랜드의 지점 가격을 모아요. 홈 화면 위에 지금 모은 브랜드와 지점 수가 나와요.", go: ["about", "모은 범위 보기"] },
    { id: "privacy", rx: /개인\s*정보|내\s*정보|저장\s*(돼|되나|해)|기록\s*(남|돼)|전송/, say: "이 대화는 이 화면에만 있고 저장하거나 보내지 않아요. 주소·검색 기록에도 남지 않아요." },
    { id: "booking", rx: /예약/, say: "윤실장은 가격 비교만 하고 예약·결제는 하지 않아요. 지점 화면의 공식 홈페이지 링크로 병원에 직접 문의하세요." },
    { id: "howto", rx: /(어떻게|어케)\s*(써|쓰|사용|봐|보|비교|해)|사용법|사용\s*방법|뭘\s*할\s*수|기능/, say: "시술 이름을 적거나 '리쥬란 2cc 얼마야', '강남 슈링크 제일 싼 곳'처럼 물어보면 모은 가격을 알려 줄게. 비교 화면에서는 같은 용량·횟수끼리 지점별로 줄 세워 봐요.", go: ["explore", "비교하러 가기"] },
  ];
  const CHIT = [
    { id: "hello", rx: /^(안녕|하이|헬로|hello|hi|ㅎㅇ|반가워|안뇽)/i, say: "안녕! 나는 죠미야. 시술 이름이나 '리쥬란 2cc 얼마야'처럼 물어보면 모은 가격을 찾아 줄게." },
    { id: "thanks", rx: /^(고마워|고맙|감사|땡큐|thanks|thx|ㄱㅅ)/i, say: "천만에! 더 궁금한 시술 있으면 말해 줘." },
    { id: "who", rx: /누구|너는\s*뭐|넌\s*뭐|너\s*뭐|이름이\s*뭐|^죠미|뭐\s*할\s*수\s*있|뭘\s*할\s*수|뭐\s*하는\s*(애|거|앱)|정체/, say: "나는 윤실장의 죠미야. 시술 이름·가격·지역을 알아듣고 모은 가격을 보여줘. 진단이나 시술 추천은 못 해(그건 의료진이 정해)." },
    { id: "laugh", rx: /^(ㅋ+|ㅎ+|하하|헤헤)+$/, say: "헤헤. 궁금한 시술 있으면 말해 줘!" },
  ];

  // body areas: they narrow a treatment down but never name one ('이마랑 미간 주름이 신경 쓰여요' is a concern, not 이마 제모)
  const AREA = new Set(["이마", "미간", "눈가", "눈밑", "눈", "턱", "턱끝", "턱라인", "볼", "앞볼", "팔자", "입술", "입꼬리", "코", "콧볼", "목", "겨드랑이", "인중", "종아리",
    "허벅지", "팔", "팔뚝", "다리", "등", "가슴", "배", "복부", "얼굴", "얼굴전체", "바디", "헤어라인", "관자", "광대", "엉덩이", "무릎", "손", "발", "두피", "부분", "전체"]);
  const memory = () => ({ fam: null, key: null, where: null, turns: 0 });

  // ---- the treatment index, built once per data version
  function index(fams) {
    const df = new Map();
    for (const f of fams) {
      f.nn = Search.norm(f.name);
      f.toks = [...new Set(f.name.split(/[\s·/()+\-,]+/).map((w) => Search.norm(w)).filter((w) => w.length >= 2))];
      for (const t of f.toks) df.set(t, (df.get(t) || 0) + 1);
    }
    const vocab = [...df.keys()].filter((t) => /[가-힣]/.test(t) && t.length >= 2);
    return { df, vocab, vjamo: vocab.map((t) => [t, Search.jamo(t)]) };
  }

  // ctx: { fams: [{name, cat, fid, desc, n, keys: [{id, label}]}], brands, sido, areas, concerns, kbOf(fam), price(id, where) → {n, min, med, max} }
  function ctx(o) {
    const fams = o.fams.map((f) => ({ ...f, keys: f.keys.map((k) => ({ ...k, ...specOf(k.label) })) }));
    return { ...o, fams, idx: index(fams) };
  }

  // spec in a label or a question: amount + unit, sessions, number of areas
  function specOf(t) {
    const u = Search.unitOf(t || ""), s = /(\d+)\s*회(?!\s*(?:차|이상|이내|당|째|분))/.exec(t || ""), a = /(\d+)\s*부위/.exec(t || "");
    return { unit: u ? u.unit : null, qty: u ? u.qty : null, sess: s ? +s[1] : null, areas: a ? +a[1] : null };
  }
  const specText = (sp) => [sp.qty != null ? `${sp.qty}${sp.unit}` : "", sp.areas ? `${sp.areas}부위` : "", sp.sess ? `${sp.sess}회` : ""].filter(Boolean).join(" ");

  function words(text) {
    let t = String(text || "");
    for (const [re, rep] of CHAT_ALIASES) t = t.replace(re, rep);
    const raw = t.split(/[\s,.!?~·…"'“”‘’()\[\]]+/).filter(Boolean);
    return raw.map((w) => { const s = w.replace(PARTICLE, ""); return { raw: w, w: s.length >= 2 ? s : w }; });
  }

  // treatments named in the words → [{f, score, words: Set}] best first
  function findFams(ws, c, opts = {}) {
    // amounts stay in: a name can carry one ('소프웨이브 100펄스', '위고비 0.25mg') — but a number word only matches a name word
    // exactly, never part of one
    const keep = ws.filter((x) => !STOP.has(x.w) && !STOP.has(x.raw));
    const nw = keep.map((x) => Search.norm(x.w)).filter((w) => w.length >= 2);
    // the words written together, with the aliases applied and without (an alias inside glued words can break a name:
    // '피코토닝레이저' → '피코레이저토닝')
    const glueds = [Search.norm(keep.map((x) => x.w).join("")), keep.map((x) => x.w).join("").toLowerCase()];
    const out = [];
    for (const f of c.fams) {
      let score = 0, distinct = false;
      const used = new Set(), hit = new Set();
      const g = glueds.find((x) => x.length >= 2 && (x === f.nn || x.includes(f.nn)));
      if (g) { score += f.nn.length * 2 + (g === f.nn ? 8 : 4); distinct = !AREA.has(f.nn); f.toks.forEach((t) => used.add(t)); nw.forEach((w) => { if (f.nn.includes(w) || w.includes(f.nn)) hit.add(w); }); }
      for (const w of nw) {
        for (const t of f.toks) {
          if (used.has(t)) continue;
          // a whole name word, a word that contains it ('카프리레이저'), or the start of one ('리쥬란' of '리쥬란힐러') —
          // never a word inside another ('포함' is not '목포함')
          if (w === t || (!/^\d/.test(w) && (w.includes(t) || (t.startsWith(w) && w.length >= 2)))) {
            const len = Math.min(w.length, t.length);
            score += len + (w === t ? 2 : t.startsWith(w) ? 1 : 0);
            used.add(t); hit.add(w);
            // an area word never names a treatment, and the start of a longer word only when it is 3+ letters ('리쥬란' of
            // '리쥬란힐러', not '이마' of '이마거상리프팅')
            const partial = w !== t && !w.includes(t);
            if (!AREA.has(t) && !AREA.has(w) && !(partial && w.length < 3) && ((c.idx.df.get(t) || 0) <= 14 || f.toks.length === 1)) distinct = true;
          }
        }
      }
      if (!score) continue;
      const miss = f.toks.filter((t) => !used.has(t)).length;
      out.push({ f, score: score - miss * 1.5 + (distinct ? 3 : 0) + (miss === 0 ? 3 : 0), distinct, used, hit, exact: glueds.includes(f.nn) });
    }
    out.sort((a, b) => b.score - a.score || (b.f.n || 0) - (a.f.n || 0) || a.f.name.length - b.f.name.length);
    if (!out.length && opts.typo !== false) {
      // a typo ('슈링그', '리쥬렌', '까프리'): the closest name word by jamo distance, then look again
      const fixed = ws.map((x) => {
        const w = Search.norm(x.w);
        if (STOP.has(x.w) || w.length < 3 || !/[가-힣]/.test(w) || c.idx.df.has(w)) return x;   // two letters are too short to guess from ('하이')
        const jw = Search.jamo(w), max = w.length <= 3 ? 1 : 2;
        let best = null;
        for (const [t, jt] of c.idx.vjamo) { const d = Search.lev(jw, jt, max); if (d <= max && (!best || d < best.d || (d === best.d && (c.idx.df.get(t) || 0) > (c.idx.df.get(best.t) || 0)))) best = { t, d }; }
        return best ? { raw: x.raw, w: best.t, fixed: x.w } : x;
      });
      if (fixed.some((x) => x.fixed)) return findFams(fixed, c, { typo: false }).map((r) => ({ ...r, guess: fixed.filter((x) => x.fixed).map((x) => `${x.fixed}→${x.w}`) }));
    }
    return out;
  }

  // the variant of a treatment that answers the question: the spec asked, else the single-session one most branches sell
  function pickKey(f, sp, c, where) {
    const n = (k) => (c.price ? c.price(k.id, where).n : 0);
    let ks = f.keys.filter((k) => (sp.qty == null || (k.unit === sp.unit && k.qty === sp.qty)) && (sp.sess == null || (k.sess || 1) === sp.sess) && (sp.areas == null || k.areas === sp.areas));
    const honored = ks.length > 0;
    if (!ks.length) ks = f.keys;
    if (sp.sess == null) { const one = ks.filter((k) => (k.sess || 1) === 1); if (one.length) ks = one; }
    const best = ks.reduce((a, k) => (n(k) > n(a) ? k : a), ks[0]);
    return { key: best, honored: honored && !!specText(sp) };
  }

  function understand(text, c, memo = memory()) {
    const raw = String(text || "").slice(0, MAX_LEN), sq = raw.replace(/\s+/g, "");
    const res = { text: raw, kind: "unknown", safety: [], personal: false, fams: [], concerns: [], help: null, chit: null, key: null, spec: "", specHonored: false,
      where: {}, sort: null, price: null, fam2: null, guess: null, followUp: false, suggestions: [] };
    if (!sq) { res.kind = "empty"; return res; }
    // 1) safety first: an emergency sign gets the clinician message and nothing else
    if (c.concerns) {
      res.safety = Concern.safety(raw, c.concerns);
      res.personal = Concern.personal(raw, c.concerns) || /임신|수유|임산부/.test(sq);
    }
    if (URGENT.test(raw) && !res.safety.some((s) => s.level === "emergency")) res.safety.unshift(URGENT_MSG);
    if (res.safety.some((s) => s.level === "emergency")) { res.kind = "safety"; return res; }
    const ws = words(raw);
    // 2) where (brand · region · area) and sort, read the same way as the search box
    const it = Search.interpret(` ${ws.map((x) => x.w).join(" ")} `, { brands: c.brands || [], sido: c.sido || [], areas: c.areas || [] });
    for (const k of ["brand", "region", "area"]) if (it[k]) res.where[k] = it[k];
    if (it.sort) res.sort = it.sort;
    const whereWords = new Set(Object.values(res.where).flatMap((v) => [v, `${v}역`, `${v}점`, `${v}구`]));
    const ws2 = ws.filter((x) => !whereWords.has(x.w) && !(c.brands || []).includes(x.w));
    const sp = specOf(raw);
    res.spec = specText(sp);
    const wantsPrice = PRICE.test(sq) || !!res.sort;
    // 3) app help and small talk (only when no treatment is named)
    const found = findFams(ws2, c);
    const strong = found.filter((r) => r.distinct);
    const help = HELP.find((h) => h.rx.test(raw));
    const helpWords = help ? Search.norm((raw.match(help.rx) || [""])[0]) : "";
    const viaHelp = (r) => [...r.hit].every((w) => helpWords.includes(w) || w.includes(helpWords) || /장바구니|포함|별도|알림|지도|예약/.test(w));
    if (help && !found.some((r) => r.exact) && (!strong.length || strong.every(viaHelp)) && !(wantsPrice && strong.some((r) => !viaHelp(r)))) { res.kind = "help"; res.help = help.id; res.say = help.say; res.go = help.go || null; return res; }
    const chit = CHIT.find((h) => h.rx.test(raw.trim()));
    if (chit && (!strong.length || strong.every((r) => r.guess))) { res.kind = "chit"; res.chit = chit.id; res.say = chit.say; return res; }
    // 4) concern words (주름, 기미 …)
    const cr = c.concerns ? Concern.classify(raw, c.concerns) : { matches: [] };
    res.concerns = cr.matches;
    const concernWords = cr.matches.flatMap((m) => m.hits);
    // treatments found only through concern words ('모공' → 모공 보톡스) → the concern card answers, the treatments come after it
    const onlyConcern = (r) => !r.exact && [...r.used].every((t) => concernWords.some((h) => h.includes(t)));
    let fams = found.filter((r) => r.score >= (found[0] ? found[0].score * 0.6 : 0));
    if (res.concerns.length && fams.length && fams.every((r) => onlyConcern(r) || !r.distinct) && !wantsPrice) {
      res.kind = "concern"; res.fams = fams.slice(0, 3).map((r) => r.f); return res;
    }
    if (!fams.length && res.concerns.length) { res.kind = "concern"; return res; }
    // 5) two treatments compared
    if (VERSUS.test(sq) && found.length >= 2) {
      // the best treatment for each word: '슈링크랑 울쎄라 차이' → 슈링크 유니버스 + 울쎄라 (not two kinds of one)
      const a = found[0], b = found.find((r) => r.f.name !== a.f.name && [...r.hit].some((w) => !a.hit.has(w)) && ![...r.hit].some((w) => a.hit.has(w)));
      if (b) { res.kind = "compare2"; res.fams = [a.f, b.f]; res.fam2 = b.f; res.prices = [a.f, b.f].map((f) => { const { key } = pickKey(f, {}, c, res.where); return { key, price: c.price ? c.price(key.id, res.where) : null }; }); return res; }
    }
    // 6) follow-up: no treatment named, but a spec / place / price word → the treatment talked about just before
    // ... but only when nothing else is said: '오늘 날씨 어때요' is not about the last treatment
    const other = ws2.filter((x) => !STOP.has(x.w) && !STOP.has(x.raw) && !/^\d/.test(x.w) && !/^(그럼|그거|그건|그것|거기|이거|저거|그리고|그러면|그래서|음|아)$/.test(x.w) && !PRICE.test(x.w) && !INFO.test(x.w));
    if (!fams.length && memo.fam && !other.length && (res.spec || Object.keys(res.where).length || wantsPrice || INFO.test(sq) || /그럼|그거|거기|그건/.test(sq))) {
      fams = [{ f: memo.fam, score: 1, used: new Set() }];
      res.followUp = true;
      if (!Object.keys(res.where).length && memo.where && !res.spec) res.where = { ...memo.where };
    }
    if (!fams.length) {
      res.kind = "unknown";
      res.suggestions = suggest(raw, c);
      return res;
    }
    res.fams = fams.slice(0, 3).map((r) => r.f);
    res.guess = fams[0].guess || null;
    const f = res.fams[0];
    const { key, honored } = pickKey(f, sp, c, res.where);
    res.key = key; res.specHonored = honored;
    res.price = c.price ? c.price(key.id, res.where) : null;
    res.kind = wantsPrice || res.spec || res.followUp || Object.keys(res.where).length ? "price" : "treatment";
    memo.fam = f; memo.key = key; memo.where = Object.keys(res.where).length ? res.where : memo.where; memo.turns++;
    return res;
  }

  // nothing understood: names that start like the words, else the most compared ones
  function suggest(raw, c) {
    const ws = words(raw).map((x) => Search.norm(x.w)).filter((w) => w.length >= 1);
    const hits = c.fams.filter((f) => ws.some((w) => f.nn.startsWith(w))).sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, 4).map((f) => f.name);
    return hits.length ? hits : c.fams.slice().sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, 4).map((f) => f.name);
  }

  // a search typed like a question ('카프리 레이저 가격', '리쥬란 얼마야?') without the question words, so the price search
  // finds the treatment instead of nothing (2026-10-15 audit: 57% of such searches showed no price for the treatment)
  function cleanQuery(text) {
    const ws = words(text).filter((x) => !STOP.has(x.w) && !STOP.has(x.raw) && !/^(알려|궁금|어떤|어때|해줘|해요|있어|없어|좀|정도)/.test(x.w));
    return ws.map((x) => (/^\d/.test(x.raw) ? x.raw.replace(PARTICLE, "") : x.w)).join(" ").replace(/[?？!.]/g, "").trim();
  }

  // the summary a price answer shows: branches, lowest, median, highest (one lowest price per branch)
  function summary(ps) {
    if (!ps.length) return { n: 0 };
    const s = [...ps].sort((a, b) => a - b);
    return { n: s.length, min: s[0], med: Stats.median(s), max: s[s.length - 1] };
  }

  // node (tests, tools): the same context from data.json
  function ctxFromData(D, today) {
    const PC = require("./pricectx.js");
    const P = PC.fromData(D, today), S = D.s;
    const BRAND = D.meta.brands.map((b) => b[0]);
    const brOk = (b, w) => {
      const x = D.branches[b];
      if (w.brand && BRAND[x[0]] !== w.brand) return false;
      if (w.region && !(w.region === "수도권" ? ["서울", "경기", "인천"].includes(S[x[5]]) : w.region === "전국" || S[x[5]] === w.region)) return false;
      if (w.area && !(S[x[1]].includes(w.area) || new RegExp(`${w.area}구\\s`).test(S[x[2]] || ""))) return false;
      return true;
    };
    const price = (id, w = {}) => summary(P.prices(id, "").filter((x) => brOk(x.b, w)).map((x) => x.p));
    const keyLabel = new Map(D.keys.map(([id, , l]) => [id, l]));
    const fams = D.meta.fam.map(([name, , vs, cat, fid, desc]) => ({ name, cat, fid, desc: desc || [], keys: vs.map(([id]) => ({ id, label: keyLabel.get(id) || "" })).filter((k) => k.label) }))
      .filter((f) => f.keys.length);
    for (const f of fams) f.n = new Set(f.keys.flatMap((k) => P.prices(k.id, "").map((x) => x.b))).size;
    const areas = new Set();
    for (const x of D.branches) {
      for (const w of S[x[1]].replace(/점$/, "").split(/\s+/)) { const a = w.replace(/(역|점)$/, ""); if (a.length >= 2) areas.add(a); }
      const m = /([가-힣]{2,})구\s/.exec(S[x[2]] || ""); if (m) areas.add(m[1]);
    }
    const sido = [...new Set(D.branches.map((x) => S[x[5]]).filter(Boolean))];
    for (const x of [...BRAND, ...sido, "리저브", "본점"]) areas.delete(x);
    const KB = D.meta.kb || { entries: [] };
    const kbOf = (f) => KB.entries.find((e) => e.families.includes(f.name)) || KB.entries.find((e) => e.fids.includes(f.fid)) || null;
    return ctx({ fams, brands: BRAND, sido, areas: [...areas], concerns: D.meta.concerns, kbOf, price });
  }

  // the flat shape tools/jomi_chat_eval.js scores
  function toEval(r) {
    return { kind: r.kind, fams: r.fams.map((f) => f.name), key: r.key ? `${r.key.label} ${r.specHonored ? r.spec : ""}` : "", where: Object.values(r.where),
      concerns: r.concerns.map((m) => m.id), help: r.help, chit: r.chit, safety: r.safety.map((s) => s.level), personal: r.personal,
      prices: !!((r.price && r.price.n) || (r.prices && r.prices.some((x) => x.price && x.price.n))) };
  }

  return { MAX_LEN, HELP, CHIT, memory, ctx, ctxFromData, understand, summary, specOf, specText, words, findFams, toEval, cleanQuery };
});
