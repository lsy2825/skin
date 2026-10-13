// XSS test: malicious strings in the price data, the URL and a shared-cart link must show as text and never run.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/xss.js
// Runs twice: with the page's Content Security Policy, and with the CSP removed — so the app's own output encoding
// (text nodes, setAttribute, safe link schemes) is tested on its own, not only the CSP behind it.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const MARK = 'window.__xss=(window.__xss||0)+1';
const PAYLOADS = [`<img src=x onerror="${MARK}">`, `<script>${MARK}</script>`, `"><svg onload="${MARK}">`, `<a href="javascript:${MARK}">x</a>`];
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

(async () => { const b = await chromium.launch();
  for (const withCsp of [true, false]) {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    if (!withCsp) await p.route('**/index.html', async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '') }); });
    if (!withCsp) await p.route(BASE, async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '') }); });
    // poison the data: product names, a branch name, a source URL, a knowledge-base sentence
    await p.route('**/data.json', async (r) => { const res = await r.fetch(); const D = await res.json();
      const rowsX12 = D.rows.filter((row) => D.s[row[7]].split(' ').includes('X12')).slice(0, 4);
      rowsX12.forEach((row, i) => { D.s.push(PAYLOADS[i % PAYLOADS.length] + ' 슈링크'); row[2] = D.s.length - 1; });
      D.s.push(`javascript:${MARK}`);                                                   // source link of every X12 row
      D.rows.forEach((row) => { if (D.s[row[7]].split(' ').includes('X12')) row[11] = D.s.length - 1; });
      D.s.push(`<img src=x onerror="${MARK}">점`); D.branches[rowsX12[0][0]][1] = D.s.length - 1;   // its branch name
      if (D.meta.kb && D.meta.kb.entries[0]) D.meta.kb.entries[0].one_liner = `<script>${MARK}</script> 설명`;
      r.fulfill({ response: res, json: D }); });
    await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    const shared = enc({ name: PAYLOADS[0], from: PAYLOADS[1], note: PAYLOADS[2], items: [{ t: 'r', n: PAYLOADS[3], br: '블리비|x', p: 1, q: 1 }, null, { t: 'k', k: 'X12', q: 999, evil: PAYLOADS[0] }], sent: { total: 'x' } });
    const routes = ['compare?k=X12', 'table?q=' + encodeURIComponent('슈링크'), `search/${encodeURIComponent(PAYLOADS[0])}`, `search/%E0%A4%A`, 'guide', 'branch/' + 0,
      `import/${shared}`, 'import/%%%not-base64', `import/${'A'.repeat(30000)}`];
    for (const r of routes) { await p.goto(BASE + '#' + r); await p.waitForTimeout(500); }
    // open a price-evidence sheet for a poisoned row: its source link must not be a javascript: link
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(500);
    const infos = p.locator('#main li.rk .infob'); if (await infos.count()) { await infos.first().click(); await p.waitForTimeout(300); }
    const jsLinks = await p.$$eval('a[href]', (as) => as.filter((a) => /^\s*javascript:/i.test(a.getAttribute('href'))).length);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    // save the shared cart and read what was stored
    await p.goto(BASE + `#import/${shared}`); await p.waitForTimeout(400);
    const saveBtn = p.locator('#main .btn', { hasText: '내 장바구니로 저장' }); if (await saveBtn.count()) { await saveBtn.click(); await p.waitForTimeout(300); }
    const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:carts') || '[]').pop());
    const xss = await p.evaluate(() => window.__xss || 0);
    const shownAsText = await p.evaluate(() => document.body.innerText.includes('<img src=x') || document.body.innerText.includes('<script>'));
    const tag = withCsp ? 'CSP 켬' : 'CSP 끔(앱 자체 방어만)';
    ok(`[${tag}] 악성 문자열이 실행되지 않음 (${routes.length + 2}개 화면)`, xss === 0 && !dialogs.length, `실행 횟수 ${xss}, 대화상자 ${dialogs.length}`);
    ok(`[${tag}] javascript: 링크가 만들어지지 않음`, jsLinks === 0, `${jsLinks}개`);
    ok(`[${tag}] 공유 링크: 알 수 없는 필드·잘못된 항목은 버리고 수량은 1~20`, !!stored && stored.items.length === 2 && !('evil' in stored.items[1]) && stored.items[1].q === 20 && stored.name.length <= 30, JSON.stringify(stored && stored.items).slice(0, 120));
    if (withCsp) ok('악성 문자열은 글자 그대로 보임(인코딩)', shownAsText);
    await ctx.close();
  }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
