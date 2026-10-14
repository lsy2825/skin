// app/domain/spec.js: what a clinic's option name says about the treatment (unknown stays unknown) and its conditions
const test = require("node:test");
const assert = require("node:assert/strict");
const Spec = require("../app/domain/spec.js");
const get = (out, k) => out.find((x) => x.k === k);

test("parse: product, origin, grade, dose, sessions, area from the name", () => {
  const o = Spec.parse("주름보톡스(국산 고순도) 제오민 이마 50U 3회", { family: "주름 보톡스", sess: 3 });
  assert.equal(get(o, "시술").v, "주름 보톡스");
  assert.equal(get(o, "제품·장비").v, "제오민");
  assert.equal(get(o, "원산지").v, "국산");
  assert.equal(get(o, "등급(병원 표기)").v, "고순도");
  assert.equal(get(o, "용량").v, "50U(유닛)");
  assert.equal(get(o, "횟수").v, "3회 묶음");
  assert.equal(get(o, "부위").v, "이마");
});

test("parse: what the name does not say is unknown, not guessed", () => {
  const o = Spec.parse("물광주사 체험가", {});
  assert.equal(get(o, "제품·장비").state, "unknown");
  assert.equal(get(o, "원산지").state, "unknown");
  assert.equal(get(o, "용량·샷 수").state, "unknown");
  assert.equal(get(o, "부위").state, "unknown");
  assert.equal(get(o, "횟수").state, "assumed");     // no '회' in the name: read as one session, and said so
  assert.equal(get(o, "등급(병원 표기)"), undefined);  // optional fields are left out, not invented
});

test("parse: shots, cc, threads, sex; '보톡스' alone is not a product", () => {
  assert.equal(get(Spec.parse("슈링크 유니버스 리프팅 300샷", {}), "샷 수").v, "300샷");
  assert.equal(get(Spec.parse("슈링크 유니버스 리프팅 300샷", {}), "제품·장비").v, "슈링크");
  assert.equal(get(Spec.parse("리쥬란힐러 2cc", {}), "용량").v, "2cc");
  assert.equal(get(Spec.parse("민트실 리프팅 10줄", {}), "실 개수").v, "10줄");
  assert.equal(get(Spec.parse("써마지 FLX 600샷 (30만 줄)", {}), "샷 수").v, "600샷");
  assert.equal(get(Spec.parse("(남자) 겨드랑이 제모(아포지 플러스)", {}), "성별").v, "남성");
  assert.equal(get(Spec.parse("주름보톡스 1부위", {}), "제품·장비").state, "unknown");
});

test("diff: only fields both sides state, and that differ", () => {
  const a = Spec.parse("주름보톡스(국산) 50U", { label: "국산 50U" }), b = Spec.parse("주름보톡스(국산) 100U", { label: "국산 100U" });
  assert.deepEqual(Spec.diff(a, b), [{ k: "용량", a: "50U(유닛)", b: "100U(유닛)" }]);
  assert.deepEqual(Spec.diff(a, Spec.parse("주름보톡스 체험가", {})), []);   // the other side doesn't say: no 'difference'
});

test("eligibility: stated limits, stated none, and unknown kept apart", () => {
  const e = Spec.eligibility({ name: "[첫방문] 주름보톡스 체험가", kind: 1, tags: ["평일"], vat: 2, until: "2026-10-31", today: "2026-10-13", conds: [] });
  assert.equal(get(e, "첫 방문").state, "limit");
  assert.equal(get(e, "체험 가격").v, "체험가 — 보통 1인 1회");
  assert.equal(get(e, "부가세").state, "limit");
  assert.equal(get(e, "기간").v, "10/31까지");
  assert.equal(get(e, "그 밖의 조건").v, "평일");
  const n = Spec.eligibility({ name: "아쿠아필", kind: 0, tags: [], vat: 0, until: "", today: "2026-10-13" });
  assert.equal(get(n, "첫 방문").state, "unknown");
  assert.equal(get(n, "부가세").state, "unknown");
  assert.equal(get(n, "기간").state, "unknown");
  assert.equal(get(n, "그 밖의 조건").state, "unknown");
  assert.equal(get(Spec.eligibility({ name: "x", until: "2026-10-01", today: "2026-10-13" }), "기간").v, "10/01에 끝났어요");
  assert.equal(get(Spec.eligibility({ name: "x", until: "posted:2026-09-01" }), "기간").state, "none");
});
