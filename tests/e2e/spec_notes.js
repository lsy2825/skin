// 규격 낱말 뜻 (data.json meta.kb.specs, chat C's C7) in a real browser at 320 px: on the compare screen the chosen spec's
// words ('국산', '사각턱' …) get one plain line each under '규격 바꾸기', and the '같은 시술로' choice of the add sheet shows the
// same lines. Not medically reviewed lines say '의료진 검수 전' and go away when flags.showDraftKnowledge is off.
// Data without meta.kb.specs (before C7): nothing new on screen.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/spec_notes.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };

(async () => { const b = await chromium.launch();
  const open = async (drafts) => {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 320, height: 720 } }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    if (!drafts) await p.route(/config\.js(\?|$)/, async (r) => { const res = await r.fetch(); const body = (await res.text()).replace(/showDraftKnowledge:\s*true/, 'showDraftKnowledge: false');
      await r.fulfill({ response: res, body }); });
    await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    return { ctx, p, errs };
  };
  const { ctx, p, errs } = await open(true);
  await p.goto(BASE + '#compare?k=X01'); await p.waitForTimeout(700);   // 국산 사각턱 보톡스 50U (보톡스 family 'toxin')
  await p.waitForFunction(() => window.App.data() && !window.App.data().meta.partial, null, { timeout: 60000 });   // the full file, not home.json
  const specs = await p.evaluate(() => ((window.App.data().meta.kb || {}).specs || []));
  const NEW = specs.length > 0, line = (w) => specs.find((e) => e.fid === 'toxin' && e.spec === w);
  console.log(`# data: ${NEW ? `meta.kb.specs ${specs.length}개` : 'meta.kb.specs 없음(예전 자료)'}`);
  ok('비교 화면과 규격 바꾸기가 그려짐', await p.locator('#cmppick .vsteps').count() === 1);
  const box = p.locator('#cmppick .specnotes');
  if (!NEW) {
    ok('예전 자료: 규격 낱말 설명이 없음', await p.locator('.specnotes').count() === 0);
    await p.locator('#cmppick .vstep .vchip', { hasText: /^미국산$/ }).first().click(); await p.waitForTimeout(500);
    ok('예전 자료: 규격을 바꿔도 설명 없음', await p.locator('.specnotes').count() === 0 && !/k=X01\b/.test(await p.evaluate(() => location.hash)));
    await p.evaluate(() => { location.hash = '#compare?k=X03'; }); await p.waitForTimeout(700);
    ok("예전 자료: '스킨보톡스'도 설명 없음", await p.locator('#cmppick .vsteps').count() === 1 && await p.locator('.specnotes').count() === 0);
  } else {
    const kr = line('국산');
    ok("자료에 보톡스 › '국산' 설명이 있음", !!kr, kr ? kr.one_liner : '');
    const txt = (await box.count()) === 1 ? await box.innerText() : '';
    ok("'국산' 한 줄 설명이 규격 고르는 곳에 보임", !!kr && txt.includes(kr.one_liner), txt.replace(/\n/g, ' / ').slice(0, 120));
    ok("검수 전 설명엔 '의료진 검수 전' 표시", !!kr && (kr.review.status === 'approved' || /의료진 검수 전/.test(txt)));
    ok("시술 이름의 낱말('사각턱')도 함께, 3줄까지", (!line('사각턱') || txt.includes(line('사각턱').one_liner)) && await box.locator('li').count() <= 3, `${await box.locator('li').count()}줄`);
    ok('규격 단계 바로 아래에 있음', await p.evaluate(() => { const s = document.querySelector('#cmppick .vsteps'); return !!s && !!s.nextElementSibling && s.nextElementSibling.classList.contains('specnotes'); }));
    ok('글자는 텍스트로만(낱말 b·표시 span 말고 다른 태그 없음)', await box.evaluate((e) => [...e.querySelectorAll('li *')].every((x) => x.tagName === 'B' || x.tagName === 'SPAN')));
    const fs = await box.evaluate((e) => Math.min(...[...e.querySelectorAll('li, .tiny, .k')].map((x) => parseFloat(getComputedStyle(x).fontSize))));
    ok('글자 13px 이상', fs >= 13, `${fs}px`);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), inner = await box.evaluate((e) => e.scrollWidth - e.clientWidth);
    ok('320px에서 넘치지 않음', wide <= 0 && inner <= 1, `page ${wide}px · box ${inner}px`);
    // another spec: the lines follow the chosen spec
    await p.locator('#cmppick .vstep .vchip', { hasText: /^미국산$/ }).first().click(); await p.waitForTimeout(600);
    const us = line('미국산'), t2 = (await box.count()) ? await box.innerText() : '';
    ok("규격을 '미국산'으로 바꾸면 그 설명으로 바뀜", !!us && t2.includes(us.one_liner) && !t2.includes(kr.one_liner), t2.replace(/\n/g, ' / ').slice(0, 100));
    await p.locator('#cmppick .modesw button', { hasText: '자세히' }).click(); await p.waitForTimeout(400);
    ok("'자세히' 보기에서도 보임", await box.count() === 1 && (await box.innerText()).includes(us.one_liner));
    await p.locator('#cmppick .modesw button', { hasText: '쉬운 보기' }).click(); await p.waitForTimeout(300);
    // '스킨보톡스': the word '스킨' is glued to the base name (Spec.famWords), not a separate word
    await p.evaluate(() => { location.hash = '#compare?k=X03'; }); await p.waitForTimeout(700);   // 국산 얼굴전체 스킨보톡스
    const sk = line('스킨'), t5 = (await box.count()) ? await box.innerText() : '';
    ok("'스킨보톡스'엔 '스킨' 설명도 보임", !!sk && t5.includes(sk.one_liner) && t5.includes(kr.one_liner), t5.replace(/\n/g, ' / ').slice(0, 120));
  }
  // '같은 시술로' in the add sheet of a price row
  await p.evaluate(() => { location.hash = `#search/${encodeURIComponent('국산 사각턱')}?nl=0`; }); await p.waitForTimeout(900);
  let picked = '';
  for (let n = 0; n < 6 && !picked; n++) {
    const add = p.locator('#main .addbtn').nth(n); if (!(await add.count())) break;
    await add.click(); await p.waitForTimeout(300);
    const opt = p.locator('.sheet .opt', { hasText: /같은 시술로: .*국산.*보톡스/ }).first();
    if (await opt.count()) {
      ok("담기 창: 처음('이 옵션 그대로')엔 낱말 설명 없음", await p.locator('.sheet .specnotes').count() === 0);
      picked = (await opt.locator('b').innerText()).trim(); await opt.click(); await p.waitForTimeout(300);
    } else { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
  }
  ok("담기 창에 '같은 시술로: 국산 … 보톡스'가 있음", !!picked, picked);
  if (NEW) { const t3 = (await p.locator('.sheet .specnotes').count()) ? await p.locator('.sheet .specnotes').innerText() : '';
    ok("'같은 시술로'를 고르면 그 규격의 낱말 설명이 보임", t3.includes(line('국산').one_liner) && /의료진 검수 전/.test(t3), t3.replace(/\n/g, ' / ').slice(0, 100));
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok('담기 창도 320px에서 넘치지 않음', wide <= 0, `${wide}px`);
  } else ok("예전 자료: '같은 시술로'를 골라도 설명 없음", await p.locator('.specnotes').count() === 0);
  ok('스크립트 오류 없음', !errs.length, errs.join(' '));
  await ctx.close();
  // flags.showDraftKnowledge off: drafts are not shown at all; reviewed lines would show without the mark
  const q = await open(false);
  await q.p.goto(BASE + '#compare?k=X01'); await q.p.waitForTimeout(700);
  await q.p.waitForFunction(() => window.App.data() && !window.App.data().meta.partial, null, { timeout: 60000 });
  ok('초안 숨김 설정이 적용됨(config.js flags)', await q.p.evaluate(() => window.APP_CONFIG.flags.showDraftKnowledge === false));
  const t4 = (await q.p.locator('#cmppick .specnotes').count()) ? await q.p.locator('#cmppick .specnotes').innerText() : '';
  const anyOk = specs.some((e) => e.fid === 'toxin' && (e.review || {}).status === 'approved');
  ok('초안 숨김 설정: 검수 전 설명은 안 보임', !/의료진 검수 전/.test(t4) && (anyOk || t4 === ''), t4.slice(0, 80));
  ok('초안 숨김 설정: 화면은 그대로 그려짐', await q.p.locator('#cmppick .vsteps').count() === 1 && !q.errs.length, q.errs.join(' '));
  await q.ctx.close();
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
