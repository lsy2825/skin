// Clickjacking guard in a real browser: inside another site's frame the PIN pad and the app never show. Two layers:
//  - the response header (app/_headers, chat A2: Content-Security-Policy: frame-ancestors 'none') — the browser does not
//    open the app in any frame at all, the same site's included. Served by Cloudflare; a plain local server has no header.
//  - the script guard (top of app/gate.js) where there is no header: only a link that opens the app on its own.
// Opened normally, nothing changes.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/frame.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };

// what the server says about frames: 'none' blocks every frame (also the same site's), 'self' only other sites'
async function frameHeader() {
  const r = await fetch(BASE, { redirect: 'follow' }).catch(() => null);
  const csp = (r && r.headers.get('content-security-policy')) || '', m = /frame-ancestors\s+([^;]+)/i.exec(csp);
  return m ? m[1].trim() : '';
}

(async () => { const b = await chromium.launch();
  const fa = await frameHeader();
  console.log(`frame-ancestors: ${fa || '(헤더 없음 — gate.js 방어만)'}`);
  { const ctx = await b.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    // a page on another site that puts the app in a see-through frame over its own button. It is served by a real server
    // on another port (another origin): Chromium refuses to let a page with no real address frame localhost.
    const evil = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      r.end(`<!doctype html><button style="position:absolute;top:300px">상품 받기</button><iframe src="${BASE}" style="opacity:.01;position:absolute;top:0;left:0;width:400px;height:800px;border:0"></iframe>`); });
    await new Promise((ok) => evil.listen(0, '127.0.0.1', ok));
    const EVIL = `http://127.0.0.1:${evil.address().port}/`;
    await p.goto(EVIL + 'prize.html'); await p.waitForTimeout(1500);
    const f = p.frames().find((x) => x.url().startsWith(BASE));
    if (fa) {
      // the header: the browser refuses the frame — no frame holds the app at all (it shows its own error page)
      ok(`다른 사이트 프레임이 헤더로 막힘(frame-ancestors ${fa}) — 앱이 프레임에 열리지 않음`, !f || (await f.locator('#gate-pad button, nav.tabs, header, #main').count().catch(() => 0)) === 0, f ? f.url() : 'no app frame');
    } else {
      ok('다른 사이트 프레임 안에서 앱이 열림을 감지', !!f && await f.evaluate(() => document.documentElement.hasAttribute('data-framed')));
      ok('비밀번호 키패드가 없음', !!f && await f.locator('#gate-pad button').count() === 0);
      ok('앱 화면(헤더·탭)이 없음', !!f && await f.locator('nav.tabs, header, #main').count() === 0);
      const a = f ? f.locator('a[target="_blank"]') : null;
      ok('새 창에서 열기 링크만 보임', !!a && await a.count() === 1 && /새 창에서 열기/.test(await a.textContent()) && (await a.getAttribute('rel')).includes('noopener'));
    }
    ok('스크립트 오류 없음(프레임)', !errs.length, errs.join(' '));
    await ctx.close(); evil.close(); }
  { const ctx = await b.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE);
    ok('보통으로 열면 감지 안 함', !(await p.evaluate(() => document.documentElement.hasAttribute('data-framed'))));
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    ok('보통으로 열면 비밀번호 → 홈 그대로', await p.locator('.pc').count() > 0);
    // a frame from the same site (e.g. a future help page) is not blocked
    await p.evaluate((u) => { const i = document.createElement('iframe'); i.src = u; i.id = 'same'; document.body.append(i); }, BASE);
    await p.waitForTimeout(1500);
    const f = p.frames().find((x) => x !== p.mainFrame() && x.url().startsWith(BASE));
    if (/'none'/.test(fa)) ok("같은 사이트 프레임도 헤더로 막힘(frame-ancestors 'none')", !f || (await f.locator('#gate-pad button, #main').count().catch(() => 0)) === 0, f ? f.url() : 'no app frame');
    else ok('같은 사이트 프레임은 막지 않음', !!f && !(await f.evaluate(() => document.documentElement.hasAttribute('data-framed'))));
    ok('스크립트 오류 없음', !errs.length, errs.join(' '));
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
