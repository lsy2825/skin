// 단계별 익명 집계 (6.0 지시서 약속 2, B5) — the same walk twice: open → a price on screen → search → compare → 담기 → 관심 →
// 가격 알림 → 내 견적.
//  1. as shipped (config.js metrics: false): zero beacons, zero requests to /v1/m, nothing stored for it
//  2. turned on (config.js and the page's CSP rewritten in the test only, the server faked): each of the seven steps goes
//     once, the body is only {"s":"<step>"}, a reload the same day sends nothing again, and a last visit 3 days ago
//     sends 'return_7d' with 'open' (the date stays on the phone)
//  3. the phone's switch (마이 → 내 설정 '익명 이용 집계 보내기', user decision 2026-10-15): hidden when not set up; set up
//     and switched off = the same walk sends nothing and stores nothing; switched back on = steps go again
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/metrics.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 240)}`); };
const API = 'https://m.example.test';   // a made-up address: answered by the test, never reaches the network
const WALK = ['open', 'first_price', 'compare_open', 'keep_cart', 'keep_fav', 'keep_alert', 'cart_open'];

async function start(b, on) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const hits = [], other = [];
  // every sendBeacon call is counted in the page, whatever its address
  await ctx.addInitScript(() => { const nb = navigator.sendBeacon && navigator.sendBeacon.bind(navigator); window.__beacons = [];
    if (nb) navigator.sendBeacon = (u, d) => { window.__beacons.push([String(u), typeof d === 'string' ? d : String(d)]); return nb(u, d); }; });
  ctx.on('request', (r) => { const u = r.url(); if (/\/v1\/m(\?|$)/.test(u) || u.startsWith(API)) hits.push({ u, m: r.method(), body: r.postData(), type: (r.headers()['content-type'] || '') }); else if (!u.startsWith(BASE) && !u.startsWith('data:')) other.push(u); });
  if (on) {
    await ctx.route((u) => u.pathname.endsWith('/config.js'), async (route) => { const res = await route.fetch(); const t = await res.text();
      await route.fulfill({ response: res, body: t.replace('metrics: false,', 'metrics: true,').replace('metricsApi: ""', `metricsApi: "${API}"`) }); });
    await ctx.route((u) => u.href === BASE || u.pathname.endsWith('/index.html'), async (route) => { const res = await route.fetch(); const t = await res.text();
      await route.fulfill({ response: res, body: t.replace("connect-src 'self'", `connect-src 'self' ${API}`) }); });
    await ctx.route(`${API}/**`, (route) => route.fulfill({ status: 204, body: '' }));
  }
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  return { ctx, p, hits, other, errs };
}
// reload on the home screen (the walk ends on 내 견적)
async function home(p) { await p.evaluate(() => history.replaceState(null, '', location.pathname)); await p.reload(); await unlock(p); }
async function unlock(p) {
  if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('.pc'); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
  await p.waitForTimeout(400);
}
async function walk(p) {
  await p.locator('.search input').first().fill('리쥬란 2cc'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
  await p.locator('.cmphead .addbtn').click(); await p.waitForTimeout(300);
  await p.locator('.cmphead .favbtn').click(); await p.waitForTimeout(300);
  await p.locator('.cmphead .morebtn').click(); await p.waitForTimeout(200); await p.locator('.actsheet button', { hasText: '가격 알림' }).click(); await p.waitForTimeout(300);
  await p.locator('.sheet .btn', { hasText: '알림 만들기' }).click(); await p.waitForTimeout(400);
  await p.locator('#tabs button[data-tab="cart"]').click(); await p.waitForTimeout(500);
  return p.evaluate(() => ({ cart: (JSON.parse(localStorage.getItem('pc:carts') || '[]')[0] || { items: [] }).items.length, favs: (JSON.parse(localStorage.getItem('pc:favs') || '{"k":[]}').k || []).length,
    alerts: JSON.parse(localStorage.getItem('pc:alerts') || '[]').length, hash: location.hash }));
}
// 마이 → 내 설정's switch, or null when it is not there
const optSwitch = async (p) => { await p.evaluate(() => { location.hash = '#me'; }); await p.waitForTimeout(500);
  const sw = p.locator('#main label.switch', { hasText: '익명 이용 집계 보내기' });
  return (await sw.count()) ? sw.first() : null; };
const steps = (hits) => hits.map((x) => { try { return JSON.parse(x.body).s; } catch (e) { return `?${x.body}`; } });

(async () => { const b = await chromium.launch();
  // 1) off — as shipped
  { const { ctx, p, hits, other, errs } = await start(b, false);
    await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload(); await unlock(p);
    const did = await walk(p);
    ok('꺼짐: 걷기가 실제로 됨(담기·관심·알림·내 견적)', did.cart >= 1 && did.favs >= 1 && did.alerts >= 1 && /#cart/.test(did.hash), JSON.stringify(did));
    const beacons = await p.evaluate(() => window.__beacons.length);
    ok('꺼짐: sendBeacon 0번, /v1/m 요청 0건', beacons === 0 && hits.length === 0, `beacons=${beacons} hits=${hits.length}`);
    ok('꺼짐: 집계용으로 저장한 것 없음(pc:metrics 없음)', await p.evaluate(() => localStorage.getItem('pc:metrics') === null));
    ok('꺼짐: 다른 주소로 나간 요청 없음', other.length === 0, other.slice(0, 3).join(' '));
    ok('꺼짐: 내 설정에 집계 스위치 없음(운영 설정이 꺼져 있으면 보이지 않음)', !(await optSwitch(p)));
    ok('꺼짐: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // 2) on — config and CSP rewritten by the test, the server faked
  { const { ctx, p, hits, errs } = await start(b, true);
    await p.goto(BASE); await p.waitForTimeout(500); await p.evaluate(() => localStorage.clear()); hits.length = 0; await p.reload(); await unlock(p);
    // the home's prices are on screen as soon as the PIN screen opens (it hides the page while the home is drawn behind it)
    ok('켜짐: 비밀번호를 풀고 홈만 봐도 open·first_price', steps(hits).join() === 'open,first_price', steps(hits).join(','));
    await walk(p); await p.waitForTimeout(500);
    const got = steps(hits);
    ok('켜짐: 7단계가 한 번씩(open·first_price·compare_open·keep_cart·keep_fav·keep_alert·cart_open)', WALK.every((s) => got.filter((x) => x === s).length === 1) && got.length === WALK.length, got.join(','));
    ok('켜짐: 보내는 곳·방식 = POST {metricsApi}/v1/m', hits.every((x) => x.u === `${API}/v1/m` && x.m === 'POST'), hits.map((x) => `${x.m} ${x.u}`).slice(0, 2).join(' '));
    ok('켜짐: 본문은 {"s":단계}뿐(날짜·기기·화면 없음)', hits.every((x) => { try { const o = JSON.parse(x.body); return Object.keys(o).join() === 's' && WALK.includes(o.s); } catch (e) { return false; } }), hits.map((x) => x.body).slice(0, 3).join(' '));
    ok('켜짐: 문자열 본문(text/plain — 미리 확인 요청 없이 가는 형식)', hits.every((x) => /^text\/plain/.test(x.type)), hits.map((x) => x.type)[0]);
    const kept = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:metrics')));
    ok('켜짐: 폰에 남는 건 오늘 날짜와 보낸 단계 이름뿐', kept && /^\d{4}-\d{2}-\d{2}$/.test(kept.d) && Object.keys(kept).sort().join() === 'd,s' && kept.s.length === WALK.length, JSON.stringify(kept));

    // the same day again: nothing new
    hits.length = 0; await home(p);
    await p.locator('.search input').first().fill('리쥬란 2cc'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
    await p.locator('#tabs button[data-tab="cart"]').click(); await p.waitForTimeout(500);
    ok('켜짐: 같은 날 다시 열고 비교·내 견적을 봐도 새로 보내지 않음', hits.length === 0, steps(hits).join(','));

    // last used 3 days ago: open + return_7d; the date itself is not sent
    hits.length = 0;
    await p.evaluate(() => { const s = new Date(Date.now() + 9 * 3600e3 - 3 * 864e5).toISOString().slice(0, 10);   // the KST day, as the app keeps it
      localStorage.setItem('pc:metrics', JSON.stringify({ d: s, s: ['open', 'first_price'] })); });
    await home(p); await p.waitForTimeout(300);
    const back = steps(hits);
    ok('켜짐: 3일 전에 왔던 폰 → open + return_7d (+ first_price), 날짜는 보내지 않음', back.includes('open') && back.includes('return_7d') && hits.every((x) => !/\d{4}-\d{2}/.test(x.body)), back.join(','));
    // 8 days ago: not a 7-day return
    hits.length = 0;
    await p.evaluate(() => { const s = new Date(Date.now() + 9 * 3600e3 - 8 * 864e5).toISOString().slice(0, 10);
      localStorage.setItem('pc:metrics', JSON.stringify({ d: s, s: [] })); });
    await home(p); await p.waitForTimeout(300);
    ok('켜짐: 8일 전이면 return_7d 없음', steps(hits).includes('open') && !steps(hits).includes('return_7d'), steps(hits).join(','));
    const sw = await optSwitch(p);
    ok('켜짐: 내 설정에 집계 스위치가 있고 기본은 켜짐', !!sw && await sw.locator('input').isChecked());
    // switched off while the app runs: nothing more goes and nothing new is written; the day's record is kept as it was
    const before = await p.evaluate(() => localStorage.getItem('pc:metrics'));
    await sw.click(); await p.waitForTimeout(300); hits.length = 0;
    await p.locator('#tabs button[data-tab="saved"]').click(); await p.waitForTimeout(300);
    await p.evaluate(() => { location.hash = '#compare?k=X12'; }); await p.waitForTimeout(800);
    await p.locator('.cmphead .favbtn').click(); await p.waitForTimeout(300);
    await p.locator('#tabs button[data-tab="cart"]').click(); await p.waitForTimeout(500);
    ok('켜짐 → 스위치 끔: 그 뒤 /v1/m 0건, pc:metricsOff=true, 그날 기록은 그대로(새로 쓰지 않음)', hits.length === 0
      && await p.evaluate((b) => localStorage.getItem('pc:metricsOff') === 'true' && localStorage.getItem('pc:metrics') === b, before), steps(hits).join(','));
    ok('켜짐: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // 3) set up, but switched off on this phone: nothing goes, nothing is stored; switched on again: steps go
  { const { ctx, p, hits, errs } = await start(b, true);
    await p.goto(BASE); await p.waitForTimeout(500); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:metricsOff', 'true'); }); hits.length = 0; await p.reload(); await unlock(p);
    await walk(p); await p.waitForTimeout(500);
    ok('스위치 꺼짐: 같은 걷기에 /v1/m 0건, sendBeacon 0번, pc:metrics 없음', hits.length === 0 && await p.evaluate(() => window.__beacons.length === 0 && localStorage.getItem('pc:metrics') === null), steps(hits).join(','));
    const sw = await optSwitch(p);
    ok('스위치 꺼짐: 내 설정 스위치가 꺼짐으로 보임', !!sw && !(await sw.locator('input').isChecked()));
    await sw.click(); await p.waitForTimeout(300);
    await p.locator('#tabs button[data-tab="cart"]').click(); await p.waitForTimeout(500);
    ok('스위치 다시 켬: 그 뒤 단계는 다시 감(open·cart_open)', steps(hits).includes('open') && steps(hits).includes('cart_open') && await p.evaluate(() => localStorage.getItem('pc:metricsOff') === 'false'), steps(hits).join(','));
    ok('스위치: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
