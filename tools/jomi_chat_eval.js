// 죠미 대화가 사람의 말을 알아듣는지 채점 (tests/fixtures/jomi_chat_eval.json, 의도별로 손으로 적은 215문장).
//   node tools/jomi_chat_eval.js            → 지금 엔진(app/domain/jomichat.js)과 예전 방식(고민 낱말 사전만) 점수
//   node tools/jomi_chat_eval.js --fails    → 틀린 문장도 출력
// '알아들음'의 기준(의도별):
//   시술      답에 기대한 시술(묶음 이름에 그 낱말)이 앞 3개 안에 나옴
//   가격      그 시술 + 가격 숫자를 보여줌 (+ 규격을 물었으면 그 규격 묶음, 지역·브랜드를 물었으면 그걸 반영)
//   두 시술   두 시술이 모두 나옴
//   고민      기대한 고민 카드가 나옴      도움말·잡담  기대한 주제로 답함      안전  응급 안내/개인 판단 안내가 나옴
//   이어 묻기 앞 문장의 시술을 기억하고 새로 물은 규격·지역을 반영
// 예전 방식(2026-10-14까지): 고민 사전(Concern.classify)만 있었고, 시술 이름은 고민 카드가 '관련 시술'로 보여 줄 때만 나왔어요.
// 가격 숫자는 대화 안에 나온 적이 없어요(가격 화면으로 가는 버튼만).
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const D = require(path.join(ROOT, "app/data.json"));
const SET = process.argv.includes("--holdout") ? "tests/fixtures/jomi_chat_holdout.json" : "tests/fixtures/jomi_chat_eval.json";
const E = require(path.join(ROOT, SET)).items;
const Search = require(path.join(ROOT, "app/domain/search.js"));
global.Search = Search;
// the old side runs the classifier as it was before the 2026-10-15 change (git 0bebec9), so improving concern.js doesn't raise it
const Concern = (() => {
  try {
    const src = require("node:child_process").execFileSync("git", ["-C", ROOT, "show", "0bebec9:app/domain/concern.js"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = { exports: {} }; new Function("module", "exports", src)(m, m.exports); return m.exports;
  } catch (e) { return require(path.join(ROOT, "app/domain/concern.js")); }
})();
const KB = D.meta.kb || { entries: [] };
// the old side also reads the concern words as they were (git 0bebec9), so new synonyms don't raise it
const CONC = (() => {
  try { return JSON.parse(require("node:child_process").execFileSync("git", ["-C", ROOT, "show", "0bebec9:knowledge/concerns.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
  catch (e) { return D.meta.concerns; }
})();
const n = (s) => Search.norm(s || "");
const has = (names, want) => names.some((x) => n(x).includes(n(want)));

// ---- the old behaviour: concern words only
const FAMS = D.meta.fam.map(([name, , , cat, fid]) => ({ name, fid, cat }));
const kbOfFam = (f) => KB.entries.find((e) => e.families.includes(f.name)) || KB.entries.find((e) => e.fids.includes(f.fid)) || null;
function oldEngine(q) {
  const r = Concern.classify(q, CONC);
  const concerns = r.matches.map((m) => m.id);
  // a concern card lists its knowledge entries and up to 4 price links per entry
  const fams = [];
  for (const id of concerns) {
    const c = CONC.concerns.find((x) => x.id === id);
    for (const tid of c.treatments) {
      const e = KB.entries.find((x) => x.id === tid);
      if (!e) continue;
      fams.push(e.title, ...FAMS.filter((f) => kbOfFam(f) === e).slice(0, 4).map((f) => f.name));
    }
  }
  return { fams, concerns, safety: r.safety.map((s) => s.level), personal: r.personal, prices: false };
}

function judge(it, res) {
  const famOk = (w) => has(res.fams.slice(0, Math.max(3, res.fams.length > 3 && res.concerns && res.concerns.length ? res.fams.length : 3)), w);
  switch (it.intent) {
    case "treatment": return famOk(it.fam);
    case "price": case "followup": {
      if (!famOk(it.fam)) return false;
      if (it.intent === "price" && !res.prices) return false;
      if (it.intent === "followup" && !res.prices && !it.spec && !it.where && !/가격|얼마|싼/.test(it.q)) return true;
      if (it.intent === "followup" && !res.prices) return false;
      if (it.spec && !n(res.key || "").includes(n(it.spec))) return false;
      if (it.where && !(res.where || []).some((w) => n(w).includes(n(it.where)))) return false;
      return true;
    }
    case "compare2": return has(res.fams, it.fam) && has(res.fams, it.fam2);
    case "concern": return (res.concerns || []).includes(it.concern);
    case "help": return res.help === it.help;
    case "chit": return res.chit === it.chit;
    case "safety": return it.level === "emergency" ? (res.safety || []).includes("emergency") : !!(res.personal || (res.safety || []).length);
    default: return false;
  }
}

function score(name, engine, items = E) {
  const by = {}, fails = [];
  let memo = null;
  for (const it of items) {
    if (it.intent === "followup") { memo = engine.fresh ? engine.fresh() : null; engine.run(it.prev, memo); }
    else memo = engine.fresh ? engine.fresh() : null;
    const res = engine.run(it.q, memo);
    const ok = judge(it, res);
    (by[it.intent] = by[it.intent] || [0, 0])[ok ? 0 : 1]++;
    if (!ok) fails.push(`${it.intent} | ${it.prev ? it.prev + " → " : ""}${it.q} | 받은 것: ${JSON.stringify({ fams: res.fams.slice(0, 3), key: res.key, where: res.where, c: res.concerns, help: res.help, chit: res.chit, kind: res.kind })}`);
  }
  const tot = Object.values(by).reduce((a, [o, x]) => [a[0] + o, a[1] + o + x], [0, 0]);
  return { name, by, ok: tot[0], all: tot[1], pct: (100 * tot[0]) / tot[1], fails };
}

const engines = [{ name: "예전(고민 사전만)", run: (q) => oldEngine(q) }];
try {
  const JC = require(path.join(ROOT, "app/domain/jomichat.js"));
  const ctx = JC.ctxFromData(D, "2026-10-14");
  engines.push({ name: "지금(jomichat.js)", fresh: () => JC.memory(), run: (q, memo) => JC.toEval(JC.understand(q, ctx, memo || JC.memory()), ctx) });
} catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; }

// 손대지 않은 기준: data.json의 시술 묶음 이름 전부(3곳 이상 파는 것) — 이름만 / '이름 가격'으로 물었을 때 그 묶음이 앞 3개에 나오나
function famBench(e) {
  const names = D.meta.fam.map((f) => f[0]);
  let a = 0, b = 0;
  for (const nm of names) {
    const r1 = e.run(nm, e.fresh ? e.fresh() : null), r2 = e.run(`${nm} 가격`, e.fresh ? e.fresh() : null);
    if (r1.fams.slice(0, 3).includes(nm)) a++;
    if (r2.fams.slice(0, 3).includes(nm) && r2.prices) b++;
  }
  return { n: names.length, hitName: a, hitPrice: b };
}
if (require.main === module) {
  const out = engines.map((e) => score(e.name, e));
  const bench = engines.map((e) => ({ name: e.name, ...famBench(e) }));
  const INT = { treatment: "시술 이름·설명", price: "가격(규격·지역 포함)", compare2: "두 시술 비교", concern: "피부 고민", help: "앱 도움말", chit: "인사·잡담", safety: "안전·개인 판단", followup: "이어 묻기" };
  console.log(`평가 문장 ${E.length}개 (${SET})`);
  for (const k of Object.keys(INT)) console.log(`  ${INT[k].padEnd(14)} ${out.map((r) => { const [o, x] = r.by[k] || [0, 0]; return `${r.name}: ${o}/${o + x} (${(100 * o / Math.max(1, o + x)).toFixed(0)}%)`; }).join("   ")}`);
  for (const r of out) console.log(`전체 ${r.name}: ${r.ok}/${r.all} = ${r.pct.toFixed(1)}%`);
  for (const r of bench) console.log(`묶음 이름 ${r.n}개(손대지 않은 기준) — ${r.name}: 이름만 물으면 ${(100 * r.hitName / r.n).toFixed(1)}% · '이름 가격'이면 ${(100 * r.hitPrice / r.n).toFixed(1)}%`);
  if (process.argv.includes("--fails")) for (const r of out) { console.log(`--- 틀린 문장: ${r.name} (${r.fails.length})`); r.fails.forEach((f) => console.log("  " + f)); }
  if (process.argv.includes("--json")) console.log(JSON.stringify({ set: out.map((r) => ({ name: r.name, ok: r.ok, all: r.all, pct: r.pct, by: r.by })), bench }));
}
module.exports = { score, judge, engines, famBench, items: E };
