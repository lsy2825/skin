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
  // 2 excluded), until ('YYYY-MM-DD' | 'posted:…' | ''), today ('YYYY-MM-DD'), conds [other condition texts] }
  // → [{ k, v, state }] with state 'limit' (a stated restriction) | 'none' (stated: no restriction) | 'unknown' (not stated)
  function eligibility(o) {
    const n = o.name || "", tags = o.tags || [], out = [];
    const first = tags.includes("첫 방문") || /첫\s*방문|신규/.test(n);
    out.push(first ? { k: "첫 방문", v: "첫 방문(신규)만", state: "limit" } : { k: "첫 방문", v: "표기 없음 — 재방문도 되는지 확인", state: "unknown" });
    out.push(o.kind === 1 ? { k: "체험 가격", v: "체험가 — 보통 1인 1회", state: "limit" }
      : o.kind === 2 ? { k: "체험 가격", v: "한정가 — 기간·수량·조건이 붙어요", state: "limit" }
        : o.kind === 3 ? { k: "체험 가격", v: "구독권", state: "limit" }
          : o.kind === 4 ? { k: "체험 가격", v: "고시가(병원 게시 가격표)", state: "none" } : { k: "체험 가격", v: "일반 가격", state: "none" });
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

  return { PRODUCTS, norm, parse, diff, eligibility };
});
