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

  // ---- search operators (docs/ADVANCED_SEARCH_SPEC.md). On normalized text (norm(): lower case, units unified, spaces and
  // punctuation removed, aliases → canonical):
  //   보톡스 50u    every word must match (AND)          -파워        drop names with this word (aliases too)
  //   제오민|독일   either one (OR, inside one word)       300샷        exactly 300 shots: 1300샷 is 1300, never 300
  //   1회?          if the name states a session count, it must be 1; a name without one stays but is marked
  //                 '횟수 표기 없음' (never read as 1회). Plain 1회 (no ?) = the name must say 1회.
  // A number with a unit is read from the name as a whole number, not as a substring.
  const QRE = /(\d+(?:\.\d+)?)(샷|회|개(?!월)|부위|줄|분|u(?![a-z])|cc(?![a-z])|kj(?![a-z])|mm(?![a-z])|cm(?![a-z]))/g;
  const UNIT_L = { "샷": "샷 수", "회": "횟수", "개": "개수", "부위": "부위 수", "줄": "줄 수", "분": "시간", u: "용량(U)", cc: "용량(cc)", kj: "에너지(KJ)", mm: "크기(mm)", cm: "크기(cm)" };
  const UNIT_SHOW = { u: "U", cc: "cc", kj: "KJ", mm: "mm", cm: "cm" };
  const UNIT_J = { "샷": "샷 수가", "회": "횟수가", "개": "개수가", "부위": "부위 수가", "줄": "줄 수가", "분": "시간이", u: "용량(U)이", cc: "용량(cc)이", kj: "에너지(KJ)가", mm: "크기(mm)가", cm: "크기(cm)가" };
  const qmemo = new Map();
  // every number+unit in a normalized text: '슈링크1300샷3회' → [{n:1300,u:'샷'},{n:3,u:'회'}]
  function qtys(t) {
    let v = qmemo.get(t);
    if (v) return v;
    v = [];
    QRE.lastIndex = 0;
    for (let m; (m = QRE.exec(t));) v.push({ n: +m[1], u: m[2] });
    if (qmemo.size > 60000) qmemo.clear();
    qmemo.set(t, v);
    return v;
  }
  const showQ = (q) => `${q.n}${UNIT_SHOW[q.u] || q.u}`;
  // one written word (no '-', '|', '?') → { w: the word part, qs: the number+unit parts }
  function term(text) {
    const t = norm(text);
    const qs = qtys(t);
    return { w: t.replace(QRE, ""), qs, text };
  }
  const termHit = (a, name) => (!a.w || name.includes(a.w)) && a.qs.every((q) => qtys(name).some((x) => x.u === q.u && x.n === q.n));
  // typo fix for a plain word that matches no name at all (same rule as parse())
  function fixWord(w, index) {
    if (!index || !w || /\d/.test(w) || index.normNames.some((n) => n.includes(w))) return null;
    const tj = jamo(w), max = tj.length > 6 ? 2 : 1;
    let best = null;
    for (const x of index.words) {
      if (Math.abs(x.j.length - tj.length) > max) continue;
      const d = lev(tj, x.j, max);
      if (d <= max && (!best || d < best.d || (d === best.d && x.c > best.c))) best = { w: x.w, d, c: x.c };
    }
    return best ? best.w : null;
  }
  // 초성 검색 (round-2 D8): 'ㅂㅌㅅ' → the spelling people type whose initial consonants match ('보톡스'), searched normally.
  // Candidates: the alias dictionary's spellings and canonical forms, then the index words (most frequent first).
  const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  const choOf = (w) => [...w].map((c) => { const k = c.charCodeAt(0) - 0xac00; return k >= 0 && k < 11172 ? CHO[Math.floor(k / 588)] : c; }).join("");
  const isCho = (t) => /^[ㄱ-ㅎ]{2,}$/.test(t);
  function choWord(t, index) {
    const seen = new Set(), cands = [];
    for (const [canon, sp] of Object.entries(ALIASES)) for (const w of [canon, ...sp]) if (/^[가-힣]+$/.test(w) && !seen.has(w)) { seen.add(w); cands.push({ w, c: 1e6 }); }
    for (const x of (index && index.words) || []) if (/^[가-힣]+$/.test(x.w) && !seen.has(x.w)) { seen.add(x.w); cands.push({ w: x.w, c: x.c }); }
    const hit = cands.filter((x) => choOf(x.w) === t).sort((a, b) => b.c - a.c || a.w.length - b.w.length)[0];
    return hit ? hit.w : null;
  }
  // operator words people type out of habit ('보톡스 AND 리쥬란'): spaces already mean AND — the word itself is not searched
  const OPWORD = /^(and|or|그리고|또는|&&?)$/i;
  // does the query use any operator? (then natural-language reading is skipped: the user wrote it on purpose)
  const hasOps = (q) => /(^|\s)[-−]\S|\||\d\s*(샷|회|개|부위|줄|분|u|cc|kj|mm|cm|유닛)[?？]/i.test(q || "");   // a plain question mark (어디가 싸?) is not one
  // q → { test(normName), unstated(normName) → [unit label], parts: [{kind, label}], warn: [..], fixes: [[typed, used]],
  //       tokens: plain AND words (old callers), raw: the written tokens, empty }
  function compile(q, index) {
    const all = [], not = [], opt = [], parts = [], warn = [], fixes = [], tokens = [], raw = [];
    for (let tok of String(q || "").trim().split(/\s+/)) {
      if (!tok) continue;
      raw.push(tok);
      if (OPWORD.test(tok)) { warn.push(`‘${tok}’는 쓰지 않아도 돼요 — 띄어 쓰면 모두 들어간 이름을 찾아요(또는: ‘|’)`); continue; }
      if (isCho(tok)) { const w = choWord(tok, index); if (w) { fixes.push([tok, w]); tok = w; } else { warn.push(`초성 ‘${tok}’에 맞는 시술 이름을 찾지 못했어요`); continue; } }
      let neg = false, maybe = false;
      if (/^[-−]/.test(tok)) { neg = true; tok = tok.replace(/^[-−]+/, ""); if (!tok) { warn.push("'-' 뒤에 뺄 낱말이 없어서 무시했어요"); continue; } }
      if (/[?？]+$/.test(tok)) { maybe = true; tok = tok.replace(/[?？]+$/, ""); if (!tok) { warn.push("'?'는 숫자와 단위 뒤에 붙여요(예: 1회?)"); continue; } }
      const pieces = tok.split("|");
      const alts = pieces.map((p) => p.trim()).filter((p) => norm(p)).map(term).filter((a) => a.w || a.qs.length);
      if (pieces.length > 1 && alts.length < pieces.length) warn.push(`'|' 한쪽이 비어 있어서 ${alts.length ? "있는 쪽만" : "이 낱말을"} 썼어요`);
      if (!alts.length) { if (!pieces.some((p) => p.trim())) continue; warn.push(`‘${tok}’에서 찾을 글자가 없어서 무시했어요`); continue; }
      if (neg) {
        if (maybe) warn.push("'-'와 '?'는 함께 쓰지 않아요. '?'는 무시했어요");
        not.push(alts);
        parts.push({ kind: "not", label: alts.map((a) => a.text).join(" 또는 ") });
        continue;
      }
      // N단위? : every alternative must be a bare number+unit of one unit
      const units = new Set(alts.flatMap((a) => a.qs.map((x) => x.u)));
      if (maybe && alts.every((a) => !a.w && a.qs.length === 1) && units.size === 1) {
        const u = [...units][0], ns = alts.map((a) => a.qs[0].n);
        opt.push({ u, ns });
        parts.push({ kind: "opt", label: `${UNIT_J[u] || u} 적혀 있으면 ${ns.map((n) => showQ({ n, u })).join("·")}만` });
        continue;
      }
      if (maybe) warn.push(`'?'는 숫자+단위 하나에만 써요(예: 1회?). ‘${tok}’는 그냥 찾았어요`);
      // typo fix for a lone plain word
      if (alts.length === 1 && !alts[0].qs.length) {
        const fx = fixWord(alts[0].w, index);
        if (fx) { fixes.push([alts[0].w, fx]); alts[0] = { w: fx, qs: [], text: fx }; }
      }
      all.push(alts);
      if (alts.length === 1 && !alts[0].qs.length) tokens.push(alts[0].w);
      parts.push(alts.length > 1 ? { kind: "or", label: alts.map((a) => a.text).join(" 또는 ") }
        : alts[0].qs.length ? { kind: "exact", label: `${alts[0].w ? alts[0].text.replace(/\d.*$/, "") + " " : ""}${alts[0].qs.map(showQ).join(" ")} 정확히` }
        : { kind: "and", label: alts[0].text });
    }
    const test = (name) => {
      for (const g of all) if (!g.some((a) => termHit(a, name))) return false;
      for (const g of not) if (g.some((a) => termHit(a, name))) return false;
      for (const o of opt) { const v = qtys(name).filter((x) => x.u === o.u); if (v.length && !v.some((x) => o.ns.includes(x.n))) return false; }
      return true;
    };
    const unstated = (name) => opt.filter((o) => !qtys(name).some((x) => x.u === o.u)).map((o) => `${UNIT_L[o.u] || o.u} 표기 없음`);
    return { test, unstated, parts, warn, fixes, tokens, raw, empty: !all.length && !not.length && !opt.length, ops: not.length > 0 || opt.length > 0 || all.some((g) => g.length > 1 || g.some((a) => a.qs.length)) };
  }

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

  return { ALIASES, norm, jamo, lev, buildIndex, parse, matches, suggest, unitOf, unitPrice, interpret, ATTRS, attrsOf, attrGroup, qtys, compile, hasOps, choOf, choWord };
});
