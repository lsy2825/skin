// 종 버튼 알림 패널 (2026-10-20 사용자 요청) in a real browser. The top bar's bell (#notibtn) opens the latest 알림 기록 right
// under the bar instead of only going to 관심 탭:
//  1. 열기: the panel (#notip, role=dialog '가격 알림 기록') sits right under the top bar inside the screen; the bell says
//     aria-expanded=true and names the panel; focus goes into it (its title, with no ring — not a control). The latest 5
//     notes, newest first, '최근 5개 · 모두 N개'
//  2. 읽음: opening reads every note (the bell's count #me-n goes, the stored notes are read, the bell's name loses
//     '안 읽은 알림 N개'), and the lines that were new keep the '새 알림' dot while it stays open — none the next time
//  3. 줄 내용: kind badge · treatment · real branch · before → after · '날짜 수집' · '가격 보기' (named by its treatment)
//  4. 닫기: the bell again and Esc (focus back on the bell), a tap outside (that tap still does what it was for — a tab
//     opens its screen), a new screen; '가격 보기' → that compare screen, '전체 보기' → 관심 탭, closed, focus on the page.
//     Focus leaving it closes it too: Tab out of it — the control focused then is not hidden under it (WCAG 2.4.11);
//     Shift+Tab from its title is the bell (still open), once more is out (closed, focus stays there). A tap on its own text
//     keeps it open, and Esc after that sends focus to the bell
//  5. 같은 모양: the panel's lines are 관심 탭's 알림 기록 lines — the same elements, classes and computed type/colour/spacing
//  6. 빈 기록: 관심 탭's empty line word for word. Type steps (13·15·17·22, 400·600·760) and 24px targets in the panel
//  7. 320px (dark) and 320×568: inside the screen, nothing wider than the panel, no sideways scroll; above the tab bar and
//     scrolling inside when the lines do not fit
//  8. 휴대폰 알림을 눌러 들어올 때 (sw.js): a cold start on '#saved?bell=1' (openWindow) opens 관심 탭 with the panel — its
//     title focused before any tap has no ring either, as opened from the bell — the mark
//     leaves the address (a reload, back or the remembered last screen do not open it again); a record checkAlerts makes once
//     the price file is in shows in the open panel with its dot and is read; the open window's message {type:'nav', to:'saved',
//     panel:true} does the same (the message listener needs localhost or https: run on 'localhost'), a message without
//     panel only goes to 관심 탭; render() while it is open brings a new record in
//  9. axe on the open panel (light and dark) when AXE is set
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> [AXE=…/axe.min.js] node tests/e2e/bell_panel.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 260)}`); };
const EMPTY = '아직 기록이 없어요. 알림 가격이 바뀌면 여기에 남아요.';
// 7 records, newest first, the first 3 new (the stored shape of app.js noteOf: 'pc:notes')
const N = (o) => ({ at: '2026-10-20', obs: '2026-10-19', type: 'drop', k: 'X01', name: '', b: '', before: null, after: null, text: '', id: 'a' + Math.random().toString(36).slice(2, 7), read: true, ...o });
const NOTES = [
  N({ type: 'drop', k: 'X01', name: '국산 사각턱 보톡스 50U', b: '블리비|강남역점', before: 39000, after: 29000, text: '국산 사각턱 보톡스 50U — 가격 하락: 최저가가 39,000원 → 29,000원', read: false }),
  N({ type: 'lowbranch', k: 'X02', name: '국산 주름 보톡스 1부위', b: '블리비|건대점', after: 9900, text: '국산 주름 보톡스 1부위 — 최저가 지점 변경: 블리비 건대점', read: false }),
  N({ type: 'target', k: 'X03', name: '국산 얼굴전체 스킨보톡스', after: 99000, text: '국산 얼굴전체 스킨보톡스 — 목표가 120,000원 이하: 지금 99,000원', read: false }),
  N({ at: '2026-10-13', obs: '2026-10-12', type: 'past', k: 'X12', name: '지난 기록 시술', b: '블리비|경기 광주점', before: 120000, after: 99000, text: 'x', past: true }),
  N({ at: '2026-10-13', obs: '2026-10-12', type: 'newmatch', k: 'X24', name: '파는 곳 는 시술', text: '파는 곳 는 시술 — 새 비교 가능 지점: 3곳 → 4곳' }),
  N({ at: '2026-10-06', obs: '2026-10-05', type: 'drop', k: 'X01', name: '여섯째', b: '블리비|강남역점', before: 40000, after: 39000, text: '여섯째 — 가격 하락: 최저가가 40,000원 → 39,000원' }),
  { at: '2026-10-01', obs: '', type: 'test', name: '알림 시험', text: '시험 알림을 보냈어요(실제 가격 변화 아님)', read: true },
];
const ready = (p) => p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 90000 });
async function open(b, { vp = { width: 390, height: 844 }, scheme = 'light', notes = NOTES, alerts = null, base = BASE, hash = '', axe = false } = {}) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: true, hasTouch: true, colorScheme: scheme, bypassCSP: axe });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(base); await p.evaluate(([n, a]) => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('수도권')); localStorage.setItem('pc:notes', JSON.stringify(n));
    if (a) localStorage.setItem('pc:alerts', JSON.stringify(a)); }, [notes, alerts]);
  // a cold start on the address (as a tapped notification's openWindow): a new document, not a hash change
  if (hash) { await p.goto('about:blank'); await p.goto(base + hash); } else await p.reload();
  if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await ready(p); await p.waitForTimeout(400);
  return { ctx, p, errs };
}
// what the panel and the bell say now
const state = (p) => p.evaluate(() => {
  const el = document.querySelector('#notip'), btn = document.querySelector('#notibtn'), top = document.querySelector('header.top').getBoundingClientRect();
  const r = el && el.getBoundingClientRect(), stored = JSON.parse(localStorage.getItem('pc:notes') || '[]'), ae = document.activeElement;
  return { open: !!el, exp: btn.getAttribute('aria-expanded'), ctl: btn.getAttribute('aria-controls'), label: btn.getAttribute('aria-label'), badge: document.querySelector('#me-n').hidden ? '' : document.querySelector('#me-n').textContent,
    hash: location.hash, focus: ae === btn ? 'bell' : ae && ae.id === 'main' ? 'main' : el && el.contains(ae) ? 'panel' : (ae && ae.tagName) || '',
    role: el && el.getAttribute('role'), name: el && (document.getElementById(el.getAttribute('aria-labelledby')) || {}).textContent,
    rows: el ? el.querySelectorAll('ul.notes > li').length : 0, dots: el ? [...el.querySelectorAll('ul.notes > li')].map((li) => li.querySelector('.dot[aria-label="새 알림"]') ? 1 : 0).join('') : '',
    count: el ? (el.querySelector('.row .sub') || {}).textContent : null, more: el ? (el.querySelector('.morelist') || {}).textContent : null,
    rect: r ? { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) } : null, topBottom: Math.round(top.bottom),
    unreadStored: stored.filter((x) => !x.read).length, nStored: stored.length, view: (document.querySelector('#tabs button[aria-current="page"]') || {}).dataset?.tab || '' };
});
const bell = async (p) => { await p.click('#notibtn'); await p.waitForTimeout(300); };

(async () => { const b = await chromium.launch();
  // ---------------- 1-6 · 390×844 light, on 홈
  { const { ctx, p, errs } = await open(b);
    const s0 = await state(p);
    ok('0 닫힌 상태: 종에 안 읽은 수 3, 이름에 \'안 읽은 알림 3개\', aria-expanded=false, 패널 없음', !s0.open && s0.badge === '3' && s0.label === '가격 알림, 안 읽은 알림 3개' && s0.exp === 'false' && !s0.ctl, JSON.stringify(s0));
    await bell(p);
    const s1 = await state(p);
    ok('1 열기: 위쪽 바 바로 아래, 화면 안, role=dialog \'가격 알림 기록\', 종 aria-expanded=true·aria-controls=notip, 초점은 패널 안',
      s1.open && s1.role === 'dialog' && s1.name === '가격 알림 기록' && s1.exp === 'true' && s1.ctl === 'notip' && s1.focus === 'panel'
      && Math.abs(s1.rect.top - s1.topBottom) <= 1 && s1.rect.left >= 0 && s1.rect.right <= 390, JSON.stringify(s1));
    ok('1 최근 5개(최신이 앞), \'최근 5개 · 모두 7개\', 맨 아래 \'전체 보기\', 주소는 그대로', s1.rows === 5 && s1.count === '최근 5개 · 모두 7개' && /^전체 보기$/.test((s1.more || '').trim()) && (s1.hash === '' || s1.hash === '#home'), JSON.stringify(s1));
    ok('2 펼치면 읽음: 종의 숫자 없어짐, 저장된 기록 모두 읽음, 종 이름에서 안 읽은 수 빠짐', s1.badge === '' && s1.unreadStored === 0 && s1.nStored === 7 && s1.label === '가격 알림', JSON.stringify(s1));
    ok('2 이번에 새것이던 3줄만 \'새 알림\' 점', s1.dots === '11100', s1.dots);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#notip ul.notes > li')].map((li) => ({ t: li.innerText.replace(/\s+/g, ' ').trim(), go: (li.querySelector('.linkbtn') || {}).ariaLabel || '', hist: !!li.querySelector('svg.i'), kind: (li.querySelector('.k.k4') || {}).textContent || '' })));
    // the data date 'M/D 수집' like every screen date (U04)
    ok('3 첫 줄: 종류·시술·지점·이전 → 이후·수집일·가격 보기', /가격 하락/.test(rows[0].t) && /국산 사각턱 보톡스 50U/.test(rows[0].t) && /블리비 강남역점/.test(rows[0].t) && /39,000원 → 29,000원/.test(rows[0].t)
      && /(^| )10\/19 수집/.test(rows[0].t) && !/\d{4}-\d{2}-\d{2}/.test(rows[0].t) && /가격 보기/.test(rows[0].t) && rows[0].go === '국산 사각턱 보톡스 50U 가격 보기', JSON.stringify(rows[0]));
    ok('3 종류 배지: 가격 하락·최저가 지점 변경·목표가 이하·지난 기록·새 비교 가능 지점, 지난 기록은 시계 아이콘', rows.map((r) => r.kind).join('|') === '가격 하락|최저가 지점 변경|목표가 이하|지난 기록|새 비교 가능 지점' && rows[3].hist, rows.map((r) => r.kind + (r.hist ? '*' : '')).join('|'));
    // keyboard: the next Tab from the panel's title is its first line's '가격 보기'
    await p.keyboard.press('Tab'); const tab1 = await p.evaluate(() => { const a = document.activeElement; return !!a.closest('#notip') && a.textContent === '가격 보기'; });
    ok('1 키보드: 제목 다음 Tab은 패널 첫 줄의 \'가격 보기\'', tab1);
    // close: the bell again → focus back on the bell
    await bell(p); const s2 = await state(p);
    ok('4 종을 다시 누르면 닫힘, aria-expanded=false, aria-controls 없음, 초점은 종', !s2.open && s2.exp === 'false' && !s2.ctl && s2.focus === 'bell', JSON.stringify(s2));
    await bell(p); const s3 = await state(p);
    ok('2 다시 열면 새 알림 점 없음(이미 읽음), 숫자도 없음', s3.open && s3.dots === '00000' && s3.badge === '', s3.dots);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200); const s4 = await state(p);
    ok('4 Esc로 닫힘, 초점은 종', !s4.open && s4.exp === 'false' && s4.focus === 'bell', JSON.stringify(s4));
    // keyboard: Enter on the bell, then Tab through the panel and out of it — it closes as focus leaves, and the control
    // focused then is seen, not under the panel (WCAG 2.4.11)
    await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    const ring = await p.evaluate(() => { const t = document.querySelector('#notip-t'); return { on: document.activeElement === t, fv: t.matches(':focus-visible'), outline: getComputedStyle(t).outlineStyle }; });
    const walk = [];
    for (let i = 0; i < 14; i++) {
      await p.keyboard.press('Tab'); await p.waitForTimeout(80);
      const w = await p.evaluate(() => { const a = document.activeElement, el = document.querySelector('#notip'), r = a.getBoundingClientRect();
        const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { open: !!el, inPanel: !!(el && el.contains(a)), el: `${a.tagName}.${a.className} ${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 16)}`,
          seen: !!t && (t === a || a.contains(t)), exp: document.querySelector('#notibtn').getAttribute('aria-expanded') }; });
      walk.push(w); if (!w.inPanel) break; }
    const wOut = walk[walk.length - 1];
    ok('4 키보드: Enter로 열면 제목에 초점(테두리 없음), Tab으로 패널 밖에 나가면 닫히고 초점 받은 칸이 가려지지 않음',
      ring.on && ring.outline === 'none' && walk.length >= 2 && walk.slice(0, -1).every((w) => w.inPanel && w.open) && !wOut.inPanel && !wOut.open && wOut.exp === 'false' && wOut.seen,
      JSON.stringify({ ring, steps: walk.length, out: wOut }));
    await bell(p); await p.keyboard.press('Shift+Tab'); await p.waitForTimeout(80); const sb1 = await state(p);
    await p.keyboard.press('Shift+Tab'); await p.waitForTimeout(80); const sb2 = await state(p), sbEl = await p.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    ok('4 Shift+Tab: 제목 앞은 종(패널 그대로), 한 번 더면 닫히고 초점은 그 버튼에 그대로', sb1.open && sb1.focus === 'bell' && !sb2.open && sb2.exp === 'false' && sb2.focus !== 'bell' && /btn$/.test(sbEl),
      `${sbEl} ${JSON.stringify(sb1)} ${JSON.stringify(sb2)}`);
    // a tap on the panel's own text (no control): it stays open; Esc then closes it and focus goes to the bell
    await bell(p);
    const tp = await p.evaluate(() => { const r = document.querySelector('#notip ul.notes > li .sub').getBoundingClientRect(); return { x: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2) }; });
    await p.mouse.click(tp.x, tp.y); await p.waitForTimeout(200); const st1 = await state(p);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200); const st2 = await state(p);
    ok('4 패널 안 글자를 누르면 그대로 열림, 그다음 Esc는 닫고 초점은 종', st1.open && st1.exp === 'true' && !st2.open && st2.focus === 'bell', `${JSON.stringify(st1)} ${JSON.stringify(st2)}`);
    // a tap outside on nothing tappable: the page's left gutter beside the panel
    await bell(p);
    const pt = await p.evaluate(() => { const r = document.querySelector('#notip').getBoundingClientRect(), x = 3, y = Math.round(r.top + 120), e = document.elementFromPoint(x, y);
      return { x, y, inPanel: !!(e && e.closest('#notip')), tappable: !!(e && e.closest('button, a, input, select, label, summary')), el: e && e.tagName + '.' + e.className }; });
    await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(250); const s5 = await state(p);
    ok('4 패널 바깥(누를 것 없는 곳)을 누르면 닫힘, 화면은 그대로', !pt.inPanel && !pt.tappable && !s5.open && s5.exp === 'false' && (s5.hash === '' || s5.hash === '#home'), `${JSON.stringify(pt)} ${JSON.stringify(s5)}`);
    // a tap outside on a control: it closes and the tap still works (the 탐색 tab opens 탐색)
    await bell(p); await p.click('#tabs button[data-tab="explore"]'); await p.waitForTimeout(500); const s6 = await state(p);
    ok('4 바깥의 탭을 누르면 닫히고 그 탭도 열림(누름이 사라지지 않음)', !s6.open && s6.hash === '#explore' && s6.view === 'explore', JSON.stringify(s6));
    // a new screen some other way (the address)
    await bell(p); await p.evaluate(() => { location.hash = '#cart'; }); await p.waitForTimeout(500); const s7 = await state(p);
    ok('4 다른 화면으로 이동하면 닫힘', !s7.open && s7.exp === 'false' && s7.hash === '#cart', JSON.stringify(s7));
    // '가격 보기' and '전체 보기'
    await bell(p); await p.locator('#notip ul.notes > li').first().locator('.linkbtn').click(); await p.waitForTimeout(600); const s8 = await state(p);
    ok('4 \'가격 보기\' → 그 시술 비교 화면, 패널 닫힘, 초점은 화면', !s8.open && s8.hash === '#compare?k=X01' && s8.focus === 'main', JSON.stringify(s8));
    await bell(p); await p.locator('#notip .morelist').click(); await p.waitForTimeout(600); const s9 = await state(p);
    ok('4 \'전체 보기\' → 관심 탭, 패널 닫힘', !s9.open && s9.hash === '#saved' && s9.view === 'saved', JSON.stringify(s9));
    // 5: the same lines as 관심 탭's 알림 기록 (all read now: no dot on either side)
    await bell(p);
    const same = await p.evaluate(() => {
      const sig = (e) => `${e.tagName}.${[...e.classList].sort().join('.')}${e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''}(${[...e.children].map(sig).join(',')})`;
      const all = (e) => [e, ...e.querySelectorAll('*')];
      const P = ['fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'columnGap', 'rowGap', 'borderRadius'];
      const st = (e) => P.map((k) => getComputedStyle(e)[k]).join(' ');
      const pl = [...document.querySelectorAll('#notip ul.notes > li')], ml = [...document.querySelectorAll('#main ul.notes > li')].slice(0, pl.length);
      const pu = document.querySelector('#notip ul.notes'), mu = document.querySelector('#main ul.notes');
      const diff = [];
      pl.forEach((li, i) => { const m = ml[i]; if (!m) { diff.push(`${i}: 관심 탭에 없음`); return; }
        if (sig(li) !== sig(m)) diff.push(`${i}: 모양 ${sig(li).slice(0, 80)} ≠ ${sig(m).slice(0, 80)}`);
        if (li.innerText !== m.innerText) diff.push(`${i}: 글자`);
        const a = all(li), c = all(m); a.forEach((e, j) => { if (c[j] && st(e) !== st(c[j])) diff.push(`${i}.${j} ${e.tagName}.${e.className}: ${st(e)} ≠ ${st(c[j])}`); }); });
      return { n: pl.length, ul: [pu.className, mu.className, st(pu) === st(mu)], diff: diff.slice(0, 4) };
    });
    ok('5 관심 탭 알림 기록 줄과 같은 모양: 같은 요소·클래스·글자, 같은 크기·굵기·색·여백', same.n === 5 && same.ul[0] === 'list notes' && same.ul[1] === 'list notes' && same.ul[2] && !same.diff.length, JSON.stringify(same));
    // 6: type steps and touch targets inside the panel
    const ts = await p.evaluate(() => {
      const bad = [], sizes = new Set();
      for (const e of document.querySelectorAll('#notip, #notip *')) {
        if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const cs = getComputedStyle(e), fs = Math.round(parseFloat(cs.fontSize)), fw = +cs.fontWeight; sizes.add(fs);
        if (![13, 15, 17, 22].includes(fs) || ![400, 600, 760].includes(fw)) bad.push(`${e.tagName}.${e.className} ${fs}/${fw}`); }
      const tbad = [];
      for (const e of document.querySelectorAll('#notip button')) { e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === e || e.contains(t)); };
        if (!((r.height >= 24 || (hit(cx, cy - 11) && hit(cx, cy + 11))) && (r.width >= 24 || (hit(cx - 11, cy) && hit(cx + 11, cy))))) tbad.push(`${e.textContent} ${Math.round(r.width)}x${Math.round(r.height)}`); }
      // the lines scroll between the title and '전체 보기': both stay at the panel's edges
      const el = document.querySelector('#notip'), sc = el.querySelector('.notip-b'), mb = el.querySelector('.morelist'), tt = el.querySelector('#notip-t'); sc.scrollTop = 1e6;
      const more = mb.getBoundingClientRect().height, pinned = Math.abs(mb.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom) <= 2
        && tt.getBoundingClientRect().top >= el.getBoundingClientRect().top; sc.scrollTop = 0;
      return { bad, sizes: [...sizes].sort(), tbad, more, pinned, scrolls: sc.scrollHeight > sc.clientHeight + 1 };
    });
    ok('6 패널 글자 13·15·17·22, 굵기 400·600·760', !ts.bad.length, `${ts.sizes.join(',')} ${ts.bad.slice(0, 4).join(' | ')}`);
    ok('6 패널 버튼 누르는 곳 24px 이상, \'전체 보기\' 44px 이상', !ts.tbad.length && ts.more >= 44, `${ts.tbad.join(' | ')} 전체 보기 ${ts.more}px`);
    ok('6 줄이 패널보다 길어도 제목과 \'전체 보기\'는 패널 위·아래 끝에 보임', ts.pinned, JSON.stringify({ scrolls: ts.scrolls, pinned: ts.pinned }));
    // render() while it is open: a new record comes in with its dot and is read at once
    await p.evaluate(() => { App.st.notes.unshift({ at: '2026-10-20', obs: '2026-10-19', type: 'drop', k: 'X02', name: '새로 온 기록', b: '블리비|건대점', before: 12000, after: 9900, text: '새로 온 기록 — 가격 하락: 최저가가 12,000원 → 9,900원', id: 'n1', read: false }); App.render(); });
    await p.waitForTimeout(300); const s10 = await state(p), first = await p.evaluate(() => document.querySelector('#notip ul.notes > li').innerText);
    ok('8 열린 채 render(): 새 기록이 맨 위에 점과 함께, 바로 읽음(숫자 없음)', s10.open && /새로 온 기록/.test(first) && s10.dots === '10000' && s10.badge === '' && s10.unreadStored === 0 && s10.count === '최근 5개 · 모두 8개', JSON.stringify(s10));
    ok('오류 없음(390)', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // ---------------- 6 · empty
  { const { ctx, p, errs } = await open(b, { notes: [] });
    await bell(p); const s = await state(p), txt = await p.evaluate(() => (document.querySelector('#notip > .notip-b') || {}).innerText || '');
    await p.locator('#notip .morelist').click(); await p.waitForTimeout(600);
    const savedTxt = await p.evaluate(() => [...document.querySelectorAll('#main .card .empty.one')].map((e) => e.textContent).find((t) => t.startsWith('아직 기록이')) || '');   // emptyLine (U01)
    ok('6 기록이 없을 때: 관심 탭 빈 문구 그대로(패널 = 관심 탭), 줄·개수 없음', s.open && s.rows === 0 && s.count === '' && txt.trim() === EMPTY && savedTxt === EMPTY, `${JSON.stringify(txt)} / ${JSON.stringify(savedTxt)}`);
    ok('오류 없음(빈 기록)', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // ---------------- 7 · 320 dark, 320×568
  for (const vp of [{ width: 320, height: 844 }, { width: 320, height: 568 }]) {
    const { ctx, p, errs } = await open(b, { vp, scheme: 'dark' });
    await bell(p);
    const m = await p.evaluate(() => {
      const el = document.querySelector('#notip'), sc = el.querySelector('.notip-b'), r = el.getBoundingClientRect(), tabs = document.querySelector('nav.tabs').getBoundingClientRect();
      const wide = [...el.querySelectorAll('*')].filter((e) => { const x = e.getBoundingClientRect(); return x.width && (x.right > r.right + 0.5 || x.left < r.left - 0.5); }).map((e) => `${e.tagName}.${e.className}`);
      return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), tabsTop: Math.round(tabs.top), sw: document.documentElement.scrollWidth, inner: Math.max(el.scrollWidth - el.clientWidth, sc.scrollWidth - sc.clientWidth),
        scrolls: sc.scrollHeight > sc.clientHeight + 1, overflowY: getComputedStyle(sc).overflowY, more: !!el.querySelector('.morelist') && el.querySelector('.morelist').getBoundingClientRect().bottom <= r.bottom + 1,
        bg: getComputedStyle(el).backgroundColor, wide: wide.slice(0, 4) };
    });
    ok(`7 ${vp.width}×${vp.height} 어둡게: 화면 안(좌우 8px), 가로 넘침 없음, 패널 안 넘침 없음, 아래 탭 위`, m.left >= 0 && m.right <= vp.width && m.sw <= vp.width && m.inner <= 0 && !m.wide.length && m.bottom <= m.tabsTop, JSON.stringify(m));
    if (vp.height < 700) ok('7 낮은 화면: 다 들어가지 않으면 줄만 패널 안에서 스크롤, \'전체 보기\'는 보임', m.scrolls && m.overflowY === 'auto' && m.more, JSON.stringify(m));
    else ok('7 어두운 패널 바탕 = 카드 바탕(--surface 어둡게)', m.bg === 'rgb(29, 27, 24)', m.bg);
    ok(`오류 없음(${vp.width}×${vp.height})`, !errs.length, errs.join(' | '));
    await ctx.close(); }

  // ---------------- 8 · a tapped phone notification: the address sw.js opens (cold start)
  { const { ctx, p, errs } = await open(b, { hash: '#saved?bell=1' });
    const s = await state(p), last = await p.evaluate(() => localStorage.getItem('pc:lastRoute'));
    ok('8 \'#saved?bell=1\'로 열면: 관심 탭 + 패널 열림, 새 알림 점·읽음, 주소의 표시는 지워짐', s.open && s.view === 'saved' && s.hash === '#saved' && s.dots === '11100' && s.badge === '' && s.unreadStored === 0, JSON.stringify(s));
    const ring8 = await p.evaluate(() => { const t = document.querySelector('#notip-t'); return { on: document.activeElement === t, fv: t.matches(':focus-visible'), outline: getComputedStyle(t).outlineStyle }; });
    ok('8 누르기 전에 연 패널도 제목에 초점 테두리 없음(종으로 열 때와 같은 모양)', ring8.on && ring8.outline === 'none', JSON.stringify(ring8));
    ok('8 마지막 화면 기억에도 표시가 남지 않음', !/bell/.test(last || ''), last);
    await p.reload(); await ready(p); await p.waitForTimeout(400); const r1 = await state(p);
    ok('8 새로 고침하면 패널이 다시 열리지 않음', !r1.open && r1.hash === '#saved', JSON.stringify(r1));
    await p.evaluate(() => { location.hash = '#explore'; }); await p.waitForTimeout(400); await p.goBack(); await p.waitForTimeout(500); const r2 = await state(p);
    ok('8 뒤로 가기로 관심 탭에 와도 패널이 다시 열리지 않음', !r2.open && r2.hash === '#saved', JSON.stringify(r2));
    ok('오류 없음(알림 주소)', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // the record is made at the start (checkAlerts, after the full price file): the panel opened first shows it with its dot
  { const probe = await open(b, { notes: [] });
    const k = await probe.p.evaluate(() => { const s = App.state(), m = s.D.meta, moved = new Set([...(m.recl || []), ...(m.reclBuilt || [])].flatMap((x) => x[1] || []));
      return (s.KEYS.find((x, i) => !moved.has(x.id) && s.byKB[i] && s.byKB[i].size) || {}).id; });
    await probe.ctx.close();
    const alerts = [{ id: 't1', created: '2026-10-01', type: 'target', k, target: 99999999, basis: 'listed', reg: '수도권', sp: true }];
    const { ctx, p, errs } = await open(b, { notes: [], alerts, hash: '#saved?bell=1' });
    const s = await state(p), row = await p.evaluate(() => (document.querySelector('#notip ul.notes > li') || {}).innerText || '');
    ok('8 앱을 막 열 때 생긴 기록(checkAlerts)도 열린 패널에 점과 함께, 읽음', !!k && s.open && s.view === 'saved' && s.rows === 1 && s.dots === '1' && /목표가 이하/.test(row) && s.badge === '' && s.unreadStored === 0 && s.nStored === 1, `${k} ${JSON.stringify(s)} ${row.replace(/\s+/g, ' ')}`);
    ok('오류 없음(시작 때 기록)', !errs.length, errs.join(' | '));
    await ctx.close(); }
  // the open window's message (sw.js postMessage) — the app listens on localhost / https only
  { const base = BASE.replace('127.0.0.1', 'localhost'), host = new URL(base).hostname;
    if (host !== 'localhost') console.log(`SKIP | 8 열린 창 메시지 — ${host}에서는 앱이 서비스 워커 메시지를 듣지 않음`);
    else {
      const { ctx, p, errs } = await open(b, { base });
      const send = (data) => p.evaluate((d) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: d })), data);
      await send({ type: 'nav', to: 'saved' }); await p.waitForTimeout(500); const a = await state(p);
      ok('8 패널 표시 없는 메시지: 관심 탭으로만(패널 안 열림)', a.hash === '#saved' && a.view === 'saved' && !a.open, JSON.stringify(a));
      // 관심 탭 reads the records itself 1.5 s after it is drawn: wait that out, then the first three are new again
      await p.waitForTimeout(1700); await p.evaluate(() => { App.st.notes.forEach((x, i) => { x.read = i >= 3; }); location.hash = '#home'; }); await p.waitForTimeout(400);
      await send({ type: 'nav', to: 'saved', panel: true }); await p.waitForTimeout(500); const c = await state(p);
      ok('8 {type:\'nav\', to:\'saved\', panel:true}: 관심 탭 + 패널 열림, 주소에 표시 없음, 읽음', c.open && c.view === 'saved' && c.hash === '#saved' && c.dots === '11100' && c.badge === '', JSON.stringify(c));
      await p.keyboard.press('Escape'); await send({ type: 'nav', to: 'https://evil.test/', panel: true }); await p.waitForTimeout(400); const d = await state(p);
      ok('8 다른 곳으로 가라는 메시지는 무시', !d.open && d.hash === '#saved', JSON.stringify(d));
      ok('오류 없음(메시지)', !errs.length, errs.join(' | '));
      await ctx.close();
    }
  }

  // ---------------- 9 · axe on the open panel
  if (process.env.AXE) {
    const axe = require('fs').readFileSync(process.env.AXE, 'utf8'); const found = []; let ran = 0;
    for (const scheme of ['light', 'dark']) {
      const { ctx, p } = await open(b, { scheme, axe: true });
      await bell(p); await p.addScriptTag({ content: axe });
      const v = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })).violations.map((x) => `${x.id}(${x.nodes.length}: ${x.nodes[0].target.join(' ')})`));
      found.push(...v.map((x) => `${scheme}:${x}`)); ran++;
      await ctx.close();
    }
    ok('9 열린 패널 axe 위반 없음(밝게·어둡게)', ran === 2 && !found.length, `${ran}/2 ${found.join(' ')}`);
  } else console.log('SKIP | 9 axe(열린 패널) — AXE 환경 변수가 없어 건너뜀');

  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
