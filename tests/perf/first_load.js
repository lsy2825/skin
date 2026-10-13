// First-load measurement in Chromium (lab, not field data): FCP, LCP, CLS, long tasks and transferred bytes of the
// PIN screen, then how long until the home screen shows prices when the PIN is typed right away.
// Profiles: 'slow4g' = the Lighthouse mobile preset (150 ms RTT, 1.6 Mbps down, 750 kbps up, CPU 4x slower), 'fast' = no throttling.
// Serve app/ gzipped like GitHub Pages (tests/perf/gzserve.js), then:
//   node tests/perf/gzserve.js app 8770 &   APP_PIN=<pin> BASE=http://localhost:8770/ node tests/perf/first_load.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8770/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const PROFILES = {
  slow4g: { net: { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 }, cpu: 4 },
  fast: { net: null, cpu: 1 },
};
const RUNS = +(process.env.RUNS || 3);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function once(b, prof, warm) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.addInitScript(() => {
    window.__m = { lcp: 0, cls: 0, lt: 0, ltn: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__m.lt += Math.max(0, e.duration - 50); window.__m.ltn++; } }).observe({ type: 'longtask', buffered: true });
  });
  if (warm) {   // a first visit fills the browser cache and lets the service worker install
    await p.goto(BASE); await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1500);
  }
  const cdp = await ctx.newCDPSession(p);
  if (prof.net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', prof.net); }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
  const t0 = Date.now();
  await p.goto(BASE, { waitUntil: 'commit' });
  await p.waitForSelector('#gate-pad button[data-d="1"]', { state: 'visible' });
  const gateAt = Date.now() - t0;
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('.pc', { timeout: 120000 });
  const homeAt = Date.now() - t0;
  await p.waitForTimeout(800);
  const m = await p.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0], res = performance.getEntriesByType('resource');
    const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0;
    const data = res.find((r) => /data\.json/.test(r.name));
    return { fcp, lcp: window.__m.lcp, cls: window.__m.cls, tbt: window.__m.lt, longtasks: window.__m.ltn,
      bytes: (nav.transferSize || 0) + res.reduce((s, r) => s + (r.transferSize || 0), 0), requests: res.length + 1,
      dataBytes: data ? data.transferSize : 0, dataDecoded: data ? data.decodedBodySize : 0, dataEnd: data ? data.responseEnd : 0 };
  });
  await ctx.close();
  return { ...m, gateAt, homeAt };
}

(async () => {
  const b = await chromium.launch();
  const out = {};
  for (const [name, prof] of Object.entries(PROFILES)) for (const warm of [false, true]) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await once(b, prof, warm));
    const k = `${name} ${warm ? '재방문' : '첫 방문'}`;
    out[k] = Object.fromEntries(Object.keys(runs[0]).map((f) => [f, med(runs.map((r) => r[f]))]));
    const r = out[k];
    console.log(`${k.padEnd(14)} | FCP ${Math.round(r.fcp)}ms | LCP ${Math.round(r.lcp)}ms | CLS ${r.cls.toFixed(3)} | TBT≈${Math.round(r.tbt)}ms (${r.longtasks}) | 비밀번호 화면 ${r.gateAt}ms | 가격이 보이기까지 ${r.homeAt}ms | 전송 ${(r.bytes / 1024).toFixed(0)}KB / ${r.requests}요청 | data.json ${(r.dataBytes / 1024).toFixed(0)}KB(압축) ${(r.dataDecoded / 1048576).toFixed(2)}MB(원본) 도착 ${Math.round(r.dataEnd)}ms`);
  }
  if (process.env.OUT) require('fs').writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
  await b.close();
})();
