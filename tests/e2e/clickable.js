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
// a sheet a tap opened stays open when only the query changes (compare?k=… → compare is the same page): close it first
const closeSheets = (p) => p.evaluate(() => { for (let i = 0; i < 5 && document.querySelector('.sheet-bg'); i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
const go = async (p, route) => { await closeSheets(p); await p.evaluate((r) => { location.hash = '#' + r; }, route); await p.waitForTimeout(700); };

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
      // (not the box's own suggestion list: typing replaces or hides it on purpose)
      const all = [...document.querySelectorAll('#main button, #main [role=tab], #main [role=radio]')].filter((b) => b.offsetParent !== null && !b.disabled && !b.closest('.suggest') && !(b.closest('details:not([open])') && !b.closest('summary')) && (inp.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
      const btn = all.find((b) => !/담기|삭제|지우기|비우기|열기|보기|저장|공유|신고|이동|찾기|다시/.test(b.textContent || '')) || all[0];
      if (!btn) return null;
      // judged on the whole document: a press (pointerdown) with no click event anywhere = a lost tap; a click on something
      // with other text = a tap that landed elsewhere (the control moved or was replaced while the finger was down)
      const label = (btn.getAttribute('aria-label') || btn.textContent || '').trim().slice(0, 24);
      window.__tap = { label, down: 0, clicks: [] };
      if (!window.__tapHooked) {
        window.__tapHooked = true;
        document.addEventListener('pointerdown', () => { window.__tap.down++; }, true);
        document.addEventListener('click', (e) => { const c = e.target.closest('button, a, [role=tab], [role=radio], label, summary') || e.target; window.__tap.clicks.push((c.getAttribute('aria-label') || c.textContent || '').trim().slice(0, 24)); }, true);
      }
      btn.setAttribute('data-tapcheck', '1');
      inp.scrollIntoView({ block: 'center' }); inp.focus();
      return { inp: inp.getAttribute('aria-label') || inp.placeholder || inp.name || 'input', label: window.__tap.label };
    }, i);
    if (!res) continue;
    await p.keyboard.type('12345');
    // bring the control on screen without moving focus off the box (a tap outside the viewport would land on <html>)
    await p.evaluate(() => { const b = document.querySelector('[data-tapcheck="1"]'); if (b) b.scrollIntoView({ block: 'center' }); });
    await p.waitForTimeout(100);
    const box = await p.locator('[data-tapcheck="1"]').first().boundingBox().catch(() => null);
    if (!box) continue;
    await p.evaluate(() => { window.__tap.down = 0; window.__tap.clicks = []; });
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await p.waitForTimeout(400);
    const t = await p.evaluate(() => window.__tap);
    if (t.down && !t.clicks.length) lost.push(`'${res.inp}' 입력 뒤 '${res.label}' 누름이 사라짐(클릭 이벤트 없음)`);
    else if (t.clicks.length && !t.clicks.some((c) => c === res.label || c.startsWith(res.label.slice(0, 6)))) lost.push(`'${res.inp}' 입력 뒤 '${res.label}'을 눌렀는데 '${t.clicks[0]}'(으)로 감`);
    await p.evaluate(() => { const b = document.querySelector('[data-tapcheck]'); if (b) b.removeAttribute('data-tapcheck'); });
    await closeSheets(p);                               // the tapped control may have opened a sheet (방문일 → '언제 갈 거예요?')
  }
  return lost;
}

// 2b) the two places the lost tap was first found (2026-10-14): type a value, tap a chip on the same screen — the tap must
//     arrive AND the typed value must stay (price table min + a brand chip; cart budget + the next control)
async function stick(p) {
  const out = [];
  const tapAfter = async (inpSel, val, btnPick) => {
    const lab = await p.evaluate(({ inpSel, btnPick }) => {
      const inp = document.querySelector(inpSel);
      if (!inp) return null;
      const d = inp.closest('details'); if (d) d.open = true;
      // anywhere on the screen but the box's own group (the budget's quick amounts would set the budget themselves)
      const all = [...document.querySelectorAll('#main button')].filter((b) => b.offsetParent !== null && !b.disabled && !b.closest('.suggest') && !(b.closest('details:not([open])') && !b.closest('summary')) && !inp.parentElement.parentElement.contains(b));
      const btn = all.find((b) => new RegExp(btnPick).test(b.textContent || '')) || null;
      if (!btn) return null;
      btn.setAttribute('data-stick', '1');
      inp.scrollIntoView({ block: 'center' }); inp.focus();
      window.__stickClicks = [];
      document.addEventListener('click', (e) => { if (e.target.closest('[data-stick]')) window.__stickClicks.push(1); }, true);
      return (btn.textContent || '').trim().slice(0, 20);
    }, { inpSel, btnPick });
    if (!lab) return { lab: null };
    await p.keyboard.type(val);
    await p.evaluate(() => document.querySelector('[data-stick]').scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(100);
    const box = await p.locator('[data-stick]').first().boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await p.waitForTimeout(500);
    return { lab, arrived: await p.evaluate(() => window.__stickClicks.length > 0) };
  };
  await go(p, 'table');
  await p.evaluate(() => { const d = document.querySelector('#main details.stips'); if (d) d.open = true; });   // the '검색 팁' fold
  // a search example ('사각턱 50U') sets ?q= from the address: the min typed just before must stay with it
  let r = await tapAfter('#main input[aria-label="최소 가격"]', '50000', '^사각턱 50U$');
  if (!r.lab) out.push('가격표: 최소 가격 칸이나 검색 예시 버튼을 못 찾음');
  else {
    const hash = decodeURIComponent(await p.evaluate(() => location.hash));
    if (!r.arrived) out.push(`가격표: 최소 가격 입력 뒤 '${r.lab}' 누름이 사라짐`);
    if (!/[?&]min=50000/.test(hash) || !/[?&]q=사각턱/.test(hash.replace(/\+/g, ' '))) out.push(`가격표: 최소 가격과 '${r.lab}'이 함께 남지 않음 (${hash})`);
  }
  await p.evaluate(() => { localStorage.setItem('pc:carts', JSON.stringify([{ name: '내 장바구니', items: [{ t: 'k', k: 'X12', n: 1 }] }])); localStorage.setItem('pc:ci', '0'); });
  await go(p, 'home'); await p.reload();
  if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForFunction(() => window.App && window.App.Data && window.App.Data.SYNC.have, null, { timeout: 60000 });
  await go(p, 'cart');
  r = await tapAfter('#main input[aria-label="예산 상한(원)"]', '300000', '^(?!.*(만|없음|제한|삭제|비우기|지우기)).+');
  if (!r.lab) out.push('장바구니: 예산 칸이나 다음 버튼을 못 찾음');
  else {
    const budget = await p.evaluate(() => { try { const c = JSON.parse(localStorage.getItem('pc:carts')); return c[0].budget; } catch (e) { return null; } });
    if (!r.arrived) out.push(`장바구니: 예산 입력 뒤 '${r.lab}' 누름이 사라짐`);
    if (budget !== 300000) out.push(`장바구니: 예산 300000이 저장되지 않음 (${budget})`);
  }
  await closeSheets(p);
  return out;
}

// 3) looks tappable, does nothing: cursor:pointer / role=button that is not a native control and has no click listener up the tree
async function dead(p, cdp) {
  const cands = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#main *').forEach((e, i) => {
      if (e.offsetParent === null || e.closest('button, a[href], select, input, textarea, summary, label')) return;
      // map markers: Leaflet hands the tap to the marker from its own map-level handler (checked by hand 2026-10-14: a tap
      // on a branch dot opens its popup), so no listener sits on the dot itself
      if (e.closest('.leaflet-interactive, .leaflet-marker-icon')) return;
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
    if (vp.width === 390 && state === '기본') for (const l of await stick(p)) summary.redraw.push(l);
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
