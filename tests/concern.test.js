// node --test — skin-concern discovery classifier (app/domain/concern.js) with the real taxonomy (knowledge/concerns.json)
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/domain/concern.js");
const cs = require("../knowledge/concerns.json");

const top = (t) => (C.classify(t, cs).matches[0] || {}).id;
const ids = (t) => C.classify(t, cs).matches.map((m) => m.id);
const levels = (t) => C.classify(t, cs).safety.map((s) => s.id);

test("everyday wording maps to the right concern", () => {
  assert.equal(top("이마랑 미간 주름이 신경 쓰여요"), "wrinkle");
  assert.equal(top("턱이 각져 보여요. 사각턱인가?"), "jaw");
  assert.equal(top("볼이 처지고 탄력이 없어요"), "sagging");
  assert.equal(top("기미랑 잡티가 많아요"), "pigment");
  assert.equal(top("점 빼고 싶어요"), "mole");
  assert.equal(top("겨드랑이 땀이 너무 많아요"), "sweat");
  assert.equal(top("팔자주름이 깊어져요"), "volume");
  assert.equal(top("얼굴이 자주 빨개지고 홍조가 있어요"), "redness");
  assert.ok(ids("여드름 흉터랑 넓은 모공").includes("scar"));
});

test("one-syllable words only as whole words (점점 is not a mole)", () => {
  assert.ok(!ids("요즘 점점 피부가 칙칙해요").includes("mole"));
  assert.equal(top("요즘 점점 피부가 칙칙해요"), "pigment");
  assert.ok(!ids("장점이 뭐예요").includes("mole"));
  assert.ok(ids("점이 많아요").includes("mole"));
});

test("every synonym finds its own concern", () => {
  for (const c of cs.concerns) for (const s of c.synonyms) assert.ok(ids(s).includes(c.id), `${s} → ${c.id}`);
});

test("warning signs come first: emergency, self-harm, urgent", () => {
  assert.deepEqual(levels("필러 맞고 나서 피부가 하얗게 변했어요"), ["emergency"]);
  assert.deepEqual(levels("보톡스 맞고 숨쉬기가 힘들어요"), ["emergency"]);
  assert.deepEqual(levels("시술 후 앞이 잘 안 보여요"), ["emergency"]);
  assert.deepEqual(levels("요즘 죽고 싶어요"), ["self_harm"]);
  assert.deepEqual(levels("점이 점점 커지고 색이 변해요"), ["urgent"]);
  assert.deepEqual(levels("시술 부위에 고름이 나요"), ["urgent"]);
  assert.deepEqual(levels("이마 주름이 고민이에요"), []);
});

test("requests for a personal decision are recognised (diagnosis, suitability, dose)", () => {
  for (const t of ["저한테 맞는 시술이 뭐예요", "보톡스 몇 유닛 맞아야 해요?", "제 피부에 뭐가 좋아요", "이거 무슨 병이에요", "기미 시술 추천해 주세요"])
    assert.equal(C.classify(t, cs).personal, true, t);
  assert.equal(C.classify("기미가 고민이에요", cs).personal, false);
});

test("unrelated text, empty text and very long text", () => {
  assert.deepEqual(C.classify("오늘 날씨 어때요", cs).matches, []);
  assert.equal(C.classify("   ", cs).empty, true);
  const long = C.classify("주름 ".repeat(200), cs);
  assert.equal(long.clipped, true);
  assert.equal(long.matches[0].id, "wrinkle");
});

test("the result holds concern ids only — no treatment ranking, no clinic", () => {
  const r = C.classify("주름이랑 기미", cs);
  for (const m of r.matches) assert.deepEqual(Object.keys(m).sort(), ["hits", "id", "score"]);
});
