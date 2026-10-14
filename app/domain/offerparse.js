// Event / quotation text → structured offers (docs/AI_VISION_PIPELINE.md §3). Deterministic rules only: what the text says
// is read, everything else stays null / UNKNOWN and is listed in `uncertainties`. Used for pasted event text in the app,
// for checking and filling the vision model's output on the server, and by tests. Pure functions, no DOM.
// window.OfferParse in the app (needs window.Search, window.Classify); require()d by tests and server/.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./search.js"), require("./classify.js"));
  else root.OfferParse = factory(root.Search, root.Classify);
})(typeof self !== "undefined" ? self : this, function (Search, Classify) {
  "use strict";

  const MAX_TEXT = 6000, MAX_OFFERS = 40;
  // prices: 99,000원 · 99000원 · ₩99,000 · 9.9만원 · 9만9천원 · 9만 9,000원 (KRW only; other currencies are not read)
  const PRICE = /(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(만\s*(?:(\d{1,4})\s*천?)?\s*원|천\s*원|원)|₩\s*(\d{1,3}(?:,\d{3})+|\d{4,})/g;
  const COND_WORDS = [["체험가", /체험가|체험/], ["첫 방문", /첫\s*방문|첫\s*시술|신규/], ["1인 1회", /1인\s*1회/], ["평일", /평일/], ["주말", /주말/],
    ["선착순", /선착순/], ["한정가", /한정가|한정/], ["시간 한정", /타임\s*이벤트|오전|오후\s*\d|\d+\s*시\s*(?:이전|전|까지)/], ["재방문", /재방문/]];
  const VAT = (t) => (/(?:VAT|부가세)\s*(?:10%\s*)?(?:별도|미포함)/i.test(t) ? "EXCLUDED" : /(?:VAT|부가세)\s*(?:10%\s*)?포함/i.test(t) ? "INCLUDED" : "UNKNOWN");

  function wonOf(m) {
    if (m[4]) return +m[4].replace(/,/g, "");
    const n = +m[1].replace(/,/g, "");
    if (/만/.test(m[2])) return Math.round(n * 10000 + (m[3] ? +m[3] * (m[2].includes("천") ? 1000 : 1) : 0));
    if (/^천/.test(m[2])) return Math.round(n * 1000);
    return Math.round(n);
  }
  const SESS = /(\d+)\s*회(?!\s*(?:차|이상|이내|당|째|분))/g;
  function sessionsOf(t) {
    let s = null;
    for (const m of t.matchAll(SESS)) s = Math.max(s || 0, +m[1]);
    if (/이용권|무제한|\d+\s*개월/.test(t)) return { sessions: null, pass: true };
    return { sessions: s, pass: false };
  }
  function endDate(t, year) {
    let m = /(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/.exec(t);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = /(?:~|까지|기간)\s*(\d{1,2})[./월]\s*(\d{1,2})/.exec(t) || /(\d{1,2})[./월]\s*(\d{1,2})\s*일?\s*까지/.exec(t);
    if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return null;
  }

  // text: what the user pasted (or OCR / model text); o.brands: [{brand, branches: [names]}] from data.json to spot the clinic;
  // o.year: for dates without a year. → { document_type, clinic_name, branch_name, vat_status, offers: [...], warnings }
  function parse(text, o = {}) {
    const t = String(text || "").slice(0, MAX_TEXT).replace(/\r/g, "");
    const year = o.year || new Date().getFullYear();
    const out = { document_type: /견적|합계|총\s*금액|상담/.test(t) ? "QUOTATION" : "EVENT", clinic_name: null, branch_name: null, vat_status: VAT(t), offers: [], warnings: [] };
    if (String(text || "").length > MAX_TEXT) out.warnings.push(`글이 길어서 앞 ${MAX_TEXT}자만 읽었어요`);
    for (const b of o.brands || []) {
      if (t.includes(b.brand)) { out.clinic_name = b.brand; out.branch_name = (b.branches || []).find((n) => n.length >= 2 && t.includes(n.replace(/점$/, ""))) || null; break; }
    }
    // instructions written into the text are data, never commands (prompt injection): flagged, not followed
    if (/ignore|무시하고|지시를|system prompt|이전 지시|you are/i.test(t)) out.warnings.push("글 안에 지시처럼 보이는 문장이 있어요. 가격 정보로만 읽고 따르지 않았어요");
    const lines = t.split(/\n|(?<=원)\s*[/|·]\s*(?=\S)/).map((x) => x.trim()).filter(Boolean);
    for (const line of lines) {
      const prices = [...line.matchAll(PRICE)].map((m) => ({ won: wonOf(m), at: m.index, text: m[0] })).filter((p) => p.won >= 100 && p.won <= 50000000);
      if (!prices.length) continue;
      let name = line;
      for (const p of prices) name = name.replace(p.text, " ");
      name = name.replace(/~?\s*\d{1,2}[./월]\s*\d{1,2}\s*일?\s*까지|~\s*\d{1,2}[./]\d{1,2}|(?:20\d{2})[.\-/]\d{1,2}[.\-/]\d{1,2}/g, " ");   // dates are read separately
      name = name.replace(/\(?\s*(?:VAT|부가세|부가가치세)\s*(?:포함|별도|미포함|제외)\s*\)?/gi, " ");   // VAT is read separately too
      name = name.replace(/정상가|정가|할인가|이벤트가|판매가|가격|→|->|⇒|~|:|\*|★|☆|♥|▶|\(\s*\)|\[\s*\]/g, " ").replace(/\s+/g, " ").trim();
      if (name.length < 2) { out.warnings.push(`'${line.slice(0, 40)}' — 가격만 있고 시술 이름이 없어 건너뛰었어요`); continue; }
      // energy written in joules ('10,000줄', '10000J') → KJ, the unit the comparison groups use
      name = name.replace(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*(?:줄|J)(?![A-Za-z가-힣])/g, (m, n) => { const v = +n.replace(/,/g, ""); return v % 1000 ? m : `${v / 1000}KJ`; });
      const u = Search.unitOf(name), s = sessionsOf(name);
      const conds = COND_WORDS.filter(([, rx]) => rx.test(line)).map(([w]) => w);
      const parts = name.includes("+") ? name.split(/\s*\+\s*/).map((x) => x.trim()).filter(Boolean) : [];
      const sorted = prices.map((p) => p.won);
      const offer = {
        raw_offer_name: name, line: line.slice(0, 200),
        products: Classify.products(name),
        volume: u && (u.unit === "cc" || u.unit === "U") ? u.qty : null,
        unit: u ? u.unit : null,
        shots: u && u.unit === "샷" ? u.qty : null,
        energy_kj: u && u.unit === "KJ" ? u.qty : null,
        sessions: s.sessions,
        is_pass: s.pass,
        // several prices on one line: the last is what you pay ('정상가 30만 → 19만'); the first, if higher, the list price
        advertised_price: sorted[sorted.length - 1],
        list_price: sorted.length > 1 && sorted[0] > sorted[sorted.length - 1] ? sorted[0] : null,
        currency: "KRW",
        vat_status: VAT(line) !== "UNKNOWN" ? VAT(line) : out.vat_status,
        eligibility_conditions: conds,
        end_date: endDate(line, year) || endDate(t, year),
        package_components: parts,
        evidence: line.slice(0, 200),
        uncertainties: [],
        requires_user_confirmation: false,
      };
      if (!offer.unit) offer.uncertainties.push("용량·샷 수가 적혀 있지 않아요");
      if (offer.sessions == null && !offer.is_pass) offer.uncertainties.push("횟수가 적혀 있지 않아요(1회로 단정하지 않음)");
      if (offer.vat_status === "UNKNOWN") offer.uncertainties.push("부가세 포함 여부가 적혀 있지 않아요");
      if (prices.length > 2) offer.uncertainties.push("한 줄에 가격이 3개 이상이라 어느 가격인지 확인이 필요해요");
      if (parts.length > 1) offer.uncertainties.push("여러 시술이 묶인 패키지예요");
      offer.requires_user_confirmation = offer.uncertainties.length > 0;
      out.offers.push(offer);
      if (out.offers.length >= MAX_OFFERS) { out.warnings.push(`가격이 많아서 앞 ${MAX_OFFERS}개만 읽었어요`); break; }
    }
    if (!out.offers.length) out.warnings.push("가격(원)이 적힌 줄을 찾지 못했어요");
    return out;
  }

  // a structured offer from anywhere (this parser, the vision model, the user's corrections) checked before use:
  // a price must be a whole KRW amount in range, units from the known list, sessions a small positive integer
  const UNITS = new Set(["cc", "U", "샷", "KJ", null]);
  function validate(offer) {
    const e = [];
    if (!offer || typeof offer !== "object") return ["형식이 아니에요"];
    if (typeof offer.raw_offer_name !== "string" || offer.raw_offer_name.trim().length < 2 || offer.raw_offer_name.length > 200) e.push("시술 이름");
    if (!Number.isInteger(offer.advertised_price) || offer.advertised_price < 100 || offer.advertised_price > 50000000) e.push("가격");
    if (offer.currency !== "KRW") e.push("통화");
    if (!UNITS.has(offer.unit ?? null)) e.push("단위");
    for (const k of ["volume", "shots", "energy_kj"]) if (offer[k] != null && !(typeof offer[k] === "number" && offer[k] > 0 && offer[k] < 100000)) e.push(k);
    if (offer.sessions != null && !(Number.isInteger(offer.sessions) && offer.sessions > 0 && offer.sessions <= 100)) e.push("횟수");
    if (!["INCLUDED", "EXCLUDED", "UNKNOWN"].includes(offer.vat_status)) e.push("부가세");
    if (offer.end_date != null && !/^20\d{2}-\d{2}-\d{2}$/.test(offer.end_date)) e.push("종료일");
    if (offer.list_price != null && !(Number.isInteger(offer.list_price) && offer.list_price > 0)) e.push("정가");
    return e;
  }

  // the one price a short text says ('99,000원', '9.9만원'), or null when it says none or several
  function priceOf(text) {
    const ms = [...String(text || "").slice(0, 60).matchAll(PRICE)];
    return ms.length === 1 ? wonOf(ms[0]) : null;
  }

  return { parse, validate, VAT, MAX_TEXT, MAX_OFFERS, priceOf, endDate };
});
