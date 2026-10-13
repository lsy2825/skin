// QA for the live-product directive: the 7 questions, each checked in a real browser, plus the branch-count check (P0-1)
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/qa7.js [out-dir]
// Needs Playwright with Chromium (PLAYWRIGHT=/path/to/node_modules/playwright if it isn't resolvable). Not part of
// `node --test`. Map tiles are answered with an empty response so the test runs offline. Results: docs/UX_AUDIT.md.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요 (예: APP_PIN=xxxx node ' + process.argv[1] + ')'); process.exit(2); }
const D = require(path.join(__dirname, '../../app/data.json'));
const R = []; const ok = (q, name, pass, detail = '') => { R.push([q, name, pass, detail]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${q} | ${name} | ${detail}`); };
const num = (t) => +String(t).replace(/[^\d]/g, '');
// rows of one comparison key → their product names
const namesOf = (k) => new Set(D.rows.filter((r) => D.s[r[7]].split(' ').includes(k)).map((r) => D.s[r[2]]));
const branchesOf = (k) => new Set(D.rows.filter((r) => D.s[r[7]].split(' ').includes(k)).map((r) => r[0]));
const UNIT = /(\d+(?:\.\d+)?)\s*(cc|ml|U|유닛|샷|줄|KJ)(?![a-z])/gi;
const amounts = (s) => [...s.matchAll(UNIT)].map((m) => `${+m[1]}${m[2].toLowerCase().replace('유닛', 'u')}`);

(async () => { const OUT = process.argv[2] || require('os').tmpdir(); const b = await chromium.launch();
  const page = async (opts = {}, cart = null, region = null) => {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, ...opts }); const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await p.goto(BASE); await p.evaluate(([c, rg]) => { localStorage.clear(); if (c) localStorage.setItem('pc:carts', JSON.stringify([{ id: 'a', name: '내 장바구니', items: c }])); if (rg != null) localStorage.setItem('pc:region', JSON.stringify(rg)); }, [cart, region]);
    await p.reload(); for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    return { ctx, p };
  };
  const carts = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('pc:carts') || '[]'));

  // Q1 home '+ 담기' → cart count
  { const { ctx, p } = await page();
    const n0 = await p.locator('#cart-n').isHidden();
    const add = async (i) => { await p.locator('#main .addbtn', { hasText: /^담기$/ }).nth(i).click(); await p.waitForTimeout(200);
      await p.locator('.sheet button', { hasText: /회 담기$/ }).first().click(); await p.waitForTimeout(300); };
    await add(0); const n1 = await p.locator('#cart-n').textContent();
    const pressed = await p.locator('#main .addbtn[aria-pressed="true"]').count();
    await add(0); const n2 = await p.locator('#cart-n').textContent();
    ok('Q1', '홈에서 담으면 장바구니 숫자 갱신', n0 && n1 === '1' && n2 === '2', `처음 숨김=${n0} → ${n1} → ${n2}`);
    ok('Q1', '담은 카드 버튼이 "담김"으로 바뀜', pressed >= 1, `aria-pressed=true ${pressed}개`);
    const c = await carts(p); ok('Q1', '저장된 장바구니와 숫자가 같음', c[0].items.length === 2, JSON.stringify(c[0].items.map((x) => x.k)));
    await p.goto(BASE + '#cart'); await p.waitForTimeout(400);
    ok('Q1', '장바구니 화면에 같은 개수', /담은 시술 2개/.test(await p.locator('#main').innerText()));
    ok('Q1', '스크립트 오류 없음', !p.errs.length, p.errs.join(' ')); await ctx.close(); }

  // Q2 same spec: every listed price belongs to the key, and amounts in the product names match the key's amount
  { const pick = ['X01', 'X12', 'X24'];
    for (const [id, , label] of D.keys) if (/^T/.test(id) && amounts(label).length && branchesOf(id).size >= 6 && pick.length < 12 && !pick.some((x) => D.keys.find((k) => k[0] === x)[2].split(' ')[0] === label.split(' ')[0])) pick.push(id);
    const { ctx, p } = await page({}, null, '');
    let bad = [], rows = 0;
    for (const k of pick) {
      await p.goto(BASE + '#compare?k=' + k); await p.waitForTimeout(350);
      const label = D.keys.find((x) => x[0] === k)[2], allowed = namesOf(k), want = amounts(label);
      const shown = await p.$$eval('#main li.rk .rank .m', (ms) => ms.map((m) => m.firstChild.textContent));
      rows += shown.length;
      for (const n of shown) {
        if (!allowed.has(n)) bad.push(`${k} 다른 키의 상품: ${n}`);
        const got = amounts(n).filter((a) => want.some((w) => w.replace(/[\d.]/g, '') === a.replace(/[\d.]/g, '')));
        if (got.length && !got.some((a) => want.includes(a))) bad.push(`${k}(${label}) 용량 다름: ${n}`);
      }
      if (!shown.length) bad.push(`${k} 목록 비어 있음`);
    }
    ok('Q2', `비교 목록이 같은 스펙만 (${pick.length}개 시술, ${rows}개 가격)`, !bad.length, bad.slice(0, 5).join(' / ') || pick.join(','));
    // the same in the cart's per-clinic quote
    await p.evaluate(() => localStorage.setItem('pc:carts', JSON.stringify([{ id: 'a', name: 't', items: [{ t: 'k', k: 'X12', q: 1 }] }])));
    await p.goto(BASE + '#cart'); await p.reload(); await p.waitForSelector('.cartsum');
    await p.locator('.cartsum .btn').click(); await p.waitForTimeout(300);
    for (let i = 0; i < 3; i++) { await p.locator('.qrow > .rank').nth(i).click(); await p.waitForTimeout(250); }
    const qn = await p.$$eval('.qline .m > span:first-child', (s) => s.map((x) => x.textContent));
    const allowed = namesOf('X12'), qbad = qn.filter((n) => !allowed.has(n));
    ok('Q2', '장바구니 지점별 견적도 같은 스펙 상품', qn.length >= 3 && !qbad.length, qbad.join(' / ') || `${qn.length}개 확인`);
    await ctx.close(); }

  // Q3 cart kept when filters change (region, brand, sort/category filter, special, VAT)
  { const items = [{ t: 'k', k: 'X12', q: 2 }, { t: 'k', k: 'X24', q: 1 }];
    const { ctx, p } = await page({}, items);
    const before = JSON.stringify((await carts(p))[0].items);
    await p.click('#regbtn'); await p.selectOption('.sheet select[aria-label="지역"]', ''); await p.waitForTimeout(300);
    const s1 = JSON.stringify((await carts(p))[0].items), n1 = await p.locator('#cart-n').textContent();
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(300);
    await p.locator('#main .chips button[aria-pressed]').filter({ hasText: /^[가-힣A-Za-z]+$/ }).first().click().catch(() => {}); await p.waitForTimeout(200);
    await p.goto(BASE + '#table'); await p.waitForTimeout(400); await p.selectOption('label.flabel select >> nth=0', { index: 1 }); await p.waitForTimeout(300);
    await p.goto(BASE + '#me'); await p.waitForTimeout(300);
    await p.locator('.setseg [role=radio]', { hasText: '병원 표시가' }).click().catch(() => {}); await p.waitForTimeout(200);
    await p.goto(BASE + '#cart'); await p.waitForTimeout(400); await p.locator('details.advset summary').click(); await p.waitForTimeout(150);
    await p.locator('details.advset .switch', { hasText: '특가 포함' }).click(); await p.waitForTimeout(300);
    const after = JSON.stringify((await carts(p))[0].items), n2 = await p.locator('#cart-n').textContent();
    ok('Q3', '지역 바꾼 뒤 장바구니 유지', s1 === before && n1 === '2', `${n1}개`);
    ok('Q3', '브랜드·필터·부가세·특가 바꾼 뒤 장바구니 유지', after === before && n2 === '2', after);
    ok('Q3', '장바구니 화면에 수량 그대로', /담은 시술 2개/.test(await p.locator('#main').innerText()) && (await p.locator('.qty input, .qty .num').first().textContent().catch(() => '')) !== null);
    await p.reload(); await p.waitForSelector('#main .card');
    ok('Q3', '새로고침 후에도 유지', JSON.stringify((await carts(p))[0].items) === before);
    await ctx.close(); }

  // Q4 budget: number ↔ slider ↔ quick buttons
  { const { ctx, p } = await page({}, [{ t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }]);
    await p.goto(BASE + '#cart'); await p.waitForTimeout(500);
    ok('Q4', '기본 화면에는 예산 설정이 접혀 있음', !(await p.locator('details.advset').evaluate((d) => d.open)) && !(await p.locator('input[aria-label="예산 상한 슬라이더"]').isVisible()));
    await p.locator('details.advset summary').click();
    const num$ = p.locator('input[aria-label="예산 상한(원)"]'), rng = p.locator('input[aria-label="예산 상한 슬라이더"]');
    await num$.fill('250000'); const r1 = await rng.inputValue();
    await num$.press('Enter'); await p.waitForTimeout(300); const saved1 = (await carts(p))[0].budget;
    ok('Q4', '숫자 입력 → 슬라이더', r1 === '250000' && saved1 === 250000, `slider=${r1} 저장=${saved1}`);
    await rng.fill('500000'); await p.waitForTimeout(300);
    ok('Q4', '슬라이더 → 숫자 입력', (await num$.inputValue()) === '500000' && (await carts(p))[0].budget === 500000, await num$.inputValue());
    await rng.focus(); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
    ok('Q4', '슬라이더 키보드(→) → 숫자 입력', (await num$.inputValue()) === '510000', await num$.inputValue());
    await p.locator('.budget .chip', { hasText: '30만' }).click(); await p.waitForTimeout(300);
    ok('Q4', '빠른 금액 버튼 → 둘 다', (await num$.inputValue()) === '300000' && (await rng.inputValue()) === '300000' && (await carts(p))[0].budget === 300000);
    ok('Q4', '요약 카드에 예산 표시', /예산/.test(await p.locator('.cartsum').innerText()) && /예산 300,000원/.test(await p.locator('details.advset summary').innerText()));
    await num$.fill('-5'); await p.waitForTimeout(100);
    ok('Q4', '잘못된 금액 안내', await p.locator('.budget .ferr').isVisible() && (await num$.getAttribute('aria-invalid')) === 'true');
    await p.locator('.budget .chip', { hasText: '제한 없음' }).click(); await p.waitForTimeout(300);
    ok('Q4', '제한 없음 → 둘 다 비움', (await num$.inputValue()) === '' && (await rng.inputValue()) === '0' && !(await carts(p))[0].budget);
    await ctx.close(); }

  // Q5 missing prices are not counted as 0원
  { const rare = D.keys.filter(([id]) => /^T/.test(id)).map(([id]) => [id, branchesOf(id).size]).filter(([, n]) => n === 3)[0][0];
    const { ctx, p } = await page({}, [{ t: 'k', k: 'X12', q: 1 }, { t: 'k', k: rare, q: 1 }], '');
    await p.goto(BASE + '#cart'); await p.waitForTimeout(500);
    await p.locator('.cartsum .btn').click(); await p.waitForTimeout(300);
    await p.locator('.more-link', { hasText: '일부만 되는 곳' }).click(); await p.waitForTimeout(300);
    const part = p.locator('.qrow').filter({ hasText: '개 중' }).first();
    const m = await part.locator('.rank .m').innerText(), shownTotal = num(await part.locator('.rank .p').textContent());
    await part.locator('.rank').click(); await p.waitForTimeout(300);
    const open = p.locator('.qrow.open').first();
    const lines = await open.locator('.qline').evaluateAll((qs) => qs.map((q) => ({ t: q.querySelector('.row b.num')?.textContent || '', none: /없음/.test(q.querySelector('.row').textContent) })));
    const sum = lines.filter((l) => !l.none).reduce((a, l) => a + +l.t.replace(/[^\d]/g, ''), 0);
    const text = await open.innerText();
    ok('Q5', '일부만 되는 지점에 "N개 중 M개 가능" 표시', /2개 중 1개 가능/.test(m), m.split('\n')[0]);
    ok('Q5', '없는 시술은 "없음"(0원 아님)', lines.some((l) => l.none) && !lines.some((l) => l.t === '0원'), JSON.stringify(lines));
    ok('Q5', '합계 = 확인된 시술만 더한 값', sum === shownTotal && sum > 0, `줄 합 ${sum} / 표시 ${shownTotal}`);
    ok('Q5', '"확인된 시술 합계"와 0원 아님 안내', /확인된 시술 합계/.test(text) && /0원 아님/.test(text));
    ok('Q5', '요약 카드가 일부 지점 합계를 최저가로 쓰지 않음', !/^0원$/.test((await p.locator('.cartsum .hp').textContent()).trim()), await p.locator('.cartsum .hp').textContent());
    await ctx.close(); }

  // Q6 map: marker ↔ list
  { const { ctx, p } = await page({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await p.goto(BASE + '#map'); await p.waitForTimeout(1200);
    await p.selectOption('select[aria-label="지도에 표시할 시술"]', { index: 1 }); await p.waitForTimeout(500);
    for (let i = 0; i < 4 && await p.locator('.pin-cluster').count() && !(await p.locator('.pin-price').count()); i++) { await p.locator('.pin-cluster').first().click(); await p.waitForTimeout(700); }
    if (await p.locator('.mapbtn.again').isVisible()) { await p.locator('.mapbtn.again').click(); await p.waitForTimeout(300); }
    const pins = await p.locator('.pin-price').count(); let pass = 0, tried = 0, why = [];
    for (let i = 0; i < Math.min(pins, 4); i++) {
      // the popup pans the map, so take the i-th pin that is inside the map box right now
      const j = await p.evaluate((i) => { const m = document.getElementById('map').getBoundingClientRect();
        const pins = [...document.querySelectorAll('.pin-price')];
        // inside the map box and not under the map's own buttons (the lock / re-search bar sits on top of the map)
        const inside = pins.map((e, j) => [e.getBoundingClientRect(), j]).filter(([r, j]) => { if (!(r.left > m.left + 4 && r.right < m.right - 4 && r.top > m.top + 4 && r.bottom < m.bottom - 4)) return false;
          const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && pins[j].contains(t); });
        return inside.length ? inside[i % inside.length][1] : -1; }, i);
      if (j < 0) continue;
      tried++; await p.locator('.pin-price').nth(j).click(); await p.waitForTimeout(450);
      const pop = await p.locator('.leaflet-popup b').first().textContent().catch(() => ''), popP = await p.locator('.leaflet-popup-content > div > div').first().textContent().catch(() => '');
      const sel = await p.locator('#near li.sel').count(), selName = await p.locator('#near li.sel .t').textContent().catch(() => ''), selP = await p.locator('#near li.sel .p').textContent().catch(() => '');
      if (sel === 1 && selName.trim() === pop.trim() && num(selP) === num(popP)) pass++; else why.push(`${pop}/${selName}/${popP}/${selP}`);
      await p.keyboard.press('Escape'); await p.locator('.leaflet-popup-close-button').click().catch(() => {}); await p.waitForTimeout(150);
    }
    ok('Q6', '마커 누르면 목록의 같은 지점 강조(이름·가격 일치)', tried > 0 && pass === tried, `${pass}/${tried}개 마커 ${why.join(' ; ')}`);
    pass = 0; tried = 0; why = [];
    const rows = await p.locator('#near li[data-b]').count();
    for (const i of [0, Math.floor(rows / 2), rows - 1].filter((x, j, a) => x >= 0 && a.indexOf(x) === j)) {
      const li = p.locator('#near li[data-b]').nth(i), name = (await li.locator('.t').textContent()).trim();
      tried++; await li.locator('.infob').click(); await p.waitForTimeout(900);
      const pop = (await p.locator('.leaflet-popup b').first().textContent().catch(() => '')).trim(), selName = (await p.locator('#near li.sel .t').textContent().catch(() => '')).trim();
      if (pop === name && selName === name) pass++; else why.push(`${name}→${pop}/${selName}`);
    }
    ok('Q6', '목록의 📍 누르면 같은 지점 마커 팝업', tried > 0 && pass === tried, `${pass}/${tried}개 ${why.join(' ; ')}`);
    // branches in one building (same coordinates, e.g. 블리비·쁨 안산점): each gets its own marker and 📍 opens the right one
    await p.selectOption('select[aria-label="지도에 표시할 시술"]', ''); await p.waitForTimeout(400);
    await p.fill('input[aria-label="지역 이름으로 찾기"]', '안산'); await p.waitForTimeout(250);
    await p.locator('input[aria-label="지역 이름으로 찾기"] + .chips button').first().click(); await p.waitForTimeout(900);
    if (await p.locator('.mapbtn.again').isVisible()) { await p.locator('.mapbtn.again').click(); await p.waitForTimeout(300); }
    const pair = ['블리비 안산점', '쁨 안산점'], viaPin = [], viaList = [];
    for (const name of pair) { const li = p.locator('#near li[data-b]').filter({ hasText: name }).first();
      if (!(await li.count())) { viaList.push(`${name}:목록에 없음`); continue; }
      await li.locator('.infob').click(); await p.waitForTimeout(900);
      viaList.push((await p.locator('.leaflet-popup b').first().textContent().catch(() => '')).trim() === name ? 'ok' : `${name}→${await p.locator('.leaflet-popup b').first().textContent().catch(() => '-')}`); }
    await p.locator('.leaflet-popup-close-button').click().catch(() => {}); await p.waitForTimeout(200);
    const paths = await p.evaluate(() => { const m = document.getElementById('map').getBoundingClientRect(), c = [m.left + m.width / 2, m.top + m.height / 2];
      return [...document.querySelectorAll('#map path.leaflet-interactive')].map((e, j) => { const r = e.getBoundingClientRect(); return [j, Math.hypot(r.left + r.width / 2 - c[0], r.top + r.height / 2 - c[1])]; }).filter((x) => x[1] < 90).map((x) => x[0]); });
    for (const j of paths) { await p.locator('#map path.leaflet-interactive').nth(j).click({ force: true }).catch(() => {}); await p.waitForTimeout(300);
      viaPin.push((await p.locator('.leaflet-popup b').first().textContent().catch(() => '')).trim()); await p.locator('.leaflet-popup-close-button').click().catch(() => {}); await p.waitForTimeout(150); }
    ok('Q6', '같은 건물 지점(블리비·쁨 안산점)도 각각 선택', viaList.every((x) => x === 'ok') && pair.every((n) => viaPin.includes(n)), `📍 ${viaList.join(',')} · 마커로 연 팝업: ${[...new Set(viaPin)].join(', ')}`);
    ok('Q6', '모바일: 지도 잠금 버튼(페이지 스크롤 우선)', await p.locator('.mapbtn[aria-pressed]').count() === 1);
    await p.screenshot({ path: `${OUT}/qa7-map.png` }); await ctx.close(); }

  // Q7 guide: '가격 비교' opens the same treatment
  { const { ctx, p } = await page();
    await p.goto(BASE + '#guide'); await p.waitForTimeout(600);
    const names = await p.$$eval('.gitem', (gs) => gs.map((g, i) => [i, g.querySelector('b').textContent, !!g.querySelector('.btn.soft')]).filter((x) => x[2]));
    const sample = names.filter((_, j) => j < 10 || j % Math.max(1, Math.floor(names.length / 25)) === 0).slice(0, 40);
    let bad = [];
    for (const [i, name] of sample) {
      await p.goto(BASE + '#guide'); await p.waitForTimeout(250);
      await p.locator('.gitem').nth(i).locator('.btn.soft').click(); await p.waitForTimeout(300);
      const selTxt = await p.locator('select[aria-label="시술 고르기"] option:checked').textContent();
      if (!/#compare\?k=/.test(p.url()) || !selTxt.startsWith(name + ' · ')) bad.push(`${name} → ${selTxt}`);
    }
    ok('Q7', `시술 사전 '가격 비교' 버튼 (${sample.length}/${names.length}개 표본)`, !bad.length, bad.slice(0, 4).join(' / '));
    // grouped entries (제모 부위 chips) and the quick-view sheet button
    await p.goto(BASE + '#guide?c=' + encodeURIComponent('제모·바디')); await p.waitForTimeout(400);
    const chips = await p.$$eval('.gitem .chips .chip', (cs) => cs.slice(0, 5).map((c) => c.textContent)); let cbad = [];
    for (let j = 0; j < chips.length; j++) { await p.goto(BASE + '#guide?c=' + encodeURIComponent('제모·바디')); await p.waitForTimeout(250);
      await p.locator('.gitem .chips .chip').nth(j).click(); await p.waitForTimeout(300);
      const s = await p.locator('select[aria-label="시술 고르기"] option:checked').textContent(); if (!s.startsWith(chips[j] + ' · ')) cbad.push(`${chips[j]}→${s}`); }
    ok('Q7', `부위 묶음 항목의 부위 버튼 (${chips.length}개)`, chips.length > 0 && !cbad.length, cbad.join(' / '));
    let sbad = [], sn = 0;
    for (const q of ['사각턱 보톡스', '주름 보톡스', '스킨보톡스', '리쥬란']) {
      await p.goto(BASE + '#guide?q=' + encodeURIComponent(q)); await p.waitForTimeout(350);
      const g = p.locator('.gitem').filter({ has: p.locator('.btn.soft') }).first(); if (!(await g.count())) { sbad.push(`${q}: 항목 없음`); continue; }
      const name = await g.locator('b').first().textContent(); await g.locator('.linkbtn', { hasText: '부작용' }).click(); await p.waitForTimeout(250);
      const btn = p.locator('.sheet .btn', { hasText: '가격 비교' }); const bt = await btn.textContent(); await btn.click(); await p.waitForTimeout(350); sn++;
      const s = await p.locator('select[aria-label="시술 고르기"] option:checked').textContent();
      if (!s.startsWith(name + ' · ') || bt !== `${name} 가격 비교`) sbad.push(`${name}: ${bt} → ${s}`);
    }
    ok('Q7', `퀵뷰(설명 시트)의 가격 비교 버튼 (${sn}개)`, sn > 0 && !sbad.length, sbad.join(' / '));
    await ctx.close(); }

  // P0-1 branch count: header = region menu
  { const { ctx, p } = await page(); let bad = [];
    for (const v of ['수도권', '', '서울']) {
      await p.click('#regbtn'); await p.waitForTimeout(150);
      const opt = await p.$eval('.sheet select[aria-label="지역"]', (s, v) => [...s.options].find((o) => o.value === v)?.textContent || '', v);
      await p.selectOption('.sheet select[aria-label="지역"]', v); await p.waitForTimeout(300);
      const head = await p.locator('#upd').textContent().catch(() => '');
      const n = (opt.match(/(\d+)곳/) || [])[1];
      if (!n || !head.includes(`${n}곳`)) bad.push(`${v || '전국'}: 메뉴 "${opt}" / 머리말 "${head}"`);
    }
    ok('P0-1', '머리말 지점 수 = 지역 메뉴 지점 수', !bad.length, bad.join(' / '));
    await ctx.close(); }

  require('fs').writeFileSync(`${OUT}/qa7.json`, JSON.stringify(R));
  console.log(`TOTAL ${R.filter((x) => x[2]).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every((x) => x[2]) ? 0 : 1; })();
