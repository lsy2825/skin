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

test("eligibility: a revisit price (C #111) says '재방문' where others say '첫 방문'", () => {
  const e = Spec.eligibility({ name: "★재방문 이벤트★ 물톡스 1회", kind: 2, tags: [], vat: 2, until: "9999-12-31", today: "2026-10-19", conds: [], revisit: true });
  assert.equal(get(e, "재방문").state, "limit");
  assert.equal(get(e, "재방문").v.split(" — ")[0], "다시 오는 손님만");
  assert.equal(get(e, "첫 방문"), undefined, "no '첫 방문: 표기 없음 — 재방문도 되는지 확인' on a revisit price");
  assert.equal(get(e, "체험 가격").v, "한정가 — 기간·수량·조건이 붙어요");
  assert.equal(get(Spec.eligibility({ name: "★재방문 이벤트★ 물톡스 1회", kind: 2 }), "첫 방문").state, "unknown", "without the flag: as before");
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

test("a new device's '신규 런칭·입고·도입' is not a first-visit price (C #99, build2/clean.py NEW_ITEM)", () => {
  const first = (name, tags = []) => Spec.eligibility({ name, tags }).find((x) => x.k === "첫 방문").state;
  assert.equal(first("덴서티리프팅 알파팁 신규런칭 300샷"), "unknown");
  assert.equal(first("NMN X 나드샷 신규 런칭 1회"), "unknown");
  for (const w of ["입고", "도입", "오픈", "출시"]) assert.equal(first(`울쎄라 신규 ${w} 기념 300샷`), "unknown", w);
  assert.equal(first("신규 고객 리쥬란 2cc"), "limit");                       // a new customer still is
  assert.equal(first("첫방문 아쿠아필 1회"), "limit");
  assert.equal(first("신규런칭 기념 · 첫 방문 아쿠아필", []), "limit");       // both: the first-visit words stay
  assert.equal(first("알파팁 신규런칭", ["첫 방문"]), "limit");               // the build's tag still decides
  assert.equal(Spec.dropNewItem("A 신규 런칭 B 신규출시 C"), "A   B   C");
  assert.equal(Spec.dropNewItem(null), "");
});

test("kbFinder: a unique name finds its note by name first, else by fid (as before)", () => {
  const A = { id: "a", families: ["리쥬란"], fids: ["rejuran"] }, B = { id: "b", families: ["리쥬란"], fids: [] }, C = { id: "c", families: [], fids: ["toxin"] };
  const K = Spec.kbFinder([A, B, C], [{ name: "리쥬란", fid: "rejuran" }, { name: "사각턱 보톡스", fid: "toxin" }, { name: "없음", fid: "none" }]);
  assert.equal(K.of({ name: "리쥬란", fid: "other" }), A);   // the first entry naming it, whatever its fids
  assert.equal(K.of({ name: "사각턱 보톡스", fid: "toxin" }), C);
  assert.equal(K.viaName({ name: "사각턱 보톡스", fid: "toxin" }), null);
  assert.equal(K.of({ name: "없음", fid: "none" }), null);
  assert.equal(K.shared({ name: "리쥬란" }), false);
});

test("kbFinder: a name shared by families in different categories needs the entry's fids (C #114, 에어녹스 ×3)", () => {
  const fams = [{ name: "에어녹스", fid: "airnox-face", cat: "윤곽·필러" }, { name: "에어녹스", fid: "airnox-lift", cat: "리프팅" }, { name: "에어녹스", fid: "generic", cat: "기타" }];
  const LIFT = { id: "lift", families: ["에어녹스"], fids: ["airnox-lift"] }, FACE = { id: "face", families: ["에어녹스"], fids: ["airnox-face"] };
  const K = Spec.kbFinder([LIFT, FACE], fams);
  assert.equal(K.shared(fams[0]), true);
  assert.equal(K.of(fams[1]), LIFT);
  assert.equal(K.of(fams[0]), FACE);            // not LIFT, the first entry with the name
  assert.equal(K.of(fams[2]), null);            // no entry names its fid: no note rather than another family's
  // an entry that names no fids means every family with that name
  const ALL = { id: "all", families: ["에어녹스"], fids: [] };
  const K2 = Spec.kbFinder([ALL], fams);
  assert.deepEqual(fams.map((f) => K2.of(f)), [ALL, ALL, ALL]);
  // the old rule (first entry with the name) would have given LIFT to all three
  assert.notDeepEqual(fams.map((f) => K.of(f)), [LIFT, LIFT, LIFT]);
});

test("kbFinder: real data — every family's note is one that names it or its fid; shared names never borrow another fid's note", () => {
  const fs = require("node:fs"), path = require("node:path");
  const D = JSON.parse(fs.readFileSync(path.join(__dirname, "../app/data.json"), "utf8"));
  const KI = new Set(D.keys.map((k) => k[0]));
  const fams = D.meta.fam.map(([name, , vs, cat, fid]) => ({ name, cat, fid: fid || "", n: vs.filter(([id]) => KI.has(id)).length })).filter((f) => f.n);
  const K = Spec.kbFinder((D.meta.kb || {}).entries || [], fams);
  for (const f of fams) {
    const e = K.of(f);
    if (!e) continue;
    assert.ok(e.families.includes(f.name) || e.fids.includes(f.fid), f.name);
    if (K.shared(f) && e.families.includes(f.name) && e.fids.length) assert.ok(e.fids.includes(f.fid), `${f.name} ${f.cat}`);
  }
});

test("shortLabel: a long name drops what it says in brackets (위계 점검 39 — '담기 · 리쥬베룩 패키지')", () => {
  assert.equal(Spec.shortLabel("리쥬베룩 패키지(리쥬란힐러 2cc + 쥬베룩 스킨 2cc + 크라이오셀)"), "리쥬베룩 패키지");
  assert.equal(Spec.shortLabel("수입 1cc (벨로테로·쥬비덤·레스틸렌)"), "수입 1cc");
  // a bracket in the middle: the spec after it stays
  assert.equal(Spec.shortLabel("울쎄라피 프라임 리프팅(고강도 집속 초음파) 300샷 + 얼굴전체 스킨보톡스"), "울쎄라피 프라임 리프팅 300샷 + 얼굴전체 스킨보톡스");
  assert.equal(Spec.shortLabel("포텐자(RF 니들 프락셔널) + 진정관리 + 팁 별도"), "포텐자 + 진정관리 + 팁 별도");
  // nested brackets go as a whole
  assert.equal(Spec.shortLabel("콜라겐 하이드로 콤플렉스(엘라비에 리투오(6cc) + 물광주사 2cc)"), "콜라겐 하이드로 콤플렉스");
});

test("shortLabel: short names, a bracket at the start and names left with nothing stay whole", () => {
  assert.equal(Spec.shortLabel("독일산(제오민) 50U"), "독일산(제오민) 50U");          // 20 characters or fewer
  assert.equal(Spec.shortLabel("국산 사각턱 보톡스 50U"), "국산 사각턱 보톡스 50U");
  assert.equal(Spec.shortLabel("(여) 겨드랑이 제모 프리미엄 1회 (아포지 플러스)"), "(여) 겨드랑이 제모 프리미엄 1회");   // who it is for stays
  assert.equal(Spec.shortLabel("(남성 전용 프리미엄 관리 프로그램 패키지 구성)"), "(남성 전용 프리미엄 관리 프로그램 패키지 구성)");
  assert.equal(Spec.shortLabel("카복시·지방분해주사 제로팻 매월 천 명의 밴스어터가 찾는 베스트셀러"), "카복시·지방분해주사 제로팻 매월 천 명의 밴스어터가 찾는 베스트셀러");   // no brackets: C's name rule (부탁)
  assert.equal(Spec.shortLabel("  리쥬란   2cc  "), "리쥬란 2cc");
  assert.equal(Spec.shortLabel(null), "");
  assert.equal(Spec.shortLabel("아주 긴 이름의 패키지 상품 하나(구성)", 40), "아주 긴 이름의 패키지 상품 하나(구성)");   // max
});

test("shortLabel: a bracket that gives the dose is the spec and stays (검토 — '(100U)' was lost)", () => {
  assert.equal(Spec.shortLabel("엘러간 서울리프팅 풀패키지 (100U)"), "엘러간 서울리프팅 풀패키지 (100U)");
  assert.equal(Spec.shortLabel("V 콜라겐 볼륨 부스터 (1병) 10cc 3회"), "V 콜라겐 볼륨 부스터 (1병) 10cc 3회");
  // an amount with its words, not a list of parts: '반병/3cc' and '반병/4cc' stay apart
  assert.equal(Spec.shortLabel("쥬베룩 스킨부스터(반병/3cc)+물광주사(1cc)+모델링팩 1회"), "쥬베룩 스킨부스터(반병/3cc)+물광주사(1cc)+모델링팩 1회");
  assert.equal(Spec.shortLabel("입술+입꼬리필러(리터치 포함 2cc) 국산 (벨로테로)"), "입술+입꼬리필러(리터치 포함 2cc) 국산");
  // the amount inside a package's parts goes with the parts
  assert.equal(Spec.shortLabel("콜라겐 하이드로 콤플렉스(엘라비에 리투오(6cc) + 물광주사 2cc) 3회"), "콜라겐 하이드로 콤플렉스 3회");
  assert.equal(Spec.shortLabel("리쥬란 HB 플러스 2cc + LDM 수분관리(6분) + 촉촉팩 (구성품 포함)"), "리쥬란 HB 플러스 2cc + LDM 수분관리(6분) + 촉촉팩");
});
