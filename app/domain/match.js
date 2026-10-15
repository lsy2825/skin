// Offer → canonical comparison group (docs/AI_VISION_PIPELINE.md §4). Never invents a price: it only says which group of
// data.json an offer is (EXACT_MATCH), might be (PARTIAL_MATCH), could be several (AMBIGUOUS) or none (NO_MATCH), from
// the group labels, the specification (unit, quantity, sessions) and the product names. Different devices, products or
// quantities are never called the same. Pure functions, no DOM.
// window.Match in the app (needs window.Search, window.Classify); require()d by tests and server/.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./search.js"), require("./classify.js"), require("./stats.js"));
  else root.Match = factory(root.Search, root.Classify, root.Stats);
})(typeof self !== "undefined" ? self : this, function (Search, Classify, Stats) {
  "use strict";

  // amounts are compared as the spec, never as words ('50유닛' in a package label is 50U, not a word that tells groups apart)
  const AMT = /\d+(?:\.\d+)?\s*(?:유닛|단위|units?|U|cc|ml|샷|KJ|부위|개|줄|시린지|vial|분|mm)|\d+\s*회/gi;
  const words = (label) => label.replace(/\([^)]*\)/g, (m) => " " + m.slice(1, -1) + " ").replace(AMT, " ").split(/[\s·,/+]+/)
    .map((w) => Search.norm(w)).filter((w) => w.length >= 1 && !/^(기준|포함|및|등|1가지|모드)$/.test(w));
  const sessOfLabel = (label) => { const m = /(\d+)\s*회(?!\s*(?:차|이상|이내|당|째|분))/.exec(label); return m ? +m[1] : 1; };

  // keys: [[id, cat, label]] from data.json → a catalog of comparison groups with their words and spec
  function catalog(keys) {
    return keys.map(([id, cat, label]) => {
      const u = Search.unitOf(label);
      return { id, cat, label, words: [...new Set(words(label))], unit: u ? u.unit : null, qty: u ? u.qty : null, sess: sessOfLabel(label), products: Classify.products(label) };
    });
  }

  // attributes that make two offers different items even when the treatment words agree (5.1 audit: these were matched as EXACT)
  const PREMIUM = /프리미엄|고순도|내성|코어톡스|순수톡신/, PLUS = /\+|1\+1|원\s*플러스\s*원/;
  const FEMALE = /여성|여자|\(여\)|女/, MALE = /남성|남자|\(남\)|男/;
  const areas = (t) => { const m = /(\d+)\s*부위/.exec(t); return m ? +m[1] : null; };
  // origin: '외국산' contains '국산' — read it first. Size of a mole/lesion (mm, 大·中·小). Tip of a needle device (포함·별도)
  const IMPORT = /외국산|수입|해외/, DOMESTIC = /(?<!외)국산|국내산|국내/;
  const COUNTRY = [["DE", /독일|제오민/], ["US", /미국|엘러간|보톡스\s*정품/], ["KR", /(?<!외)국산|국내산/]];
  const origin = (t) => (IMPORT.test(t) ? "IMPORT" : DOMESTIC.test(t) ? "DOMESTIC" : null);
  const country = (t) => (COUNTRY.find(([, rx]) => rx.test(t)) || [null])[0];
  const size = (t) => { const m = /(\d+(?:\.\d+)?)\s*mm/i.exec(t); return m ? m[1] + "mm" : /大|\(대\)|\s대$/.test(t) ? "L" : /中|\(중\)/.test(t) ? "M" : /小|\(소\)/.test(t) ? "S" : null; };
  const tip = (t) => (/팁\s*(미포함|별도|불포함)/.test(t) ? "EXCL" : /팁\s*포함|\+\s*팁/.test(t) ? "INCL" : /팁/.test(t) ? "MENTION" : null);
  // words in an offer that only describe or advertise (not a different item): ignored by the 'unexplained word' check
  const FILLER = /^(체험가|체험|한정가|한정|이벤트|이벤|특가|첫방문|첫|방문|신규|1인|1회|회|시술|관리|일반형|정품|정가|할인|할인가|가격|원|부터|기준|1인1회|쿠폰|단독|최저가|hot|new|best|event|추천|인기|선착순|평일|주말|오전|오후|타임|타임이벤트|당일|예약|가능|및|등|택|중|또는|or|부위|1부위|국산|국내산|진정|진정관리|팩|포함|미포함|vat|부가세|별도|레이저|리프팅|주사|체험쿠폰|회차|1회체험가|대표x|1인1회적용|만|단품)$/i;
  const offerWords = (name) => name.replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, " ").replace(AMT, " ").split(/[\s·,/+\-~:!]+/)
    .map((w) => Search.norm(w)).filter((w) => (w.length >= 2 || /^[턱볼코팔목등눈입발손배]$/.test(w)) && !/^\d/.test(w) && !FILLER.test(w));
  // products that some group is specifically about (a generic group is not 'the same' as a named product's group)
  const prodCache = new WeakMap();
  const groupProducts = (cat) => { let s = prodCache.get(cat); if (!s) { s = new Set(cat.flatMap((k) => k.products)); prodCache.set(cat, s); } return s; };

  // offer: { raw_offer_name, unit, volume, shots, energy_kj, sessions, products } (the shape the 5.0 offer parser made; that parser went with the credits in 6.0) → { status, key, candidates, reasons }
  function match(offer, cat) {
    const name = offer.raw_offer_name || "";
    const nn = Search.norm(name);
    const qty = offer.volume ?? offer.shots ?? offer.energy_kj ?? null;
    const prods = offer.products || Classify.products(name);
    const cands = [];
    for (const k of cat) {
      if (!k.words.length) continue;
      const hit = k.words.filter((w) => nn.includes(w));
      if (hit.length / k.words.length < 0.6 || !nn.includes(k.words.reduce((a, w) => (w.length > a.length ? w : a), ""))) continue;   // the longest word (the treatment) must be there
      cands.push({ k, hit: hit.length, cover: hit.length / k.words.length });
    }
    if (!cands.length) return { status: "NO_MATCH", key: null, candidates: [], reasons: ["같은 시술로 묶인 가격 묶음을 찾지 못했어요"] };
    // words that tell candidates apart (프리미엄, 파워, 아이, 바디, 독일산 …): present in the offer but missing from a candidate = a different item
    const disc = new Set(cands.flatMap((c) => c.k.words)), reasons = [];
    const ow = offerWords(name), oa = areas(name);
    const oPrem = PREMIUM.test(name), oPlus = PLUS.test(name), oF = FEMALE.test(name), oM = MALE.test(name);
    const anyF = cands.some((c) => FEMALE.test(c.k.label)), anyM = cands.some((c) => MALE.test(c.k.label));
    const oo = origin(name), oc = country(name), os_ = size(name), ot = tip(name);
    const anySize = cands.some((c) => size(c.k.label));
    const gp = groupProducts(cat), prodGroups = prods.some((p) => gp.has(p));
    for (const c of cands) {
      const L = c.k.label, lj = Search.norm(L);
      // premium / '+'-bundle on one side only, the opposite sex, a sex the offer names while a group for it exists,
      // a different number of areas: a different item
      const lF = FEMALE.test(L), lM = MALE.test(L), la = areas(L);
      c.attrOk = oPrem === PREMIUM.test(L) && oPlus === PLUS.test(L) && !(oF && lM) && !(oM && lF) && !(oF && !lF && anyF) && !(oM && !lM && anyM)
        && !(oa != null && la !== oa && !(la == null && oa === 1 && !cands.some((x) => areas(x.k.label) === 1)))
        // 국산 vs 수입 never the same; a country the offer names (독일산) when a group for it exists; a size on either side
        // that the other does not state the same way; a needle tip included vs separate
        && !(oo && origin(L) && oo !== origin(L)) && !(oc && oc !== "KR" && country(L) !== oc)
        && !((os_ || anySize) && size(L) !== os_) && !(ot && tip(L) !== ot) && !(!ot && tip(L));
      // offer words the label does not explain (a brand line, a mode, a body area): not provably the same item
      c.free = ow.filter((w) => !lj.includes(w) && !c.k.words.some((kw) => kw.includes(w) || (kw.length >= 2 && w.includes(kw)))).length;
      const joined = c.k.words.join("");        // '리쥬란힐러' covers '리쥬란' and '힐러' written apart
      c.extra = [...disc].filter((w) => w.length >= 2 && nn.includes(w) && !joined.includes(w)).length;
      c.spec = !c.k.unit ? (qty == null ? "ok" : "unit-free") : offer.unit !== c.k.unit || qty == null ? (qty == null ? "missing" : "other-unit") : qty === c.k.qty ? "ok" : "other-qty";
      const os = offer.is_pass ? null : offer.sessions ?? 1;
      c.sessOk = os === c.k.sess;
      c.prodOk = (!c.k.products.length || !prods.length || prods.some((p) => c.k.products.includes(p))) && !(prodGroups && !c.k.products.some((p) => prods.includes(p)));
      // every label word must be in the offer (missing words cost most); more matched words only break ties
      c.score = c.hit * 0.5 + c.cover * 3 - (c.k.words.length - c.hit) * 3 - c.extra * 3 + (c.spec === "ok" ? 2 : c.spec === "missing" ? 0 : -5) + (c.sessOk ? 1 : -4) + (c.prodOk ? 0 : -6) + (c.attrOk ? 0 : -4) - c.free * 0.5;
    }
    cands.sort((a, b) => b.score - a.score || b.cover - a.cover);
    const top = cands[0], second = cands[1];
    const exact = top.cover === 1 && top.extra === 0 && top.free === 0 && top.attrOk && top.spec === "ok" && top.sessOk && top.prodOk && !offer.is_pass && !(offer.package_components || []).length;
    const list = cands.slice(0, 5).map((c) => ({ id: c.k.id, label: c.k.label, score: +c.score.toFixed(2), spec: c.spec, sessions_ok: c.sessOk, product_ok: c.prodOk }));
    if (top.spec === "other-qty") reasons.push(`용량·샷 수가 다른 묶음뿐이에요(${top.k.label})`);
    if (top.spec === "missing") reasons.push("광고에 용량·샷 수가 없어 어느 묶음인지 정할 수 없어요");
    if (!top.sessOk) reasons.push("횟수가 다른 묶음이에요");
    if (!top.prodOk) reasons.push("제품·장비가 달라요");
    if (top.extra > 0) reasons.push("광고에 묶음 이름에 없는 구분 낱말이 있어요(프리미엄·파워·부위 등)");
    if (!top.attrOk) reasons.push("프리미엄·1+1·성별·부위 수 같은 조건이 묶음과 달라요");
    if (top.free > 0 && top.extra === 0) reasons.push("묶음 이름으로 설명되지 않는 낱말이 있어 같은 시술이라고 단정하지 않아요");
    if ((offer.package_components || []).length) reasons.push("여러 시술이 묶인 패키지라 단품 묶음과 바로 비교하지 않아요");
    if (offer.is_pass) reasons.push("이용권·기간권은 1회 가격과 비교하지 않아요");
    if (exact && second && second.score === top.score && second.k.label !== top.k.label) return { status: "AMBIGUOUS", key: null, candidates: list, reasons: ["같은 점수의 묶음이 둘 이상이에요"] };
    const assumptions = offer.sessions == null && !offer.is_pass && top.k.sess === 1 ? ["횟수 표기가 없어 1회 가격으로 보고 비교했어요"] : [];
    if (exact) return { status: "EXACT_MATCH", key: top.k.id, label: top.k.label, candidates: list, reasons: [], assumptions };
    if (second && Math.abs(second.score - top.score) < 0.5 && second.k.label !== top.k.label) return { status: "AMBIGUOUS", key: null, candidates: list, reasons };
    return { status: top.score > 0 ? "PARTIAL_MATCH" : "AMBIGUOUS", key: null, best: top.k.id, label: top.k.label, candidates: list, reasons };
  }

  // the offer's price against the group's prices (each branch's lowest, as the compare screen shows them) — only for an
  // exact match, only from real rows; per-session is never mixed with packages
  function compare(price, prices) {
    const ps = prices.filter((p) => p > 0).sort((a, b) => a - b);
    if (ps.length < 3) return { verdict: "FEW", n: ps.length, note: "비교할 지점이 3곳 미만이에요" };
    const med = Stats.median(ps);
    const r = price / med, below = ps.filter((p) => p < price).length;
    return { verdict: r < 0.9 ? "LOWER" : r > 1.1 ? "HIGHER" : "SIMILAR", n: ps.length, median: med, min: ps[0], max: ps[ps.length - 1],
      ratio: +r.toFixed(3), cheaper_branches: below };
  }

  return { catalog, match, compare };
});
