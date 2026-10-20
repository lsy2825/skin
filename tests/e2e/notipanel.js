// 종 버튼 알림 패널 (사용자 요청 2026-10-20): the bell in the top bar opens the latest 알림 기록 right under it — what fired
// (kind, treatment, before → after, observed day, '가격 보기') — instead of only going to the 관심 tab. Opening reads the new
// records (the badge goes, as on the tab); the panel closes on the bell again, a tap outside, Esc (focus back on the bell) and
// any screen change; '알림 관리·전체 보기' goes to the 관심 tab; it stays inside the screen on a phone and on a desktop.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/notipanel.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 200)}`); };

// seven records, the first two new: a real treatment key (read from the data) so '가격 보기' has somewhere to go
const notesOf = (k, label) => Array.from({ length: 7 }, (_, i) => ({ at: '2026-10-20', obs: '2026-10-20', type: 'drop', k, name: `${label} ${i + 1}`, b: '',
  before: 100000 + i * 1000, after: 90000 + i * 1000, text: `${label} ${i + 1} — 가격 하락: 테스트 기록`, id: `t${i}`, read: i >= 2 }));

async function open(b, viewport, mobile) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport, isMobile: mobile, hasTouch: mobile }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
  if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('#main .card'); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
  return { ctx, p, errs };
}
const seed = async (p, notes) => { await p.evaluate((n) => localStorage.setItem('pc:notes', JSON.stringify(n)), notes); await p.reload();
  await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); await p.waitForTimeout(300); };
const panel = (p) => p.locator('#notipanel');

(async () => { const b = await chromium.launch();
  for (const [tag, viewport, mobile] of [['폰 390', { width: 390, height: 844 }, true], ['데스크톱 1280', { width: 1280, height: 800 }, false]]) {
    const { ctx, p, errs } = await open(b, viewport, mobile);
    const key = await p.evaluate(() => { const K = App.state().KEYS; return { id: K[0].id, label: K[0].label }; });
    await seed(p, notesOf(key.id, key.label));
    ok(`${tag}: 새 알림 숫자 2`, (await p.locator('#me-n').isVisible()) && (await p.locator('#me-n').textContent()).trim() === '2');
    ok(`${tag}: 종 버튼이 패널을 연다고 알림(aria-haspopup·expanded false)`, (await p.getAttribute('#notibtn', 'aria-haspopup')) === 'dialog' && (await p.getAttribute('#notibtn', 'aria-expanded')) === 'false');

    const hash0 = await p.evaluate(() => location.hash);
    await p.click('#notibtn'); await p.waitForTimeout(250);
    ok(`${tag}: 종을 누르면 패널이 열리고 화면은 그대로`, await panel(p).isVisible() && (await p.evaluate(() => location.hash)) === hash0, await p.evaluate(() => location.hash));
    ok(`${tag}: aria-expanded true`, (await p.getAttribute('#notibtn', 'aria-expanded')) === 'true');
    const items = await panel(p).locator('ul.notes > li').count();
    const first = (await panel(p).locator('ul.notes > li').first().textContent()) || '';
    ok(`${tag}: 최근 5개만, 어떤 알림인지(종류·시술·이전 → 이후 가격·관측일)`, items === 5 && first.includes('가격 하락') && first.includes(`${key.label} 1`) && first.includes('→') && first.includes('관측 2026-10-20'), `${items} | ${first}`);
    ok(`${tag}: 새 알림 2개 표시, 전체 7개 안내`, (await panel(p).textContent()).includes('새 알림 2개') && (await panel(p).textContent()).includes('전체 7개'));
    const box = await panel(p).boundingBox(), bell = await p.locator('#notibtn').boundingBox();
    ok(`${tag}: 패널은 종 바로 아래, 화면 안`, box && box.y >= bell.y + bell.height && box.y <= bell.y + bell.height + 16 && box.x >= 0 && box.x + box.width <= viewport.width, JSON.stringify({ box, bell }));
    await p.waitForTimeout(1700);
    ok(`${tag}: 열고 나면 읽음 — 숫자가 사라지고 기록도 읽음`, (await p.locator('#me-n').isHidden()) && (await p.evaluate(() => JSON.parse(localStorage.getItem('pc:notes')).every((x) => x.read))));

    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok(`${tag}: Esc로 닫히고 초점은 종으로`, (await panel(p).count()) === 0 && (await p.evaluate(() => document.activeElement && document.activeElement.id)) === 'notibtn' && (await p.getAttribute('#notibtn', 'aria-expanded')) === 'false');

    await p.click('#notibtn'); await p.waitForTimeout(150); await p.click('#notibtn'); await p.waitForTimeout(150);
    ok(`${tag}: 종을 다시 누르면 닫힘`, (await panel(p).count()) === 0);

    await p.click('#notibtn'); await p.waitForTimeout(150);
    await p.mouse.click(Math.round(viewport.width / 2), Math.round(viewport.height * 0.8)); await p.waitForTimeout(250);
    ok(`${tag}: 바깥을 누르면 닫힘`, (await panel(p).count()) === 0);

    await p.evaluate(() => { history.pushState(null, '', '#home'); dispatchEvent(new PopStateEvent('popstate')); }); await p.waitForTimeout(400);
    await p.click('#notibtn'); await p.waitForTimeout(150);
    await panel(p).locator('button', { hasText: '가격 보기' }).first().click(); await p.waitForTimeout(600);
    ok(`${tag}: '가격 보기'는 패널을 닫고 그 시술 비교로`, (await panel(p).count()) === 0 && (await p.evaluate(() => location.hash)) === `#compare?k=${key.id}`, await p.evaluate(() => location.hash));

    await p.click('#notibtn'); await p.waitForTimeout(150);
    await panel(p).locator('button', { hasText: '알림 관리·전체 보기' }).click(); await p.waitForTimeout(600);
    ok(`${tag}: '알림 관리·전체 보기'는 관심 탭으로, 거기에도 같은 기록 7개`, (await panel(p).count()) === 0 && (await p.evaluate(() => location.hash)) === '#saved' && (await p.locator('#main ul.notes > li').count()) === 7);

    await p.click('#notibtn'); await p.waitForTimeout(150);
    await p.evaluate(() => history.back()); await p.waitForTimeout(500);
    ok(`${tag}: 뒤로 가기(화면 바뀜)에도 닫힘`, (await panel(p).count()) === 0);

    await seed(p, []);
    await p.click('#notibtn'); await p.waitForTimeout(200);
    ok(`${tag}: 기록이 없으면 빈 안내와 '알림 관리·전체 보기'`, (await panel(p).textContent()).includes('아직 기록이 없어요') && (await panel(p).locator('button', { hasText: '알림 관리·전체 보기' }).count()) === 1);
    await p.keyboard.press('Escape');
    ok(`${tag}: 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
