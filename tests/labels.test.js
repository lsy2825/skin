// Spec labels in app/data.json (the compare tab's '규격' chips) carry no price, date, promotion words or tag marks —
// 2026-10-14: '피코토닝 20만원3921만재생' and '미백톤업색소토닝' reached the app. Same rules as build2/labels.py (which also checks
// for words we glued; tests/labels_test.py). The build drops such a label from the compare groups; this checks what ships.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "../app/data.json"), "utf8"));

const RULES = {
  가격: /\d+(?:[.,]\d+)?\s*만\s*원|\d+(?:\.\d+)?만(?!\s*[J샷줄]|[a-zA-Z가-힣])|\d{1,3}(?:,\d{3})+\s*원|(?<![\d.,])\d{4,}\s*원|만원/,
  날짜: /\d{1,2}\s*월\s*\d{1,2}\s*일|\d{2,4}\s*년\s*\d{1,2}\s*월|까지/,
  홍보: /이벤트|특가|할인|혜택|맞이|누림|기념|잔치|페스타|추천|플러스친구|카카오톡|런칭|안내|선착순|최저가/,
  기호: /[|｜※♥★☆]/,
};

for (const [name, rx] of Object.entries(RULES)) {
  test(`비교 규격 이름에 ${name} 없음`, () => {
    const bad = D.keys.filter((k) => rx.test(k[2])).map((k) => k[2]);
    assert.deepEqual(bad.slice(0, 10), [], `${bad.length}개`);
  });
}

test("규칙이 실제 사고 이름을 잡음 (규칙 자체 확인)", () => {
  assert.ok(RULES.가격.test("피코토닝 20만원3921만재생 5회"));
  assert.ok(RULES.날짜.test("레디어스 10월1일10월31일까지"));
  assert.ok(RULES.홍보.test("필로드 브랜드10주년기념무한 4cc"));
  assert.ok(RULES.기호.test("미백 | 톤업 | 색소 | 토닝 피코토닝"));
  for (const okLabel of ["바디 온다 리프팅 8만 J 3회", "(단색) 피코문신제거 500원", "국산 사각턱 보톡스 50U", "리쥬란 HB 플러스 2cc"])
    assert.ok(!Object.values(RULES).some((rx) => rx.test(okLabel)), okLabel);
});
