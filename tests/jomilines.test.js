// 죠미 대사 (app/data/jomi_lines.json + app/domain/jomilines.js): the copy rules every line keeps, the count that is claimed,
// and that the app's situations all have lines. Non-medical lines only — no diagnosis, dose, treatment pick, clinic name or
// won amount; friendly 반말; short; no line twice, no near-copies within one situation; the fixed safety lines never change.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const JSON_PATH = path.join(__dirname, "../app/data/jomi_lines.json");
const DATA = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const fresh = () => { delete require.cache[require.resolve("../app/domain/jomilines.js")]; return require("../app/domain/jomilines.js"); };
const ALL = DATA.records.flatMap((r) => r.variants.map((t) => ({ id: r.id, intent: r.intent, t })));

const BRANDS = /블리비|쁨|톡스앤필|리엔장|포에버|밴스|유앤아이|데이뷰|닥터에버스|셀린/;
const MEDICAL = /진단해|처방|추천(?!을 하지|은 하지|하지 않)|효과|부작용|보장|용량을?\s*(추천|권장)|최저가/;
const LOOKS = /예뻐|못생|날씬|뚱뚱|살\s*빼|동안 피부|늙어/;
const MONEY = /\d[\d,]*\s*원|%/;
const POLITE = /(요|니다|세요)[.!?…~]*$/;
const norm = (t) => t.replace(/[\s.,!?…~'"()·:]/g, "");

test("count: at least 2,000 lines in the data file (variants, not combinations), reported by stats()", () => {
  assert.ok(ALL.length >= 2000, `${ALL.length}`);
  const L = fresh();
  L.load(DATA);
  const st = L.stats();
  assert.ok(st.variants >= 2000 && st.records > 50 && st.intents >= 25, JSON.stringify(st));
});

test("copy rules: short, no money / medical / looks / clinic names, 반말 endings", () => {
  const bad = ALL.filter(({ t }) => t.length > 60 || MONEY.test(t) || MEDICAL.test(t) || LOOKS.test(t) || BRANDS.test(t) || POLITE.test(t));
  assert.deepEqual(bad.map((x) => `${x.id}: ${x.t}`), []);
});

test("no line twice anywhere, no near-copies within one record", () => {
  const seen = new Map(), dup = [];
  for (const x of ALL) { const k = norm(x.t); if (seen.has(k)) dup.push(`${x.id} = ${seen.get(k)}: ${x.t}`); else seen.set(k, x.id); }
  assert.deepEqual(dup, []);
  // near-copy: one line equals another with a single short word added or removed (edit distance ≤ 2 on 12+ characters)
  const ed = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const near = [];
  for (const r of DATA.records) {
    const vs = r.variants.map(norm);
    for (let i = 0; i < vs.length; i++) for (let j = 0; j < i; j++) if (vs[i].length >= 12 && Math.abs(vs[i].length - vs[j].length) <= 2 && ed(vs[i], vs[j]) <= 2) near.push(`${r.id}: ${r.variants[j]} ~ ${r.variants[i]}`);
  }
  assert.deepEqual(near, []);
});

test("every situation the app asks for has lines once the file is loaded", () => {
  const app = ["app/app.js", "app/core.js", "app/screens/ops.js", "app/screens/about.js", "app/screens/concern.js", "app/screens/map.js", "app/screens/branch.js", "app/screens/me.js", "app/screens/explore.js", "app/screens/change.js", "app/screens/quick.js"].map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");
  const used = new Set([...app.matchAll(/jline\(\s*"([A-Za-z]+)"/g)].map((m) => m[1]));
  ["tip", "cheer"].forEach((x) => used.add(x));     // the sheet picks one of the two
  const L = fresh(); L.load(DATA);
  const have = new Set(L.RECORDS.map((r) => r.intent));
  assert.deepEqual([...used].filter((i) => !have.has(i)), []);
  assert.ok(used.size >= 20, [...used].join(","));
});

test("loading keeps the fixed safety lines exactly; a broken file changes nothing", () => {
  const L = fresh();
  const before = L.RECORDS.filter((r) => r.fixed).map((r) => r.variants.join("|"));
  assert.equal(L.load({ records: [{ id: "x", intent: "home", variants: ["10,000원이면 돼!"] }] }), 0, "a line with an amount is refused");
  assert.equal(L.load(null), 0);
  assert.equal(L.load(DATA), DATA.records.length);
  assert.deepEqual(L.RECORDS.filter((r) => r.fixed).map((r) => r.variants.join("|")), before);
  assert.equal(L.pick("doesNot").text, "나는 의료진이 아니라서 진단이나 시술 추천은 하지 않아. 정보만 정리해 줄게.");
});

test("conditions: weekday / season lines only when the day fits; return greetings come from one pool; first visit wins", () => {
  const L = fresh(); L.load(DATA);
  const ids = (ctx) => new Set(Array.from({ length: 300 }, () => L.pick("home", ctx).id.split("#")[0]));
  const sat = ids({ visits: 3, hour: 10, dow: 6, month: 1 });
  assert.ok(sat.has("home.weekend") && sat.has("home.winter") && sat.has("home.morning") && sat.has("home.back"), [...sat].join(","));
  assert.ok(!sat.has("home.monday") && !sat.has("home.summer") && !sat.has("home.night"));
  const noDay = ids({ visits: 3, hour: 23 });
  assert.ok(!noDay.has("home.weekend") && !noDay.has("home.winter"), "no dow / month given → those records stay out");
  assert.match(L.pick("home", { visits: 1, hour: 10, dow: 6, month: 1 }).id, /^home\.first/);
  assert.match(L.pick("error", { offline: true }).id, /^offline/);
  const winter = ids({ visits: 3, hour: 14, dow: 3, month: 12 });
  assert.ok(winter.has("home.winter") && !winter.has("home.autumn"), "[12, 2] wraps over the new year");
});
