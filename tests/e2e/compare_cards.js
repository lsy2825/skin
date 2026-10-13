// 시술별 비교 '카드' view in a real browser: the same clinics in the same order as the list, swipeable without widening
// the page (320 px), previous/next buttons, price evidence from a card, the choice remembered, and the neutral default
// order kept (no rank numbers, not cheapest-first).
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/compare_cards.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const num = (t) => +String(t).replace(/[^\d]/g, '');

(async () => { const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 320, height: 720 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
  await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(500);
  const listNames = await p.$$eval('#clinics li.rk .b', (xs) => xs.map((x) => x.textContent.trim()));
  const listPrices = await p.$$eval('#clinics li.rk .rank .p', (xs) => xs.map((x) => x.textContent));
  ok('처음엔 목록 보기', (await p.locator('#clinics .seg.vsw button[aria-pressed="true"]').textContent()) === '목록' && listNames.length > 5);
  await p.locator('#clinics .seg.vsw button', { hasText: '카드' }).click(); await p.waitForTimeout(400);
  const cardNames = await p.$$eval('#clinics .ccard .ccard-h b', (xs) => xs.map((x) => x.textContent.trim()));
  const cardPrices = await p.$$eval('#clinics .ccard .ccard-p', (xs) => xs.map((x) => x.childNodes[0].textContent));
  ok('카드 = 목록과 같은 지점·같은 순서', JSON.stringify(cardNames) === JSON.stringify(listNames), `${cardNames.length}장`);
  ok('카드 가격 = 목록 가격', cardPrices.length === listPrices.length && cardPrices.every((x, i) => num(x) === num(listPrices[i])));
  ok('기본 순서는 가격순 아님(지역·이름순)', !cardPrices.map(num).every((v, i, a) => !i || a[i - 1] <= v));
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok('320px에서 페이지가 옆으로 넓어지지 않음', wide <= 0, `${wide}px`);
  const sc = p.locator('#clinics .ccards');
  ok('카드 줄은 옆으로 넘길 수 있음', await sc.evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).scrollSnapType.includes('x')));
  const x0 = await sc.evaluate((e) => e.scrollLeft);
  await p.locator('#clinics button[aria-label="다음 지점"]').click(); await p.waitForTimeout(700);
  const x1 = await sc.evaluate((e) => e.scrollLeft);
  ok('다음 버튼으로 한 장 넘어감', x1 > x0, `${x0} → ${x1}`);
  await p.locator('#clinics button[aria-label="이전 지점"]').click(); await p.waitForTimeout(700);
  ok('이전 버튼으로 돌아옴', await sc.evaluate((e) => e.scrollLeft) < x1);
  await p.locator('#clinics .ccard').first().locator('button', { hasText: '가격 근거' }).click(); await p.waitForTimeout(300);
  ok('카드에서 가격 근거 열림(정품 표기·부작용 줄 포함)', /정품 표기/.test(await p.locator('.sheet').innerText()) && /부작용·주의사항/.test(await p.locator('.sheet').innerText()));
  await p.keyboard.press('Escape');
  ok('카드에 순위 번호 없음(n/N은 장 번호)', await p.locator('#clinics .ccard .rank').count() === 0 && /^1\/\d+$/.test((await p.locator('#clinics .ccard .ccard-h .tiny').first().textContent()).trim()));
  await p.reload(); await p.waitForTimeout(800);
  if (await p.locator('#gate-pad').isVisible()) { for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForTimeout(800); }
  ok('새로고침해도 카드 보기 유지', await p.locator('#clinics .ccard').count() > 0);
  await p.locator('#clinics .sortchips .chip', { hasText: '낮은 가격순' }).click(); await p.waitForTimeout(400);
  const asc = await p.$$eval('#clinics .ccard .ccard-p', (xs) => xs.map((x) => +x.childNodes[0].textContent.replace(/[^\d]/g, '')));
  ok('정렬을 바꾸면 카드 순서도 바뀜(낮은 가격순)', asc.every((v, i, a) => !i || a[i - 1] <= v));
  await p.locator('#clinics .seg.vsw button', { hasText: '목록' }).click(); await p.waitForTimeout(300);
  ok('목록으로 되돌리기', await p.locator('#clinics li.rk').count() > 0 && await p.locator('#clinics .ccard').count() === 0);
  ok('스크립트 오류 없음', !errs.length, errs.join(' '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
