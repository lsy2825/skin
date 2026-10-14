// "Taps that do nothing" — a full sweep of every screen (2026-10-15, after reports that taps in the app often do not work).
// Three ways a tap can be lost, each checked on every route, on two phone sizes, with the cart bar and an undo toast up:
//  1. covered    — something else is on top of the control's centre (elementFromPoint after scrolling it into view)
//  2. redraw     — a text/number box whose change/focusout redraws the page swallows the next tap: type, then tap another
//                  control with a real mouse; the tap must arrive (a node replaced between pointerdown and pointerup gets no
//                  click event)
//  3. dead       — looks tappable (cursor:pointer / role=button) but is no button, link or form control and has no click
//                  listener on itself or an ancestor (CDP DOMDebugger.getEventListeners)
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/clickable.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const ROUTES = ['home', 'explore', 'compare?k=X12', 'compare', `search/${encodeURIComponent('리쥬란')}`, 'table', 'rank', 'versus', 'change', 'guide', 'concern', 'map',
  'branch/0', 'cart', 'saved', 'me', 'about', 'principles', 'quick', 'terms', 'import'];
const VIEWPORTS = [{ width: 375, height: 667 }, { width: 390, height: 844 }];
const INTERACTIVE = 'button, a[href], select, input:not([type=hidden]), textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox], [onclick]';

async function open(b, vp, prep) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE);
  if (prep) await p.evaluate(prep);
  await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForFunction(() => window.App && window.App.Data && window.App.Data.SYNC.have, null, { timeout: 60000 });
  return { ctx, p, errs };
}
const go = async (p, route) => { await p.evaluate((r) => { location.hash = '#' + r; }, route); await p.waitForTimeout(700); };

// 1) every visible control: scrolled to the middle of the screen, is it what a tap at its centre reaches?
async function covered(p) {
  return p.evaluate((SEL) => {
    const out = [], els = [...document.querySelectorAll(SEL)].filter((e) => e.offsetParent !== null && !e.disabled && !e.closest('.gate, [hidden], details:not([open]) > :not(summary)'));
    const id = (e) => e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}` : 'null';
    for (const e of els.slice(0, 350)) {
      const r0 = e.getBoundingClientRect();
      if (r0.width < 2 || r0.height < 2) continue;
      e.scrollIntoView({ block: 'center', inline: 'center' });
      const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === e || e.contains(hit)) continue;
      if (hit.contains(e) && getComputedStyle(e).pointerEvents !== 'none') continue;   // a label wrapping its control, and the like
      if (e.tagName === 'INPUT' && hit.tagName === 'LABEL' && hit.contains(e)) continue;
      out.push(`${id(e)} '${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20)}' ← ${id(hit)}`);
    }
    scrollTo(0, 0);
    return out;
  }, INTERACTIVE);
}

// 2) type in each text/number box, then tap the next control below it with a real mouse: did the tap arrive?
async function redraw(p) {
  const n = await p.evaluate(() => [...document.querySelectorAll('#main input[type=number], #main input[type=text], #main input[type=search], #main input:not([type]), #main textarea')].filter((e) => e.offsetParent !== null).length);
  const lost = [];
  for (let i = 0; i < Math.min(n, 6); i++) {
    const res = await p.evaluate((i) => {
      const inputs = [...document.querySelectorAll('#main input[type=number], #main input[type=text], #main input[type=search], #main input:not([type]), #main textarea')].filter((e) => e.offsetParent !== null);
      const inp = inputs[i];
      if (!inp) return null;
      // the next tappable thing after the box that does not navigate away or open a sheet (a chip, a toggle, a sort button…)
      const all = [...document.querySelectorAll('#main button, #main [role=tab], #main [role=radio]')].filter((b) => b.offsetParent !== null && !b.disabled && (inp.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
      const btn = all.find((b) => !/담기|삭제|지우기|비우기|열기|보기|저장|공유|신고|이동|찾기|다시/.test(b.textContent || '')) || all[0];
      if (!btn) return null;
      window.__tap = { label: (btn.getAttribute('aria-label') || btn.textContent || '').trim().slice(0, 24), got: false };
      btn.setAttribute('data-tapcheck', '1');
      btn.addEventListener('click', () => { window.__tap.got = true; }, { capture: true });
      inp.scrollIntoView({ block: 'center' }); inp.focus();
      return { inp: inp.getAttribute('aria-label') || inp.placeholder || inp.name || 'input', label: window.__tap.label };
    }, i);
    if (!res) continue;
    await p.keyboard.type('12345');
    const box = await p.locator('[data-tapcheck="1"]').first().boundingBox().catch(() => null);
    if (!box) continue;
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await p.waitForTimeout(400);
    const got = await p.evaluate(() => window.__tap && window.__tap.got);
    if (!got) lost.push(`'${res.inp}' 입력 뒤 '${res.label}' 누름이 사라짐`);
    await p.evaluate(() => { const b = document.querySelector('[data-tapcheck]'); if (b) b.removeAttribute('data-tapcheck'); });
  }
  return lost;
}

// 3) looks tappable, does nothing: cursor:pointer / role=button that is not a native control and has no click listener up the tree
async function dead(p, cdp) {
  const cands = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#main *').forEach((e, i) => {
      if (e.offsetParent === null || e.closest('button, a[href], select, input, textarea, summary, label')) return;
      const cs = getComputedStyle(e);
      if (cs.cursor === 'pointer' || e.getAttribute('role') === 'button') { e.setAttribute('data-deadcheck', String(i)); out.push(String(i)); }
    });
    return out.slice(0, 80);
  });
  const found = [];
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  for (const k of cands) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-deadcheck="${k}"]` });
    if (!nodeId) continue;
    let node = nodeId, has = false, label = '';
    for (let up = 0; up < 12 && node && !has; up++) {
      const { object } = await cdp.send('DOM.resolveNode', { nodeId: node });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: object.objectId });
      if (listeners.some((l) => /^(click|pointerdown|pointerup|mousedown|mouseup|touchstart|touchend)$/.test(l.type))) has = true;
      if (!label) label = (await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){return this.tagName+"."+(this.className||"")+" \'"+(this.textContent||"").trim().slice(0,20)+"\'"}', returnByValue: true })).result.value;
      const d = await cdp.send('DOM.describeNode', { nodeId: node });
      node = d.node.parentId;
    }
    if (!has) found.push(label);
  }
  await p.evaluate(() => document.querySelectorAll('[data-deadcheck]').forEach((e) => e.removeAttribute('data-deadcheck')));
  return found;
}

(async () => {
  const b = await chromium.launch();
  const cartPrep = () => { localStorage.clear(); localStorage.setItem('pc:carts', JSON.stringify([{ name: '내 장바구니', items: [{ t: 'k', k: 'X12', n: 1 }] }])); localStorage.setItem('pc:ci', '0'); };
  const summary = { covered: new Map(), redraw: [], dead: new Map(), errors: [] };
  for (const vp of VIEWPORTS) for (const [state, prep] of [['기본', () => localStorage.clear()], ['장바구니 띠', cartPrep]]) {
    const { ctx, p, errs } = await open(b, vp, prep);
    const cdp = await ctx.newCDPSession(p); await cdp.send('DOM.enable');
    for (const route of ROUTES) {
      await go(p, route);
      const broke = await p.locator('#main').innerText().then((t) => /그리다가 문제가 생겼어요/.test(t)).catch(() => false);
      if (broke) summary.errors.push(`${route} (${vp.width}) 화면 오류`);
      for (const c of await covered(p)) { const k = `${route} · ${c}`; summary.covered.set(k, (summary.covered.get(k) || []).concat(`${vp.width}/${state}`)); }
      if (vp.width === 390 && state === '기본') {
        for (const l of await redraw(p)) summary.redraw.push(`${route} · ${l}`);
        for (const d of await dead(p, cdp)) { const k = `${route} · ${d}`; summary.dead.set(k, true); }
      }
    }
    // the undo toast over the tabs: while it shows, the tabs under it must still take taps
    await go(p, 'home');
    await p.evaluate(() => window.App.undoToast('지웠어요', () => {}));
    const under = await p.evaluate(() => { const out = []; for (const t of document.querySelectorAll('#tabs button')) { const r = t.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (hit !== t && !t.contains(hit)) out.push(t.textContent.trim()); } return out; });
    if (under.length) summary.covered.set(`토스트 표시 중 아래 탭 (${vp.width}/${state})`, under);
    summary.errors.push(...errs.map((e) => `${vp.width}/${state}: ${e}`));
    await ctx.close();
  }
  console.log('--- 가려진 컨트롤');
  for (const [k, v] of summary.covered) console.log(`  ${k}  [${[].concat(v).join(', ')}]`);
  console.log('--- 다시 그리기로 사라진 누름'); summary.redraw.forEach((x) => console.log('  ' + x));
  console.log('--- 눌러 보이지만 반응 없는 요소'); [...summary.dead.keys()].forEach((x) => console.log('  ' + x));
  ok('가려진 컨트롤 없음', summary.covered.size === 0, `${summary.covered.size}건`);
  ok('입력 뒤 다음 누름이 사라지지 않음', summary.redraw.length === 0, `${summary.redraw.length}건`);
  ok('눌러 보이는데 반응 없는 요소 없음', summary.dead.size === 0, `${summary.dead.size}건`);
  ok('화면 오류·스크립트 오류 없음', summary.errors.length === 0, summary.errors.slice(0, 5).join(' | '));
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`TOTAL ${pass}/${R.length} PASS`);
  process.exit(pass === R.length ? 0 : 1);
})();
