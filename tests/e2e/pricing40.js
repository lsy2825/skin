// 4.0 Release C (docs/PRICING_ENGINE_QA.md, docs/CART_ENGINE_QA.md): price classes on one axis, the price sheet's fixed
// order with the price class, the cart's visit plans A–D (visits + totals from the same lines as the clinic comparison).
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/pricing40.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'); const path = require('path');
const rowsOf = require('./rows.js');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 300)}`); };
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'data.json'), 'utf8')); rowsOf(D);
const S = D.s, ROWS = D.rows, TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const num = (t) => +String(t).replace(/[^\d]/g, '');
const live = (r) => !(/^\d{4}-\d{2}-\d{2}$/.test(S[r[10]] || '') && S[r[10]] < TODAY) && !r[13];
const VAT = (r) => (r[12] === 2 ? Math.round(r[3] * 1.1) : r[3]);   // 'VAT 포함' (default): listed + 10% where the clinic says 별도
// a price the site limits to some weekdays or hours (data.json fields 16-17, C #71) is a conditional price, tag or not
const Pricing = require(path.join(__dirname, '..', '..', 'app', 'domain', 'pricing.js'));
const WHEN = Pricing.hasWhenFields(D);
const timeLimited = (r) => WHEN && Pricing.whenLimited(r[16], S[r[17]]);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', '""'); localStorage.setItem('pc:special', 'true');
    localStorage.setItem('pc:carts', JSON.stringify([{ name: '내 장바구니', items: [{ t: 'k', k: 'X01', q: 1 }, { t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }] }])); });
  await p.reload(); await p.waitForTimeout(200);
  if (await p.locator('#gate-pad').isVisible()) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('.pc');
  await p.waitForFunction(() => !document.querySelector('#main').hasAttribute('aria-busy'), null, { timeout: 30000 });
  const go = async (hash, wait = 1200) => { await p.goto(BASE + '#' + hash); await p.waitForTimeout(wait); };

  // 1) price classes: the regular class = branches with a live plain row, its range = their lowest prices (VAT 포함 예상)
  await go('compare?k=X29');
  await p.locator('#cmpmore > summary').click(); await p.waitForTimeout(200);   // 6.0: price kinds are in the folded expert section
  const cls = await p.$$eval('.pcls .pcl', (xs) => xs.map((x) => x.innerText));
  const reg = new Map();
  for (const r of ROWS) if ((S[r[7]] || '').split(' ').includes('X29') && live(r) && r[5] === 0 && !S[r[6]] && !timeLimited(r)) { const v = VAT(r); if (!reg.has(r[0]) || v < reg.get(r[0])) reg.set(r[0], v); }
  const rv = [...reg.values()].sort((a, b) => a - b);
  const regTxt = cls.find((t) => t.startsWith('일반가')) || '';
  ok('C1 가격 종류별 범위: 일반가·이벤트가 등 둘 이상, 한 눈금', cls.length >= 2 && await p.locator('.pcls').count() === 1, cls.map((t) => t.split('\n')[0]).join(' / '));
  // the range in one unit at both ends (Pricing.rangeText, 2026-10-16 hierarchy audit T7: not '1.1만~16.5만원' from 10,890)
  const rvTxt = Pricing.rangeText(rv[0], rv[rv.length - 1]);
  ok('C2 일반가 지점 수·범위 = 데이터(지점마다 일반가 최저)', regTxt.includes(`${rv.length}곳`) && regTxt.includes(rvTxt), `기대 ${rv.length}곳 ${rvTxt} · 화면 ${regTxt.replace(/\s+/g, ' ')}`);
  ok('C3 이 카드엔 병원 이름이 없음(객관 표시)', !D.branches.some((x) => cls.join(' ').includes(S[x[1]])));

  // 2) price sheet order with the price class
  await p.locator('#clinics li.rk .infob').first().click(); await p.waitForTimeout(500);
  const dts = await p.$$eval('.sheet dl.facts dt', (xs) => xs.map((x) => x.textContent));
  // 가격 종류 · 조건 · 유효기간 show only when they say what the 가격 적용 조건 list above does not (재방문 · a condition the list
  // leaves out · an event that has ended — 2026-10-21 글 줄이기 2차): the rows always there keep their order, the others their place
  const order = ['가격과 부가세', '가격 종류', '조건', '횟수', '유효기간', '비교 기준', '정가(병원 표기)', '확인일', '원본'], always = ['가격과 부가세', '횟수', '비교 기준', '정가(병원 표기)', '확인일', '원본'];
  const idx = order.map((t) => dts.indexOf(t)).filter((v) => v >= 0);
  ok('C4 가격 정보 순서: 가격·부가세 → (가격 종류 → 조건) → 횟수 → (기간) → 비교 기준 → 정가 → 확인일 → 원본', always.every((t) => dts.includes(t)) && idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), dts.slice(0, 10).join(' > '));
  ok('C5 비교 판정이 맨 위(사실 목록보다 먼저)', await p.evaluate(() => { const a = document.querySelector('.sheet .clsbox'), b = document.querySelector('.sheet dl.facts'); return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // 3) cart visit plans A–D: the same numbers as the summary and the clinic comparison
  await go('cart', 1500);
  const tiles = await p.$$eval('.scens .scen', (xs) => xs.map((x) => x.innerText));
  ok('C6 방문 계획 A~D 네 가지, 각각 방문 수', tiles.length === 4 && tiles.every((t) => /방문 \d/.test(t)), tiles.map((t) => t.split('\n').slice(0, 3).join(' ')).join(' / '));
  const hero = (await p.locator('.cartsum .hp').innerText()).replace(/\s+/g, '');
  // plan A's range: in won like the summary above it ('2,022,680~4,936,800원'), the same total never in two units on one
  // screen (2026-10-16 hierarchy audit T7: the summary said '2,022,680원 ~ 4,936,800원' and plan A '202.3만~493.7만원')
  const aTotal = (tiles[0].match(/[\d.,]+만?~[\d.,]+만?원|[\d,]+원/) || [''])[0].replace(/\s+/g, '');
  const heroLo = hero.split('~')[0], aLo = aTotal.split('~')[0], heroHi = hero.split('~')[1] || heroLo, aHi = aTotal.split('~')[1] || aLo;
  ok('C7 A(한 곳에서 모두) 범위 = 요약의 예상 총액 범위, 같은 원 단위', aTotal && !/만/.test(aTotal) && num(aLo) === num(heroLo) && num(aHi) === num(heroHi), `${aTotal} vs ${hero}`);
  const bTotal = num((tiles[1].match(/[\d,]+원/) || ['0'])[0]), bVisits = +(tiles[1].match(/방문 (\d+)곳/) || [0, 0])[1];
  const cTxt = tiles[2], cTotal = /원/.test(cTxt) ? num((cTxt.match(/[\d,]+원/) || ['0'])[0]) : null;
  ok('C8 B ≤ C ≤ A의 가장 낮은 합계(나눠 갈수록 싸거나 같음)', bTotal > 0 && (cTotal == null || (bTotal <= cTotal && cTotal <= num(heroLo) * 1.0 + 1000)), `B ${bTotal} · C ${cTotal} · A ${heroLo}`);
  await p.locator('.scens .scen').nth(1).locator('.linkbtn').click(); await p.waitForTimeout(1000);
  const mixTxt = await p.locator('#main').innerText();
  ok('C9 B "어디서 받는지 보기" → 섞어 받기 탭, 합계가 같음', mixTxt.includes(bTotal.toLocaleString()) && await p.locator('#main .seg[role=tablist] [aria-selected="true"]').count() === 1, `B ${bTotal.toLocaleString()} · 방문 ${bVisits}곳`);
  ok('C10 D: 위치를 정하지 않으면 계산하지 않고 "기준 위치 정하기"', /기준 위치 정하기/.test(tiles[3]) && /방문 1곳\s*-/.test(tiles[3].replace(/\n/g, ' ')));
  ok('C11 계획 카드에 병원 이름 없음(객관 표시)', !D.branches.some((x) => tiles.join(' ').includes(`${D.meta.brands[x[0]][0]} ${S[x[1]]}`)));
  ok('C12 페이지 오류 0개', !errs.length, errs.slice(0, 3).join(' / '));
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`TOTAL ${pass}/${R.length} ${pass === R.length ? 'PASS' : 'FAIL'}`);
  process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
