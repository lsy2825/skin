// WCAG 2.2 AA automated audit (axe-core) of 9 screens in light and dark mode
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> AXE=/path/to/axe-core/axe.min.js node tests/e2e/a11y.js [out-dir]
// Needs Playwright with Chromium (PLAYWRIGHT=/path/to/node_modules/playwright) and axe-core (npm i axe-core). Not part of
// `node --test`. axe finds only part of WCAG issues; keyboard, focus and touch-target checks are in ux_qa.js / touch_targets.js.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요 (예: APP_PIN=xxxx node ' + process.argv[1] + ')'); process.exit(2); }
(async () => { const OUT = process.argv[2] || require('os').tmpdir(); const axe = fs.readFileSync(process.env.AXE || require.resolve('axe-core/axe.min.js'), 'utf8');
  const b = await chromium.launch(); const out = {};
  for (const scheme of ['light', 'dark']) {
    // bypassCSP: axe is injected as an inline script, which the app's CSP (rightly) refuses
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, colorScheme: scheme, bypassCSP: true }); const p = await ctx.newPage();
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:carts', JSON.stringify([{ id: 'a', name: '내 장바구니', items: [{ t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }] }])); }); await p.reload();
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    for (const r of ['home', 'compare?k=X24', 'search/%EB%B3%B4%ED%86%A1%EC%8A%A4', 'guide', 'table', 'cart', 'me', 'branch/3', 'map']) {
      await p.goto(BASE + '#' + r); await p.waitForTimeout(900);
      await p.addScriptTag({ content: axe });
      const res = await p.evaluate(async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, ex: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) })); });
      for (const v of res) { const k = `${scheme}|${v.id}`; out[k] = out[k] || { ...v, routes: [] }; out[k].routes.push(`${r}(${v.n})`); }
    }
    await ctx.close();
  }
  for (const [k, v] of Object.entries(out)) console.log('FAIL |', k, v.impact, v.help, '|', v.routes.join(' '), '|', v.ex.join(' ; '));
  fs.writeFileSync(`${OUT}/a11y.json`, JSON.stringify(out, null, 1));
  console.log(`axe violation types: ${Object.keys(out).length} (9 screens × light/dark)`); await b.close(); process.exitCode = Object.keys(out).length ? 1 : 0; })();
