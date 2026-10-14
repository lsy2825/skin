// 죠미 가격 질문 평가 세트 (UX05 / R02 follow-up): 100 questions built from the real data.json, each with the answer it must
// give — the comparison group the question names, only prices of that exact spec, numbers that come from the data — and
// follow-ups ('그럼 4cc는?') that keep the treatment and change only the spec. The pass rate is printed; the bar is 95%.
// Pure modules, no network. The questions are made from the current group labels, so they follow the data as it grows.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PC = require("../app/domain/pricectx.js");
const J = require("../app/domain/jomiqa.js");
const Search = require("../app/domain/search.js");

const D = JSON.parse(fs.readFileSync(path.join(__dirname, "../app/data.json"), "utf8"));
const CTX = PC.fromData(D, "2026-10-14");
const SUFFIX = ["가격 얼마야?", "가격대 어때요?", "보통 얼마예요", "얼마 정도 해?", "중간값 알려줘"];

// 100 groups: the hand-made comparison keys (X…) first, then the variant groups sold at the most branches, one per
// family name so the set is not 40 kinds of 보톡스
function evalSet() {
  const keys = CTX.keys.filter((k) => CTX.prices(k.id, "").length >= 5);
  const picked = [], fams = new Set();
  for (const k of keys.filter((x) => /^X/.test(x.id))) picked.push(k);
  const rest = keys.filter((x) => !/^X/.test(x.id)).sort((a, b) => CTX.prices(b.id, "").length - CTX.prices(a.id, "").length);
  for (const k of rest) {
    if (picked.length >= 100) break;
    const fam = k.label.split(/[\s(]/)[0];
    if (fams.has(fam)) continue;
    fams.add(fam); picked.push(k);
  }
  return picked.slice(0, 100).map((k, i) => ({ k, q: `${k.label} ${SUFFIX[i % SUFFIX.length]}` }));
}

test("eval set: 100 real-data price questions — right group, exact spec, numbers only from the data (≥ 95%)", () => {
  const set = evalSet();
  assert.equal(set.length, 100, `only ${set.length} groups with 5+ branches`);
  const fails = [];
  for (const { k, q } of set) {
    const f = J.facts(q, CTX), sp = J.spec(q);
    const g = f.groups.find((x) => x.id === k.id);
    const why = !f.groups.length ? "no group" : !g ? `other groups: ${f.groups.map((x) => x.label).join(" / ")}`
      : sp.qty != null && f.groups.some((x) => { const kk = CTX.keys.find((y) => y.id === x.id); return !(kk.unit === sp.unit && kk.qty === sp.qty); }) ? "a group of another quantity"
      : (() => { const ps = CTX.prices(k.id, "").map((x) => x.p); return g.min === Math.min(...ps) && g.max === Math.max(...ps) && g.n === ps.length ? "" : "numbers differ from the data"; })();
    if (!why) {
      const a = J.deterministicAnswer(f), c = J.check(a, f);
      if (!c.ok) fails.push(`${q} → answer check: ${c.reason}`);
    } else fails.push(`${q} → ${why}`);
  }
  const rate = (100 - fails.length);
  console.log(`# jomi eval: ${rate}/100 pass`);
  if (fails.length) console.log(fails.slice(0, 10).map((x) => `#   ${x}`).join("\n"));
  assert.ok(rate >= 95, `${rate}/100\n${fails.join("\n")}`);
});

// the same 100 with the label's parenthesis left out ('수입 필러 1cc' for '수입 필러 1cc (쥬비덤·레스틸렌)') — closer to how people
// type, and harder: several groups can fit. Reported only (no bar), so the number stays honest rather than tuned.
test("eval set, loose wording (reported, no bar): label without its parenthesis", () => {
  let only = 0, among = 0;
  for (const { k, q } of evalSet()) {
    const f = J.facts(q.replace(/\s*\([^)]*\)/g, ""), CTX);
    if (f.groups.some((x) => x.id === k.id)) among++;
    if (f.groups.length && f.groups.every((x) => x.id === k.id)) only++;
  }
  console.log(`# jomi eval (loose wording): asked group shown ${among}/100, shown alone ${only}/100`);
});

test("follow-up: '그럼 4cc는?' keeps the treatment and changes only the spec; a new treatment stands alone", () => {
  const ctx = CTX;
  assert.equal(J.followUp("리쥬란힐러 2cc 가격대가 어때요?", "그럼 4cc는?", ctx), "리쥬란힐러 가격대가 어때요? 4cc");
  assert.equal(J.followUp("국산 사각턱 보톡스 50U 얼마야?", "100U는?", ctx), "국산 사각턱 보톡스 얼마야? 100U");
  assert.equal(J.followUp("리쥬란힐러 2cc 가격", "울쎄라 300샷은?", ctx), "울쎄라 300샷은?", "names its own treatment: not merged");
  assert.equal(J.followUp("", "그럼 4cc는?", ctx), "그럼 4cc는?", "no previous question");
  assert.equal(J.followUp("리쥬란힐러 2cc 가격", "고마워", ctx), "고마워", "no spec, no '그럼': stands alone");
  // and the merged question finds the 4cc group, not the 2cc one
  const asked = J.followUp("리쥬란힐러 2cc 가격대가 어때요?", "그럼 4cc는?", ctx);
  const f = J.facts(asked, ctx);
  assert.ok(f.groups.length, asked);
  for (const g of f.groups) { const k = ctx.keys.find((x) => x.id === g.id); assert.equal(`${k.qty}${k.unit}`, "4cc", g.label); }
});

test("follow-up pairs from the data: for groups sold in two quantities, the follow-up lands on the other quantity", () => {
  const byFam = new Map();
  for (const k of CTX.keys) if (k.qty != null && k.unit === "cc" && CTX.prices(k.id, "").length >= 5) {
    const base = k.label.replace(/\s*\d+\s*cc.*$/, "").trim();
    if (!byFam.has(base)) byFam.set(base, []);
    byFam.get(base).push(k);
  }
  const pairs = [...byFam.entries()].filter(([, ks]) => new Set(ks.map((k) => k.qty)).size >= 2).slice(0, 10);
  assert.ok(pairs.length >= 3, `${pairs.length} families with two cc sizes`);
  let ok = 0;
  for (const [base, ks] of pairs) {
    const [a, b] = [...new Set(ks.map((k) => k.qty))].sort((x, y) => x - y);
    const asked = J.followUp(`${base} ${a}cc 가격`, `그럼 ${b}cc는?`, CTX);
    const f = J.facts(asked, CTX);
    if (f.groups.length && f.groups.every((g) => { const k = CTX.keys.find((x) => x.id === g.id); return k.qty === b && k.unit === "cc"; })) ok++;
  }
  console.log(`# follow-up pairs: ${ok}/${pairs.length}`);
  assert.ok(ok / pairs.length >= 0.8, `${ok}/${pairs.length}`);
});
