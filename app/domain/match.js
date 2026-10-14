// Offer → canonical comparison group (docs/AI_VISION_PIPELINE.md §4). Never invents a price: it only says which group of
// data.json an offer is (EXACT_MATCH), might be (PARTIAL_MATCH), could be several (AMBIGUOUS) or none (NO_MATCH), from
// the group labels, the specification (unit, quantity, sessions) and the product names. Different devices, products or
// quantities are never called the same. Pure functions, no DOM.
// window.Match in the app (needs window.Search, window.Classify); require()d by tests and server/.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./search.js"), require("./classify.js"));
  else root.Match = factory(root.Search, root.Classify);
})(typeof self !== "undefined" ? self : this, function (Search, Classify) {
  "use strict";

  const AMT = /\d+(?:\.\d+)?\s*(?:U|cc|ml|샷|KJ|부위|개|줄|시린지|vial|분|mm)|\d+\s*회/gi;
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

  // offer: { raw_offer_name, unit, volume, shots, energy_kj, sessions, products } (offerparse output) → { status, key, candidates, reasons }
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
    for (const c of cands) {
      const joined = c.k.words.join("");        // '리쥬란힐러' covers '리쥬란' and '힐러' written apart
      c.extra = [...disc].filter((w) => w.length >= 2 && nn.includes(w) && !joined.includes(w)).length;
      c.spec = !c.k.unit ? (qty == null ? "ok" : "unit-free") : offer.unit !== c.k.unit || qty == null ? (qty == null ? "missing" : "other-unit") : qty === c.k.qty ? "ok" : "other-qty";
      const os = offer.is_pass ? null : offer.sessions ?? 1;
      c.sessOk = os === c.k.sess;
      c.prodOk = !c.k.products.length || !prods.length || prods.some((p) => c.k.products.includes(p));
      // every label word must be in the offer (missing words cost most); more matched words only break ties
      c.score = c.hit * 0.5 + c.cover * 3 - (c.k.words.length - c.hit) * 3 - c.extra * 3 + (c.spec === "ok" ? 2 : c.spec === "missing" ? 0 : -5) + (c.sessOk ? 1 : -4) + (c.prodOk ? 0 : -6);
    }
    cands.sort((a, b) => b.score - a.score || b.cover - a.cover);
    const top = cands[0], second = cands[1];
    const exact = top.cover === 1 && top.extra === 0 && top.spec === "ok" && top.sessOk && top.prodOk && !offer.is_pass && !(offer.package_components || []).length;
    const list = cands.slice(0, 5).map((c) => ({ id: c.k.id, label: c.k.label, score: +c.score.toFixed(2), spec: c.spec, sessions_ok: c.sessOk, product_ok: c.prodOk }));
    if (top.spec === "other-qty") reasons.push(`용량·샷 수가 다른 묶음뿐이에요(${top.k.label})`);
    if (top.spec === "missing") reasons.push("광고에 용량·샷 수가 없어 어느 묶음인지 정할 수 없어요");
    if (!top.sessOk) reasons.push("횟수가 다른 묶음이에요");
    if (!top.prodOk) reasons.push("제품·장비가 달라요");
    if (top.extra > 0) reasons.push("광고에 묶음 이름에 없는 구분 낱말이 있어요(프리미엄·파워·부위 등)");
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
    const med = ps.length % 2 ? ps[ps.length >> 1] : Math.round((ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2);
    const r = price / med, below = ps.filter((p) => p < price).length;
    return { verdict: r < 0.9 ? "LOWER" : r > 1.1 ? "HIGHER" : "SIMILAR", n: ps.length, median: med, min: ps[0], max: ps[ps.length - 1],
      ratio: +r.toFixed(3), cheaper_branches: below };
  }

  return { catalog, match, compare };
});
