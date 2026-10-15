// 푸시 알림 (6.0 지시서 약속 1, B6) — the 관심 tab's '가격 알림 받기':
//  1. as shipped (config.js alertsApi/pushPublicKey empty), and with only one of the two: no push button, no permission
//     prompt, no request to /v1/push
//  2. set up (config.js and the page's CSP rewritten in the test only; the browser's push service and the Worker faked):
//     nothing is asked before the tap; the tap asks for the permission first, then subscribes with the public key and
//     POSTs {subscription, rules}; removing the alert PUTs the new rules to /v1/push/rules/{id}; '끄기' DELETEs and
//     unsubscribes; a refused permission sends nothing; a Worker that fails takes back the subscription just made
// The service worker's push and notificationclick handlers are unit-tested (tests/sw.test.js): headless Chromium has no
// push service and cannot click a notification.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/push.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 240)}`); };
const API = 'https://alerts.example.test';   // a made-up address: answered by the test, never reaches the network
const KEY = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');   // a VAPID-shaped public key
const SUB_ID = 'sub_12345678';

async function start(b, cfg, answer = 'granted', postStatus = 200) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const hits = [];
  // the browser side faked: Notification (its prompt), the service worker registration and its push manager
  await ctx.addInitScript((answer) => {
    const log = window.__push = { perm: 0, subscribe: [], unsub: 0 };
    let permission = 'default', sub = null;
    function N() {}
    Object.defineProperty(N, 'permission', { get: () => permission });
    N.requestPermission = async () => { log.perm++; permission = answer; return answer; };
    Object.defineProperty(window, 'Notification', { value: N, configurable: true, writable: true });
    const mk = () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-test', expirationTime: null,
      toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }; },
      async unsubscribe() { log.unsub++; sub = null; return true; } });
    const reg = { pushManager: { getSubscription: async () => sub,
      subscribe: async (o) => { log.subscribe.push({ uvo: o.userVisibleOnly, keyLen: o.applicationServerKey && o.applicationServerKey.length, key0: o.applicationServerKey && o.applicationServerKey[0] }); sub = mk(); return sub; } } };
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistration = async () => reg;
  }, answer);
  ctx.on('request', (r) => { const u = r.url(); if (u.startsWith(API) || /\/v1\/push\//.test(u)) hits.push({ m: r.method(), u: u.replace(API, ''), body: r.postData() }); });
  if (cfg) {
    await ctx.route((u) => u.pathname.endsWith('/config.js'), async (route) => { const res = await route.fetch(); let t = await res.text();
      for (const [k, v] of Object.entries(cfg)) t = t.replace(`${k}: ""`, `${k}: "${v}"`);
      await route.fulfill({ response: res, body: t }); });
    await ctx.route((u) => u.href === BASE || u.pathname.endsWith('/index.html'), async (route) => { const res = await route.fetch(); const t = await res.text();
      await route.fulfill({ response: res, body: t.replace("connect-src 'self'", `connect-src 'self' ${API}`) }); });
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, PUT, DELETE', 'access-control-allow-headers': 'content-type' };
    await ctx.route(`${API}/**`, (route) => { const m = route.request().method();
      if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
      if (m === 'POST') return route.fulfill({ status: postStatus, headers: { ...cors, 'content-type': 'application/json' }, body: postStatus === 200 ? JSON.stringify({ id: SUB_ID }) : '{"error":"down"}' });
      return route.fulfill({ status: 204, headers: cors, body: '' }); });
  }
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
  if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('.pc'); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
  return { ctx, p, hits, errs };
}
// a 지켜보기 alert on 리쥬란힐러 2cc (X24), made the way a person makes it: compare → ⋯ → 가격 알림 → 알림 만들기
async function watchX24(p) {
  await p.evaluate(() => { location.hash = '#compare?k=X24'; }); await p.waitForTimeout(900);
  await p.locator('.cmphead .morebtn').click(); await p.waitForTimeout(200); await p.locator('.actsheet button', { hasText: '가격 알림' }).click(); await p.waitForTimeout(300);
  await p.locator('.sheet .btn', { hasText: '알림 만들기' }).click(); await p.waitForTimeout(400);
  await p.evaluate(() => { location.hash = '#saved'; }); await p.waitForTimeout(600);
}
const pushBtn = (p, t) => p.locator('#main .nfp button', { hasText: t });
const log = (p) => p.evaluate(() => window.__push);

(async () => { const b = await chromium.launch();
  // 1) off: as shipped, and with only one of the two settings
  for (const [tag, cfg] of [['배포 그대로', null], ['주소만', { alertsApi: API }], ['공개키만', { pushPublicKey: KEY }]]) {
    const { ctx, p, hits, errs } = await start(b, cfg);
    await watchX24(p);
    const nfp = await p.locator('#main .nfp').innerText().catch(() => '');
    ok(`꺼짐(${tag}): 관심 탭에 '가격 알림 받기' 없음, 지금처럼 '휴대폰 알림'`, (await pushBtn(p, '가격 알림 받기').count()) === 0 && /휴대폰 알림/.test(nfp), nfp.replace(/\s+/g, ' ').slice(0, 80));
    const l = await log(p);
    ok(`꺼짐(${tag}): 권한 요청 0, 구독 0, /v1/push 요청 0`, l.perm === 0 && l.subscribe.length === 0 && hits.length === 0, JSON.stringify({ ...l, hits: hits.length }));
    ok(`꺼짐(${tag}): 폰에 저장한 것 없음(pc:push)`, await p.evaluate(() => localStorage.getItem('pc:push') === null));
    ok(`꺼짐(${tag}): 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // 2) on
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY });
    await watchX24(p);
    ok('켜짐: 누르기 전에는 권한을 묻지 않고 요청도 없음', (await log(p)).perm === 0 && hits.length === 0 && (await pushBtn(p, '가격 알림 받기').count()) === 1, JSON.stringify(await log(p)));
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    const l = await log(p);
    ok('켜짐: 누른 뒤 권한 1번 → 공개키(65바이트, 0x04)로 구독, 보이는 알림만', l.perm === 1 && l.subscribe.length === 1 && l.subscribe[0].uvo === true && l.subscribe[0].keyLen === 65 && l.subscribe[0].key0 === 4, JSON.stringify(l));
    const post = hits.find((x) => x.m === 'POST');
    let body = null; try { body = JSON.parse(post.body); } catch (e) { /* checked below */ }
    ok('켜짐: POST /v1/push/subscribe {subscription, rules}', post && post.u === '/v1/push/subscribe' && body && Object.keys(body).sort().join() === 'rules,subscription'
      && body.subscription.endpoint === 'https://fcm.googleapis.com/fcm/send/e2e-test' && body.subscription.keys.p256dh.length === 87, post && post.body.slice(0, 160));
    ok('켜짐: 규칙은 약속 모양({kind,key,max?,region?}, 20개 이하) — 지켜보기 X24 수도권', body && body.rules.length >= 1 && body.rules.length <= 20 && body.rules.some((r) => r.kind === 'watch' && r.key === 'X24' && r.region === '수도권')
      && body.rules.every((r) => ['target', 'watch', 'newmatch', 'expiring'].includes(r.kind) && Object.keys(r).every((k) => ['kind', 'key', 'max', 'region'].includes(k))), JSON.stringify(body && body.rules));
    const kept = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:push')));
    ok('켜짐: 받은 id는 폰에만(pc:push), 화면은 켜짐·끄기', kept && kept.id === SUB_ID && /켜짐/.test(await p.locator('#main .nfp').innerText()) && (await pushBtn(p, '가격 알림 끄기').count()) === 1, JSON.stringify(kept));

    // the alert goes → the rules follow
    hits.length = 0;
    await p.locator('#main button[aria-label$="알림 해지"]').first().click(); await p.waitForTimeout(1200);
    const put = hits.find((x) => x.m === 'PUT');
    ok('켜짐: 알림을 해지하면 PUT /v1/push/rules/{id} {rules}', put && put.u === `/v1/push/rules/${SUB_ID}` && JSON.stringify(JSON.parse(put.body)) === '{"rules":[]}', put ? `${put.u} ${put.body}` : hits.map((x) => x.m + ' ' + x.u).join(','));

    // off
    hits.length = 0;
    await pushBtn(p, '가격 알림 끄기').click(); await p.waitForTimeout(800);
    const del = hits.find((x) => x.m === 'DELETE');
    ok('켜짐: 끄기 → DELETE /v1/push/subscribe/{id}, 브라우저 구독도 해지, id 지움', del && del.u === `/v1/push/subscribe/${SUB_ID}` && (await log(p)).unsub === 1 && await p.evaluate(() => localStorage.getItem('pc:push') === 'null' || localStorage.getItem('pc:push') === null)
      && (await pushBtn(p, '가격 알림 받기').count()) === 1, del ? del.u : 'no DELETE');
    ok('켜짐: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // 3) the permission refused: nothing subscribed, nothing sent
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY }, 'denied');
    await watchX24(p);
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(600);
    const l = await log(p);
    ok('거절: 권한 1번 묻고 구독·요청 0, 화면은 브라우저 설정 안내', l.perm === 1 && l.subscribe.length === 0 && hits.length === 0 && /브라우저 설정/.test(await p.locator('#main .nfp').innerText()), JSON.stringify(l));
    ok('거절: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 4) the Worker fails: the browser subscription made by the tap is taken back (nothing can push while the screen says off)
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY }, 'granted', 500);
    await watchX24(p);
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    const l = await log(p);
    ok('서버 실패: 구독 1 → POST 실패 → 그 구독 해지, id 없음, 다시 받기 버튼', l.subscribe.length === 1 && l.unsub === 1 && hits.filter((x) => x.m === 'POST').length === 1
      && await p.evaluate(() => !JSON.parse(localStorage.getItem('pc:push') || 'null')) && (await pushBtn(p, '가격 알림 받기').count()) === 1, JSON.stringify(l));
    ok('서버 실패: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
