// Price Now expansion (docs/QA_AND_REGRESSION_REPORT.md): the directive's 24 test scenarios that this file covers in a real
// browser — search operators, spec / region / brand / price-condition filters, VAT estimate, brand overview, cart total and
// the first three, price re-check request, watch alert + lowest-branch change + alert history, local cache, offline with the
// service worker, PWA manifest / install UI, 320 px layout. Prices are cross-checked against app/data.json, so a screen
// that shows a different price, branch or spec fails. (Data sync scenarios: tests/e2e/data_sync.js.)
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/pricenow.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'); const path = require('path');
const rowsOf = require('./rows.js');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 220)}`); };
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'data.json'), 'utf8'));
rowsOf(D);
const S = D.s, ROWS = D.rows, BRANDS = D.meta.brands.map((b) => b[0]);
const BR = D.branches.map((b) => ({ brand: BRANDS[b[0]], name: S[b[1]], region: S[b[5]] }));
const bname = (i) => `${BR[i].brand} ${BR[i].name}`;
const num = (t) => +String(t).replace(/[^\d]/g, '');
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // the app's 'today' (KST)
const CAPITAL = ['서울', '경기', '인천'];

(async () => {
  const b = await chromium.launch();
  const mk = async (opts = {}) => { const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, ...opts }); const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    return { ctx, p }; };
  const open = async (p, setup) => { await p.goto(BASE); await p.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s || {})) localStorage.setItem(k, JSON.stringify(v)); }, setup);
    await p.reload(); await p.waitForTimeout(200);
    if (await p.locator('#gate-pad').isVisible()) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);   // unlocked tab: no PIN screen
    await p.waitForSelector('.pc'); };
  const ready = (p) => p.waitForFunction(() => document.querySelector('#main') && !document.querySelector('#main').hasAttribute('aria-busy') && document.querySelector('#main .card'), null, { timeout: 30000 });
  const go = async (p, hash, wait = 700) => { await p.goto(BASE + '#' + hash); await p.waitForTimeout(wait); };
  const names = (p) => p.$$eval('#main .card.flush li .item .t', (ts) => ts.map((t) => t.textContent));
  const stat = async (p) => num((await p.locator('.searchstat').textContent()).split('·')[0]);

  const { ctx, p } = await mk();
  await open(p, { 'pc:region': '' });   // 전국

  // 4) AND
  await go(p, 'search/' + encodeURIComponent('사각턱 50U') + '?nl=0');
  let ns = await names(p);
  const U50 = /(^|[^\d.])50\s*(u|유닛|단위|unit|units)(?![a-z])/i;   // 50단위 = 50U (search alias)
  ok('S4 AND 검색: 모든 결과에 사각턱 + 정확히 50U', ns.length > 0 && ns.every((n) => /사각턱/.test(n) && U50.test(n)), `${ns.length}개 · ${ns[0]}`);
  const nAnd = await stat(p);
  // 5) OR
  await go(p, 'search/' + encodeURIComponent('제오민|코어톡스') + '?nl=0');
  ns = await names(p);
  const XEO = /제오민|코어톡스|독일산\s*톡신|독일\s*톡신|xeomin/i;
  ok('S5 OR 검색: 결과마다 제오민 또는 코어톡스', ns.length > 0 && ns.every((n) => XEO.test(n)) && ns.some((n) => /제오민/.test(n)) && ns.some((n) => /코어톡스/.test(n)), `${ns.length}개`);
  // 6) exclusion
  await go(p, 'search/' + encodeURIComponent('사각턱 50U -제오민') + '?nl=0');
  ns = await names(p);
  const nNot = await stat(p);
  ok('S6 제외 검색: 제오민(별칭 포함) 없음, AND 결과보다 적거나 같음', ns.length > 0 && !ns.some((n) => /제오민|독일산\s*톡신|독일\s*톡신|xeomin/i.test(n)) && nNot <= nAnd, `${nAnd} → ${nNot}`);
  ok('S6 "이렇게 찾았어요"에 빼기 표시', /빼기: 제오민/.test(await p.locator('.qcard').innerText()));
  // 7) exact number + unit, and 1회?
  await go(p, 'search/' + encodeURIComponent('슈링크 300샷') + '?nl=0');
  ns = await names(p);
  ok('S7 숫자 정확 일치: 300샷만(1300샷 등 섞이지 않음)', ns.length > 0 && ns.every((n) => /(^|[^\d.,])300\s*샷/.test(n.replace(/1,300/g, '1300'))), `${ns.length}개`);
  await go(p, 'search/' + encodeURIComponent('슈링크 300샷 1회?') + '?nl=0');
  const rows1 = await p.$$eval('#main .card.flush li .item', (it) => it.map((x) => [x.querySelector('.t').textContent, [...x.querySelectorAll('.k.kw')].map((k) => k.textContent).join(',')]));   // '횟수 표기 없음': a state of the data, grey with an icon (위계 점검 27)
  const badOpt = rows1.filter(([n, tags]) => (/(\d+)\s*회/.test(n) ? !/(^|[^\d])1\s*회/.test(n) : !/횟수 표기 없음/.test(tags)));
  ok('S7 1회?: 횟수가 적힌 건 1회만, 안 적힌 건 "횟수 표기 없음"(1회로 단정 안 함)', rows1.length > 0 && !badOpt.length && rows1.some(([, t]) => /횟수 표기 없음/.test(t)), badOpt.slice(0, 2).map((x) => x[0]).join(' / '));
  await go(p, 'search/' + encodeURIComponent('보톡스 - ') + '?nl=0');
  ok('S7 잘못된 연산자: 오류 없이 안내', /뺄 낱말이 없어서 무시/.test(await p.locator('.qcard').innerText().catch(() => '')) && !p.errs.length);
  ok('검색 팁: 죠미 설명 + 예시 4개', await p.locator('details.stips .tiplist li').count() === 4 && await p.locator('details.stips .jomi-say').count() === 1);

  // 8) spec filters: 제품·장비 chip, 용량·샷 수 chip — the count on the chip = the results
  await go(p, 'table?q=' + encodeURIComponent('보톡스'), 900);
  const pchip = p.locator('.prodf .chip').first();
  const pTxt = await pchip.textContent(); const pName = pTxt.replace(/ \(.*$/, ''), pN = num(pTxt.replace(/^.*\(/, ''));
  await pchip.click(); await p.waitForTimeout(700);
  ns = await names(p);
  ok('S8 제품·장비 필터: 칩 숫자 = 결과 수, 결과마다 그 제품명', await stat(p) === pN && ns.length > 0 && ns.every((n) => n.includes(pName)), `${pName} ${pN}`);
  await go(p, 'table?q=' + encodeURIComponent('슈링크'), 900);
  const achip = p.locator('.chips .chip', { hasText: /샷 \(/ }).first();
  const aTxt = await achip.textContent(), aN = num(aTxt.replace(/^.*\(/, ''));
  await achip.click(); await p.waitForTimeout(700);
  ok('S8 용량·샷 수 필터: 칩 숫자 = 결과 수', await stat(p) === aN, aTxt);

  // 9) region + brand together (checked against data.json)
  await go(p, 'table?reg=' + encodeURIComponent('서울') + '&brand=0&q=' + encodeURIComponent('리쥬란'), 900);
  // the clinic of every line: in 지역·이름순 named once over its lines (.sgh, 위계 점검 33), in other orders on each line
  const bn = await p.$$eval('#main .card.flush li .sgh .sgname, #main .card.flush li .item .m .linkbtn:first-child', (ls) => ls.map((l) => l.textContent.trim()));
  const regOf = new Map(BR.map((x, i) => [bname(i), x]));
  const badReg = bn.filter((n) => { const x = regOf.get(n); return !x || x.region !== '서울' || x.brand !== BRANDS[0]; });
  ok('S9 지역(서울)·브랜드 필터 조합: 모든 줄이 서울 + 그 브랜드', bn.length > 0 && !badReg.length, `${bn.length}줄 ${badReg.slice(0, 2).join(',')}`);
  ok('필터 줄: [지역][가격 조건][브랜드] + 상세 필터 접힘', await p.locator('.fbar .flabel').count() >= 3 && await p.locator('details.fmore').count() === 1 && !(await p.locator('details.fmore').getAttribute('open')));

  // 10) price conditions in one sheet
  await go(p, 'table?q=' + encodeURIComponent('보톡스'), 900);
  await p.locator('.fbtn').click(); await p.waitForTimeout(300);
  await p.locator('.sheet .pcgrp[aria-label^="특가"] .opt', { hasText: '일반가만' }).click();
  await p.locator('.sheet .btn', { hasText: '적용' }).click(); await p.waitForTimeout(700);
  const kinds = await p.$$eval('#main .card.flush li .item .m', (ms) => ms.map((m) => m.textContent));
  ok('S10 일반가만: 체험가·한정가·첫 방문 표시 없음, 주소에 cond=plain', p.url().includes('cond=plain') && kinds.length > 0 && !kinds.some((t) => /체험가|한정가|첫 방문/.test(t)), `${kinds.length}줄`);
  await p.locator('.fbtn').click(); await p.waitForTimeout(300);
  await p.locator('.sheet .btn', { hasText: '초기화' }).click();
  await p.locator('.sheet .pcgrp[aria-label="첫 방문 가격"] .opt', { hasText: '첫 방문가만' }).click();
  await p.locator('.sheet .btn', { hasText: '적용' }).click(); await p.waitForTimeout(700);
  const fv = await p.$$eval('#main .card.flush li .item .m', (ms) => ms.map((m) => m.textContent));
  ok('S10 첫 방문가만: 결과마다 첫 방문 조건', p.url().includes('fv=only') && !p.url().includes('cond=') && fv.length > 0 && fv.every((t) => /첫 방문/.test(t)), `${fv.length}줄`);

  // 11) VAT-inclusive estimate (VAT 별도 price: listed × 1.1); 병원 표시가 switch shows the listed price
  await go(p, 'compare?k=X12', 900);
  await p.locator('#clinics li .infob').first().click(); await p.waitForTimeout(400);
  const vt = await p.locator('.sheet .fact', { hasText: '가격과 부가세' }).innerText();
  const m = /병원 표시가 ([\d,]+)원 \+ 부가세 10% = ([\d,]+)원/.exec(vt);
  ok('S11 부가세 포함가 = 병원 표시가 × 1.1(별도 표기 가격만)', !!m && Math.round(num(m[1]) * 1.1) === num(m[2]), vt.replace(/\n/g, ' '));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const listed = m ? num(m[1]) : -1, firstB = await p.locator('#clinics li .b').first().textContent();
  await go(p, 'table?q=x', 400); await p.locator('.fbtn').click(); await p.waitForTimeout(300);
  await p.locator('.sheet .pcgrp[aria-label^="부가세"] .opt', { hasText: '병원 표시가' }).click();
  await p.locator('.sheet .btn', { hasText: '적용' }).click(); await p.waitForTimeout(500);
  await go(p, 'compare?k=X12', 900);
  const li = p.locator('#clinics li', { hasText: firstB.trim() }).first();
  ok('S11 병원 표시가로 바꾸면 같은 지점이 표시가로', num(await li.locator('.p').textContent()) === listed, `${firstB} ${listed}`);
  await p.evaluate(() => localStorage.setItem('pc:vat', JSON.stringify('incl'))); await p.reload(); await ready(p);

  // 12) brand overview: counts add up, median shown, no branch named by default; the brand sheet = the clinic list prices
  await go(p, 'compare?k=X12', 1000);
  const total = num(await p.locator('#clinics h3').first().textContent());
  // 6.0: the brand overview is folded ('가격 종류별·브랜드별·지역별 보기') and the list shows its first rows; the shared
  // '20곳 더 보기 (N곳 남음)' (2026-10-16 hierarchy audit 11) adds 20 a tap — tapped until every branch is listed
  await p.locator('#cmpmore > summary').click(); await p.waitForTimeout(200);
  for (let k = 0; k < 30 && await p.locator('#clinics .morelist').count(); k++) { await p.locator('#clinics .morelist').first().click(); await p.waitForTimeout(400); }
  const tiles = await p.$$eval('.bcard .tile', (ts) => ts.map((t) => t.innerText));
  const sumN = tiles.reduce((s, t) => s + num((/(\d+)곳 · 중간 /.exec(t) || [, 0])[1]), 0);
  ok('S12 브랜드별: 지점 수 합 = 지점별 가격 수, 중간 가격·확인일, 기본은 지점명 강조 없음', tiles.length >= 2 && sumN === total && tiles.every((t) => /중간 [\d,]+원/.test(t) && /확인 \d{4}-/.test(t)) && !tiles.some((t) => /브랜드 중 최저/.test(t)), `${tiles.length}개 브랜드 · ${sumN}/${total}곳`);
  await p.locator('.bcard .tile').first().click(); await p.waitForTimeout(400);
  const sheetRows = await p.$$eval('.sheet .list li .item', (it) => it.map((x) => [x.querySelector('.t').textContent.trim(), x.querySelector('.p').textContent]));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const listRows = new Map(await p.$$eval('#clinics li', (ls) => ls.map((l) => [l.querySelector('.b').textContent.trim(), l.querySelector('.p').textContent])));
  const mism = sheetRows.filter(([n, pr]) => listRows.get(n) !== pr);
  ok('S12 브랜드 카드 → 그 브랜드 지점 가격 = 지점별 목록과 같은 값', sheetRows.length > 0 && !mism.length, mism.slice(0, 2).map((x) => x.join(' ')).join(' / '));

  // 13–14) cart total and the first three when sorted by total
  await open(p, { 'pc:region': '', 'pc:carts': [{ id: 'a', name: '내 장바구니', items: [{ t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }] }] });
  await go(p, 'cart', 900);
  await p.locator('#main button', { hasText: '병원별 비교 보기' }).first().click(); await p.waitForTimeout(500);
  await p.locator('.sortchips .chip', { hasText: '합계 낮은순' }).click(); await p.waitForTimeout(500);
  const t3 = await p.$$eval('.t3card .t3 > li', (ls) => ls.map((l) => [l.querySelector('b').textContent.trim(), l.querySelector('.num').textContent]));
  const q3 = await p.$$eval('li.qrow', (ls) => ls.slice(0, 3).map((l) => [l.querySelector('.b').textContent.trim(), l.querySelector('.p').textContent]));
  ok('S14 합계 낮은순 맨 위 3곳 카드 = 목록의 첫 3곳(이름·합계)', t3.length === 3 && JSON.stringify(t3) === JSON.stringify(q3), JSON.stringify(t3));
  ok('S14 순위 문구(1위·최저) 없음 + 재확인 요청은 실제 접수 링크', !/1위|가장 싼|최저가/.test(await p.locator('.t3card').innerText()) && /labels=price-recheck/.test(await p.locator('.t3card a').getAttribute('href')));
  await p.locator('li.qrow > button').first().click(); await p.waitForTimeout(400);
  const lineSum = (await p.$$eval('li.qrow.open .qline > .row b.num', (bs) => bs.map((x) => x.textContent))).reduce((s, x) => s + num(x), 0);
  const shownTotal = num(await p.locator('li.qrow.open .p').first().textContent());
  ok('S13 장바구니 총액 = 시술별 금액의 합', lineSum > 0 && lineSum === shownTotal, `${lineSum} / ${shownTotal}`);

  // 15) price re-check request: honest demo text, real GitHub link, once a day per price
  await go(p, 'compare?k=X12', 900);
  await p.locator('#clinics li .infob').first().click(); await p.waitForTimeout(300);
  await p.locator('.sheet .btn', { hasText: '이 가격 다시 확인하기' }).click(); await p.waitForTimeout(300);
  const rc = await p.locator('.sheet').innerText();
  const href = await p.locator('.sheet a', { hasText: 'GitHub로 재확인 요청' }).getAttribute('href');
  ok('S15 재확인: 시연 안내(바로 다시 읽지 않음) + 수집일·이번 주 상태·다음 수집', /바로 다시 읽지 않아요/.test(rc) && /병원 가격을 읽은 날/.test(rc) && /다음 정기 수집/.test(rc) && !/실시간/.test(rc));
  ok('S15 재확인 요청은 GitHub 이슈(price-recheck)', /github\.com\/lsy2825\/skin\/issues\/new/.test(href) && /labels=price-recheck/.test(href));
  const [pop] = await Promise.all([ctx.waitForEvent('page').catch(() => null), p.locator('.sheet a', { hasText: 'GitHub로 재확인 요청' }).click()]);
  if (pop) await pop.close();
  await p.waitForTimeout(300);
  await p.locator('#clinics li .infob').first().click(); await p.waitForTimeout(300);
  await p.locator('.sheet .btn', { hasText: '이 가격 다시 확인하기' }).click(); await p.waitForTimeout(300);
  ok('S15 같은 가격은 하루 한 번(두 번째는 안내만)', /오늘 이미 요청했어요/.test(await p.locator('.sheet').innerText()) && await p.locator('.sheet a', { hasText: 'GitHub로 재확인 요청' }).count() === 0);
  await p.keyboard.press('Escape');

  // 16) watch a treatment
  await open(p, {});   // default region 수도권
  await go(p, 'compare?k=X12', 900);
  await p.locator('.cmphead .morebtn').click(); await p.waitForTimeout(200); await p.locator('.actsheet button', { hasText: '가격 알림' }).click(); await p.waitForTimeout(300);
  ok('S16 알림 종류 첫 번째 = 지켜보기, 변화 6가지 선택', (await p.locator('.sheet .opt[aria-pressed="true"]').first().textContent()).includes('지켜보기') && await p.locator('.sheet .pcgrp input[type=checkbox]').count() === 6);
  await p.locator('.sheet .btn', { hasText: '알림 만들기' }).click(); await p.waitForTimeout(400);
  const al = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:alerts'))[0]);
  // the lowest listed X12 price in 수도권 today, from data.json (no expired / under-review rows)
  const x12 = []; ROWS.forEach((r) => { const keys = S[r[7]] || ''; const u = S[r[10]] || ''; if (keys.split(' ').includes('X12') && !r[13] && !(/^\d{4}-\d{2}-\d{2}$/.test(u) && u < TODAY) && CAPITAL.includes(BR[r[0]].region)) x12.push(r); });
  const low = Math.min(...x12.map((r) => r[3]));
  ok('S16 지켜보기 저장: 병원 표시가 기준·지역·기준값(data.json 최저와 같음)', al && al.type === 'watch' && al.basis === 'listed' && al.reg === '수도권' && al.base.low === low && !!al.base.lowB, al && JSON.stringify({ low: al.base.low, b: al.base.lowB, expect: low }));
  // the mark of the build the baseline came from (C #112, Intel.reclMark): this collection and data-meta.json's version
  const ver = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'data-meta.json'), 'utf8')).version;
  ok('S16 기준을 잡은 빌드의 표시 저장(수집일·data-meta 버전)', al && al.rm && al.rm.u === D.meta.updated && al.rm.v === ver && Array.isArray(al.rm.f), al && JSON.stringify({ rm: al.rm, ver }));

  // 17–18) lowest-branch change detection: the stored baseline says another branch had a higher lowest last time
  const other = al.base.set.find((x) => x !== al.base.lowB);
  await p.evaluate(([o]) => { const a = JSON.parse(localStorage.getItem('pc:alerts')); a[0].base = { ...a[0].base, lowB: o, lowName: o.replace('|', ' '), low: a[0].base.low + 10000 }; a[0].seen = '2026-10-01'; localStorage.setItem('pc:alerts', JSON.stringify(a)); localStorage.setItem('pc:notes', '[]'); }, [other]);
  await p.reload(); await ready(p); await p.waitForTimeout(300);
  const notes = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:notes')));
  const lb = notes.find((x) => x.type === 'lowbranch'), dr = notes.find((x) => x.type === 'drop');
  const lowName = x12.filter((r) => r[3] === low).map((r) => `${BR[r[0]].brand}|${BR[r[0]].name}`);
  ok('S17 최저가 지점 변경 감지: 지난 지점 → 지금 지점(실제 데이터), 가격 하락도 따로', !!lb && !!dr && lowName.includes(lb.b) && lb.after === low && dr.before === al.base.low + 10000, lb && `${lb.text}`);
  await go(p, 'saved', 700);
  const hist = p.locator('.notes li[data-type="lowbranch"]').first();
  const ht = await hist.innerText().catch(() => '');
  ok('S18 알림 기록: 종류·시술·실제 지점·이전→새 가격·수집일', /최저가 지점 변경/.test(ht) && /→/.test(ht) && /\d{4}-\d{2}-\d{2} 수집/.test(ht) && ht.includes(lb ? lb.b.split('|')[1] : '???'), ht.replace(/\n/g, ' '));
  await hist.locator('button', { hasText: '가격 보기' }).click(); await p.waitForTimeout(500);
  ok('S18 가격 보기 → 그 시술 비교 화면', /#compare\?k=X12/.test(p.url()));
  await go(p, 'saved', 500);
  ok('S18 휴대폰 알림 패널 표시(푸시 서버 없음 안내)', /휴대폰 알림/.test(await p.locator('.nfp').innerText()));

  // 19) local cache
  ok('S19 로컬 캐시: 확인된 가격 사본 저장(pc-data-v1)', await p.evaluate(async () => !!(await (await caches.open('pc-data-v1')).match('current-meta'))));

  // 11+) data status screen
  await go(p, 'data', 700);
  const ds = await p.locator('#data-status').innerText();
  ok('데이터 상태: 등록 지점·확인·마지막 확인·바뀐 가격·부가세·이벤트·신고, "실시간" 없음', [/전체 등록 지점/, /이번 수집에서 확인/, /마지막 확인/, /바뀐 가격/, /부가세 처리/, /이벤트 가격 처리/, /가격 오류 신고/].every((r) => r.test(ds)) && !/실시간 가격(?!이 아니)/.test(ds.replace("'실시간' 가격이 아니에요", '')), ds.split('\n').slice(0, 3).join(' / '));
  ok('데이터 상태: 지점 수가 data.json과 같음', ds.includes(`${D.branches.length}곳`));
  // 22) PWA install UI: no dead button; the browser's prompt (simulated) shows the button and is used
  ok('S22 설치 버튼은 브라우저가 설치를 허락할 때만', await p.locator('#install .btn', { hasText: '이 기기에 설치하기' }).count() === 0 && /설치/.test(await p.locator('#install').innerText()));
  await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
  await p.waitForTimeout(400);
  const ib = p.locator('#install .btn', { hasText: '이 기기에 설치하기' });
  const hasBtn = await ib.count() === 1; if (hasBtn) { await ib.click(); await p.waitForTimeout(300); }
  ok('S22 설치 허락(이벤트) → 버튼 → 브라우저 설치 창 호출', hasBtn && await p.evaluate(() => window.__prompted === true));
  ok('이 기기: 저장된 가격·버전·지우고 다시 받기', /저장된 가격/.test(await p.locator('#device').innerText()) && await p.locator('#device .btn', { hasText: '지우고 다시 받기' }).count() === 1);
  const man = await p.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  const sizes = (man.icons || []).map((i) => `${i.sizes}:${i.purpose || 'any'}`);
  ok('S22 매니페스트: 이름·시작 주소·standalone·192/512/maskable 아이콘·id', man.name && man.start_url && man.display === 'standalone' && man.id && sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.some((s) => /maskable/.test(s)), JSON.stringify(sizes));
  ok('스크립트 오류 없음(메인)', !p.errs.length, p.errs.join(' | '));
  await ctx.close();

  // 20) offline with the service worker: the app shell and the saved prices, with the notice
  { const { ctx: c2, p: q } = await mk({ serviceWorkers: 'allow' });
    await open(q, {});
    await q.evaluate(async () => { await navigator.serviceWorker.ready; });
    await q.reload(); await ready(q);
    const ctl = await q.evaluate(() => !!navigator.serviceWorker.controller);
    await c2.setOffline(true);
    await q.reload(); await ready(q).catch(() => {});
    const nb = await q.locator('#netbar').innerText().catch(() => '');
    ok('S20 오프라인(서비스 워커): 앱이 열리고 저장된 가격 + 안내 문구', ctl && await q.locator('#main .card').count() > 0 && /저장된 가격 정보입니다\. 현재 가격과 다를 수 있습니다\./.test(nb), `controller=${ctl} · ${nb}`);
    await go(q, 'compare?k=X12', 800);
    ok('S20 오프라인에서도 비교 화면 가격 표시', await q.locator('#clinics li').count() > 0);
    await c2.setOffline(false);
    ok('S22 서비스 워커가 페이지를 제어', ctl);
    ok('스크립트 오류 없음(오프라인)', !q.errs.length, q.errs.join(' | '));
    await c2.close(); }

  // 23) 320 px: no sideways scrolling on the new screens
  { const { ctx: c3, p: q } = await mk({ viewport: { width: 320, height: 700 } });
    await open(q, { 'pc:carts': [{ id: 'a', name: '내 장바구니', items: [{ t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }] }], 'pc:qsort': 'total' });
    const over = [];
    for (const r of ['table?q=' + encodeURIComponent('보톡스'), 'search/' + encodeURIComponent('사각턱 50U -제오민') + '?nl=0', 'data', 'saved', 'cart', 'compare?k=X12']) {
      await go(q, r, 700);
      if (r === 'cart') { await q.locator('#main button', { hasText: '병원별 비교 보기' }).first().click().catch(() => {}); await q.waitForTimeout(300); await q.locator('.sortchips .chip', { hasText: '합계 낮은순' }).click().catch(() => {}); await q.waitForTimeout(300); }
      const w = await q.evaluate(() => document.documentElement.scrollWidth);
      if (w > 320) over.push(`${r}:${w}`);
    }
    await go(q, 'table?q=x', 400); await q.locator('.fbtn').click(); await q.waitForTimeout(300);
    const sw = await q.evaluate(() => document.documentElement.scrollWidth);
    ok('S23 320px: 새 화면·가격 조건 창 가로 넘침 없음', !over.length && sw <= 320, over.join(' ') || `sheet ${sw}`);
    ok('스크립트 오류 없음(320px)', !q.errs.length, q.errs.join(' | '));
    await c3.close(); }

  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1;
})();
