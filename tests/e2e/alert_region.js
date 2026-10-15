// 가격 알림 시트(6.0 B6 후속, chat A's memo 2026-10-15): the lowest price the sheet shows is the one the alert will watch — the
// region in use (마이 → 지역) and the 특가 setting, not nationwide while the label names a region. A comparison alert is made with
// the region of the moment (addAlert), so the number on the sheet must be the number stored as its starting price (alert.base.low).
// For regions where the cheapest branch is outside the region these two used to differ (the sheet said the national lowest).
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/alert_region.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 200)}`); };
const REGIONS = ['수도권', '부산', '대구', '광주', '대전', '제주'];
const num = (t) => { const m = /최저\(병원 표시가, [^)]*\)\s*([\d,]+)원/.exec(t || ''); return m ? +m[1].replace(/,/g, '') : null; };

(async () => { const b = await chromium.launch(); let differs = 0;
  for (const reg of REGIONS) {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE); await p.evaluate((r) => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify(r)); }, reg); await p.reload();
    if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
    await p.waitForSelector('.pc'); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    await p.evaluate(() => { location.hash = '#compare?k=X24'; }); await p.waitForTimeout(900);
    await p.locator('.cmphead .morebtn').click(); await p.waitForTimeout(200); await p.locator('.actsheet button', { hasText: '가격 알림' }).click(); await p.waitForTimeout(300);
    const shown = num(await p.locator('.sheet .sub').first().textContent());
    const label = (await p.locator('.sheet .sub').first().textContent()).match(/최저\(병원 표시가, ([^)]*)\)/);
    await p.locator('.sheet .btn', { hasText: '알림 만들기' }).click(); await p.waitForTimeout(400);
    const al = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:alerts'))[0]);
    const stored = al && al.base && al.base.low;
    ok(`${reg}: 시트의 최저가 = 알림이 기준으로 저장한 최저가, 지역 이름도 같음`, shown != null && shown === stored && al.reg === reg && label && label[1] === reg, `sheet=${shown} stored=${stored} reg=${al && al.reg} label=${label && label[1]}`);
    ok(`${reg}: 페이지 오류 없음`, !errs.length, errs.join(' | '));
    if (shown !== null) differs++;
    await ctx.close();
  }
  ok('시트 값을 읽은 지역 수', differs === REGIONS.length, `${differs}/${REGIONS.length}`);
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
