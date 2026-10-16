// 개인정보 처리방침 화면(#privacy, C6)과 §4 화면 문장 — chat C writes the sentences in docs/legal/PRIVACY_POLICY_DRAFT.md and B
// puts them in as written (6.0 promise 6). The doc is read here at test time: a C edit the app has not copied fails.
//  a. as shipped (익명 집계 and 푸시 not set up): no way in (마이 menu, 내 설정, the 관심 tab's panel); #privacy typed by hand,
//     or opened from outside, is the 마이 screen; no page error
//  b. 집계 set up, 푸시 not: the 마이 row and the link under 내 설정's 집계 row; #privacy = §3-1 exactly, no §3-2
//  c. 푸시 set up, 집계 not: the link under the 관심 tab's push panel (off and on); #privacy = §3-2 exactly, no §3-1
//  d. both: §3-1 then §3-2 (and, with AXE set, no axe violation on #privacy and 마이 in light and dark)
//  e. 320px wide: nothing on #privacy (or 마이) is wider than the screen
//  f. 내 설정's 집계 row (switch name, the line under it, the 'off' toast) and the push panel's line are §4's sentences
// config.js and the page's CSP are rewritten in the test only and the servers faked, as in tests/e2e/metrics.js and push.js.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/privacy.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 240)}`); };
const MAPI = 'https://m.example.test', PAPI = 'https://alerts.example.test';   // made-up addresses: answered by the test
const KEY = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');   // a VAPID-shaped public key

// ---- the sentences, from chat C's doc
const DOC = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'legal', 'PRIVACY_POLICY_DRAFT.md'), 'utf8').split('\n');
const need = (v, what) => { if (!v) throw new Error(`PRIVACY_POLICY_DRAFT.md에서 ${what}을(를) 찾지 못했어요 — 문서 모양이 바뀌었으면 이 시험도 고쳐요`); return v; };
// §3-n: the '> ' lines of that part up to the next heading; for §3-1·§3-2 the first is the bold title
function quoted(head) {
  const i = need(DOC.findIndex((l) => l.startsWith(head)) + 1, head) - 1, L = [];
  for (let j = i + 1; j < DOC.length && !/^#{1,3} /.test(DOC[j]); j++) if (/^> /.test(DOC[j])) L.push(DOC[j].slice(2).trim());
  return L;
}
function part(head) {
  const [t, ...paras] = quoted(head);
  return { title: need(/^\*\*(.+)\*\*$/.exec(t || ''), `${head} 제목`)[1], paras: need(paras.length && paras, `${head} 문단`) };
}
// §4: the quoted lines right under one '- **이름…:**' item
function item(label) {
  const i = need(DOC.findIndex((l) => l.startsWith(`- **${label}`)) + 1, `§4 ${label}`) - 1, L = [];
  for (let j = i + 1; j < DOC.length && /^\s+> /.test(DOC[j]); j++) L.push(DOC[j].replace(/^\s+> /, '').trim());
  return need(L.length && L, `§4 ${label} 문장`);
}
const P1 = part('### 3-1.'), P2 = part('### 3-2.');
const P3 = need(quoted('### 3-3.').length && quoted('### 3-3.'), '§3-3 문장');   // not on the screen until the lawyer answers (§5-2)
const S4 = { metrics: item('집계 칸').join(' '), push: item('푸시 칸').join(' '), setting: item('알림 설정 설명').join(' ') };
// The switch's new name and the new 'off' toast are not '> ' lines: they sit inside C's 'please change … to …' sentence on 집계 칸's
// own line, and are cut out of it here. When C settles §4 that sentence may go or be reworded — then these two come out null and
// only their own checks (and the doc check) FAIL with '문서에서 읽지 못함'; the rest still runs. The PR asks C (부탁 → C) to put
// both on their own '  > ' lines under 집계 칸; once they are, read them like item() and drop the regexes.
const mline = DOC.find((l) => l.startsWith('- **집계 칸')) || '';
const swm = /스위치 이름 '([^']+?) \(([^)]+)\)'도 '\(([^)]+)\)'으로/.exec(mline);
const SWITCH = swm ? `${swm[1]} (${swm[3]})` : null;
const TOAST_OFF = (/끌 때 알림 '([^']+)'도 '([^']+)'로/.exec(mline) || [])[2] || null;
const unread = (what) => `문서 §4 집계 칸에서 ${what}을(를) 읽지 못함 — 문서 모양이 바뀌었으면 이 시험의 읽는 법도 고쳐요`;

async function start(b, { metrics = false, push = false, width = 390, scheme = 'light', axe = false } = {}) {
  // bypassCSP only for the axe pass: axe goes in as an inline script, which the app's CSP (rightly) refuses
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme, bypassCSP: axe });
  try { return await setup(ctx, metrics, push); } catch (e) { await ctx.close().catch(() => {}); throw e; }   // a start that fails leaves no window open
}
async function setup(ctx, metrics, push) {
  if (push) {
    // the browser's side faked as in push.js: a permission not asked yet, a push manager that subscribes in memory
    await ctx.addInitScript(() => {
      let permission = 'default', sub = null;
      function N() {}
      Object.defineProperty(N, 'permission', { get: () => permission });
      N.requestPermission = async () => { permission = 'granted'; return permission; };
      Object.defineProperty(window, 'Notification', { value: N, configurable: true, writable: true });
      const mk = () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-test', expirationTime: null,
        toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }; },
        async unsubscribe() { sub = null; return true; } });
      const reg = { pushManager: { getSubscription: async () => sub, subscribe: async () => { sub = mk(); return sub; } } };
      if (navigator.serviceWorker) navigator.serviceWorker.getRegistration = async () => reg;
    });
  }
  if (metrics || push) {
    await ctx.route((u) => u.pathname.endsWith('/config.js'), async (route) => { const res = await route.fetch(); let t = await res.text();
      if (metrics) t = t.replace('metrics: false,', 'metrics: true,').replace(/metricsApi: "[^"]*"/, `metricsApi: "${MAPI}"`);
      if (push) t = t.replace('alertsApi: ""', `alertsApi: "${PAPI}"`).replace('pushPublicKey: ""', `pushPublicKey: "${KEY}"`);
      await route.fulfill({ response: res, body: t }); });
    await ctx.route((u) => u.href === BASE || u.pathname.endsWith('/index.html'), async (route) => { const res = await route.fetch(); const t = await res.text();
      await route.fulfill({ response: res, body: t.replace("connect-src 'self'", `connect-src 'self' ${MAPI} ${PAPI}`) }); });
    await ctx.route(`${MAPI}/**`, (route) => route.fulfill({ status: 204, body: '' }));
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, PUT, DELETE', 'access-control-allow-headers': 'content-type' };
    await ctx.route(`${PAPI}/**`, (route) => { const m = route.request().method();
      if (m === 'POST') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'sub_12345678' }) });
      return route.fulfill({ status: 204, headers: cors, body: '' }); });
  }
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload(); await unlock(p);
  p.setDefaultTimeout(8000);   // after the first screen: a missing link or row fails in seconds, not Playwright's 30
  return { ctx, p, errs };
}
// one case: a throw (a link that is not there, a wait that runs out) is one FAIL line and the next case still runs
async function kase(b, name, opts, fn) {
  let s = null;
  try { s = await start(b, opts); await fn(s); } catch (e) { ok(`${name}: 중단`, false, String(e && e.message || e).split('\n')[0]); }
  finally { if (s) await s.ctx.close().catch(() => {}); }
}
// sel: something the first screen draws (the home's price cards; the 마이 screen has none)
async function unlock(p, sel = '.pc') {
  if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector(sel, { timeout: 60000 }); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
  await p.waitForTimeout(400);
}
const go = async (p, hash) => { await p.evaluate((x) => { location.hash = x; }, hash); await p.waitForTimeout(600); };
const mainText = (p) => p.locator('#main').innerText();
// the policy screen as drawn: its title and each part's heading + paragraphs, in order
const policy = (p) => p.evaluate(() => ({ title: (document.querySelector('#main h2.title') || {}).textContent || '',
  parts: [...document.querySelectorAll('#main .policy')].map((s) => ({ title: (s.querySelector('h3') || {}).textContent || '', paras: [...s.querySelectorAll('p')].map((x) => x.textContent) })) }));
const same = (got, want) => got.title === want.title && got.paras.length === want.paras.length && got.paras.every((x, i) => x === want.paras[i]);
const menuRow = (p) => p.locator('#main .menu button.item', { hasText: '개인정보 처리방침' });
const metricsRow = (p) => p.locator('#main .settings .setrow', { has: p.locator('label.switch', { hasText: '익명 이용 집계 보내기' }) });
const link = (scope) => scope.locator('button.linkbtn', { hasText: '처리방침 보기' });
// a 지켜보기 alert made the way a person makes it (compare → ⋯ → 가격 알림 → 알림 만들기), then the 관심 tab
async function watchX24(p) {
  await go(p, '#compare?k=X24'); await p.waitForTimeout(300);
  await p.locator('.cmphead .morebtn').click(); await p.waitForTimeout(200); await p.locator('.actsheet button', { hasText: '가격 알림' }).click(); await p.waitForTimeout(300);
  await p.locator('.sheet .btn', { hasText: '알림 만들기' }).click(); await p.waitForTimeout(400);
  await go(p, '#saved');
}
const tabMe = (p) => p.evaluate(() => (document.querySelector('#tabs button[aria-current="page"]') || {}).dataset.tab);
// the page does not scroll sideways, and nothing in #main sticks out of the screen (except inside its own sideways scroller)
const overflow = (p) => p.evaluate(() => { const w = document.documentElement.clientWidth;
  const inScroller = (e) => { for (let a = e.parentElement; a && a.id !== 'main'; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return true; return false; };
  const wide = [...document.querySelectorAll('#main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > w + 0.5 || r.left < -0.5) && !inScroller(e); });
  return { doc: document.documentElement.scrollWidth - w, n: wide.length, ex: wide.slice(0, 3).map((e) => `${e.tagName}.${e.className}`).join(' ') }; });

(async () => { const b = await chromium.launch();
  ok('문서: §3-1·§3-2 제목과 문단, §4 집계 칸·푸시 칸·알림 설정 설명·스위치 이름·끌 때 알림을 읽음',
    !!(P1.paras.length && P2.paras.length && S4.metrics && S4.push && S4.setting && SWITCH && TOAST_OFF),
    `${P1.title} ${P1.paras.length}문단 · ${P2.title} ${P2.paras.length}문단 · ${SWITCH || unread('스위치 이름')} · ${TOAST_OFF ? '끌 때 알림 읽음' : unread('끌 때 알림')}`);

  // a) as shipped
  await kase(b, '배포 그대로', {}, async ({ p, errs }) => {
    await go(p, '#me');
    const me = await mainText(p);
    ok('배포 그대로: 마이에 처리방침 줄·링크 없음(집계 줄도 없음)', !/처리방침/.test(me) && (await menuRow(p).count()) === 0 && (await metricsRow(p).count()) === 0, me.match(/.{0,20}처리방침.{0,20}/) || '');
    await watchX24(p);
    const saved = await mainText(p);
    ok('배포 그대로: 관심 탭 알림 칸에 처리방침 링크 없음(지금처럼 휴대폰 알림)', !/처리방침/.test(saved) && /휴대폰 알림/.test(await p.locator('#main .nfp').innerText()), saved.match(/.{0,20}처리방침.{0,20}/) || '');
    let none = true; for (const r of ['#home', '#about', '#principles']) { await go(p, r); if (/처리방침/.test(await mainText(p))) none = false; }
    ok('배포 그대로: 홈·데이터 상태·운영 원칙에도 처리방침 없음', none);
    // typed by hand: the 마이 screen through the normal render path, the same as #me
    await go(p, '#me'); const want = await mainText(p);
    await go(p, '#privacy');
    const got = await mainText(p), pol = await policy(p);
    ok('배포 그대로: #privacy를 직접 치면 마이 화면(#me와 같은 내용, 마이 탭), 처리방침 문장 없음', got === want && (await tabMe(p)) === 'me' && !pol.parts.length && !/개인정보 처리방침|윤실장이 어떻게 쓰이는지|관심 시술 가격 알림\(푸시\)/.test(got), `tab=${await tabMe(p)} same=${got === want}`);
    // opened from outside (a link, a bookmark): the same
    await p.goto(BASE + '#privacy'); await p.reload(); await unlock(p, '#main .settings');
    ok('배포 그대로: 밖에서 #privacy로 열어도 마이 화면', (await p.locator('#main .settings').count()) === 1 && (await tabMe(p)) === 'me' && !(await policy(p)).parts.length);
    ok('배포 그대로: 페이지 오류 없음', !errs.length, errs.join(' | '));
  });

  // b) 집계 set up, 푸시 not (+ f: the 집계 row's sentences)
  await kase(b, '집계만', { metrics: true }, async ({ p, errs }) => {
    await go(p, '#me');
    const row = menuRow(p);
    ok('집계만: 마이 메뉴에 개인정보 처리방침 줄(설명은 §3-1 제목)', (await row.count()) === 1 && await row.isVisible() && (await row.locator('.sub').innerText()).trim() === P1.title, (await row.count()) ? await row.innerText() : 'no row');
    const mr = metricsRow(p);
    const sw = (await mr.locator('label.switch').innerText()).trim();
    ok('§4 집계 칸: 스위치 이름 그대로', !!SWITCH && sw === SWITCH, SWITCH ? sw : unread('스위치 이름'));
    const sub = (await mr.locator(':scope > .sub').allInnerTexts()).map((x) => x.trim());
    ok('§4 집계 칸: 스위치 아래 문장 그대로', sub.length === 1 && sub[0] === S4.metrics, sub.join(' / '));
    ok('집계만: 집계 줄의 문장 아래 처리방침 보기 링크', (await link(mr).count()) === 1 && await link(mr).isVisible());
    await mr.locator('label.switch').click(); await p.waitForTimeout(250);
    const t = (await p.locator('#toast').innerText()).trim();
    ok('§4 집계 칸: 끌 때 알림 그대로', !!TOAST_OFF && t === TOAST_OFF, TOAST_OFF ? t : unread('끌 때 알림'));
    await metricsRow(p).locator('label.switch').click(); await p.waitForTimeout(250);   // back on
    await link(metricsRow(p)).click(); await p.waitForTimeout(600);
    const pol = await policy(p);
    ok('집계만: 링크 → #privacy, 제목 개인정보 처리방침', /#privacy$/.test(p.url()) && pol.title === '개인정보 처리방침' && (await tabMe(p)) === 'me', `${p.url()} ${pol.title}`);
    ok('집계만: §3-1 제목·문단이 문서와 글자까지 같음', pol.parts.length === 1 && same(pol.parts[0], P1), JSON.stringify(pol.parts.map((x) => x.title)));
    ok('집계만: §3-2(푸시)는 없음', !(await mainText(p)).includes(P2.title) && !P2.paras.some((x) => pol.parts.some((s) => s.paras.includes(x))));
    await p.locator('#main button.back').click(); await p.waitForTimeout(500);
    ok('집계만: 뒤로 → 마이', /#me$/.test(p.url()), p.url());
    await watchX24(p);
    ok('집계만: 관심 탭 알림 칸(푸시 꺼짐)에는 링크 없음', !/처리방침/.test(await p.locator('#main .nfp').innerText()));
    ok('집계만: 페이지 오류 없음', !errs.length, errs.join(' | '));
  });

  // c) 푸시 set up, 집계 not (+ f: the push panel's line)
  await kase(b, '푸시만', { push: true }, async ({ p, errs }) => {
    await go(p, '#me');
    ok('푸시만: 마이 메뉴에 개인정보 처리방침 줄(설명은 §3-2 제목), 내 설정엔 집계 줄·링크 없음', (await menuRow(p).count()) === 1 && (await menuRow(p).locator('.sub').innerText()).trim() === P2.title
      && (await metricsRow(p).count()) === 0 && (await link(p.locator('#main .settings')).count()) === 0);
    await watchX24(p);
    const nfp = p.locator('#main .nfp');
    const line = ((await nfp.locator('.sub').allInnerTexts())[0] || '').trim();
    ok('§4 알림 설정 설명 + 푸시 칸: 알림 칸(꺼짐) 문장이 그 순서 그대로', line.startsWith(`${S4.setting} ${S4.push}`), line);
    ok('푸시만: 알림 칸(꺼짐) 설명 아래 처리방침 보기 링크', (await link(nfp).count()) === 1 && await link(nfp).isVisible());
    await nfp.locator('button', { hasText: '가격 알림 받기' }).click(); await p.waitForTimeout(900);
    const onLine = ((await nfp.locator('.sub').allInnerTexts())[0] || '').trim();
    ok('푸시만: 켠 뒤(켜짐 줄에 §4 푸시 칸 문장)에도 링크', /^켜짐/.test(onLine) && onLine.includes(S4.push) && (await link(nfp).count()) === 1, onLine);
    await link(nfp).click(); await p.waitForTimeout(600);
    const pol = await policy(p);
    ok('푸시만: 링크 → #privacy, §3-2 제목·문단이 문서와 글자까지 같음', /#privacy$/.test(p.url()) && pol.title === '개인정보 처리방침' && pol.parts.length === 1 && same(pol.parts[0], P2), JSON.stringify(pol.parts.map((x) => x.title)));
    ok('푸시만: §3-1(집계)은 없음', !(await mainText(p)).includes(P1.title) && !P1.paras.some((x) => pol.parts.some((s) => s.paras.includes(x))));
    ok('푸시만: 페이지 오류 없음', !errs.length, errs.join(' | '));
  });

  // d) both
  await kase(b, '둘 다', { metrics: true, push: true }, async ({ p, errs }) => {
    await go(p, '#me');
    ok('둘 다: 마이 메뉴 줄 하나(설명은 §3-1 · §3-2 제목), 집계 줄 링크', (await menuRow(p).count()) === 1 && (await menuRow(p).locator('.sub').innerText()).trim() === `${P1.title} · ${P2.title}` && (await link(metricsRow(p)).count()) === 1);
    await menuRow(p).click(); await p.waitForTimeout(600);
    const pol = await policy(p);
    ok('둘 다: 마이 줄 → #privacy, §3-1 다음 §3-2, 둘 다 문서와 같음', /#privacy$/.test(p.url()) && pol.parts.length === 2 && same(pol.parts[0], P1) && same(pol.parts[1], P2), JSON.stringify(pol.parts.map((x) => x.title)));
    const all = await mainText(p);
    ok('둘 다: §3-3(복구 기록 한 줄)은 넣지 않음', P3.every((x) => !all.includes(x)), P3.join(' '));
    ok('둘 다: 페이지 오류 없음', !errs.length, errs.join(' | '));
  });
  if (process.env.AXE) {
    const axe = fs.readFileSync(process.env.AXE, 'utf8'); const found = [];
    let ran = 0;
    for (const scheme of ['light', 'dark']) await kase(b, `axe ${scheme}`, { metrics: true, push: true, scheme, axe: true }, async ({ p }) => {
      for (const r of ['#privacy', '#me']) {   // the screen, and 마이 with its row and the 집계 row's link
        await go(p, r); await p.addScriptTag({ content: axe });
        const v = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })).violations.map((x) => `${x.id}(${x.nodes.length})`));
        found.push(...v.map((x) => `${scheme}${r}:${x}`)); ran++; }
    });
    ok('둘 다: #privacy·마이 axe 위반 없음(밝게·어둡게)', ran === 4 && !found.length, `${ran}/4 ${found.join(' ')}`);
  } else console.log('SKIP | axe(#privacy·마이) — AXE 환경 변수가 없어 건너뜀');

  // e) 320px
  await kase(b, '320px', { metrics: true, push: true, width: 320 }, async ({ p, errs }) => {
    await go(p, '#privacy');
    const o = await overflow(p);
    ok('320px: #privacy 가로 넘침 없음', (await policy(p)).parts.length === 2 && o.doc <= 0 && o.n === 0, JSON.stringify(o));
    await go(p, '#me');
    const m = await overflow(p);
    ok('320px: 마이(처리방침 줄·집계 줄 링크) 가로 넘침 없음', m.doc <= 0 && m.n === 0, JSON.stringify(m));
    ok('320px: 페이지 오류 없음', !errs.length, errs.join(' | '));
  });
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
