// Clickjacking in a real browser: the app never shows inside a frame. The guard is the response header — app/_headers
// (chat A's A2) sends Content-Security-Policy: frame-ancestors 'none' from Cloudflare, so the browser opens the app in no
// frame at all, another site's or the same site's. (The script stopgap at the top of gate.js went once the header was
// live, 2026-10-15.)
//  - BASE that sends the header (Cloudflare): checked as it is
//  - BASE without it (a plain local server): the test serves app/ itself with the headers from app/_headers and checks
//    that — so the file Cloudflare reads is what is tested, also locally
// Opened normally (BASE), nothing changes: PIN → home.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/frame.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const APP = path.join(__dirname, '../../app');

// what a server says about frames: 'none' blocks every frame (also the same site's), 'self' only other sites'
async function frameHeader(url) {
  const r = await fetch(url, { redirect: 'follow' }).catch(() => null);
  const csp = (r && r.headers.get('content-security-policy')) || '', m = /frame-ancestors\s+([^;]+)/i.exec(csp);
  return m ? m[1].trim() : '';
}
// app/ served with the '/*' headers of app/_headers, the way Cloudflare's static assets send them
function headerServer() {
  const hdrs = {}; let inAll = false;
  for (const l of fs.readFileSync(path.join(APP, '_headers'), 'utf8').split('\n')) {
    if (/^\S/.test(l)) { inAll = l.trim() === '/*'; continue; }
    const m = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(l); if (inAll && m) hdrs[m[1]] = m[2].trim();
  }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
  const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(APP, p); if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', ...hdrs }); fs.createReadStream(f).pipe(r); });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://127.0.0.1:${srv.address().port}/` })));
}

(async () => { const b = await chromium.launch();
  let TARGET = BASE, own = null, fa = await frameHeader(BASE);
  if (!fa) { own = await headerServer(); TARGET = own.url; fa = await frameHeader(TARGET); }
  console.log(`frame-ancestors: ${fa || '(없음)'} — ${own ? 'BASE엔 헤더가 없어 app/_headers를 붙여 보내는 시험 서버로 확인' : 'BASE가 보내는 헤더'}`);
  ok("헤더가 프레임을 막음(frame-ancestors 'none' — app/_headers)", /'none'/.test(fa), fa);
  { const ctx = await b.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    // a page on another site that puts the app in a see-through frame over its own button. It is served by a real server
    // on another port (another origin): Chromium refuses to let a page with no real address frame localhost.
    const evil = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      r.end(`<!doctype html><button style="position:absolute;top:300px">상품 받기</button><iframe src="${TARGET}" style="opacity:.01;position:absolute;top:0;left:0;width:400px;height:800px;border:0"></iframe>`); });
    await new Promise((ok) => evil.listen(0, '127.0.0.1', ok));
    await p.goto(`http://127.0.0.1:${evil.address().port}/prize.html`); await p.waitForTimeout(1500);
    const f = p.frames().find((x) => x.url().startsWith(TARGET));
    ok('다른 사이트 프레임에 앱이 열리지 않음(키패드·화면 없음)', !f || (await f.locator('#gate-pad button, nav.tabs, header, #main').count().catch(() => 0)) === 0, f ? f.url() : 'no app frame');
    ok('스크립트 오류 없음(프레임)', !errs.length, errs.join(' '));
    await ctx.close(); evil.close(); }
  { const ctx = await b.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    // the same site's frame: 'none' blocks it too
    await p.goto(TARGET); await p.waitForTimeout(500);
    await p.evaluate((u) => { const i = document.createElement('iframe'); i.src = u; i.id = 'same'; document.body.append(i); }, TARGET);
    await p.waitForTimeout(1500);
    const f = p.frames().find((x) => x !== p.mainFrame() && x.url().startsWith(TARGET));
    ok("같은 사이트 프레임도 헤더로 막힘(frame-ancestors 'none')", !f || (await f.locator('#gate-pad button, #main').count().catch(() => 0)) === 0, f ? f.url() : 'no app frame');
    await ctx.close(); }
  { const ctx = await b.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE);
    ok('보통으로 열면 프레임 표시 없음(옛 data-framed 표시도 없음)', !(await p.evaluate(() => document.documentElement.hasAttribute('data-framed'))));
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    ok('보통으로 열면 비밀번호 → 홈 그대로', await p.locator('.pc').count() > 0);
    ok('스크립트 오류 없음', !errs.length, errs.join(' '));
    await ctx.close(); }
  if (own) own.srv.close();
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
