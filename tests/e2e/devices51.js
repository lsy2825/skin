// 5.1 기기 매트릭스(Chromium 기기 에뮬레이션 — 실제 휴대폰·Safari·Firefox가 아님): 대표 화면 크기 6개에서 주요 화면이 가로로 넘치지 않고,
// 스크립트 오류 없이 그려지는지. 실제 iOS Safari(WebKit)·Firefox는 이 환경에 없어서 확인하지 못해요.
// Usage: python3 -m http.server 8766 --directory app & then APP_PIN=<pin> node tests/e2e/devices51.js
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 300)}`); };
const DEV = [['iPhone SE', devices['iPhone SE']], ['iPhone 14', devices['iPhone 14']], ['Pixel 7', devices['Pixel 7']], ['Galaxy S8 (360)', devices['Galaxy S8']],
  ['iPad Mini', devices['iPad Mini']], ['Desktop 1280', { viewport: { width: 1280, height: 800 } }]];
const SCREENS = ['home', 'explore', 'compare?k=X24', 'cart', 'me', 'ops'];

(async () => {
  const b = await chromium.launch();
  for (const [name, d] of DEV) {
    const { defaultBrowserType, ...opts } = d;                      // Chromium only: WebKit device presets are emulated in Chromium
    const ctx = await b.newContext({ ...opts, serviceWorkers: 'block' });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', '""'); }); await p.reload(); await p.waitForTimeout(200);
    if (await p.locator('#gate-pad').isVisible()) for (const c of PIN) await p.click(`#gate-pad button[data-d="${c}"]`);
    await p.waitForFunction(() => !document.querySelector('#main').hasAttribute('aria-busy'), null, { timeout: 30000 });
    const over = [];
    for (const s of SCREENS) {
      await p.goto(BASE + '#' + s); await p.waitForTimeout(500);
      const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, document.querySelector('#main').innerText.length]);
      if (w[0] > w[1] + 1 || w[2] < 20) over.push(`${s}:${w.join('/')}`);
    }
    ok(`D ${name} (${opts.viewport.width}px): ${SCREENS.length}개 화면 가로 넘침 없음·내용 있음`, over.length === 0, over.join(' '));
    ok(`D ${name}: 스크립트 오류 없음`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  const pass = R.filter(Boolean).length; console.log(`\n${pass}/${R.length} passed (Chromium emulation only)`); process.exit(pass === R.length ? 0 : 1);
})();
