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

(async () => {
  const D = asRows(await (await fetch(BASE + 'data.json')).json()), S = D.s, td = ymd(new Date());
  const WHEN = P.hasWhenFields(D);
  const days = (r) => (WHEN ? r[16] || 0 : 0), hours = (r) => (WHEN ? S[r[17]] || '' : '');
  const cls = (r) => P.condClass(r[5], S[r[6]], days(r), hours(r));
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
  // the clinic comparison, then the quote of branch b opened: its line texts [{head, total, m}]
  const quote = async (b) => {
    if ((await p.locator('.cartsum button[aria-expanded="false"]').count())) { await p.locator('.cartsum button[aria-expanded="false"]').click(); await p.waitForTimeout(400); }
    const n = await p.$$eval('li.qrow', (lis, nm) => lis.findIndex((li) => { const s = li.querySelector('.rank .b span:last-child'); return s && s.textContent === nm; }), bname(b));
    if (n < 0) return null;
    const li = p.locator('li.qrow').nth(n);
    if (!(await li.locator('.qbody').count())) { await li.locator('button.rank').click(); await p.waitForTimeout(300); }
    const at = p.locator('li.qrow').nth(n);
    return at.evaluate((x) => ({ lines: [...x.querySelectorAll('.qline')].map((q) => ({ total: (q.querySelector('.row b.num') || {}).textContent || '', m: (q.querySelector('.m') || {}).textContent || '' })),
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
    .find((o) => cls(o.first.r) === 'once' && o.plain && !o.xs.some((x) => cls(x.r) === 'repeat') && price(o.plain.r) > price(o.first.r));
  if (!B1) skip('B1', '1회 가격 + 일반가 — 이 자료엔 없음');
  else {
    const [k] = B1.key.split('|'), b = B1.first.r[0], f = price(B1.first.r), g = price(B1.plain.r);
    console.log(`B1: ${k} @ ${bname(b)} · ${S[B1.first.r[2]]} ${won(f)} → ${S[B1.plain.r[2]]} ${won(g)}`);
    await seed([{ t: 'k', k, q: 3 }], where(b));
    const q = await quote(b), ln = q && q.lines[0];
    ok('B1 1회 가격은 첫 회만: 1회 가격 + 2 × 일반가(예전 그대로)', !!ln && ln.total === won(f + 2 * g) && ln.total !== won(3 * f) && !ln.m.includes(REPEAT_TXT), ln ? `${ln.total} · 기대 ${won(f + 2 * g)} | ${ln.m}` : '(견적 없음)');
    ok(`B2 견적 경고: '${LATER}, 2회째부터는 이 지점의 다른 가격으로'`, !!q && q.warns.some((w) => w.startsWith(`${LATER}, 2회째부터는 이 지점의 다른 가격으로`)), q ? q.warns.join(' / ') : '');
    ok('B2b 견적 줄에 2회째부터 쓰는 가격의 이름', !!ln && ln.m.includes(`2회째부터 ${S[B1.plain.r[2]]}`), ln ? ln.m.slice(0, 200) : '');
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
    .filter((o) => cls(o.first.r) === 'once' && o.next && price(o.next.r) > price(o.first.r));
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
    // the later sessions' price is named, and the repeat words come after it (they are about it, not the once price)
    const nm2 = `2회째부터 ${S[C.next.r[2]]}`, m = ln ? ln.m : '';
    ok('C2b 견적 줄: \'2회째부터 <다음 가격 이름>\'' + (repeat ? ' 뒤에 매번 문구' : ''), m.includes(nm2) && (!repeat || m.lastIndexOf(REPEAT_TXT) > m.indexOf(nm2)), m.slice(0, 220));
    ok('C2c 경고: 1회 가격은 첫 1회만', !!q && q.warns.some((w) => w.startsWith(LATER)), q ? q.warns.join(' / ') : '');
    const cp = await copied(b), cl = cp.split('\n').find((x) => x.startsWith('- ')) || '';
    ok('C2d 견적 복사: 2회째부터 쓰는 가격 이름' + (repeat ? '과 \'2회째부터 방문일·시간 조건이 맞을 때 매번 이 가격\'' : '') + ', ※ 1회 가격은 첫 1회만',
      cl.includes(nm2) && (!repeat || cl.includes(`2회째부터 ${REPEAT_TXT}`)) && cp.includes(`※ ${LATER}`), cp.slice(0, 300).replace(/\n/g, ' / '));
    if (!(await tap(swc, 'C3 스위치'))) { ok('스크립트 오류 없음', !errs.length, errs.join(' ')); console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await br.close(); process.exitCode = 1; return; }
    await p.waitForTimeout(500);
    q = await quote(b); ln = q && q.lines[0];
    ok('C3 켬: 1회 가격을 쓰지 않음 — 3 × 다음 가격', !!ln && ln.total === won(3 * g) && !ln.m.includes(S[C.first.r[2]]), ln ? `${ln.total} · 기대 ${won(3 * g)} | ${ln.m.slice(0, 80)}` : '(견적 없음)');
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
    .find((o) => cls(o.first.r) === 'once' && o.plain && !o.xs.some((x) => cls(x.r) === 'repeat') && price(o.plain.r) > price(o.first.r) && firstOnly(o.first));
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
    ok('E2 견적 줄: 2회째 가격 이름 뒤에 \'시간 확인 필요\'', !!ln && ln.m.indexOf('시간 확인 필요', ln.m.indexOf(`2회째부터 ${S[r2[2]]}`)) > 0, ln ? ln.m.slice(0, 220) : '');
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

  ok('요일·시간 칸이 있는 자료에서 A·C·E를 건너뛰지 않음', !WHEN || !SK.some((n) => ['A', 'C', 'E'].includes(n)), SK.join(', '));
  ok('건너뛰지 않은 경우가 있음', SK.filter((n) => ['A', 'B1', 'B3', 'C', 'D', 'E'].includes(n)).length < 6, SK.join(', '));
  ok('스크립트 오류 없음', !errs.length, errs.join(' '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await br.close(); process.exitCode = R.every(Boolean) ? 0 : 1;
})().catch((e) => { console.error(e); process.exit(1); });
