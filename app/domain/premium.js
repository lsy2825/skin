// Premium report builders (docs/PREMIUM_REPORTS_SPEC.md, PREMIUM_PLANNER_SPEC.md). Deterministic: every number comes from the
// price data through ctx, never from a language model; a report that the data cannot support is refused before any credit is
// taken (available()). The same code runs in the app (demo wallet) and on the server (paid jobs). Pure functions, no DOM.
// ctx: { today, updated, keys: Match.catalog(...), label(id), prices(id, region) → [{b, p, region, vat}] (each branch's lowest
//        live price), regions(), trend: {dates, k: {id: [[median, min, n] | null]}}, cart(items, region) → Pricing.compareClinics result,
//        brandName(b) }
// window.Premium in the app (needs window.OfferParse, window.Match); require()d by tests and server/.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./offerparse.js"), require("./match.js"));
  else root.Premium = factory(root.OfferParse, root.Match);
})(typeof self !== "undefined" ? self : this, function (OfferParse, Match) {
  "use strict";

  const HISTORY_MIN_POINTS = 4;          // weekly snapshots needed before a history report is sold (no extrapolation)
  const REGION_MIN_BRANCHES = 3;
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[n >> 1] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2)) : null; };

  // can this report be made from the data we have? (checked before reserving credits — an empty report is never charged)
  function available(feature, input, ctx) {
    const no = (reason) => ({ ok: false, reason });
    if (feature === "PRICE_HISTORY_REPORT") {
      const pts = ((ctx.trend.k || {})[input.key] || []).filter(Boolean).length;
      if (pts < HISTORY_MIN_POINTS) return no(`이 시술의 가격 기록이 ${pts}주뿐이에요. ${HISTORY_MIN_POINTS}주 이상 모이면 보고서를 만들어요(그 전에는 무료 '가격 이력' 카드로 보세요).`);
    }
    if (feature === "REGIONAL_PRICE_REPORT") {
      const by = groupRegions(ctx.prices(input.key, ""));
      if ([...by.values()].filter((v) => v.length >= REGION_MIN_BRANCHES).length < 2) return no(`지점이 ${REGION_MIN_BRANCHES}곳 이상인 지역이 둘 미만이라 지역을 비교할 수 없어요.`);
    }
    if (feature === "PRODUCT_DEEP_COMPARE" && (!input.a || !input.b || input.a === input.b)) return no("비교할 두 시술을 골라 주세요.");
    if ((feature === "EVENT_URL_DECODER" || feature === "QUOTATION_DECODER" || feature === "MULTI_EVENT_COMPARE") && !(input.texts || [input.text]).some((t) => OfferParse.parse(t || "").offers.length))
      return no("가격(원)이 적힌 줄을 찾지 못했어요. 글을 확인해 주세요(크레딧은 쓰지 않았어요).");
    if (feature === "ADVANCED_CART_PLANNER" && !(input.items || []).length) return no("장바구니가 비어 있어요.");
    return { ok: true };
  }
  function groupRegions(rows) { const m = new Map(); for (const x of rows) { if (!m.has(x.region)) m.set(x.region, []); m.get(x.region).push(x.p); } return m; }

  // one decoded offer: parse → validate → match → compare (exact matches only get a verdict)
  function decodeOffer(o, ctx, region) {
    const bad = OfferParse.validate(o);
    if (bad.length) return { offer: o, invalid: bad, match: { status: "NO_MATCH", reasons: [`읽은 값이 올바르지 않아요: ${bad.join(", ")}`] } };
    const m = Match.match(o, ctx.keys);
    const out = { offer: o, match: m };
    if (m.status === "EXACT_MATCH") {
      const ps = ctx.prices(m.key, region || "");
      out.compare = Match.compare(o.advertised_price, ps.map((x) => x.p));
      out.compare.basis = "병원 표시가(지점마다 가장 싼 가격), " + (region || "전국");
      if (o.vat_status === "INCLUDED" && ps.some((x) => x.vat === 2)) out.compare.note = "이 광고는 부가세 포함 가격이고, 비교 가격 일부는 부가세 별도 표시가예요(10% 차이 가능).";
    }
    return out;
  }
  const verdictKo = { LOWER: "같은 묶음 중간값보다 낮아요", HIGHER: "같은 묶음 중간값보다 높아요", SIMILAR: "같은 묶음 중간값과 비슷해요", FEW: "비교할 지점이 적어요" };
  const shareItem = (d) => ({ label: d.match.label || null, status: d.match.status, verdict: d.compare ? d.compare.verdict : null,
    median: d.compare ? d.compare.median : null, n: d.compare ? d.compare.n : 0 });

  function eventDecode(input, ctx) {
    const parsed = input.parsed || OfferParse.parse(input.text || "", { year: +(ctx.today || "2026").slice(0, 4), brands: ctx.brands });
    const items = parsed.offers.map((o) => decodeOffer(o, ctx, input.region));
    const exact = items.filter((d) => d.match.status === "EXACT_MATCH").length;
    return {
      kind: input.quotation ? "QUOTATION" : "EVENT",
      title: `${parsed.clinic_name ? parsed.clinic_name + (parsed.branch_name ? " " + parsed.branch_name : "") + " " : ""}${input.quotation ? "견적" : "이벤트"} 해석 · 가격 ${items.length}개`,
      payload: { source: input.source || "TEXT", clinic: parsed.clinic_name, branch: parsed.branch_name, vat: parsed.vat_status, warnings: parsed.warnings,
        items: items.map((d) => ({ ...d, verdict_text: d.compare ? verdictKo[d.compare.verdict] : null })), exact, data_updated: ctx.updated },
      // the public part: matched groups and market numbers only — no pasted text, no advertised price of a private quotation
      share_summary: { kind: input.quotation ? "QUOTATION" : "EVENT", items: items.map((d) => ({ ...shareItem(d), advertised: input.quotation ? null : d.offer.advertised_price })), data_updated: ctx.updated },
    };
  }

  function multiCompare(input, ctx) {
    const parts = (input.texts || []).slice(0, 4).map((t, i) => ({ i, rep: eventDecode({ text: t, region: input.region }, ctx) }));
    // the same group across events, side by side (per-session prices are never mixed with packages: exact matches only)
    const by = new Map();
    for (const { i, rep } of parts) for (const d of rep.payload.items) if (d.match.status === "EXACT_MATCH") {
      if (!by.has(d.match.key)) by.set(d.match.key, { key: d.match.key, label: d.match.label, offers: [] });
      by.get(d.match.key).offers.push({ event: i + 1, price: d.offer.advertised_price, conditions: d.offer.eligibility_conditions, vat: d.offer.vat_status, end: d.offer.end_date });
    }
    const groups = [...by.values()].map((g) => ({ ...g, market: Match.compare(Math.min(...g.offers.map((o) => o.price)), ctx.prices(g.key, input.region || "").map((x) => x.p)) }));
    return { kind: "MULTI_EVENT", title: `이벤트 ${parts.length}개 비교 · 같은 시술 ${groups.length}가지`,
      payload: { events: parts.map(({ rep }) => rep.payload), groups, data_updated: ctx.updated },
      share_summary: { kind: "MULTI_EVENT", groups: groups.map((g) => ({ label: g.label, offers: g.offers.map((o) => ({ event: o.event, price: o.price })), median: g.market.median, n: g.market.n })) } };
  }

  // a package / quotation: each part matched on its own; the parts' market medians summed only when every part matched exactly
  function quotation(input, ctx) {
    const rep = eventDecode({ ...input, quotation: true }, ctx);
    for (const it of rep.payload.items) {
      const comps = it.offer.package_components || [];
      if (comps.length < 2) continue;
      it.parts = comps.map((c) => decodeOffer({ ...OfferParse.parse(`${c} 1000원`).offers[0], advertised_price: 1000 }, ctx, input.region))
        .map((d) => ({ name: d.offer.raw_offer_name, status: d.match.status, label: d.match.label || null, median: d.compare ? d.compare.median : null }));
      it.parts_sum = it.parts.every((p) => p.median != null) ? it.parts.reduce((s, p) => s + p.median, 0) : null;
      it.parts_note = it.parts_sum == null ? "모든 구성이 정확히 맞는 묶음을 찾지 못해 합계를 만들지 않았어요" : "구성마다 같은 묶음 중간값의 합(참고)";
    }
    rep.payload.privacy = "견적 원문은 이 보고서에만 있고, 공유 요약과 가격 데이터에는 넣지 않아요";
    return rep;
  }

  function stats(ps) { const v = ps.map((x) => x.p); return v.length ? { n: v.length, min: Math.min(...v), median: median(v), max: Math.max(...v) } : { n: 0 }; }
  function productDeepCompare(input, ctx) {
    const side = (id) => ({ key: id, label: ctx.label(id), all: stats(ctx.prices(id, "")), region: input.region ? stats(ctx.prices(id, input.region)) : null,
      brands: ctx.brandStats ? ctx.brandStats(id) : null });
    const A = side(input.a), B = side(input.b);
    return { kind: "PRODUCT_COMPARE", title: `${A.label} vs ${B.label}`, payload: { a: A, b: B, data_updated: ctx.updated,
      note: "가격만 비교해요. 효과·통증·유지 기간은 제품마다 다르고, 의료진 상담이 필요해요." },
      share_summary: { kind: "PRODUCT_COMPARE", a: { label: A.label, ...A.all }, b: { label: B.label, ...B.all } } };
  }

  function regional(input, ctx) {
    const by = groupRegions(ctx.prices(input.key, ""));
    const rows = [...by].map(([r, v]) => ({ region: r || "미상", n: v.length, min: Math.min(...v), median: median(v), max: Math.max(...v), enough: v.length >= REGION_MIN_BRANCHES }))
      .sort((a, b) => b.n - a.n);
    return { kind: "REGIONAL", title: `${ctx.label(input.key)} 지역별 가격`, payload: { key: input.key, label: ctx.label(input.key), rows, min_branches: REGION_MIN_BRANCHES, data_updated: ctx.updated },
      share_summary: { kind: "REGIONAL", label: ctx.label(input.key), rows: rows.filter((r) => r.enough).map((r) => ({ region: r.region, n: r.n, median: r.median })) } };
  }

  function history(input, ctx) {
    const v = (ctx.trend.k || {})[input.key] || [], dates = ctx.trend.dates || [];
    const pts = dates.map((d, i) => v[i] && { date: d, median: v[i][0], min: v[i][1], n: v[i][2] }).filter(Boolean);
    const meds = pts.map((p) => p.median);
    return { kind: "HISTORY", title: `${ctx.label(input.key)} 가격 이력 ${pts.length}주`, payload: { key: input.key, points: pts,
      summary: { first: pts[0], last: pts[pts.length - 1], min_median: Math.min(...meds), max_median: Math.max(...meds) },
      note: "실제로 모은 주만 있어요. 계절성·앞으로의 가격은 추정하지 않아요.", data_updated: ctx.updated },
      share_summary: { kind: "HISTORY", label: ctx.label(input.key), points: pts.map((p) => [p.date, p.median]) } };
  }

  // advanced planner: the same engine as the free cart (Pricing.compareClinics through ctx.cart); the paid part is the saved,
  // re-computable plan (30 days) with the A–D plans, budget, first-visit and VAT notes in one report
  function cartPlan(input, ctx) {
    const r = ctx.cart(input.items, input.region || "");
    const full = r.full || [], mix = r.mix || {}, pair = r.pair;
    const plans = [
      { id: "A", title: "한 곳에서 모두", visits: 1, total: full.length ? { min: full[0].total, max: full[full.length - 1].total } : null, clinics: full.length },
      { id: "B", title: "시술별로 나눠서", visits: mix.places || null, total: mix.missing ? null : mix.total },
      { id: "C", title: "최대 2곳", visits: pair ? 2 : null, total: pair ? pair.total : null },
    ];
    if (input.budget) for (const p of plans) p.within_budget = p.total == null ? null : (p.total.min ?? p.total) <= input.budget;
    return { kind: "CART_PLAN", title: `장바구니 계획 · 시술 ${input.items.length}개`, payload: { items: input.items, region: input.region || "전국", budget: input.budget || null, plans,
      notes: ["가격이 없는 시술은 0원으로 넣지 않아요", "첫 방문가는 지점당 1개만 계산해요", "부가세: 병원 표시가 기준(별도 표기 지점은 결제 때 10% 더)"], data_updated: ctx.updated },
      share_summary: { kind: "CART_PLAN", n: input.items.length, plans: plans.map((p) => ({ id: p.id, visits: p.visits, total: p.total })) } };
  }

  function consolidated(input, ctx) {
    const parts = [];
    if ((input.items || []).length) parts.push(cartPlan(input, ctx));
    for (const k of (input.keys || []).slice(0, 5)) {
      parts.push(regional({ key: k }, ctx));
      if (available("PRICE_HISTORY_REPORT", { key: k }, ctx).ok) parts.push(history({ key: k }, ctx));
    }
    return { kind: "CONSOLIDATED", title: `종합 보고서 · ${parts.length}부분`, payload: { parts, data_updated: ctx.updated },
      share_summary: { kind: "CONSOLIDATED", parts: parts.map((p) => p.share_summary) } };
  }

  const BUILD = { EVENT_URL_DECODER: eventDecode, EVENT_IMAGE_DECODER: eventDecode, QUOTATION_DECODER: quotation, MULTI_EVENT_COMPARE: multiCompare,
    PRODUCT_DEEP_COMPARE: productDeepCompare, REGIONAL_PRICE_REPORT: regional, PRICE_HISTORY_REPORT: history, ADVANCED_CART_PLANNER: cartPlan,
    CONSOLIDATED_REPORT: consolidated };
  // a deliverable is usable when it has a title and at least one real item (a report of nothing is not charged)
  function usable(rep) {
    if (!rep || !rep.title || !rep.payload) return false;
    const p = rep.payload;
    if (p.items) return p.items.length > 0;
    if (p.groups) return p.events.length > 0;
    if (p.rows) return p.rows.length > 0;
    if (p.points) return p.points.length >= HISTORY_MIN_POINTS;
    if (p.plans) return p.plans.some((x) => x.total != null);
    if (p.parts) return p.parts.length > 0;
    return !!(p.a && p.b && p.a.all.n && p.b.all.n);
  }
  function build(feature, input, ctx) {
    const f = BUILD[feature];
    if (!f) throw new Error("NOT_A_REPORT_FEATURE");
    return f(input, ctx);
  }

  return { available, build, usable, eventDecode, decodeOffer, HISTORY_MIN_POINTS, REGION_MIN_BRANCHES, median };
});
