// QA for the live-product directive: the 7 questions, each checked in a real browser, plus the branch-count check (P0-1)
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/qa7.js [out-dir]
// Needs Playwright with Chromium (PLAYWRIGHT=/path/to/node_modules/playwright if it isn't resolvable). Not part of
// `node --test`. Map tiles are answered with an empty response so the test runs offline. Results: docs/UX_AUDIT.md.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요 (예: APP_PIN=xxxx node ' + process.argv[1] + ')'); process.exit(2); }
const D = require('./rows.js')(require(path.join(__dirname, '../../app/data.json')));   // price rows are stored as columns
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

  // Q1 home '+ 담기' → cart count. The button names the card's spec and one tap puts that spec in — no option sheet (위계 점검 1);
  // the toast says what went in and how many (위계 점검 22); '담김' opens the sheet to change sessions, the count stays
  { const { ctx, p } = await page();
    // the full file first (a tap before it is queued — tests/e2e/o2_home.js 3b), so the card is not redrawn while it is measured
    await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); await p.waitForTimeout(200);
    const n0 = await p.locator('#cart-n').isHidden();
    const card = (i) => p.locator('#main .pwrap').nth(i);
    const label0 = (await card(0).locator('.pc .l').textContent()).trim(), btn0 = (await card(0).locator('.addbtn').textContent()).trim();
    const order = await card(0).evaluate((w) => { const y = (s) => w.querySelector(s).getBoundingClientRect().top; return y('.addbtn') > y('.pc .p') && y('.pc .p') > y('.pc .l'); });
    await card(0).locator('.addbtn').click(); await p.waitForTimeout(300);
    const sheet1 = await p.locator('.sheet').count(), n1 = await p.locator('#cart-n').textContent(), t1 = await p.locator('#toast').innerText(), sub1 = await p.locator('#toast .ts').innerText().catch(() => '');
    const pressed = await p.locator('#main .addbtn[aria-pressed="true"]').count(), btn0b = (await card(0).locator('.addbtn').textContent()).trim();
    await card(1).locator('.addbtn').click(); await p.waitForTimeout(300); const n2 = await p.locator('#cart-n').textContent(), sheet2 = await p.locator('.sheet').count();
    ok('Q1', '홈에서 담으면 창 없이 장바구니 숫자 갱신', n0 && !sheet1 && !sheet2 && n1 === '1' && n2 === '2', `처음 숨김=${n0} → ${n1} → ${n2}, 창 ${sheet1}·${sheet2}`);
    ok('Q1', '담기 글자에 규격, 이름 → 가격 → 담기 순서', /^담기 · \S/.test(btn0) && order, `${label0} / ${btn0} / 순서 ${order}`);
    ok('Q1', '담은 카드 버튼이 "담김 · 규격"으로 바뀜', pressed >= 1 && btn0b === btn0.replace(/^담기/, '담김'), `aria-pressed=true ${pressed}개, ${btn0b}`);
    ok('Q1', "알림: '내 견적에 담았어요 · 대상 (1개)', 견적 하나면 다른 견적 얘기 없음", t1.includes(`내 견적에 담았어요 · ${label0} (1개)`) && !/다른 (내 )?견적/.test(t1), t1.replace(/\n/g, ' / '));
    ok('Q1', '알림 둘째 줄(죠미)은 첫 줄을 되풀이하지 않음', !/담았|담아|넣었|추가했|들어갔|담기 (완료|성공|끝)/.test(sub1), sub1);
    const c = await carts(p); ok('Q1', '저장된 장바구니와 숫자가 같음', c[0].items.length === 2, JSON.stringify(c[0].items.map((x) => x.k)));
    const k0 = await p.evaluate((id) => { const k = App.state().D.keys.find((x) => x[0] === id); return k && k[2]; }, c[0].items[0].k);
    ok('Q1', '카드에 적힌 그 규격이 담김', k0 === label0 && c[0].items[0].q === 1, `${k0} / ${label0}`);
    await card(0).locator('.addbtn').click(); await p.waitForTimeout(300);
    ok('Q1', "'담김'을 다시 누르면 횟수 바꾸기 창(개수 그대로)", await p.locator('.sheet button', { hasText: /회로 바꾸기$/ }).count() === 1 && (await p.locator('#cart-n').textContent()) === '2');
    // that sheet: sessions, 빼기 and 'n회로 바꾸기' on the first screen, the family's other options folded under them (검토: 30 options first)
    const chg = p.locator('.sheet button', { hasText: /회로 바꾸기$/ }), bb = await chg.boundingBox(), nOpt = await p.locator('.sheet .opts').count();
    const folded = !nOpt || await p.locator('.sheet details.optfold:not([open]) .opts').count() === 1;
    ok('Q1', "'담김' 창: 바꾸기·빼기가 첫 화면, 다른 옵션은 접힘", !!bb && bb.y + bb.height <= 844 && await p.locator('.sheet button', { hasText: /^빼기$/ }).count() === 1 && folded, `바꾸기 아래 끝 ${bb && Math.round(bb.y + bb.height)}, 옵션 ${nOpt ? '접힘 ' + folded : '없음'}`);
    await p.locator('.sheet button[aria-label="하나 더"]').click(); await p.locator('.sheet button[aria-label="하나 더"]').click(); await p.locator('.sheet button', { hasText: /^3회로 바꾸기$/ }).click(); await p.waitForTimeout(300);
    await card(0).locator('.addbtn').click(); await p.waitForTimeout(300);
    ok('Q1', "다시 열면 지금 횟수(3회)에서 시작 — '1회로 바꾸기'로 되돌리지 않음", (await p.locator('.sheet .qty b').textContent()) === '3' && await p.locator('.sheet button', { hasText: /^3회로 바꾸기$/ }).count() === 1 && (await carts(p))[0].items[0].q === 3);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.goto(BASE + '#cart'); await p.waitForTimeout(400);
    ok('Q1', '장바구니 화면에 같은 개수', /담은 시술 2개/.test(await p.locator('#main').innerText()));
    ok('Q1', '스크립트 오류 없음', !p.errs.length, p.errs.join(' ')); await ctx.close(); }

  // Q1b two 내 견적: the same toast names the cart it went into and only then talks about the other carts; a price row's 담기
  // says what and where for screen readers and sits in the right column on every row (위계 점검 21·22)
  { const { ctx, p } = await page();
    await p.evaluate(() => { localStorage.setItem('pc:carts', JSON.stringify([{ id: 'a', name: '내 견적', items: [] }, { id: 'b', name: '언니랑', items: [] }])); localStorage.setItem('pc:ci', '1'); });
    await p.reload(); await p.waitForSelector('.pc');
    await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    await p.waitForFunction(() => window.JomiLines && window.JomiLines.stats().variants >= 2000, null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(200);
    const many = (t) => p.evaluate((t) => window.JomiLines.RECORDS.filter((r) => r.intent === 'addedMany').some((r) => r.variants.some((v) => t.includes(v))), t);
    const label0 = (await p.locator('#main .pwrap .pc .l').first().textContent()).trim();
    await p.locator('#main .pwrap .addbtn').first().click(); await p.waitForTimeout(300);
    const t1 = await p.locator('#toast').innerText();
    ok('Q1b', "견적 2개: 알림이 담긴 견적 이름 + 둘째 줄에 다른 견적 안내", t1.startsWith(`'언니랑'에 담았어요 · ${label0} (1개)`) && await many(t1), t1.replace(/\n/g, ' / '));
    await p.goto(BASE + '#search/' + encodeURIComponent('리쥬란 2cc')); await p.waitForTimeout(1200);
    const rows = await p.$$eval('#main .card.flush .list > li > .item', (its) => its.filter((it) => it.querySelector(':scope > .addbtn')).map((it) => {
      const a = it.querySelector(':scope > .addbtn'), pr = it.querySelector('.p'), ar = a.getBoundingClientRect(), prr = pr.getBoundingClientRect();
      return { aria: a.getAttribute('aria-label') || '', name: it.querySelector('.t').textContent, right: Math.abs(ar.right - prr.right) <= 1 && ar.top >= prr.bottom - 1 }; }));
    ok('Q1b', "검색 줄 담기: '상품 · 지점 내 견적에 담기' 이름표", rows.length > 0 && rows.every((r) => r.aria.startsWith(`${r.name} · `) && r.aria.endsWith(' 내 견적에 담기')), rows[0] && rows[0].aria);
    ok('Q1b', '검색 줄 담기: 모든 줄에서 가격 바로 아래 오른쪽', rows.length > 0 && rows.every((r) => r.right), `${rows.filter((r) => !r.right).length}/${rows.length}줄 어긋남`);
    await p.locator('#main .card.flush .list > li > .item > .addbtn').first().click(); await p.waitForTimeout(300);
    await p.locator('.sheet button', { hasText: /회 담기$/ }).first().click(); await p.waitForTimeout(300);
    const t2 = await p.locator('#toast').innerText(), c = await carts(p);
    ok('Q1b', '줄에서 담아도 같은 알림(고른 견적·개수)', /^'언니랑'에 담았어요 · .+ \(2개\)/.test(t2) && await many(t2) && c[1].items.length === 2 && c[0].items.length === 0, t2.replace(/\n/g, ' / '));
    ok('Q1b', '스크립트 오류 없음', !p.errs.length, p.errs.join(' ')); await ctx.close(); }

  // Q1c the spec on the key's own 담기 button: never '담기 · 기본' (a family's only option), and on a 320px home card the + / ✓
  // stands for 담기 / 담김 so a short spec is not cut ('+ 힐러 2cc'); quick compare keeps '담기 · <long name>' inside its card
  for (const W of [390, 320]) { const { ctx, p } = await page({ viewport: { width: W, height: 844 } }, null, '수도권');
    await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); await p.waitForTimeout(200);
    const chips = p.locator('.view > .chips', { has: p.locator('button.chip', { hasText: /^인기$/ }) }).locator('.chip'), nTab = await chips.count(), cards = [];
    for (let i = 0; i < nTab; i++) { await chips.nth(i).click(); await p.waitForTimeout(200);
      cards.push(...await p.$$eval('#main .pwrap > .addbtn', (as) => as.map((a) => { const s = a.querySelector(':scope > span');
        return { all: a.textContent.trim(), vis: a.innerText.trim(), aria: a.getAttribute('aria-label'), cut: s.scrollWidth > s.clientWidth + 1, short: (s.lastChild.textContent || '').length <= 6 }; }))); }
    ok('Q1c', `홈 카드 담기에 '기본'만 적힌 것 없음 ${W}px`, cards.length > 0 && !cards.some((x) => /· 기본$/.test(x.all)), `${cards.length}장 중 ${cards.filter((x) => /· 기본$/.test(x.all)).length}`);
    ok('Q1c', `홈 카드: 짧은 규격(6자 이하)은 잘리지 않음 ${W}px`, cards.filter((x) => x.short).length > 0 && !cards.some((x) => x.short && x.cut), cards.filter((x) => x.short && x.cut).map((x) => x.vis).join(', '));
    ok('Q1c', `홈 카드: 글자 ${W < 336 ? "'담기 · ' 없이 규격만" : "'담기 · 규격'"}, 이름표는 늘 '담기 · 규격 — …'`, cards.every((x) => (W < 336 ? !/^담기/.test(x.vis) : /^담기 · /.test(x.vis)) && /^담기 · .+ — /.test(x.aria)), cards[0] && `${cards[0].vis} / ${cards[0].aria}`);
    const ids = await p.evaluate(() => { const { D, BR } = App.state(), S = D.s;
      const short = ['강남역점', '홍대점', '강남본점'].map((n) => { const i = D.branches.findIndex((x) => S[x[1]] === n); return i >= 0 ? `${D.meta.brands[BR[i].brand][0]}|${BR[i].name}` : null; }).filter(Boolean);
      localStorage.setItem('pc:short', JSON.stringify(short));
      return D.keys.filter((k) => k[2].length >= 28).slice(0, 12).map((k) => k[0]); });
    const bad = []; let seen = 0, long = 0;
    for (const id of ids) { await p.evaluate((x) => { history.pushState(null, '', '#quick?k=' + encodeURIComponent(x)); dispatchEvent(new PopStateEvent('popstate')); }, id); await p.waitForTimeout(250);
      const r = await p.evaluate((W) => { const a = document.querySelector('#main .qact .addbtn'); if (!a) return null; const c = a.closest('.card').getBoundingClientRect(), ar = a.getBoundingClientRect();
        return { txt: a.textContent.trim(), ok: ar.right <= c.right + 0.5 && document.documentElement.scrollWidth <= W }; }, W);
      if (!r) continue; seen++; if (r.txt.length >= 30) long++; if (!r.ok) bad.push(r.txt); }
    ok('Q1c', `빠른 비교: 긴 이름의 담기도 카드 안, 가로 스크롤 없음 ${W}px`, seen > 0 && long > 0 && !bad.length, `${seen}개(긴 글자 ${long}) 중 넘침 ${bad.length} ${bad[0] || ''}`);
    ok('Q1c', `스크립트 오류 없음 ${W}px`, !p.errs.length, p.errs.join(' ')); await ctx.close(); }

  // Q1d 320px price rows: the badges right under name and price, 담기 at the right end of their last line — name → price →
  // conditions → 담기 (위계 점검 21 검토), never over a badge
  { const { ctx, p } = await page({ viewport: { width: 320, height: 700 } }, null, '수도권');
    await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    for (const q of ['리쥬란 2cc', '보톡스']) {
      await p.goto(BASE + '#search/' + encodeURIComponent(q)); await p.waitForTimeout(1200);
      const rows = await p.$$eval('#main .list > li > .item.ra', (its) => its.map((it) => { const a = it.querySelector(':scope > .addbtn').getBoundingClientRect(), pr = it.querySelector(':scope > .p').getBoundingClientRect(), m = it.querySelector(':scope > .m').getBoundingClientRect();
        const hit = [...it.querySelectorAll('.m > *')].map((x) => x.getBoundingClientRect()).some((r) => r.width && r.left < a.right - 0.5 && r.right > a.left + 0.5 && r.top < a.bottom - 0.5 && r.bottom > a.top + 0.5);
        return Math.abs(a.right - pr.right) <= 1 && Math.abs(a.bottom - m.bottom) <= 1 && m.top >= pr.bottom - 1 && !hit; }));
      ok('Q1d', `320px '${q}' 줄: 조건 배지 다음 줄 끝 오른쪽에 담기, 배지와 안 겹침`, rows.length > 0 && rows.every(Boolean), `${rows.filter((x) => !x).length}/${rows.length}줄 어긋남`); }
    ok('Q1d', '스크립트 오류 없음', !p.errs.length, p.errs.join(' ')); await ctx.close(); }

  // Q1e 죠미 설정 '끄기': the 담기 toast is the fixed line alone — no face, no 죠미 line under it
  { const { ctx, p } = await page();
    await p.evaluate(() => localStorage.setItem('pc:jomiPrefs', JSON.stringify({ freq: 'off', motion: 'auto', detail: 'short' }))); await p.reload(); await p.waitForSelector('.pc');
    await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); await p.waitForTimeout(200);
    await p.locator('#main .pwrap .addbtn').first().click(); await p.waitForTimeout(300);
    const t = await p.locator('#toast').innerText();
    ok('Q1e', "죠미 끄기: 담기 알림은 첫 줄만(얼굴·죠미 말 없음)", /^내 견적에 담았어요 · .+ \(1개\)/.test(t) && await p.locator('#toast .ts').count() === 0 && await p.locator('#toast img.mascot').count() === 0, t.replace(/\n/g, ' / '));
    ok('Q1e', '스크립트 오류 없음', !p.errs.length, p.errs.join(' ')); await ctx.close(); }

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
    const qn = await p.$$eval('.qline .qname', (s) => s.map((x) => x.textContent));   // the clinic's product name (in the line's '자세히')
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
    { const s = p.locator('#main .settings details.setrow > summary', { hasText: '가격 표시' }); if (!(await s.evaluate((x) => x.parentElement.open))) { await s.click(); await p.waitForTimeout(150); } }   // 내 설정: one line per setting, opened
    await p.locator('.setseg [role=radio]', { hasText: '병원 표시가' }).click(); await p.waitForTimeout(200);
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
    await p.locator('.morelist', { hasText: '일부만 되는 곳' }).click(); await p.waitForTimeout(300);
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
    ok('Q5', '"확인된 시술만 예상 합계"(round-2 UX03 문구)와 0원 아님 안내', /확인된 시술만 예상 합계/.test(text) && /0원 아님/.test(text));
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
    const names = await p.$$eval('.gitem', (gs) => gs.map((g, i) => [i, g.querySelector('b').textContent, !!g.querySelector('.btn')]).filter((x) => x[2]));
    const sample = names.filter((_, j) => j < 10 || j % Math.max(1, Math.floor(names.length / 25)) === 0).slice(0, 40);
    let bad = [];
    for (const [i, name] of sample) {
      await p.goto(BASE + '#guide'); await p.waitForTimeout(250);
      await p.locator('.gitem').nth(i).locator('.btn').click(); await p.waitForTimeout(300);
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
      const g = p.locator('.gitem').filter({ has: p.locator('.btn') }).first(); if (!(await g.count())) { sbad.push(`${q}: 항목 없음`); continue; }
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
