#!/usr/bin/env node
// Writes the two taxonomy tables from app/data.json with the app's own rules (app/domain/classify.js, search.js):
//   docs/CLASSIFICATION_REVIEW_QUEUE.csv — what a person has to decide: rows far from their group (R), groups that mix
//       products (C), names that look like a family but no group took (J candidates), with the reason and a suggested action
//   docs/PRODUCT_ALIAS_MAPPING.csv — every spelling the app or the build reads as the same thing (search aliases, product /
//       device names, build normalisation, family patterns)
// and prints the class counts used in docs/TREATMENT_TAXONOMY.md. Read-only on the data; nothing is merged or deleted.
// Usage: node tools/review_queue.js [--stats-only]
"use strict";
const fs = require("fs");
const path = require("path");
global.Search = require("../app/domain/search.js");
const Spec = require("../app/domain/spec.js");
const Classify = require("../app/domain/classify.js");
const { rowsOf } = require("./audit_data.js");

const ROOT = path.join(__dirname, "..");
const D = JSON.parse(fs.readFileSync(path.join(ROOT, "app", "data.json"), "utf8"));
const S = D.s, ROWS = rowsOf(D), today = D.meta.updated;
const BRAND = D.meta.brands.map((b) => b[0]);
const bname = (b) => `${BRAND[D.branches[b][0]]} ${S[D.branches[b][1]]}`;
const KEYS = D.keys.map(([id, cat, label]) => ({ id, cat, label }));
const byK = new Map(KEYS.map((k) => [k.id, []]));
ROWS.forEach((r, i) => { for (const id of (S[r[7]] || "").split(" ")) if (byK.has(id)) byK.get(id).push(i); });
const csv = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const expired = (r) => /^\d{4}-\d{2}-\d{2}$/.test(S[r[10]] || "") && S[r[10]] < today;

// ---- classes for every row in a group
const count = {}, queue = [];
let qid = 0;
const push = (o) => queue.push({ id: `Q${String(++qid).padStart(5, "0")}`, status: "대기", ...o });
for (const k of KEYS) {
  const ids = byK.get(k.id).filter((i) => !expired(ROWS[i]));
  if (!ids.length) continue;
  const mix = Classify.mixOf(ids.map((i) => S[ROWS[i][2]]));
  // the middle of the group per session, plain prices first (the same basis the compare screen uses)
  const per = (i) => ROWS[i][3] / Math.min(ROWS[i][8] || 1, 98);
  const plain = ids.filter((i) => !ROWS[i][5] && !S[ROWS[i][6]]);
  const med = median((plain.length >= 3 ? plain : ids).map(per));
  for (const i of ids) {
    const r = ROWS[i];
    const res = Classify.row({ name: S[r[2]], sess: r[8], kind: r[5], tags: (S[r[6]] || "").split("·").filter(Boolean), keyLabel: k.label, mix, price: per(i), median: med });
    count[res.c] = (count[res.c] || 0) + 1;
    if (res.c === "R") push({ kind: "가격", cls: "R", key: k.id, label: k.label, brand_branch: bname(r[0]), name: S[r[2]], price: r[3], reason: res.why,
      action: "병원 원본과 대조 → 맞으면 data2/review_ok.csv, 틀리면 수집 규칙 수정" });
  }
  if (mix.mixed) push({ kind: "묶음", cls: "C", key: k.id, label: k.label, brand_branch: `${ids.length}줄`, name: [...mix.named].map(([p, n]) => `${p} ${n}`).join(" · ") + (mix.none ? ` · 표기 없음 ${mix.none}` : ""), price: "",
    reason: "한 비교 묶음에 제품·장비가 둘 이상", action: k.id.startsWith("X") ? "직접 만든 묶음: 제품별로 나눌지 결정(지금은 화면에 장비별 거르기·안내)" : "자동 묶음: build2/taxonomy.py 장비 속성 확인" });
}

// ---- J candidates: a name that matches a family's pattern but is in none of the family's groups (other treatment with
// a shared word, or a spelling the rules don't read). One line per distinct name, the busiest first.
const famKeys = (D.meta.fam || []).map(([name, rx, vs]) => { let re; try { re = new RegExp(rx); } catch (e) { re = null; } return { name, re, ids: new Set(vs.map(([id]) => id)) }; });
const cand = new Map();
ROWS.forEach((r) => {
  const nm = S[r[2]], ks = (S[r[7]] || "").split(" ").filter(Boolean);
  const flat = nm.replace(/\s+/g, "");
  if (ks.length) return;                                                                        // in a group already
  if (Classify.isBundle(nm) || /옵션\s*\d*\)|추가$|이용권|무제한|구독/.test(nm)) return;      // F / H / G: known reasons, not J
  const f = famKeys.find((x) => x.re && (x.re.test(nm) || x.re.test(flat)));
  if (!f) return;
  const c = cand.get(nm) || { fam: f.name, name: nm, branches: new Set(), ks: new Set() };
  c.branches.add(r[0]);
  cand.set(nm, c);
});
const J = [...cand.values()].filter((c) => c.branches.size >= 3).sort((a, b) => b.branches.size - a.branches.size).slice(0, 400);
for (const c of J) push({ kind: "이름", cls: "J", key: [...c.ks].join(" "), label: c.fam, brand_branch: `${c.branches.size}곳`, name: c.name, price: "",
  reason: "제품군 낱말이 있는데 어느 비교 묶음에도 없음(3곳 이상 판매): 다른 시술이거나 규칙이 못 읽는 표기",
  action: "같은 시술이면 build2/taxonomy.py 규칙에 표기 추가, 다른 시술이면 그대로(자동 병합 금지)" });

if (!process.argv.includes("--stats-only")) {
  const cols = ["id", "status", "kind", "cls", "key", "label", "brand_branch", "name", "price", "reason", "action"];
  fs.writeFileSync(path.join(ROOT, "docs", "CLASSIFICATION_REVIEW_QUEUE.csv"), "﻿" + [cols.join(","), ...queue.map((q) => cols.map((c) => csv(q[c])).join(","))].join("\n") + "\n");
  // ---- alias mapping
  const al = [];
  for (const [canon, xs] of Object.entries(Search.ALIASES)) for (const x of xs) al.push(["검색 별칭", x, canon, "app/domain/search.js ALIASES"]);
  for (const [n, rx] of Classify.DEVICES) for (const x of rx.source.split("|")) al.push(["제품·장비 이름", x.replace(/\\s\*/g, " "), n, "app/domain/classify.js DEVICES"]);
  for (const p of Spec.PRODUCTS) al.push(["제품·장비 이름", p, p, "app/domain/spec.js PRODUCTS"]);
  for (const [a, b] of [["국내산", "국산"], ["보톡스", "톡신"], ["보툴리눔 톡신", "톡신"], ["보튤리눔 톡신", "톡신"], ["리즈톡스·뉴럭스·보툴렉스·나보타·메디톡신·휴톡스·비에녹스", "국산 + 제품명"],
    ["외국산·외산·수입산", "수입"], ["50유닛·50unit·50 U·50단위", "50U"], ["CC·cC", "cc"], ["10,000J·10KJ·1만줄", "10KJ"], ["얼굴 전체·얼굴전체의", "얼굴전체"], ["벨로텔로", "벨로테로"],
    ["N회 한정가·N회 체험가", "N회(횟수)"], ["N주 프로그램·N주 케어", "코스(이용권)"]]) al.push(["빌드 정규화", a, b, "build2/xkeys.py comp()·sessions(), build2/taxonomy.py"]);
  for (const [name, rx] of D.meta.fam || []) al.push(["제품군 패턴", rx, name, "build2/taxonomy.py FAMILIES (data.json meta.fam)"]);
  fs.writeFileSync(path.join(ROOT, "docs", "PRODUCT_ALIAS_MAPPING.csv"), "﻿" + ["type,alias,canonical,source", ...al.map((x) => x.map(csv).join(","))].join("\n") + "\n");
}
const byCls = {}; for (const q of queue) byCls[q.cls] = (byCls[q.cls] || 0) + 1;
// app/review.json — what the ops screen (운영 현황 → 분류 검토) shows: counts and the first items of each kind, read-only.
// Decisions are made in the repository (data2/review_ok.csv, build2/taxonomy.py / xkeys.py), never from the app.
if (!process.argv.includes("--stats-only")) {
  const pick = (c, n) => queue.filter((q) => q.cls === c).slice(0, n).map((q) => [q.id, q.key, q.label, q.brand_branch, q.name, q.price || null, q.reason]);
  fs.writeFileSync(path.join(ROOT, "app", "review.json"), JSON.stringify({ updated: today, classes: count, queue: byCls, items: { R: pick("R", 40), C: pick("C", 60), J: pick("J", 40) } }));
}
console.log("rows in groups by class", JSON.stringify(count));
console.log("review queue", queue.length, JSON.stringify(byCls));
