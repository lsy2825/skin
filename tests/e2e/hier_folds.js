// 위계 점검 묶음 3-2 '접기' (hierarchy audit REPORT 순번 10·17·18·48·49): what folds, what stays in view, and that a fold
// the person opened stays open when the screen is drawn again (render() after a change)
//  10. 내 견적: the first screen carries the total — one line under '담은 시술 N개' with the summary card's numbers (won) and
//      the clinic count; a tap takes you and the focus to the summary card; no line with an empty cart, with one item (its own
//      line already shows the same range) or when no clinic has every item; the bottom bar keeps its own rule (hidden while the
//      card is still below)
//  18. 병원별 비교: '가격만으로 고르지 마세요…' sits between the tabs and the list; under the list the price basis is a dot line in
//      view and the two 'how the totals are made' sentences fold under '합계 계산 방법' — every sentence word for word
//  48. 견적 펼침: per line the conditions (badges), '병원 표시 … + VAT' and 출처 stay in view; the clinic's product name, the
//      later sessions' product and the option picker fold into '자세히' (at the line's right end, not stuck to '출처'); picking an
//      option there leaves it open
//  49. 마이: '데이터 안내' is a dot list, two in view + '자세히 · N개 더'; each 내 설정 row is one line '이름 · 지금: 값' that
//      opens to its controls, and stays open (with the new value) after a change; opened, every control is reached by a tap and
//      has a 24px hit area (clickable.js / touch_targets.js skip what sits in a closed fold)
//  17. 시술 비교 '가격과 함께 꼭 확인하세요': no icon column (the rows use the card's width), every word still shown, right after
//      the price card
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/hier_folds.js
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const asRows = require('./rows');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 240)}`); };
const D = asRows(require(path.join(__dirname, '../../app/data.json')));
const CART = [{ t: 'k', k: 'X14', q: 3 }, { t: 'k', k: 'X01', q: 2 }, { t: 'k', k: 'X12', q: 1 }];
const WARN = '가격만으로 고르지 마세요. 용량·조건·정품 여부·의료진·부작용은 담은 시술의 ⓘ에서 봐요.';
const CALC = ['체험가·한정가·첫 방문가는 첫 1회만, 2회째부터는 그 지점의 다른 가격으로 계산해요. 요일·시간 조건 가격은 조건이 맞을 때 매번 그 가격으로 계산해요.',
  '지점 이름을 누르면 시술별 견적이 펼쳐지고 옵션을 바꿀 수 있어요. 3회·5회 묶음을 고르면 횟수에 맞춰 계산해요.'];
const NAV_H = 64;
// two keys no clinic sells together (no branch in common anywhere): a cart nobody can do in one place
const branchesOf = (k) => new Set(D.rows.filter((r) => D.s[r[7]].split(' ').includes(k)).map((r) => r[0]));
const apart = (() => { const ks = D.keys.map(([id]) => [id, branchesOf(id)]).filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size);
  for (const [a, sa] of ks) for (const [b, sb] of ks) if (a !== b && ![...sa].some((x) => sb.has(x))) return [a, b]; return null; })();

(async () => { const b = await chromium.launch();
  // bypassCSP only for the axe pass: axe goes in as an inline script, which the app's CSP (rightly) refuses
  const page = async (vp, region = '수도권', carts = CART, axe = false) => {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: true, hasTouch: true, bypassCSP: axe }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await p.goto(BASE); await p.evaluate(([region, items]) => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify(region));
      localStorage.setItem('pc:carts', JSON.stringify([{ id: 'f', name: '접기 시험', items }])); localStorage.setItem('pc:ci', '0'); }, [region, carts]);
    await p.reload();
    if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
    await p.waitForSelector('#main .card'); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    return { ctx, p, errs };
  };
  const shown = (loc) => loc.evaluate((e) => e.checkVisibility()).catch(() => false);

  // ---- 10. the total in the first screen
  for (const vp of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
    const tag = `${vp.width}×${vp.height}`;
    const { ctx, p, errs } = await page(vp);
    await p.goto(BASE + '#cart'); await p.waitForSelector('#main .cart-items'); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300);
    const f = await p.evaluate((nav) => { const t = document.querySelector('#main .totline'); if (!t) return null; const r = t.getBoundingClientRect();
      const head = [...document.querySelectorAll('#main .card h3')].find((x) => /^담은 시술 \d+개$/.test(x.textContent));
      return { top: r.top, bottom: r.bottom, inFirst: r.top >= 0 && r.bottom <= innerHeight - nav, text: t.innerText.replace(/\s+/g, ' ').trim(),
        underHead: !!head && head.closest('.card') === t.closest('.card') && head.getBoundingClientRect().bottom <= r.top + 1 && !!t.nextElementSibling && t.nextElementSibling.classList.contains('cart-items'),
        hero: (document.querySelector('#main .cartsum .hp') || {}).innerText || '', n: ((document.querySelector('#main .cartsum') || {}).innerText || '').match(/모두 받을 수 있는 지점[^\d]*(\d+)곳/),
        bar: document.querySelector('.cartbar') ? document.querySelector('.cartbar').hidden : null, label: t.getAttribute('aria-label') || '' }; }, NAV_H);
    const nums = (s) => (s.match(/[\d,]{4,}/g) || []).map((x) => x.replace(/,/g, ''));
    ok(`10 ${tag} 첫 화면에 예상 총액 한 줄('담은 시술 N개' 바로 아래)`, !!f && f.inFirst && f.underHead && /^예상 총액 [\d,]+~[\d,]+원 · \d+곳 ↓$/.test(f.text), f ? `${f.text} · top ${Math.round(f.top)}` : '(없음)');
    ok(`10 ${tag} 요약 카드와 같은 숫자(원 단위)·같은 곳 수`, !!f && nums(f.text).join('-') === nums(f.hero).join('-') && !!f.n && f.text.includes(`${f.n[1]}곳`), f ? `${f.text} | ${f.hero.replace(/\s+/g, ' ')}` : '');
    ok(`10 ${tag} 화면 읽기 이름에 보이는 글자가 들어 있음`, !!f && f.label.startsWith(f.text.replace(/ ↓$/, '')), f ? f.label : '');
    ok(`10 ${tag} 아래 막대는 그대로(요약 카드가 아직 아래면 숨김)`, !!f && f.bar === true);
    if (f) {
      await p.locator('#main .totline').click(); await p.waitForTimeout(900);
      const g = await p.evaluate(() => { const sc = document.querySelector('#main .cartsum'); const r = sc.getBoundingClientRect(); const top = document.querySelector('header.top').getBoundingClientRect().bottom;
        return { focus: document.activeElement === sc, top: Math.round(r.top), barBottom: Math.round(top), vh: innerHeight }; });
      ok(`10 ${tag} 누르면 요약 카드로 이동·초점도 요약 카드`, g.focus && g.top >= g.barBottom && g.top < g.vh / 2, JSON.stringify(g));
    }
    ok(`10 ${tag} 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  { const { ctx, p } = await page({ width: 390, height: 844 }, '', []);
    await p.goto(BASE + '#cart'); await p.waitForTimeout(500);
    ok('10 빈 견적: 총액 줄 없음', (await p.locator('#main .totline').count()) === 0);
    // one item: its own line already shows the range and the clinic count — the total line would only repeat it
    await p.evaluate(() => { localStorage.setItem('pc:carts', JSON.stringify([{ id: 'f', name: '하나', items: [{ t: 'k', k: 'X01', q: 2 }] }])); });
    await p.reload(); await p.waitForSelector('#main .cartsum'); await p.waitForTimeout(300);
    { const one = await p.evaluate(() => ({ n: document.querySelectorAll('#main .totline').length, item: ((document.querySelector('#main .ci .cp') || {}).innerText || '').replace(/\s+/g, ' '),
        hl: (document.querySelector('#main .cartsum .hl') || {}).textContent || '' }));
      ok('10 담은 시술이 하나면 총액 줄 없음(시술 줄에 같은 범위·곳 수)', one.n === 0 && /\d+곳/.test(one.item) && /예상 총액/.test(one.hl), JSON.stringify(one)); }
    if (apart) {
      await p.evaluate((ks) => { localStorage.setItem('pc:carts', JSON.stringify([{ id: 'f', name: '따로', items: ks.map((k) => ({ t: 'k', k, q: 1 })) }])); }, apart);
      await p.reload(); await p.waitForSelector('#main .cartsum'); await p.waitForTimeout(300);
      ok(`10 한 곳에서 모두 받는 지점이 없으면 총액 줄 없음(${apart.join('+')})`, (await p.locator('#main .totline').count()) === 0 && /한 곳에서 모두 받는 지점이 없어요/.test(await p.locator('#main .cartsum').innerText()));
    } else console.log('SKIP | 10 함께 파는 지점이 없는 두 규격 — 이 자료엔 없음');
    await ctx.close(); }

  // ---- 18 + 48. the clinic comparison and one branch's quote
  { const { ctx, p, errs } = await page({ width: 390, height: 844 });
    await p.goto(BASE + '#cart'); await p.waitForSelector('#main .cartsum');
    await p.locator('.cartsum button[aria-expanded="false"]').click(); await p.waitForTimeout(500);
    const o = await p.evaluate((w) => { const y = (e) => e ? e.getBoundingClientRect().top + scrollY : null;
      const warn = [...document.querySelectorAll('#main p.note, #main .note')].find((e) => e.textContent.trim() === w);
      const tabs = document.querySelector('#main .seg[role=tablist]'), first = document.querySelector('#main li.qrow');
      return { warn: !!warn && warn.checkVisibility(), order: !!warn && y(tabs) < y(warn) && y(warn) < y(first), main: document.querySelector('#main').textContent }; }, WARN);
    ok('18 \'가격만으로 고르지 마세요\' 문장 그대로, 탭과 병원 목록 사이에 보임', o.warn && o.order);
    const notes = p.locator('#main .cartnotes');
    const vat = (await notes.locator(':scope > ul.dots li').allInnerTexts()).map((x) => x.trim());
    ok('18 목록 아래: 가격 기준 문장은 점 목록으로 보임', vat.length === 1 && /부가세/.test(vat[0]) && vat[0].endsWith('방문 전에 병원에 꼭 확인하세요.'), vat.join(' / '));
    const calc = notes.locator('details.minifold');
    const sum = (await calc.locator('summary').innerText()).trim();
    const inside = (await calc.locator('li').allTextContents()).map((x) => x.trim());
    ok('18 계산 방법 두 문장은 \'합계 계산 방법\' 접기 안에(기본 닫힘, 글자 그대로)', sum === '합계 계산 방법' && !(await calc.evaluate((d) => d.open)) && inside.length === 2 && inside.every((x, i) => x === CALC[i]) && !(await shown(calc.locator('li').first())), `${sum} · ${inside.length}문장`);
    ok('18 예전 한 문단(• 점 4개를 줄바꿈으로 이은 것)은 없음', !/• 가격만으로/.test(o.main) && (await p.locator('#main .cartnotes br, #main .cmpwarn br').count()) === 0);
    await calc.locator('summary').click(); await p.waitForTimeout(200);
    ok('18 \'합계 계산 방법\'을 누르면 두 문장이 보임', await shown(calc.locator('li').nth(1)));
    // 48: the first branch's quote
    await p.locator('li.qrow button.rank').first().click(); await p.waitForTimeout(400);
    ok('18 지점을 펼쳐 다시 그려도 \'합계 계산 방법\'은 열린 채', await p.locator('#main .cartnotes details.minifold').evaluate((d) => d.open));
    const lines = await p.evaluate(() => [...document.querySelectorAll('#main li.qrow.open .qline')].filter((q) => q.querySelector('.qmore')).map((q) => {
      const v = (s) => [...q.querySelectorAll(s)].filter((e) => !e.closest('.qmore')).map((e) => e.checkVisibility());
      const more = q.querySelector('.qmore');
      const sum = more.querySelector('summary'), sr = sum.getBoundingClientRect(), mr = q.querySelector('.m').getBoundingClientRect();
      const prev = [...q.querySelectorAll('.m > *')].filter((e) => e !== more && e.checkVisibility()).pop(), pr = prev && prev.getBoundingClientRect();
      return { badges: v('.k'), src: v('a.src'),
        // what is in view on the line outside '자세히' (its own word taken out), and where '자세히' sits
        mText: q.querySelector('.m').innerText.replace(sum.innerText, ''), outNames: [...q.querySelectorAll('.qname, .later')].filter((e) => !e.closest('.qmore') && e.checkVisibility()).length,
        pos: { h: Math.round(sr.height), right: Math.round(mr.right - sr.right), gap: pr && pr.bottom > sr.top + 1 ? Math.round(sr.left - pr.right) : null }, vat: [...q.querySelectorAll('.m > span')].some((e) => /^병원 표시 [\d,]+원 \+ 부가세$|^부가세 별도$/.test(e.textContent) && e.checkVisibility()),
        listed: !!q.querySelector('.m > span') && [...q.querySelectorAll('.m > span')].some((e) => /\+ 부가세|부가세 별도/.test(e.textContent)),
        open: more.open, name: (more.querySelector('.qname') || {}).textContent || '', nameShown: more.querySelector('.qname').checkVisibility(), selShown: [...more.querySelectorAll('select')].some((e) => e.checkVisibility()),
        later: [...more.querySelectorAll('.later')].map((e) => e.textContent), sum: more.querySelector('summary').getAttribute('aria-label') }; }));
    ok('48 견적 줄마다 \'자세히\'(기본 닫힘) — 상품명·옵션 고르기는 접힘', lines.length >= 2 && lines.every((l) => !l.open && l.name && !l.nameShown && !l.selShown), JSON.stringify(lines.map((l) => [l.name.slice(0, 12), l.open, l.nameShown, l.selShown])));
    ok('48 조건 배지·출처·병원 표시가 + 부가세는 접지 않고 보임', lines.every((l) => l.badges.every(Boolean) && l.src.every(Boolean) && (!l.listed || l.vat)) && lines.some((l) => l.badges.length) && lines.some((l) => l.vat), JSON.stringify(lines.map((l) => [l.badges.length, l.src.length, l.vat])));
    ok('48 \'자세히\'의 화면 읽기 이름에 그 줄의 시술', lines.every((l) => /상품명·옵션 자세히$/.test(l.sum || '')), lines.map((l) => l.sum).join(' / '));
    ok('48 병원 상품명·\'2회째부터 <상품명>\'은 접힌 채(보이는 줄 글자에 없음)', lines.every((l) => l.outNames === 0 && !l.mText.includes(l.name) && l.later.every((t) => !l.mText.includes(t))),
      JSON.stringify(lines.map((l) => [l.outNames, l.name.slice(0, 12), l.mText.includes(l.name)])));
    ok('48 \'자세히\'는 줄 오른쪽 끝, 앞 글자(출처·배지)와 24px 넘게 떨어짐, 높이 32px 이상', lines.every((l) => l.pos.h >= 32 && Math.abs(l.pos.right) <= 1 && (l.pos.gap === null || l.pos.gap >= 24)),
      JSON.stringify(lines.map((l) => l.pos)));
    const h0 = await p.locator('#main li.qrow.open').evaluate((e) => Math.round(e.getBoundingClientRect().height));
    // open one line's '자세히', pick another option there: the quote redraws, the line stays open
    const j = await p.evaluate(() => [...document.querySelectorAll('#main li.qrow.open .qline')].findIndex((q) => q.querySelector('.qmore select') && q.querySelector('.qmore select').options.length > 2));
    if (j < 0) console.log('SKIP | 48 옵션이 둘 이상인 줄 — 이 지점엔 없음');
    else {
      const q = p.locator('#main li.qrow.open .qline').nth(j);
      await q.locator('.qmore > summary').click(); await p.waitForTimeout(200);
      ok('48 \'자세히\'를 누르면 상품명·옵션 고르기가 보임', await shown(q.locator('.qmore .qname')) && await shown(q.locator('.qmore select')));
      const before = await q.locator('.row b.num').textContent();
      const val = await q.locator('.qmore select').evaluate((s) => s.options[2].value);
      await q.locator('.qmore select').selectOption(val); await p.waitForTimeout(500);
      const q2 = p.locator('#main li.qrow.open .qline').nth(j);
      ok('48 옵션을 바꿔 다시 그려도 그 줄의 \'자세히\'는 열린 채, 지점 견적도 펼친 채', (await p.locator('#main li.qrow.open').count()) === 1 && await q2.locator('.qmore').evaluate((d) => d.open) && await shown(q2.locator('.qmore select'))
        && (await q2.locator('.qmore select').inputValue()) === val && /직접 고름/.test(await q2.locator('.m').innerText()), `${before} → ${await q2.locator('.row b.num').textContent()}`);
      await q2.locator('.qmore select').selectOption(''); await p.waitForTimeout(400);
    }
    ok(`48 펼친 지점 높이(접힌 줄) ${h0}px`, h0 > 0 && h0 < 821, `예전 821px`);
    ok('18·48 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // ---- 49. 마이
  { const { ctx, p, errs } = await page({ width: 390, height: 844 });
    await p.goto(BASE + '#me'); await p.waitForSelector('#main .settings'); await p.waitForTimeout(300);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#main .settings details.setrow')].map((d) => ({ open: d.open, sum: d.querySelector(':scope > summary').innerText.replace(/\s+/g, ' ').trim(),
      ctl: [...d.querySelectorAll('button, select, input')].some((e) => e.checkVisibility()), h: Math.round(d.querySelector(':scope > summary').getBoundingClientRect().height) })));
    ok('49 내 설정: 설정마다 한 줄 \'이름 · 지금: 값\'(기본 닫힘, 바꾸는 칸은 접힘)', rows.length >= 5 && rows.every((r) => !r.open && / 지금: /.test(r.sum) && !r.ctl && r.h >= 44), rows.map((r) => `${r.sum}(${r.h})`).join(' / '));
    const vatRow = p.locator('#main .settings details.setrow', { has: p.locator('summary', { hasText: '가격 표시' }) });
    await vatRow.locator('summary').click(); await p.waitForTimeout(200);
    ok('49 줄을 누르면 그 설정의 칸이 펼쳐짐', await shown(vatRow.locator('[role=radio]', { hasText: '병원 표시가' })));
    await vatRow.locator('[role=radio]', { hasText: '병원 표시가' }).click(); await p.waitForTimeout(400);
    const after = p.locator('#main .settings details.setrow', { has: p.locator('summary', { hasText: '가격 표시' }) });
    ok('49 바꾼 뒤(화면 다시 그림) 그 칸은 펼친 채, 줄에 새 값', await after.evaluate((d) => d.open) && /지금: 병원 표시가/.test(await after.locator('summary').innerText())
      && (await after.locator('[role=radio][aria-checked="true"]').innerText()).trim() === '병원 표시가' && (await p.evaluate(() => localStorage.getItem('pc:vat'))) === '"listed"');
    ok('49 다른 설정 줄은 그대로 닫힘', (await p.locator('#main .settings details.setrow[open]').count()) === 1);
    await after.locator('[role=radio]', { hasText: '부가세 포함가' }).click(); await p.waitForTimeout(300);
    const info = p.locator('#main .card.info .datanote');
    const vis = (await info.locator(':scope > ul.dots > li').allInnerTexts()).map((x) => x.trim());
    const rest = info.locator('details.minifold');
    const restN = await rest.locator('li').count();
    ok('49 데이터 안내: 점 목록, 처음 두 점만 보이고 나머지는 \'자세히\'(닫힘)', vis.length === 2 && vis[0].startsWith('체험가·한정가는 보통 1인 1회예요') && /요일·시간에만 되는 가격이에요/.test(vis[1])
      && restN === 3 && !(await rest.evaluate((d) => d.open)) && (await rest.locator('summary').innerText()).trim() === `자세히 · ${restN}개 더` && !(await shown(rest.locator('li').first())), vis.join(' / '));
    const txt = await info.textContent();
    ok('49 데이터 안내 문장은 그대로(접힌 것도 화면 안에 있음)', ['종료일이 지난 이벤트, 지난 수집보다 90% 넘게 내리거나 10배 넘게 오른 가격(확인 중)은 비교에서 빠져요.', '병원 사이트 표기 오류(정가가 판매가보다 낮거나 10배 넘는 값)는 정가를 지웠고, 안내 문구·서류 발급비는 뺐어요.', '10%를 더한 예상가예요'].every((s) => txt.includes(s)) && !txt.includes('•'));
    const wall = await p.evaluate(() => { let n = 0; for (const el of document.querySelectorAll('#main .card.info li, #main .card.info .note')) { if (!el.checkVisibility()) continue; const rg = document.createRange(); rg.selectNodeContents(el);
      if ([...el.children].some((c) => /block|list-item|flex|grid/.test(getComputedStyle(c).display))) continue; n = Math.max(n, new Set([...rg.getClientRects()].filter((r) => r.width > 2).map((r) => Math.round(r.top / 4))).size); } return n; });
    ok('49 데이터 안내에 6줄 넘는 문단 없음', wall > 0 && wall < 6, `가장 긴 덩어리 ${wall}줄`);
    ok('49 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // ---- 17. the check card on the compare screen
  { const { ctx, p, errs } = await page({ width: 390, height: 844 });
    await p.goto(BASE + '#compare?k=X01'); await p.waitForSelector('.checks'); await p.waitForTimeout(500);
    const c = await p.evaluate(() => { const card = document.querySelector('.checks'), list = card.querySelector('.chks');
      const rows = [...card.querySelectorAll('.chk')];
      return { col: card.querySelectorAll('.chk-ic').length, icons: rows.every((r) => r.querySelector('.chk-b > b > svg')), wide: rows.every((r) => Math.abs(r.querySelector('.chk-b').getBoundingClientRect().width - list.getBoundingClientRect().width) < 2),
        after: document.querySelector('.pricecard') && document.querySelector('.pricecard').nextElementSibling === card, folds: card.querySelectorAll('details').length,
        allShown: [...card.querySelectorAll('li, .sub, p')].every((e) => e.checkVisibility()), text: card.innerText }; });
    ok('17 확인 카드: 아이콘 칸 없음(아이콘은 제목 줄), 줄이 카드 폭을 다 씀', c.col === 0 && c.icons && c.wide, JSON.stringify({ col: c.col, icons: c.icons, wide: c.wide }));
    ok('17 확인 카드: 접은 글자 없음(C 답 전), 가격 카드 바로 다음', c.folds === 0 && c.allShown && c.after && ['시술 조건', '장비·약제 정품 여부', '시술 의료진', '주요 부작용', '가격이 낮다는 것만으로 고르지 마세요'].every((w) => c.text.includes(w)));
    ok('17 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // ---- every fold opened on narrow phones: nothing sticks out sideways (a long product name in a line's option picker used to
  //      widen the page once its '자세히' was open)
  for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const { ctx, p, errs } = await page(vp);
    const wide = () => p.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: innerWidth }));
    await p.goto(BASE + '#cart'); await p.waitForSelector('#main .cartsum');
    await p.locator('.cartsum button[aria-expanded="false"]').click(); await p.waitForTimeout(400);
    await p.locator('li.qrow button.rank').first().click(); await p.waitForTimeout(300);
    for (const s of await p.locator('#main li.qrow.open .qmore > summary').all()) await s.click({ timeout: 5000 }).catch(() => {});
    await p.locator('#main .cartnotes details > summary').click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(300);
    const a = { ...(await wide()), open: await p.locator('#main li.qrow.open .qmore[open]').count() };
    await p.goto(BASE + '#me'); await p.waitForSelector('#main .settings'); await p.waitForTimeout(300);
    for (const s of await p.locator('#main .settings details.setrow > summary').all()) await s.click({ timeout: 5000 }).catch(() => {});
    await p.locator('#main .datanote details > summary').click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(300);
    const m = { ...(await wide()), open: await p.locator('#main .settings details.setrow[open]').count() };
    // the settings' controls now live in folds that clickable.js / touch_targets.js skip while closed: opened, each one is what a
    // tap at its centre reaches, with a 24px hit area (the same probe as touch_targets.js)
    const reach = await p.evaluate(() => { const out = { n: 0, bad: [] };
      const els = [...document.querySelectorAll('#main .settings details.setrow > summary, #main .settings details.setrow[open] .setbody :is(button, select, a[href], label.switch, input:not([type=hidden]))')]
        .filter((e) => e.offsetParent !== null && !e.matches('.switch input') && !(e.matches('a') && e.closest('p, .sub, dd')));
      for (const e of els) { e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); if (!r.width) continue; out.n++;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2, hit = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === e || e.contains(t)); };
        const at = hit(cx, cy), okV = r.height >= 24 || (hit(cx, cy - 11) && hit(cx, cy + 11)), okH = r.width >= 24 || (hit(cx - 11, cy) && hit(cx + 11, cy));
        if (!at || !okV || !okH) out.bad.push(`${e.tagName.toLowerCase()}.${e.className}:${(e.getAttribute('aria-label') || e.textContent).trim().slice(0, 12)} ${Math.round(r.width)}x${Math.round(r.height)}${at ? '' : ' 가려짐'}`); }
      scrollTo(0, 0); return out; });
    ok(`${vp.width}px 내 설정을 모두 펼치면 칸마다 누름이 닿고 24px 이상`, reach.n >= 15 && !reach.bad.length, `${reach.n}개 ${reach.bad.join(' | ')}`);
    ok(`${vp.width}px 견적 줄 '자세히'·합계 계산 방법·내 설정·데이터 안내를 모두 펼쳐도 가로 넘침 없음`, a.open >= 2 && m.open >= 5 && a.doc <= 0 && m.doc <= 0 && a.vw === vp.width && m.vw === vp.width, JSON.stringify({ a, m }));
    ok(`${vp.width}px 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // ---- the folds opened, light and dark: axe (a11y.js checks the screens as first drawn, with the folds closed)
  if (process.env.AXE) {
    const axe = require('fs').readFileSync(process.env.AXE, 'utf8'); const found = []; let ran = 0;
    for (const scheme of ['light', 'dark']) {
      const { ctx, p } = await page({ width: 390, height: 844 }, '수도권', CART, true); await p.emulateMedia({ colorScheme: scheme });
      const run = async (where) => { await p.addScriptTag({ content: axe });
        const v = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })).violations.map((x) => `${x.id}(${x.nodes.length})`));
        found.push(...v.map((x) => `${scheme} ${where}:${x}`)); ran++; };
      await p.goto(BASE + '#cart'); await p.waitForSelector('#main .cartsum');
      await p.locator('.cartsum button[aria-expanded="false"]').click(); await p.waitForTimeout(400);
      await p.locator('li.qrow button.rank').first().click(); await p.waitForTimeout(300);
      for (const s of await p.locator('#main li.qrow.open .qmore > summary').all()) await s.click();
      await p.locator('#main .cartnotes details > summary').click(); await p.waitForTimeout(300);
      await run('견적 펼침·자세히·합계 계산 방법');
      await p.goto(BASE + '#me'); await p.waitForSelector('#main .settings'); await p.waitForTimeout(300);
      for (const s of await p.locator('#main .settings details.setrow > summary').all()) await s.click();
      await p.locator('#main .datanote details > summary').click(); await p.waitForTimeout(300);
      await run('마이 설정 모두 펼침·데이터 안내 자세히');
      await ctx.close();
    }
    ok('펼친 접기들 axe 위반 없음(밝게·어둡게)', ran === 4 && !found.length, `${ran}/4 ${found.join(' ')}`);
  } else console.log('SKIP | axe(펼친 상태) — AXE 환경 변수가 없어 건너뜀');

  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
