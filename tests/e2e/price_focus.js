// 가격 비교라는 앱의 목적을 화면이 잘 따르는지 재는 검사 (2026-10-15 전수 조사).
//  A) 홈 검색칸에 사람 말투로 친 질문 → 첫 화면(390×844, 스크롤 없이)에 그 시술의 가격(원)이 보이나
//     · 평가 문장: tests/fixtures/jomi_chat_eval.json의 시술·가격 의도 141문장 (죠미 평가와 같은 문장)
//  B) 화면마다 첫 화면에 가격이 몇 개 보이나, 가격 비교로 가는 길이 있나 (홈·탐색·비교·검색·가격표 …)
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/price_focus.js [--json]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const path = require('path');
const ITEMS = require(path.join(__dirname, '../fixtures/jomi_chat_eval.json')).items.filter((x) => x.intent === 'treatment' || x.intent === 'price');
const MIN_A = +(process.env.MIN_A || 95), R = [];   // 2026-10-15: 41.8% before the fix, 99.3% after — below 95% fails
const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const norm = (s) => String(s || '').toLowerCase().replace(/[\s·()\-_/]+/g, '').replace(/보톡스/g, '톡신');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE);
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForFunction(() => window.App && window.App.Data && window.App.Data.SYNC.have, null, { timeout: 60000 });
  // what a tap-free first screen shows: visible text above the fold
  const fold = () => p.evaluate(() => {
    const out = [];
    const walk = document.createTreeWalker(document.querySelector('#main'), NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      const el = n.parentElement; if (!el || !n.textContent.trim()) continue;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.bottom > 0 && r.top < innerHeight - 70 && r.width > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('details:not([open]) > :not(summary), [hidden]')) out.push(n.textContent.trim());
    }
    return out.join('\n');
  });
  // A) home box
  const res = [], fails = [];
  for (const it of ITEMS) {
    await p.evaluate(() => { location.hash = '#home'; window.scrollTo(0, 0); }); await p.waitForTimeout(250);
    const box = p.locator('#main input[type=search]').first();
    await box.fill(it.q); await box.press('Enter'); await p.waitForTimeout(700);
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(100);
    const t = await fold(), route = await p.evaluate(() => location.hash.split('?')[0]);
    // the expected treatment word near a price on the first screen
    const lines = t.split('\n'), fam = norm(it.fam);
    const nearPrice = lines.some((l, i) => norm(l).includes(fam) && lines.slice(Math.max(0, i - 2), i + 12).some((x) => /\d{1,3}(,\d{3})+원|\d+원/.test(x)));
    res.push(nearPrice);
    if (!nearPrice) fails.push(`${it.q} → ${decodeURIComponent(route)} | ${lines.slice(0, 6).join(' / ').slice(0, 140)}`);
  }
  const a = res.filter(Boolean).length;
  console.log(`A) 홈 검색 → 첫 화면에 그 시술 가격: ${a}/${res.length} = ${(100 * a / res.length).toFixed(1)}%`);
  if (process.argv.includes('--fails')) fails.forEach((f) => console.log('   ' + f));
  ok(`홈 검색 → 첫 화면 가격 ${MIN_A}% 이상`, 100 * a / res.length >= MIN_A, `${(100 * a / res.length).toFixed(1)}%`);
  // B) screens
  const SCREENS = ['home', 'explore', 'compare', 'table', 'rank', 'versus', 'change', 'guide', 'map', 'saved', 'cart', 'concern'];
  const rows = [];
  for (const s of SCREENS) {
    await p.evaluate((r) => { location.hash = '#' + r; window.scrollTo(0, 0); }, s); await p.waitForTimeout(700);
    const t = await fold();
    const prices = (t.match(/\d{1,3}(,\d{3})+원/g) || []).length;
    const toCompare = await p.evaluate(() => [...document.querySelectorAll('#main button, #main a')].some((x) => /비교|가격표|가격 보기|최저|지점별|중간값/.test(x.textContent || '')));
    rows.push({ s, prices, toCompare });
  }
  console.log('B) 화면별 첫 화면 가격 수 · 가격 비교로 가는 길');
  for (const r of rows) console.log(`   ${r.s.padEnd(8)} 가격 ${String(r.prices).padStart(2)}개 · ${r.toCompare ? '길 있음' : '길 없음'}`);
  const withPrice = rows.filter((r) => r.prices > 0).length, withPath = rows.filter((r) => r.toCompare).length;
  console.log(`   첫 화면에 가격이 보이는 화면 ${withPrice}/${rows.length} · 가격 비교로 가는 길이 있는 화면 ${withPath}/${rows.length}`);
  ok('화면 오류 없음', !errs.length, errs.slice(0, 2).join(' | '));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ a, n: res.length, rows }));
  await b.close();
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`);
  process.exit(R.every(Boolean) ? 0 : 1);
})();
