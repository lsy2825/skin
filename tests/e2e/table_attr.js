// 전체 가격표 '세부 구분' filter (원산지 · 성별 · 부위 · 등급) in a real browser: shown once the table is narrowed, each
// chip's count is the result count after picking it, one pick per group (a new pick replaces the old), groups combine,
// picks live in the address, and they come off with their chip or '모두 해제'.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/table_attr.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const num = (t) => +String(t).replace(/[^\d]/g, '');

(async () => { const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('')); /* '' = 전국 */ }); await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
  const stat = async () => num((await p.locator('.searchstat').textContent()).split('·')[0]);
  const chip = (g, n) => p.locator(`.attf [role="group"][aria-label="${g}"] .chip`, { hasText: new RegExp(`^${n} \\(`) });
  const chipN = async (g, n) => num((await chip(g, n).textContent()).replace(/^.*\(/, ''));

  await p.goto(BASE + '#table'); await p.waitForTimeout(500);
  ok('좁히기 전(전체 표)에는 세부 구분 없음', await p.locator('.attf').count() === 0);

  await p.goto(BASE + '#table?q=' + encodeURIComponent('보톡스')); await p.waitForTimeout(600);
  const groups = await p.$$eval('.attf [role="group"]', (gs) => gs.map((g) => g.getAttribute('aria-label')));
  ok('검색하면 세부 구분: 원산지·부위', groups.includes('원산지') && groups.includes('부위'), groups.join(','));
  const all = await stat();
  const nK = await chipN('원산지', '국산');
  await chip('원산지', '국산').click(); await p.waitForTimeout(500);
  ok('국산을 고르면 결과 수 = 칩의 숫자', await stat() === nK && nK > 0 && nK < all, `${all} → ${nK}`);
  ok('주소에 att=국산', decodeURIComponent(p.url()).includes('att=국산'));
  ok('고른 칩은 눌린 상태', (await chip('원산지', '국산').getAttribute('aria-pressed')) === 'true');
  const nI = await chipN('원산지', '수입');
  await chip('원산지', '수입').click(); await p.waitForTimeout(500);
  ok('같은 원산지에서 수입을 고르면 국산 대신 수입', decodeURIComponent(p.url()).includes('att=수입') && !decodeURIComponent(p.url()).includes('국산') && await stat() === nI, `${nI}`);
  await chip('원산지', '수입').click(); await p.waitForTimeout(500);
  ok('다시 누르면 해제', await stat() === all);
  await chip('원산지', '국산').click(); await p.waitForTimeout(500);
  const area = (await p.$$eval('.attf [role="group"][aria-label="부위"] .chip', (cs) => cs.map((c) => c.textContent)))[0];
  const areaName = area.replace(/ \(.*$/, ''), nA = num(area.replace(/^.*\(/, ''));
  await chip('부위', areaName).click(); await p.waitForTimeout(500);
  ok('다른 그룹(부위)은 함께 걸림: 국산 + 부위', decodeURIComponent(p.url()).includes('국산') && decodeURIComponent(p.url()).includes(areaName) && await stat() === nA && nA <= nK, `${areaName} ${nA}`);
  const names = await p.$$eval('#main .card.flush li .t', (ts) => ts.map((t) => t.textContent));
  ok('결과 상품명에 독일산·수입 표기 없음(국산만)', names.length > 0 && !names.some((n) => /독일산|수입/.test(n)), names.slice(0, 3).join(' / '));
  await p.locator('.chip.on', { hasText: areaName }).click(); await p.waitForTimeout(500);
  ok('위쪽 선택 칩으로 하나만 해제', decodeURIComponent(p.url()).includes('국산') && !decodeURIComponent(p.url()).includes(areaName) && await stat() === nK);
  await p.locator('.chip', { hasText: '모두 해제' }).click(); await p.waitForTimeout(500);
  ok('모두 해제하면 세부 구분도 풀림', !p.url().includes('att=') && await stat() === all);
  // an address with a word that is not an attribute is ignored, not an error
  await p.goto(BASE + '#table?q=' + encodeURIComponent('보톡스') + '&att=' + encodeURIComponent('<b>x</b>,국산')); await p.waitForTimeout(600);
  ok('주소의 모르는 값은 무시', await stat() === nK);
  ok('스크립트 오류 없음', !errs.length, errs.join(' '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
