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

// spec-word notes (data.json meta.kb.specs, C7): (family id, word) → one line; drafts only when allowed, and marked
const draft = { status: "draft", reviewer: "", reviewed_at: "" }, okd = { status: "approved", reviewer: "의사 A", reviewed_at: "2026-10-20" };
const NOTES = [
  { fid: "toxin", spec: "국산", one_liner: "국내 회사가 만든 톡신이에요.", review: draft },
  { fid: "toxin", spec: "프리미엄", one_liner: "병원이 일반형과 나눠 붙이는 이름이에요.", review: draft },
  { fid: "toxin", spec: "독일산", one_liner: "주로 제오민을 이렇게 불러요.", review: okd },
  { fid: "toxin", spec: "사각턱", one_liner: "턱 양옆 씹는 근육에 놓는 보톡스예요.", review: draft },
  { fid: "toxin", spec: "스킨", one_liner: "피부 얕은 층에 놓는 보톡스예요.", review: draft },
  { fid: "rejuran", spec: "HB 플러스", one_liner: "리도카인이 섞인 리쥬란이에요.", review: draft },
  { fid: "rejuran", spec: "플러스", one_liner: "병원이 붙이는 이름이에요.", review: draft },
  { fid: "filler", spec: "코", one_liner: "코에 놓는 필러예요.", review: draft },
];

test("notesFor: (family id, word) → its line, in the order the words stand, the family name after the label", () => {
  const n = Spec.notesFor(NOTES, "toxin", ["국산 프리미엄 50U", "사각턱 보톡스"], { drafts: true });
  assert.deepEqual(n.map((x) => x.spec), ["국산", "프리미엄", "사각턱"]);
  assert.deepEqual(n[0], { spec: "국산", text: "국내 회사가 만든 톡신이에요.", draft: true });
  assert.deepEqual(Spec.notesFor(NOTES, "rejuran", ["국산 50U"], { drafts: true }), []);   // another family's words are not used
  assert.deepEqual(Spec.notesFor(NOTES, "toxin", ["국산 국산 50U", "국산"], { drafts: true }).map((x) => x.spec), ["국산"]);   // each word once
  assert.equal(Spec.notesFor(NOTES, "toxin", ["국산 프리미엄 50U", "사각턱 보톡스"], { drafts: true, max: 2 }).length, 2);
});

test("notesFor: drafts only while drafts are allowed (flags.showDraftKnowledge); reviewed lines always, unmarked", () => {
  assert.deepEqual(Spec.notesFor(NOTES, "toxin", ["국산 50U"], { drafts: false }), []);
  assert.deepEqual(Spec.notesFor(NOTES, "toxin", ["국산 50U"]), []);
  assert.deepEqual(Spec.notesFor(NOTES, "toxin", ["독일산 국산"], { drafts: false }), [{ spec: "독일산", text: "주로 제오민을 이렇게 불러요.", draft: false }]);
  assert.deepEqual(Spec.notesFor(NOTES, "toxin", ["독일산 국산"], { drafts: true }).map((x) => [x.spec, x.draft]), [["독일산", false], ["국산", true]]);
  assert.deepEqual(Spec.notesFor([{ fid: "toxin", spec: "국산", one_liner: "x" }], "toxin", ["국산"], { drafts: false }), []);   // no review = not reviewed
});

test("notesFor: whole words only, the longer word first where two overlap", () => {
  const w = (fid, t) => Spec.notesFor(NOTES, fid, [t], { drafts: true }).map((x) => x.spec);
  assert.deepEqual(w("toxin", "독일산(제오민) 50U"), ["독일산"]);      // a bracket ends the word
  assert.deepEqual(w("toxin", "스킨보톡스"), []);                     // '스킨' inside a longer word is not the word
  assert.deepEqual(w("filler", "코어 필러"), []);
  assert.deepEqual(w("filler", "코 필러"), ["코"]);
  assert.deepEqual(w("rejuran", "HB 플러스 1cc"), ["HB 플러스"]);      // not '플러스' as well
  assert.deepEqual(w("rejuran", "HB  플러스 · 플러스"), ["HB 플러스", "플러스"]);   // spaces folded; a separate '플러스' still counts
});

test("notesFor: old data without meta.kb.specs, or broken entries → nothing", () => {
  assert.deepEqual(Spec.notesFor(undefined, "toxin", ["국산"], { drafts: true }), []);
  assert.deepEqual(Spec.notesFor([], "toxin", ["국산"], { drafts: true }), []);
  assert.deepEqual(Spec.notesFor(NOTES, "", ["국산"], { drafts: true }), []);
  assert.deepEqual(Spec.notesFor([null, { fid: "toxin" }, { fid: "toxin", spec: "국산", one_liner: "" }, { fid: "toxin", spec: 3, one_liner: "x", review: okd }], "toxin", ["국산 3"], { drafts: true }), []);
  assert.deepEqual(Spec.notesFor(NOTES, "toxin", [null, undefined, ""], { drafts: true }), []);
});

test("famWords: the word a split family puts in front of its base name, also without a space", () => {
  const T = ["보톡스", "스킨보톡스", "사각턱 보톡스", "목주름 보톡스", "주름 보톡스", "목 광경근 보톡스"];
  assert.equal(Spec.famWords("스킨보톡스", T), "스킨");
  assert.equal(Spec.famWords("사각턱 보톡스", T), "사각턱");
  assert.equal(Spec.famWords("목주름 보톡스", T), "목주름");          // the shortest base ('보톡스'), not '주름 보톡스'
  assert.equal(Spec.famWords("목 광경근 보톡스", T), "목 광경근");
  assert.equal(Spec.famWords("보톡스", T), "");                       // the base family itself
  assert.equal(Spec.famWords("바디 슈링크", ["슈링크 유니버스", "바디 슈링크"]), "");
  assert.equal(Spec.famWords("", T), "");
  assert.equal(Spec.famWords("스킨보톡스", undefined), "");
  assert.equal(Spec.famWords("스킨보톡스", [null, 3, ""]), "");
  // '스킨' is not a whole word of '스킨보톡스' — found only through famWords, after the label's words
  assert.deepEqual(Spec.notesFor(NOTES, "toxin", ["국산 얼굴전체", "스킨보톡스"], { drafts: true }).map((x) => x.spec), ["국산"]);
  assert.deepEqual(Spec.notesFor(NOTES, "toxin", ["국산 얼굴전체", "스킨보톡스", Spec.famWords("스킨보톡스", T)], { drafts: true }).map((x) => x.spec), ["국산", "스킨"]);
  assert.deepEqual(Spec.notesFor(NOTES, "toxin", ["국산", "목주름 보톡스", Spec.famWords("목주름 보톡스", T)], { drafts: true }).map((x) => x.spec), ["국산"]);   // '주름' inside '목주름' stays out
});
