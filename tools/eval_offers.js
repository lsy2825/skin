#!/usr/bin/env node
// 글 읽기·매칭 품질 평가 (docs/AI_QUALITY_AND_COST_REPORT.md). 평가 자료: 병원 사이트에서 실제로 모은 옵션 이름·가격(app/data.json)을
// 이벤트 글 한 줄로 바꾼 것 — 이미지가 아니고, 줄 모양은 단순해요(실제 포스터보다 쉬움). 정답 = 그 줄이 데이터에서 속한 비교 묶음·가격.
// 측정: 가격 읽기 정확도, 매칭 상태 분포, EXACT 정밀도(같다고 한 것 중 진짜 같은 묶음 비율), 틀린 EXACT 수(가장 위험한 오류).
// 결정론 파서·매처만 평가해요. AI 사진 읽기는 키·라이선스 있는 이미지가 없어 평가하지 않았어요(tools/eval_vision.mjs 준비만).
// Usage: node tools/eval_offers.js [--n 400] [--seed 7] [--json out.json]
"use strict";
const fs = require("fs");
const path = require("path");
const PC = require("../app/domain/pricectx.js");
const OfferParse = require("../app/domain/offerparse.js");
const Match = require("../app/domain/match.js");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg("--n", 400), SEED = +arg("--seed", 7), OUT = arg("--json", null);
const d = JSON.parse(fs.readFileSync(path.join(__dirname, "../app/data.json"), "utf8"));
const rows = PC.rowsOf(d), S = d.s;
const keys = Match.catalog(d.keys);
const label = new Map(d.keys.map(([id, , l]) => [id, l]));
let x = SEED; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);

// one row per distinct (name, key) with exactly one key and a plain price
const pool = [], seen = new Set();
for (const r of rows) {
  const ks = (S[r[7]] || "").split(" ").filter(Boolean), name = S[r[2]];
  if (ks.length !== 1 || !(r[3] >= 100) || name.includes("+") || seen.has(name + ks[0])) continue;
  seen.add(name + ks[0]); pool.push({ name, key: ks[0], price: r[3] });
}
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const sample = pool.slice(0, N);
const fmt = (p, i) => (i % 3 === 0 ? `${p.toLocaleString("ko-KR")}원` : i % 3 === 1 ? `${p}원` : p % 10000 === 0 ? `${p / 10000}만원` : `${p.toLocaleString("ko-KR")}원`);

const res = { n: sample.length, price_ok: 0, parsed: 0, status: {}, exact_right: 0, exact_wrong: 0, wrong: [], partial_best_right: 0, partial_n: 0, t_ms: 0 };
const t0 = Date.now();
sample.forEach((s, i) => {
  const p = OfferParse.parse(`${s.name} ${fmt(s.price, i)}`, { year: 2026 });
  const o = p.offers[0];
  if (!o) { res.status.UNPARSED = (res.status.UNPARSED || 0) + 1; return; }
  res.parsed++;
  if (o.advertised_price === s.price) res.price_ok++;
  const m = Match.match(o, keys);
  res.status[m.status] = (res.status[m.status] || 0) + 1;
  if (m.status === "EXACT_MATCH") {
    // the same comparable item may live under two keys with the same label (e.g. a family variant and an X key): same label = right
    if (m.key === s.key || label.get(m.key) === label.get(s.key)) res.exact_right++;
    else { res.exact_wrong++; if (res.wrong.length < 25) res.wrong.push({ name: s.name, truth: label.get(s.key), got: m.label }); }
  } else if (m.status === "PARTIAL_MATCH") { res.partial_n++; if (m.best === s.key || label.get(m.best) === label.get(s.key)) res.partial_best_right++; }
});
res.t_ms = Date.now() - t0;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const summary = {
  dataset: `app/data.json ${d.meta.updated} 실제 옵션 ${sample.length}줄(무작위, seed ${SEED}) — 글 한 줄 형식`,
  price_accuracy_pct: pct(res.price_ok, res.parsed), parse_rate_pct: pct(res.parsed, res.n), status: res.status,
  exact_precision_pct: pct(res.exact_right, res.exact_right + res.exact_wrong), exact_wrong: res.exact_wrong,
  exact_coverage_pct: pct(res.exact_right + res.exact_wrong, res.n), partial_best_right_pct: pct(res.partial_best_right, res.partial_n),
  ms_per_offer: Math.round((res.t_ms / Math.max(1, res.n)) * 100) / 100, wrong_examples: res.wrong,
};
console.log(JSON.stringify(summary, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
