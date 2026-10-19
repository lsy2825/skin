// Objective price display (docs/OBJECTIVE_DISPLAY_POLICY.md) in a real browser: lists don't open in 'cheapest first'
// order, no clinic is pinned on top as 'the lowest', several sorts exist and work, no invented review/recommendation sort,
// each price comes with its conditions, genuine-product claim status, who-treats note, side effects and cautions; clinic
// rankings and discount emphasis (N% badges, struck-through list prices) stay off by default — and come back when their flags are switched on.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/objective.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const num = (t) => +String(t).replace(/[^\d]/g, '');
const sorted = (a, dir = 1) => a.every((v, i) => !i || (a[i - 1] - v) * dir <= 0);

(async () => { const b = await chromium.launch();
  const page = async (flags) => { const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    if (flags) await p.route('**/config.js', async (r) => { const res = await r.fetch(); let t = await res.text(); for (const f of flags) t = t.replace(`${f}: false`, `${f}: true`); r.fulfill({ response: res, body: t }); });
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:carts', JSON.stringify([{ id: 'a', name: 't', items: [{ t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }] }])); }); await p.reload();
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    return { ctx, p }; };
  const listPrices = (p) => p.$$eval('#clinics li.rk .rank .p', (xs) => xs.map((x) => +x.textContent.replace(/[^\d]/g, '')));

  { const { ctx, p } = await page();
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(500);
    const head = await p.locator('.pricecard').innerText();
    ok('요약에 특정 병원 이름 없음(가격 범위·중간값)', !/블리비|쁨|톡스앤필|리엔장|포에버/.test(head) && /가격 범위/.test(head) && /원\s*~\s*[\d,]+원/.test(head) && /중간값/.test(head), head.split('\n').slice(0, 4).join(' / '));
    const chips = await p.locator('#clinics .sortchips .chip').allTextContents();
    ok('정렬 여러 개(지역·거리·확인일·가격 낮은/높은)', ['지역·이름순', '가까운순', '최근 확인순', '낮은 가격순', '높은 가격순'].every((c) => chips.some((x) => x.includes(c))), chips.join(','));
    ok('리뷰·추천 정렬은 만들지 않음(근거 데이터 없음)', !chips.some((c) => /리뷰|추천/.test(c)));
    ok('기본 정렬이 가격순이 아님', (await p.locator('#clinics .sortchips .chip[aria-checked="true"]').textContent()).includes('지역·이름순'));
    const def = await listPrices(p);
    ok('기본 목록이 싼 순으로 줄 서 있지 않음', def.length > 5 && !sorted(def, 1), def.slice(0, 6).join(','));
    ok('목록에 순위 번호·최저 대비 표시 없음', await p.locator('#clinics .rank.nonum').count() === def.length && !/최저 \+/.test(await p.locator('#clinics').innerText()));
    await p.locator('#clinics .sortchips .chip', { hasText: '낮은 가격순' }).click(); await p.waitForTimeout(300);
    ok('낮은 가격순을 고르면 오름차순', sorted(await listPrices(p), 1));
    await p.locator('#clinics .sortchips .chip', { hasText: '높은 가격순' }).click(); await p.waitForTimeout(300);
    ok('높은 가격순을 고르면 내림차순', sorted(await listPrices(p), -1));
    const chk = await p.locator('.checks').innerText();
    ok('가격 바로 아래 함께 확인할 것: 조건·정품·의료진·부작용·주의사항', ['시술 조건', '정품', '시술 의료진', '주요 부작용', '주의사항'].every((w) => chk.includes(w)) && /검수 전/.test(chk), chk.split('\n').slice(0, 2).join(' / '));
    const order = await p.evaluate(() => { const a = document.querySelector('.pricecard'), c = document.querySelector('.checks'); return a && c && a.nextElementSibling === c; });
    ok('부작용·조건 카드가 가격 요약 바로 다음', order);
    ok('분포 그래프에 최저가 강조 점 없음', await p.locator('.lcsvg .dot.best').count() === 0 && !/현재 최저가/.test(await p.locator('.lclegend').first().innerText()));
    ok('정가 대비 할인율 카드 없음(할인 강조 끔)', !/정가 대비 할인율/.test(await p.locator('#main').innerText()));
    ok('목록에 줄 그은 정가 없음(정가·할인율은 가격 근거 안에만)', await p.locator('#clinics li.rk s').count() === 0);
    await p.locator('#clinics li.rk .infob').first().click(); await p.waitForTimeout(300);
    const sh = await p.locator('.sheet').innerText();
    ok('가격 근거에도 정품 표기·의료진·부작용 줄', /정품 표기/.test(sh) && /시술 의료진/.test(sh) && /부작용·주의사항/.test(sh));
    await p.keyboard.press('Escape');
    await p.goto(BASE + '#table'); await p.waitForTimeout(500);
    const so = await p.$$eval('label.flabel', (ls) => { const l = ls.find((x) => x.firstChild.textContent === '정렬'); return l ? [...l.querySelectorAll('option')].map((o) => [o.textContent, o.selected]) : []; });
    ok('전체 가격표: 기본 지역·이름순, 할인율 정렬 없음', so.length > 0 && so.find((x) => x[1])[0] === '지역·이름순' && !so.some((x) => /할인|중간보다/.test(x[0])), so.map((x) => x[0]).join(','));
    ok('전체 가격표: 가격만으로 고르지 말라는 안내', /가격만으로 고르지 마세요/.test(await p.locator('#main').innerText()));
    ok('전체 가격표: 줄 그은 정가·N%↓ 없음', await p.locator('#main .card.flush li s').count() === 0 && !/\d%↓/.test(await p.locator('#main').innerText()));
    await p.goto(BASE + '#home'); await p.waitForTimeout(400);
    const home = await p.locator('#main').innerText();
    ok('홈 카드: 중간값·범위, "N% 싸요"·병원 이름 없음', /중간값/.test(home) && !/% 싸요/.test(home) && await p.locator('.pc .w').count() === 0);
    ok('홈: 할인 큰 시술 대신 가격 차이 큰 시술', /병원마다 가격 차이가 큰 시술/.test(home) && !/중간값보다 많이 낮은 곳/.test(home));
    await p.goto(BASE + '#explore'); await p.waitForTimeout(400);
    ok('지점 순위·TOP 5 숨김', !/지점 순위|TOP 5/.test(await p.locator('#main').innerText()));
    await p.goto(BASE + '#rank'); await p.waitForTimeout(300);
    ok('지점 순위 주소로 와도 꺼짐 안내', /꺼 두었어요/.test(await p.locator('#main').innerText()) && await p.locator('#main li .rank').count() === 0);
    await p.goto(BASE + '#branch/3'); await p.waitForTimeout(400);
    ok('지점 화면: 순위·"제일 싼 시술" 없음', !/곳 중 \d+위|제일 싼 시술/.test(await p.locator('#main').innerText()));
    await p.goto(BASE + '#cart'); await p.waitForTimeout(400);
    const cart = await p.locator('.cartsum').innerText();
    ok('장바구니 요약: 범위, 최저가 지점 이름 없음', /원\s*~\s*[\d,]+원/.test(await p.locator('.cartsum .hp').textContent()) && !/최저가 지점/.test(cart), cart.split('\n').slice(0, 2).join(' / '));
    await p.click('.cartsum .btn'); await p.waitForTimeout(300);
    for (let n = 0; n < 8; n++) { const btn = p.locator('li.qrow > button[aria-expanded="false"]').first(); if (!(await btn.count())) break; await btn.click(); await p.waitForTimeout(150); }   // open the clinics' quotes
    const ql = await p.locator('.qline').count();
    ok('장바구니 견적: 할인율(N%↓)·줄 그은 정가 없음', ql > 0 && !/\d%↓/.test(await p.locator('#main').innerText()) && await p.locator('.qline s').count() === 0, `견적 줄 ${ql}개`);
    ok('병원별 비교: 기본 지역·이름순, "가장 싼 곳" 없음', (await p.locator('.sortchips .chip[aria-checked="true"]').textContent()).includes('지역·이름순') && !/가장 싼 곳|1위보다/.test(await p.locator('#main').innerText()));
    // the add sheet: a home card's 담기 puts its spec in with one tap (위계 점검 1); pressed again ('담김') it opens the sheet
    await p.goto(BASE + '#home'); await p.waitForTimeout(400); await p.locator('#main .addbtn').first().click(); await p.waitForTimeout(300);
    if (!(await p.locator('.sheet').count())) { await p.locator('#main .addbtn').first().click(); await p.waitForTimeout(300); }
    const add = await p.locator('.sheet').innerText();
    ok('담기 창: "가장 싼 곳"·병원 이름 대신 지점 수·범위·중간값', !/가장 싼 곳/.test(add) && /\d+곳 · [\d,]+원~[\d,]+원 · 중간값/.test(add), add.split('\n').filter((x) => /중간값|가장 싼/.test(x)).join(' / '));
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    // one '중간값' per key (2026-10-16 hierarchy audit M1·T7): the 담기 sheet's option and line, the range bar's label and the
    // compare header give the same number on the same basis and branch count; ranges keep one unit at both ends
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(600);
    const hmed = num(await p.locator('.cmphead .hmed').innerText()), basis = await p.locator('.cmphead .basis').innerText();
    const midl = await p.locator('.rangebar .midl').innerText().catch(() => '');
    await p.locator('.cmphead .morebtn').click(); await p.waitForTimeout(200); await p.locator('.actsheet button', { hasText: '횟수·다른 옵션으로 담기' }).click(); await p.waitForTimeout(400);
    const optTxt = await p.locator('.sheet .opt[aria-pressed="true"]').innerText().catch(() => ''), line = await p.locator('.sheet .note').innerText().catch(() => '');
    const n0 = (/(\d+)곳/.exec(basis) || [])[1], n1 = (/(\d+)곳/.exec(line) || [])[1];
    // (the bar is drawn only when the middle sits inside the range; the options only when the treatment has several)
    ok('같은 중간값: 비교 머리글 = 범위 막대 = 담기 창 옵션·안내(곳 수도 같음)', hmed > 0 && (!midl || num(midl) === hmed) && (!optTxt || num((/중간값 ([\d,]+원)/.exec(optTxt) || [])[1]) === hmed)
      && num((/중간값 ([\d,]+원)/.exec(line) || [])[1]) === hmed && !!n0 && n0 === n1 && /^중간값: /.test(basis.split(' · ')[1] || ''), `${hmed} · ${midl} · ${optTxt.replace(/\n/g, ' ')} · ${line} · ${basis}`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.goto(BASE + '#home'); await p.waitForTimeout(400);
    const ranges = await p.$$eval('.pc .save', (xs) => xs.map((x) => x.textContent).filter((t) => t.includes('~')));
    ok('홈 카드 범위: 양 끝 같은 단위(\'5,390~27.5만원\' 없음)', ranges.length > 0 && ranges.every((t) => { const [a, b] = t.split(' · ')[0].split('~'); return a.includes('만') === b.includes('만'); }), ranges.join(' / '));
    await p.evaluate(() => localStorage.setItem('pc:carts', JSON.stringify([{ id: 'a', name: '내 장바구니', items: [] }]))); await p.goto(BASE + '#cart'); await p.reload(); await p.waitForTimeout(500);
    const empty = await p.locator('#main').innerText();
    ok('빈 장바구니 안내: "어디가 가장 싼지" 대신 지점마다 예상 총액', /지점마다 예상 총액/.test(empty) && !/가장 싼지/.test(empty));
    ok('스크립트 오류 없음', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }

  // the flags bring the earlier displays back (for after legal review)
  { const { ctx, p } = await page(['lowestHighlight', 'branchRanking', 'discountEmphasis']);
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(500);
    ok('플래그 켜면: 최저가 지점 헤드라인', /현재 최저가/.test(await p.locator('.pricecard').innerText()));
    ok('플래그 켜면: 줄 그은 정가', await p.locator('#clinics li.rk s').count() > 0);
    await p.goto(BASE + '#explore'); await p.waitForTimeout(400);
    ok('플래그 켜면: 지점 순위·TOP 5', /지점 순위/.test(await p.locator('#main').innerText()) && /TOP 5/.test(await p.locator('#main').innerText()));
    // the search cards and the 담기 sheet follow the flag too (B1-1): the lowest with '~' and its clinic, '최저가' in the heads;
    // the sheet's numbers are read once per sheet (repaint on '+' keeps them)
    await p.goto(BASE + `#search/${encodeURIComponent('보톡스')}?nl=0`); await p.waitForTimeout(900);
    const sheads = await p.$$eval('#main .card > .row .sub', (xs) => xs.map((x) => x.textContent).filter((t) => /최저가|중간값/.test(t)));
    const srow = await p.locator('#main .card', { hasText: '같은 조건 가격 비교 바로가기' }).locator('li .item').first().innerText().catch(() => '');
    ok('플래그 켜면: 검색 종류·바로가기 카드는 최저가(원~·지점)', sheads.length >= 2 && sheads.every((t) => /최저가/.test(t)) && /원~/.test(srow) && /최저 /.test(srow), `${sheads.join(' / ')} · ${srow.replace(/\n/g, ' | ')}`);
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(500);
    await p.locator('.cmphead .morebtn').click(); await p.waitForTimeout(200); await p.locator('.actsheet button', { hasText: '횟수·다른 옵션으로 담기' }).click(); await p.waitForTimeout(400);
    const hero0 = await p.locator('.sheet .hero').innerText().catch(() => ''), opt0 = await p.locator('.sheet .opt[aria-pressed="true"]').innerText().catch(() => '');
    await p.locator('.sheet button[aria-label="하나 더"]').click(); await p.waitForTimeout(150);
    const hero1 = await p.locator('.sheet .hero').innerText().catch(() => ''), opt1 = await p.locator('.sheet .opt[aria-pressed="true"]').innerText().catch(() => '');
    ok('플래그 켜면: 담기 창은 가장 싼 곳·옵션 최저, \'+\' 뒤에도 같음', /가장 싼 곳/.test(hero0) && (!opt0 || /최저 [\d,]+원/.test(opt0)) && hero0 === hero1 && opt0 === opt1, `${hero0.replace(/\n/g, ' ')} · ${opt0.replace(/\n/g, ' ')}`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok('스크립트 오류 없음(플래그 켬)', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
