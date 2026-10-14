// 5.1 관리자 대시보드 화면: 시연 앱(DEMO)에서는 숫자를 지어내지 않고 '서버 연결 필요'만, 서버 모드에서는 API가 준 숫자를 실측/추정으로 나눠
// 보여주고, API가 거절(403)하면 그 이유를 보여줌. 서버 모드의 시장은 이 테스트가 만든 가짜 API·가짜 로그인이에요(화면 동작만 확인).
// 서버 모드에서는 크레딧 화면이 시연 지갑을 쓰지 않음(감사 P1). Usage: python3 -m http.server 8766 --directory app & then APP_PIN=<pin> node tests/e2e/admin51.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'); const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 300)}`); };
const APP = path.join(__dirname, '..', '..', 'app');
const DASH = { generated_at: '2026-10-14T05:00:00Z', revenue_daily: [{ day: '2026-10-14', channel: 'WEB_PG', orders: 3, gross_krw: 6870 }, { day: '2026-10-14', channel: 'DEMO', orders: 9, gross_krw: 9990 }],
  revenue_monthly: [{ month: '2026-10', channel: 'WEB_PG', orders: 3, gross_krw: 6870 }], orders_by_status_30d: { FULFILLED: 3 }, payments_by_status_30d: { DONE: 3 },
  refunds_daily: [{ day: '2026-10-14', kind: 'REFUND', n: 1, krw: 990, credits_reversed: 5, credits_unrecovered: 0 }],
  credits_daily: [{ day: '2026-10-14', issued_paid: 43, issued_promo: 2, consumed: 7, released: 1, reversed: 5 }], outstanding_credits: { paid: 31, promo: 2, reserved: 0 },
  ai_daily: [{ day: '2026-10-14', calls: 4, failed: 1, fallback: 1, unpriced: 0, cost_krw: 12.5 }], features_30d: [{ feature_code: 'EVENT_IMAGE_DECODER', jobs: 3, succeeded: 2, released: 1, credits_captured: 2, ai_cost_krw: 12.5 }],
  premium_users: { active_7d: 2, active_30d: 2, open_entitlements: 1, ad_free_active: 2 },
  health: { db_size_bytes: 12000000, jobs_open: 0, jobs_overdue: 0, webhooks_unprocessed_15m: 0, orders_open_over_1h: 1, last_reconcile: { at: '2026-10-14T04:50:00Z', checked: 2, fixed: 1, mismatches: 0 } },
  channels_30d: [{ channel: 'WEB_PG', orders: 3, gross_krw: { value: 6870, kind: 'ACTUAL' }, vat_krw: { value: 625, kind: 'ACTUAL_RATE' }, fee_krw: { value: 227, kind: 'ESTIMATE' } },
    { channel: 'DEMO', orders: 9, gross_krw: { value: 9990, kind: 'ACTUAL' }, vat_krw: { value: 908, kind: 'ACTUAL_RATE' }, fee_krw: { value: 0, kind: 'ESTIMATE' } }],
  contribution_margin_30d: { value: 5016, kind: 'ESTIMATE', basis: '실결제 채널(DEMO 제외) 매출 − 부가세 − 수수료(가정) − 환불 − AI 비용(실측) − 서비스 비용(ACTUAL만)' },
  data_freshness: { updated: '2026-10-14', days_old: 0 } };

async function open(b, server, status = 200) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const calls = []; await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  if (server) {
    await p.route(/\/config\.js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(APP, 'config.js'), 'utf8').replace('commerce: { mode: "DEMO", apiBase: "" }', 'commerce: { mode: "SANDBOX", apiBase: "https://api.test" }') }));
    await p.route(/\/auth\.js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.Auth = { enabled: true, user: { id: "x" }, providers: [], providerName: () => "", onChange() {}, async accessToken() { return "test-token"; } };' }));
    // the deployed CSP must list the API origin (documented activation step); here the page is served with it added
    await p.route((u) => u.pathname === '/' || u.pathname.endsWith('/index.html'), (r) => r.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(APP, 'index.html'), 'utf8').replace("connect-src 'self'", "connect-src 'self' https://api.test") }));
    await p.route(/api\.test/, (r) => { calls.push(r.request().headers().authorization); return r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(status === 200 ? DASH : { error: 'FORBIDDEN', message: '관리자(2단계 인증)만 할 수 있어요' }) }); });
  }
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', '""'); }); await p.reload(); await p.waitForTimeout(200);
  if (await p.locator('#gate-pad').isVisible()) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForFunction(() => !document.querySelector('#main').hasAttribute('aria-busy'), null, { timeout: 30000 });
  return { p, ctx, errs, calls };
}

(async () => {
  const b = await chromium.launch();
  // DEMO
  let s = await open(b, false);
  await s.p.goto(BASE + '#ops'); await s.p.waitForTimeout(900);
  ok('A1 운영 화면에 관리자 대시보드 진입(서버·2단계 인증 필요 안내)', await s.p.locator('button', { hasText: '관리자 대시보드(서버)' }).count() === 1);
  await s.p.goto(BASE + '#admin'); await s.p.waitForTimeout(500);
  const t1 = await s.p.locator('[data-testid=admin]').innerText();
  ok('A2 시연 앱: 숫자 없이 서버 연결 필요 안내(시연 지갑을 실적처럼 쓰지 않음)', /서버/.test(t1) && /시연 지갑 숫자를 실적처럼 보여주지 않아요/.test(t1) && !/\d+원/.test(t1));
  ok('A3 시연 앱 오류 없음', s.errs.length === 0, s.errs.join('|'));
  await s.ctx.close();
  // server mode (mocked API)
  s = await open(b, true);
  await s.p.goto(BASE + '#admin'); await s.p.waitForTimeout(1200);
  const t2 = await s.p.locator('[data-testid=admin]').innerText();
  ok('A4 서버 모드: 토큰을 실어 API 호출', s.calls.length >= 1 && s.calls[0] === 'Bearer test-token', s.calls.join(','));
  ok('A5 채널별 실측 결제액·추정 수수료', /WEB_PG/.test(t2) && /6,870/.test(t2) && /227/.test(t2));
  ok('A6 공헌이익은 "추정" 표시와 근거(DEMO 제외)', /공헌이익\(30일\) 5,016원/.test(t2) && /추정/.test(t2) && /DEMO 제외/.test(t2));
  ok('A7 환불·크레딧·AI·기능·사용자·서버 상태·신선도 섹션', ['환불', '크레딧', 'AI 사용', '기능별', '프리미엄 사용자', '서버·DB 상태', '데이터 신선도'].every((x) => t2.includes(x)), t2.slice(0, 200));
  await s.p.goto(BASE + '#wallet'); await s.p.waitForTimeout(500);
  ok('A8 서버 모드 크레딧 화면은 시연 지갑을 쓰지 않음(닫힘 안내)', await s.p.locator('[data-testid=commerce-closed]').count() === 1 && await s.p.locator('[data-testid^=pack-]').count() === 0);
  ok('A9 서버 모드 오류 없음', s.errs.length === 0, s.errs.join('|'));
  await s.ctx.close();
  s = await open(b, true, 403);
  await s.p.goto(BASE + '#admin'); await s.p.waitForTimeout(1200);
  ok('A10 API가 거절하면(2단계 인증 없음) 이유만 보여줌', /관리자\(2단계 인증\)만/.test(await s.p.locator('[data-testid=admin]').innerText()));
  await s.ctx.close(); await b.close();
  const pass = R.filter(Boolean).length; console.log(`\n${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
