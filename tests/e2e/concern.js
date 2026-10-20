// '죠미와 대화' (route #concern) in a real browser: the box empties after sending (2026-10-15 report), treatment names and
// prices are understood ('카프리' → its collected prices), follow-ups use the treatment said before, the 6-part concern answer,
// emergency routing, no storage of the typed words, no clinic name in any answer, banned wording, draft-knowledge flag.
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
  const BOX = 'textarea[aria-label="죠미에게 말하기"]';
  const ask = async (p, text) => { await p.fill(BOX, text); await p.click('#main .composer .btn.send'); await p.waitForTimeout(350); };
  const last = (p) => p.locator('#main .chat .msg.bot').last();          // the answer to the message just sent

  { const { ctx, p } = await page();
    await p.locator('#main .entry.e-concern').first().click(); await p.waitForTimeout(300);
    ok('홈에서 들어가기', /#concern$/.test(p.url()), p.url().split('#')[1]);
    const SECRET = '이마랑 미간 주름이 신경 쓰여요 특이문구7429';
    const before = await p.evaluate(() => JSON.stringify(localStorage));
    await ask(p, SECRET);
    ok('보내면 입력칸이 비워짐(보낸 말은 대화에 남음)', (await p.inputValue(BOX)) === '' && (await p.locator('#main .chat .msg.user').last().innerText()).includes('특이문구7429'));
    const card = last(p).locator('.card.concern').first();
    const heads = await card.locator('.csec h4').allTextContents();
    ok('6단계 답변 순서', heads.length === 6 && heads.map((x) => x.slice(0, 2)).join('') === '1.2.3.4.5.6.', heads.join(' / '));
    ok('맞는 고민(표정 주름)', /표정 주름/.test(await card.locator('h3').first().textContent()));
    const text = await last(p).innerText();
    ok('병원 이름·가격이 고민 답에 없음(가격 검색과 분리)', !CLINIC.test(text), (text.match(CLINIC) || [''])[0]);
    ok('금지 표현 없음("가장 적합", "AI 추천 1위" 등)', !BANNED.test(text), (text.match(BANNED) || [''])[0]);
    ok('시술 말고 할 수 있는 관리와 한계·근거·검수 상태 표시', /시술 말고 할 수 있는 관리/.test(text) && /한계:/.test(text) && /근거/.test(text) && /검수 전/.test(text));
    ok('순서가 추천 순위가 아니라고 밝힘', /추천 순서나 효과 순서가 아니에요/.test(text));
    const after = await p.evaluate(() => JSON.stringify(localStorage));
    ok('적은 문장이 저장되지 않음(localStorage·주소)', !after.includes('특이문구7429') && !decodeURIComponent(p.url()).includes('특이문구') && after === before, `url=${p.url().split('#')[1]}`);
    ok('외부로 보내는 요청 없음', !p.requests.length, p.requests.slice(0, 2).join(' '));
    // the user picks a treatment, then the price comparison opens for it
    const priceBtn = card.locator('.csec').nth(5).locator('.chip', { hasText: '주름 보톡스 가격' });
    await priceBtn.click(); await p.waitForTimeout(400);
    const sel = await p.locator('select[aria-label="시술 고르기"] option:checked').textContent();
    ok('직접 고른 시술의 가격 비교로 이동', /#compare\?k=/.test(p.url()) && sel.startsWith('주름 보톡스 · '), sel);
    await p.goBack(); await p.waitForTimeout(300);
    ok('돌아오면 이번 방문의 대화는 그대로, 입력칸은 빈 채로', (await p.inputValue(BOX)) === '' && (await p.locator('#main .chat').innerText()).includes('특이문구7429'));
    // treatment names and prices (the report: '카프리' found nothing)
    await ask(p, '카프리');
    const cap = await last(p).innerText();
    ok("'카프리' → 카프리 레이저와 모은 가격(최저·중간·지점 수)", /카프리 레이저/.test(cap) && /최저\s*[\d,]+원/.test(cap) && /중간\s*[\d,]+원/.test(cap) && /\d+곳/.test(cap), cap.split('\n').slice(0, 3).join(' / '));
    ok('가격 답에도 병원 이름은 없음(지점별 줄은 비교 화면에서)', !/블리비|쁨 |톡스앤필|리엔장|밴스|유앤아이|데이뷰|닥터에버스|셀린/.test(cap));
    await ask(p, '리쥬란 가격');
    await ask(p, '그럼 4cc는?');
    const fu = await last(p).innerText();
    ok("이어 묻기: '리쥬란 가격' 다음 '그럼 4cc는?' → 리쥬란 4cc", /리쥬란/.test(fu) && /4cc/.test(fu) && /최저/.test(fu), fu.split('\n').slice(0, 2).join(' / '));
    await p.fill(BOX, '부가세 포함이야?'); await p.press(BOX, 'Enter'); await p.waitForTimeout(350);
    ok('Enter로 보내기 + 앱 도움말(부가세)', (await p.inputValue(BOX)) === '' && /부가세/.test(await last(p).innerText()) && /설정 열기/.test(await last(p).innerText()));
    await ask(p, '슈링크랑 울쎄라 차이');
    ok('두 시술 비교: 둘 다 나옴', (await last(p).locator('.card.cans').count()) === 2);
    await ask(p, '슈링그 얼마');
    ok("오타 '슈링그' → 혹시 슈링크?", /혹시/.test(await last(p).innerText()) && /슈링크/.test(await last(p).innerText()));
    // emergency → clinician only, no treatment information
    await ask(p, '필러 맞고 나서 피부가 하얗게 변하고 아파요');
    ok('응급 신호: 진료 안내만, 시술 정보 없음', await last(p).locator('.card.calert').count() === 1 && await last(p).locator('.card.concern, .card.cans').count() === 0, await last(p).locator('.card.calert h3').textContent());
    await ask(p, '보톡스 맞고 숨이 막혀요');
    ok("응급 신호('숨이 막혀요'): 가격 대신 진료 안내", await last(p).locator('.card.calert').count() === 1 && await last(p).locator('.card.cans').count() === 0);
    await ask(p, '요즘 죽고 싶어요');
    ok('자해 신호: 상담 전화 109 안내', /109/.test(await last(p).locator('.card.calert').innerText()) && await last(p).locator('.card.concern').count() === 0);
    await ask(p, '점이 점점 커지고 색이 변해요');
    ok('진료 권고 신호: 진료 안내가 먼저, 일반 정보는 아래', await last(p).locator('.card.cwarn').count() === 1 && /점·비립종/.test(await last(p).locator('.card.concern h3').first().textContent()));
    await ask(p, '저한테 맞는 시술 뭐예요? 보톡스 몇 유닛 맞아야 해요? 주름');
    ok('개인 판단 요청: "개인 맞춤 판단은 하지 않아요" 안내', /개인 맞춤 판단은 하지 않아요/.test(await last(p).innerText()));
    await ask(p, '오늘 날씨 어때요');
    ok('관련 없는 말: 모른다고 안내 + 예시', /잘 모르겠어/.test(await last(p).innerText()));
    // chip (concern id only in the URL) and the search page hint
    await p.goto(BASE + '#concern?c=pigment'); await p.waitForTimeout(400);
    ok('고민 칩 주소(#concern?c=pigment): 주소에는 고민 id만, 답은 그 고민', /#concern\?c=pigment$/.test(p.url()) && /기미·잡티·색소/.test(await last(p).locator('.card.concern h3').first().textContent()));
    await p.goto(BASE + '#search/' + encodeURIComponent('기미')); await p.waitForTimeout(500);
    const hint = p.locator('#main .linkbtn', { hasText: '기미·잡티·색소' }); const hasHint = await hint.count() > 0; if (hasHint) { await hint.click(); await p.waitForTimeout(300); }
    ok('검색 화면 → 고민 보기 연결', hasHint && /#concern\?c=pigment$/.test(p.url()));
    await p.goto(BASE + '#concern?c=wrinkle'); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/concern.png`, fullPage: true });
    ok('스크립트 오류 없음', !p.errs.length, p.errs.join(' '));
    await ctx.close(); }

  // flags: drafts hidden (public-launch setting) and the feature switched off
  { const { ctx, p } = await page(['showDraftKnowledge: true', 'showDraftKnowledge: false']);
    await p.goto(BASE + '#concern?c=wrinkle'); await p.waitForTimeout(300);
    ok('검수 전 초안 숨김 설정: 고민 설명·시술 설명이 보이지 않음', await p.locator('.card.concern').count() === 0 && !/초안/.test(await p.locator('#main').innerText()));
    await p.goto(BASE + '#guide'); await p.waitForTimeout(400);
    ok('같은 설정에서 시술 사전의 초안 설명도 숨김', !/초안/.test(await p.locator('#main').innerText()));
    await ctx.close(); }
  { const { ctx, p } = await page(['concernSearch: true', 'concernSearch: false']);
    ok('기능 끔: 홈 입구 없음', await p.locator('#main .entry', { hasText: '피부 고민으로' }).count() === 0);
    await p.goto(BASE + '#concern'); await p.waitForTimeout(300);
    ok('기능 끔: 화면은 꺼짐 안내', /꺼져 있어요/.test(await p.locator('#main').innerText()));
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
