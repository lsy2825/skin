// 6.0 security item 3 (A6): the ops screen (#ops) shows its content only on an admin host. Served from localhost (in the
// ADMIN_HOSTS list for local dev and tests) it renders the full screen — without the removed credit-economics card and without
// the word 크레딧 anywhere. Served from any other hostname (here http://public.localhost:<port>/, which Chromium resolves to
// loopback, so the same python server answers under a public-looking name) it shows one card, "관리자 주소에서만", and sends
// no request to the factory status, GitHub or review.json. Page errors must be 0 on both.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/security/admin_ops_browser.js
// The PIN comes from the environment only (CLAUDE.md) — like every e2e test this exits 2 without APP_PIN, it never unlocks
// the gate another way. Checked by tests/security/admin_ops_static.test.js.
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN || '';
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 300)}`); };
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
// loaded only after the PIN check: without APP_PIN this exits 2 even where Playwright is not installed (the PR checks)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const OUTSIDE = /yoonsiljang-factory\.|api\.github\.com|review\.json/;

async function open(b, base) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const reqs = []; p.on('request', (r) => reqs.push(r.url()));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(base);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', '""'); });
  await p.reload(); await p.waitForTimeout(200);
  if (await p.locator('#gate-pad').isVisible()) { for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); }
  await p.waitForSelector('.pc');
  await p.waitForFunction(() => !document.querySelector('#main').hasAttribute('aria-busy'), null, { timeout: 30000 });
  return { p, ctx, errs, reqs };
}

(async () => {
  const b = await chromium.launch();
  // admin host: localhost
  const admin = await open(b, BASE);
  ok('H0 시험 주소는 관리자 목록에 있는 localhost', new URL(BASE).hostname === 'localhost', BASE);
  const mark = admin.reqs.length;
  await admin.p.goto(BASE + '#ops'); await admin.p.waitForTimeout(1200);
  const main = admin.p.locator('#main');
  const t1 = await main.innerText();
  ok('A1 관리자 주소: 운영 현황 전체(수집 보고·신선도·실행 상태·검토 센터·검토 큐·출처 정책·기능 플래그)',
    ['운영 현황', '데이터 신선도', '수집 실행 상태', '분류 검토 센터', '재수집 순서', '검토 큐', '출처 정책', '시술 설명 검수 현황', '기능 플래그'].every((x) => t1.includes(x)), t1.slice(0, 160));
  ok('A2 크레딧 단위 경제성 카드 없음', await main.locator('[data-testid=economics]').count() === 0 && !t1.includes('경제성'));
  ok('A3 화면 어디에도 "크레딧" 글자 없음', !t1.includes('크레딧'), (t1.match(/.{0,20}크레딧.{0,20}/) || [''])[0]);
  ok('A4 "관리자 주소에서만" 안내는 없음', await main.locator('[data-testid=ops-admin-only]').count() === 0);
  ok('A5 열기만 해서는 공장·GitHub에 묻지 않음(review.json만 읽음)', !admin.reqs.slice(mark).some((u) => /yoonsiljang-factory\.|api\.github\.com/.test(u)) && admin.reqs.slice(mark).some((u) => /review\.json/.test(u)));
  ok('A6 페이지 오류 0개', !admin.errs.length, admin.errs.slice(0, 3).join(' / '));
  await admin.ctx.close();

  // not an admin host: the same server under another name
  const PUB = BASE.replace('localhost', 'public.localhost');
  const pub = await open(b, PUB);
  ok('P0 공개 주소 흉내: hostname = public.localhost', await pub.p.evaluate(() => location.hostname) === 'public.localhost');
  const mark2 = pub.reqs.length;
  await pub.p.goto(PUB + '#ops'); await pub.p.waitForTimeout(1200);
  const m2 = pub.p.locator('#main');
  const t2 = await m2.innerText();
  ok('P1 카드 하나: "운영 현황은 관리자 주소에서만 볼 수 있어요."', await m2.locator('.card').count() === 1 && await m2.locator('[data-testid=ops-admin-only]').count() === 1 && t2.includes('운영 현황은 관리자 주소에서만 볼 수 있어요.'), t2.slice(0, 120));
  ok('P2 뒤로 버튼만 있고 운영 내용 없음', await m2.locator('button.back').count() === 1 && !/데이터 신선도|수집 실행 상태|분류 검토 센터|검토 큐|출처 정책|기능 플래그/.test(t2));
  ok('P3 공장 상태·GitHub·review.json 요청 0개', !pub.reqs.slice(mark2).some((u) => OUTSIDE.test(u)), pub.reqs.slice(mark2).filter((u) => OUTSIDE.test(u)).join(', '));
  ok('P4 "크레딧" 글자 없음', !t2.includes('크레딧'));
  ok('P5 페이지 오류 0개', !pub.errs.length, pub.errs.slice(0, 3).join(' / '));
  await pub.ctx.close();
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`TOTAL ${pass}/${R.length} ${pass === R.length ? 'PASS' : 'FAIL'}`);
  process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
