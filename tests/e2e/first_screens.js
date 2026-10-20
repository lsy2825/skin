// 6.0 이탈 대책 (docs: 윤실장 6.0 보고서 '이탈 대책', 개발 지시서 B4): on two phone sizes, without scrolling —
//  1. 홈: at least two price cards (name + middle price in won) are fully inside the first screen
//  2. 검색 → 비교: typing a spec and Enter opens its comparison, and the first screen holds the procedure name, the price
//     range and the '담기' button (sticky header), so the decision needs no scrolling
//  3. 담기: one tap on the header's 담기 puts the spec on screen in 내 견적 (no second spec picker), the tab badge says 1
//     → open · first price · compare · keep in three steps
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/first_screens.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 200)}`); };
const VIEWPORTS = [{ width: 375, height: 667 }, { width: 390, height: 844 }];
const NAV_H = 64;   // the tab bar covers the bottom of the screen

(async () => { const b = await chromium.launch();
  for (const vp of VIEWPORTS) {
    const tag = `${vp.width}×${vp.height}`;
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
    if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
    await p.waitForSelector('.pc'); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);

    // 1) home: price cards in the first screen
    const cards = await p.evaluate((nav) => [...document.querySelectorAll('#main .pc')].filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight - nav; })
      .map((e) => e.innerText.replace(/\s+/g, ' ')), NAV_H);
    ok(`${tag} 홈 첫 화면에 가격 카드 2개 이상(이름·중간값)`, cards.length >= 2 && cards.every((t) => /[\d,]+원/.test(t)), cards.slice(0, 2).join(' / '));

    // 2) search → compare: name, range and 담기 in the first screen
    await p.locator('.search input').first().fill('리쥬란 2cc'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
    ok(`${tag} 검색 Enter 한 번으로 그 규격 비교`, /#compare\?k=/.test(p.url()), p.url().split('#')[1]);
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(200);
    const first = await p.evaluate((nav) => { const vis = (sel) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight - nav; };
      return { name: vis('.cmphead .cmpt'), range: vis('.pricecard .hp'), add: vis('.cmphead .addbtn'), rangeTxt: (document.querySelector('.pricecard .hp') || {}).innerText || '' }; }, NAV_H);
    ok(`${tag} 비교 첫 화면에 시술명·가격 범위·담기`, first.name && first.range && first.add && /^[\d,.]+만?(~[\d,.]+만?)?원$/.test(first.rangeTxt.trim()), JSON.stringify(first));   // the range in the words every range uses (U02)

    // the header stays when the list is scrolled — folded (위계 점검 9: the title row moves out of view above, so the header's
    // own top is above the screen): the path (시술 › 규격), 중간값 and 담기 stay on top of the screen
    await p.evaluate(() => window.scrollTo(0, 1200)); await p.waitForTimeout(200);
    const stuck = await p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      const c = r('.cmphead .crumb'), m = r('.cmphead .hmed'), a = r('.cmphead .addbtn'); return { crumb: c && Math.round(c.top), med: m && Math.round(m.bottom), add: a && Math.round(a.bottom) }; });
    ok(`${tag} 내려도 머리글(경로의 시술·규격, 중간값, 담기)이 위에 남음`, stuck.crumb >= 0 && stuck.crumb <= 80 && stuck.med > 0 && stuck.med <= 240 && stuck.add > 0 && stuck.add <= 240, JSON.stringify(stuck));

    // 3) one tap keeps it
    await p.locator('.cmphead .addbtn').click(); await p.waitForTimeout(300);
    const n = await p.locator('#cart-n').textContent().catch(() => '');
    ok(`${tag} 담기 한 번 → 내 견적 1개, 규격을 다시 고르는 창 없음`, (await p.locator('.sheet').count()) === 0 && n.trim() === '1' && /담김/.test(await p.locator('.cmphead .addbtn').textContent()), `badge=${n}`);
    ok(`${tag} 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
