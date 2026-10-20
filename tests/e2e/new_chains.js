// 가격 변동 화면의 '처음 모은 체인' 안내 (data.json meta.brandFirst, chat C3 · 개선 보고서 E9). A chain first collected after the
// previous snapshot (achg.prev) has no single '새로 생김' rows any more — the screen says '○○ 체인은 10월 14일부터 모았어요'
// for the chains its list can show (switched on in 마이 → 브랜드, a branch in the chosen region). A data.json without
// brandFirst (before C3), or one where every chain was already in the previous snapshot (every collection after the first
// one of a new chain): no notice, the screen as before. Works with any file: the expectation is read from the data the page
// loaded.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/new_chains.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 200)}`); };
const koDay = (d) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
const CAPITAL = ['서울', '경기', '인천'];   // '수도권', the app's default region

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // o: {on: [chain index…], n: chains known} = a saved 브랜드 filter, region: a saved region ('' = 전국); nothing = a new phone
  const open = async (o = {}) => {
    await p.evaluate((o) => { localStorage.clear(); if (o.on) { localStorage.setItem('pc:brands', JSON.stringify(o.on)); localStorage.setItem('pc:nbrands', JSON.stringify(o.n)); }
      if (o.region != null) localStorage.setItem('pc:region', JSON.stringify(o.region)); history.replaceState(null, '', location.pathname); }, o);
    await p.reload();   // from the home screen (no #change in the address), as a person opening the app
    if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
    await p.waitForSelector('.pc'); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    await p.evaluate(() => { location.hash = '#change'; }); await p.waitForSelector('.view h2:text("가격 변동")', { timeout: 15000 }); await p.waitForTimeout(300);
  };
  const notice = async () => (await p.locator('#newchains').count()) ? (await p.locator('#newchains').textContent()) : null;
  const card = () => p.locator('.view .card').first();
  await p.goto(BASE); await open();
  const info = await p.evaluate(() => { const { D, BR } = App.state(); const names = D.meta.brands.map((x) => x[0]);
    return { bf: D.meta.brandFirst || null, prev: (D.achg || {}).prev || '', updated: D.meta.updated, names,
      regions: names.map((_, i) => [...new Set(BR.filter((x) => x.brand === i).map((x) => x.region))]),
      newBrands: [...new Set(((D.achg || {}).new || []).map((x) => names[BR[x[1]].brand]))] }; });
  const has = (n, reg) => info.regions[info.names.indexOf(n)].some((r) => !reg || (reg === '수도권' ? CAPITAL.includes(r) : r === reg));
  const t0 = await notice();
  // the chains this file makes new: first day after the previous snapshot, not after this collection, a branch somewhere
  const fresh = info.bf ? info.names.filter((n) => has(n, '') && info.bf[n] && info.prev && info.bf[n] > info.prev && info.bf[n] <= info.updated) : [];
  const want = fresh.filter((n) => has(n, '수도권'));
  if (!want.length) {
    const why = !info.bf ? '예전 data.json(brandFirst 없음)' : `처음 모은 체인 없음(prev=${info.prev}${fresh.length ? ', 수도권 밖에만' : ''})`;
    ok(`${why}: 안내 없음`, t0 === null, t0 || '');
    const kids = await card().evaluate((el) => [...el.children].map((c) => c.tagName + (c.className ? '.' + c.className : '')));
    ok(`${why}: 머리 카드는 그대로(제목·기간·네 칸 고르기 — 홈과 같은 .seg, 2026-10-20 디자인 통일 U22)`, kids.join(' ') === 'H2 DIV.sub DIV.seg two', kids.join(' '));
    ok(`${why}: '체인은 … 모았어요' 문구 없음`, !/모았어요/.test(await card().textContent()));
  } else {
    const not = info.names.filter((n) => !want.includes(n));
    ok('새 data.json: 처음 모은 체인이 있음(기준 achg.prev, 수도권에 지점 있음)', want.length > 0, `prev=${info.prev} · ${want.map((n) => `${n} ${info.bf[n]}`).join(', ')}`);
    ok('새 data.json: 처음 모은 체인의 가격은 achg.new에 없음(C3)', !info.newBrands.some((n) => fresh.includes(n)), info.newBrands.join('·'));
    ok('새 data.json: 안내가 보임', t0 !== null && await p.locator('#newchains').isVisible(), t0 || '');
    ok('안내: 처음 모은 체인과 날짜(○월 ○일)를 모두 적음', t0 && want.every((n) => t0.includes(n) && t0.includes(`${koDay(info.bf[n])}부터`)), t0 || '');
    ok('안내: 처음부터 모은 체인·지점 없는 체인은 적지 않음', t0 && not.every((n) => !new RegExp(`(^|·)${n}(·| 체인)`).test(t0)), not.join('·'));
    ok("안내: '새로 생겼어요'에 하나씩 나오지 않는 까닭", t0 && /'새로 생겼어요'에/.test(t0) && /다음 수집부터/.test(t0), t0 || '');
    ok('안내: 글자만(태그 없음)', (await p.locator('#newchains > *').count()) === 0);
    // the chain filter (마이 → 브랜드): a switched-off chain is not named; all of them off → no notice
    const off = want[0], all = info.names.map((_, i) => i);
    await open({ on: all.filter((i) => info.names[i] !== off), n: info.names.length }); const t1 = await notice();
    ok(`브랜드 끄기: 끈 체인(${off})은 안내에서 빠짐`, want.length === 1 ? t1 === null : !!t1 && !t1.includes(off) && want.slice(1).every((n) => t1.includes(n)), t1 || '(안내 없음)');
    await open({ on: all.filter((i) => !fresh.includes(info.names[i])), n: info.names.length }); const t2 = await notice();
    ok('브랜드 끄기: 처음 모은 체인을 모두 끄면 안내 없음', t2 === null, t2 || '');
    // the region (상단 지역): only the new chains with a branch there — a region where some of them have none
    const regs = [...new Set(info.regions.flat())].sort();
    const reg = regs.find((r) => { const k = fresh.filter((n) => has(n, r)).length; return k > 0 && k < fresh.length; });
    if (reg) {
      await open({ region: reg }); const t3 = await notice(), w3 = fresh.filter((n) => has(n, reg));
      ok(`지역 ${reg}: 그 지역에 지점이 있는 새 체인만 적음`, !!t3 && w3.every((n) => t3.includes(n)) && fresh.filter((n) => !w3.includes(n)).every((n) => !t3.includes(n)), `${w3.join('·')} | ${t3}`);
    } else console.log(`SKIP | 지역: 새 체인 일부만 지점이 있는 지역이 이 자료엔 없음 | ${regs.join(',')}`);
    const empty = regs.find((r) => !fresh.some((n) => has(n, r)));
    if (empty) { await open({ region: empty }); const t4 = await notice(); ok(`지역 ${empty}: 새 체인 지점이 없으면 안내 없음`, t4 === null, t4 || ''); }
    await open();
  }
  // the pick under it still answers a tap (render() only)
  await p.locator('.view .seg.two button', { hasText: '새로 생겼어요' }).click(); await p.waitForTimeout(250);
  ok("'새로 생겼어요' 칸을 누르면 선택됨", (await p.locator('.view .seg.two button', { hasText: '새로 생겼어요' }).getAttribute('aria-pressed')) === 'true');
  ok('안내는 칸을 눌러도 그대로', (await notice()) === t0, String(await notice()));
  ok('페이지 오류 없음', !errs.length, errs.join(' | '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1;
})();
