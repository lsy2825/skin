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

  return { ALIASES, norm, jamo, lev, buildIndex, parse, matches, suggest, unitOf, unitPrice };
});
