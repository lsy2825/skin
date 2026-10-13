// '피부 고민으로 찾기' in a real browser: the 6-part answer, emergency routing, no storage of the typed words, no clinic
// or price on the concern page, banned wording, user-selected price link, draft-knowledge flag.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/concern.js [out-dir]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const BANNED = /가장 적합|추천 1위|AI 추천|맞춤 추천|최고의 시술|효과를 보장|보장합니다|보장해요|당신에게 맞는/;
const CLINIC = /블리비|쁨 |톡스앤필|리엔장|\d{1,3}(,\d{3})+원/;

(async () => { const OUT = process.argv[2] || require('os').tmpdir(); const b = await chromium.launch();
  const page = async (cfg) => { const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    p.requests = []; p.on('request', (r) => { if (!r.url().startsWith(BASE)) p.requests.push(r.url()); });
    if (cfg) await p.route('**/config.js', async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace(cfg[0], cfg[1]) }); });
    await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    return { ctx, p }; };
  const ask = async (p, text) => { await p.fill('textarea[aria-label="피부 고민 적기"]', text); await p.click('#main .btn:has-text("찾기")'); await p.waitForTimeout(300); };

  { const { ctx, p } = await page();
    await p.locator('#main .linkbtn', { hasText: '피부 고민으로 찾기' }).click(); await p.waitForTimeout(300);
    ok('홈에서 들어가기', /#concern$/.test(p.url()), p.url().split('#')[1]);
    const SECRET = '이마랑 미간 주름이 신경 쓰여요 특이문구7429';
    const before = await p.evaluate(() => JSON.stringify(localStorage));
    await ask(p, SECRET);
    const card = p.locator('.card.concern').first();
    const heads = await card.locator('.csec h4').allTextContents();
    ok('6단계 답변 순서', heads.length === 6 && heads.map((x) => x.slice(0, 2)).join('') === '1.2.3.4.5.6.', heads.join(' / '));
    ok('맞는 고민(표정 주름)', /표정 주름/.test(await card.locator('h3').first().textContent()));
    const text = await p.locator('#main').innerText();
    ok('병원 이름·가격이 고민 화면에 없음(가격 검색과 분리)', !CLINIC.test(text), (text.match(CLINIC) || [''])[0]);
    ok('금지 표현 없음("가장 적합", "AI 추천 1위" 등)', !BANNED.test(text), (text.match(BANNED) || [''])[0]);
    ok('시술 말고 할 수 있는 관리와 한계·근거·검수 상태 표시', /시술 말고 할 수 있는 관리/.test(text) && /한계:/.test(text) && /근거/.test(text) && /검수 전/.test(text));
    ok('순서가 추천 순위가 아니라고 밝힘', /추천 순위나 효과 순위가 아니에요/.test(text));
    const after = await p.evaluate(() => JSON.stringify(localStorage));
    ok('적은 문장이 저장되지 않음(localStorage·주소)', !after.includes('특이문구7429') && !decodeURIComponent(p.url()).includes('특이문구') && after === before, `url=${p.url().split('#')[1]}`);
    ok('외부로 보내는 요청 없음', !p.requests.length, p.requests.slice(0, 2).join(' '));
    // the user picks a treatment, then the price comparison opens for it
    const priceBtn = card.locator('.csec').nth(5).locator('.chip', { hasText: '주름 보톡스 가격' });
    await priceBtn.click(); await p.waitForTimeout(400);
    const sel = await p.locator('select[aria-label="시술 고르기"] option:checked').textContent();
    ok('직접 고른 시술의 가격 비교로 이동', /#compare\?k=/.test(p.url()) && sel.startsWith('주름 보톡스 · '), sel);
    await p.goBack(); await p.waitForTimeout(300);
    ok('돌아오면 메모리 속 문장은 이번 방문 동안만 유지', (await p.inputValue('textarea[aria-label="피부 고민 적기"]')) === SECRET);
    // emergency → clinician only, no treatment information
    await ask(p, '필러 맞고 나서 피부가 하얗게 변하고 아파요');
    ok('응급 신호: 진료 안내만, 시술 정보 없음', await p.locator('.card.calert').count() === 1 && await p.locator('.card.concern').count() === 0, await p.locator('.card.calert h3').textContent());
    await ask(p, '요즘 죽고 싶어요');
    ok('자해 신호: 상담 전화 109 안내', /109/.test(await p.locator('.card.calert').innerText()) && await p.locator('.card.concern').count() === 0);
    await ask(p, '점이 점점 커지고 색이 변해요');
    ok('진료 권고 신호: 진료 안내가 먼저, 일반 정보는 아래', await p.locator('.card.cwarn').count() === 1 && /점·비립종/.test(await p.locator('.card.concern h3').first().textContent()));
    await ask(p, '저한테 맞는 시술 뭐예요? 보톡스 몇 유닛 맞아야 해요? 주름');
    ok('개인 판단 요청: "개인 맞춤 판단은 하지 않아요" 안내', /개인 맞춤 판단은 하지 않아요/.test(await p.locator('#main').innerText()));
    await ask(p, '오늘 날씨 어때요');
    ok('관련 없는 말: 찾지 못했다고 안내', /찾지 못했어요/.test(await p.locator('#main').innerText()));
    // chip (concern id only in the URL) and the search page hint
    await p.locator('#main .chip', { hasText: '기미·잡티·색소' }).click(); await p.waitForTimeout(300);
    ok('고민 칩: 주소에는 고민 id만', /#concern\?c=pigment$/.test(p.url()) && /기미·잡티·색소/.test(await p.locator('.card.concern h3').first().textContent()));
    await p.goto(BASE + '#search/' + encodeURIComponent('기미')); await p.waitForTimeout(500);
    const hint = p.locator('#main .linkbtn', { hasText: '기미·잡티·색소' }); const hasHint = await hint.count() > 0; if (hasHint) { await hint.click(); await p.waitForTimeout(300); }
    ok('검색 화면 → 고민 보기 연결', hasHint && /#concern\?c=pigment$/.test(p.url()));
    await p.goto(BASE + '#concern?c=wrinkle'); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/concern.png`, fullPage: true });
    ok('스크립트 오류 없음', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }

  // flags: drafts hidden (public-launch setting) and the feature switched off
  { const { ctx, p } = await page(['showDraftKnowledge: true', 'showDraftKnowledge: false']);
    await p.goto(BASE + '#concern?c=wrinkle'); await p.waitForTimeout(300);
    ok('검수 전 초안 숨김 설정: 고민·시술 설명이 보이지 않음', await p.locator('.card.concern').count() === 0 && await p.locator('#main .chips .chip').count() === 0);
    await p.goto(BASE + '#guide'); await p.waitForTimeout(400);
    ok('같은 설정에서 시술 사전의 초안 설명도 숨김', !/초안/.test(await p.locator('#main').innerText()));
    await ctx.close(); }
  { const { ctx, p } = await page(['concernSearch: true', 'concernSearch: false']);
    ok('기능 끔: 홈 입구 없음', await p.locator('#main .linkbtn', { hasText: '피부 고민으로 찾기' }).count() === 0);
    await p.goto(BASE + '#concern'); await p.waitForTimeout(300);
    ok('기능 끔: 화면은 꺼짐 안내', /꺼져 있어요/.test(await p.locator('#main').innerText()));
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
