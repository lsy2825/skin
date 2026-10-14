// round-2 O2 in a real browser: on a first visit the home screen is drawn from home.json while data.json is still on its
// way (held here), with the same numbers the full file then gives — default settings and another region + VAT basis,
// every category tab; other screens wait and open once data.json arrives; a search typed meanwhile is carried out after it;
// a home.json whose checksum does not match the meta is not used.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/o2_home.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'); const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };

// what the home screen says in numbers: the cards of every tab, 오늘의 발견, 가격 변동 (the greeting and personal chips aside)
async function homeNumbers(p) {
  const out = {};
  // the category row (starts with '인기'); the '이어서 보기' chips that appear after the full file are left alone
  const chips = p.locator('.view > .chips', { has: p.locator('button.chip', { hasText: /^인기$/ }) }).locator('.chip');
  const n = await chips.count();
  for (let i = 0; i < n; i++) {
    await chips.nth(i).click(); await p.waitForTimeout(150);
    out[`tab:${(await chips.nth(i).innerText()).trim()}`] = await p.locator('div.grid').innerText();
  }
  await chips.nth(0).click(); await p.waitForTimeout(150);
  out.finds = await p.locator('.disc-row').allInnerTexts();
  out.all = await p.locator('.btn.line.block').first().innerText();
  out.lede = await p.locator('.lede').innerText();
  return out;
}
const diff = (a, b) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

async function firstVisit(b, { prefs = {}, breakHome = false } = {}) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let release; const held = new Promise((r) => { release = r; });
  await p.route(/\/data\.json/, async (r) => { await held; await r.continue(); });
  if (breakHome) await p.route(/\/home\.json/, async (r) => { const res = await r.fetch(); const t = (await res.text()).replace('"rows":', '"rows": '); await r.fulfill({ response: res, body: t }); });
  await p.goto(BASE);
  await p.evaluate(async (pr) => { localStorage.clear(); for (const k of await caches.keys()) await caches.delete(k); for (const [k, v] of Object.entries(pr)) localStorage.setItem(`pc:${k}`, JSON.stringify(v)); }, prefs);
  await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  return { ctx, p, errs, release };
}

(async () => {
  const b = await chromium.launch();

  // 1) default settings: home from home.json, then the same numbers from data.json
  { const { ctx, p, errs, release } = await firstVisit(b);
    const shown = await p.waitForSelector('.pc', { timeout: 20000 }).then(() => true).catch(() => false);
    ok('data.json을 붙잡아 둔 동안 홈 가격 카드가 보임', shown);
    ok('홈 요약으로 그린 상태(partial)', await p.evaluate(() => window.App.Data.SYNC.partial === true));
    ok('머리말에 전체 가격 받는 중 표시(알림 줄은 숨김 — 화면 밀림 없음)', /전체 가격을 받는 중/.test(await p.locator('#upd').innerText()) && await p.locator('#netbar').isHidden());
    const before = await homeNumbers(p);
    ok('시술 전체 개수는 전체 파일 기준', /시술 5,?\d{3}개 전체 비교/.test(before.all), before.all);
    // a card → compare waits for the full file
    await p.locator('.pc').first().click(); await p.waitForTimeout(300);
    ok('다른 화면은 전체 가격을 기다림', /전체 가격을 받는 중/.test(await p.locator('#main').innerText()));
    release();
    const opened = await p.waitForFunction(() => location.hash.startsWith('#compare') && !document.querySelector('#load-msg') && window.App.Data.SYNC.have, null, { timeout: 60000 }).then(() => true).catch(() => false);
    await p.waitForTimeout(500);
    ok('전체 가격이 오면 기다리던 비교 화면이 열림', opened && !/전체 가격을 받는 중/.test(await p.locator('#main').innerText()));
    await p.evaluate(() => { location.hash = '#home'; }); await p.waitForSelector('.pc'); await p.waitForTimeout(300);
    ok('전체 파일로 바뀐 뒤 partial 아님', await p.evaluate(() => window.App.Data.SYNC.partial === false && !window.App.data().meta.partial));
    const after = await homeNumbers(p);
    const d = diff(before, after);
    ok(`홈 숫자가 전체 파일과 같음 (탭 ${Object.keys(before).filter((k) => k.startsWith('tab:')).length}개·발견·개수·범위)`, !d.length, d.map((k) => `${k}: ${String(before[k]).slice(0, 60)} ≠ ${String(after[k]).slice(0, 60)}`).join(' / '));
    ok('머리말이 날짜·지점 수로 돌아옴', /기준 · \d+곳/.test(await p.locator('#upd').innerText()), await p.locator('#upd').innerText());
    ok('페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // 2) another region (전국) and the VAT-included basis: still the same numbers as the full file
  { const { ctx, p, errs, release } = await firstVisit(b, { prefs: { region: '', vat: 'incl' } });
    await p.waitForSelector('.pc', { timeout: 20000 });
    const partialNow = await p.evaluate(() => window.App.Data.SYNC.partial === true);
    const before = await homeNumbers(p);
    release();
    await p.waitForFunction(() => window.App.Data.SYNC.have, null, { timeout: 60000 }); await p.waitForTimeout(500);
    const after = await homeNumbers(p);
    const d = diff(before, after);
    ok('전국·부가세 포함 설정에서도 홈 숫자가 같음', partialNow && !d.length, d.join(', '));
    ok('페이지 오류 없음(설정 바꾼 경우)', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // 3) a search typed on 홈 before the full file: carried out once it arrives
  { const { ctx, p, errs, release } = await firstVisit(b);
    await p.waitForSelector('.pc', { timeout: 20000 });
    await p.fill('.hsearch input', '리쥬란 2cc'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    ok('검색은 전체 가격을 기다림', /전체 가격을 받는 중/.test(await p.locator('#main').innerText()));
    release();
    const went = await p.waitForFunction(() => /^#search\//.test(location.hash), null, { timeout: 60000 }).then(() => true).catch(() => false);
    ok('전체 가격이 오면 검색 결과로 이동', went, await p.evaluate(() => location.hash));
    ok('페이지 오류 없음(검색)', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // 4) home.json changed in transit (checksum ≠ meta): not used, the app waits for data.json as before
  { const { ctx, p, errs, release } = await firstVisit(b, { breakHome: true });
    await p.waitForTimeout(2500);
    const early = await p.locator('.pc').count();
    release();
    await p.waitForSelector('.pc', { timeout: 60000 });
    ok('체크섬이 다른 홈 요약은 쓰지 않음', early === 0 && await p.evaluate(() => !window.App.data().meta.partial && window.App.Data.SYNC.have));
    ok('페이지 오류 없음(깨진 요약)', !errs.length, errs.join(' | '));
    await ctx.close(); }

  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`TOTAL ${pass}/${R.length} PASS`);
  process.exit(pass === R.length ? 0 : 1);
})();
