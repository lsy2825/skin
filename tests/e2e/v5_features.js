// v5.0 directive additions in a real browser: A/B comparison (sticky legend, plain-language gap, per-item bars, cart-only
// totals that never count a missing item as 0원, one-side-only list, share link), viewing-history controls (stop
// recording, clear with undo), deleting saved home/work places, what '인기' and 죠미's discovery mean, the cart's sticky summary, the map distance filter.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/v5_features.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const num = (t) => +String(t).replace(/[^\d]/g, '');
const CART = [{ id: 'a', name: '내 장바구니', items: [{ t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }, { t: 'k', k: 'X01', q: 2 }] }];

(async () => { const b = await chromium.launch();
  const page = async (opt = {}) => { const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'], ...opt }); const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await p.goto(BASE); await p.evaluate((c) => { localStorage.clear(); localStorage.setItem('pc:carts', JSON.stringify(c)); }, CART); await p.reload();
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    return { ctx, p }; };

  // ---- A/B comparison
  { const { ctx, p } = await page();
    await p.goto(BASE + '#versus/3/5'); await p.waitForTimeout(800);
    const head = await p.locator('.vshead').innerText();
    ok('A/B: 목록 위에 A·B 지점 이름', /A/.test(head) && /B/.test(head) && head.split('\n').length >= 2, head.replace(/\n/g, ' '));
    ok('A/B: 머리말이 스크롤해도 붙어 있음(sticky)', await p.locator('.vshead').evaluate((e) => getComputedStyle(e).position === 'sticky'));
    const row = p.locator('#main .card.flush .list li').first();
    const t = await row.innerText();
    ok('A/B: "○○점이 N원 저렴" 문장', /점이 [\d,]+원 저렴|같은 가격/.test(t), t.split('\n').slice(-2).join(' '));
    // the sentence's amount = |A − B| of the two prices on that row
    const ps = await row.locator('.m b').allTextContents(), gap = num((t.match(/([\d,]+)원 저렴/) || [, 0])[1]);
    ok('A/B: 문장의 금액 = 두 가격의 차이', ps.length >= 2 && gap === Math.abs(num(ps[0]) - num(ps[1])), `${ps.slice(0, 2).join(' / ')} → ${gap}`);
    ok('A/B: 항목마다 두 막대(같은 눈금)', await p.locator('#main .pbars').count() > 3);
    const same = await p.$$eval('#main .card.flush .list li', (ls) => ls.filter((l) => /같음/.test(l.querySelector('.p')?.textContent || '')).map((l) => l.querySelectorAll('.pbars i.lo').length));
    ok('A/B: 같은 가격엔 강조 없음', same.every((n) => n === 0), `같은 가격 ${same.length}개`);
    ok('A/B: 한쪽에만 있는 시술 수를 따로 보여줌', /한쪽에만 있는 시술: A에만 \d+개 · B에만 \d+개/.test(await p.locator('#main').innerText()));
    await p.locator('button', { hasText: '링크 공유' }).click(); await p.waitForTimeout(300);
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    ok('A/B: 링크 공유 = 이 두 지점 주소', /#versus\/3\/5$/.test(clip), clip);
    // cart-only
    await p.locator('label.switch', { hasText: '내 견적 시술만' }).click(); await p.waitForTimeout(500);
    const txt = await p.locator('#main').innerText();
    ok('장바구니 A/B: 담은 시술 수로 비교', /'내 장바구니' 3개 시술로 비교/.test(txt));
    const totals = await p.$$eval('#main dl.kv dd', (d) => d.map((x) => +x.textContent.replace(/[^\d]/g, '')));
    const rows = await p.$$eval('#main .card.flush .list li', (ls) => ls.map((l) => [...l.querySelectorAll('.m b')].map((b) => +b.textContent.replace(/[^\d]/g, ''))));
    const both = rows.filter((r) => r.length === 2);
    ok('장바구니 A/B: 합계 = 둘 다 있는 시술만 더한 값', totals.length === 2 && totals[0] === both.reduce((s, r) => s + r[0], 0) && totals[1] === both.reduce((s, r) => s + r[1], 0), `A ${totals[0]} / B ${totals[1]} · ${both.length}개`);
    ok('장바구니 A/B: 없는 시술은 0원으로 치지 않는다는 안내', /0원으로 치지 않고/.test(txt));
    ok('스크립트 오류 없음(A/B)', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }

  // ---- viewing history controls, home explanations, cart sticky summary
  { const { ctx, p } = await page();
    const home = await p.locator('#main').innerText();
    // round 2 UX01: the explanation is folded under '순서 기준' (closed <details> text is not in innerText)
    ok('홈: "인기" 기준 설명(파는 지점 수, 검색량 아님)', /파는 지점이 많은 순이에요\. 검색량·예약 수가 아니에요/.test(await p.locator('#main').textContent()));
    ok('홈: 죠미의 발견 고르는 기준 설명', /고르는 기준: 조건 없는 가격이 5곳 이상/.test(home) && /사람이 고르거나 광고로 정하지 않아요/.test(home));
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(500);   // → 최근 본 것
    await p.goto(BASE + '#branch/3'); await p.waitForTimeout(400);         // → 이어서 보기
    const keys = () => p.evaluate(() => ['recent', 'recentQ', 'lastRoute'].map((k) => localStorage.getItem('pc:' + k) != null));
    ok('기록: 기본은 남김(최근 본 것·이어서 보기)', (await keys())[0] && (await keys())[2]);
    await p.goto(BASE + '#me'); await p.waitForTimeout(500);
    await p.locator('button', { hasText: '기록 지우기' }).click(); await p.waitForTimeout(300);
    ok('기록 지우기: 키가 지워짐', (await keys()).every((x) => !x));
    await p.locator('.toast button', { hasText: '되돌리기' }).click(); await p.waitForTimeout(300);
    ok('기록 지우기: 되돌리기로 복구', (await keys())[0]);
    const carts0 = await p.evaluate(() => localStorage.getItem('pc:carts'));
    await p.locator('button', { hasText: '기록 지우기' }).click(); await p.waitForTimeout(300);
    ok('기록 지우기: 장바구니는 그대로', await p.evaluate(() => localStorage.getItem('pc:carts')) === carts0);
    await p.locator('label.switch', { hasText: '기록 남기기' }).click(); await p.waitForTimeout(300);
    await p.goto(BASE + '#compare?k=X24'); await p.waitForTimeout(500);
    await p.goto(BASE + '#branch/3'); await p.waitForTimeout(400);
    ok('기록 끄기: 그 뒤로는 남지 않음', (await keys()).every((x) => !x));
    await p.goto(BASE + '#cart'); await p.waitForTimeout(600);
    ok('장바구니: 요약이 보일 땐 아래 막대 숨김', await p.locator('.cartbar').isHidden());
    await p.locator('.cartsum .btn').click(); await p.waitForTimeout(400);
    await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(500);
    const bar = p.locator('.cartbar');
    ok('장바구니: 요약이 지나가면 아래에 예상 총액 막대', await bar.isVisible() && /예상 총액/.test(await bar.innerText()) && /원/.test(await bar.innerText()), (await bar.innerText().catch(() => '')).replace(/\n/g, ' '));
    // saved home/work places can be deleted (with undo)
    await p.evaluate(() => localStorage.setItem('pc:places', JSON.stringify({ '집': { lat: 37.5, lng: 127.03 } })));
    await p.click('#locbtn'); await p.waitForTimeout(300);
    await p.locator('.sheet button', { hasText: '저장한 집·직장 지우기' }).click(); await p.waitForTimeout(300);
    ok('저장한 집·직장 지우기', await p.evaluate(() => localStorage.getItem('pc:places')) === '{}');
    await p.locator('.toast button', { hasText: '되돌리기' }).click(); await p.waitForTimeout(300);
    ok('집·직장 지우기 되돌리기', /37\.5/.test(await p.evaluate(() => localStorage.getItem('pc:places'))));
    ok('스크립트 오류 없음(기록·장바구니)', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }

  // ---- map distance filter (with a location)
  { const { ctx, p } = await page({ geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'] });
    await p.goto(BASE + '#map'); await p.waitForTimeout(1000);
    ok('지도: 위치 전에는 거리 칩 없음', await p.locator('#near [aria-label="거리"]').count() === 0);
    await p.click('#locbtn'); await p.waitForTimeout(1500);
    const sheetBtn = p.locator('.sheet button', { hasText: /현재 위치|내 위치/ }).first(); if (await sheetBtn.count()) { await sheetBtn.click(); await p.waitForTimeout(1500); }
    await p.goto(BASE + '#map'); await p.waitForTimeout(1200);
    const chips = p.locator('#near [aria-label="거리"] .chip');
    if (await chips.count()) {
      const n0 = num((await p.locator('#near .sub').first().textContent()).split('곳')[0]);
      await chips.filter({ hasText: '1km' }).click(); await p.waitForTimeout(500);
      const n1 = num((await p.locator('#near .sub').first().textContent()).split('곳')[0]);
      const far = await p.$$eval('#near li .m b', (bs) => bs.map((b) => b.textContent).filter((t) => /km/.test(t) && parseFloat(t) > 1).length);
      ok('지도: 1km를 고르면 목록이 1km 안으로 줄어듦', n1 <= n0 && far === 0, `${n0} → ${n1}곳`);
    } else ok('지도: 위치를 정하면 거리 칩', false, '위치 설정 흐름을 찾지 못했어요');
    ok('스크립트 오류 없음(지도)', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
