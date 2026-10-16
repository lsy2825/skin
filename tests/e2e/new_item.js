// A new device or product ('EGF 리젠셀크림 (★신규런칭★)', '덴서티 (알파팁 신규도입)', '탄생주사 신규 런칭') is not a first-visit
// price: the '가격 확인' sheet does not say '첫 방문(신규) 조건' for it (Spec.dropNewItem, the same words as build2/clean.py NEW_ITEM,
// C #99), while a name that says a new customer ('신규 고객', '첫 방문') still does. Rows are picked from the data the app was served;
// a file without such rows prints SKIP.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/new_item.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const asRows = require('./rows');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const NEW_ITEM = /신규\s*(?:런칭|입고|도입|오픈|출시)/;
const FIRST = '첫 방문(신규) 조건';

(async () => {
  const D = asRows(await (await fetch(BASE + 'data.json')).json()), S = D.s, td = new Date().toISOString().slice(0, 10);
  const live = (r) => !r[13] && !(/^\d{4}-\d{2}-\d{2}$/.test(S[r[10]] || '') && S[r[10]] < td);
  const tagsOf = (r) => (S[r[6]] || '').split('·').filter(Boolean);
  // a new-item row without the build's '첫 방문' tag and without other first-visit words; a new-customer row for the contrast
  const rows = D.rows.filter((r) => live(r) && NEW_ITEM.test(S[r[2]]) && !tagsOf(r).includes('첫 방문') && !/첫\s*방문|웰컴|첫\s*시술|첫\s*구매/.test(S[r[2]]));
  const cust = D.rows.find((r) => live(r) && /신규\s*고객|첫\s*방문/.test(S[r[2]]) && !NEW_ITEM.test(S[r[2]]));
  console.log(`new-item rows: ${rows.length}${cust ? ` · new-customer row: ${S[cust[2]]}` : ''}`);
  if (!rows.length) { console.log('SKIP | 이름에 \'신규 런칭·도입\'이 든 줄이 이 자료엔 없음'); console.log('TOTAL 0/0 PASS'); return; }

  const br = await chromium.launch();
  const ctx = await br.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('')); }); await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
  await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });

  // the '가격 확인' sheet of the first line with this name on its branch page
  const sheetOf = async (r) => {
    const name = S[r[2]];
    await p.goto(BASE + `#branch/${r[0]}`); await p.waitForSelector('input[aria-label="이 지점에서 시술 찾기"]');
    await p.fill('input[aria-label="이 지점에서 시술 찾기"]', name); await p.waitForTimeout(300);
    const item = p.locator('#main .card.flush li .item').filter({ has: p.locator('.t', { hasText: name }) }).first();
    if (!(await item.count())) return null;
    await item.locator('button.linkbtn').first().click();
    await p.waitForSelector('.sheet[aria-label="가격 확인"]');
    const t = await p.locator('.sheet[aria-label="가격 확인"]').textContent();
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    return t;
  };
  let seen = 0;
  for (const r of rows.slice(0, 3)) {
    const t = await sheetOf(r);
    if (t == null) { console.log(`SKIP | 지점 가격표에서 줄을 찾지 못함 | ${S[r[2]]}`); continue; }
    seen++;
    ok(`새 장비·제품 줄: '${FIRST}' 없음`, !t.includes(FIRST), S[r[2]]);
  }
  ok('새 장비·제품 줄을 하나 이상 확인함', seen > 0, `${seen}/${Math.min(3, rows.length)}`);
  if (cust) {
    const t = await sheetOf(cust);
    if (t == null) console.log(`SKIP | 신규 고객 줄을 지점 가격표에서 찾지 못함 | ${S[cust[2]]}`);
    else ok(`'신규 고객'·'첫 방문' 이름은 그대로 '${FIRST}'`, t.includes(FIRST), S[cust[2]]);
  } else console.log('SKIP | 이름에 \'신규 고객\'·\'첫 방문\'이 든 줄이 이 자료엔 없음');
  ok('스크립트 오류 없음', !errs.length, errs.join(' | '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await br.close(); process.exitCode = R.every(Boolean) ? 0 : 1;
})();
