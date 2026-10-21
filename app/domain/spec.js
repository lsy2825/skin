// Treatment specification and eligibility, read only from what a clinic wrote (the option name, its kind/tags/VAT/end
// date as scraped). Anything the name does not say is reported as unknown — never filled in. Pure functions, no DOM.
// window.Spec in the app (needs window.Search), require()d by tests/spec.test.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./search.js"));
  else root.Spec = factory(root.Search);
})(typeof self !== "undefined" ? self : this, function (Search) {
  "use strict";

  // product / device names seen in the clinics' price lists (2026-10-13 data). '보톡스' is left out on purpose: in Korean
  // price lists it is the generic word for any botulinum toxin, not the brand.
  const PRODUCTS = ["제오민", "나보타", "보툴렉스", "코어톡스", "디스포트", "이노톡스", "메디톡신", "리즈톡스", "엘러간",
    "리쥬란", "쥬베룩", "레디어스", "스컬트라", "엘란쎄", "레스틸렌", "쥬비덤", "벨로테로", "뉴라미스", "이브아르",
    "아포지", "인모드", "슈링크", "울쎄라", "써마지", "덴서티", "올리지오", "텐써마", "온다", "리프테라", "볼뉴머", "티타늄",
    "포텐자", "프락셀", "시크릿", "실펌", "제네시스", "젠틀맥스", "클라리티", "레블라이트", "엑셀V", "피코슈어", "스킨바이브"];
  const GRADES = [["프리미엄", /프리미엄/], ["고순도", /고순도/], ["일반형", /일반형/]];

  const group = (name) => (Search.ATTRS.find(([g]) => g === name) || [, []])[1];
  const inGroup = (attrs, g) => attrs.filter((a) => group(g).some(([n]) => n === a));

  // name: the option as the clinic wrote it; o.label: the comparison key label (already-checked words, optional);
  // o.family: procedure family name (optional); o.sess: sessions in the price (1, n, 99 = pass)
  // → [{ k, v, state }] with state 'known' | 'assumed' (a reasonable reading, say so) | 'unknown'
  // one spelling per product: clinics write the same device in Korean or Latin letters (엑셀브이 = 엑셀V; build2/taxonomy.py
  // already treats them as one product)
  const norm = (t) => String(t || "").replace(/엑셀\s*브이/g, "엑셀V");
  function parse(name, o = {}) {
    const text = norm(`${name || ""} ${o.label || ""}`);
    const out = [];
    const prod = PRODUCTS.filter((p) => text.includes(p));
    out.push({ k: "시술", v: o.family || o.label || name || "", state: o.family || o.label ? "known" : "unknown" });
    out.push(prod.length ? { k: "제품·장비", v: prod.join(" · "), state: "known" } : { k: "제품·장비", v: "상품명에 제품명이 없어요", state: "unknown" });
    const attrs = Search.attrsOf([name || "", o.label || ""]);
    const origin = inGroup(attrs, "원산지");
    out.push(origin.length ? { k: "원산지", v: origin.join(" · "), state: "known" } : { k: "원산지", v: "표기 없음", state: "unknown" });
    const grade = GRADES.filter(([, rx]) => rx.test(text)).map(([g]) => g);
    if (grade.length) out.push({ k: "등급(병원 표기)", v: grade.join(" · "), state: "known" });
    const u = Search.unitOf(name) || Search.unitOf(o.label || "");
    const threads = /(?<!만\s*)(\d+)\s*(?:줄|가닥)/.exec(text);
    if (u && u.unit === "샷") out.push({ k: "샷 수", v: `${u.qty}샷`, state: "known" });
    else if (u && u.unit === "U") out.push({ k: "용량", v: `${u.qty}U(유닛)`, state: "known" });
    else if (u && u.unit === "cc") out.push({ k: "용량", v: `${u.qty}cc`, state: "known" });
    else if (u && u.unit === "KJ") out.push({ k: "에너지", v: `${u.qty}KJ`, state: "known" });
    else if (threads) out.push({ k: "실 개수", v: `${threads[1]}줄`, state: "known" });
    else out.push({ k: "용량·샷 수", v: "표기 없음", state: "unknown" });
    const sess = o.sess || 1, said = /\d+\s*회/.test(name || "");
    out.push(sess >= 99 ? { k: "횟수", v: "이용권·무제한", state: "known" }
      : sess > 1 ? { k: "횟수", v: `${sess}회 묶음`, state: "known" }
        : said ? { k: "횟수", v: "1회", state: "known" } : { k: "횟수", v: "1회로 보여요(횟수 표기 없음)", state: "assumed" });
    const area = inGroup(attrs, "부위");
    out.push(area.length ? { k: "부위", v: area.join(" · "), state: "known" } : { k: "부위", v: "표기 없음", state: "unknown" });
    const sex = inGroup(attrs, "성별");
    if (sex.length) out.push({ k: "성별", v: sex.join(" · "), state: "known" });
    return out;
  }

  // the fields where two specs differ (what makes 'similar' options different treatments for comparison)
  function diff(a, b) {
    const m = new Map(b.map((x) => [x.k, x]));
    return a.filter((x) => x.k !== "시술" && m.has(x.k) && m.get(x.k).v !== x.v && x.state === "known" && m.get(x.k).state === "known")
      .map((x) => ({ k: x.k, a: x.v, b: m.get(x.k).v }));
  }

  // o: { name, kind (0 일반 · 1 체험가 · 2 한정가 · 3 구독권 · 4 고시가), tags ['첫 방문', '평일' …], vat (0 unknown · 1 included ·
  // 2 excluded), until ('YYYY-MM-DD' | 'posted:…' | ''), today ('YYYY-MM-DD'), conds [other condition texts], revisit (a price
  // for people coming back, Pricing.isRevisit — C #111: its first line says so instead of '첫 방문') }
  // → [{ k, v, state }] with state 'limit' (a stated restriction) | 'none' (stated: no restriction) | 'unknown' (not stated)
  // a new device or product ('덴서티리프팅 알파팁 신규런칭', 'NMN X 나드샷 신규 런칭') is not a first-visit price: the same words as
  // build2/clean.py NEW_ITEM (C #99), taken out of a name before any '신규' rule reads it
  const NEW_ITEM = /신규\s*(?:런칭|입고|도입|오픈|출시)/g;
  const dropNewItem = (s) => String(s || "").replace(NEW_ITEM, " ");

  function eligibility(o) {
    const n = dropNewItem(o.name), tags = o.tags || [], out = [];
    const first = tags.includes("첫 방문") || /첫\s*(?:방문|시술|경험)|신규/.test(n);
    out.push(o.revisit ? { k: "재방문", v: "다시 오는 손님만 — 처음 가면 못 받을 수 있어요", state: "limit" }
      : first ? { k: "첫 방문", v: "첫 방문·첫 시술만", state: "limit" } : { k: "첫 방문", v: "표기 없음 — 재방문도 되는지 확인", state: "unknown" });
    out.push(o.kind === 1 ? { k: "체험 가격", v: "체험가 — 보통 1인 1회", state: "limit" }
      : o.kind === 2 ? { k: "체험 가격", v: "한정가 — 기간·수량·조건이 붙어요", state: "limit" }
        : o.kind === 3 ? { k: "체험 가격", v: "이용권", state: "limit" }
          : o.kind === 4 ? { k: "체험 가격", v: "고시가(병원 게시 가격표)", state: "none" } : { k: "체험 가격", v: "일반가", state: "none" });
    out.push(o.vat === 2 ? { k: "부가세", v: "별도 — 결제 때 10%를 더 내요", state: "limit" }
      : o.vat === 1 ? { k: "부가세", v: "포함", state: "none" } : { k: "부가세", v: "포함 여부 표기를 찾지 못했어요", state: "unknown" });
    const u = o.until || "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(u) && u < "2099") out.push(o.today && u < o.today ? { k: "기간", v: `${u.slice(5).replace("-", "/")}에 끝났어요`, state: "limit" } : { k: "기간", v: `${u.slice(5).replace("-", "/")}까지`, state: "limit" });
    else if (u.startsWith("posted:")) out.push({ k: "기간", v: `고시표 게시일 ${u.slice(7)} (기간 한정 아님)`, state: "none" });
    else out.push({ k: "기간", v: "기간 표기 없음 — 바뀔 수 있어요", state: "unknown" });
    const other = [...new Set([...(o.conds || []), ...tags.filter((t) => t !== "첫 방문")])].filter((t) => !/첫\s*방문|신규/.test(t));
    out.push(other.length ? { k: "그 밖의 조건", v: other.join(" · "), state: "limit" } : { k: "그 밖의 조건", v: "상품명엔 없어요 — 병원 공통 안내(1인 1회·최소 결제 등)는 확인", state: "unknown" });
    return out;
  }

  // spec-word notes (data.json meta.kb.specs from knowledge/specs.json, C7): one plain line per word of a family's spec
  // ('보톡스' family id 'toxin' › '국산'), keyed by (family id, word). notes: [{ fid, spec, one_liner, review: { status } }];
  // fid: the family id (famOf → f.fid); texts: where the words are, in order (the variant label, the family name, famWords);
  // o.drafts: notes not yet medically reviewed may show (flags.showDraftKnowledge) — they come back with draft: true and the
  // screen marks them. A word counts only as a whole word (spaces, brackets, '·' around it), the longest word first where two
  // overlap ('HB 플러스' before '플러스'). → [{ spec, text, draft }] in the order the words stand, each word once, at most o.max
  const EDGE = /[\s()[\]·,/+]/;
  function notesFor(notes, fid, texts, o = {}) {
    if (!Array.isArray(notes) || !fid) return [];
    const mine = notes.filter((e) => e && e.fid === fid && typeof e.spec === "string" && e.spec && typeof e.one_liner === "string" && e.one_liner
      && ((e.review || {}).status === "approved" || o.drafts)).sort((a, b) => b.spec.length - a.spec.length);
    const out = [], seen = new Set();
    for (const raw of [].concat(texts || [])) {
      const t = String(raw || "").replace(/\s+/g, " "), used = [], hits = [];
      for (const e of mine) {
        for (let at = t.indexOf(e.spec); at >= 0; at = t.indexOf(e.spec, at + 1)) {
          const end = at + e.spec.length;
          if ((at && !EDGE.test(t[at - 1])) || (end < t.length && !EDGE.test(t[end]))) continue;
          if (used.some(([a, b]) => at < b && end > a)) continue;
          used.push([at, end]); hits.push({ at, e }); break;
        }
      }
      for (const { e } of hits.sort((a, b) => a.at - b.at)) if (!seen.has(e.spec)) { seen.add(e.spec); out.push({ spec: e.spec, text: e.one_liner, draft: (e.review || {}).status !== "approved" }); }
    }
    return o.max ? out.slice(0, o.max) : out;
  }
  // the word a split family puts in front of its base family's name, also when written without a space ('스킨보톡스' on
  // '보톡스' → '스킨'; build2/taxonomy.py AREA names the family that way). names: the family names sharing the family id; the
  // shortest one the name ends with is the base. Whole-word words of the name are found by notesFor already. → '' when none
  function famWords(name, names) {
    const n = String(name || "");
    const base = [].concat(names || []).filter((x) => typeof x === "string" && x && x !== n && n.endsWith(x)).sort((a, b) => a.length - b.length)[0];
    return base ? n.slice(0, -base.length).trim() : "";
  }

  // a family's treatment note (knowledge/treatments.json → meta.kb.entries): by the family's name, else by its base family id
  // (fid). Some names are shared by families in different compare categories (에어녹스 ×3, 22 names on 2026-10-19 — C #114): for
  // those the name alone does not say which family an entry means, so a name match needs the entry to list no fids or this
  // family's fid. fams: every family the screen can show ({name, fid}). Returns {of, viaName, viaFid, shared}.
  function kbFinder(entries, fams) {
    const seen = new Map();
    for (const f of fams || []) if (f && f.name) seen.set(f.name, seen.has(f.name));
    const byName = new Map(), byFid = new Map();
    for (const e of entries || []) {
      for (const n of e.families || []) { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(e); }
      for (const x of e.fids || []) if (!byFid.has(x)) byFid.set(x, e);
    }
    const shared = (f) => !!(f && seen.get(f.name));
    const viaName = (f) => {
      const es = (f && byName.get(f.name)) || [];
      return (shared(f) ? es.find((e) => !(e.fids || []).length || e.fids.includes(f.fid)) : es[0]) || null;
    };
    const viaFid = (f) => (f && f.fid && byFid.get(f.fid)) || null;
    return { of: (f) => viaName(f) || viaFid(f), viaName, viaFid, shared };
  }

  // the short name a button can carry ('담기 · 리쥬베룩 패키지' — 위계 점검 39 · H13): a long name (over max characters) loses
  // what it says in brackets — a package's parts, a list of products — and keeps the rest, so '울쎄라피 프라임 리프팅(고강도 집속
  // 초음파) 300샷 + 얼굴전체 스킨보톡스' keeps its 300샷 and its '+ 스킨보톡스'. A bracket at the very start ('(여) …') says who it
  // is for and stays, and so does a bracket that gives the dose — an amount, alone or with its words ('(100U)', '(반병/3cc)',
  // '(리터치 포함 2cc)'), not a package's parts joined by '+' (검토: 146 names lost their 100U, 3cc …). A short name stays
  // whole ('독일산(제오민) 50U'), and so does a name that would be left with almost nothing. The full name is still said (the
  // button's screen-reader name, the title right above it). Only the name itself decides, never the other options of its family:
  // home.json carries a family's options in part, and the home cards must read the same before and after data.json (O2)
  const AMOUNT = /^\s*\d+(?:[.,]\d+)?\s*(?:cc|ml|u|샷|회|줄|병|분|개|부위|kj|j|시린지|바이알|앰플|mg|%)?\s*$/i;
  const DOSE = /\d+(?:[.,]\d+)?\s*(?:cc|ml|u|샷|회|줄|병|분|개|부위|kj|j|시린지|바이알|앰플|mg|%)/i;
  const keeps = (inner) => AMOUNT.test(inner) || (DOSE.test(inner) && !inner.includes("+"));
  const oneLine = (x) => String(x == null ? "" : x).replace(/\s+/g, " ").trim();
  const dropBrackets = (s) => {
    let t = s;
    for (let n = 0; n < 3; n++) {   // inner brackets first; a dose's brackets are marked so that the bracket around it can go
      const u = t.replace(/(\S)(\s*)\(([^()]*)\)/g, (m, a, sp, inner) => (keeps(inner) ? `${a}${sp}\u0001${inner}\u0002` : `${a} `));
      if (u === t) break;
      t = u;
    }
    return t.replace(/\u0001/g, "(").replace(/\u0002/g, ")").replace(/\s+/g, " ").trim();
  };
  function shortLabel(label, max = 20) {
    const s = oneLine(label);
    if (s.length <= max) return s;
    const t = dropBrackets(s);
    return t.length >= 2 ? t : s;
  }
  // a package says what it is made of, not the clinic's name for it (사용자 요청 2026-10-20): '리쥬베룩 패키지(리쥬란힐러 2cc +
  // 쥬베룩 스킨 2cc + 크라이오셀)' → '리쥬란힐러 2cc + 쥬베룩 스킨 2cc + 크라이오셀', a trailing '5회' kept. Only that shape changes
  // (and '이름 : A + B'): a name without '+' and then one bracket listing two or more parts. A bracket that is a note ('압출+염증주사 포함/…'), a '+'
  // in the name itself ('블랙필+…(…)', 'NMN(NAD+ …)'), and anything after the bracket but a session count leave the name as it is.
  const PKG_NOTE = /포함|별도|처방|필요\s?시|택\s?1|중\s?택|선택|무료|증정|서비스|이상|이하|기준/;
  function pkgLabel(label) {
    const s = oneLine(label);
    // '이름(A + B) 5회', or '이름 : A + B 1회' (a colon after the name; parts joined by '-' too are steps, not parts — left as is)
    const m = /^([^()+]+?)\s*\(([^()]*\+[^()]*)\)(\s*[\d,]+\s*회)?$/.exec(s), c = !m && /^([^():+]+?)\s*[:：]\s*([^:：]*\+[^:：]*)$/.exec(s);
    const parts = m ? m[2] + (m[3] || "") : c && !c[2].includes("-") ? c[2] : null;
    if (!parts || PKG_NOTE.test(parts)) return s;
    const t = oneLine(parts.replace(/\s*\+\s*/g, " + "));
    return t.split(" + ").length >= 2 ? t : s;
  }
  // the names a key list shows (app.js applyData; the tests run the same): a 패키지 key reads as its parts only when nothing is lost
  // — every fact its full name states (product, dose, origin, sessions, area …: parse 'known') the parts state the same, and
  // every attribute (attrsOf — 남성 …) is still there ('남성 인기 패키지 (얼굴전체 + 아래턱)', '슈링크 … 패키지(울트라F …)',
  // '풀페이스 리쥬란 3cc 1회 (리쥬란힐러 2cc + …)' keep their names) — and only when no other key would then read the same,
  // spaces, brackets and a trailing '1회' aside (two options of one family must not look alike)
  function pkgNames(keys, attrsOf) {
    const known = (x) => new Map(parse(x).filter((f) => f.state === "known" && f.k !== "시술").map((f) => [f.k, f.v]));
    const keeps = (full, part) => {
      const a = known(full), b = known(part);
      for (const [k, v] of a) if (b.get(k) !== v) return false;
      if (attrsOf) { const has = new Set(attrsOf(part)); if (attrsOf(full).some((t) => !has.has(t))) return false; }
      return true;
    };
    const short = keys.map((k) => { if (k.cat !== "패키지") return k.label; const t = pkgLabel(k.label); return t !== k.label && keeps(k.label, t) ? t : k.label; });
    const nk = (x) => oneLine(x).replace(/\s*1회$/, "").replace(/[\s()]/g, ""), seen = new Map();
    short.forEach((x) => seen.set(nk(x), (seen.get(nk(x)) || 0) + 1));
    return keys.map((k, j) => (short[j] !== k.label && seen.get(nk(short[j])) === 1 ? short[j] : k.label));
  }
  // the same parts on a small button ('담기 · …'): whole when short, else the first part and how many more ('리쥬란힐러 2cc 외 2')
  function pkgShort(label, max = 20) {
    const s = oneLine(label);
    if (s.length <= max) return s;
    const parts = s.split(" + ");
    return parts.length >= 2 ? `${parts[0]} 외 ${parts.length - 1}` : s;
  }

  return { PRODUCTS, norm, parse, diff, eligibility, notesFor, famWords, dropNewItem, kbFinder, shortLabel, pkgLabel, pkgNames, pkgShort };
});
