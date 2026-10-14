#!/usr/bin/env node
// Data audit (docs/PRODUCT_AUDIT.md, docs/DATA_QUALITY_REPORT.md): reads app/data.json the way the app does and lists the
// problems a price comparison must not have: one comparison key holding different products / quantities / session counts,
// duplicate ids or labels, duplicate branches, the same price row twice, a key's price spread too wide to be one item, an
// expired event still marked live, a family variant claimed by two families. Read-only: it never edits the data.
// Usage: node tools/audit_data.js [path/to/data.json] [--json out.json]   → summary on stdout, exit 0 (report, not a gate)
"use strict";
const fs = require("fs");
const path = require("path");
const Search = require("../app/domain/search.js");
const Spec = require("../app/domain/spec.js");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && a.endsWith(".json") && args[args.indexOf(a) - 1] !== "--json") || path.join(__dirname, "../app/data.json");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

function rowsOf(d) {
  if (d.rows) return d.rows;
  const c = d.cols, n = c[0].length, rows = new Array(n);
  for (const f of d.colDelta || []) { let a = 0; const x = c[f]; for (let j = 0; j < n; j++) x[j] = a += x[j]; }
  for (let j = 0; j < n; j++) { const r = new Array(c.length); for (let f = 0; f < c.length; f++) r[f] = c[f][j]; rows[j] = r; }
  return rows;
}

function audit(d) {
  const S = d.s, rows = rowsOf(d), today = d.meta.updated;
  const BR = d.branches.map((b, i) => ({ i, brand: d.meta.brands[b[0]], name: S[b[1]], addr: S[b[2]], lat: b[3], lng: b[4], status: S[b[8]] }));
  const bname = (b) => `${BR[b].brand} ${BR[b].name}`;
  const KEYS = d.keys.map(([id, cat, label], i) => ({ i, id, cat, label }));
  const KI = new Map(KEYS.map((k) => [k.id, k.i]));
  const out = {};
  const add = (k, v) => (out[k] = out[k] || []).push(v);

  // 1. ids and labels
  const seenId = new Map(), seenLabel = new Map();
  for (const k of KEYS) {
    if (seenId.has(k.id)) add("dupKeyId", { id: k.id, a: seenId.get(k.id), b: k.label });
    seenId.set(k.id, k.label);
    const l = `${k.cat}|${k.label}`;
    if (seenLabel.has(l)) add("dupKeyLabel", { label: k.label, cat: k.cat, ids: [seenLabel.get(l), k.id] });
    else seenLabel.set(l, k.id);
  }

  // 2. branches: same brand+name, same coordinates, missing coordinates
  const bseen = new Map(), cseen = new Map();
  for (const b of BR) {
    const key = `${b.brand}|${b.name}`;
    if (bseen.has(key)) add("dupBranch", { branch: key });
    bseen.set(key, b.i);
    if (b.lat == null || b.lng == null) add("branchNoGeo", { branch: bname(b.i) });
    else {
      const c = `${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
      if (cseen.has(c)) add("sameCoords", { a: bname(cseen.get(c)), b: bname(b.i), at: c });
      else cseen.set(c, b.i);
    }
  }

  // 3. rows per key, with the key label's product / quantity / session
  const byK = KEYS.map(() => []);
  rows.forEach((r, i) => { const ks = S[r[7]]; if (ks) for (const id of ks.split(" ")) { const k = KI.get(id); if (k == null) add("rowUnknownKey", { row: i, id }); else byK[k].push(i); } });
  const prodIn = (t) => Spec.PRODUCTS.filter((p) => (Spec.norm ? Spec.norm(t) : t).includes(p));
  // a bundle label ('눈밑 보톡스 1회 + 리쥬란아이 2회') counts its largest N회, like build2/xkeys.py sessions()
  const labelSess = (l) => { const ms = [...l.matchAll(/(\d+)\s*회(?!당)/g)].map((m) => +m[1]); return ms.length ? (l.includes("+") ? Math.max(...ms) : ms[0]) : null; };
  for (const k of KEYS) {
    const ids = byK[k.i];
    if (!ids.length) { add("emptyKey", { id: k.id, label: k.label }); continue; }
    const kp = prodIn(k.label), ku = Search.unitOf(k.label), ks = labelSess(k.label);
    const prodBad = [], unitBad = [], sessBad = [];
    const per = [];
    for (const i of ids) {
      const r = rows[i], name = S[r[2]];
      // product named in the row but not the key's (only when the key names a product)
      if (kp.length) {
        const rp = prodIn(name);
        if (rp.length && !rp.some((p) => kp.includes(p))) prodBad.push({ row: i, branch: bname(r[0]), name, prod: rp.join("·") });
      }
      // quantity: a row naming another quantity of the same unit kind (bundles '+' are allowed to differ per part)
      if (ku && !name.includes("+")) {
        const ru = Search.unitOf(name);
        if (ru && ru.unit === ku.unit && ru.qty !== ku.qty) unitBad.push({ row: i, branch: bname(r[0]), name, qty: `${ru.qty}${ru.unit}` });
      }
      // sessions: key says N회, the row's session count differs (99 = pass)
      const sess = r[8] || 1;
      if (ks && sess !== ks) sessBad.push({ row: i, branch: bname(r[0]), name, sess });
      if (!ks && sess > 1 && sess < 99 && !/회/.test(k.label)) sessBad.push({ row: i, branch: bname(r[0]), name, sess, note: "key has no session count" });
      if (r[3] > 0) per.push({ p: r[3] / (sess >= 99 ? 1 : sess), i });
    }
    if (prodBad.length) add("keyMixedProduct", { id: k.id, label: k.label, n: ids.length, bad: prodBad.length, ex: prodBad.slice(0, 4) });
    if (unitBad.length) add("keyMixedQty", { id: k.id, label: k.label, n: ids.length, bad: unitBad.length, ex: unitBad.slice(0, 4) });
    if (sessBad.length) add("keyMixedSess", { id: k.id, label: k.label, n: ids.length, bad: sessBad.length, ex: sessBad.slice(0, 4) });
    // spread: per-session price max/min > 8 among live rows → probably not one item
    if (per.length >= 3) {
      per.sort((a, b) => a.p - b.p);
      const lo = per[0], hi = per[per.length - 1];
      if (hi.p / lo.p > 8) add("keyWideSpread", { id: k.id, label: k.label, n: per.length, ratio: +(hi.p / lo.p).toFixed(1),
        lo: { p: Math.round(lo.p), name: S[rows[lo.i][2]], branch: bname(rows[lo.i][0]) }, hi: { p: Math.round(hi.p), name: S[rows[hi.i][2]], branch: bname(rows[hi.i][0]) } });
    }
  }

  // 4. rows: duplicates, expired, prices
  const rseen = new Map();
  let expired = 0, zero = 0, origLow = 0, noUrl = 0, vatUnknown = 0;
  rows.forEach((r, i) => {
    const sig = `${r[0]}|${r[2]}|${r[3]}|${r[8]}|${r[10]}`;
    if (rseen.has(sig)) add("dupRow", { row: i, first: rseen.get(sig), branch: bname(r[0]), name: S[r[2]], price: r[3] });
    else rseen.set(sig, i);
    const u = S[r[10]] || "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(u) && u < today) expired++;
    if (!(r[3] > 0)) zero++;
    if (r[4] && r[4] < r[3]) origLow++;
    if (!S[r[11]]) noUrl++;
    if (!r[12]) vatUnknown++;
  });
  out.counts = { rows: rows.length, branches: BR.length, keys: KEYS.length, expiredInFile: expired, zeroPrice: zero, origBelowSale: origLow, noSourceUrl: noUrl, vatUnknown,
    staleBranches: BR.filter((b) => b.status && b.status !== "VERIFIED").length };

  // 5. families: one variant key claimed by two families (the app keeps the first)
  const famOf = new Map();
  for (const [name, , vs] of d.meta.fam || []) for (const [id, label] of vs) {
    if (famOf.has(id) && famOf.get(id).name !== name) add("keyInTwoFamilies", { id, label: (KEYS[KI.get(id)] || {}).label, a: famOf.get(id).name, b: name });
    else famOf.set(id, { name, label });
    if (!KI.has(id)) add("familyMissingKey", { family: name, id });
  }
  // 6. groups: same label twice in one category
  const gseen = new Map();
  (d.groups || []).forEach(([s, cat], i) => { const l = `${cat}|${S[s]}`; if (gseen.has(l)) add("dupGroup", { label: S[s], cat, a: gseen.get(l), b: i }); else gseen.set(l, i); });
  return out;
}

if (require.main === module) {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = audit(d);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
  console.log("counts", JSON.stringify(out.counts));
  for (const [k, v] of Object.entries(out)) if (k !== "counts") console.log(`${k}: ${v.length}`);
}
module.exports = { audit, rowsOf };
