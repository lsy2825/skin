// 길이 예산 (6.0 규칙 6 '핵심 화면은 기본 상태 7장 안팎 — 화면 측정 검사가 넘으면 실패', 2026-10-16 위계 점검 16 · L12):
// the core screens in their default state, measured in a real browser on two phone sizes (390×844 and 375×667), 수도권:
//  A. length: home · search '리쥬란 2cc' · search '보톡스' · compare X01 · branch (블리비 강남역점, 851 prices) · 내 견적 with its
//     clinic comparison open — each 9장 (7 ± 2) or shorter. 장 = 844 px on both sizes (a smaller phone gets no extra length)
//  B. where the decision material starts (top of the element, in 장): the search's first spec or kind ≤ 1 and its first price
//     line ≤ 2 (it was 2.97 and 4.82), the compare price range ≤ 1 and its first branch line ≤ 3 (6.0: '첫 3화면'), the
//     branch's first price ≤ 2, home's first price card ≤ 1
//  C. the shared '더 보기' (위계 점검 11 · 5 · 6 · 8): '20곳 더 보기 (N곳 남음)', 20 more per tap and the first new line focused;
//     the branch list keeps what was typed when it grows, and '전체' shows every 분야 under its own heading (추가 옵션 after
//     the 분야's treatments); a 분야's '모두 보기' turns its chip on in sight (the chip row is wider than the screen) with the
//     price card's head below the sticky top bar; two '더 보기' in one card have different names for a screen reader; a
//     search page never opens with its only spec / kind card folded
//  D. order and ways in (위계 점검 7 · 15): 수도권's '지역·이름순' starts in 서울 (서울 → 경기 → 인천), a '가까운 5곳' way in when
//     no place is set (closing its sheet without a place leaves the order as it was), and 탐색 / the search page's box open a
//     named spec's comparison like 홈's box does
// Prints every number it measured so a slow creep shows before it fails.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/length_budget.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 240)}`); };
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 375, height: 667 }];
const JANG = 844, BUDGET = 9;   // 9장 = 7 ± 2 (6.0 규칙 6, 모바일 길이 글 '총 길이는 7스크린±2')
const CART = [{ t: 'k', k: 'X14', q: 3 }, { t: 'k', k: 'X01', q: 2 }, { t: 'k', k: 'X12', q: 1 }];
const enc = encodeURIComponent;

(async () => { const b = await chromium.launch();
  for (const vp of VIEWPORTS) {
    const tag = `${vp.width}×${vp.height}`;
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    const ready = () => p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('수도권')); }); await p.reload();
    if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
    await p.waitForSelector('.pc'); await ready();
    const branch = await p.evaluate(() => { const { D } = App.state(), S = D.s; return Math.max(0, D.branches.findIndex((x) => S[x[1]] === '강남역점')); });
    // open a screen, wait, measure: page length and the top of the first visible match of each selector, in 장
    const at = async (hash, sel, wait = 1000) => {
      await p.goto(BASE + '#' + hash); await p.waitForTimeout(wait); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(150);
      return p.evaluate(([sel, J]) => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('details:not([open]) > :not(summary)'); };
        const o = { len: +(document.documentElement.scrollHeight / J).toFixed(2) };
        for (const [k, s] of Object.entries(sel)) { const e = [...document.querySelectorAll(s)].find(vis); o[k] = e ? +((e.getBoundingClientRect().top + scrollY) / J).toFixed(2) : null; }
        return o; }, [sel, JANG]);
    };
    const pos = (v, max) => v != null && v <= max;
    const tap = (loc) => loc.first().click({ timeout: 4000 }).then(() => true).catch(() => false);   // a missing button is a FAIL below, not a crash
    const fmt = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · ');

    // ---- A + B: length and where the decision material starts
    const home = await at('home', { price: '#main .pc' });
    ok(`${tag} 홈 ${BUDGET}장 이하 · 첫 가격 카드 1장 안`, home.len <= BUDGET && pos(home.price, 1), fmt(home));
    const sr = await at(`search/${enc('리쥬란 2cc')}`, { spec: '#main .card.keys li .item', row: '#main .card.flush .list > li' });
    ok(`${tag} 검색 '리쥬란 2cc' ${BUDGET}장 이하 · 같은 조건 비교 1장 · 첫 가격 줄 2장 안`, sr.len <= BUDGET && pos(sr.spec, 1) && pos(sr.row, 2), fmt(sr));
    const sb = await at(`search/${enc('보톡스')}`, { kind: '#main .card.fams li .item, #main .card.keys li .item', row: '#main .card.flush .list > li' });
    ok(`${tag} 검색 '보톡스' ${BUDGET}장 이하 · 종류 1장 · 첫 가격 줄 2장 안`, sb.len <= BUDGET && pos(sb.kind, 1) && pos(sb.row, 2), fmt(sb));
    const cp = await at('compare?k=X01', { range: '#main .pricecard .hp', row: '#clinics li.rk, #clinics .ccard' });
    ok(`${tag} 비교 X01 ${BUDGET}장 이하 · 가격 범위 1장 · 첫 지점 줄 3장 안`, cp.len <= BUDGET && pos(cp.range, 1) && pos(cp.row, 3), fmt(cp));
    const br = await at(`branch/${branch}`, { price: '#main .card.flush li .item' }, 1200);
    ok(`${tag} 지점(강남역점) ${BUDGET}장 이하 · 첫 가격 2장 안`, br.len <= BUDGET && pos(br.price, 2), fmt(br));
    await p.evaluate((c) => { localStorage.setItem('pc:carts', JSON.stringify([{ id: 'len', name: '길이 시험', items: c }])); localStorage.setItem('pc:ci', '0'); }, CART);
    await p.goto(BASE + '#cart'); await p.reload(); await ready(); await p.waitForSelector('#main .cart-items');
    const ex = p.locator('.cartsum button[aria-expanded="false"]'); if (await ex.count()) { await ex.first().click(); await p.waitForTimeout(600); }
    const cq = await p.evaluate((J) => ({ len: +(document.documentElement.scrollHeight / J).toFixed(2), rows: document.querySelectorAll('#main li.qrow').length }), JANG);
    ok(`${tag} 내 견적(병원별 비교 펼침) ${BUDGET}장 이하`, cq.len <= BUDGET && cq.rows > 0, fmt(cq));

    if (vp.width === 390) {
      // ---- C: the shared '더 보기'
      const MORE = /^(\d+)(곳|개) 더 보기 \(([\d,]+)\2 남음\)$/;
      const label = (sel) => p.locator(sel).first().innerText().then((t) => t.trim()).catch(() => '');
      // compare: 10 lines, then 20 more a tap (it was all 185 at once), the first new line focused
      await p.goto(BASE + '#compare?k=X01'); await p.waitForTimeout(900);
      const n0 = await p.locator('#clinics li.rk').count(), l0 = await label('#clinics .morelist'), m0 = MORE.exec(l0);
      await tap(p.locator('#clinics .morelist')); await p.waitForTimeout(600);
      const n1 = await p.locator('#clinics li.rk').count(), f1 = await p.evaluate(() => { const li = document.activeElement && document.activeElement.closest('#clinics li.rk'); return li ? [...li.parentElement.children].indexOf(li) : -1; });
      ok(`${tag} 비교 더 보기: '20곳 더 보기 (N곳 남음)' → 20줄 늘고 새 첫 줄에 초점`, n0 === 10 && !!m0 && m0[1] === '20' && m0[2] === '곳' && n1 === 30 && f1 === 10, `${n0}→${n1}줄 · '${l0}' · 초점 ${f1}`);
      // search: 20 price lines (전체 가격표 keeps 100), 20 more in place, the count kept in the address
      await p.goto(BASE + `#search/${enc('리쥬란 2cc')}`); await p.waitForTimeout(1000);
      const s0 = await p.locator('#main .card.flush .list > li').count(), sl = await label('#main .card.flush .morelist');
      await tap(p.locator('#main .card.flush .morelist')); await p.waitForTimeout(400);
      const s1 = await p.locator('#main .card.flush .list > li').count();
      ok(`${tag} 검색 가격 줄 20개 + '20개 더 보기' → 40개, 주소에 n=40`, s0 === 20 && MORE.test(sl) && s1 === 40 && /[?&]n=40\b/.test(p.url()), `${s0}→${s1} · '${sl}' · ${p.url().split('#')[1]}`);
      const stat = await p.locator('#main .searchstat').innerText().catch(() => '');
      ok(`${tag} 검색 용량이 섞이면 가격 범위 대신 안내`, /여러 용량/.test(stat) && !/~/.test(stat) && await p.locator('#main .mixstat').count() === 1, stat);
      for (const q of ['스킨보톡스 100U', '리쥬란 2cc', '보톡스']) {
        await p.goto(BASE + `#search/${enc(q)}`); await p.waitForTimeout(900);
        const f = await p.evaluate(() => ({ fold: [...document.querySelectorAll('#main details.sfold')].map((d) => d.className.split(' ').pop()), open: [...document.querySelectorAll('#main div.card.keys, #main div.card.fams')].map((d) => d.className.split(' ').pop()) }));
        ok(`${tag} 검색 '${q}': 접힌 규격·종류 카드 위에는 펼친 카드가 있음`, !f.fold.length || f.open.length > 0, `펼침 ${f.open.join(',') || '없음'} · 접힘 ${f.fold.join(',') || '없음'}`);
      }
      await p.goto(BASE + '#table'); await p.waitForTimeout(900);
      ok(`${tag} 전체 가격표는 처음 100줄 그대로`, await p.locator('#main .card.flush .list > li').count() === 100);
      // branch: '전체' = every 분야 under a heading with its first lines and '○○ N개 모두 보기'; one end date said once
      await p.goto(BASE + `#branch/${branch}`); await p.waitForTimeout(1200);
      const g = await p.evaluate(() => { const lis = [...document.querySelectorAll('#main .card.flush .list > li')]; const heads = lis.filter((l) => l.classList.contains('bgh'));
        let max = 0, cur = 0; for (const l of lis) { if (l.classList.contains('bgh')) cur = 0; else if (l.querySelector('.item')) max = Math.max(max, ++cur); }
        const cg = document.querySelector('#bprices .chips') || document.querySelector('#main .card .chips'), chips = cg ? cg.querySelectorAll('.chip').length - 1 : -1;
        return { heads: heads.length, chips, max, all: [...document.querySelectorAll('#main .card.flush .morelist')].map((x) => x.textContent), date: (document.querySelector('#bprices .bdate') || {}).textContent || '',
          rowDates: document.querySelectorAll('#main .card.flush .list .k.k4').length && [...document.querySelectorAll('#main .card.flush .list .k.k4')].filter((k) => /까지$/.test(k.textContent)).map((k) => k.textContent) }; });
      const headDate = (/~(\d+\/\d+)까지/.exec(g.date) || [])[1];
      // from the data: does one end date sit on at least 80% of this branch's prices? then it must be said once, above
      const common = await p.evaluate((b) => { const { D, ROWS, byB } = App.state(), S = D.s, c = new Map(), ids = byB[b];
        for (const i of ids) { const r = ROWS[i], u = S[r[10]] || ''; if (!r[15] && /^\d{4}-\d{2}-\d{2}$/.test(u) && u < '2099') c.set(u, (c.get(u) || 0) + 1); }
        const top = [...c].sort((x, y) => y[1] - x[1])[0]; return top && top[1] >= 10 && top[1] >= 0.8 * ids.length ? `${+top[0].slice(5, 7)}/${+top[0].slice(8, 10)}` : null; }, branch);
      ok(`${tag} 지점 '전체': 분야마다 소제목 + 처음 5~7줄 + '○○ N개 모두 보기'`, g.heads >= 2 && g.heads === g.chips && g.max <= 7 && g.all.length >= 1 && g.all.every((t) => /^\S.* [\d,]+개 모두 보기$/.test(t)), `${g.heads}분야/${g.chips}칩 · 최대 ${g.max}줄 · ${g.all[0] || ''}`);
      ok(`${tag} 지점: 같은 종료일(가격의 80% 이상)은 가격표 머리에 한 번, 그 날짜는 줄에서 빠짐`, common ? headDate === common && !(g.rowDates || []).some((t) => t === `~${common}까지`) : !g.date,
        `자료의 공통 날짜 ${common || '없음'} · 머리 '${g.date.slice(0, 60)}' · 줄 날짜 ${(g.rowDates || []).slice(0, 3).join(',')}`);
      // each 분야's first lines: what the 분야 sells first — a 추가 옵션 ('…1회 추가', sold only with another treatment) after them
      const addonFirst = await p.evaluate(() => { const bad = []; let cur = '', seen = false;
        for (const li of document.querySelectorAll('#main .card.flush .list > li')) {
          if (li.classList.contains('bgh')) { cur = li.querySelector('h4').textContent; seen = false; continue; }
          if (!li.querySelector('.item')) continue;
          const add = [...li.querySelectorAll('.k.k4')].some((k) => k.textContent === '추가 옵션');
          if (add) seen = true; else if (seen) bad.push(cur);
        }
        return [...new Set(bad)]; });
      ok(`${tag} 지점 분야 미리보기: 추가 옵션은 그 분야 시술 뒤`, !addonFirst.length, addonFirst.join(',') || '모든 분야 시술 먼저');
      // '모두 보기' of the right-most 분야 with more than 30 lines (its chip sits past the screen's right edge): the chip is
      // on and in sight, the price card's head just below the sticky top bar (not under it), focus on that chip
      const alls = await p.locator('#main .card.flush li.bgmore .morelist').allInnerTexts();
      const pick = alls.map((t, n) => [n, +((/([\d,]+)개 모두 보기$/.exec(t) || [])[1] || '0').replace(/,/g, '')]).filter(([, c]) => c > 30).map(([n]) => n).pop() ?? alls.length - 1;
      const catName = (alls[pick] || '?').replace(/ [\d,]+개 모두 보기$/, '');
      await tap(p.locator('#main .card.flush li.bgmore .morelist').nth(pick)); await p.waitForTimeout(700);
      const on = await p.locator('#bprices .chips .chip[aria-pressed="true"]').first().innerText({ timeout: 3000 }).catch(() => '');
      const c30 = await p.locator('#main .card.flush .list > li .item').count();
      ok(`${tag} 지점 '모두 보기' → 그 분야 칩이 켜지고 30줄 + 더 보기`, on.startsWith(catName) && c30 === 30 && MORE.test(await label('#main .card.flush .morelist')), `${catName} → 칩 '${on}' · ${c30}줄`);
      const seen = () => p.evaluate(() => { const on = document.querySelector('#bprices .chips .chip[aria-pressed="true"]'), r = on ? on.getBoundingClientRect() : null;
        const card = document.querySelector('#bprices').getBoundingClientRect().top, bar = document.querySelector('#top').getBoundingClientRect().bottom;
        return { chip: on ? on.textContent : '', x: r ? [Math.round(r.left), Math.round(r.right)] : null, inView: !!r && r.left >= 0 && r.right <= innerWidth, focus: document.activeElement === on, card: Math.round(card), bar: Math.round(bar) }; });
      const sc = await seen();
      ok(`${tag} 지점 '모두 보기' → 켜진 칩이 화면 안, 가격표 머리가 위 막대 바로 아래, 초점은 그 칩`, sc.inView && sc.focus && sc.card >= sc.bar && sc.card <= sc.bar + 24,
        `칩 '${sc.chip}' x ${sc.x} (폭 ${vp.width}) · 초점 ${sc.focus} · 가격표 머리 ${sc.card}px / 위 막대 ${sc.bar}px`);
      // a chip tapped where it sits (the row scrolled sideways first): still in sight after the redraw
      await tap(p.locator('#bprices .chips .chip', { hasText: /^전체$/ })); await p.waitForTimeout(500);
      const lastChip = p.locator('#bprices .chips').first().locator('.chip').last();
      await lastChip.scrollIntoViewIfNeeded().catch(() => {}); await tap(lastChip); await p.waitForTimeout(600);
      const st2 = await seen();
      ok(`${tag} 지점 분야 칩을 누르면 다시 그린 뒤에도 그 칩이 보임`, st2.inView && st2.chip === (await lastChip.innerText().catch(() => '')), `칩 '${st2.chip}' x ${st2.x}`);
      // typed words stay when the list grows (paint, not render)
      await tap(p.locator('#main .card .chips .chip', { hasText: /^전체$/ })); await p.waitForTimeout(500);   // 전체
      await p.fill('input[aria-label="이 지점에서 시술 찾기"]', '보톡스'); await p.waitForTimeout(400);
      const t0 = await p.locator('#main .card.flush .list > li .item').count();
      if (await p.locator('#main .card.flush .morelist').count()) { await tap(p.locator('#main .card.flush .morelist')); await p.waitForTimeout(400); }
      const t1 = await p.locator('#main .card.flush .list > li .item').count(), typed = await p.inputValue('input[aria-label="이 지점에서 시술 찾기"]');
      ok(`${tag} 지점 검색어 입력 → 30줄, 더 보기 → 20줄 더, 입력한 말은 그대로`, t0 === 30 && t1 > t0 && t1 <= 50 && typed === '보톡스', `${t0}→${t1}줄 · '${typed}'`);
      // 내 견적 → 병원별 비교: 40 clinics, then the same 더 보기 (it was a grey line)
      await p.goto(BASE + '#cart'); await p.waitForTimeout(700);
      const ex2 = p.locator('.cartsum button[aria-expanded="false"]'); if (await ex2.count()) { await ex2.first().click(); await p.waitForTimeout(600); }
      const q0 = await p.locator('#main li.qrow').count(), ql = await label('#main .card.flush .morelist >> nth=0');
      const qm = MORE.exec(ql);
      if (qm) { await tap(p.locator('#main .card.flush .morelist')); await p.waitForTimeout(500); }
      const q1 = await p.locator('#main li.qrow').count();
      ok(`${tag} 내 견적 병원별 비교 40곳 + '20곳 더 보기 (N곳 남음)'`, q0 === 40 && !!qm && qm[2] === '곳' && q1 === 40 + +qm[1], `${q0}→${q1} · '${ql}'`);
      const part = p.locator('#main .card.flush .morelist', { hasText: /^일부만 되는 곳 [\d,]+곳 보기$/ });
      if (await part.count()) { await tap(part); await p.waitForTimeout(600); }
      const names = await p.evaluate(() => [...document.querySelectorAll('#main .card.flush .morelist')].filter((b) => /더 보기/.test(b.textContent)).map((b) => b.getAttribute('aria-label') || b.textContent));
      ok(`${tag} 내 견적: 한 카드의 '더 보기'가 둘이면 화면 읽기 이름이 서로 달라요(목록 이름)`, names.length >= 1 && new Set(names).size === names.length && names.every((n) => /^(모두 받을 수 있는 곳|일부만 되는 곳) /.test(n)), names.join(' / '));

      // ---- D: order and ways in
      await p.goto(BASE + '#compare?k=X01'); await p.waitForTimeout(900);
      const reg = await p.evaluate(() => { const { BR } = App.state(); return [...document.querySelectorAll('#clinics li.rk')].map((li) => BR[+li.dataset.b].region); });
      const RANK = { 서울: 0, 경기: 1, 인천: 2 }, sorted = reg.every((x, i) => i === 0 || (RANK[reg[i - 1]] ?? 3) <= (RANK[x] ?? 3));
      ok(`${tag} 수도권 지역·이름순: 서울 → 경기 → 인천 (첫 줄 서울)`, reg[0] === '서울' && sorted, reg.slice(0, 12).join(','));
      const n5 = await p.locator('#clinics .near5').count() === 1 && /가까운 5곳/.test(await p.locator('#clinics .near5').innerText());
      const sort0 = await p.evaluate(() => localStorage.getItem('pc:sort'));
      await tap(p.locator('#clinics .near5')); await p.waitForTimeout(400);
      const locSh = await p.locator('.sheet').innerText().catch(() => ''); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      const after = await p.evaluate(() => ({ sort: localStorage.getItem('pc:sort'), chip: [...document.querySelectorAll('#clinics .sortchips .chip[aria-checked="true"]')].map((x) => x.textContent).join(''), near5: !!document.querySelector('#clinics .near5') }));
      ok(`${tag} 위치를 정하지 않으면 목록 위에 '기준 위치 정하기 → 가까운 5곳' — 누르면 위치 정하는 창, 그냥 닫으면 정렬 그대로`, n5 && /거리 기준 위치/.test(locSh) && after.sort === sort0 && !/가까운순/.test(after.chip) && after.near5,
        `${locSh.split('\n')[0]} · 닫은 뒤 정렬 ${after.sort} (전 ${sort0}) · 켜진 칩 ${after.chip}`);
      await p.goto(BASE + '#explore'); await p.waitForTimeout(600);
      await p.locator('#main .search input').first().fill('리쥬란 2cc'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
      const ex1 = p.url().split('#')[1];
      await p.goto(BASE + `#search/${enc('보톡스')}`); await p.waitForTimeout(900);
      const before = await p.evaluate(() => history.length);
      await p.locator('#main .search input').first().fill('리쥬란 2cc'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
      const sp1 = p.url().split('#')[1], hl = await p.evaluate(() => history.length);
      await p.goto(BASE + '#explore'); await p.waitForTimeout(600);
      await p.locator('#main .search input').first().fill('보톡스'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
      const ex3 = p.url().split('#')[1];
      ok(`${tag} 탐색·검색 입력칸도 시술·규격 이름이면 비교로('보톡스'처럼 여러 종류면 검색 목록)`, /^compare\?k=/.test(ex1) && /^compare\?k=/.test(sp1) && hl === before && /^search\//.test(ex3), `${ex1} · ${sp1} (기록 ${before}→${hl}) · ${ex3}`);
    }
    ok(`${tag} 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
