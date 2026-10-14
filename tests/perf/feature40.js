// 4.0 feature cost (docs/PERFORMANCE_REPORT.md): how long the new screens take to draw on a phone-like CPU (4x slower via
// CDP), median of RUNS: compare with a mixed-device group + easy steps (X35), a family with many options (X24), the first
// search that builds the product index ('아포지'), the cart with the A–D visit plans, and the ops screen. Lab numbers only.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/perf/feature40.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const RUNS = +(process.env.RUNS || 5), CPU = +(process.env.CPU || 4);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const STEPS = [
  ['비교: 장비 섞인 묶음(X35) + 쉬운 보기', 'compare?k=X35', '#clinics .prodmix'],
  ['비교: 옵션 많은 제품군(X24)', 'compare?k=X24', '.vsteps'],
  ['검색 "아포지"(제품 색인 만들기 포함)', 'search/' + encodeURIComponent('아포지') + '?nl=0', '.card.typed'],
  ['장바구니 3개 + 방문 계획 A~D', 'cart', '.scens'],
  ['운영 현황(검토 센터 불러오기)', 'ops', '.rvq, .card .empty'],
];

(async () => {
  const b = await chromium.launch();
  const res = Object.fromEntries(STEPS.map(([n]) => [n, []]));
  let boot = [];
  for (let run = 0; run < RUNS; run++) {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', '""');
      localStorage.setItem('pc:carts', JSON.stringify([{ name: '내 장바구니', items: [{ t: 'k', k: 'X01', q: 1 }, { t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }] }])); });
    await p.reload(); await p.waitForTimeout(100);
    if (await p.locator('#gate-pad').isVisible()) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
    const t0 = Date.now();
    await p.waitForFunction(() => document.querySelector('#main') && !document.querySelector('#main').hasAttribute('aria-busy') && document.querySelector('#main .card'), null, { timeout: 60000 });
    boot.push(Date.now() - t0);
    for (const [n, hash, sel] of STEPS) {
      await p.evaluate(() => { location.hash = '#me'; }); await p.waitForTimeout(300);
      const ms = await p.evaluate(async ([hash, sel]) => { const s = performance.now(); location.hash = '#' + hash;
        for (let i = 0; i < 400; i++) { if (document.querySelector(sel)) return performance.now() - s; await new Promise((r) => setTimeout(r, 10)); } return -1; }, [hash, sel]);
      res[n].push(ms);
    }
    await ctx.close();
  }
  console.log(`CPU ${CPU}x slower · ${RUNS} runs · median`);
  console.log(`PIN 뒤 첫 화면(데이터 받기·정리 포함, 로컬 서버): ${med(boot)} ms`);
  for (const [n] of STEPS) console.log(`${n}: ${Math.round(med(res[n]))} ms (min ${Math.round(Math.min(...res[n]))}, max ${Math.round(Math.max(...res[n]))})`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
