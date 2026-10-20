// Comparability of one price row inside its comparison group (docs/TREATMENT_TAXONOMY.md §3, A–J): how sure the app can
// be that the row is "the same treatment" as the others, read only from what the clinic wrote. The app shows the class
// next to a price ('비교 판정'); tools/review_queue.js writes the rows that need a person (NEEDS_REVIEW, J) to
// docs/CLASSIFICATION_REVIEW_QUEUE.csv with the same rules. Pure functions, no DOM.
// window.Classify in the app (needs window.Spec), require()d by tests/classify.test.js and tools/review_queue.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./spec.js"));
  else root.Classify = factory(root.Spec);
})(typeof self !== "undefined" ? self : this, function (Spec) {
  "use strict";

  // cmp: 'direct' = compare as is · 'caution' = same treatment, something to check · 'reference' = not the same unit,
  // only for reference · 'never' = a different treatment, never merged
  const CLASSES = {
    A: { label: "같은 시술·같은 용량", cmp: "direct", say: "비교하는 시술과 제품·용량·횟수가 맞아요." },
    B: { label: "제품명 표기 없음", cmp: "caution", say: "같은 시술의 다른 병원은 제품명을 적었는데, 이 상품명엔 제품·장비 이름이 없어요. 어떤 제품인지 병원에 확인하세요." },
    C: { label: "다른 제품·장비", cmp: "caution", say: "같은 부위·횟수지만 제품·장비가 다른 가격과 함께 있어요. 제품이 달라 효과·통증·유지 기간이 다를 수 있어요." },
    D: { label: "용량·부위 표기 없음", cmp: "caution", say: "비교하는 시술은 용량·부위가 정해져 있는데, 이 상품명엔 그 표기가 없어요." },
    E: { label: "특가", cmp: "caution", say: "첫 방문·체험가·한정가·요일·시간 같은 조건이 붙은 가격이에요. 조건이 맞을 때만 이 가격이에요." },
    F: { label: "패키지", cmp: "reference", say: "다른 시술이 함께 들어간 패키지 가격이에요. 단품 가격과 바로 비교하지 마세요." },
    G: { label: "이용권·코스", cmp: "reference", say: "여러 번·기간 이용권 가격이에요. 1회 가격과 바로 비교하지 마세요." },
    H: { label: "추가 옵션", cmp: "reference", say: "다른 시술과 함께할 때만 사는 추가 옵션이에요. 단독 가격이 아니에요." },
    I: { label: "고시 가격표", cmp: "caution", say: "병원 게시 비급여 가격표(정가)예요. 행사 가격이 아니라 실제 결제가는 다를 수 있어요." },
    J: { label: "이름만 비슷한 다른 시술", cmp: "never", say: "이름에 같은 낱말이 있지만 다른 시술이에요. 자동으로 같은 시술로 묶지 않아요." },
    R: { label: "확인 필요", cmp: "caution", say: "같은 시술의 다른 가격과 너무 달라요(10배 이상 차이). 표기 오류일 수 있어 사람이 확인해야 해요." },
  };

  // devices / products under one canonical name (제모 devices are written many ways). Spec.PRODUCTS covers the rest.
  const DEVICES = [["아포지 플러스", /아포지/], ["젠틀맥스 프로 플러스", /젠틀맥스/], ["포토나 아발란체", /포토나|아발란체/], ["클라리티Ⅱ", /클라리티/],
    ["에일린", /에일린/], ["엘리트 플러스", /엘리트\s*플러스/], ["소프라노", /소프라노/], ["텐쎄라", /텐쎄라/], ["리쥬하이", /리쥬하이/, ["리쥬란"]]];   // 리쥬하이 = a mix that contains 리쥬란
  const COVERED = new Set(["아포지", "젠틀맥스", "클라리티"]);
  function products(name) {
    const t = name || "", out = [];
    const hidden = new Set(COVERED);
    for (const [n, rx, hides] of DEVICES) if (rx.test(t)) { out.push(n); for (const x of hides || []) hidden.add(x); }
    for (const p of Spec.PRODUCTS) if (!hidden.has(p) && t.includes(p) && !out.some((x) => x.includes(p))) out.push(p);
    return out;
  }

  // free extras a clinic adds to one treatment ('+ 진정관리', '+ 크라이오셀') — not a second treatment (build2/xkeys.py ADDON)
  const FREE = /\s*\+\s*(진정관리|크라이오셀|크라이오|촉촉팩|LED(\(5분\))?|모델링팩|모델링|재생관리|수분팩|수분관리|진정팩|미백관리|비타민관리|(LDM|ldm)\s*\d*분?|맞춤관리|팁\s*별도)(\s*\d+회)?/gi;
  const isBundle = (name) => /\+/.test((name || "").replace(FREE, "")) || /패키지|PKG|세트/.test(name || "");
  const ADDON = /\[추가\]|^추가|추가$|추가\)|옵션\s*\d*\)|단독\s*(시술|사용)?\s*불가|추가\s*구매|동시\s*시술/;
  const AMOUNT = /\d+(?:\.\d+)?\s*(U|유닛|단위|cc|CC|ml|샷|KJ|kJ|kj|부위|개(?!월)|줄|시린지|vial|분|mm)/;

  // the products named across a group's rows → { named: Map(product → rows), none: rows without one, mixed }
  function mixOf(names) {
    const named = new Map();
    let none = 0;
    for (const n of names) {
      const ps = products(n);
      if (!ps.length) none++;
      for (const p of ps) named.set(p, (named.get(p) || 0) + 1);
    }
    return { named, none, mixed: named.size > 1 };
  }

  // o: { name, sess, kind (0 일반 · 1 체험가 · 2 한정가 · 3 구독권 · 4 고시가), tags [], keyLabel, mix (mixOf of the group),
  //      price, median (of the group, same basis), addon (optional: the data's own add-on call, data.json row field 15 —
  //      without it the name rule ADDON decides) } → { c, ...CLASSES[c], why }
  function row(o) {
    const name = o.name || "", label = o.keyLabel || "";
    const out = (c, why) => ({ c, ...CLASSES[c], why: why || CLASSES[c].say });
    if (o.price > 0 && o.median > 0 && (o.price <= o.median / 10 || o.price >= o.median * 10)) {
      const r = o.price / o.median;
      // 체험가 far below the middle is an event, not an error; the review is for the rest
      if (!(r < 1 && (o.kind === 1 || o.kind === 2))) return out("R", `${CLASSES.R.say} (중간 가격의 ${r < 1 ? Math.round(r * 100) + "%" : r.toFixed(1) + "배"})`);
    }
    if (o.addon != null ? o.addon : ADDON.test(name)) return out("H");
    if ((o.sess || 1) >= 99) return out("G");
    if (isBundle(name) && !/\+/.test(label)) return out("F");
    if (o.kind === 1 || o.kind === 2 || (o.tags || []).length || /첫\s*방문|신규|평일|주말|타임|선착순/.test(Spec.dropNewItem(name))) return out("E");
    if (o.kind === 4) return out("I");
    const ps = products(name), mix = o.mix;
    if (mix && mix.mixed && ps.length) return out("C", `${CLASSES.C.say} 이 가격: ${ps.join("·")} · 같은 시술: ${[...mix.named.keys()].join("·")}`);
    if (mix && mix.named.size && !ps.length) return out("B");
    if (AMOUNT.test(label) && !AMOUNT.test(name)) return out("D");
    return out("A");
  }

  // an add-on sold only with another treatment ('옵션) 히알라제 추가', class H): never a stand-alone price, so it stays out of a
  // group's range, middle and lowest (audit U10, E5)
  const isAddon = (name) => ADDON.test(name || "");
  // data.json row field 15 'addon' (build2/appdata.py, 2026-10-15): 1 = an add-on, decided by the build from the site's own
  // option labels. Files from before have 15 fields: then the app reads the name (isAddon) instead. Checked once per file.
  const ADDON_FIELD = 15;
  const hasAddonField = (d) => !!d && (Array.isArray(d.cols) ? d.cols.length > ADDON_FIELD
    : Array.isArray(d.rows) && Array.isArray(d.rows[0]) && d.rows[0].length > ADDON_FIELD);

  return { CLASSES, DEVICES, products, mixOf, isBundle, isAddon, ADDON_FIELD, hasAddonField, row };
});
