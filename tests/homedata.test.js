// home.json (build2/homedata.py, round-2 O2) against data.json: the home screen shown from home.json must give the same
// numbers as the full file. Checked here with a separate JS reading of app.js's rules (applyData FAM, views.home): every
// id the home screen can show is shipped with ALL its rows (same branch, name, price, conditions, group), the family counts
// the app cannot count from home.json are the full file's, and data-meta.json names home.json's checksum.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Sync = require("../app/domain/sync.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "../app", f), "utf8");
const FULL_TXT = read("data.json"), HOME_TXT = read("home.json");
const FULL = JSON.parse(FULL_TXT), HOME = JSON.parse(HOME_TXT), META = JSON.parse(read("data-meta.json"));

function rowsOf(d) {
  const c = d.cols.map((x) => [...x]), n = c[0].length;
  for (const f of d.colDelta || []) { let a = 0; for (let j = 0; j < n; j++) c[f][j] = a += c[f][j]; }
  return Array.from({ length: n }, (_, j) => c.map((x) => x[j]));
}
// a row with its strings and group resolved, so rows of the two files can be compared
const BR = (d, b) => `${d.meta.brands[d.branches[b][0]][0]} ${d.s[d.branches[b][1]]}`;
const resolve = (d, r) => JSON.stringify([BR(d, r[0]), r[1], d.s[r[2]], r[3], r[4], r[5], d.s[r[6]], d.s[r[7]], r[8],
  r[9] != null && r[9] >= 0 ? d.s[d.groups[r[9]][0]] : r[9], d.s[r[10]], d.s[r[11]], r[12], r[13], d.s[r[14]]]);
const FR = rowsOf(FULL), HR = rowsOf(HOME);
const byKey = (d, rows) => { const m = new Map(); rows.forEach((r, j) => { const ks = d.s[r[7]]; if (ks) for (const id of ks.split(" ")) { if (!m.has(id)) m.set(id, []); m.get(id).push(j); } }); return m; };
const FK = byKey(FULL, FR), HK = byKey(HOME, HR);
const branchesOf = (id) => new Set((FK.get(id) || []).map((j) => FR[j][0]));

test("data-meta.json names home.json: same build, checksum, counts; the app's own check passes", () => {
  const sha = crypto.createHash("sha256").update(HOME_TXT).digest("hex");
  assert.equal(META.home.sha256, sha);
  assert.equal(META.home.bytes, Buffer.byteLength(HOME_TXT));
  assert.equal(META.sha256, crypto.createHash("sha256").update(FULL_TXT).digest("hex"), "data-meta.json describes this data.json");
  assert.deepEqual(Sync.checkHome(HOME, META, sha), []);
  assert.ok(Sync.checkHome(HOME, META, "0".repeat(64)).length, "a wrong checksum is refused");
  assert.ok(Sync.checkHome(HOME, { ...META, home: undefined }, sha).length, "no home entry in the meta: not used");
  assert.equal(HOME.meta.partial.rows, FULL.meta.rows);
  assert.equal(HOME.meta.partial.keys, FULL.keys.length);
  assert.ok(HOME_TXT.length < FULL_TXT.length / 4, `${HOME_TXT.length} vs ${FULL_TXT.length}`);
});

test("every shipped id carries all of its rows, unchanged; no row of another id", () => {
  for (const [id] of HOME.keys) {
    const a = (FK.get(id) || []).map((j) => resolve(FULL, FR[j])).sort(), b = (HK.get(id) || []).map((j) => resolve(HOME, HR[j])).sort();
    assert.deepEqual(b, a, id);
  }
  const ids = new Set(HOME.keys.map((k) => k[0]));
  for (const r of HR) assert.ok(HOME.s[r[7]].split(" ").some((id) => ids.has(id)), HOME.s[r[2]]);
  assert.deepEqual(HOME.branches.map((_, b) => BR(HOME, b)), FULL.branches.map((_, b) => BR(FULL, b)), "all branches, same order");
});

test("the ids the home screen can show are all shipped (app.js rules read again here)", () => {
  const KI = Object.fromEntries(FULL.keys.map((k, i) => [k[0], i]));
  const size = (id) => branchesOf(id).size;
  // applyData: families with options in keys; n; main = biggest option not ending in N회 (first on ties); cat
  const FAM = FULL.meta.fam.map(([name, rx, vs, cat]) => {
    const v = vs.filter(([id]) => KI[id] != null);
    if (!v.length) return null;
    const one = v.filter(([, l]) => !/\d+회$/.test(l)), pool = one.length ? one : v;
    const main = pool.reduce((a, x) => (size(x[0]) > size(a[0]) ? x : a))[0];
    return { name, n: new Set(v.flatMap(([id]) => [...branchesOf(id)])).size, main, cat: cat || FULL.keys[KI[main]][1] };
  }).filter(Boolean);
  const byN = [...FAM].sort((a, b) => b.n - a.n);
  const want = new Set([...FULL.keys].sort((a, b) => size(b[0]) - size(a[0])).slice(0, 6).map((k) => k[0]));   // 인기
  const cats = [...new Set(FULL.keys.map((k) => k[1]))];
  for (const c of cats) byN.filter((f) => f.cat === c).slice(0, 6).forEach((f) => want.add(f.main));            // category tabs
  byN.filter((f) => f.cat !== "기타").slice(0, 80).forEach((f) => want.add(f.main));                           // 오늘의 발견
  for (const c of FULL.changes || []) want.add(FULL.keys[c[0]][0]);                                                 // 가격 변동
  assert.deepEqual([...new Set(HOME.keys.map((k) => k[0]))].sort(), [...want].sort());
  assert.deepEqual(HOME.meta.partial.cats, cats);
  // the family counts the app takes from meta.partial.fn are the full file's
  const nOf = new Map(FAM.map((f) => [f.name, f.n]));
  HOME.meta.fam.forEach((f, i) => assert.equal(HOME.meta.partial.fn[i], nOf.get(f[0]), f[0]));
});

test("price changes, auto-group changes and source re-checks point at the same things", () => {
  const ch = (d, c) => [d.keys[c[0]][0], BR(d, c[1]), c[2], c[3]].join("|");
  assert.deepEqual(HOME.changes.map((c) => ch(HOME, c)), (FULL.changes || []).map((c) => ch(FULL, c)));
  const g = (d, x) => [d.s[d.groups[x[0]][0]], ...x.slice(1)].join("|");
  for (const k of ["chg", "new"]) assert.deepEqual(HOME.achg[k].map((x) => g(HOME, x)), (FULL.achg[k] || []).map((x) => g(FULL, x)), k);
  assert.deepEqual(HOME.achg.gone.map((x) => [HOME.s[x[0]], ...x.slice(1)].join("|")), (FULL.achg.gone || []).map((x) => [FULL.s[x[0]], ...x.slice(1)].join("|")));
  const hk = (d, rows, c) => `${resolve(d, rows[c[0]])}|${c.slice(1).join("|")}`;
  const fullChecks = new Set((FULL.meta.checks || []).map((c) => hk(FULL, FR, c)));
  for (const c of HOME.meta.checks) assert.ok(fullChecks.has(hk(HOME, HR, c)));
});
