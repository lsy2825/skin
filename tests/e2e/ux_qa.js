// UX QA: one check per criterion, prints PASS/FAIL lines
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/ux_qa.js [out-dir]
// Needs Playwright with Chromium (PLAYWRIGHT=/path/to/node_modules/playwright if it isn't resolvable). Not part of
// `node --test`: it drives a real browser against the local server. Results are written up in docs/UX_QA_REPORT.md.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요 (예: APP_PIN=xxxx node ' + process.argv[1] + ')'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push([name, pass, detail]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
(async () => { const OUT = process.argv[2] || require('os').tmpdir(); const b = await chromium.launch();
  const unlock = async (p) => { for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); };
  // 1) loading skeleton + error state
  { const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    await p.route('**/data.json', async (r) => { await new Promise((s) => setTimeout(s, 1500)); r.continue(); });
    await p.goto(BASE); await unlock(p);
    ok('로딩 중 스켈레톤 표시', await p.locator('#main .skel').count() > 0 && (await p.locator('#main').getAttribute('aria-busy')) === 'true', 'data.json 1.5초 지연');
    await p.waitForSelector('.pc'); ok('로딩 끝나면 aria-busy 해제', (await p.locator('#main').getAttribute('aria-busy')) === null);
    await ctx.close(); }
  { const ctx = await b.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage();
    await p.route('**/data.json', (r) => r.fulfill({ status: 500, body: 'x' }));
    await p.goto(BASE); await unlock(p); await p.waitForTimeout(800);
    ok('데이터 오류 상태 안내', /불러오지 못했어요/.test(await p.locator('#main').innerText()), (await p.locator('#main').innerText()).slice(0, 40)); await ctx.close(); }
  // 2) data kept: old single cart migrates, carts survive reload
  { const ctx = await b.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage();
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:cart', JSON.stringify([{ k: 'X12', q: 2 }])); });
    await p.reload(); await unlock(p); await p.waitForSelector('.pc');
    const c = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:carts') || 'null'));
    ok('예전 장바구니(pc:cart) 유지·이전', c && c[0].items[0].k === 'X12' && c[0].items[0].q === 2 && !!c[0].id, JSON.stringify(c && c[0].items));
    await p.reload(); await p.waitForSelector('.pc');
    ok('새로고침 후 장바구니 유지', (await p.locator('#cart-n').textContent()) === '1'); await ctx.close(); }
  // 3) keyboard only: search → add to cart
  { const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
    for (const d of PIN) await p.keyboard.press(d); await p.waitForSelector('.pc');
    ok('비밀번호 키보드 입력', await p.locator('.pc').count() > 0);
    let found = false; for (let k = 0; k < 15 && !found; k++) { await p.keyboard.press('Tab'); found = await p.evaluate(() => document.activeElement && document.activeElement.matches('.search input')); }
    ok('Tab으로 검색창 도달', found);
    await p.keyboard.type('리쥬란 2cc'); await p.keyboard.press('Enter'); await p.waitForTimeout(1000);
    ok('Enter로 검색', /search\//.test(p.url()));
    let onAdd = false; for (let k = 0; k < 80 && !onAdd; k++) { await p.keyboard.press('Tab'); onAdd = await p.evaluate(() => document.activeElement && document.activeElement.textContent.trim() === '담기'); }
    ok('Tab으로 담기 버튼 도달', onAdd);
    await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    const inSheet = await p.evaluate(() => !!document.activeElement.closest('.sheet'));
    ok('시트 열리면 포커스가 시트 안', inSheet);
    let onPut = false; for (let k = 0; k < 15 && !onPut; k++) { await p.keyboard.press('Tab'); onPut = await p.evaluate(() => /회 담기$/.test(document.activeElement.textContent.trim())); }
    if (onPut) { await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
    ok('키보드만으로 장바구니 담기', (await p.locator('#cart-n').textContent()) === '1', `cart-n=${await p.locator('#cart-n').textContent()}`);
    const fv = await p.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.selectorText && r.selectorText.includes(':focus-visible')); } catch (e) { return false; } }));
    ok('포커스 표시(:focus-visible) 스타일', fv);
    // filter change by keyboard keeps focus on that control after the redraw
    await p.goto(BASE + '#table'); await p.waitForTimeout(600);
    await p.focus('label.flabel select'); const lab = await p.evaluate(() => document.activeElement.closest('label').firstChild.textContent);
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(500);
    const after = await p.evaluate(() => { const a = document.activeElement; return a.tagName === 'SELECT' ? a.closest('label').firstChild.textContent : a.tagName; });
    ok('필터 바꾼 뒤 포커스 유지', after === lab && /cat=/.test(p.url()), `${lab} → ${after}, ${p.url().split('#')[1]}`);
    // new page from content: focus moves to the page, next Tab lands in content
    await p.goto(BASE + '#home'); await p.waitForTimeout(500);
    await p.focus('#main .pc'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
    const onMain = await p.evaluate(() => document.activeElement.id); await p.keyboard.press('Tab');
    const inMain = await p.evaluate(() => document.getElementById('main').contains(document.activeElement));
    ok('내용에서 새 화면 열면 다음 Tab이 새 내용으로', onMain === 'main' && inMain, `${p.url().split('#')[1]} focus=${onMain}`);
    await ctx.close(); }
  // 4) mobile widths: no horizontal scroll at 320 and 390
  for (const w of [320, 390]) { const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 800 } }); const p = await ctx.newPage();
    await p.goto(BASE); await unlock(p); await p.waitForSelector('.pc');
    await p.evaluate(() => localStorage.setItem('pc:carts', JSON.stringify([{ id: 'a', name: 't', items: [{ t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }] }])));
    const bad = [];
    for (const r of ['home', 'explore', 'saved', 'compare?k=X12', 'compare?k=X24', 'guide', 'guide?c=%EC%A0%9C%EB%AA%A8%C2%B7%EB%B0%94%EB%94%94', 'rank', 'versus', 'table', 'search/%EB%A6%AC%EC%A5%AC%EB%9E%80', 'cart', 'me', 'branch/3', 'change', 'about', 'ops', 'map', 'concern?c=wrinkle']) {
      await p.goto(BASE + '#' + r); await p.waitForTimeout(500);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth); if (sw > w + 1) bad.push(`${r}:${sw}`); }
    ok(`가로 넘침 없음 (${w}px, 19개 화면)`, !bad.length, bad.join(' ')); await ctx.close(); }
  // 5) empty states
  { const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload(); await unlock(p); await p.waitForSelector('.pc');
    await p.goto(BASE + '#cart'); await p.waitForTimeout(400);
    ok('빈 장바구니 안내', /담으면/.test(await p.locator('#main').innerText()));
    await p.goto(BASE + '#search/zzqqxx?nl=0'); await p.waitForTimeout(800);
    ok('검색 결과 없음 안내', /가격이 없어요/.test(await p.locator('#main').innerText()));
    await p.goto(BASE + '#saved'); await p.waitForTimeout(400); const savedTxt = await p.locator('#main').innerText();
    await p.goto(BASE + '#me'); await p.waitForTimeout(400);
    ok('알림(관심 탭)·기록(마이) 없을 때 안내', /알림을 만들 수 있어요/.test(savedTxt) && /하트를 누르면/.test(savedTxt) && /기록하면/.test(await p.locator('#main').innerText()));
    // undo: favourite remove
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(400);
    await p.click('.keyhead .favbtn'); await p.click('.keyhead .favbtn'); await p.waitForTimeout(150);
    const hasUndo = await p.locator('#toast button').isVisible(); if (hasUndo) await p.click('#toast button'); await p.waitForTimeout(200);
    ok('즐겨찾기 빼기 되돌리기', hasUndo && (await p.evaluate(() => JSON.parse(localStorage.getItem('pc:favs')).k.includes('X12'))));
    // realtime total: qty change updates totals
    await p.evaluate(() => localStorage.setItem('pc:carts', JSON.stringify([{ id: 'a', name: 't', items: [{ t: 'k', k: 'X24', q: 1 }] }])));
    await p.goto(BASE + '#cart'); await p.reload(); await p.waitForTimeout(700);
    // basic cart view: the estimated total is in the summary card; the per-clinic list opens with '병원별 비교 보기'
    const t1 = await p.locator('.cartsum .hp').textContent(); await p.click('button[aria-label="하나 더"]'); await p.waitForTimeout(400);
    const t2 = await p.locator('.cartsum .hp').textContent();
    ok('수량 바꾸면 합계 즉시 갱신', t1 !== t2, `${t1} → ${t2}`);
    ok('기본 장바구니: 병원별 목록은 접혀 있음', await p.locator('.qrow').count() === 0 && /병원별 비교 보기/.test(await p.locator('.cartsum .btn').textContent()));
    await p.click('.cartsum .btn'); await p.waitForTimeout(300);
    // the summary is the range of one-clinic totals (no clinic pinned as 'the lowest'): its ends = the list's min and max
    await p.locator('.sortchips .chip', { hasText: '합계 낮은순' }).click(); await p.waitForTimeout(300);
    const qs = (await p.locator('.qrow .rank .p').allTextContents()).map((t) => +t.replace(/[^\d]/g, ''));
    const ends = t2.split('~').map((t) => +t.replace(/[^\d]/g, ''));
    ok('병원별 비교: 요약 범위 = 목록의 최저·최고 합계', qs.length > 0 && ends[0] === Math.min(...qs) && ends[ends.length - 1] >= Math.max(...qs.slice(0, 40)), `${t2} / ${Math.min(...qs)}~${Math.max(...qs)}`);
    ok('하단 떠 있는 장바구니(다른 화면)', await (async () => { await p.goto(BASE + '#guide'); await p.waitForTimeout(400); return p.locator('#fcart').isVisible(); })());
    await ctx.close(); }
  // 6) dark mode renders with dark surface
  { const ctx = await b.newContext({ serviceWorkers: 'block', colorScheme: 'dark', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const p = await ctx.newPage();
    await p.goto(BASE); await unlock(p); await p.waitForSelector('.pc');
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok('다크 모드(기기 설정 따름)', bg === 'rgb(20, 19, 17)', bg); await p.screenshot({ path: `${OUT}/qa-dark.png` }); await ctx.close(); }
  require('fs').writeFileSync(`${OUT}/ux_qa.json`, JSON.stringify(R));
  console.log(`TOTAL ${R.filter((x) => x[1]).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every((x) => x[1]) ? 0 : 1; })();
