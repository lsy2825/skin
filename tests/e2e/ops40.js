// 4.0 Release D/E (docs/ADMIN_OPERATIONS_SPEC.md): the ops screen shows the real collection-run state (GitHub Actions API,
// mocked here so the test never depends on GitHub: success / running / rate limited / no connection), the classification
// review center from app/review.json (read-only: no button that changes data), and the opt-in local usage stats (off by
// default, kept on this phone, demo-marked, no search text, nothing sent anywhere).
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/ops40.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'); const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 300)}`); };
const REV = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'review.json'), 'utf8'));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const outside = []; p.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(BASE).origin && !/tile\.openstreetmap|api\.github\.com|yoonsiljang-factory\./.test(u.host)) outside.push(u.host); });
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  // the Cloudflare factory's /status (cf/factory): 'off' = not set up yet (404) → the screen falls back to GitHub
  let cfMode = 'off'; let ghAsked = 0;
  await p.route(/yoonsiljang-factory\.lsy2825\.workers\.dev/, (r) => {
    if (cfMode === 'off') return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({
      current: { id: 'c', mode: 'rebuild', why: 'push', startedAt: '2026-10-20T01:00:00.000Z', state: 'running' },
      runs: [{ id: 'b', mode: 'weekly', why: 'schedule', startedAt: '2026-10-19T21:00:00.000Z', state: 'ok', step: 'weekly' },
        { id: 'a', mode: 'weekly', why: 'schedule', startedAt: '2026-10-18T21:00:00.000Z', state: 'skipped', step: 'weekly' },
        { id: 'z', mode: 'price-check', why: 'manual', startedAt: '2026-10-17T21:00:00.000Z', state: 'failed', step: '<img src=x onerror=alert(1)>' }] }) });
  });
  let mode = 'ok';
  await p.route(/api\.github\.com/, (r) => {
    ghAsked++;
    if (mode === 'limit') return r.fulfill({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.UTC(2026, 9, 14, 5, 0) / 1000)), 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ratelimit-reset' }, body: '{}' });
    if (mode === 'down') return r.abort('internetdisconnected');
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ workflow_runs: [
      { status: 'in_progress', conclusion: null, event: 'push', run_started_at: '2026-10-14T03:50:00Z', html_url: 'https://github.com/lsy2825/skin/actions/runs/2' },
      { status: 'completed', conclusion: 'success', event: 'schedule', run_started_at: '2026-10-13T21:00:00Z', html_url: 'https://github.com/lsy2825/skin/actions/runs/1' },
      { status: 'completed', conclusion: 'failure', event: 'workflow_dispatch', run_started_at: '2026-10-12T21:00:00Z', html_url: 'https://evil.example/x' }] }) });
  });
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', '""'); });
  await p.reload(); await p.waitForTimeout(200);
  if (await p.locator('#gate-pad').isVisible()) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('.pc');
  await p.waitForFunction(() => !document.querySelector('#main').hasAttribute('aria-busy'), null, { timeout: 30000 });
  const go = async (hash, wait = 1000) => { await p.goto(BASE + '#' + hash); await p.waitForTimeout(wait); };

  // 1) run status: real states only, on tap
  await go('ops', 1200);
  const card = p.locator('.card', { hasText: '수집 실행 상태' });
  ok('O1 열기만 해서는 GitHub에 묻지 않음(누를 때만)', await card.locator('.runst').count() === 0);
  await card.locator('button', { hasText: '최근 수집 실행 확인' }).click(); await p.waitForTimeout(800);
  const t1 = await card.innerText(), st1 = await card.locator('.runst .k').allTextContents();
  ok('O2 RUNNING·SUCCESS·FAILED를 GitHub 값 그대로(실행 3개 = 상태 3개)', st1.join(',') === 'RUNNING,SUCCESS,FAILED' && /코드 반영/.test(t1) && /예약/.test(t1), st1.join(','));
  ok('O3 GitHub이 아닌 링크는 쓰지 않음', !(await card.locator('a[href*="evil.example"]').count()));
  mode = 'limit'; await card.locator('button', { hasText: '최근 수집 실행 확인' }).click(); await p.waitForTimeout(800);
  const st2 = await card.locator('.runst .k').allTextContents();
  ok('O4 요청 한도 → RATE_LIMITED와 다시 볼 수 있는 시각', st2.join(',') === 'RATE_LIMITED' && /05:00/.test(await card.innerText()), st2.join(','));
  mode = 'down'; await card.locator('button', { hasText: '최근 수집 실행 확인' }).click(); await p.waitForTimeout(800);
  const t3 = await card.innerText();
  ok('O5 연결 실패 → "확인하지 못했어요"(상태를 지어내지 않음)', /확인하지 못했어요/.test(t3) && await card.locator('.runst').count() === 0);
  // Cloudflare factory answering: its states as given, GitHub not asked, text from the factory stays text
  cfMode = 'ok'; mode = 'ok'; const ghBefore = ghAsked;
  await card.locator('button', { hasText: '최근 수집 실행 확인' }).click(); await p.waitForTimeout(800);
  const st4 = await card.locator('.runst .k').allTextContents(), t4 = await card.innerText();
  ok('O5b Cloudflare 공장 → RUNNING·SUCCESS·SKIPPED·FAILED 그대로, GitHub에 묻지 않음', st4.join(',') === 'RUNNING,SUCCESS,SKIPPED,FAILED' && /Cloudflare/.test(t4) && /코드 반영/.test(t4) && /수동/.test(t4) && ghAsked === ghBefore, st4.join(',') + ' gh+' + (ghAsked - ghBefore));
  ok('O5c 공장이 보낸 글자는 글자로만(HTML 아님)', !(await card.locator('img').count()) && t4.includes('<img src=x'));

  // 2) review center: read-only, numbers = review.json
  const rc = p.locator('.card', { hasText: '분류 검토 센터' });
  const rt = await rc.innerText();
  const a = REV.classes.A || 0;
  ok('O6 판정 분포 = review.json(A 개수)', rt.includes(`A ${a.toLocaleString()}`), `A ${a}`);
  ok('O7 대기열 탭 숫자 = review.json', ['R', 'C', 'J'].every((c) => rt.includes(String(REV.queue[c] || 0))), JSON.stringify(REV.queue));
  await rc.locator('button[role=tab]', { hasText: '제품·장비 섞임' }).click(); await p.waitForTimeout(300);
  ok('O8 탭을 바꾸면 그 종류 항목', await rc.locator('.rvq li').count() === Math.min(REV.items.C.length, 60));
  ok('O9 데이터를 바꾸는 버튼 없음(승인·처리·삭제)', !(await rc.locator('button', { hasText: /승인|처리|삭제|지우기|반영/ }).count()));

  // 3) usage stats: off by default, local only, demo-marked, no search text
  await go('search/' + encodeURIComponent('리쥬란 2cc') + '?nl=0'); await go('compare?k=X24');
  ok('O10 기본값 꺼짐: 아무것도 남기지 않음', await p.evaluate(() => localStorage.getItem('pc:events')) === null);
  await go('me');
  await p.locator('.switch', { hasText: '사용 통계 남기기' }).click(); await p.waitForTimeout(300);
  await go('search/' + encodeURIComponent('리쥬란 2cc') + '?nl=0'); await go('compare?k=X12');
  const ev = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:events') || '[]'));
  ok('O11 켜면 이 기기에 남김: 검색·비교 열기, 모두 demo 표시', ev.some((x) => x.e === 'search') && ev.some((x) => x.e === 'compare_view' && x.k === 'X12') && ev.every((x) => x.demo === true), JSON.stringify(ev.slice(0, 3)));
  ok('O12 검색어 원문은 남기지 않음', !JSON.stringify(ev).includes('리쥬란'));
  await go('me');
  await p.locator('button', { hasText: '사용 통계 보기·지우기' }).click(); await p.waitForTimeout(400);
  ok('O13 보기: 이벤트별 횟수', /검색/.test(await p.locator('.sheet').innerText()) && /\d+번/.test(await p.locator('.sheet').innerText()));
  await p.locator('.sheet button', { hasText: '모두 지우기' }).click(); await p.waitForTimeout(300);
  ok('O14 모두 지우기', (await p.evaluate(() => JSON.parse(localStorage.getItem('pc:events') || '[]'))).length === 0);
  ok('O15 앱이 다른 서버로 보낸 요청 0개(GitHub 상태 확인 제외)', !outside.length, [...new Set(outside)].join(', '));
  ok('O16 페이지 오류 0개', !errs.length, errs.slice(0, 3).join(' / '));
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`TOTAL ${pass}/${R.length} ${pass === R.length ? 'PASS' : 'FAIL'}`);
  process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
