// Round-2 before/after performance (docs/PERFORMANCE.md): the same scenarios on two builds, same machine, same throttling,
// N runs each, service worker ON. Lab numbers (Chromium emulation), not field data from real phones.
//   first   — first visit: PIN typed at once → home prices shown; bytes transferred until the network is idle (incl. SW install)
//   revisit — second visit with the service worker and the saved price copy → home prices shown
//   stalled — revisit while data-meta.json does not answer for 30 s (round-2 R09) → home prices shown (capped at 40 s)
//   search  — first search after the home screen (#search/보톡스) → results drawn; long-task ms during it
// Usage: node tests/perf/gzserve.js <oldApp> 8771 & node tests/perf/gzserve.js app 8772 &
//        APP_PIN=<pin> A=http://localhost:8771/ B=http://localhost:8772/ RUNS=5 node tests/perf/compare_r2.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const PIN = process.env.APP_PIN; if (!PIN) { console.error('APP_PIN'); process.exit(2); }
const RUNS = +(process.env.RUNS || 5);
const NET = { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 }, CPU = 4;
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { median: s[Math.floor(s.length / 2)], slowest: s[s.length - 1], runs: s }; };

async function session(b, base, fn) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', NET); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  let bytes = 0; cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
  // the service worker's own fetches are not page requests: count them through the SW target too
  ctx.on('serviceworker', async (w) => { try { const s = await ctx.newCDPSession(w); await s.send('Network.enable'); s.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; }); } catch (e) { /* not supported */ } });
  try { return await fn(p, () => bytes, cdp); } finally { await ctx.close(); }
}
// the PIN screen shows only when this tab is locked (sessionStorage): a revisit in the same tab goes straight to the app
const unlock = async (p) => { if (!(await p.locator('#gate-pad').isVisible().catch(() => false))) return; for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`, { timeout: 5000 }); };
const longTasks = (p) => p.evaluate(() => { window.__lt = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask' }); });

async function measure(b, base) {
  const out = { first: [], bytes: [], revisit: [], stalled: [], search: [], searchLT: [] };
  for (let i = 0; i < RUNS; i++) {
    await session(b, base, async (p, bytes) => {
      const t0 = Date.now(); await p.goto(base, { waitUntil: 'commit' });
      await p.waitForSelector('#gate-pad', { timeout: 60000 }); await unlock(p); await p.waitForSelector('.pc', { timeout: 120000 }); out.first.push(Date.now() - t0);
      await p.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(1500);
      out.bytes.push(bytes());
      // first search
      await longTasks(p);
      const t1 = Date.now(); await p.goto(base + '#search/' + encodeURIComponent('보톡스'));
      await p.waitForFunction(() => /종류|가격/.test((document.querySelector('#main') || {}).innerText || ''), null, { timeout: 60000 });
      out.search.push(Date.now() - t1); out.searchLT.push(Math.round(await p.evaluate(() => window.__lt || 0)));
      // revisit (same browser context: service worker + saved copy)
      await p.goto(base + '#home');
      const t2 = Date.now(); await p.reload({ waitUntil: 'commit' }); await unlock(p).catch(() => {}); await p.waitForSelector('.pc', { timeout: 120000 }); out.revisit.push(Date.now() - t2);
      // revisit with a stalled version check
      await p.route('**/data-meta.json', (r) => setTimeout(() => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }).catch(() => {}), 30000));
      const t3 = Date.now(); await p.reload({ waitUntil: 'commit' }); await unlock(p).catch(() => {});
      const ok = await p.waitForSelector('.pc', { timeout: 40000 }).then(() => true).catch(() => false);
      out.stalled.push(ok ? Date.now() - t3 : 40000);
    });
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, stat(v)]));
}

(async () => {
  const b = await chromium.launch();
  const res = {};
  for (const [name, base] of [['before', process.env.A], ['after', process.env.B]]) if (base) res[name] = await measure(b, base);
  await b.close();
  console.log(JSON.stringify({ conditions: { network: '1.6 Mbps down / 150 ms RTT', cpu: `${CPU}x slower`, viewport: '390x844 mobile', serviceWorker: 'on', runs: RUNS, browser: 'Chromium (Playwright)' }, ...res }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
