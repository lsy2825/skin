// 죠미(Jomi) in a real browser: the introduction sheet (tap only, first vs returning, kept after reload, Esc / outside /
// navigation close it, focus returns, the page behind doesn't scroll), feedback toasts (cart with undo, saved, alert only
// after it is stored), empty / loading / error states, reduced motion, mascot kept out of the price screen, and that
// every image is one of the registry's files cut from the user's own artwork (expression sheet), each expression its own.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/jomi.js [out-dir]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
// round 2: Jomi's lines come from the line engine (app/domain/jomilines.js), which picks a variant — so a check accepts any
// variant of the intent (optionally only records whose id starts with `only`) instead of one fixed sentence.
const said = (p, intent, text, only) => p.evaluate(([i, t, o]) => window.JomiLines.RECORDS.filter((r) => r.intent === i && (!o || r.id.startsWith(o))).some((r) => r.variants.some((v) => (t || '').includes(v))), [intent, text, only]);
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };

(async () => { const OUT = process.argv[2] || require('os').tmpdir(); const b = await chromium.launch();
  const page = async (opts = {}, setup) => { const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, ...opts }); const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    p.ext = []; p.on('request', (r) => { if (/\.(png|webp|jpe?g|gif|svg)(\?|$)/.test(r.url()) && !r.url().startsWith(BASE) && !/tile\.openstreetmap/.test(r.url())) p.ext.push(r.url()); });
    if (setup) await setup(p);
    await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
    return { ctx, p }; };

  { const { ctx, p } = await page(); await p.waitForSelector('.pc');
    ok('저절로 뜨는 소개 없음', await p.locator('.sheet').count() === 0);
    await p.click('#jomibtn'); await p.waitForTimeout(400);
    const t1 = await p.locator('.sheet').innerText();
    ok('죠미를 누르면 첫 자기소개', await p.locator('.jomi-intro.first').count() === 1 && /안녕! 난 죠미야!/.test(t1) && /궁금한 게 있으면 언제든 찾아와/.test(t1), t1.split('\n').slice(0, 3).join(' / '));
    ok('역할·진단 아님 안내와 버튼 2개', /공식 안내냥/.test(t1) && /진단이나 시술 추천은 하지 않아/.test(t1) && /죠미와 대화/.test(t1) && /시술 가격비교/.test(t1));
    ok('시트가 열린 동안 뒤 화면 스크롤 잠금', await p.evaluate(() => document.documentElement.classList.contains('sheet-open') && getComputedStyle(document.body).overflow === 'hidden'));
    ok('포커스가 시트 안', await p.evaluate(() => !!document.activeElement.closest('.sheet')));
    await p.click('.jomi-pic'); await p.waitForTimeout(150);
    ok('죠미를 쓰다듬으면 한마디(숨은 재미)', (await p.locator('.jomi-quip').textContent()).length > 0);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok('Esc로 닫히고 포커스가 죠미 버튼으로', await p.locator('.sheet').count() === 0 && await p.evaluate(() => document.activeElement.id === 'jomibtn' && !document.documentElement.classList.contains('sheet-open')));
    ok('본 날짜만 저장(이 기기)', /^"\d{4}-\d{2}-\d{2}"$/.test(await p.evaluate(() => localStorage.getItem('pc:jomiSeen'))));
    await p.reload(); await p.waitForSelector('.pc');
    ok('새로고침 뒤 홈 인사가 재방문 인사로(첫 방문 인사 아님)', await said(p, 'home', await p.locator('.jomi-hello').textContent()) && !(await said(p, 'home', await p.locator('.jomi-hello').textContent(), 'home.first')), await p.locator('.jomi-hello').textContent());
    await p.click('.jomi-hello'); await p.waitForTimeout(400);
    ok('재방문: 짧은 인사 + 전체 소개 다시 보기', await p.locator('.jomi-intro:not(.first)').count() === 1 && /또 왔네! 오늘은 어떤 시술이 궁금해/.test(await p.locator('.sheet').innerText()));
    // the full line set (app/data/jomi_lines.json) arrives after the prices: 2,000+ lines, and the returning sheet shows one of them
    const lines = await p.waitForFunction(() => window.JomiLines && window.JomiLines.stats().variants >= 2000 && window.JomiLines.stats(), null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
    ok('죠미 대사 파일을 받아 2,000개 이상으로 늘어남', !!lines, JSON.stringify(lines));
    const tipT = await p.locator('.sheet .jomi-tip').textContent().catch(() => '');
    ok('재방문 시트: 오늘의 한마디(팁·응원 중 하나)', /오늘의 한마디/.test(tipT) && (await said(p, 'tip', tipT) || await said(p, 'cheer', tipT)), tipT);
    await p.locator('.sheet .linkbtn', { hasText: '전체 소개 다시 보기' }).click(); await p.waitForTimeout(400);
    ok('전체 소개 다시 열기', await p.locator('.jomi-intro.first').count() === 1 && await p.locator('.sheet').count() === 1);
    await p.mouse.click(195, 40); await p.waitForTimeout(200);
    ok('바깥을 누르면 닫힘', await p.locator('.sheet').count() === 0);
    await p.click('#jomibtn'); await p.waitForTimeout(300); await p.locator('.sheet .btn', { hasText: '시술 가격비교' }).click(); await p.waitForTimeout(400);
    ok('소개의 가격비교 버튼 → 비교 화면', /#compare/.test(p.url()) && await p.locator('.sheet').count() === 0);
    ok('가격 비교 화면에는 죠미를 넣지 않음', await p.locator('#main img.jomi').count() === 0);
    await p.click('#jomibtn'); await p.waitForTimeout(300); await p.goBack(); await p.waitForTimeout(400);
    ok('뒤로 가면 열린 시트도 닫힘', await p.locator('.sheet').count() === 0 && await p.evaluate(() => !document.documentElement.classList.contains('sheet-open')));
    // images: only the registry's files, all loaded
    const imgs = await p.evaluate(async () => { await new Promise((r) => setTimeout(r, 300)); return [...document.querySelectorAll('img.mascot')].map((i) => [i.getAttribute('src'), i.naturalWidth]); });
    const reg = await p.evaluate(() => [...Object.values(window.JOMI.files), ...Object.values(window.JOMI.expressions).flatMap((e) => [e.face, e.portrait].filter(Boolean))]);
    ok('죠미 그림은 레지스트리 파일만, 모두 로드', imgs.length > 0 && imgs.every(([s, w]) => reg.includes(s) && w > 0) && !p.ext.length, JSON.stringify(imgs.slice(0, 3)));
    const files = await p.evaluate(async () => Promise.all([...new Set([...Object.values(window.JOMI.files), ...Object.values(window.JOMI.expressions).flatMap((e) => [e.face, e.portrait].filter(Boolean))])].map(async (f) => [f, (await fetch(f)).status])));
    ok('레지스트리 파일이 모두 있음', files.length >= 17 && files.every(([, s]) => s === 200), `${files.length}개 ` + JSON.stringify(files.filter(([, s]) => s !== 200)));
    // the user's expression sheet: every approved expression has its own face + portrait; pending ones name a fallback that has art
    const ex = await p.evaluate(() => Object.entries(window.JOMI.expressions).map(([k, e]) => [k, e.art, !!e.face, !!e.portrait, e.fallback || '', !!(window.JOMI.expressions[e.fallback] || {}).face]));
    ok('승인된 표정 8개는 각자 그림, 나머지는 대신 쓸 표정이 있음', ex.filter((x) => x[1] === 'approved').length === 8 && ex.every(([, art, f, po, fb, fbArt]) => art === 'approved' ? f && po : fb && fbArt), JSON.stringify(ex.filter((x) => x[1] !== 'approved')));
    ok('헤더·로딩은 기본·졸린 표정 그림', /expr-default-96/.test(await p.locator('#jomibtn img').getAttribute('src')));
    ok('스크립트 오류 없음', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }

  // feedback: cart (undo), saved, alert
  { const { ctx, p } = await page(); await p.waitForSelector('.pc');
    await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(400);
    await p.locator('.actions .addbtn').click(); await p.waitForTimeout(250); await p.locator('.sheet button', { hasText: /회 담기$/ }).click(); await p.waitForTimeout(300);
    const tt = await p.locator('#toast').textContent();
    ok('담으면 죠미 확인 토스트 + 되돌리기', await said(p, 'added', tt) && await p.locator('#toast.jt img.mascot').count() === 1 && /되돌리기/.test(tt) && (await p.locator('#cart-n').textContent()) === '1', tt);
    ok('담은 뒤 버튼이 바로 "담김"', /담김/.test(await p.locator('.actions .addbtn').textContent()));
    await p.locator('#toast button', { hasText: '되돌리기' }).click(); await p.waitForTimeout(300);
    ok('되돌리기 → 장바구니에서 빠짐', await p.locator('#cart-n').isHidden() && (await p.evaluate(() => JSON.parse(localStorage.getItem('pc:carts'))[0].items.length)) === 0);
    ok('토스트는 하나만(겹치지 않음)', await p.locator('#toast').count() === 1);
    await p.click('.keyhead .favbtn'); await p.waitForTimeout(250);
    ok('관심 저장 → 하트 채움 + "저장했어" 토스트', (await p.locator('.keyhead .favbtn').getAttribute('aria-pressed')) === 'true' && await said(p, 'saved', await p.locator('#toast').textContent()) && /관심 보기/.test(await p.locator('#toast').textContent()));
    const before = await p.locator('#toast').textContent();
    await p.locator('.actions .btn', { hasText: '알림' }).click(); await p.waitForTimeout(250);
    ok('알림을 만들기 전에는 윙크 토스트 없음', !/알려줄게/.test(await p.locator('#toast.on').textContent().catch(() => '')) || before === await p.locator('#toast').textContent());
    await p.locator('.sheet .btn', { hasText: '알림 만들기' }).click(); await p.waitForTimeout(300);
    const at = await p.locator('#toast').textContent(), saved = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:alerts') || '[]').length);
    ok('알림 저장 뒤 죠미 윙크 + 조건 요약 + 알림 관리', saved === 1 && await said(p, 'alertSet', at) && /지켜보기 \(\d가지 변화\)|목표가 이하|새 최저가|파는 지점/.test(at) && /알림 관리/.test(at) && (await p.locator('#toast img').getAttribute('data-expr')) === 'wink', at);
    await p.locator('#toast button', { hasText: '알림 관리' }).click(); await p.waitForTimeout(300);
    ok('알림 관리 → 관심 탭', /#saved/.test(p.url()) && /가격 알림/.test(await p.locator('#main').innerText()));
    await p.goto(BASE + '#home'); await p.waitForTimeout(400);
    ok('홈 이어서 보기(최근·관심 시술)', /이어서 보기/.test(await p.locator('#main').innerText()) && await p.locator('#main .chip', { hasText: '슈링크' }).count() >= 1);
    ok('스크립트 오류 없음', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }

  // empty states, loading, error recovery, reduced motion
  { const { ctx, p } = await page(); await p.waitForSelector('.pc');
    await p.goto(BASE + '#cart'); await p.waitForTimeout(300);
    ok('빈 장바구니: 죠미 + 안내 + 다음 행동', await p.locator('#main .jomi-empty img').count() === 1 && await said(p, 'emptyCart', await p.locator('#main').innerText()) && await p.locator('#main .btn', { hasText: '시술 고르러 가기' }).count() === 1);
    await p.goto(BASE + '#search/zzqqxx?nl=0'); await p.waitForTimeout(600);
    ok('검색 결과 없음: 시무룩한 죠미 + 바꿔 보기 안내', await said(p, 'emptySearch', await p.locator('#main').innerText()) && await p.locator('#main .jomi-empty').count() === 1 && /expr-empty-360/.test(await p.locator('#main .jomi-empty img').getAttribute('src')));
    await p.goto(BASE + '#concern'); await p.waitForTimeout(300);
    ok('피부 고민 가이드: 궁금한 죠미', /expr-curious-96/.test(await p.locator('#main .msg.bot img').first().getAttribute('src')));
    await p.locator('#main textarea').fill('이마 주름이 신경 쓰여요'); await p.locator('#main textarea').press('Enter'); await p.waitForTimeout(300);
    ok('찾은 정보를 보여줄 때: 생각하는 죠미', /expr-thinking-96/.test(await p.locator('#main .msg.bot img').last().getAttribute('src')));
    await p.goto(BASE + '#guide'); await p.waitForTimeout(300);
    ok('시술 사전: 죠미 한마디', await said(p, 'guideTip', await p.locator('#main .jomi-say').innerText()));
    await ctx.close(); }
  { let fail = true;
    const { ctx, p } = await page({}, async (p) => { await p.route('**/data.json', async (r) => { if (fail) return r.fulfill({ status: 500, body: 'x' }); await new Promise((s) => setTimeout(s, 900)); r.continue(); }); await p.route('**/home.json', (r) => r.fulfill({ status: 404, body: '' })); });   // no home.json: the error screen itself (O2 case: o2_home.js)
    await p.waitForSelector('#main [role=alert]', { timeout: 15000 }).catch(() => {});   // the app tries 3 times (1 s, 3 s apart) before the error screen
    const txt = await p.locator('#main').innerText();
    ok('오류: 무엇이 안 됐는지 + 다시 시도 버튼 (곤란한 표정 대신 시무룩)', /expr-empty-360/.test(await p.locator('#main .jomi-empty img').getAttribute('src') || '') && /불러오지 못했어요/.test(txt) && await said(p, 'error', txt) && await p.locator('#main .btn', { hasText: '다시 시도' }).count() === 1, txt.split('\n').slice(0, 2).join(' / '));
    fail = false; await p.locator('#main .btn', { hasText: '다시 시도' }).click(); await p.waitForTimeout(200);
    ok('다시 시도 중: 졸린 죠미 + 로딩 안내(스크린리더용 status)', (await said(p, 'retrying', await p.locator('#main [role=status]').innerText()) || await said(p, 'loading', await p.locator('#main [role=status]').innerText())) && /expr-sleeping-96/.test(await p.locator('#main [role=status] img').getAttribute('src')));
    await p.waitForSelector('.pc', { timeout: 15000 }).catch(() => {});
    ok('다시 시도 → 정상 화면', await p.locator('.pc').count() > 0 && (await p.locator('#main').getAttribute('aria-busy')) === null);
    await ctx.close(); }
  { const { ctx, p } = await page({ reducedMotion: 'reduce' }, async (p) => { await p.route('**/data.json', async (r) => { await new Promise((s) => setTimeout(s, 1500)); r.continue(); }); await p.route('**/home.json', (r) => r.fulfill({ status: 404, body: '' })); });
    await p.waitForTimeout(300);
    const anim = await p.evaluate(() => { const m = document.querySelector('.jomi-load .mascot'); return m ? getComputedStyle(m).animationName : 'missing'; });
    ok('움직임 줄이기 설정: 죠미 애니메이션 꺼짐', anim === 'none', anim);
    await p.waitForSelector('.pc'); await p.screenshot({ path: `${OUT}/jomi-home.png` });
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
