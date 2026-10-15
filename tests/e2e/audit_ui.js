// 4.0 Phase 0 UI audit (docs/PRODUCT_AUDIT.md): on every main screen, clicks each visible button / link inside the page
// and reports the ones that do nothing (no navigation, no change anywhere in the page, no dialog, no download, no new tab)
// and any script error. A button that only looks clickable is a defect ('dead button'); so is a success message with no
// effect, which the per-feature tests check. Read-only: runs on a fresh profile, never sends anything outside the page.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/audit_ui.js [--json out.json]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 400)}`); };

const ROUTES = ['home', 'explore', 'saved', 'change', 'table', 'data', 'guide', 'concern', 'compare', 'map', 'rank', 'terms', 'quick',
  'search/' + encodeURIComponent('보톡스'), 'cart', 'me', 'ops', 'versus'];
// buttons whose effect leaves the page or the browser by design (checked by their own tests)
// … and the ones that reset this phone's data or lock the app (their own tests: ux_qa, demo_features)
const SKIP = /설치하기|휴대폰 알림 켜기|테스트 알림|가격 알림 받기|가격 알림 끄기|원본 보기|홈페이지|길찾기|전화|공유|저장된 가격 지우고|다시 받기|로그아웃|잠금|잠그기|초기화|기록 지우기/;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', '""');
    // a small cart and a favourite so the cart / saved screens have their buttons
    localStorage.setItem('pc:carts', JSON.stringify([{ name: '내 장바구니', items: [{ t: 'k', k: 'X01', q: 1 }, { t: 'k', k: 'X12', q: 1 }] }]));
    localStorage.setItem('pc:favs', JSON.stringify({ k: ['X01'], b: [] })); });
  await p.reload(); await p.waitForTimeout(200);
  if (await p.locator('#gate-pad').isVisible()) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('.pc');
  await p.waitForFunction(() => document.querySelector('#main') && !document.querySelector('#main').hasAttribute('aria-busy'), null, { timeout: 30000 });
  // counts every change in the page; put back whenever the page was reloaded (a reload drops it)
  const watch = () => p.evaluate(() => { if (window.__mut != null) return; window.__mut = 0; new MutationObserver((l) => { window.__mut += l.length; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); });
  await watch();

  const dead = [], tried = [];
  for (const route of ROUTES) {
    await p.goto(BASE + '#' + route); await p.waitForTimeout(700);
    const sel = '#main button:not([disabled]), #main a[href]:not([href^="http"]), #main [role="button"], #main summary';
    const n = Math.min(await p.locator(sel).count(), 45);
    for (let i = 0; i < n; i++) {
      // the screen may have changed after the previous click: come back and take the i-th control again
      if (!(await p.evaluate(() => location.hash)).startsWith('#' + route.split('/')[0])) { await p.goto(BASE + '#' + route); await p.waitForTimeout(600); }
      await p.evaluate(() => { document.querySelectorAll('.sheet-wrap, .sheet, [role="dialog"]').forEach((x) => x.remove()); document.body.style.overflow = ''; });
      const el = p.locator(sel).nth(i);
      if (!(await el.count()) || !(await el.isVisible().catch(() => false))) continue;
      const label = ((await el.getAttribute('aria-label').catch(() => '')) || (await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!label || SKIP.test(label)) continue;
      await watch();
      const before = { hash: await p.evaluate(() => location.hash), mut: await p.evaluate(() => window.__mut), pages: ctx.pages().length, url: p.url() };
      let download = false; const dl = (d) => { download = true; d.cancel().catch(() => {}); }; p.on('download', dl);
      const e0 = errs.length;
      let clicked = true;
      await el.click({ timeout: 2000 }).catch(() => { clicked = false; });
      await p.waitForTimeout(450);
      if (!clicked) continue;                       // covered or moved away: not a verdict on the button
      p.off('download', dl);
      const after = { hash: await p.evaluate(() => location.hash), mut: await p.evaluate(() => window.__mut), pages: ctx.pages().length };
      if (after.mut == null) { tried.push({ route, label, effect: true, error: '' }); await watch(); continue; }   // the page reloaded: an effect
      for (const extra of ctx.pages().slice(1)) await extra.close();
      const effect = after.hash !== before.hash || after.mut > before.mut || after.pages > before.pages || download;
      tried.push({ route, label, effect, error: errs.length > e0 ? errs[errs.length - 1] : '' });
      if (!effect) dead.push(`${route}: '${label}'`);
    }
  }
  ok(`버튼 ${tried.length}개를 눌러 봄 — 아무 반응 없는 버튼 0개`, dead.length === 0, dead.join(' / '));
  ok('누르는 동안 스크립트 오류 0개', errs.length === 0, [...new Set(errs)].slice(0, 5).join(' / '));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ tried, dead, errs }, null, 1));
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`TOTAL ${pass}/${R.length} ${pass === R.length ? 'PASS' : 'FAIL'}`);
  process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
