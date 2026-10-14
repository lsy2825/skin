// round-2 O3 in a real browser: the search index is built in a worker right after the price data is in, it is exactly
// the index the page would build itself (same names, same function), and searching with it gives results.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/o3_search.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let workerSeen = false; p.on('worker', (w) => { if (/search_index\.js/.test(w.url())) workerSeen = true; });
  await p.goto(BASE); for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForFunction(() => window.App && window.App.Data && window.App.Data.SYNC.have, null, { timeout: 60000 });
  const ready = await p.waitForFunction(() => window.App.searchReady(), null, { timeout: 30000 }).then(() => true).catch(() => false);
  ok('데이터를 받은 뒤 검색 색인이 미리 준비됨(Worker)', ready && workerSeen, `worker ${workerSeen}`);
  const same = await p.evaluate(() => {
    const A = window.App, D = A.data(), rows = A.rows(), S = D.s;
    const sids = [...new Set(rows.map((r) => r[2]))];
    const mine = window.Search.buildIndex(sids.map((i) => S[i]), [...D.keys.map((k) => k[2]), ...A.state().FAM.map((f) => f.name)]);
    return JSON.stringify(mine) === JSON.stringify(A.searchIndexData());
  });
  ok('Worker 색인 = 화면에서 직접 만든 색인(완전히 같음)', same);
  for (const q of ['리쥬란 2cc', '슈링그 300샷', '보톡스 -바디']) {
    await p.evaluate((x) => { location.hash = `#search/${encodeURIComponent(x)}?nl=0`; }, q); await p.waitForTimeout(700);
    const txt = await p.locator('#main').innerText();
    ok(`검색 '${q}' 결과가 나옴`, /\d[\d,]*개/.test(txt) && !/가격이 없어요/.test(txt), txt.split('\n').find((l) => /\d[\d,]*개/.test(l)) || '');
  }
  ok('페이지 오류 없음', !errs.length, errs.join(' | '));
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`TOTAL ${pass}/${R.length} PASS`);
  process.exit(pass === R.length ? 0 : 1);
})();
