// 내 견적: once prices vs visit day/time prices (B, 2026-10-16 — the user: ask whether the person had the treatment before,
// and when they will visit). Pricing.condClass: 체험가·한정가·첫 방문·1인 1회·타임세일 are once (first session only, never × q —
// round-2 R14), '평일 낮'·'시간대'·'일요일' and the site's days / hours with no tag are repeat (every session that fits the visit).
//  A. a repeat-only price ×3 = 3 × price, no '가격 없음', the line says '방문일·시간 조건이 맞을 때 매번 이 가격'; with no visit date
//     the summary asks for one ('방문일 정하기' opens the visit sheet), with one the line asks no more and the date filters the price
//  B. once prices as before: once + 2 × regular; a once-only price ×3 is no total; no visit prompt without a repeat price
//  C. the item switch '전에 이 시술을 받아 봤어요': on → the once price is not used (3 × the next price), it survives a reload, off → back;
//     the quote line and '견적 복사' name the later sessions' price ('2회째부터 …') and keep '1회 가격 … 첫 1회만'
//  D. a once price picked for the branch (it.ov, '같은 시술로' in the add sheet) ×3 is still once: once + 2 × the next price
//  E. a visit time the later sessions' price can't be checked at (state 2 on the second row only): '시간 확인 필요' and the warning
//  F. a visit after the event's end date: a repeat price is not repeated (first session only), '기간 확인 필요' and a warning
//  G. a revisit price (C #111: '★재방문 이벤트★ …', '[재진] …', Pricing.isRevisit — condClass "revisit") follows the clinic's
//     '이 병원에 다녀왔어요' (user decision 2026-10-19: this phone's list of clinics, pc:visited), not the item's '전에 이 시술을
//     받아 봤어요'. Off → not used (3 × the regular price, the option can't be picked; the switch above the clinic's quote says
//     what turning it on does); on → the first session only (revisit + 2 × regular), '재방문만' badge, a warning and the copy say
//     so, it is stored and survives a reload, a shared link carries neither it nor a total using it. it.done alone lets no revisit
//     price in, and with the clinic on does not take it out. 특가 빼기 with it on: no revisit price, no switch. Picked for the
//     branch by hand (it.ov): off → left out and not a changed option; on → once. At a clinic marked visited its '첫 방문' prices
//     are left out (a key with a first-visit price, and a name only that clinic sells at a first-visit price). The branch page's
//     head has the switch where the branch has a revisit price (and 특가 포함 is on), and at a branch marked visited. A '[재진]' name
//     with nothing but revisit prices: no price, its switch on the item, then its price (×2: the switch stays, the words say the
//     2nd session has no price); its price sheet and the legend say how the cart counts it. Review 2026-10-19: the switch's name
//     has the clinic, it is 44px tall; a clinic whose every price of the cart is a first-visit one leaves the comparison when
//     marked — the item line keeps its switch (under the finger, a toast with undo), the branch page too; one that moves to the
//     other list keeps its switch where it was and only then opens '일부만 되는 곳'; a line it emptied and the warnings / copy
//     say why; the 내 견적 합계 alert does not go off for it; a shared link has no revisit pick and the receiver who marked the
//     same clinic sees the same total; the 병원 패키지 tab follows the same rule. The other cases leave out ids / branches with
//     a revisit row.
//  H. the home's note: '체험가·한정가는 보통 1인 1회예요'
// Every case is picked from the data.json the app was served; a case the file has no rows for prints SKIP — but a file with the
// days / hours fields that skips A, C or E, or a run that skips every case, fails.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/cart_repeat.js
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const asRows = require('./rows');
const P = require(path.join(__dirname, '../../app/domain/pricing.js'));
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 240)}`); };
const SK = []; const skip = (name, why) => { SK.push(name); console.log(`SKIP | ${name} | ${why}`); };
const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const bit = (dow) => 1 << ((dow + 6) % 7);   // data.json days bits: 월=1 … 일=64 (JS getDay: 일=0)
const nextDay = (dow) => { const d = new Date(); for (let i = 1; i < 15; i++) { d.setDate(d.getDate() + 1); if (d.getDay() === dow && !P.KR_HOLIDAYS[ymd(d)]) return ymd(d); } return null; };
const REPEAT_TXT = '방문일·시간 조건이 맞을 때 매번 이 가격', LATER = '1회 가격(체험가·첫 방문가 등)은 첫 1회만', ASK = '방문일을 정하면 그 요일·시간에 되는 가격만 계산해요', DONE = '전에 이 시술을 받아 봤어요';
const VISIT = '이 병원에 다녀왔어요', RV_DO = '재방문 가격은 넣고(첫 1회만)', FV_DO = '첫 방문가는 빼고', ONCE_ON = '체험가·첫 방문가 같은 1회 가격은 빼고 계산해요';
const VIS_GONE = '다녀온 병원이라 첫 방문가를 뺐어요', FV_WARN = (n) => `첫 방문가 ${n}개 — '이 병원에 다녀왔어요'를 켠 병원이라 빼고 계산했어요`;
const RV_WARN = '재방문 가격 1개 — 그 병원에 다시 오는 손님만 받는 가격이에요(\'이 병원에 다녀왔어요\'를 켠 병원에서만 계산해요)', RV_CART = '내 견적은 \'이 병원에 다녀왔어요\'를 켠 병원에서만 계산해요';

(async () => {
  const D = asRows(await (await fetch(BASE + 'data.json')).json()), S = D.s, td = ymd(new Date());
  const WHEN = P.hasWhenFields(D);
  const days = (r) => (WHEN ? r[16] || 0 : 0), hours = (r) => (WHEN ? S[r[17]] || '' : '');
  const cls = (r) => P.condClass(r[5], S[r[6]], days(r), hours(r), S[r[2]]);
  const noRv = (xs) => !xs.some((x) => cls(x.r) === 'revisit');   // cases A–F: no revisit price in the way (case G has them)
  const price = (r) => P.vatPrice(r[3], r[12], 'incl');          // the app's default basis: VAT 포함 예상가
  const live = (r) => !r[13] && !P.isExpired(S[r[10]] || '', td);
  const bname = (b) => `${D.meta.brands[D.branches[b][0]][0]} ${S[D.branches[b][1]]}`;
  const bkey = (b) => `${D.meta.brands[D.branches[b][0]][0]}|${S[D.branches[b][1]]}`;
  const all = D.rows.map((r, i) => ({ r, i })).filter(({ r }) => live(r));
  const low = (xs) => xs.reduce((a, x) => (!a || price(x.r) < price(a.r) ? x : a), null);
  // name items: one name sold at one branch only, so the cart has one clinic and its total is the summary's number
  const byName = new Map(); for (const x of all) { if (!byName.has(x.r[2])) byName.set(x.r[2], []); byName.get(x.r[2]).push(x); }
  const names = [...byName.values()].filter((xs) => new Set(xs.map((x) => x.r[0])).size === 1);
  // key items: rows of a comparison id at a branch (byKB in the app)
  const byKB = new Map(); for (const x of all) for (const k of (S[x.r[7]] || '').split(' ').filter(Boolean)) { const key = `${k}|${x.r[0]}`; if (!byKB.has(key)) byKB.set(key, []); byKB.get(key).push(x); }
  console.log(`data: ${D.rows.length} rows · days/hours fields ${WHEN ? 'yes' : 'no'}`);

  const br = await chromium.launch();
  const ctx = await br.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  // press what should be there; a missing control is one FAIL, not a timeout that stops every case after it
  const tap = async (loc, name) => { if (await loc.count()) { await loc.first().click(); return true; } ok(`${name} (누를 곳 없음)`, false); return false; };
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE);
  // a fresh phone with one cart; extra = other saved settings (region '' = 전국, brands = brand indices)
  const seed = async (items, extra = {}) => {
    await p.evaluate(([items, extra]) => { localStorage.clear(); localStorage.setItem('pc:carts', JSON.stringify([{ id: 'rpt', name: '시험 견적', items }]));
      localStorage.setItem('pc:ci', '0'); localStorage.setItem('pc:region', JSON.stringify('')); for (const [k, v] of Object.entries(extra)) localStorage.setItem('pc:' + k, JSON.stringify(v)); }, [items, extra]);
    await openCart();
  };
  const openCart = async () => {
    await p.goto(BASE + '#cart'); await p.reload();
    if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
    await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    await p.waitForSelector('#main .cart-items'); await p.waitForTimeout(300);
  };
  const text = (sel) => p.locator(sel).first().innerText().catch(() => '');
  const mainTxt = () => p.locator('#main').innerText();
  // the clinic comparison, then the quote of branch b opened: its line texts [{total, m, more, all}] — m: the line's words in view
  // (conditions, how the total was made, '2회째부터' + the later price's badges, the repeat words), more: the names its '자세히'
  // folds (the clinic's product name, '2회째부터 <the later price's name>'; the option picker's list left out — hierarchy audit 48),
  // all: both (what the line said before the fold)
  const quote = async (b) => {
    if ((await p.locator('.cartsum button[aria-expanded="false"]').count())) { await p.locator('.cartsum button[aria-expanded="false"]').click(); await p.waitForTimeout(400); }
    // the clinic list shows 40 and then '20곳 더 보기' (2026-10-16 hierarchy audit 8): tap it until the branch is listed
    const find = () => p.$$eval('li.qrow', (lis, nm) => lis.findIndex((li) => { const s = li.querySelector('.rank .b span:last-child'); return s && s.textContent === nm; }), bname(b));
    let n = await find();
    for (let k = 0; n < 0 && k < 30 && await p.locator('#main .card.flush .morelist', { hasText: '곳 더 보기' }).count(); k++) {
      await p.locator('#main .card.flush .morelist', { hasText: '곳 더 보기' }).first().click(); await p.waitForTimeout(300); n = await find(); }
    if (n < 0) return null;
    const li = p.locator('li.qrow').nth(n);
    if (!(await li.locator('.qbody').count())) { await li.locator('button.rank').click(); await p.waitForTimeout(300); }
    const at = p.locator('li.qrow').nth(n);
    return at.evaluate((x) => ({ lines: [...x.querySelectorAll('.qline')].map((q) => { const m = q.querySelector('.m'), c = m ? m.cloneNode(true) : null; if (c) c.querySelectorAll('.qmore').forEach((d) => d.remove());
      const f = q.querySelector('.qmore .qmd'), fc = f ? f.cloneNode(true) : null; if (fc) fc.querySelectorAll('select').forEach((s) => s.remove());
      const vis = c ? c.textContent : '', more = fc ? fc.textContent : '';
      return { total: (q.querySelector('.row b.num') || {}).textContent || '', m: vis, more, all: vis + more }; }),
      warns: [...x.querySelectorAll('.warns li')].map((w) => w.textContent) }));
  };
  // '견적 복사' of the quote opened by quote(b): the text it put on the clipboard
  const copied = async (b) => {
    const n = await p.$$eval('li.qrow', (lis, nm) => lis.findIndex((li) => { const s = li.querySelector('.rank .b span:last-child'); return s && s.textContent === nm; }), bname(b));
    if (n < 0 || !(await tap(p.locator('li.qrow').nth(n).locator('button', { hasText: '견적 복사' }), '견적 복사'))) return '';
    await p.waitForTimeout(300); return p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  };
  const where = (b) => ({ region: S[D.branches[b][5]] || '', brands: [D.branches[b][0]], nbrands: D.meta.brands.length });

  // ---- A. a repeat-only price (prefer an untagged '토요일만' row, then any untagged day row, then '평일 낮' without a once tag)
  const repOnly = names.filter((xs) => xs.every((x) => cls(x.r) === 'repeat'));
  const untag = (xs) => xs.every((x) => !S[x.r[6]]);
  const A = repOnly.find((xs) => untag(xs) && xs.every((x) => days(x.r) === 32 && !hours(x.r)))
    || repOnly.find((xs) => untag(xs) && xs.every((x) => days(x.r) && !hours(x.r)))
    || repOnly.find((xs) => xs.every((x) => S[x.r[6]] === '평일 낮' && !hours(x.r)));
  if (!A) skip('A', '요일·시간 조건만 있는 가격 ×3 — 이 자료엔 없음');
  else {
    const x = low(A), r = x.r, b = r[0], n = S[r[2]], pr = price(r);
    console.log(`A: ${n} @ ${bname(b)} · ${S[r[6]] || '태그 없음'} · days ${days(r)} · ${won(pr)}`);
    await seed([{ t: 'r', n, br: bkey(b), p: pr, q: 3, ov: {} }]);
    const hero = await text('.cartsum .hp');
    ok('A1 요일·시간 조건 가격 ×3 = 3 × 가격(합계)', hero.replace(/\s+/g, '') === won(pr * 3), `${hero} · 기대 ${won(pr * 3)}`);
    ok('A2 담은 시술 줄 가격도 3 × 가격', (await text('.ci .cp')).includes(won(pr * 3)), await text('.ci .cp'));
    ok('A3 \'가격 없음\'·\'~?\'가 없음(2회째부터 빠지지 않음)', !/가격 없음|~\?/.test(await mainTxt()));
    ok('A4 이 시술엔 \'전에 이 시술을 받아 봤어요\'가 없음(1회 가격이 없어 바뀌는 게 없음)', (await p.locator('.ci .cdone').count()) === 0);
    const ask = p.locator('.cartsum .whenask');
    ok(`A5 방문일이 없으면 요약에 한 줄: '${ASK}' + '방문일 정하기'`, (await ask.count()) === 1 && (await ask.innerText()).includes(ASK)
      && (await ask.locator('button', { hasText: '방문일 정하기' }).count()) === 1, (await ask.count()) ? await ask.innerText() : '(없음)');
    const q = await quote(b);
    const ln = q && q.lines[0];
    ok('A6 견적 줄: 3 × 가격, \'방문일·시간 조건이 맞을 때 매번 이 가격\'', !!ln && ln.total === won(pr * 3) && ln.m.includes(REPEAT_TXT) && ln.m.includes(`× 3`), ln ? `${ln.total} | ${ln.m}` : '(견적 없음)');
    ok('A7 견적 경고에 \'2회째부터 가격이 없어\' 없음', !!q && !q.warns.some((w) => w.includes('2회째부터 가격이 없어')), q ? q.warns.join(' / ') : '');
    // the visit date: a day the price is for (its days bits; '평일 낮' with no days: a weekday), then one no row of the name is for
    const d = days(r) || 31, any = A.reduce((m, y) => m | (days(y.r) || 31), 0);
    const on = [1, 2, 3, 4, 5, 6, 0].map((w) => (d & bit(w) ? nextDay(w) : null)).find(Boolean);
    const off = [1, 2, 3, 4, 5, 6, 0].map((w) => (any & bit(w) ? null : nextDay(w))).find(Boolean);
    const visit = async (date) => {
      await p.goto(BASE + '#cart'); await p.waitForTimeout(400);
      const btn = p.locator('.cartsum .whenask button');
      if (await btn.count()) await btn.click();
      else { const adv = p.locator('#main details.advset'); if (!(await adv.evaluate((e) => e.open))) await adv.locator('summary').click(); await adv.locator('button.chip', { hasText: '방문' }).click(); }
      const sh = p.locator('.sheet[aria-label="언제 갈 거예요?"]'); await sh.waitFor();
      await sh.locator('input[type="date"]').fill(date); await sh.locator('select[aria-label="방문 시간"]').selectOption(''); await p.waitForTimeout(100);
      await sh.locator('button', { hasText: '적용' }).click(); await p.waitForTimeout(500);
    };
    // 'button opens the existing visit sheet'
    if (await tap(p.locator('.cartsum .whenask button'), 'A8 \'방문일 정하기\'')) {
      ok('A8 \'방문일 정하기\' → 방문일 창(언제 갈 거예요?)', await p.locator('.sheet[aria-label="언제 갈 거예요?"]').isVisible());
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    }
    const fits = (date) => A.filter((y) => P.condState(S[y.r[6]], S[y.r[2]], { date, time: '' }, { days: days(y.r), hours: hours(y.r) }) !== 1);
    if (on) {
      await visit(on);
      const v = low(fits(on));
      const h2 = (await text('.cartsum .hp')).replace(/\s+/g, '');
      ok(`A9 방문일(${on})을 정하면 그 줄이 사라지고 그날 되는 가격 ×3`, (await p.locator('.cartsum .whenask').count()) === 0 && !!v && h2 === won(price(v.r) * 3), `${h2} · 기대 ${v ? won(price(v.r) * 3) : '-'}`);
    } else skip('A9 되는 날 방문', '15일 안에 그 요일이 없음');
    if (off) {
      await visit(off);
      const h3 = (await text('.cartsum .hp')).replace(/\s+/g, '');
      ok(`A10 안 되는 날(${off})이면 그 가격은 빠짐(방문일 거르기 그대로)`, !fits(off).length && h3 !== won(pr * 3) && !(await mainTxt()).includes(won(pr * 3)) && (await p.locator('.cartsum .whenask').count()) === 0, `${h3}`);
    } else skip('A10 안 되는 날 방문', '그런 요일이 없음(매일)');
  }

  // ---- B. once prices as before
  // B1: a once price first, then the regular price (no repeat price at that branch): once + 2 × regular, never once × 3
  const B1 = [...byKB.entries()].map(([key, xs]) => ({ key, xs, first: low(xs), plain: low(xs.filter((x) => cls(x.r) === '')) }))
    .find((o) => cls(o.first.r) === 'once' && o.plain && !o.xs.some((x) => cls(x.r) === 'repeat') && noRv(o.xs) && price(o.plain.r) > price(o.first.r));
  if (!B1) skip('B1', '1회 가격 + 일반가 — 이 자료엔 없음');
  else {
    const [k] = B1.key.split('|'), b = B1.first.r[0], f = price(B1.first.r), g = price(B1.plain.r);
    console.log(`B1: ${k} @ ${bname(b)} · ${S[B1.first.r[2]]} ${won(f)} → ${S[B1.plain.r[2]]} ${won(g)}`);
    await seed([{ t: 'k', k, q: 3 }], where(b));
    const q = await quote(b), ln = q && q.lines[0];
    ok('B1 1회 가격은 첫 회만: 1회 가격 + 2 × 일반가(예전 그대로)', !!ln && ln.total === won(f + 2 * g) && ln.total !== won(3 * f) && !ln.m.includes(REPEAT_TXT), ln ? `${ln.total} · 기대 ${won(f + 2 * g)} | ${ln.m}` : '(견적 없음)');
    ok(`B2 견적 경고: '${LATER}, 2회째부터는 이 지점의 다른 가격으로'`, !!q && q.warns.some((w) => w.startsWith(`${LATER}, 2회째부터는 이 지점의 다른 가격으로`)), q ? q.warns.join(' / ') : '');
    ok('B2b 견적 줄(자세히)에 2회째부터 쓰는 가격의 이름', !!ln && ln.more.includes(`2회째부터 ${S[B1.plain.r[2]]}`), ln ? ln.more.slice(0, 200) : '');
  }
  // B3: a once-only price ×3 is no firm total (round-2 R14), and with no repeat price there is no visit prompt
  const onceOnly = names.find((xs) => xs.every((x) => cls(x.r) === 'once' && !S[x.r[6]] && !days(x.r) && !hours(x.r)));
  if (!onceOnly) skip('B3', '1회 가격만 있는 시술 — 이 자료엔 없음');
  else {
    const r = low(onceOnly).r, b = r[0], n = S[r[2]], f = price(r);
    console.log(`B3: ${n} @ ${bname(b)} · kind ${r[5]} · ${won(f)}`);
    await seed([{ t: 'r', n, br: bkey(b), p: f, q: 3, ov: {} }]);
    const t = await mainTxt();
    ok('B3 1회 가격만 있으면 ×3 합계를 만들지 않음(1회 × 3 아님)', !t.includes(won(3 * f)) && (await text('.cartsum .hp')).includes('일부 가격 미확인'), await text('.cartsum .hp'));
    ok('B4 요일·시간 가격이 없으면 방문일 줄도 없음', (await p.locator('.cartsum .whenask').count()) === 0);
  }

  // ---- C. the item switch: a once price first and a cheaper-than-regular next price (a repeat one when the data has it)
  const sw = [...byKB.entries()].map(([key, xs]) => ({ key, xs, first: low(xs), next: low(xs.filter((x) => cls(x.r) !== 'once')) }))
    .filter((o) => cls(o.first.r) === 'once' && o.next && noRv(o.xs) && price(o.next.r) > price(o.first.r));
  // (a plain price as low as the repeat one wins the tie: the next price is then a regular one)
  const C = sw.find((o) => cls(o.next.r) === 'repeat' && !o.xs.some((x) => cls(x.r) === '' && price(x.r) <= price(o.next.r))) || sw[0];
  if (!C) skip('C', '전에 받아 봤어요 — 이 자료엔 없음');
  else {
    const [k] = C.key.split('|'), b = C.first.r[0], f = price(C.first.r), g = price(C.next.r), repeat = cls(C.next.r) === 'repeat' && !C.xs.some((x) => cls(x.r) === '' && price(x.r) <= g);
    console.log(`C: ${k} @ ${bname(b)} · ${S[C.first.r[2]]} ${won(f)} → ${S[C.next.r[2]]} ${won(g)} (${repeat ? 'repeat' : 'regular'})`);
    await seed([{ t: 'k', k, q: 3 }], where(b));
    const swc = p.locator('.ci .cdone label.switch', { hasText: DONE });
    const lowOff = +((await text('.cartsum .hp')).match(/[\d,]+원/) || ['0'])[0].replace(/[^\d]/g, '');   // the lowest one-clinic total, switch off
    ok('C1 1회 가격이 있는 시술엔 \'전에 이 시술을 받아 봤어요\'(꺼짐)', (await swc.count()) === 1 && !(await swc.locator('input').isChecked()));
    let q = await quote(b), ln = q && q.lines[0];
    ok(`C2 꺼짐: 1회 가격 + 2 × 다음 가격${repeat ? '(요일·시간 조건 가격)' : ''}`, !!ln && ln.total === won(f + 2 * g) && (!repeat || ln.m.includes(REPEAT_TXT)), ln ? `${ln.total} · 기대 ${won(f + 2 * g)}` : '(견적 없음)');
    // the later sessions' price is named (in the line's '자세히'), and in view the repeat words come after '2회째부터' (they are
    // about the later sessions, not the once price)
    const nm2 = `2회째부터 ${S[C.next.r[2]]}`, m = ln ? ln.m : '', i2 = m.indexOf('2회째부터');
    ok('C2b 견적 줄: 자세히에 \'2회째부터 <다음 가격 이름>\'' + (repeat ? ', 보이는 줄에 \'2회째부터\' 뒤 매번 문구' : ''), !!ln && ln.more.includes(nm2) && (!repeat || (i2 >= 0 && m.lastIndexOf(REPEAT_TXT) > i2)), `${m.slice(0, 160)} | ${ln ? ln.more.slice(0, 80) : ''}`);
    ok('C2c 경고: 1회 가격은 첫 1회만', !!q && q.warns.some((w) => w.startsWith(LATER)), q ? q.warns.join(' / ') : '');
    const cp = await copied(b), cl = cp.split('\n').find((x) => x.startsWith('- ')) || '';
    ok('C2d 견적 복사: 2회째부터 쓰는 가격 이름' + (repeat ? '과 \'2회째부터 방문일·시간 조건이 맞을 때 매번 이 가격\'' : '') + ', ※ 1회 가격은 첫 1회만',
      cl.includes(nm2) && (!repeat || cl.includes(`2회째부터 ${REPEAT_TXT}`)) && cp.includes(`※ ${LATER}`), cp.slice(0, 300).replace(/\n/g, ' / '));
    if (!(await tap(swc, 'C3 스위치'))) { ok('스크립트 오류 없음', !errs.length, errs.join(' ')); console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await br.close(); process.exitCode = 1; return; }
    await p.waitForTimeout(500);
    q = await quote(b); ln = q && q.lines[0];
    ok('C3 켬: 1회 가격을 쓰지 않음 — 3 × 다음 가격', !!ln && ln.total === won(3 * g) && !ln.all.includes(S[C.first.r[2]]), ln ? `${ln.total} · 기대 ${won(3 * g)} | ${ln.all.slice(0, 80)}` : '(견적 없음)');
    ok('C4 켬: 안내 \'체험가·첫 방문가 같은 1회 가격은 빼고 계산해요\'', (await text('.ci .cdone')).includes('체험가·첫 방문가 같은 1회 가격은 빼고 계산해요'));
    const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem('pc:carts'))[0].items[0].done);
    ok('C5 담은 시술에 저장(done: true)', (await saved()) === true);
    // sharing: the switch is the sender's own history — the link leaves it out and carries the total without it
    if (await tap(p.locator('.cartsum .tools button', { hasText: '공유하기' }), 'C5b 공유하기')) {
      const sh = p.locator('.sheet[aria-label="내 견적 보내기"]');
      await tap(sh.locator('button', { hasText: '링크만 복사' }), 'C5b 링크만 복사'); await p.waitForTimeout(300);
      const link = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      let pl = null; try { pl = JSON.parse(Buffer.from(link.split('#import/')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { pl = null; }
      ok('C5b 공유 링크엔 \'전에 받아 봤어요\'가 없고, 보낸 때 합계는 그것 없이(받는 쪽과 같은 기준)', !!pl && pl.items.every((x) => !('done' in x)) && !!pl.sent && pl.sent.total === lowOff,
        pl ? `done ${pl.items.map((x) => x.done)} · sent ${pl.sent && pl.sent.total} · 기대(꺼짐일 때 한 곳 최저) ${lowOff}` : link.slice(0, 80));
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    }
    await openCart();
    q = await quote(b); ln = q && q.lines[0];
    ok('C6 새로고침해도 켜져 있고 같은 합계', (await p.locator('.ci .cdone label.switch', { hasText: DONE }).locator('input').isChecked()) && !!ln && ln.total === won(3 * g), ln ? ln.total : '');
    await tap(p.locator('.ci .cdone label.switch', { hasText: DONE }), 'C7 스위치'); await p.waitForTimeout(500);
    q = await quote(b); ln = q && q.lines[0];
    ok('C7 끄면 예전 계산으로, 저장에서도 빠짐', !!ln && ln.total === won(f + 2 * g) && (await saved()) === undefined, ln ? ln.total : '');
  }

  // ---- D. a once price picked for the branch by hand (it.ov) ×3: first session only, later sessions at the next price
  const firstOnly = (x) => all.filter((y) => y.r[0] === x.r[0] && y.r[2] === x.r[2]).length === 1;   // its name finds that one row
  const Dc = [...byKB.entries()].map(([key, xs]) => ({ key, xs, first: low(xs), plain: low(xs.filter((x) => cls(x.r) === '')) }))
    .find((o) => cls(o.first.r) === 'once' && o.plain && !o.xs.some((x) => cls(x.r) === 'repeat') && noRv(o.xs) && price(o.plain.r) > price(o.first.r) && firstOnly(o.first));
  if (!Dc) skip('D', '직접 고른 1회 가격 — 이 자료엔 없음');
  else {
    const [k] = Dc.key.split('|'), b = Dc.first.r[0], f = price(Dc.first.r), g = price(Dc.plain.r);
    console.log(`D: ${k} @ ${bname(b)} · 직접 고름 ${S[Dc.first.r[2]]} ${won(f)} → ${won(g)}`);
    await seed([{ t: 'k', k, q: 3, ov: { [bkey(b)]: S[Dc.first.r[2]] } }], where(b));
    const q = await quote(b), ln = q && q.lines[0];
    ok('D1 직접 고른 1회 가격 ×3 = 1회 가격 + 2 × 다음 가격(1회 가격 × 3 아님)', !!ln && ln.total === won(f + 2 * g) && ln.total !== won(3 * f) && ln.m.includes('직접 고름'), ln ? `${ln.total} · 기대 ${won(f + 2 * g)} | ${ln.m.slice(0, 120)}` : '(견적 없음)');
  }

  // ---- E. a visit time: the later sessions' price can't be checked at that hour (state 2) while the first one can (state 0)
  const E = (() => {
    if (!WHEN) return null;
    const tue = nextDay(2); if (!tue) return null;
    const vis = { date: tue, time: '14:00' };
    const stOf = (r) => (S[r[6]] || days(r) || hours(r) ? P.condState(S[r[6]], S[r[2]], vis, { days: days(r), hours: hours(r) }) : 0);
    for (const [key, xs] of byKB) {
      if (!noRv(xs)) continue;
      // as the app: a repeat price whose event ends before the visit is not repeated (case F)
      const c = xs.filter((x) => stOf(x.r) !== 1).map((x) => ({ i: x.i, p: price(x.r), special: cls(x.r) !== '', repeat: cls(x.r) === 'repeat' && !P.periodOver(S[x.r[10]], vis) }));
      const l = P.lineCost(c, c.filter((x) => !x.special), 3, null);
      if (l && l.rows.length === 2 && stOf(D.rows[l.rows[1]]) === 2 && stOf(D.rows[l.rows[0]]) === 0) return { key, vis, l };
    }
    return null;
  })();
  if (!E) skip('E', '2회째 가격만 시간 확인이 필요한 경우 — 이 자료엔 없음');
  else {
    const [k, bs] = E.key.split('|'), b = +bs, r2 = D.rows[E.l.rows[1]];
    console.log(`E: ${k} @ ${bname(b)} · ${E.vis.date} ${E.vis.time} · 2회째 ${S[r2[2]]} (${S[r2[6]] || '태그 없음'})`);
    await seed([{ t: 'k', k, q: 3 }], { ...where(b), when: E.vis });
    const q = await quote(b), ln = q && q.lines[0];
    ok('E1 2회째 가격에만 시간 확인이 필요해도 경고 \'방문 시간에 되는 가격인지 병원에 확인하세요\'', !!q && q.warns.some((w) => w.startsWith('방문 시간에 되는 가격인지 병원에 확인하세요')), q ? q.warns.join(' / ') : '');
    const i2 = ln ? ln.m.indexOf('2회째부터') : -1;
    ok('E2 견적 줄: 보이는 \'2회째부터\' 뒤에 \'시간 확인 필요\'(2회째 가격 이름은 자세히 안)', !!ln && ln.more.includes(`2회째부터 ${S[r2[2]]}`) && i2 >= 0 && ln.m.indexOf('시간 확인 필요', i2) > i2, ln ? `${ln.m.slice(0, 200)} | ${ln.more.slice(0, 80)}` : '');
  }

  // ---- F. a visit after the event's end date (user decision 2026-10-16: mark it '기간 확인 필요', do not drop it): at a branch whose
  //      cheapest price for an id is a repeat price with an end date and that also has a plain price, a visit after that end date
  //      uses the repeat price for the first session only (not 3 ×) and the plain one after; the quote warns and marks the line
  const isoU = (r) => { const u = S[r[10]] || ''; return /^\d{4}-\d{2}-\d{2}$/.test(u) && u < '2099' ? u : ''; };
  const visitAfter = (r) => { const u = isoU(r); if (!u) return null; const ok_ = days(r) || (S[r[6]] === '평일 낮' ? 31 : 127);
    const d = new Date(u + 'T12:00:00'); const max = new Date(); max.setDate(max.getDate() + 118);
    for (let i = 1; i < 15; i++) { d.setDate(d.getDate() + 1); if (d > max) return null; const s_ = ymd(d);
      if (!P.KR_HOLIDAYS[s_] && (ok_ & bit(d.getDay()))) return s_; } return null; };
  const F = (() => {
    for (const [key, xs] of byKB) {
      if (!noRv(xs)) continue;
      const rep = low(xs.filter((x) => cls(x.r) === 'repeat' && !hours(x.r) && isoU(x.r)));
      const plain = low(xs.filter((x) => cls(x.r) === ''));
      if (!rep || !plain || price(rep.r) >= price(plain.r)) continue;
      const v = visitAfter(rep.r); if (v) return { key, rep, plain, vis: { date: v, time: '' } };
    }
    return null;
  })();
  if (!F) skip('F', '종료일이 있는 요일·시간 가격 + 일반가가 있는 지점 — 이 자료엔 없음(또는 120일 밖)');
  else {
    const [k, bs] = F.key.split('|'), b = +bs, pr = price(F.rep.r), pl = price(F.plain.r);
    console.log(`F: ${k} @ ${bname(b)} · ${S[F.rep.r[2]]} ~${isoU(F.rep.r)} ${won(pr)} · 일반가 ${won(pl)} · 방문 ${F.vis.date}`);
    await seed([{ t: 'k', k, q: 3 }], { ...where(b), when: F.vis });
    const q = await quote(b), ln = q && q.lines[0];
    ok('F1 행사가 끝난 뒤 방문: 요일·시간 가격은 3회 반복하지 않음(3 × 가격 아님)', !!ln && ln.total !== won(pr * 3), ln ? `${ln.total} · 3×${won(pr)}` : '(견적 없음)');
    ok('F2 견적 경고 \'방문일에는 행사가 끝났을 수 있는 가격\'', !!q && q.warns.some((w) => w.startsWith('방문일에는 행사가 끝났을 수 있는 가격')), q ? q.warns.join(' / ') : '(견적 없음)');
    ok('F3 견적 줄에 \'기간 확인 필요\'', !!ln && ln.m.includes('기간 확인 필요'), ln ? ln.m.slice(0, 200) : '');
  }

  // ---- G. revisit prices (C #111) and '이 병원에 다녀왔어요'. The name rule is narrow: in this file every row it reads is one the
  // build made conditional
  const rvAll = D.rows.filter((r) => P.isRevisit(S[r[2]]));
  const firstTag = (r) => (S[r[6]] || '').split('·').includes('첫 방문');
  const visited = () => p.evaluate(() => JSON.parse(localStorage.getItem('pc:visited') || '[]'));
  const vswQ = () => p.locator('li.qrow .qbody > .visit');                                  // the switch above an opened quote
  const lineOf = async (b) => ((await quote(b)) || { lines: [] }).lines[0];
  const ovBtn = () => p.locator('.ci button', { hasText: '지점별로 바꾼 옵션' });
  // the '일부만 되는 곳 N곳 보기 / 접기' toggle: the shared '더 보기' button (button.morelist, hierarchy audit 8) with aria-expanded
  const partBtn = (t = '일부만 되는 곳') => p.locator('button.morelist[aria-expanded]', { hasText: t });
  const qIdx = (b) => p.$$eval('li.qrow', (lis, nm) => lis.findIndex((li) => { const s = li.querySelector('.rank .b span:last-child'); return s && s.textContent === nm; }), bname(b));
  const swH = async (loc) => { const bx = (await loc.count()) ? await loc.first().boundingBox() : null; return bx ? Math.round(bx.height) : 0; };   // the switch's touch height
  const notesTxt = () => p.evaluate(() => JSON.parse(localStorage.getItem('pc:notes') || '[]').map((n) => n.text));
  const shareLink = async () => {   // '공유하기' → '링크만 복사': the link and its payload
    if (!(await tap(p.locator('.cartsum .tools button', { hasText: '공유하기' }), '공유하기'))) return { link: '', pl: null };
    await tap(p.locator('.sheet[aria-label="내 견적 보내기"] button', { hasText: '링크만 복사' }), '링크만 복사'); await p.waitForTimeout(300);
    const link = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    let pl = null; try { pl = JSON.parse(Buffer.from(link.split('#import/')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { pl = null; }
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    return { link, pl };
  };
  const ready = () => p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
  if (!rvAll.length) skip('G', '재방문 가격(이름 앞 ★재방문…★·[재진]) — 이 자료엔 없음');
  else {
    ok(`G0 이름 규칙이 고른 줄 ${rvAll.length}개는 모두 조건부(체험가·한정가·태그) — 일반가로 읽은 줄 없음`, rvAll.every((r) => cls(r) === 'revisit'),
      rvAll.filter((r) => cls(r) !== 'revisit').map((r) => S[r[2]]).join(' / ').slice(0, 200));
    // G1: an id at a branch with a revisit price below its regular price and nothing else conditional (쁨 천안 X03 on 2026-10-19)
    const G = [...byKB.entries()].map(([key, xs]) => ({ key, xs, rv: low(xs.filter((x) => cls(x.r) === 'revisit')), plain: low(xs.filter((x) => cls(x.r) === '')) }))
      .find((o) => o.rv && o.plain && price(o.plain.r) > price(o.rv.r) && o.xs.every((x) => ['', 'revisit'].includes(cls(x.r))));
    if (!G) skip('G1', '재방문 가격과 일반가가 함께 있는 시술 — 이 자료엔 없음');
    else {
      const [k, bs] = G.key.split('|'), b = +bs, f = price(G.rv.r), g = price(G.plain.r), rvName = S[G.rv.r[2]], plName = S[G.plain.r[2]];
      console.log(`G1: ${k} @ ${bname(b)} · ${rvName} ${won(f)} · 일반가 ${plName} ${won(g)} · 꺼짐 ${won(3 * g)} · 켬 ${won(f + 2 * g)}`);
      await seed([{ t: 'k', k, q: 3 }], where(b));
      const lowOff = +((await text('.cartsum .hp')).match(/[\d,]+원/) || ['0'])[0].replace(/[^\d]/g, '');   // the lowest one-clinic total, not visited
      let q = await quote(b), ln = q && q.lines[0];
      ok('G1 다녀옴 꺼짐(처음 가는 사람): 재방문 가격을 쓰지 않음 — 3 × 일반가', !!ln && ln.total === won(3 * g) && !ln.m.includes(rvName), ln ? `${ln.total} · 기대 ${won(3 * g)} | ${ln.m.slice(0, 120)}` : '(견적 없음)');
      const sw0 = vswQ();
      ok(`G1b 펼친 견적 맨 위에 '${VISIT}'(꺼짐)와 '켜면 ${RV_DO} 계산해요'`, (await sw0.count()) === 1 && !(await sw0.locator('input').isChecked())
        && (await sw0.innerText()).includes(`켜면 ${RV_DO} 계산해요`) && (await p.locator('li.qrow .qbody > :first-child.visit').count()) === 1, (await sw0.count()) ? await sw0.innerText() : '(없음)');
      ok(`G1d 스위치 이름에 지점('${VISIT} · ${bname(b)}'), 누르는 곳 높이 44px 이상`, (await sw0.locator('input').getAttribute('aria-label')) === `${VISIT} · ${bname(b)}` && (await swH(sw0.locator('label.switch'))) >= 44,
        `${await sw0.locator('input').getAttribute('aria-label')} · ${await swH(sw0.locator('label.switch'))}px`);
      ok('G1c 담은 시술 줄에는 재방문 말이 없음(시술 스위치와 상관없음)', !(await text('.ci')).includes('재방문') && !(await text('.ci')).includes(VISIT), await text('.ci'));
      ok('G2 꺼짐: 경고에 재방문 없음', !!q && !q.warns.some((w) => w.startsWith('재방문 가격')), q ? q.warns.join(' / ') : '');
      const opt = await p.$$eval('li.qrow .qline select option', (os, n) => os.filter((o) => o.textContent.startsWith(n)).map((o) => [o.disabled, o.textContent]), rvName);
      ok('G2c 꺼짐: 지점 옵션에서 재방문 가격은 고를 수 없고 \'(다녀왔어요를 켜면)\'', opt.length > 0 && opt.every(([d, t]) => d && t.includes('· 재방문') && t.includes('(다녀왔어요를 켜면)')), JSON.stringify(opt).slice(0, 200));
      if (await tap(vswQ().locator('label.switch'), 'G3 다녀왔어요 스위치')) {
        await p.waitForTimeout(500);
        q = await quote(b); ln = q && q.lines[0];
        ok('G3 켬: 재방문 가격은 첫 1회만 — 재방문가 + 2 × 일반가', !!ln && ln.total === won(f + 2 * g) && ln.total !== won(3 * f), ln ? `${ln.total} · 기대 ${won(f + 2 * g)}` : '(견적 없음)');
        // one item: no clinic has only part of it, so there is no '일부만 되는 곳' to open — that the list stays closed when a clinic
        // does not move is G14c's (a 2-item cart that has the list)
        ok('G3a 시술 1개 견적: 켜도 목록을 옮기지 않아 옮김 알림 없음(\'일부만 되는 곳\' 목록 자체가 없음 — 닫힌 채인지는 G14c)', (await partBtn().count()) === 0 && !(await text('#toast')).includes('옮겼어요'), await text('#toast'));
        // the clinic's product names fold into the line's '자세히' (hierarchy audit 48): the badge and how the total was made stay in view
        ok('G3b 견적 줄: 보이는 줄에 \'재방문만\' 배지와 \'첫 회 <재방문가> + 2회 × <일반가>\', 자세히에 재방문 가격 이름 + \'2회째부터 <일반가 이름>\'', !!ln && ln.m.includes('재방문만') && ln.m.includes(`첫 회 ${won(f)} + 2회 × ${won(g)}`)
          && ln.more.startsWith(rvName) && ln.more.includes(`2회째부터 ${plName}`) && !ln.all.includes(REPEAT_TXT), ln ? `${ln.m.slice(0, 160)} | ${ln.more.slice(0, 120)}` : '');
        ok(`G3c 경고 '${RV_WARN.slice(0, 30)}…' 와 '${LATER}'`, !!q && q.warns.some((w) => w.startsWith(RV_WARN)) && q.warns.some((w) => w.startsWith(LATER)), q ? q.warns.join(' / ') : '');
        ok(`G3d 스위치 켜짐, 안내 '${RV_DO} 계산해요'(켜면 없이), 이 기기에 저장(pc:visited)`, (await vswQ().locator('input').isChecked()) && (await vswQ().innerText()).includes(`${RV_DO} 계산해요`)
          && !(await vswQ().innerText()).includes('켜면') && JSON.stringify(await visited()) === JSON.stringify([bkey(b)]), `${await vswQ().innerText()} | ${JSON.stringify(await visited())}`);
        const cp = await copied(b);
        ok('G3e 견적 복사: 재방문 가격 이름과 ※ 재방문 경고', cp.includes(`※ ${RV_WARN}`) && cp.includes(rvName), cp.slice(0, 300).replace(/\n/g, ' / '));
        if (await tap(p.locator('.cartsum .tools button', { hasText: '공유하기' }), 'G3f 공유하기')) {
          const sh = p.locator('.sheet[aria-label="내 견적 보내기"]');
          await tap(sh.locator('button', { hasText: '링크만 복사' }), 'G3f 링크만 복사'); await p.waitForTimeout(300);
          const link = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
          let pl = null; try { pl = JSON.parse(Buffer.from(link.split('#import/')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { pl = null; }
          ok('G3f 공유 링크엔 다녀온 병원이 없고, 보낸 때 합계는 그것 없이(받는 쪽과 같은 기준)', !!pl && !JSON.stringify(pl).includes('visited') && !!pl.sent && pl.sent.total === lowOff,
            pl ? `sent ${pl.sent && pl.sent.total} · 기대(다녀옴 꺼짐일 때 한 곳 최저) ${lowOff}` : link.slice(0, 80));
          await p.keyboard.press('Escape'); await p.waitForTimeout(200);
        }
        await openCart();
        ln = await lineOf(b);
        ok('G3g 새로고침해도 켜져 있고 같은 합계', (await vswQ().locator('input').isChecked()) && !!ln && ln.total === won(f + 2 * g), ln ? ln.total : '');
        await tap(vswQ().locator('label.switch'), 'G3h 스위치'); await p.waitForTimeout(500);
        ln = await lineOf(b);
        ok('G3h 끄면 3 × 일반가, 저장에서도 빠짐', !!ln && ln.total === won(3 * g) && (await visited()).length === 0, ln ? ln.total : '');
      }
      // G4: '전에 이 시술을 받아 봤어요' (it.done) is about once prices only: alone it lets no revisit price in; with the clinic marked it stays
      await seed([{ t: 'k', k, q: 3, done: true }], where(b));
      let l = await lineOf(b);
      ok('G4 받아 봤어요만 켬(다녀옴 꺼짐): 재방문 가격 안 들어감 — 3 × 일반가', !!l && l.total === won(3 * g) && !(await text('.ci')).includes('재방문'), `${l ? l.total : '(견적 없음)'} · 기대 ${won(3 * g)} | ${await text('.ci .cdone')}`);
      await seed([{ t: 'k', k, q: 3, done: true }], { ...where(b), visited: [bkey(b)] });
      l = await lineOf(b);
      ok('G4b 받아 봤어요 + 다녀옴 켬: 재방문가 + 2 × 일반가(받아 봤어요가 재방문 가격을 빼지 않음)', !!l && l.total === won(f + 2 * g), `${l ? l.total : '(견적 없음)'} · 기대 ${won(f + 2 * g)}`);
      // G5: 특가 빼기 for this line (it.sp false) or for the whole app (special false) with the clinic marked: no revisit price, no switch
      for (const [nm, item, extra] of [['G5 이 시술만 특가 빼기', { t: 'k', k, q: 3, sp: false }, {}], ['G5b 앱 전체 특가 포함 끔', { t: 'k', k, q: 3 }, { special: false }]]) {
        await seed([item], { ...where(b), visited: [bkey(b)], ...extra });
        l = await lineOf(b);
        ok(`${nm} + 다녀옴 켬: 3 × 일반가, 다녀왔어요 스위치 없음(바뀌는 게 없음)`, !!l && l.total === won(3 * g) && (await vswQ().count()) === 0, `${l ? l.total : '(견적 없음)'} · 기대 ${won(3 * g)} · 스위치 ${await vswQ().count()}`);
      }
      // G6: the revisit price picked for the branch by hand (it.ov — a shared link keeps it): not visited → left out (3 × regular)
      // and not counted as a changed option; visited → the first session only, the pick counted
      const ovX = all.find((x) => x.r[0] === b && x.r[2] === G.rv.r[2]), fo = price(ovX.r);   // the row the app finds by that name
      await seed([{ t: 'k', k, q: 3, ov: { [bkey(b)]: rvName } }], where(b));
      l = await lineOf(b);
      ok('G6 직접 고른 재방문 가격 + 다녀옴 꺼짐: 쓰지 않음(3 × 일반가), \'지점별로 바꾼 옵션\' 없음, 스위치 보임', !!l && l.total === won(3 * g) && (await ovBtn().count()) === 0 && (await vswQ().count()) === 1,
        `${l ? l.total : '(견적 없음)'} · 기대 ${won(3 * g)} · 버튼 ${await ovBtn().count()} · 스위치 ${await vswQ().count()}`);
      for (const [nm, item] of [['G6b 다녀옴 켬', { t: 'k', k, q: 3, ov: { [bkey(b)]: rvName } }], ['G6c 이 시술만 특가 빼기 + 다녀옴 켬', { t: 'k', k, q: 3, sp: false, ov: { [bkey(b)]: rvName } }]]) {
        await seed([item], { ...where(b), visited: [bkey(b)] });
        const q_ = await quote(b); l = q_ && q_.lines[0];
        ok(`${nm}: 직접 고른 재방문 가격은 첫 1회만(재방문가 + 2 × 일반가), '지점별로 바꾼 옵션 1곳', 경고, 스위치 켜짐`, !!l && l.total === won(fo + 2 * g) && l.more.startsWith(rvName) && l.m.includes('재방문만') && l.m.includes('직접 고름')
          && (await ovBtn().count()) === 1 && (await ovBtn().innerText()).includes('1곳') && q_.warns.some((w) => w.startsWith(RV_WARN)) && (await vswQ().locator('input').isChecked()),
          `${l ? l.total : '(견적 없음)'} · 기대 ${won(fo + 2 * g)} · 버튼 ${await ovBtn().count()} | ${l ? `${l.m.slice(0, 80)} | ${l.more.slice(0, 60)}` : ''}`);
      }
      // G15: a 내 견적 합계 alert made before the clinic was marked: turning the switch is not a price change — no notice on the next
      // start (its base is the new total), while a real drop below its base still notices
      await seed([{ t: 'k', k, q: 3 }], { ...where(b), alerts: [{ id: 'cd1', created: '2026-10-01', type: 'cartdrop', cart: '시험 견적', base: lowOff, target: null }], notes: [] });
      await quote(b);
      if (await tap(vswQ().locator('label.switch'), 'G15 다녀왔어요 스위치')) {
        await p.waitForTimeout(500);
        const lowOn = +((await text('.cartsum .hp')).match(/[\d,]+원/) || ['0'])[0].replace(/[^\d]/g, '');
        const al = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:alerts') || '[]')[0]);
        await openCart(); await p.waitForTimeout(300);
        let nt = await notesTxt();
        ok('G15 다녀옴을 켜서 합계가 내려가도 \'내 견적 합계\' 알림은 울리지 않음(기준을 새 합계로)', lowOn < lowOff && !!al && al.base === lowOn && !nt.some((t) => t.includes('내 견적')),
          `켬 ${lowOn} · 끔 ${lowOff} · 기준 ${al && al.base} | ${nt.join(' / ').slice(0, 120)}`);
        await p.evaluate((v) => { const a = JSON.parse(localStorage.getItem('pc:alerts')); a[0].base = v; localStorage.setItem('pc:alerts', JSON.stringify(a)); }, lowOn + 1000);
        await openCart(); await p.waitForTimeout(300); nt = await notesTxt();
        ok('G15b 기준보다 실제로 내린 합계는 그대로 알림', nt.some((t) => t.includes(`${won(lowOn)} (전 ${won(lowOn + 1000)})`)), nt.join(' / ').slice(0, 160));
      }
      // G16: the revisit price picked at the clinic marked visited: the shared link leaves that pick out (only a visited clinic
      // can have it) and carries the total without the clinic; the receiver who marked the same clinic sees that same total
      await seed([{ t: 'k', k, q: 3, ov: { [bkey(b)]: rvName } }], { ...where(b), visited: [bkey(b)] });
      { const { link, pl } = await shareLink();
        ok('G16 공유 링크: 다녀온 병원에서만 고를 수 있는 재방문 옵션은 빠지고, 보낸 때 합계는 다녀옴 없이', !!pl && !JSON.stringify(pl.items).includes(rvName) && !!pl.sent && pl.sent.total === lowOff,
          pl ? `${JSON.stringify(pl.items).slice(0, 120)} · sent ${pl.sent && pl.sent.total} · 기대 ${lowOff}` : link.slice(0, 80));
        if (pl) {
          await p.goto(BASE + '#import/' + link.split('#import/')[1]); await ready(); await p.waitForSelector('#main .card h2'); await p.waitForTimeout(300);
          const nt = await text('#main .card .note');
          ok('G16b 받는 쪽(같은 병원을 다녀옴으로 켠 기기)도 보낸 때와 같은 기준: \'같은 가격이에요\'', nt.includes('같은 가격이에요') && nt.includes(won(lowOff)), nt);
        } }
      // G19: '받았어요 · 기록' in the quote of a clinic not marked yet (user decision 2026-10-19): the records are saved first, then
      // the toast asks whether to turn '이 병원에 다녀왔어요' on (켜기 / 아니요). 켜기 does what the quote's switch does (stored, the
      // 내 견적 합계 alert takes the new total as its base, undo); 아니요 changes nothing; a clinic marked already is not asked
      const recs = () => p.evaluate(() => JSON.parse(localStorage.getItem('pc:recs') || '[]'));
      const recBtn = () => p.locator('li.qrow .qbody button', { hasText: '받았어요 · 기록' }), tBtn = (t) => p.locator('#toast.on button', { hasText: t });
      const ASK_V = `'${VISIT}'를 켤까요?`;
      await seed([{ t: 'k', k, q: 3 }], { ...where(b), alerts: [{ id: 'cd2', created: '2026-10-01', type: 'cartdrop', cart: '시험 견적', base: lowOff, target: null }], notes: [] });
      await quote(b);
      if (await tap(recBtn(), 'G19 받았어요 · 기록')) {
        await p.waitForTimeout(300);
        const tt = await text('#toast'), rs = await recs();
        ok(`G19 기록하면 먼저 저장하고(이 지점 1개), 알림 한 줄 '${ASK_V}' + 켜기·아니요`, rs.length === 1 && rs[0].br === bkey(b) && tt.includes('기록했어요') && tt.includes(ASK_V)
          && (await tBtn('켜기').count()) === 1 && (await tBtn('아니요').count()) === 1 && (await visited()).length === 0, `${tt} | 기록 ${rs.length}`);
        const tb = await p.locator('#toast').boundingBox().catch(() => null), bs = await p.$$eval('#toast.on button', (xs) => xs.map((x) => { const r = x.getBoundingClientRect(); return [r.left, r.right, r.height]; }));
        ok('G19e 묻는 알림: 켜기·아니요 둘 다 알림 상자 안·화면 안(잘리지 않음), 누르는 곳 24px 이상', !!tb && bs.length === 2 && tb.x >= 0 && tb.x + tb.width <= p.viewportSize().width && bs.every(([l, r, hh]) => l >= tb.x && r <= tb.x + tb.width + 0.5 && hh >= 24),
          tb ? `상자 ${Math.round(tb.x)}~${Math.round(tb.x + tb.width)} · 버튼 ${bs.map(([l, r, hh]) => `${Math.round(l)}~${Math.round(r)}/${Math.round(hh)}px`).join(', ')}` : '(없음)');
        if (await tap(tBtn('켜기'), 'G19b 켜기')) {
          await p.waitForTimeout(500);
          const tt2 = await text('#toast'), undo = await tBtn('되돌리기').count();
          const lowOn = +((await text('.cartsum .hp')).match(/[\d,]+원/) || ['0'])[0].replace(/[^\d]/g, '');
          const al = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:alerts') || '[]')[0]);
          const l19 = await lineOf(b);
          ok('G19b 켜기 = 견적 스위치: 저장, 스위치 켜짐, 재방문가 + 2 × 일반가, 합계 알림 기준은 새 합계, 알림 \'…켰어요\' + 되돌리기', JSON.stringify(await visited()) === JSON.stringify([bkey(b)]) && (await vswQ().locator('input').isChecked())
            && !!l19 && l19.total === won(f + 2 * g) && !!al && al.base === lowOn && lowOn < lowOff && tt2.includes(`'${VISIT}'를 켰어요`) && undo === 1,
            `${l19 ? l19.total : '(견적 없음)'} · 기준 ${al && al.base} · 켬 ${lowOn} · 끔 ${lowOff} | ${tt2}`);
          await p.waitForTimeout(6500);   // that toast's 6 s
          if (await tap(recBtn(), 'G19c 받았어요 · 기록')) {
            await p.waitForTimeout(300);
            ok('G19c 다녀온 병원으로 켠 뒤 다시 기록: 묻지 않음(버튼 없는 알림), 기록은 2개', !(await text('#toast')).includes(ASK_V) && (await text('#toast')).includes('기록했어요') && (await p.locator('#toast.on button').count()) === 0 && (await recs()).length === 2,
              await text('#toast'));
          }
        }
      }
      await seed([{ t: 'k', k, q: 3 }], where(b));
      await quote(b);
      if (await tap(recBtn(), 'G19d 받았어요 · 기록')) {
        await p.waitForTimeout(300);
        if (await tap(tBtn('아니요'), 'G19d 아니요')) {
          await p.waitForTimeout(400);
          const l19 = await lineOf(b);
          ok('G19d 아니요: 다녀옴은 그대로 꺼짐(3 × 일반가), 기록은 남고 알림은 닫힘', (await visited()).length === 0 && (await recs()).length === 1 && !(await vswQ().locator('input').isChecked())
            && !!l19 && l19.total === won(3 * g) && (await p.locator('#toast.on').count()) === 0, `${l19 ? l19.total : '(견적 없음)'} · 기록 ${(await recs()).length}`);
        }
      }
      // G7: a name only this clinic sells, at a first-visit price only (쁨 천안 on 2026-10-19 has 8): with the revisit item, not
      // visited both are priced; visited → its revisit price in, the first-visit one out (no price there: '일부만 되는 곳')
      const fvName = names.find((xs) => xs[0].r[0] === b && xs.every((x) => firstTag(x.r) && cls(x.r) === 'once'));
      if (!fvName) skip('G7', `${bname(b)}에서만 파는 첫 방문가 상품 — 이 자료엔 없음`);
      else {
        const n2 = S[fvName[0].r[2]], f2 = price(low(fvName).r);
        console.log(`G7: + ${n2} ${won(f2)} (첫 방문) @ ${bname(b)}`);
        await seed([{ t: 'k', k, q: 3 }, { t: 'r', n: n2, br: bkey(b), p: f2, q: 1, ov: {} }], where(b));
        q = await quote(b);
        ok(`G7 다녀옴 꺼짐: 3 × 일반가 + 첫 방문가, 스위치 '켜면 ${RV_DO}, ${FV_DO} 계산해요'`, !!q && q.lines.length === 2 && q.lines[0].total === won(3 * g) && q.lines[1].total === won(f2)
          && (await vswQ().innerText()).includes(`켜면 ${RV_DO}, ${FV_DO} 계산해요`), q ? `${q.lines.map((x) => x.total)} | ${await vswQ().innerText()}` : '(견적 없음)');
        if (await tap(vswQ().locator('label.switch'), 'G7b 다녀왔어요 스위치')) {
          await p.waitForTimeout(500);
          q = await quote(b);
          const l2 = q ? await p.$$eval('li.qrow .qbody .qline', (qs) => (qs[1] ? qs[1].innerText : '')) : '';
          ok('G7b 다녀옴 켬: 재방문가 + 2 × 일반가, 첫 방문가 상품은 이 지점에서 \'없음\'(펼친 견적은 일부만 되는 곳에서 그대로)', !!q && q.lines.length === 2 && q.lines[0].total === won(f + 2 * g)
            && q.lines[1].total === '' && /없음/.test(l2) && (await vswQ().locator('input').isChecked()), q ? `${q.lines.map((x) => x.total)} | ${l2.replace(/\n/g, ' / ').slice(0, 160)}` : '(견적 없음 — 펼친 줄이 사라짐)');
          ok(`G7c 빈 줄에 '${VIS_GONE}', 경고 '${FV_WARN(1)}'`, l2.includes(VIS_GONE) && !!q && q.warns.includes(FV_WARN(1)), q ? q.warns.join(' / ').slice(0, 200) : '');
          const cp = await copied(b);
          ok('G7d 견적 복사에도: \'이 지점에 없음 (다녀온 병원이라 …)\'과 ※ 경고', cp.includes(`- ${n2}: 이 지점에 없음 (${VIS_GONE})`) && cp.includes(`※ ${FV_WARN(1)}`), cp.replace(/\n/g, ' / ').slice(0, 300));
        }
      }
      // G9: the branch page's head — the switch where the branch has a revisit price, its state from this phone, set from there too
      await p.evaluate(() => localStorage.removeItem('pc:visited'));
      await p.goto(BASE + `#branch/${b}`); await p.waitForSelector('input[aria-label="이 지점에서 시술 찾기"]'); await p.waitForTimeout(300);
      const hv = p.locator('#main .card .visit').first();
      ok(`G9 지점 머리: '${VISIT}'(꺼짐)과 '켜면 내 견적에서 이 지점의 ${RV_DO}…'`, (await p.locator('#main .card .visit').count()) === 1 && !(await hv.locator('input').isChecked())
        && (await hv.innerText()).includes(`켜면 내 견적에서 이 지점의 ${RV_DO}`) && (await swH(hv.locator('label.switch'))) >= 44, (await p.locator('#main .card .visit').count()) ? `${await hv.innerText()} · ${await swH(hv.locator('label.switch'))}px` : '(없음)');
      if (await tap(hv.locator('label.switch'), 'G9b 지점 머리 스위치')) {
        await p.waitForTimeout(400);
        ok('G9b 지점 머리에서 켜면 저장되고 켜진 채로', JSON.stringify(await visited()) === JSON.stringify([bkey(b)]) && (await p.locator('#main .card .visit input').first().isChecked()), JSON.stringify(await visited()));
      }
      const noRvB = D.branches.map((_, i) => i).find((i) => !rvAll.some((r) => r[0] === i) && all.some((x) => x.r[0] === i));
      await p.goto(BASE + `#branch/${noRvB}`); await p.waitForSelector('input[aria-label="이 지점에서 시술 찾기"]'); await p.waitForTimeout(300);
      ok(`G9c 재방문 가격이 없는 지점(${bname(noRvB)}) 머리엔 스위치 없음`, (await p.locator('#main .visit').count()) === 0);
    }
    // G8: a first-visit price at a clinic marked visited (any key: a first-visit price cheapest, something else there too)
    const G8 = [...byKB.entries()].map(([key, xs]) => ({ key, xs, first: low(xs), rest: low(xs.filter((x) => !firstTag(x.r))) }))
      .find((o) => firstTag(o.first.r) && cls(o.first.r) === 'once' && o.rest && price(o.rest.r) > price(o.first.r) && noRv(o.xs) && firstOnly(o.first));
    if (!G8) skip('G8', '첫 방문가가 가장 싼 시술 — 이 자료엔 없음');
    else {
      const [k, bs] = G8.key.split('|'), b = +bs, f = price(G8.first.r), g = price(G8.rest.r), fn = S[G8.first.r[2]];
      console.log(`G8: ${k} @ ${bname(b)} · 첫 방문 ${fn} ${won(f)} → ${S[G8.rest.r[2]]} ${won(g)}`);
      await seed([{ t: 'k', k, q: 1 }], where(b));
      let l = await lineOf(b);
      ok(`G8 다녀옴 꺼짐: 첫 방문가, 스위치 '켜면 ${FV_DO} 계산해요'`, !!l && l.total === won(f) && (await vswQ().innerText()).includes(`켜면 ${FV_DO} 계산해요`) && !(await vswQ().innerText()).includes('재방문'),
        `${l ? l.total : '(견적 없음)'} · 기대 ${won(f)} | ${(await vswQ().count()) ? await vswQ().innerText() : '(스위치 없음)'}`);
      if (await tap(vswQ().locator('label.switch'), 'G8b 다녀왔어요 스위치')) {
        await p.waitForTimeout(500);
        l = await lineOf(b);
        ok('G8b 다녀옴 켬: 첫 방문가는 빼고 그다음 가격', !!l && l.total === won(g) && !l.m.startsWith(fn), l ? `${l.total} · 기대 ${won(g)} | ${l.m.slice(0, 100)}` : '(견적 없음)');
        const q8 = await quote(b);
        ok(`G8e 경고 '${FV_WARN(1)}'`, !!q8 && q8.warns.includes(FV_WARN(1)), q8 ? q8.warns.join(' / ').slice(0, 200) : '');
        const opt = await p.$$eval('li.qrow .qline select option', (os, n) => os.filter((o) => o.textContent.startsWith(n)).map((o) => [o.disabled, o.textContent]), fn);
        ok('G8c 지점 옵션: 첫 방문가는 고를 수 없고 \'(다녀온 병원: 빠짐)\'', !opt.length || opt.every(([d, t]) => d && t.includes('(다녀온 병원: 빠짐)')), JSON.stringify(opt).slice(0, 200));
      }
      // it.done already leaves the first-visit price out: the clinic switch changes nothing there, so it is not shown
      await seed([{ t: 'k', k, q: 1, done: true }], where(b));
      ok('G8d 받아 봤어요 켬: 첫 방문가는 이미 빠져 다녀왔어요 스위치 없음', (await lineOf(b)) && (await vswQ().count()) === 0, `스위치 ${await vswQ().count()}`);
    }
    // G10: a '[재진]' name (데이뷰 인천구월점 on 2026-10-19) only revisit rows have: no price and no clinic to open, so the item
    // has the clinic's switch; on → its price. Its price sheet and the legend say how the cart counts it.
    const rvOnly = (xs) => xs.every((x) => cls(x.r) === 'revisit');
    const G10 = names.find((xs) => rvOnly(xs) && /^\s*\[재진\]/.test(S[xs[0].r[2]])) || names.find(rvOnly);
    if (!G10) skip('G10', '재방문 가격만 있는 이름 — 이 자료엔 없음');
    else {
      const r = low(G10).r, b = r[0], n = S[r[2]], f = price(r);
      console.log(`G10: ${n} @ ${bname(b)} · ${won(f)}`);
      await seed([{ t: 'r', n, br: bkey(b), p: f, q: 1, ov: {} }]);
      const isw = p.locator('.ci .cdone label.switch', { hasText: VISIT });
      ok(`G10 재방문 가격만 있는 상품: 가능한 지점 없음, 담은 시술 줄에 '${VISIT} · ${bname(b)}'`, (await text('.ci .cp')).includes('가능한 지점 없음') && !(await text('.ci .cp')).includes(won(f))
        && (await isw.count()) === 1 && (await isw.innerText()).includes(bname(b)), `${await text('.ci .cp')} | ${await text('.ci')}`);
      if (await tap(isw, 'G10b 스위치')) {
        await p.waitForTimeout(500);
        ok('G10b 켜면 그 가격, 저장', (await text('.ci .cp')).includes(won(f)) && JSON.stringify(await visited()) === JSON.stringify([bkey(b)]), await text('.ci .cp'));
      }
      // the price sheet of that row on its branch page: the badge (its title: the clinic switch), the conditions
      await p.goto(BASE + `#branch/${b}`); await p.waitForSelector('input[aria-label="이 지점에서 시술 찾기"]');
      ok('G10c 지점 머리 스위치는 켜진 채로(같은 기기 기록)', (await p.locator('#main .card .visit input').count()) === 1 && (await p.locator('#main .card .visit input').first().isChecked()));
      await p.fill('input[aria-label="이 지점에서 시술 찾기"]', n); await p.waitForTimeout(400);
      const item = p.locator('#main .card.flush li .item', { hasText: n }).filter({ has: p.locator('.k.kt', { hasText: '재방문만' }) }).first();
      const title = (await item.count()) ? await item.locator('.k.kt', { hasText: '재방문만' }).first().getAttribute('title') : '';
      ok(`G10d 지점 가격표: '재방문만' 배지, 설명에 '${RV_CART}'`, !!title && title.includes(RV_CART) && !title.includes(DONE), title || '(줄 없음)');
      if (await tap(item.locator('xpath=..').locator(':scope > .infob'), 'G10e 가격 근거')) {   // the line's ⓘ (위계 점검 47)
        await p.waitForSelector('.sheet[aria-label="가격 확인"]');
        const st_ = await p.locator('.sheet[aria-label="가격 확인"]').textContent();
        ok(`G10e 가격 확인: 조건 '재방문(다시 오는 손님)만', 가격 종류에 '${RV_CART}', 적용 조건 '다시 오는 손님만'`, st_.includes('재방문(다시 오는 손님)만') && st_.includes(`다시 오는 손님(재방문)만 받는 행사 가격 · ${RV_CART}`)
          && (r[5] !== 2 || st_.includes('한정가(기간·수량·첫 방문·재방문 등 조건)')) && st_.includes('다시 오는 손님만') && !st_.includes('재방문도 되는지 확인') && !st_.includes(DONE), st_.slice(0, 200));
        await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      }
      // G10f: a revisit 체험가 ('[재진] 1회 체험', user decision 2026-10-19) is priced only at a clinic marked visited AND for a
      // treatment not had before: marked, the item has '전에 이 시술을 받아 봤어요'; on → no price, the clinic's switch stays on and
      // says why; off → its price again. Had before and not marked: turning the clinic on changes nothing, so no clinic switch
      if (r[5] !== 1) skip('G10f', `${n}: 체험가가 아닌 재방문 가격`);
      else {
        await seed([{ t: 'r', n, br: bkey(b), p: f, q: 1, ov: {} }], { visited: [bkey(b)] });
        const dsw = p.locator('.ci .cdone label.switch', { hasText: DONE }), vsw = p.locator(`.ci .visit[data-vb="${b}"]`);
        ok(`G10f 다녀옴 켬: 그 가격, 담은 시술 줄에 '${DONE}'(꺼짐)`, (await text('.ci .cp')).includes(won(f)) && (await dsw.count()) === 1 && !(await dsw.locator('input').isChecked()), `${await text('.ci .cp')} | ${await text('.ci')}`);
        if (await tap(dsw, 'G10g 받아 봤어요 스위치')) {
          await p.waitForTimeout(500);
          const done = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:carts'))[0].items[0].done);
          ok('G10g 받아 봤어요 켬: 재방문 체험가는 빠져 \'가능한 지점 없음\', 다녀왔어요 스위치는 켜진 채 \'전에 받아 본 시술이라 계산에서 뺐어요\', 저장(done)', (await text('.ci .cp')).includes('가능한 지점 없음') && !(await text('.ci .cp')).includes(won(f))
            && (await vsw.count()) === 1 && (await vsw.locator('input').isChecked()) && (await vsw.innerText()).includes('전에 받아 본 시술이라 계산에서 뺐어요') && done === true && JSON.stringify(await visited()) === JSON.stringify([bkey(b)]),
            `${await text('.ci .cp')} | ${(await vsw.count()) ? await vsw.innerText() : '(스위치 없음)'} | done ${done}`);
          await tap(dsw, 'G10h 받아 봤어요 스위치'); await p.waitForTimeout(500);
          ok('G10h 받아 봤어요 끄면 다시 그 가격(다녀옴은 켜진 채)', (await text('.ci .cp')).includes(won(f)) && (await vsw.locator('input').isChecked()), await text('.ci .cp'));
        }
        await seed([{ t: 'r', n, br: bkey(b), p: f, q: 1, ov: {}, done: true }]);
        ok('G10i 받아 봤어요 켬 + 다녀옴 꺼짐: 가능한 지점 없음, 켜도 바뀌는 게 없어 다녀왔어요 스위치 없음(받아 봤어요는 켜진 채)', (await text('.ci .cp')).includes('가능한 지점 없음') && (await vsw.count()) === 0
          && (await dsw.count()) === 1 && (await dsw.locator('input').isChecked()), await text('.ci'));
      }
    }
    // G10j: a key whose only price at a clinic is a revisit 체험가 (볼링크 '[재진] 1회 체험' at 데이뷰 인천구월점 on 2026-10-19), with a
    // second key the clinic sells at plain prices only (so the clinic is in '일부만 되는 곳'): the quote's '이 병원에 다녀왔어요' and the
    // reason the option can't be picked follow '전에 이 시술을 받아 봤어요' (visitStake, Pricing.canTake) — off: '켜면 재방문 가격은
    // 넣고…' and '(다녀왔어요를 켜면)'; on: no revisit words, the clinic marked or not (it would stay out), and '(받아 봤어요: 빠짐)'
    const J = (() => { for (const [key, xs] of byKB) {
      const [k, bs] = key.split('|'), b = +bs;
      if (!xs.every((x) => cls(x.r) === 'revisit' && P.isTrial(x.r[5], S[x.r[6]]))) continue;
      for (const [key2, ys] of byKB) { const [k2, b2] = key2.split('|');
        if (+b2 === b && k2 !== k && ys.every((y) => cls(y.r) === '')) return { k, b, k2, rv: low(xs).r }; } }
      return null; })();
    if (!J) skip('G10j', '한 지점에서 재방문 체험가만 있는 비교 시술 + 그 지점의 일반가 시술 — 이 자료엔 없음');
    else {
      const { k, b, k2 } = J, rn = S[J.rv[2]];
      console.log(`G10j: ${k}(${rn} ${won(price(J.rv))}) + ${k2} @ ${bname(b)}`);
      const quotePart = async () => {   // the clinic comparison, '일부만 되는 곳' opened, then the quote of b
        if (await p.locator('.cartsum button[aria-expanded="false"]').count()) { await p.locator('.cartsum button[aria-expanded="false"]').click(); await p.waitForTimeout(400); }
        const pb = p.locator('button.morelist[aria-expanded="false"]', { hasText: '일부만 되는 곳' });
        if (await pb.count()) { await pb.first().click(); await p.waitForTimeout(300); }
        return quote(b);
      };
      const optsJ = () => p.$$eval('li.qrow .qline select option', (os, n) => os.filter((o) => o.textContent.startsWith(n)).map((o) => [o.disabled, o.textContent]), rn);
      const swTxt = async () => ((await vswQ().count()) ? vswQ().innerText() : '');
      for (const [nm, done, vis, why] of [['G10j 받아 봤어요 꺼짐 · 다녀옴 꺼짐', false, false, '(다녀왔어요를 켜면)'], ['G10k 받아 봤어요 켬 · 다녀옴 꺼짐', true, false, '(받아 봤어요: 빠짐)'],
        ['G10l 받아 봤어요 켬 · 다녀옴 켬', true, true, '(받아 봤어요: 빠짐)']]) {
        await seed([{ t: 'k', k, q: 1, ...(done ? { done: true } : {}) }, { t: 'k', k: k2, q: 1 }], { ...where(b), ...(vis ? { visited: [bkey(b)] } : {}) });
        const q = await quotePart(), sw = await swTxt(), opt = await optsJ();
        const swOk = done ? !sw.includes('재방문') : sw.includes(`켜면 ${RV_DO}`);
        ok(`${nm}: 견적 스위치 ${done ? '문구에 재방문 없음(켜도 들어가지 않음)' : `'켜면 ${RV_DO}…'`}, 체험가 옵션은 고를 수 없고 '${why}'`, !!q && swOk && opt.length > 0 && opt.every(([d, t]) => d && t.includes('· 재방문') && t.endsWith(why)),
          `${q ? '' : '(견적 없음) '}스위치 '${sw.replace(/\s+/g, ' ')}' | ${JSON.stringify(opt).slice(0, 160)}`);
      }
      await seed([{ t: 'k', k, q: 1 }, { t: 'k', k: k2, q: 1 }], { ...where(b), visited: [bkey(b)] });
      const qm = await quotePart(), lm = qm && qm.lines[0];
      ok('G10m 받아 봤어요 꺼짐 · 다녀옴 켬: 체험가로 계산, 견적 스위치 켜짐 \'재방문 가격은 넣고…\'', !!lm && lm.total === won(price(J.rv)) && (await swTxt()).includes(RV_DO) && !(await swTxt()).includes('켜면')
        && (await vswQ().locator('input').isChecked()), lm ? `${lm.total} · 기대 ${won(price(J.rv))} | ${(await swTxt()).replace(/\s+/g, ' ')}` : '(견적 없음)');
    }
    // G12: the same name ×2 — one revisit price can't price the 2nd session (round-2 R14: the line is incomplete, no total), so the
    // item has no price either way: the switch stays when on (so it can be turned off), its words say what is missing; by keyboard
    // the focus stays on it
    if (G10) {
      const r = low(G10).r, b = r[0], n = S[r[2]], f = price(r);
      await seed([{ t: 'r', n, br: bkey(b), p: f, q: 2, ov: {} }]);
      const isw = p.locator('.ci .visit label.switch', { hasText: VISIT });
      ok('G12 재방문 가격만 있는 상품 ×2, 꺼짐: 스위치(44px 이상), 가능한 지점 없음', (await isw.count()) === 1 && !(await isw.locator('input').isChecked()) && (await swH(isw)) >= 44 && (await text('.ci .cp')).includes('가능한 지점 없음'),
        `${await text('.ci .cp')} · ${await swH(isw)}px`);
      if (await isw.count()) {
        await isw.locator('input').focus(); await p.keyboard.press('Space'); await p.waitForTimeout(500);
        const foc = await p.evaluate(() => { const a = document.activeElement; return a ? a.getAttribute('aria-label') || a.tagName : ''; });
        ok(`G12b 켜도 스위치가 남고(켜짐) '1회 ${won(f)}만 확인 · 1회는 가격 없음', 초점은 그 스위치에`, (await isw.count()) === 1 && (await isw.locator('input').isChecked()) && (await text('.ci .visit')).includes(`1회 ${won(f)}만 확인 · 1회는 가격 없음`)
          && (await text('.ci .cp')).includes('가능한 지점 없음') && foc === `${VISIT} · ${bname(b)}` && JSON.stringify(await visited()) === JSON.stringify([bkey(b)]), `${await text('.ci .visit')} | 초점 ${foc}`);
        await tap(isw, 'G12c 스위치'); await p.waitForTimeout(500);
        ok('G12c 다시 끌 수 있음(저장에서도 빠짐)', (await isw.count()) === 1 && !(await isw.locator('input').isChecked()) && (await visited()).length === 0);
      }
    }
    // G13 / G14: a clinic (no revisit price) where every price of a key is a first-visit one; another clinic of its brand in its
    // region sells the key too. Alone in the cart, marking the clinic takes it out of the comparison: the item line keeps its
    // switch (on screen, a toast with undo), the branch page has it too. With a key the clinic sells at a plain price, it moves
    // to '일부만 되는 곳': that list opens, the switch stays where it was, and back.
    const rvB = new Set(rvAll.map((r) => r[0]));
    const kBr = new Map(); for (const key of byKB.keys()) { const [k, bs] = key.split('|'); if (!kBr.has(k)) kBr.set(k, []); kBr.get(k).push(+bs); }
    const area = (x) => `${D.branches[x][0]}|${D.branches[x][5]}`;
    const T = [...byKB.entries()].map(([key, xs]) => { const [k, bs] = key.split('|'); return { k, b: +bs, xs }; })
      .filter((o) => !rvB.has(o.b) && o.xs.every((x) => firstTag(x.r) && cls(x.r) === 'once') && kBr.get(o.k).some((y) => y !== o.b && area(y) === area(o.b)))
      .map((o) => ({ ...o, k1: ([...byKB.entries()].find(([kk, ys]) => kk.endsWith(`|${o.b}`) && !kk.startsWith(`${o.k}|`) && ys.every((y) => cls(y.r) === '')) || [''])[0].split('|')[0] }))
      .find((o) => o.k1);
    if (!T) skip('G13', '첫 방문가만 있는 지점(같은 브랜드·지역 다른 지점도 팖) + 그 지점의 일반가 시술 — 이 자료엔 없음');
    else {
      const B = T.b, swQ = () => p.locator(`li.qrow .qbody > .visit[data-vb="${B}"]`), isw = p.locator(`.ci .visit[data-vb="${B}"]`);
      console.log(`G13: ${T.k} @ ${bname(B)} (첫 방문가만) · G14 + ${T.k1}`);
      await seed([{ t: 'k', k: T.k, q: 1 }], where(B));
      await quote(B);
      ok(`G13 꺼짐: 견적 스위치 '켜면 ${FV_DO} 계산해요', 담은 시술 줄엔 스위치 없음`, (await swQ().count()) === 1 && (await swQ().innerText()).includes(`켜면 ${FV_DO} 계산해요`) && (await isw.count()) === 0);
      if (await swQ().count()) {
        await swQ().evaluate((v) => v.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
        await tap(swQ().locator('label.switch'), 'G13b 스위치'); await p.waitForTimeout(500);
        const bx = (await isw.count()) ? await isw.boundingBox() : null, vh = p.viewportSize().height;
        ok('G13b 켜면 비교에서 빠지고, 담은 시술 줄에 켜진 스위치 \'첫 방문가만 있어요\'(화면 안), 알림 \'견적 비교에서 빠졌어요\' + 되돌리기',
          (await qIdx(B)) < 0 && (await isw.count()) === 1 && (await isw.locator('input').isChecked()) && (await isw.innerText()).includes('첫 방문가만 있어요') && !!bx && bx.y >= 0 && bx.y + bx.height <= vh
          && (await text('#toast')).includes('견적 비교에서 빠졌어요') && (await p.locator('#toast button', { hasText: '되돌리기' }).count()) === 1, `${bx && Math.round(bx.y)} | ${await text('#toast')}`);
        const tb = await p.locator('#toast button').boundingBox().catch(() => null), tt = await p.locator('#toast').boundingBox().catch(() => null);
        ok('G13f 긴 알림도 \'되돌리기\'가 잘리지 않음(알림 상자 안, 화면 안)', !!tb && !!tt && tb.x >= tt.x && tb.x + tb.width <= tt.x + tt.width + 0.5 && tt.x >= 0 && tt.x + tt.width <= p.viewportSize().width,
          tb && tt ? `버튼 ${Math.round(tb.x)}~${Math.round(tb.x + tb.width)} · 상자 ${Math.round(tt.x)}~${Math.round(tt.x + tt.width)}` : '(없음)');
        await tap(p.locator('#toast button', { hasText: '되돌리기' }), 'G13c 되돌리기'); await p.waitForTimeout(500);
        ok('G13c 되돌리면 다시 목록에, 저장에서도 빠짐', (await qIdx(B)) >= 0 && (await visited()).length === 0 && (await isw.count()) === 0);
        await quote(B); await tap(swQ().locator('label.switch'), 'G13d 스위치'); await p.waitForTimeout(500);
        await p.goto(BASE + `#branch/${B}`); await p.waitForSelector('input[aria-label="이 지점에서 시술 찾기"]'); await p.waitForTimeout(300);
        const hv = p.locator('#main .card .visit');
        ok(`G13d 다녀옴으로 켠 지점은 재방문 가격이 없어도 머리에 켜진 스위치 '내 견적에서 이 지점의 ${FV_DO} 계산해요'`, (await hv.count()) === 1 && (await hv.locator('input').isChecked())
          && (await hv.innerText()).includes(`내 견적에서 이 지점의 ${FV_DO} 계산해요`) && !(await hv.innerText()).includes('재방문'), (await hv.count()) ? await hv.innerText() : '(없음)');
        if (await tap(hv.locator('label.switch'), 'G13e 지점 머리 스위치')) {
          await p.waitForTimeout(400); await openCart(); await p.waitForTimeout(200);
          ok('G13e 지점 머리에서 끄면 견적 비교로 돌아옴', (await visited()).length === 0 && (await quote(B)) !== null);
        }
      }
      await seed([{ t: 'k', k: T.k1, q: 1 }, { t: 'k', k: T.k, q: 1 }], where(B));
      await quote(B);
      const inPart = () => p.evaluate((b) => { const v = document.querySelector(`li.qrow .qbody > .visit[data-vb="${b}"]`); const ul = v && v.closest('ul');
        return !!ul && !!ul.previousElementSibling && ul.previousElementSibling.matches('button.morelist[aria-expanded]'); }, B);
      if (await swQ().count()) {
        await swQ().evaluate((v) => v.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
        const y0 = (await swQ().boundingBox()).y, part0 = await inPart();
        await tap(swQ().locator('label.switch'), 'G14 스위치'); await p.waitForTimeout(600);
        const y1 = (await swQ().count()) ? (await swQ().boundingBox()).y : null;
        ok('G14 켜면 \'일부만 되는 곳\'으로 옮겨 그 목록이 열리고, 스위치는 손가락 밑 그대로(±2px), 알림 \'일부만 되는 곳으로 옮겼어요\'', !part0 && (await inPart()) && y1 != null && Math.abs(y1 - y0) <= 2
          && (await partBtn('일부만 되는 곳 접기').count()) === 1 && (await text('#toast')).includes('일부만 되는 곳으로 옮겼어요'), `y ${Math.round(y0)} → ${y1 && Math.round(y1)} · ${await text('#toast')}`);
        await tap(swQ().locator('label.switch'), 'G14b 스위치'); await p.waitForTimeout(600);
        const y2 = (await swQ().count()) ? (await swQ().boundingBox()).y : null;
        ok('G14b 끄면 \'모두 받을 수 있는 곳\'으로 돌아오고 스위치는 그대로(±2px)', !(await inPart()) && y2 != null && Math.abs(y2 - y0) <= 2 && (await text('#toast')).includes('모두 받을 수 있는 곳으로 옮겼어요'),
          `y ${Math.round(y0)} → ${y2 && Math.round(y2)} · ${await text('#toast')}`);
      } else ok('G14 견적 스위치 (없음)', false);
      // G14d: the same cart across every region and brand: the list it moves to may be longer than what is drawn (40 / 30) — an
      // opened quote is drawn there anyway, its switch where it was
      await seed([{ t: 'k', k: T.k1, q: 1 }, { t: 'k', k: T.k, q: 1 }]);
      await quote(B);
      if (await swQ().count()) {
        await swQ().evaluate((v) => v.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
        const y0 = (await swQ().boundingBox()).y;
        await tap(swQ().locator('label.switch'), 'G14d 스위치'); await p.waitForTimeout(600);
        const at = await p.evaluate((b) => { const v = document.querySelector(`li.qrow .qbody > .visit[data-vb="${b}"]`); const li = v && v.closest('li'); return li ? [...li.parentNode.children].indexOf(li) : -1; }, B);
        const y1 = (await swQ().count()) ? (await swQ().boundingBox()).y : null;
        console.log(`G14d: 전국 · ${bname(B)} → 일부만 되는 곳 ${at + 1}번째`);
        ok(`G14d 전국: 옮겨 간 견적은 목록 몇째든 남고(${at + 1}번째) 스위치는 그대로(±2px)`, at >= 0 && y1 != null && Math.abs(y1 - y0) <= 2 && (await inPart()), `y ${Math.round(y0)} → ${y1 && Math.round(y1)}`);
      }
    }
    // G14c: a clinic that stays in '모두 받을 수 있는 곳' when marked (a key with a first-visit and a plain price there, and a key it
    // sells at a plain price that another clinic of its area selling the first one does not — so '일부만 되는 곳' has someone):
    // that list stays closed and no toast
    const keysAt = new Map(); for (const [k, bs] of kBr) for (const x of bs) { if (!keysAt.has(x)) keysAt.set(x, new Set()); keysAt.get(x).add(k); }
    const S14 = (() => { for (const [key, xs] of byKB) {
      const [kx, cs] = key.split('|'), C = +cs;
      if (rvB.has(C) || !xs.some((x) => firstTag(x.r) && cls(x.r) === 'once') || !xs.some((x) => cls(x.r) === '' && !firstTag(x.r))) continue;
      const others = kBr.get(kx).filter((y) => y !== C && area(y) === area(C));
      for (const ky of keysAt.get(C)) { if (ky === kx) continue; const ys = byKB.get(`${ky}|${C}`);
        if (ys.every((y) => cls(y.r) === '') && others.some((y) => !keysAt.get(y).has(ky))) return { C, kx, ky }; } } return null; })();
    if (!S14) skip('G14c', '다녀옴을 켜도 모두 받을 수 있는 곳에 남는 지점 + 일부만 되는 곳 — 이 자료엔 없음');
    else {
      const { C, kx, ky } = S14, sw = p.locator(`li.qrow .qbody > .visit[data-vb="${C}"]`);
      console.log(`G14c: ${kx} + ${ky} @ ${bname(C)}`);
      await seed([{ t: 'k', k: kx, q: 1 }, { t: 'k', k: ky, q: 1 }], where(C));
      await quote(C);
      const more = partBtn();
      if (await tap(sw.locator('label.switch'), 'G14c 스위치')) {
        await p.waitForTimeout(500);
        ok('G14c 목록을 옮기지 않으면 \'일부만 되는 곳\'은 닫힌 채, 옮김 알림 없음', (await more.count()) === 1 && (await more.innerText()).includes('보기') && (await sw.locator('input').isChecked())
          && !(await text('#toast')).includes('옮겼어요'), `${(await more.count()) ? await more.innerText() : '(버튼 없음)'} | ${await text('#toast')}`);
      }
    }
    // G17: the branch page head of a clinic with a revisit price, with 특가 포함 off (the cart takes neither kind there): no switch
    // to turn on; marked visited, it is there to turn off and says '(특가 포함일 때)'. G18: 병원 패키지 — a revisit package only at
    // a clinic marked visited
    const rv17 = rvAll.find((r) => live(r)), RB = rv17[0];
    await seed([{ t: 'r', n: S[rv17[2]], br: bkey(RB), p: price(rv17), q: 1, ov: {} }], { special: false });
    await p.goto(BASE + `#branch/${RB}`); await p.waitForSelector('input[aria-label="이 지점에서 시술 찾기"]'); await p.waitForTimeout(300);
    const n17 = await p.locator('#main .card .visit').count();
    await p.evaluate((k) => localStorage.setItem('pc:visited', JSON.stringify([k])), bkey(RB)); await p.reload(); await ready(); await p.waitForSelector('input[aria-label="이 지점에서 시술 찾기"]'); await p.waitForTimeout(300);
    const hv17 = p.locator('#main .card .visit');
    ok(`G17 특가 포함 끔: ${bname(RB)} 머리에 스위치 없음, 다녀옴으로 켠 뒤엔 켜진 스위치와 '…계산해요(특가 포함일 때)'`, n17 === 0 && (await hv17.count()) === 1 && (await hv17.locator('input').isChecked())
      && (await hv17.innerText()).includes('계산해요(특가 포함일 때)'), `처음 ${n17} | ${(await hv17.count()) ? await hv17.innerText() : '(없음)'}`);
    // the cart's two keys: for the package's first two '+' parts, a key whose family (meta.fam, the app's famOf: the first family
    // that lists it) reads that part — how 병원 패키지 matches a part when the build gave it no keys (Pricing.matchPackage)
    const FAMS = (D.meta.fam || []).map(([, rx, vs]) => { let re; try { re = new RegExp(rx); } catch (e) { re = /$^/; } return { test: (x) => re.test(x) || re.test(String(x).replace(/\s+/g, '')), vs: vs.map((v) => v[0]) }; });
    const keyIds = new Set(D.keys.map((x) => x[0])), famKey = new Map(); FAMS.forEach((f, fi) => f.vs.forEach((id) => { if (keyIds.has(id) && !famKey.has(id)) famKey.set(id, fi); }));
    const pkKeys = (name) => { const out = []; for (const part of name.split(/\s*\+\s*/).map((x) => x.replace(/\[[^\]]*\]\s*/g, '').trim()).slice(0, 2)) {
      const e = [...famKey.entries()].find(([id, fi]) => !out.includes(id) && FAMS[fi].test(part)); if (e) out.push(e[0]); } return out.length === 2 ? out : null; };
    const pk = rvAll.find((r) => live(r) && S[r[2]].includes('+') && pkKeys(S[r[2]]));
    if (!pk) skip('G18', '두 시술이 묶인 재방문 패키지 — 이 자료엔 없음');
    else {
      const [k1, k2] = pkKeys(S[pk[2]]), pb = pk[0], pn = S[pk[2]];
      console.log(`G18: ${pn} @ ${bname(pb)} · ${k1} + ${k2}`);
      const pkgTxt = async () => { await openCart(); await p.locator('.cartsum button[aria-expanded="false"]').click(); await p.waitForTimeout(300);
        await tap(p.locator('.seg button', { hasText: '병원 패키지' }), '병원 패키지'); await p.waitForTimeout(400); return mainTxt(); };
      await seed([{ t: 'k', k: k1, q: 1 }, { t: 'k', k: k2, q: 1 }], where(pb));
      const off = (await pkgTxt()).includes(pn);
      await p.evaluate((k) => localStorage.setItem('pc:visited', JSON.stringify([k])), bkey(pb));
      const on = (await pkgTxt()).includes(pn);
      ok('G18 병원 패키지: 재방문 패키지는 다녀옴으로 켠 병원에서만', !off && on, `꺼짐 ${off} · 켬 ${on}`);
    }
    // the legend: '재방문만' and how the cart counts it, and the 한정가 words (C to check them)
    await p.goto(BASE + '#about'); await p.waitForTimeout(400);
    ok(`G11 가격 종류 설명: '재방문만'에 '${RV_CART}(첫 1회만)', 한정가에 '재방문(다시 오는 손님)'`, (await p.$$eval('#main dl.kv dt .k.kt', (ks) => ks.map((k) => k.textContent))).includes('재방문만')
      && (await mainTxt()).includes(`그 병원에 다시 오는 손님만 받는 가격. ${RV_CART}(첫 1회만)`) && (await mainTxt()).includes('기간·수량·첫 방문·재방문(다시 오는 손님) 등 조건이 붙은 가격'));
  }

  // ---- H. the home's note says '보통 1인 1회', as 마이 설정 and the glossary do (C to check the words; any data)
  await p.goto(BASE + '#home'); await p.waitForTimeout(400);
  ok('H 홈 아래 문장: \'체험가·한정가는 보통 1인 1회예요\'', (await p.locator('#main p.foot', { hasText: '체험가·한정가는 보통 1인 1회예요' }).count()) === 1);

  ok('요일·시간 칸이 있는 자료에서 A·C·E를 건너뛰지 않음', !WHEN || !SK.some((n) => ['A', 'C', 'E'].includes(n)), SK.join(', '));
  ok('건너뛰지 않은 경우가 있음', SK.filter((n) => ['A', 'B1', 'B3', 'C', 'D', 'E'].includes(n)).length < 6, SK.join(', '));
  ok('스크립트 오류 없음', !errs.length, errs.join(' '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await br.close(); process.exitCode = R.every(Boolean) ? 0 : 1;
})().catch((e) => { console.error(e); process.exit(1); });
