// 시술별 비교 '카드' view in a real browser: the same clinics in the same order as the list, swipeable without widening
// the page (320 px), previous/next buttons, price evidence from a card, the choice remembered, and the neutral default
// order kept (no rank numbers, not cheapest-first). A card's three actions at 320·360·390·414 (사용자 결정 2026-10-20 — in one
// row they were 60~68px wide at 360·390 and their words stacked a letter a line, main too): the branch head's grid of equal halves
// (.bbtns), 가격 근거 · 지점 보기 side by side and 비교함 across both under them (2+1); every button 36 high with its words on one
// line and nothing cut, '비교함에 있음' (pressed) too; 비교함, across both halves, keeps its ✓ / ⊕ at 320 too (검토 2026-10-20 — the
// halves hide theirs there); on every card the buttons sit 16px or more under its last line, at its foot, at the same height.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/compare_cards.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const num = (t) => +String(t).replace(/[^\d]/g, '');

(async () => { const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 320, height: 720 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
  await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(500);
  const listNames = await p.$$eval('#clinics li.rk .b', (xs) => xs.map((x) => x.textContent.trim()));
  const listPrices = await p.$$eval('#clinics li.rk .rank .p', (xs) => xs.map((x) => x.textContent));
  ok('처음엔 목록 보기', (await p.locator('#clinics .seg.vsw button[aria-pressed="true"]').textContent()) === '목록' && listNames.length > 5);
  await p.locator('#clinics .seg.vsw button', { hasText: '카드' }).click(); await p.waitForTimeout(400);
  const cardNames = await p.$$eval('#clinics .ccard .ccard-h b', (xs) => xs.map((x) => x.textContent.trim()));
  const cardPrices = await p.$$eval('#clinics .ccard .ccard-p', (xs) => xs.map((x) => x.childNodes[0].textContent));
  ok('카드 = 목록과 같은 지점·같은 순서', JSON.stringify(cardNames) === JSON.stringify(listNames), `${cardNames.length}장`);
  ok('카드 가격 = 목록 가격', cardPrices.length === listPrices.length && cardPrices.every((x, i) => num(x) === num(listPrices[i])));
  ok('기본 순서는 가격순 아님(지역·이름순)', !cardPrices.map(num).every((v, i, a) => !i || a[i - 1] <= v));
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok('320px에서 페이지가 옆으로 넓어지지 않음', wide <= 0, `${wide}px`);
  const sc = p.locator('#clinics .ccards');
  ok('카드 줄은 옆으로 넘길 수 있음', await sc.evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).scrollSnapType.includes('x')));
  const x0 = await sc.evaluate((e) => e.scrollLeft);
  await p.locator('#clinics button[aria-label="다음 지점"]').click(); await p.waitForTimeout(700);
  const x1 = await sc.evaluate((e) => e.scrollLeft);
  ok('다음 버튼으로 한 장 넘어감', x1 > x0, `${x0} → ${x1}`);
  await p.locator('#clinics button[aria-label="이전 지점"]').click(); await p.waitForTimeout(700);
  ok('이전 버튼으로 돌아옴', await sc.evaluate((e) => e.scrollLeft) < x1);
  await p.locator('#clinics .ccard').first().locator('button', { hasText: '가격 정보' }).click(); await p.waitForTimeout(300);
  ok('카드에서 가격 정보 열림(정품 표기·부작용 줄 포함)', /정품 표기/.test(await p.locator('.sheet').innerText()) && /부작용·주의사항/.test(await p.locator('.sheet').innerText()));
  await p.keyboard.press('Escape');
  ok('카드에 순위 번호 없음(n/N은 장 번호)', await p.locator('#clinics .ccard .rank').count() === 0 && /^1\/\d+$/.test((await p.locator('#clinics .ccard .ccard-h .tiny').first().textContent()).trim()));
  await p.reload(); await p.waitForTimeout(800);
  if (await p.locator('#gate-pad').isVisible()) { for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForTimeout(800); }
  ok('새로고침해도 카드 보기 유지', await p.locator('#clinics .ccard').count() > 0);
  await p.locator('#clinics .sortchips .chip', { hasText: '낮은 가격순' }).click(); await p.waitForTimeout(400);
  const asc = await p.$$eval('#clinics .ccard .ccard-p', (xs) => xs.map((x) => +x.childNodes[0].textContent.replace(/[^\d]/g, '')));
  ok('정렬을 바꾸면 카드 순서도 바뀜(낮은 가격순)', asc.every((v, i, a) => !i || a[i - 1] <= v));
  await p.locator('#clinics .seg.vsw button', { hasText: '목록' }).click(); await p.waitForTimeout(300);
  ok('목록으로 되돌리기', await p.locator('#clinics li.rk').count() > 0 && await p.locator('#clinics .ccard').count() === 0);
  await ctx.close();
  // the card's actions at four widths: one line each, 2+1 grid
  const acts = () => [...document.querySelectorAll('#clinics .ccard')].slice(0, 3).map((c) => { const a = c.querySelector('.ccard-a'), ar = a.getBoundingClientRect();
    const bs = [...a.children].map((x) => { const r = x.getBoundingClientRect();
      // the lines its words take: the distinct tops of its text's boxes (a word stacked a letter a line has one top per letter)
      const tops = new Set(); for (const t of [...x.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())) { const rg = document.createRange(); rg.selectNodeContents(t);
        for (const q of rg.getClientRects()) if (q.width > 0) tops.add(Math.round(q.top)); }
      const ic = x.querySelector(':scope > svg.i'), icon = !!ic && getComputedStyle(ic).display !== 'none' && ic.getBoundingClientRect().width > 0;
      return { t: x.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left - ar.left), y: Math.round(r.top - ar.top), lines: tops.size, cut: x.scrollWidth > x.clientWidth + 1, icon }; });
    return { aw: Math.round(ar.width), bs }; });
  // every card: the gap from its last line to the first button, how far the buttons are from the card's top, and from its inner foot
  const foot = () => [...document.querySelectorAll('#clinics .ccard')].map((c) => { const a = c.querySelector('.ccard-a'), cr = c.getBoundingClientRect(), ar = a.getBoundingClientRect(), cs = getComputedStyle(c);
    return { gap: a.firstElementChild.getBoundingClientRect().top - a.previousElementSibling.getBoundingClientRect().bottom, top: ar.top - cr.top,
      foot: cr.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth) - ar.bottom }; });
  const footOk = (fs) => fs.length > 1 && fs.every((f) => f.gap >= 15.5 && Math.abs(f.foot) <= 1) && Math.max(...fs.map((f) => f.top)) - Math.min(...fs.map((f) => f.top)) <= 1;
  const showFoot = (fs) => `${fs.length}장 · 간격 ${Math.round(Math.min(...fs.map((f) => f.gap)))}~${Math.round(Math.max(...fs.map((f) => f.gap)))} · 위에서 ${Math.round(Math.min(...fs.map((f) => f.top)))}~${Math.round(Math.max(...fs.map((f) => f.top)))} · 바닥까지 ${Math.round(Math.max(...fs.map((f) => Math.abs(f.foot))))}`;
  const shapeOk = (c) => { const [g, s, k] = c.bs; return c.bs.length === 3 && c.bs.every((x) => x.h >= 36 && x.h <= 40 && x.lines === 1 && !x.cut)
    && g.y === s.y && Math.abs(g.w - s.w) <= 1 && g.x === 0 && Math.abs(s.x + s.w - c.aw) <= 1 && k.y >= g.y + g.h && k.x === 0 && Math.abs(k.w - c.aw) <= 1 && /^비교함/.test(k.t) && k.icon; };
  const show = (cs) => cs.slice(0, 1).map((c) => `판 ${c.aw} · ` + c.bs.map((x) => `${x.t} ${x.w}×${x.h} ${x.lines}줄${x.cut ? ' 잘림' : ''}${x.icon ? ' 아이콘' : ''}`).join(' / ')).join('');
  for (const W of [320, 360, 390, 414]) {
    const c2 = await b.newContext({ serviceWorkers: 'block', viewport: { width: W, height: 800 } }); const q = await c2.newPage(); q.on('pageerror', (e) => errs.push(e.message));
    await q.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await q.goto(BASE); await q.evaluate(() => localStorage.clear()); await q.reload();
    for (const d of PIN) await q.click(`#gate-pad button[data-d="${d}"]`); await q.waitForSelector('.pc');
    await q.goto(BASE + '#compare?k=X12'); await q.waitForTimeout(500);
    await q.locator('#clinics .seg.vsw button', { hasText: '카드' }).click(); await q.waitForTimeout(400);
    const m = await q.evaluate(acts);
    ok(`${W}px 카드 버튼: 가격 근거·지점 보기 같은 폭 반반, 비교함은 그 아래 한 줄 전체(2+1, 아이콘 그대로), 모두 높이 36·글자 한 줄·잘림 없음`, m.length === 3 && m.every(shapeOk), show(m));
    const fs = await q.evaluate(foot);
    ok(`${W}px 카드 버튼은 모든 카드에서 마지막 줄 아래 16px 이상, 카드 맨 아래, 카드마다 같은 높이`, footOk(fs), fs.length ? showFoot(fs) : '카드 없음');
    await q.locator('#clinics .ccard').first().locator('.shortbtn').click(); await q.waitForTimeout(300);
    const m2 = await q.evaluate(acts);
    ok(`${W}px 카드 '비교함에 있음'(누른 뒤)도 한 줄, 같은 격자`, /비교함에 있음/.test(m2[0].bs[2].t) && shapeOk(m2[0]), show(m2));
    const wide = await q.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(`${W}px 카드 보기에서 페이지가 옆으로 넓어지지 않음`, wide <= 0, `${wide}px`);
    await c2.close();
  }
  ok('스크립트 오류 없음', !errs.length, errs.join(' '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
