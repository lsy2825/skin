// The '평일 낮' condition tag on screen (2026-10-15, C1b: the tag now also marks 해피아워·화수목·'평일 한정' prices): its badge reads
// '평일·시간 한정' (Pricing.condLabel; the tag id in data.json stays '평일 낮'), the legend, data notes, visit-date sheet and
// price sheet use the same words, and the visit date still filters these rows: weekend → '방문일엔 안 됨', a weekday → valid,
// a weekday with a time the app can't check → '시간 확인 필요', unless the name says the hour does not matter ('시간 상관 없이').
// Works with data.json from before C1b too (fewer such rows).
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/cond_badge.js
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const asRows = require('./rows');
const { KR_HOLIDAYS } = require(path.join(__dirname, '../../app/domain/pricing.js'));
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const LABEL = '평일·시간 한정';
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// the next day (from tomorrow) with this weekday that is not a public holiday
const nextDay = (dow) => { const d = new Date(); for (let i = 1; i < 15; i++) { d.setDate(d.getDate() + 1); if (d.getDay() === dow && !KR_HOLIDAYS[ymd(d)]) return ymd(d); } return null; };

(async () => {
  // a live '평일 낮' row without an hour in its name (so no '…시 이전' cutoff); a happy-hour one when the data has it
  const D = asRows(await (await fetch(BASE + 'data.json')).json()), S = D.s, td = ymd(new Date());
  const cand = D.rows.map((r, i) => ({ r, i })).filter(({ r }) => (S[r[6]] || '').split('·').includes('평일 낮') && !/\d\s*시/.test(S[r[2]]) && !r[13]
    && !(/^\d{4}-\d{2}-\d{2}$/.test(S[r[10]] || '') && S[r[10]] < td));
  ok('데이터에 평일 낮 태그 가격이 있음', cand.length > 0, `${cand.length}개`);
  if (!cand.length) { console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); process.exitCode = 1; return; }
  // the time check needs a name that does not say 'any hour'; such a row ('[화수목 해피아워] 시간 상관 없이 …') is checked on its own
  const ANY_TIME = /시간\s*(상관\s*(없이|없음|없는)|무관)/;
  const timed = cand.filter(({ r }) => !ANY_TIME.test(S[r[2]]));
  const pick = timed.find(({ r }) => /해피\s*아워/.test(S[r[2]])) || timed[0] || cand[0];
  const anyTime = cand.find(({ r }) => ANY_TIME.test(S[r[2]]));
  const b = pick.r[0], name = S[pick.r[2]];
  console.log(`row: ${name} @ branch ${b} · tags ${S[pick.r[6]]}`);

  const br = await chromium.launch();
  const ctx = await br.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('')); /* '' = 전국 */ }); await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');

  // the row on its branch page, found with the branch search; returns the badge texts and titles of the first matching line
  const rowBadges = async (b_ = b, name_ = name) => {
    const b = b_, name = name_;
    await p.goto(BASE + `#branch/${b}`); await p.waitForSelector('input[aria-label="이 지점에서 시술 찾기"]');
    await p.fill('input[aria-label="이 지점에서 시술 찾기"]', name); await p.waitForTimeout(300);
    return p.$$eval('#main .card.flush li .item', (its, n) => {
      const it = its.filter((x) => x.querySelector('.t') && x.querySelector('.t').textContent === n)
        .find((x) => [...x.querySelectorAll('.k.kt')].some((k) => k.textContent === '평일·시간 한정')) || null;
      return it ? [...it.querySelectorAll('.k')].map((k) => [k.textContent, k.getAttribute('title') || '']) : null;
    }, name);
  };
  let bad = await rowBadges();
  ok('지점 가격표: 평일 낮 태그는 \'평일·시간 한정\' 배지', !!bad, bad ? bad.map((x) => x[0]).join(',') : '배지 없음');
  ok('배지 설명(title)에 해피아워·화수목', !!bad && bad.some(([t, ti]) => t === LABEL && /해피아워/.test(ti) && /화수목/.test(ti)));
  ok('화면 어디에도 옛 배지 \'평일 낮\' 없음', await p.$$eval('.k', (ks) => !ks.some((k) => k.textContent === '평일 낮')));

  // price sheet: the condition line is '요일·시간 조건' (not '평일 낮 조건')
  await p.locator('#main .card.flush li .item', { hasText: name }).filter({ has: p.locator('.k.kt', { hasText: LABEL }) }).first()
    .locator('button.linkbtn').first().click();
  await p.waitForSelector('.sheet[aria-label="가격 확인"]');
  const sheetTxt = await p.locator('.sheet[aria-label="가격 확인"]').textContent();
  ok('가격 확인: 조건에 \'요일·시간 조건\'', sheetTxt.includes('요일·시간 조건') && !sheetTxt.includes('평일 낮 조건'));
  ok('가격 확인: 배지도 \'평일·시간 한정\'', await p.locator('.sheet[aria-label="가격 확인"] .k.kt', { hasText: LABEL }).count() > 0);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  // legend (데이터 상태와 출처) and data notes (마이 → 데이터 안내)
  await p.goto(BASE + '#about'); await p.waitForTimeout(400);
  const about = await p.locator('#main').textContent();
  ok('가격 종류 설명: \'평일·시간 한정 등\'', await p.locator('#main dl.kv .k.kt', { hasText: `${LABEL} 등` }).count() === 1 && !about.includes('평일 낮 등'));
  ok('설명에 해피아워·화수목 예', about.includes('평일 낮·해피아워·화수목처럼 그 시간·요일에만 되는 가격'));
  await p.goto(BASE + '#me'); await p.waitForTimeout(400);
  const me = await p.locator('#main').textContent();
  ok('마이 → 데이터 안내 문장도 새 이름', me.includes(`'${LABEL}'(평일 낮·해피아워·화수목 등)`) && !me.includes("'평일 낮', '일요일'"));

  // visit-date sheet (비교 화면의 방문일 칩): the explanation, the weekend line, then the filter itself
  const sat = nextDay(6), wed = nextDay(3);
  const openWhen = async () => { await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(500);
    await p.locator('#main button.chip', { hasText: '방문' }).first().click(); await p.waitForSelector('.sheet[aria-label="언제 갈 거예요?"]'); return p.locator('.sheet[aria-label="언제 갈 거예요?"]'); };
  let sh = await openWhen();
  const intro = await sh.locator('.sub').first().textContent();
  ok('방문일 안내: 새 이름과 화수목 확인 안내', intro.startsWith(`${LABEL}, 일요일처럼`) && intro.includes('화수목') && !intro.includes('평일 낮'), intro);
  await sh.locator('input[type="date"]').fill(sat); await p.waitForTimeout(100);
  const info = await sh.locator('.sub').nth(1).textContent();
  ok('토요일을 고르면 \'주말 — 평일·시간 한정 가격은 빠져요\'', info.includes(`주말 — ${LABEL} 가격은 빠져요`), `${sat} ${info}`);
  await sh.locator('button', { hasText: '적용' }).click(); await p.waitForTimeout(400);
  bad = await rowBadges();
  ok('토요일 방문: 그 가격에 \'방문일엔 안 됨\'', !!bad && bad.some(([t]) => t === '방문일엔 안 됨'), bad ? bad.map((x) => x[0]).join(',') : '');

  sh = await openWhen();
  await sh.locator('input[type="date"]').fill(wed); await sh.locator('select[aria-label="방문 시간"]').selectOption(''); await p.waitForTimeout(100);
  await sh.locator('button', { hasText: '적용' }).click(); await p.waitForTimeout(400);
  bad = await rowBadges();
  ok('수요일 방문(시간 상관없음): 걸리지 않음', !!bad && !bad.some(([t]) => t === '방문일엔 안 됨' || t === '시간 확인 필요'), bad ? bad.map((x) => x[0]).join(',') : '');

  sh = await openWhen();
  await sh.locator('input[type="date"]').fill(wed); await sh.locator('select[aria-label="방문 시간"]').selectOption('11:00'); await p.waitForTimeout(100);
  await sh.locator('button', { hasText: '적용' }).click(); await p.waitForTimeout(400);
  bad = await rowBadges();
  const unclear = bad && bad.find(([t]) => t === '시간 확인 필요');
  ok('수요일 11:00 방문: 이름에 시간이 없으면 \'시간 확인 필요\'', !!unclear && !bad.some(([t]) => t === '방문일엔 안 됨'), bad ? bad.map((x) => x[0]).join(',') : '');
  ok('\'시간 확인 필요\' 설명은 앱이 모른다는 뜻', !!unclear && unclear[1].includes('앱이 알지 못해요'), unclear ? unclear[1] : '');
  if (anyTime) {
    const ab = await rowBadges(anyTime.r[0], S[anyTime.r[2]]);
    ok('수요일 11:00 방문: 이름이 \'시간 상관 없이\'면 시간 확인 필요 없음', !!ab && !ab.some(([t]) => t === '시간 확인 필요' || t === '방문일엔 안 됨'), `${S[anyTime.r[2]]} | ${ab ? ab.map((x) => x[0]).join(',') : '(없음)'}`);
  } else console.log('SKIP | 이름에 \'시간 상관 없이\'가 있는 평일 낮 가격이 이 자료엔 없음');
  // 내 견적 경고와 복사 문구도 같은 말(예전 '시간대 미표기'는 사이트에 시간이 있어도 나와 틀린 말)
  ok('앱 문구에 \'시간대 미표기\' 없음', !(await (await fetch(BASE + 'app.js')).text()).includes('미표기'));

  ok('스크립트 오류 없음', !errs.length, errs.join(' '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await br.close(); process.exitCode = R.every(Boolean) ? 0 : 1;
})();
