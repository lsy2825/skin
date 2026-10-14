// Round-2 R01/R16 in the browser: two accounts on one phone never see, merge or upload each other's data.
// The real sign-in module (app/auth.js + Supabase) is replaced by a stand-in with the same interface, so the app's own
// account logic is what is tested; nothing here talks to Supabase. Server-side RLS is tested in server/test/round2.test.mjs.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/accounts_r2.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };

// the stand-in: window.__acct.switch(id|null) changes the user; pulls can be delayed per account; every write is logged
const STUB = `(() => {
  const listeners = [], log = [], server = { A: { profile: { nick: 'A계정' }, records: [{ id: 'a-rec', done_on: '2026-10-01', procedure: 'A의 비밀 기록', brand: '블리비', branch: '강남', price: 1000, memo: '' }], carts: [] },
                                         B: { profile: { nick: '' }, records: [], carts: [] } };
  const delay = { A: 0, B: 0 };
  let user = null;
  const as = (uid) => user && (!uid || user.id === uid) ? user : null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__acct = { log, server, delay, switch(id) { user = id ? { id, app_metadata: { provider: 'kakao' }, email: id + '@x' } : null; listeners.forEach((f) => f(user)); } };
  window.Auth = { enabled: true, providers: ['kakao'], get user() { return user; }, providerName: () => 'kakao', onChange(f) { listeners.push(f); }, init: async () => null,
    async accessToken() { return null; }, async signIn() {}, async signOut() { window.__acct.switch(null); },
    async pull(uid) { const u = as(uid); if (!u) return null; const id = u.id; await wait(delay[id]); const s = server[id]; return { profile: s.profile, records: s.records }; },
    async saveProfile(me, uid) { const u = as(uid); if (!u) return; log.push(['profile', u.id, me.nick]); },
    async saveRecords(recs, uid) { const u = as(uid); if (!u || !recs.length) return; log.push(['records', u.id, recs.map((r) => r.id)]); },
    async deleteRecord() {}, async pullCarts(uid) { const u = as(uid); if (!u) return []; await wait(delay[u.id]); return server[u.id].carts; },
    async saveCart(c, uid) { const u = as(uid); if (!u) return null; log.push(['cart', u.id, c.id, c.items.length]); return { version: (c.ver || 0) + 1 }; },
    async deleteCart() {}, async deleteAccount() { return { mode: 'DELETED' }; } };
})();`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e.message)));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.route('**/auth.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB }));
  await p.route('**/config.js', async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace('supabaseUrl: ""', 'supabaseUrl: "https://stub.invalid"').replace(/supabaseAnonKey: ""/, 'supabaseAnonKey: "stub"') }); });
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('.pc', { timeout: 30000 });
  const state = () => p.evaluate(() => ({ keys: Object.keys(localStorage).filter((k) => k.startsWith('pc:')).sort(), log: window.__acct.log.slice() }));
  const recsShown = async () => { await p.goto(BASE + '#me'); await p.waitForTimeout(400); return p.evaluate(() => document.querySelector('#main').innerText); };

  // anonymous use: a record and a cart item on the phone before any sign-in
  await p.evaluate(() => { localStorage.setItem('pc:recs', JSON.stringify([{ id: 'anon-rec', date: '2026-10-02', n: '익명 기록', br: '블리비|강남', p: 1, memo: '', at: 1 }])); });
  await p.reload(); for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`).catch(() => {}); await p.waitForSelector('.pc');

  // 1) A signs in: A's records come in; the anonymous record is NOT uploaded silently — a choice is offered
  await p.evaluate(() => window.__acct.switch('A')); await p.waitForTimeout(600);
  let s = await state();
  ok('A sign-in: nothing anonymous uploaded without a choice', !s.log.some(([k, , v]) => k === 'records' && JSON.stringify(v).includes('anon-rec')), JSON.stringify(s.log));
  const offered = await p.locator('text=이 휴대폰의 기록 가져오기').count();
  ok('A sign-in: the phone\'s pre-sign-in data is offered, not merged', offered === 1);
  await p.locator('button:has-text("두기")').click().catch(() => {});
  ok('A space holds A\'s data', (await recsShown()).includes('A의 비밀 기록'));
  ok('A space does not hold the anonymous record', !(await recsShown()).includes('익명 기록'));

  // 2) A logs out, B signs in: B sees nothing of A; B's profile is not saved with A's nickname; A's records are not sent as B
  await p.evaluate(() => window.__acct.switch(null)); await p.waitForTimeout(300);
  ok('signed out: A\'s record is gone from the screen', !(await recsShown()).includes('A의 비밀 기록'));
  ok('signed out: the anonymous record is back', (await recsShown()).includes('익명 기록'));
  await p.evaluate(() => window.__acct.switch('B')); await p.waitForTimeout(600);
  await p.locator('button:has-text("두기")').click().catch(() => {});
  s = await state();
  ok('B: A\'s nickname never saved into B', !s.log.some(([k, u, v]) => k === 'profile' && u === 'B' && v === 'A계정'), JSON.stringify(s.log.filter((x) => x[1] === 'B')));
  ok('B: A\'s records never sent as B', !s.log.some(([k, u, v]) => k === 'records' && u === 'B' && JSON.stringify(v).includes('a-rec')));
  ok('B: A\'s record not on B\'s screen', !(await recsShown()).includes('A의 비밀 기록'));

  // 3) a slow answer for A arrives after B signed in: dropped
  await p.evaluate(() => { window.__acct.switch(null); window.__acct.delay.A = 1500; window.__acct.switch('A'); });
  await p.waitForTimeout(100);
  await p.evaluate(() => { window.__acct.switch(null); window.__acct.delay.A = 0; window.__acct.switch('B'); });
  await p.waitForTimeout(2200);
  await p.locator('button:has-text("두기")').click().catch(() => {});
  ok('late A answer after B signed in: not shown to B', !(await recsShown()).includes('A의 비밀 기록'));
  s = await state();
  ok('late A answer: B\'s space never got A\'s record', !s.keys.some((k) => k.startsWith('pc:u:B:')) || !(await p.evaluate(() => (localStorage.getItem('pc:u:B:recs') || '')).then((v) => v.includes('a-rec'))));

  // 4) a token refresh (same user again) merges nothing and uploads nothing new
  const before = (await state()).log.length;
  await p.evaluate(() => window.__acct.switch('B')); await p.waitForTimeout(400);
  ok('token refresh of the same account: no re-merge, no upload', (await state()).log.length === before, `${before} → ${(await state()).log.length}`);

  // 5) storage is split per account
  s = await state();
  ok('storage: A and B have separate spaces', s.keys.some((k) => k.startsWith('pc:u:A:')) && s.keys.some((k) => k.startsWith('pc:u:B:')), s.keys.filter((k) => k.includes(':u:')).join(' '));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const failed = R.filter((x) => !x).length;
  console.log(`\n${R.length - failed}/${R.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
