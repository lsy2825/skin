// 푸시 알림 (6.0 지시서 약속 1, B6) — the 관심 tab's '가격 알림 받기':
//  1. as shipped (config.js alertsApi/pushPublicKey empty), and with only one of the two: no push button, no permission
//     prompt, no request to /v1/push
//  2. set up (config.js and the page's CSP rewritten in the test only; the browser's push service and the Worker faked):
//     nothing is asked before the tap; the tap asks for the permission first, then subscribes with the public key and
//     POSTs {subscription, rules}; removing the alert PUTs the new rules to /v1/push/rules/{id}; '끄기' DELETEs and
//     unsubscribes; a refused permission sends nothing; a Worker that fails takes back the subscription just made
//  3. no rule left (user decision 2026-10-15): with no alert there is a hint instead of the button; removing the last
//     alert DELETEs the subscription once the 6 s '되돌리기' is over; an undo inside it keeps the subscription
//  4. a new public key (chat A's request #85 ②): a browser subscription made with another key is taken back and made again
//     with the key in config.js — at start (the old id DELETEd once the new one is in) and on '받기'; the same key changes nothing
//  5. 404/410 on PUT (#85 ④): the browser subscription is taken back, made again and POSTed for a new id, once per run; the
//     same endpoint is never POSTed again; a failing POST (or a second 404 in the same run) turns it off
//  6. a branch product's '이벤트 종료 3일 전' (#85 ①): no rule for it (the Worker's expiring is about a comparison key in a
//     region), counted as 'only on this phone' in the panel
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
const OLDKEY = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 9)]).toString('base64url');   // the key before a replacement
const SUB_ID = 'sub_12345678';
const FCM = 'https://fcm.googleapis.com/fcm/send/';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, PUT, DELETE', 'access-control-allow-headers': 'content-type' };

async function start(b, cfg, answer = 'granted', postStatus = 200, pre = null) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const hits = [];
  // the browser side faked: Notification (its prompt), the service worker registration and its push manager
  await ctx.addInitScript(([answer, pre]) => {
    const log = window.__push = { perm: 0, subscribe: [], unsub: 0, unsubEp: [] };
    let permission = pre ? pre.perm : 'default', sub = null, n = 0;
    function N() {}
    Object.defineProperty(N, 'permission', { get: () => permission });
    N.requestPermission = async () => { log.perm++; permission = answer; return answer; };
    Object.defineProperty(window, 'Notification', { value: N, configurable: true, writable: true });
    const b64 = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // each new subscription gets its own endpoint (…/e2e-test, …/e2e-test-2, …) as a push service gives, and shows the key
    // it was made with (options.applicationServerKey, an ArrayBuffer) as browsers do
    const mk = (key, ep) => ({ endpoint: ep || 'https://fcm.googleapis.com/fcm/send/e2e-test' + (++n > 1 ? '-' + n : ''), expirationTime: null,
      options: key ? { userVisibleOnly: true, applicationServerKey: new Uint8Array(key).buffer } : undefined,
      toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }; },
      async unsubscribe() { log.unsub++; log.unsubEp.push(this.endpoint); if (sub === this) sub = null; return true; } });
    const reg = { pushManager: { getSubscription: async () => sub,
      subscribe: async (o) => { const k = o.applicationServerKey;
        // a browser refuses another key while a subscription is there (InvalidStateError)
        if (sub && sub.options && b64(new Uint8Array(sub.options.applicationServerKey)) !== b64(k)) throw new Error('InvalidStateError');
        sub = sub || mk(k);
        log.subscribe.push({ uvo: o.userVisibleOnly, keyLen: k && k.length, key0: k && k[0], key: k && b64(k), ep: sub.endpoint }); return sub; } } };
    // a phone that is already subscribed (the browser may have renewed the endpoint since; pre.key: the key it was made with —
    // without it the subscription shows none, as some browsers)
    if (pre && pre.endpoint) sub = mk(pre.key ? Uint8Array.from(atob(pre.key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)) : null, pre.endpoint);
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistration = async () => reg;
  }, [answer, pre]);
  ctx.on('request', (r) => { const u = r.url(); if (u.startsWith(API) || /\/v1\/push\//.test(u)) hits.push({ m: r.method(), u: u.replace(API, ''), body: r.postData() }); });
  if (cfg) {
    await ctx.route((u) => u.pathname.endsWith('/config.js'), async (route) => { const res = await route.fetch(); let t = await res.text();
      for (const [k, v] of Object.entries(cfg)) t = t.replace(`${k}: ""`, `${k}: "${v}"`);
      await route.fulfill({ response: res, body: t }); });
    await ctx.route((u) => u.href === BASE || u.pathname.endsWith('/index.html'), async (route) => { const res = await route.fetch(); const t = await res.text();
      await route.fulfill({ response: res, body: t.replace("connect-src 'self'", `connect-src 'self' ${API}`) }); });
    const cors = CORS;
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
// a 지켜보기 alert (X24 = 리쥬란힐러 2cc), made the way a person makes it: compare → ⋯ → 가격 알림 → 알림 만들기
async function watchX24(p, key = 'X24') {
  await p.evaluate((k) => { location.hash = '#compare?k=' + k; }, key); await p.waitForTimeout(900);
  await p.locator('.cmphead .morebtn').click(); await p.waitForTimeout(200); await p.locator('.actsheet button', { hasText: '가격 알림' }).click(); await p.waitForTimeout(300);
  await p.locator('.sheet .btn', { hasText: '알림 만들기' }).click(); await p.waitForTimeout(400);
  await p.evaluate(() => { location.hash = '#saved'; }); await p.waitForTimeout(600);
}
const pushBtn = (p, t) => p.locator('#main .nfp button', { hasText: t });
const log = (p) => p.evaluate(() => window.__push);
const kept = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('pc:push') || 'null'));
const posted = (hits) => hits.filter((x) => x.m === 'POST').map((x) => { try { return JSON.parse(x.body).subscription.endpoint; } catch (e) { return null; } });
// the next start of the app (from home)
async function restart(p, hits) { hits.length = 0; await p.goto(BASE); await p.waitForSelector('.pc');
  await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); await p.waitForTimeout(1500); }
// the Worker answers PUT with `put` and each POST with the next of `ids` (null: 500); the rest as start() set it up
function worker(put, ids) {
  return (route) => { const m = route.request().method();
    if (m === 'PUT') return route.fulfill({ status: put, headers: { ...CORS, 'content-type': 'application/json' }, body: put < 300 ? '{"ok":true}' : '{"error":"NOT_FOUND"}' });
    if (m === 'POST') { const id = ids.shift(); return route.fulfill({ status: id ? 201 : 500, headers: { ...CORS, 'content-type': 'application/json' }, body: id ? JSON.stringify({ id }) : '{"error":"down"}' }); }
    return route.fallback(); };
}

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
    await watchX24(p, 'X12'); await watchX24(p);
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
    const left = put ? JSON.parse(put.body).rules : null;
    ok('켜짐: 알림 하나를 해지하면 PUT /v1/push/rules/{id} {남은 rules}', put && put.u === `/v1/push/rules/${SUB_ID}` && left.length >= 1 && left.every((r) => r.key === left[0].key) && !hits.some((x) => x.m === 'DELETE'), put ? `${put.u} ${put.body}` : hits.map((x) => x.m + ' ' + x.u).join(','));

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
  // 5) no alert at all: a hint, no button, nothing asked
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY });
    await p.evaluate(() => { location.hash = '#saved'; }); await p.waitForTimeout(600);
    const nfp = await p.locator('#main .nfp').innerText().catch(() => '');
    ok('알림 없음: 받기 버튼 대신 안내(알림을 먼저 만들기), 권한·요청 0', (await pushBtn(p, '가격 알림 받기').count()) === 0 && /하나 이상 만들면/.test(nfp) && (await log(p)).perm === 0 && hits.length === 0, nfp.replace(/\s+/g, ' ').slice(0, 90));
    ok('알림 없음: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // 6) the last alert removed: DELETE once the 되돌리기 window is over
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY });
    await watchX24(p);
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    hits.length = 0;
    await p.locator('#main button[aria-label$="알림 해지"]').first().click(); await p.waitForTimeout(2000);
    const early = hits.length;
    await p.waitForTimeout(6000);
    const del = hits.find((x) => x.m === 'DELETE');
    ok('마지막 알림 해지: 되돌리기 시간 동안은 0건, 지난 뒤 DELETE + 브라우저 구독 해지 + id 지움', early === 0 && del && del.u === `/v1/push/subscribe/${SUB_ID}` && !hits.some((x) => x.m === 'PUT')
      && (await log(p)).unsub === 1 && await p.evaluate(() => !JSON.parse(localStorage.getItem('pc:push') || 'null')), `early=${early} ${hits.map((x) => x.m + ' ' + x.u).join(',')}`);
    ok('마지막 알림 해지: 화면은 꺼짐(알림을 먼저 만들라는 안내)', /하나 이상 만들면/.test(await p.locator('#main .nfp').innerText().catch(() => '')));
    ok('마지막 알림 해지: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // 7) the last alert removed, then 되돌리기: the subscription stays
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY });
    await watchX24(p);
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    hits.length = 0;
    await p.locator('#main button[aria-label$="알림 해지"]').first().click(); await p.waitForTimeout(500);
    await p.locator('#toast button', { hasText: '되돌리기' }).click(); await p.waitForTimeout(7500);
    ok('해지 뒤 되돌리기: DELETE 없음, 구독·id 그대로, 켜짐', !hits.some((x) => x.m === 'DELETE') && (await log(p)).unsub === 0
      && await p.evaluate(() => !!JSON.parse(localStorage.getItem('pc:push') || 'null')) && (await pushBtn(p, '가격 알림 끄기').count()) === 1, hits.map((x) => x.m + ' ' + x.u).join(','));
    ok('해지 뒤 되돌리기: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 8) start: subscribed earlier, the browser renewed the endpoint, and no alert is left — no new (empty) POST, the old id
  //    is DELETEd and the browser subscription taken back
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY }, 'granted', 200, { perm: 'granted', endpoint: 'https://fcm.googleapis.com/fcm/send/renewed' });
    await p.evaluate(() => localStorage.setItem('pc:push', JSON.stringify({ id: 'sub_old12345', ep: 'https://fcm.googleapis.com/fcm/send/old', h: '1:x' })));
    hits.length = 0; await p.reload(); await p.waitForSelector('.pc');
    await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); await p.waitForTimeout(1500);
    ok('시작: 주소가 바뀌었고 알림이 없으면 빈 POST 없이 옛 id DELETE + 브라우저 구독 해지', !hits.some((x) => x.m === 'POST') && hits.some((x) => x.m === 'DELETE' && x.u === '/v1/push/subscribe/sub_old12345')
      && (await log(p)).unsub === 1 && await p.evaluate(() => !JSON.parse(localStorage.getItem('pc:push') || 'null')), hits.map((x) => x.m + ' ' + x.u).join(','));
    ok('시작: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 9) '끄기' while the Worker is down (DELETE 503): the id waits on the phone (pc:pushDel) and goes again at the next start
  //    (chat A's request 2026-10-16) — the screen is off at once, the server row does not stay behind
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY });
    await watchX24(p);
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    const failDel = (route) => (route.request().method() === 'DELETE' ? route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '' }) : route.fallback());
    await ctx.route(`${API}/**`, failDel);
    hits.length = 0;
    await pushBtn(p, '가격 알림 끄기').click(); await p.waitForTimeout(800);
    const queued = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:pushDel') || '[]'));
    ok('끄기 중 서버 오류(503): 화면은 바로 꺼짐, id는 pc:pushDel에 남음', hits.some((x) => x.m === 'DELETE') && queued.length === 1 && queued[0] === SUB_ID
      && (await pushBtn(p, '가격 알림 받기').count()) === 1 && await p.evaluate(() => !JSON.parse(localStorage.getItem('pc:push') || 'null')), JSON.stringify(queued));
    // the next start (from home: a reload would stay on #saved, which has no home cards) — the Worker still down: the id
    // stays and goes once, not in a loop. The retry runs before the permission check (the fake resets it on each page).
    const nextStart = async () => { hits.length = 0; await p.goto(BASE); await p.waitForSelector('.pc');
      await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); await p.waitForTimeout(1500); };
    await nextStart();
    const still = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:pushDel') || '[]'));
    ok('다음 시작에도 503: id는 남고 DELETE는 1번만', hits.filter((x) => x.m === 'DELETE').length === 1 && still.length === 1 && still[0] === SUB_ID, hits.map((x) => x.m + ' ' + x.u).join(',') + ' left=' + JSON.stringify(still));
    await ctx.unroute(`${API}/**`, failDel);
    hits.length = 0; await p.goto(BASE); await p.waitForSelector('.pc');
    await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); await p.waitForTimeout(1500);
    const left = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:pushDel') || '[]'));
    ok('다음 시작: 남은 id를 다시 DELETE → 성공하면 목록 비움, 새 구독·POST 없음', hits.filter((x) => x.m === 'DELETE' && x.u === `/v1/push/subscribe/${SUB_ID}`).length === 1
      && left.length === 0 && !hits.some((x) => x.m === 'POST'), hits.map((x) => x.m + ' ' + x.u).join(',') + ' left=' + JSON.stringify(left));
    ok('끄기 다시 보내기: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 10) the page leaves while the DELETE is still on its way (a weak connection): the id was written before the request, so
  //     the next start sends it again
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY });
    await watchX24(p);
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    const held = [];
    const hang = (route) => (route.request().method() === 'DELETE' ? held.push(route) : route.fallback());
    await ctx.route(`${API}/**`, hang);
    await pushBtn(p, '가격 알림 끄기').click(); await p.waitForTimeout(300);
    const mid = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:pushDel') || '[]'));
    ok('끄기 직후(DELETE 대기 중): 화면은 꺼짐, id는 이미 pc:pushDel에', held.length === 1 && mid.length === 1 && mid[0] === SUB_ID && (await pushBtn(p, '가격 알림 받기').count()) === 1, JSON.stringify(mid));
    await ctx.unroute(`${API}/**`, hang);
    hits.length = 0; await p.goto(BASE); await p.waitForSelector('.pc');
    await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); await p.waitForTimeout(1500);
    const left = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:pushDel') || '[]'));
    ok('페이지를 떠난 뒤 다음 시작: 그 id를 DELETE, 목록 비움', hits.some((x) => x.m === 'DELETE' && x.u === `/v1/push/subscribe/${SUB_ID}`) && left.length === 0, hits.map((x) => x.m + ' ' + x.u).join(',') + ' left=' + JSON.stringify(left));
    ok('대기 중 떠남: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 11) an id in use is never deleted: the list holds the id this phone is subscribed with (the Worker handed it out again)
  { const EP = 'https://fcm.googleapis.com/fcm/send/e2e-test';
    const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY }, 'granted', 200, { perm: 'granted', endpoint: EP });
    await watchX24(p);
    await p.evaluate(([id, ep]) => { localStorage.setItem('pc:push', JSON.stringify({ id, ep, h: '1:x' })); localStorage.setItem('pc:pushDel', JSON.stringify([id])); }, [SUB_ID, EP]);
    hits.length = 0; await p.goto(BASE); await p.waitForSelector('.pc');
    await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); await p.waitForTimeout(1500);
    const st = await p.evaluate(() => ({ push: JSON.parse(localStorage.getItem('pc:push') || 'null'), del: JSON.parse(localStorage.getItem('pc:pushDel') || '[]') }));
    ok('쓰는 중인 id가 목록에 있어도 DELETE 없음, 목록에서만 빠지고 구독은 그대로', !hits.some((x) => x.m === 'DELETE') && st.del.length === 0 && st.push && st.push.id === SUB_ID, hits.map((x) => x.m + ' ' + x.u).join(',') + ' ' + JSON.stringify(st));
    ok('쓰는 중인 id: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 12) start: the public key was replaced (config.js has the new one, the browser's subscription was made with the old):
  //     take it back, subscribe with the new key, POST the new endpoint, and DELETE the old id once the new one is in (#85 ②)
  { const OLD_EP = FCM + 'oldkey';
    const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY }, 'granted', 200, { perm: 'granted', endpoint: OLD_EP, key: OLDKEY });
    await watchX24(p);
    await p.evaluate((ep) => localStorage.setItem('pc:push', JSON.stringify({ id: 'sub_old12345', ep, h: '1:x' })), OLD_EP);
    await restart(p, hits);
    const l = await log(p), k = await kept(p), eps = posted(hits);
    ok('키 바뀜(시작): 옛 키 구독 해지 → 새 키로 구독 → 새 endpoint POST → 새 id', l.unsubEp.join() === OLD_EP && l.subscribe.length === 1 && l.subscribe[0].key === KEY
      && eps.length === 1 && eps[0] !== OLD_EP && k && k.id === SUB_ID && k.ep === eps[0], JSON.stringify({ l, k, eps }));
    ok('키 바뀜(시작): 옛 id는 새 id를 받은 뒤 DELETE, 옛 endpoint는 다시 POST하지 않음', hits.some((x) => x.m === 'DELETE' && x.u === '/v1/push/subscribe/sub_old12345')
      && hits.findIndex((x) => x.m === 'DELETE') > hits.findIndex((x) => x.m === 'POST') && !eps.includes(OLD_EP), hits.map((x) => x.m + ' ' + x.u).join(','));
    ok('키 바뀜(시작): 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 13) start with the same key: nothing is made again (no unsubscribe, subscribe or POST)
  { const EP = FCM + 'samekey';
    const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY }, 'granted', 200, { perm: 'granted', endpoint: EP, key: KEY });
    await watchX24(p);
    await p.evaluate((ep) => localStorage.setItem('pc:push', JSON.stringify({ id: 'sub_same1234', ep, h: '1:x' })), EP);
    await restart(p, hits);
    const l = await log(p), k = await kept(p);
    ok('같은 키(시작): 해지·새 구독·POST 없음, id 그대로', l.unsub === 0 && l.subscribe.length === 0 && !hits.some((x) => x.m === 'POST' || x.m === 'DELETE') && k && k.id === 'sub_same1234',
      JSON.stringify({ l, k }) + ' ' + hits.map((x) => x.m + ' ' + x.u).join(','));
    ok('같은 키: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 14) '받기' with a subscription left in the browser that was made with the old key (permission not given at start, so the
  //     start left it): taken back first, then a new one with the key in config.js
  { const OLD_EP = FCM + 'oldkey';
    const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY }, 'granted', 200, { perm: 'default', endpoint: OLD_EP, key: OLDKEY });
    await watchX24(p);
    hits.length = 0;
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    const l = await log(p), k = await kept(p), eps = posted(hits);
    ok('키 바뀜(받기): 남은 옛 키 구독 해지 → 새 키로 구독 → 그 endpoint만 POST', l.unsubEp.join() === OLD_EP && l.subscribe.length === 1 && l.subscribe[0].key === KEY
      && eps.length === 1 && eps[0] !== OLD_EP && k && k.ep === eps[0] && (await pushBtn(p, '가격 알림 끄기').count()) === 1, JSON.stringify({ l, k, eps }));
    ok('키 바뀜(받기): 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 15) PUT 404 (the Worker dropped the row): a new browser subscription and a new id, once per run; a second 404 in the
  //     same run turns it off; '받기' then makes another one — no endpoint is ever POSTed twice
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY });
    await watchX24(p);
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    const first = (await kept(p) || {}).ep;
    const w = worker(404, ['sub_new23456', 'sub_new34567']);
    await ctx.route(`${API}/**`, w);
    hits.length = 0;
    await watchX24(p, 'X12'); await p.waitForTimeout(1500);   // the rules change → PUT → 404
    let l = await log(p), k = await kept(p), eps = posted(hits);
    ok('404: 브라우저 구독 해지 → 새로 구독 → 새 endpoint POST → 새 id, 켜짐 그대로', hits.some((x) => x.m === 'PUT' && x.u === `/v1/push/rules/${SUB_ID}`) && l.unsubEp.join() === first
      && l.subscribe.length === 2 && eps.length === 1 && eps[0] !== first && k && k.id === 'sub_new23456' && k.ep === eps[0] && (await pushBtn(p, '가격 알림 끄기').count()) === 1,
      JSON.stringify({ l, k, eps }) + ' ' + hits.map((x) => x.m + ' ' + x.u).join(','));
    ok('404: 그 id는 DELETE하지 않음(서버에 이미 없음)', !hits.some((x) => x.m === 'DELETE'), hits.map((x) => x.m + ' ' + x.u).join(','));
    const second = k && k.ep;
    hits.length = 0;
    await p.locator('#main button[aria-label$="알림 해지"]').first().click(); await p.waitForTimeout(1500);   // PUT → 404 again
    l = await log(p); k = await kept(p);
    ok('404 두 번째(같은 실행): 다시 만들지 않고 끔, 받기 버튼', hits.some((x) => x.m === 'PUT' && x.u === '/v1/push/rules/sub_new23456') && !hits.some((x) => x.m === 'POST')
      && l.subscribe.length === 2 && !k && (await pushBtn(p, '가격 알림 받기').count()) === 1, JSON.stringify({ l, k }) + ' ' + hits.map((x) => x.m + ' ' + x.u).join(','));
    hits.length = 0;
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    l = await log(p); k = await kept(p); eps = posted(hits);
    ok('404 뒤 받기: 남은(404 받은) 구독은 다시 쓰지 않고 해지 → 새로 구독 → 새 endpoint POST', l.unsubEp.join() === [first, second].join() && l.subscribe.length === 3
      && eps.length === 1 && ![first, second].includes(eps[0]) && k && k.id === 'sub_new34567', JSON.stringify({ l, k, eps }));
    ok('404: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 16) PUT 404 and the new POST fails: off as before, and the subscription made for it taken back
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY });
    await watchX24(p);
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    await ctx.route(`${API}/**`, worker(404, [null]));
    hits.length = 0;
    await watchX24(p, 'X12'); await p.waitForTimeout(1500);
    const l = await log(p);
    ok('404 + POST 실패: 끔(id 지움), 새로 만든 구독도 해지, 받기 버튼', hits.filter((x) => x.m === 'POST').length === 1 && l.subscribe.length === 2 && l.unsub === 2
      && !(await kept(p)) && (await pushBtn(p, '가격 알림 받기').count()) === 1, JSON.stringify(l) + ' ' + hits.map((x) => x.m + ' ' + x.u).join(','));
    ok('404 + POST 실패: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // 17) a branch product's '이벤트 종료 3일 전' next to a 지켜보기: only the 지켜보기 is sent, the product's end is checked on
  //     the phone and the panel says so
  { const { ctx, p, hits, errs } = await start(b, { alertsApi: API, pushPublicKey: KEY });
    await watchX24(p);
    // a real product that has comparison keys (the app used to send expiring for each of them)
    const row = await p.evaluate(() => { const { D, BR, ROWS } = App.state();
      const r = ROWS.find((x) => BR[x[0]] && (D.s[x[7]] || '').trim());
      const row = { n: D.s[r[2]], br: `${D.meta.brands[BR[r[0]].brand][0]}|${BR[r[0]].name}` };
      const a = JSON.parse(localStorage.getItem('pc:alerts') || '[]');
      a.push({ id: 'e2e-row-exp', created: '2026-10-20', type: 'expiring', row }); localStorage.setItem('pc:alerts', JSON.stringify(a));
      return { ...row, keys: D.s[r[7]] }; });
    await restart(p, hits);
    await p.evaluate(() => { location.hash = '#saved'; }); await p.waitForTimeout(600);
    const note = await p.locator('#main .nfp').innerText().catch(() => '');
    await pushBtn(p, '가격 알림 받기').click(); await p.waitForTimeout(800);
    const post = hits.find((x) => x.m === 'POST');
    let rules = null; try { rules = JSON.parse(post.body).rules; } catch (e) { /* checked below */ }
    ok('지점 상품 종료 전 알림: 서버 규칙 없음(expiring 0), 지켜보기만 보냄', rules && rules.length >= 1 && !rules.some((r) => r.kind === 'expiring') && rules.every((r) => r.key === 'X24'), JSON.stringify({ row, rules }));
    ok("지점 상품 종료 전 알림: 패널에 '이 기기에서 앱을 열 때만'으로 셈", /1개는 이 기기에서 앱을 열 때만 알려요\([^)]*이벤트 종료 3일 전/.test(note), note.replace(/\s+/g, ' ').slice(0, 200));
    ok('지점 상품 종료 전 알림: 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
