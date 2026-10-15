// 죠미와 대화가 사람의 말을 알아듣는지 (app/domain/jomichat.js) — 2026-10-15 사고의 재발 방지.
// 사고: 대화 화면이 고민 낱말 사전만 알아서 "카프리" 같은 시술 이름, 가격, 앱 질문을 하나도 못 알아들었어요(평가 세트 17.7%).
// 아래 기준 밑으로 떨어지면 실패해요. 평가 세트를 바꾸면 tools/jomi_chat_eval.js로 예전·지금 점수를 다시 보고 docs/JOMI_CHAT.md를 고쳐요.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const D = require("../app/data.json");
const JC = require("../app/domain/jomichat.js");
const EV = require("../tools/jomi_chat_eval.js");
const C = JC.ctxFromData(D, "2026-10-14");
const NOW = EV.engines.find((e) => /jomichat/.test(e.name));
const ask = (q, m = JC.memory()) => JC.understand(q, C, m);

test("평가 세트(손으로 적은 215문장): 95% 이상, 의도마다 80% 이상", () => {
  const r = EV.score("now", NOW);
  assert.ok(r.pct >= 95, `${r.pct.toFixed(1)}%\n${r.fails.join("\n")}`);
  for (const [k, [o, x]] of Object.entries(r.by)) assert.ok(o / (o + x) >= 0.8, `${k} ${o}/${o + x}`);
});

test("따로 적은 문장(엔진 맞추기에 쓰지 않은 56문장): 90% 이상", () => {
  const items = require(path.join(__dirname, "fixtures/jomi_chat_holdout.json")).items;
  const r = EV.score("now", NOW, items);
  assert.ok(r.pct >= 90, `${r.pct.toFixed(1)}%\n${r.fails.join("\n")}`);
});

test("데이터의 시술 묶음 이름 전부: 이름만 물어도 97% 이상이 그 시술을 찾음", () => {
  const b = EV.famBench(NOW);
  assert.ok(b.hitName / b.n >= 0.97, `${b.hitName}/${b.n}`);
  assert.ok(b.hitPrice / b.n >= 0.97, `${b.hitPrice}/${b.n}`);
});

test("사고 문장: '카프리' → 카프리 레이저 + 모은 가격", () => {
  const r = ask("카프리");
  assert.equal(r.fams[0].name, "카프리 레이저");
  assert.ok(r.price.n > 0 && r.price.min > 0 && r.price.med >= r.price.min);
});

test("응급 신호에는 가격·시술 답이 없음 (지식 파일 패턴이 몰라도 엔진이 한 번 더 봄)", () => {
  for (const q of ["보톡스 맞고 숨이 막혀요", "필러 맞고 피부가 하얗게 변했어", "숨쉬기가 힘들어요", "시술 받고 의식이 흐려져요"]) {
    const r = ask(q);
    assert.equal(r.kind, "safety", q);
    assert.ok(!r.price && !r.fams.length, q);
  }
});

test("이어 묻기: 앞 시술 기억, 관계없는 말은 이어 붙이지 않음", () => {
  const m = JC.memory();
  ask("리쥬란 가격", m);
  const r = ask("그럼 4cc는?", m);
  assert.ok(r.followUp && /리쥬란/.test(r.key.label) && /4cc/.test(r.key.label), r.key && r.key.label);
  assert.notEqual(ask("오늘 날씨 어때요", m).kind, "price");
});

test("규격을 물었는데 그 규격이 없으면 정직하게 표시(specHonored=false)", () => {
  const r = ask("카프리 레이저 77cc 얼마");
  assert.equal(r.specHonored, false);
});

test("지역을 물으면 같은 점수의 묶음 중 그 지역에 가격이 있는 것: '홍대 제모 싼 곳' → 홍대 가격(2026-10-15 C1 데이터)", () => {
  const r = ask("홍대 제모 싼 곳");
  assert.equal(r.kind, "price");
  assert.ok(r.price && r.price.n > 0, `${r.fams.map((f) => f.name).join(", ")} — 홍대 가격 ${r.price && r.price.n}`);
});

test("답에 병원 이름을 넣지 않음(엔진 결과에 지점이 없음 — 줄 세우기는 비교 화면에서)", () => {
  const r = ask("강남 슈링크 제일 싼 곳");
  assert.equal(r.kind, "price");
  assert.deepEqual(Object.keys(r.price).sort(), ["max", "med", "min", "n"]);
});

test("한 문장 처리 20ms 이내(927개 묶음)", () => {
  const t = process.hrtime.bigint();
  for (let i = 0; i < 50; i++) ask("강남 리쥬란 2cc 제일 싼 곳 알려줘");
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / 50;
  assert.ok(ms < 20, `${ms.toFixed(1)}ms`);
});
