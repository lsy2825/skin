// Demo-stage features (docs/DEMO_FEATURES.md) in a real browser, on the real price data:
// quick compare / shortlist (2-4 branches, same spec only, differences against the user's own baseline — never 'the
// lowest'), spec assistant (unknown stays unknown), eligibility summary, snapshots (saved vs today), reactive updates,
// terminology guide, pre-visit checklist (saved), coverage table (missing never counted), verification request (demo vs
// real said plainly), watchlist + update feed (no invented changes), report, regional prices, 죠미 preferences.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/demo_features.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const D = require('./rows.js')(require(path.join(__dirname, '../../app/data.json')));
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const num = (t) => +String(t).replace(/[^\d]/g, '');
const CART = [{ id: 'a', name: '내 장바구니', items: [{ t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }, { t: 'k', k: 'X01', q: 2 }] }];
// four real branches that sell X12, plus one that doesn't (for 'not comparable')
const keyOf = (r) => D.s[r[7]].split(' ');
const sells = new Set(D.rows.filter((r) => keyOf(r).includes('X12')).map((r) => r[0]));
const bkey = (b) => `${D.meta.brands[D.branches[b][0]][0]}|${D.s[D.branches[b][1]]}`, bname = (b) => bkey(b).replace('|', ' ');
const cap = ['서울', '경기', '인천'];
const seller = [...sells].filter((b) => cap.includes(D.s[D.branches[b][5]])).slice(0, 3);
const non = D.branches.map((_, b) => b).find((b) => !sells.has(b) && cap.includes(D.s[D.branches[b][5]]));

(async () => { const b = await chromium.launch();
  const page = async (pre = {}, opt = {}) => { const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'], ...opt }); const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await p.goto(BASE); await p.evaluate(([c, pre]) => { localStorage.clear(); localStorage.setItem('pc:carts', JSON.stringify(c)); for (const [k, v] of Object.entries(pre)) localStorage.setItem('pc:' + k, JSON.stringify(v)); }, [CART, pre]); await p.reload();
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    return { ctx, p }; };

  // ---- 1·7 shortlist + quick compare, 9 coverage, 12 report, 5 reactive
  { const { ctx, p } = await page();
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(600);
    for (const n of [0, 2]) { await p.locator('#clinics li.rk .infob').nth(n).click(); await p.waitForTimeout(250); await p.locator('.sheet button', { hasText: '비교함' }).click(); await p.keyboard.press('Escape'); await p.waitForTimeout(150); }
    ok('비교함: 가격 근거에서 2곳 담김', (await p.evaluate(() => JSON.parse(localStorage.getItem('pc:short') || '[]'))).length === 2);
    await p.evaluate((L) => localStorage.setItem('pc:short', JSON.stringify(L)), [...seller.map(bkey), bkey(non)]);
    await p.goto(BASE + '#branch/' + [...sells].find((x) => !seller.includes(x))); await p.waitForTimeout(400);
    await p.locator('#main button', { hasText: /^비교함$/ }).click(); await p.waitForTimeout(250);
    ok('비교함: 4곳까지만(5번째는 안 담김)', (await p.evaluate(() => JSON.parse(localStorage.getItem('pc:short')))).length === 4 && /4곳까지/.test(await p.locator('#toast').textContent()));
    await p.goto(BASE + '#quick?k=X12'); await p.waitForTimeout(700);
    const names = await p.$$eval('.shortl li b', (xs) => xs.map((x) => x.textContent));
    ok('빠른 비교: 실제 지점 이름 4곳', names.length === 4 && names.every((n, i) => n === [...seller, non].map(bname)[i]), names.join(', '));
    const rows = await p.$$eval('.qrows li', (ls) => ls.map((l) => ({ na: l.classList.contains('na'), p: l.querySelector('.qp')?.textContent || '', d: l.querySelector('.qd')?.textContent || '', bar: !!l.querySelector('.qbar') })));
    const okr = rows.filter((r) => !r.na);
    ok('빠른 비교: 같은 사양 없는 지점은 "비교 불가"(막대 없음)', rows[3].na && !rows[3].bar && /같은 사양/.test(await p.locator('.qrows li.na').innerText()));
    ok('빠른 비교: 비교 가능한 곳마다 막대', okr.length >= 2 && okr.every((r) => r.bar));
    const base = num(okr[0].p);
    ok('빠른 비교: 차이 = 기준(맨 위) 지점과의 금액 차', okr[0].d === '기준 지점' && okr.slice(1).every((r) => r.d === (num(r.p) === base ? '기준과 같은 가격' : `기준보다 ${Math.abs(num(r.p) - base).toLocaleString('ko-KR')}원 ${num(r.p) > base ? '높아요' : '낮아요'}`)), okr.map((r) => r.d).join(' / '));
    ok('빠른 비교: "가장 낮은 곳"을 따로 고르지 않음(②)', !/가장 낮|최저가/.test(await p.locator('#main').innerText()));
    await p.locator('.qrows li .linkbtn', { hasText: '기준으로' }).first().click(); await p.waitForTimeout(400);
    const names2 = await p.$$eval('.shortl li b', (xs) => xs.map((x) => x.textContent));
    ok('빠른 비교: "기준으로"를 누르면 그 지점이 맨 위·기준', names2[0] === names[1] && (await p.locator('.qrows li .qd').first().textContent()) === '기준 지점');
    // reactive: another treatment → the address and rows change at once
    const opt = await p.$$eval('select[aria-label="비교할 시술"] option', (os) => os.map((o) => [o.value, o.textContent]));
    const pick = opt.find((o) => !/X12|슈링크/.test(o[1])) || opt[1];
    await p.selectOption('select[aria-label="비교할 시술"]', pick[0]); await p.waitForTimeout(500);
    ok('즉시 갱신: 시술을 바꾸면 주소(?k=)와 결과가 바로 바뀜', !p.url().includes('k=X12') && (await p.locator('section[aria-label="빠른 비교 결과"] h3').textContent()) === pick[1].split(' · ')[0], pick[1]);
    await p.goto(BASE + '#quick?k=X12'); await p.waitForTimeout(500);
    // coverage table: 3 cart items × 4 branches; footer = the numbers in each column; 없음 never added
    const cov = await p.$$eval('table.cov tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)));
    const foot = await p.$$eval('table.cov tfoot td', (tds) => tds.map((td) => td.textContent));
    const sums = foot.map((_, c) => cov.reduce((s, r) => s + (/원/.test(r[c]) ? num(r[c]) : 0), 0));
    ok('제공 표: 시술 3줄 × 지점 4칸', cov.length === 3 && cov.every((r) => r.length === 4));
    ok('제공 표: 합계 = 있는 시술만 더한 값, 없는 건 "N개 없음"', foot.every((f, c) => num(f.split('·')[0]) === sums[c]) && foot.some((f) => /개 없음/.test(f)), foot.join(' | '));
    // report
    await p.locator('button', { hasText: '비교 보고서' }).click(); await p.waitForTimeout(300);
    const rep = await p.locator('pre.report').textContent();
    ok('보고서: 작성 시각·데이터 날짜·시술·수량·실제 지점 이름', /\d{4}-\d{2}-\d{2} \d{2}:\d{2} 작성/.test(rep) && rep.includes(D.meta.updated) && /×2/.test(rep) && [...seller].every((x) => rep.includes(bname(x))));
    ok('보고서: 총액·기준 대비 차액·조건·없는 시술 처리', /원/.test(rep) && /기준/.test(rep) && /0원으로 치지 않았어요/.test(rep) && !/가장 낮/.test(rep));
    await p.locator('.sheet button', { hasText: '복사' }).click(); await p.waitForTimeout(200);
    ok('보고서: 복사', (await p.evaluate(() => navigator.clipboard.readText())) === rep);
    await p.locator('.sheet button', { hasText: '보관' }).click(); await p.waitForTimeout(200);
    // remove + undo, swap
    await p.locator('.shortl li button[aria-label$="빼기"]').first().click(); await p.waitForTimeout(250);
    ok('비교함: 빼기', (await p.locator('.shortl li').count()) === 3);
    await p.locator('#toast button', { hasText: '되돌리기' }).click(); await p.waitForTimeout(300);
    ok('비교함: 빼기 되돌리기', (await p.locator('.shortl li').count()) === 4);
    await p.reload(); await p.waitForTimeout(800); if (await p.locator('#gate-pad').isVisible()) { for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForTimeout(800); }
    ok('비교함: 새로고침 뒤에도 유지', (await p.locator('.shortl li').count()) === 4);
    ok('스크립트 오류 없음(빠른 비교)', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }

  // ---- 2 spec, 3 eligibility, 6 terms, 8 checklist, 4 snapshot, 13 regional, 5 chart sync
  { const { ctx, p } = await page();
    await p.goto(BASE + '#compare?k=X01'); await p.waitForTimeout(700);
    const spec = await p.locator('.speccard').innerText();
    ok('규격 확인: 제품·원산지·용량·횟수·부위 줄', ['제품·장비', '원산지', '용량', '횟수', '부위'].every((w) => spec.includes(w)), spec.split('\n').slice(0, 3).join(' / '));
    ok('규격 확인: 이름에 없는 건 "미확인"(채워 넣지 않음)', await p.locator('.speccard .st-unknown').count() > 0 && /미확인/.test(spec));
    const sib = p.locator('.speccard .sibs .linkbtn').first();
    if (await sib.count()) { const t = await sib.textContent(); await sib.click(); await p.waitForTimeout(500); ok('규격 확인: 비슷한 다른 규격으로 이동', !p.url().includes('k=X01'), t); await p.goBack(); await p.waitForTimeout(500); }
    else ok('규격 확인: 비슷한 다른 규격 목록', false, '없음');
    const reg = await p.locator('section[aria-label="지역별 같은 사양 가격"]').innerText().catch(() => '');
    const regRows = await p.locator('.regl li').count();
    ok('지역별 가격: 지역마다 지점 수·중간값', regRows >= 2 && /곳 · 중간/.test(reg), `${regRows}개 지역`);
    ok('지역별 가격: 표본이 적으면 알림', !(await p.locator('.regl .k', { hasText: '표본 적음' }).count()) || /3곳 미만/.test(reg));
    // chart ↔ list
    await p.locator('#clinics li.rk').nth(1).hover(); await p.waitForTimeout(150);
    ok('즉시 반응: 목록 줄에 올리면 분포 그래프의 같은 지점 점 강조', await p.locator('.lcsvg circle.dot.hl').count() === 1);
    // eligibility in the price sheet
    await p.locator('#clinics li.rk .infob').first().click(); await p.waitForTimeout(300);
    const el = await p.$$eval('.sheet .elig li', (ls) => ls.map((l) => [l.querySelector('.ek').textContent, l.className]));
    ok('조건 요약: 첫 방문·체험 가격·부가세·기간·그 밖의 조건', ['첫 방문', '체험 가격', '부가세', '기간', '그 밖의 조건'].every((k, i) => el[i] && el[i][0].startsWith(k)), el.map((x) => x[0]).join(','));
    ok('조건 요약: 확인된 것/제한 없음/미확인 구분', el.every((x) => /el-(limit|none|unknown)/.test(x[1])));
    await p.locator('.sheet .elig .termb').first().click(); await p.waitForTimeout(300);
    const term = await p.locator('.sheet').last().innerText();
    ok('쉬운 용어: 짧은 설명 + 의료 판단 아님 안내', /윤실장이 가격표를 읽는 방법|일반적인 뜻/.test(term) && !/진단합니다|추천합니다|처방/.test(term));
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    // checklist from the compare tools, kept after reload
    await p.locator('.card.tools button', { hasText: '방문 전 체크리스트' }).click(); await p.waitForTimeout(300);
    const items = await p.locator('.chk-list li').count();
    const txt = await p.locator('.sheet').innerText();
    ok('체크리스트: 가격 포함 범위·부가세·조건·규격·의료진 질문', items >= 7 && ['가격 포함 범위', '부가세', '가격 조건', '시술 규격', '의료진에게'].every((w) => txt.includes(w)), `${items}개`);
    await p.locator('.chk-list input').nth(0).check(); await p.locator('.chk-list input').nth(2).check(); await p.waitForTimeout(200);
    ok('체크리스트: 진행 2/N', new RegExp(`2/${items} 확인`).test(await p.locator('.sheet').innerText()));
    await p.keyboard.press('Escape');
    await p.reload(); await p.waitForTimeout(900); if (await p.locator('#gate-pad').isVisible()) { for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForTimeout(900); }
    await p.goto(BASE + '#compare?k=X01'); await p.waitForTimeout(600);
    await p.locator('.card.tools button', { hasText: '방문 전 체크리스트' }).click(); await p.waitForTimeout(300);
    ok('체크리스트: 새로고침 뒤에도 체크 유지', await p.locator('.chk-list input:checked').count() === 2);
    await p.keyboard.press('Escape');
    // snapshot: saved vs today kept apart
    await p.locator('.card.tools button', { hasText: '이 비교 저장' }).click(); await p.waitForTimeout(300);
    const snap = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:snaps'))[0]);
    ok('비교 저장: 저장 시각·데이터 날짜·지점별 가격·확인일', !!snap.at && snap.data === D.meta.updated ? snap.items.length > 3 && snap.items.every((x) => x.none || (x.listed > 0 && x.ver)) : false, `${snap.items.length}곳`);
    await p.goto(BASE + '#snap/' + snap.id); await p.waitForTimeout(500);
    ok('비교 저장: 같은 데이터면 "아직 갱신 안 됨" 안내, 두 열이 같음', /아직 갱신되지 않았어요/.test(await p.locator('#main').innerText()) && await p.locator('table.snapt td.down, table.snapt td.up').count() === 0);
    await p.evaluate((id) => { const L = JSON.parse(localStorage.getItem('pc:snaps')); const s = L.find((x) => x.id === id); s.items[0].listed += 1000; localStorage.setItem('pc:snaps', JSON.stringify(L)); }, snap.id);
    await p.reload(); await p.waitForTimeout(900); if (await p.locator('#gate-pad').isVisible()) { for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForTimeout(900); }
    ok('비교 저장: 저장 시점 가격과 지금 가격이 다르면 그 차이를 따로 보여줌', await p.locator('table.snapt td.down').count() === 1);
    ok('스크립트 오류 없음(규격·조건·체크·저장)', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }

  // ---- 10 verification request, 11 watchlist, 14 feed, 6 terms page, 15 죠미 preferences
  { const { ctx, p } = await page({ favs: { k: ['X12', 'X01'], b: [] } });
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(500);
    await p.locator('#clinics li.rk .infob').first().click(); await p.waitForTimeout(250);
    await p.locator('.sheet button', { hasText: '가격 확인 요청' }).click(); await p.waitForTimeout(300);
    const rs = await p.locator('.sheet').innerText();
    ok('가격 확인 요청: 원본 주소·사유·시연/실제 구분', /원본 주소/.test(rs) && /기기에만 저장\(시연\)/.test(rs) && /GitHub로 신고\(실제 접수\)/.test(rs) && /서버가 없어요/.test(rs));
    await p.locator('.sheet button', { hasText: '기기에만 저장(시연)' }).click(); await p.waitForTimeout(300);
    const rep = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:reports'))[0]);
    ok('가격 확인 요청: 시연 저장은 "demo"로 기록 + 원본 주소 첨부', rep.via === 'demo' && /^https?:/.test(rep.url));
    await p.goto(BASE + '#saved'); await p.waitForTimeout(500);
    const sv = await p.locator('#main').innerText();
    ok('관심: 요청 상태 "서버 접수 아님"', /서버 접수 아님/.test(sv));
    ok('관심 시술 가격: 중간값·범위·지점 수·확인일, 최저가 병원 없음', /중간값 · [\d,]+원 ~ [\d,]+원 · \d+곳/.test(sv) && /확인 \d{4}-\d{2}-\d{2}/.test(sv) && !/최저 ·/.test(sv));
    ok('관심 시술 가격: 기록 1회면 변화 "아직 몰라요"', D.meta.prev ? true : /관측 1회라 아직 몰라요/.test(sv));
    const feed = await p.locator('section[aria-label="관심 시술 업데이트"]').innerText();
    ok('업데이트 소식: 실제 기록만(첫 기록이면 빈 상태, 지어내지 않음)', D.changes.length ? true : /아직 비교할 이전 가격이 없어요/.test(feed) && /지어내지 않아요/.test(feed));
    await p.goto(BASE + '#terms'); await p.waitForTimeout(400);
    const n0 = await p.locator('.termi').count();
    await p.fill('input[aria-label="용어 찾기"]', '샷'); await p.waitForTimeout(200);
    ok('쉬운 용어: 목록·검색', n0 >= 15 && await p.locator('.termi').count() >= 1 && await p.locator('.termi').count() < n0, `${n0}개`);
    // 죠미 preferences
    await p.goto(BASE + '#me'); await p.waitForTimeout(500);
    await p.locator('[role=radiogroup][aria-label="죠미 안내 빈도"] button', { hasText: '끄기' }).click(); await p.waitForTimeout(300);
    await p.locator('[role=radiogroup][aria-label="움직임"] button', { hasText: '끄기' }).click(); await p.waitForTimeout(300);
    await p.locator('[role=radiogroup][aria-label="설명 길이"] button', { hasText: '상세' }).click(); await p.waitForTimeout(300);
    ok('죠미 설정: 움직임 끄기 → 화면 움직임 꺼짐', await p.evaluate(() => document.documentElement.classList.contains('calm')));
    await p.goto(BASE + '#home'); await p.waitForTimeout(400);
    ok('죠미 설정: 안내 끄기 → 홈 인사 없음', await p.locator('.jomi-hello').count() === 0);
    await p.locator('.pc').first().locator('xpath=..').locator('.addbtn').click().catch(() => {}); await p.waitForTimeout(300);
    await p.goto(BASE + '#terms'); await p.waitForTimeout(400);
    ok('죠미 설정: 상세 설명 → 용어 설명을 펼친 채로', await p.locator('.termi details').count() === 0 && await p.locator('.termi .m').count() > n0);
    ok('죠미 설정: 안내 끄기 → 죠미 얼굴 없이 글만', await p.locator('#main .jomi-say img').count() === 0);
    await p.reload(); await p.waitForTimeout(900); if (await p.locator('#gate-pad').isVisible()) { for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForTimeout(900); }
    ok('죠미 설정: 새로고침 뒤에도 유지', await p.evaluate(() => document.documentElement.classList.contains('calm') && JSON.parse(localStorage.getItem('pc:jomiPrefs')).freq === 'off'));
    ok('스크립트 오류 없음(관심·설정)', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
