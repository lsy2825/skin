// round-2 O3 in a real browser: the search index is built in a worker right after the price data is in, it is exactly
// the index the page would build itself (same names, same function), and searching with it gives results.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/o3_search.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let workerSeen = false; p.on('worker', (w) => { if (/search_index\.js/.test(w.url())) workerSeen = true; });
  await p.goto(BASE); for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForFunction(() => window.App && window.App.Data && window.App.Data.SYNC.have, null, { timeout: 60000 });
  const ready = await p.waitForFunction(() => window.App.searchReady(), null, { timeout: 30000 }).then(() => true).catch(() => false);
  ok('데이터를 받은 뒤 검색 색인이 미리 준비됨(Worker)', ready && workerSeen, `worker ${workerSeen}`);
  const same = await p.evaluate(() => {
    const A = window.App, D = A.data(), rows = A.rows(), S = D.s;
    const sids = [...new Set(rows.map((r) => r[2]))];
    const mine = window.Search.buildIndex(sids.map((i) => S[i]), [...D.keys.map((k) => k[2]), ...A.state().FAM.map((f) => f.name)]);
    return JSON.stringify(mine) === JSON.stringify(A.searchIndexData());
  });
  ok('Worker 색인 = 화면에서 직접 만든 색인(완전히 같음)', same);
  for (const q of ['리쥬란 2cc', '슈링그 300샷', '보톡스 -바디']) {
    await p.evaluate((x) => { location.hash = `#search/${encodeURIComponent(x)}?nl=0`; }, q); await p.waitForTimeout(700);
    const txt = await p.locator('#main').innerText();
    ok(`검색 '${q}' 결과가 나옴`, /\d[\d,]*개/.test(txt) && !/가격이 없어요/.test(txt), txt.split('\n').find((l) => /\d[\d,]*개/.test(l)) || '');
  }
  // '같은 조건 가격 비교 바로가기' (2026-10-16 hierarchy audit H12·L11·SRCH-3): the home card's basis — '중간값' and the
  // median, '분야 · 범위 · N곳' as separate words, N for the region on screen — the numbers its compare header shows, no '원~'
  await p.evaluate(() => { location.hash = `#search/${encodeURIComponent('리쥬란 2cc')}?nl=0`; }); await p.waitForTimeout(900);
  const sc = p.locator('#main .card', { hasText: '용량·종류별 가격 비교' }).locator('li .item').first();
  const row = (await sc.innerText().catch(() => '')).replace(/\n/g, ' | ');
  // ('중간값' is the card head's word and, in the row, a screen reader's: innerText gives it its own line)
  const rowMed = +((/중간 가격[\s|]*([\d,]+)원/.exec(row) || [])[1] || '').replace(/,/g, ''), rowN = +((/ · (\d+)곳/.exec(row) || [])[1] || 0);
  await sc.click().catch(() => {}); await p.waitForTimeout(900);
  const hmed = +(await p.locator('.cmphead .hmed').innerText().catch(() => '')).replace(/\D/g, ''), basis = await p.locator('.cmphead .basis').innerText().catch(() => '');
  const hN = +((/(\d+)곳/.exec(basis) || [])[1] || -1);
  ok('검색 바로가기: 중간 가격·지역 곳 수 = 비교 머리글, 분야와 곳 수 사이 띄움, \'원~\'(최저) 없음', rowMed > 0 && rowMed === hmed && rowN === hN
    && /[가-힣] · /.test(row) && !/원~/.test(row) && !/[가-힣]\d+곳/.test(row), `${row} → 머리글 ${hmed} · ${basis}`);
  // the price cell is as narrow as before (its card's head says '중간값'; the row says it to a screen reader): at 320 wide a
  // shortcut's name has the room it had (review of audit 13: '중간값 209,000원' in the cell folded names into 2~3 lines)
  await p.setViewportSize({ width: 320, height: 800 }); await p.evaluate(() => { location.hash = `#search/${encodeURIComponent('리쥬란 2cc')}?nl=0`; }); await p.waitForTimeout(900);
  const narrow = await p.$$eval('#main .card', (cs) => { const c = cs.find((x) => /용량·종류별 가격 비교/.test((x.querySelector('h3') || {}).textContent || '')); if (!c) return null;
    return { head: c.querySelector('.row .sub') ? c.querySelector('.row .sub').textContent : '', rows: [...c.querySelectorAll('li .item')].map((it) => { const t = it.querySelector('.t'), pc = it.querySelector('.p');
      return { name: t.textContent, lines: Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)), pw: Math.round(pc.getBoundingClientRect().width) }; }) }; });
  // before the median: '110,000원~' 79~89px; with '중간값 ' in the cell ~125px
  ok('320px 바로가기: 가격 칸 폭 ≤ 90px(예전 \'110,000원~\' 폭), 머리에 \'중간 가격\'', !!narrow && narrow.rows.length > 0 && narrow.rows.every((r) => r.pw <= 90) && /중간 가격/.test(narrow.head),
    narrow ? `${narrow.head} · ${narrow.rows.map((r) => `${r.name}(${r.lines}줄·${r.pw}px)`).join(', ')}` : '카드 없음');
  await p.setViewportSize({ width: 390, height: 844 });
  // the '종류' card's count next to a kind with no description is its main key's median count in the region (the compare
  // header's), never f.n — every branch and every size in the country: 부산 (15곳) showed '패키지 · 204곳'. A key with one
  // price, or all the same, does not repeat it as a range ('121,000원 | 부스터 · 121,000원 · 1곳')
  await p.evaluate(() => localStorage.setItem('pc:region', JSON.stringify('부산'))); await p.reload();
  await p.waitForFunction(() => window.App && window.App.Data && window.App.Data.SYNC.have, null, { timeout: 60000 });
  const regN = +((/(\d+)곳/.exec(await p.locator('#upd').innerText().catch(() => '')) || [])[1] || 0);
  const seen = [];
  for (const q of ['리쥬란 2cc', '보톡스']) {
    await p.evaluate((x) => { location.hash = `#search/${encodeURIComponent(x)}?nl=0`; }, q); await p.waitForTimeout(1200);
    seen.push(...await p.$$eval('#main .card', (cs) => cs.filter((c) => /용량·종류별 가격 비교|종류 \d+가지/.test((c.querySelector('h3') || {}).textContent || ''))
      .flatMap((c) => [...c.querySelectorAll('li .item')].map((x) => x.innerText.replace(/\n/g, ' | ')))));
  }
  const counts = seen.map((r) => +((/ · (\d+)곳/.exec(r) || [])[1] || 0)).filter(Boolean);
  const rep = seen.filter((r) => { const m = /\| (?:중간 가격\s*)?([\d,]+원) \|(.*)$/.exec(r); return m && m[2].includes(m[1]); });
  ok('부산 검색 종류·바로가기: 곳 수 ≤ 지역 지점 수, 한 가격을 범위로 되풀이하지 않음', regN > 0 && counts.length > 0 && counts.every((n) => n <= regN) && !rep.length,
    `지역 ${regN}곳 · 곳 수 ${counts.join(',')}${rep.length ? ` · 되풀이 ${rep.join(' / ')}` : ''}`);
  // a kind with no description: its count = the compare header's for its main key
  const kind = p.locator('#main .card').filter({ has: p.locator('h3', { hasText: /종류 \d+가지/ }) }).locator('li .item').filter({ hasText: /· \d+곳/ }).first();
  const kRow = (await kind.innerText().catch(() => '')).replace(/\n/g, ' | '), kN = +((/ · (\d+)곳/.exec(kRow) || [])[1] || 0), kMed = +((/\| (?:중간 가격\s*)?([\d,]+)원 \|/.exec(kRow) || [])[1] || '').replace(/,/g, '');
  if (kRow) { await kind.click().catch(() => {}); await p.waitForTimeout(900); }
  const kBasis = await p.locator('.cmphead .basis').innerText().catch(() => ''), kHmed = +(await p.locator('.cmphead .hmed').innerText().catch(() => '')).replace(/\D/g, '');
  ok('부산 \'보톡스\' 종류 줄(설명 없는 것): 중간 가격·곳 수 = 비교 머리글', !kRow || (kN > 0 && kN === +((/(\d+)곳/.exec(kBasis) || [])[1] || -1) && kMed === kHmed), `${kRow || '설명 없는 종류 없음'} → ${kHmed} · ${kBasis}`);
  await p.evaluate(() => localStorage.setItem('pc:region', JSON.stringify('')));
  // every price in the country with no words (~140k): the range line used Math.min(...array) and overflowed the stack
  const cons = []; p.on('console', (m) => { if (m.type() === 'error') cons.push(m.text().slice(0, 120)); });
  await p.evaluate(() => { location.hash = `#table?reg=${encodeURIComponent('전국')}`; }); await p.waitForTimeout(1500);
  const stat = await p.locator('#main .searchstat').innerText().catch(() => '');
  ok('전체 가격표 · 전국(필터 없음)이 열림', /가격 [\d,]+개/.test(stat) && !cons.length, stat || cons.join(' | '));
  ok('페이지 오류 없음', !errs.length, errs.join(' | '));
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`TOTAL ${pass}/${R.length} PASS`);
  process.exit(pass === R.length ? 0 : 1);
})();
