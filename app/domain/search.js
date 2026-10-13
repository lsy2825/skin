// Search normalization, alias dictionary, typo correction and autocomplete (requirement 3.1). No DOM.
// Loaded as window.Search in the app, require()d in tests/search.test.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Search = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // canonical form → spellings people type (English, romanized, spacing, common variants). Applied to the query AND the
  // price names, so '보톡스' finds '주름톡신' and 'rejuran' finds '리쥬란힐러'. Keep canonical forms as they appear in names.
  const ALIASES = {
    "톡신": ["보톡스", "보톡", "보툴리눔", "보튤리눔", "botox", "toxin", "보툴렉스"],
    "리쥬란": ["rejuran", "리쥬란힐러", "리주란", "rejuranhealer"],
    "슈링크": ["shurink", "shrink", "슈링크유니버스", "유니버스슈링크"],
    "울쎄라": ["울쎄라피", "울세라", "ulthera", "ultherapy", "울쎄라프라임"],
    "써마지": ["thermage", "서마지", "써마지flx", "thermageflx"],
    "인모드": ["inmode", "인모드fx", "인모드forma"],
    "온다": ["onda", "온다리프팅"],
    "올리지오": ["oligio", "올리지오x"],
    "볼뉴머": ["volnewmer", "볼뉴마"],
    "티타늄": ["titanium", "티타늄리프팅"],
    "덴서티": ["density", "덴시티"],
    "쥬베룩": ["juvelook", "주베룩"],
    "필러": ["filler", "필라"],
    "벨로테로": ["belotero"], "쥬비덤": ["juvederm", "주비덤"], "레스틸렌": ["restylane"],
    "레디어스": ["radiesse", "레디어쓰"], "스컬트라": ["sculptra", "스컬프트라"],
    "피코토닝": ["picotoning", "pico toning", "피코레이저토닝", "피코토닝레이저"],
    "레이저토닝": ["lasertoning", "laser toning", "토닝레이저"],
    "제네시스": ["genesis", "레이저제네시스"],
    "아쿠아필": ["aquapeel", "aqua peel", "아쿠아필링"],
    "포텐자": ["potenza", "포텐사"],
    "제오민": ["xeomin", "독일산톡신", "독일톡신"],
    "스킨보톡스": ["더모톡신", "스킨톡신", "더마톡신", "skinbotox", "물광보톡스"],
    "물광주사": ["물광", "물광주사"],
    "엑소좀": ["exosome", "엑소솜"],
    "점빼기": ["점제거", "점 빼기", "점빼"],
    "제모": ["레이저제모", "털제거", "hairremoval"],
    "윤곽주사": ["윤곽", "브이라인주사", "v라인주사"],
    "아포지": ["apogee", "아포지플러스"],
    "젠틀맥스": ["gentlemax", "젠틀맥스프로"],
    "크라이오셀": ["cryocell"],
    "클라리티": ["clarity"],
    "리투오": ["rituo"],
    "프락셀": ["fraxel"],
    "엘란쎄": ["ellanse"],
    "실리프팅": ["실리프트", "threadlift", "민트실"],
  };
  const UNIT = [
    [/(\d+)\s*(유닛|단위|units?)(?![a-z])/gi, "$1u"], [/(\d+)\s*u(?![a-z])/gi, "$1u"], [/(\d+)\s*(cc|ml|씨씨)/gi, "$1cc"],
    [/(\d+)\s*(샷|shot|shots)/gi, "$1샷"], [/(\d+),(\d{3})/g, "$1$2"], [/(\d+)\s*(kj|킬로줄)/gi, "$1kj"],
    [/(\d+)\s*만\s*줄/g, (m, n) => `${n * 10}kj`], [/(\d+)000\s*j(?![a-z])/gi, "$1kj"],
  ];
  // canonical lookup: variant (normalized) → canonical (normalized)
  const raw = (s) => (s || "").toLowerCase().replace(/[\s·\-_/()[\]{}]+/g, "");
  const VAR = [];
  // a variant that contains the canonical form or is contained in it is left as is: plain substring matching already
  // covers it, and replacing it would drop words ('리쥬란힐러' → '리쥬란') or duplicate them ('점빼' → '점빼기기')
  for (const [canon, vs] of Object.entries(ALIASES)) for (const v of vs) { const a = raw(v), c = raw(canon); if (!a.includes(c) && !c.includes(a)) VAR.push([a, c]); }
  VAR.sort((a, b) => b[0].length - a[0].length);       // longest first: '리쥬란힐러' before '리쥬란'
  const VMAP = new Map(VAR);
  const VRE = new RegExp(VAR.map(([v]) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");    // one pass over the text

  // normalize a query token or a name: lower case, units unified, spaces/punctuation removed, aliases → canonical
  function norm(s) {
    let t = (s || "").toLowerCase();
    for (const [re, rep] of UNIT) t = t.replace(re, rep);
    return raw(t).replace(VRE, (m) => VMAP.get(m));
  }

  // ---- Hangul jamo decomposition: typos usually change one jamo (슈링그 vs 슈링크), not a whole syllable
  function jamo(s) {
    let out = "";
    for (const ch of s) {
      const c = ch.charCodeAt(0) - 0xac00;
      if (c >= 0 && c < 11172) out += String.fromCharCode(0x1100 + Math.floor(c / 588), 0x1161 + Math.floor((c % 588) / 28)) + (c % 28 ? String.fromCharCode(0x11a7 + (c % 28)) : "");
      else out += ch;
    }
    return out;
  }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // index: normalized names + a vocabulary of words (with counts) for correction and autocomplete
  function buildIndex(names, extraTerms = []) {
    const vocab = new Map();
    const add = (w, n = 1) => { if (w.length >= 2) vocab.set(w, (vocab.get(w) || 0) + n); };
    const normNames = names.map((n) => norm(n));
    const memo = new Map();
    for (const n of names) for (const w of (n || "").split(/[^가-힣A-Za-z0-9]+/)) {
      if (w.length < 2 || !/[가-힣A-Za-z]/.test(w)) continue;
      let nw = memo.get(w);
      if (nw === undefined) { nw = norm(w); memo.set(w, nw); }
      add(nw);
    }
    for (const t of extraTerms) add(norm(t), 50);
    for (const c of Object.keys(ALIASES)) add(raw(c), 20);
    const words = [...vocab.entries()].map(([w, c]) => ({ w, c, j: jamo(w) }));
    return { normNames, words };
  }

  // query → tokens after correction. A token that matches no name is replaced by the closest vocabulary word
  // (jamo edit distance ≤ 1, or ≤ 2 for longer words). Returns {tokens, fixes: [[typed, used]]}
  function parse(q, index) {
    const fixes = [];
    const tokens = (q || "").split(/\s+/).map((t) => norm(t)).filter(Boolean).map((t) => {
      if (!index || index.normNames.some((n) => n.includes(t))) return t;
      const tj = jamo(t), max = tj.length > 6 ? 2 : 1;
      let best = null;
      for (const x of index.words) {
        if (Math.abs(x.j.length - tj.length) > max) continue;
        const d = lev(tj, x.j, max);
        if (d <= max && (!best || d < best.d || (d === best.d && x.c > best.c))) best = { w: x.w, d, c: x.c };
      }
      if (best) { fixes.push([t, best.w]); return best.w; }
      return t;
    });
    return { tokens, fixes };
  }
  const matches = (normName, tokens) => tokens.every((t) => normName.includes(t));

  // autocomplete: vocabulary words / terms containing the typed text (prefix first, then by frequency)
  function suggest(prefix, index, terms = [], limit = 8) {
    const p = norm(prefix);
    if (!p) return [];
    const out = [];
    const seen = new Set();
    for (const t of terms) { const n = norm(t); if (n.includes(p) && !seen.has(t)) { out.push({ text: t, score: (n.startsWith(p) ? 2000 : 1000) - t.length }); seen.add(t); } }
    for (const x of index.words) if (x.w.includes(p) && !seen.has(x.w)) { out.push({ text: x.w, score: (x.w.startsWith(p) ? 500 : 0) + Math.min(400, x.c) }); seen.add(x.w); }
    return out.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.text);
  }

  // ---- quantity in a name, for unit-price reference only (never for the default sort): 300샷, 2cc, 50U, 10KJ
  function unitOf(name) {
    const t = (name || "").replace(/(\d),(\d{3})/g, "$1$2");
    let m;
    if ((m = /(\d+(?:\.\d+)?)\s*샷/.exec(t))) return { qty: +m[1], unit: "샷", per: 100 };
    if ((m = /(\d+(?:\.\d+)?)\s*(?:cc|CC|ml|mL)/.exec(t))) return { qty: +m[1], unit: "cc", per: 1 };
    if ((m = /(\d+)\s*(?:U|유닛|unit|단위)(?![A-Za-z])/.exec(t))) return { qty: +m[1], unit: "U", per: 10 };
    if ((m = /(\d+)\s*(?:KJ|kJ|kj)/.exec(t))) return { qty: +m[1], unit: "KJ", per: 1 };
    if ((m = /(\d+)\s*만\s*줄/.exec(t))) return { qty: +m[1] * 10, unit: "KJ", per: 1 };
    return null;
  }
  // price per `per` units, rounded to won; null when no quantity or a multi-part bundle ('+')
  function unitPrice(name, price) {
    if (/\+/.test(name || "")) return null;
    const u = unitOf(name);
    if (!u || !u.qty) return null;
    return { unit: u.unit, per: u.per, price: Math.round(price / u.qty * u.per), qty: u.qty };
  }

  // ---- natural-language query → filters + remaining search words (requirement: 자연어 검색 조건 해석)
  // '강남 슈링크 300샷 10만원 이하 체험가' → {q: '슈링크 300샷', area: '강남', max: 100000, kind: '체험가', chips: [...]}
  // ctx: {brands: [names], sido: [names], areas: [place words found in branch names/addresses]}
  const PRICE = /(\d+(?:\.\d+)?)\s*(만\s*원|만|천\s*원|천|원)?\s*(이하|미만|아래|까지|이내|이상|초과|넘는|부터|대)?/;
  function money(n, u) { n = parseFloat(n); return Math.round(u && u.startsWith("만") ? n * 10000 : u && u.startsWith("천") ? n * 1000 : n); }
  function interpret(q, ctx = {}) {
    const out = { q: "", chips: [] };
    let text = ` ${(q || "").trim()} `;
    const take = (re, fn) => { const m = re.exec(text); if (m) { text = text.replace(m[0], " "); fn(m); } return m; };
    // price range '5만~10만', '5만원에서 10만원'
    take(/(\d+(?:\.\d+)?)\s*(만\s*원|만|천\s*원|천)?\s*(?:~|-|에서|부터)\s*(\d+(?:\.\d+)?)\s*(만\s*원|만|천\s*원|천)\s*(?:사이|까지)?/, (m) => {
      out.min = money(m[1], m[2] || m[4]); out.max = money(m[3], m[4]); out.chips.push(`${out.min.toLocaleString()}~${out.max.toLocaleString()}원`); });
    // single bound: needs a money unit (만/천/원) so '300샷' or '2cc' are never read as prices
    take(/(\d+(?:\.\d+)?)\s*(만\s*원|만원|만|천\s*원|천원|천|원)\s*(이하|미만|아래|까지|이내|이상|초과|넘는|부터|대)?(?=\s)/, (m) => {
      const v = money(m[1], m[2].replace(/\s/g, ""));
      const w = m[3] || "이하";
      if (/이상|초과|넘는|부터/.test(w)) { out.min = v; out.chips.push(`${v.toLocaleString()}원 이상`); }
      else if (w === "대") { out.min = v; out.max = v * 2 - 1; out.chips.push(`${v.toLocaleString()}원대`); }
      else { out.max = w === "미만" ? v - 1 : v; out.chips.push(`${v.toLocaleString()}원 ${w === "미만" ? "미만" : "이하"}`); }
    });
    for (const b of ctx.brands || []) take(new RegExp(`\\s${b}(의원|피부과)?\\s`), () => { out.brand = b; out.chips.push(b); });
    for (const s of ctx.sido || []) take(new RegExp(`\\s${s}(시|도|특별시|광역시)?\\s`), () => { out.region = s; out.chips.push(s); });
    take(/\s수도권\s/, () => { out.region = "수도권"; out.chips.push("수도권"); });
    for (const a of (ctx.areas || []).slice().sort((x, y) => y.length - x.length)) {
      if (out.area) break;
      take(new RegExp(`\\s${a}(역|점|구|동)?(\\s|근처|주변|에서)`), () => { out.area = a; out.chips.push(`${a} 근처 지점`); });
    }
    take(/\s(체험가|한정가|고시가)\s/, (m) => { out.kind = m[1]; out.chips.push(m[1]); });
    take(/\s(일반가|정가만|조건\s*없는)\s/, () => { out.cond = "plain"; out.chips.push("조건 없는 가격"); });
    take(/\s(패키지|\d+\s*회\s*권|여러\s*회)\s/, () => { out.sess = "pkg"; out.chips.push("2회 이상 패키지"); });
    take(/\s(이용권|무제한|구독)\s/, () => { out.sess = "pass"; out.chips.push("이용권"); });
    take(/\s(제일\s*싼\s*곳?|가장\s*싼\s*곳?|최저가?|싼\s*곳|저렴한\s*곳?)\s/, () => { out.sort = "price"; out.chips.push("싼 순"); });
    take(/\s(가까운|근처|주변)\s/, () => { out.sort = "near"; out.chips.push("가까운 순"); });
    take(/\s(할인율|많이\s*할인)\s/, () => { out.sort = "disc"; out.chips.push("할인율 큰 순"); });
    out.q = text.replace(/[?？!.]/g, " ").replace(/\s(에서|으로|로|를|을|은|는|이|가|좀|추천|알려\s*줘|찾아\s*줘|어디|얼마|가격|싸|싼|싼데|싸요|있어|있나요)(?=\s)/g, " ").replace(/\s+/g, " ").trim();
    return out;
  }

  // ---- treatment attributes for the price table filter (origin · sex · area · grade), read from comparison key labels
  // (build2/xkeys.py, build2/taxonomy.py — already checked against mismatches), not from raw product names. A word counts
  // only as a whole word: '팔' never matches inside '팔자', '목' never inside '목주름'.
  const ATTRS = [
    ["원산지", [["국산", "국산"], ["수입", "수입"], ["독일산", "독일산"], ["미국산", "미국산"]]],
    ["성별", [["여성", "여성|\\(여자\\)"], ["남성", "남성|\\(남자\\)"]]],
    ["부위", [["얼굴전체", "얼굴전체"], ["이마", "이마"], ["미간", "미간"], ["눈가", "눈가"], ["눈밑", "눈밑"], ["눈썹", "눈썹"], ["아이라인", "아이라인"],
      ["콧볼", "콧볼"], ["광대", "광대"], ["팔자", "팔자"], ["입술", "입술"], ["인중", "인중"], ["턱끝", "턱끝"], ["턱라인", "턱라인"], ["사각턱", "사각턱"],
      ["이중턱", "이중턱"], ["목", "목"], ["승모근", "승모근"], ["겨드랑이", "겨드랑이"], ["팔뚝", "팔뚝"], ["손·발", "손·발|손|발"], ["가슴", "가슴"],
      ["복부", "복부"], ["옆구리", "옆구리"], ["등", "등"], ["엉덩이", "엉덩이"], ["브라질리언", "브라질리언"], ["비키니", "비키니"], ["허벅지", "허벅지"],
      ["무릎", "무릎"], ["종아리", "종아리"], ["바디", "바디"], ["두피", "두피"]]],
    ["등급", [["프리미엄", "프리미엄"]]],
  ].map(([group, list]) => [group, list.map(([name, rx]) => [name, new RegExp(`(?:^|[\\s()·/+,\\[\\]])(?:${rx})(?=$|[\\s()·/+,\\[\\]])`)])]);
  // label(s) of one price's comparison keys → attribute names it has, e.g. ['국산', '사각턱'] (each at most once)
  function attrsOf(labels) {
    const t = [].concat(labels).join(" | "), out = [];
    for (const [, list] of ATTRS) for (const [name, rx] of list) if (rx.test(t)) out.push(name);
    return out;
  }
  const attrGroup = (name) => (ATTRS.find(([, list]) => list.some(([n]) => n === name)) || [""])[0];

  return { ALIASES, norm, jamo, lev, buildIndex, parse, matches, suggest, unitOf, unitPrice, interpret, ATTRS, attrsOf, attrGroup };
});
