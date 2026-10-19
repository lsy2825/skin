// The visit-condition badges on screen. '평일 낮' (weekday-only prices: 평일 낮·화수목·평일 해피아워…) reads '평일·시간 한정',
// '시간대' (C #83: a time window on any day) reads '정해진 시간만' (Pricing.condLabel; the tag ids in data.json stay), the legend,
// data notes, visit-date sheet and price sheet use the same words, and the visit date filters these rows: weekend → '방문일엔 안 됨',
// a weekday → valid, a weekday with a time the app can't check → '시간 확인 필요', unless the name says the hour does not matter.
// With the site's days / hours (data.json fields 16-17, C #71) the app checks them itself: a 화수목 price is '방문일엔 안 됨' on a
// Monday, a price with hours outside them, and the price sheet lists '되는 요일: …' / '되는 시간: …'. Every expectation is read from
// the data the app was served: checks for fields or tags the file does not have print SKIP (older data.json keeps working).
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/cond_badge.js
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const asRows = require('./rows');
const P = require(path.join(__dirname, '../../app/domain/pricing.js'));
const { KR_HOLIDAYS } = P;
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const skip = (name, why) => console.log(`SKIP | ${name} | ${why}`);
const LABEL = '평일·시간 한정', SLOT = '정해진 시간만';
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// the next day (from tomorrow) with this weekday that is not a public holiday
const nextDay = (dow) => { const d = new Date(); for (let i = 1; i < 15; i++) { d.setDate(d.getDate() + 1); if (d.getDay() === dow && !KR_HOLIDAYS[ymd(d)]) return ymd(d); } return null; };
const bit = (dow) => 1 << ((dow + 6) % 7);   // data.json days bits: 월=1 … 일=64 (JS getDay: 일=0)
const TIMES = Array.from({ length: 25 }, (_, i) => 9 * 60 + i * 30);   // the visit sheet's hours: 09:00 … 21:00
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

(async () => {
  const D = asRows(await (await fetch(BASE + 'data.json')).json()), S = D.s, td = ymd(new Date());
  const WHEN = D.rows.length > 0 && D.rows[0].length > P.WHEN_FIELD;   // the file has days / hours (C #71)
  const daysOf = (r) => WHEN ? r[16] || 0 : 0, hoursOf = (r) => WHEN ? S[r[17]] || '' : '';
  const tagsOf = (r) => (S[r[6]] || '').split('·').filter(Boolean);
  const live = (r) => !r[13] && !(/^\d{4}-\d{2}-\d{2}$/.test(S[r[10]] || '') && S[r[10]] < td);
  const all = D.rows.map((r, i) => ({ r, i })).filter(({ r }) => live(r));
  console.log(`data: ${D.rows.length} rows · days/hours fields ${WHEN ? 'yes' : 'no'} · '시간대' rows ${all.filter(({ r }) => tagsOf(r).includes('시간대')).length}`);
  const wed = nextDay(3), sat = nextDay(6), mon = nextDay(1);
  // a live '평일 낮' row without an hour in its name or its hours field, on Wednesdays and not on Saturdays (so the old flow holds)
  const ANY_TIME = /시간\s*(상관\s*(없이|없음|없는)|무관)/;
  const okDays = (r) => !daysOf(r) || ((daysOf(r) & bit(3)) && !(daysOf(r) & bit(6)));
  const cand = all.filter(({ r }) => tagsOf(r).includes('평일 낮') && !/\d\s*시/.test(S[r[2]]) && !hoursOf(r) && okDays(r));
  ok('데이터에 평일 낮 태그 가격이 있음', cand.length > 0, `${cand.length}개`);
  if (!cand.length) { console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); process.exitCode = 1; return; }
  // the time check needs a name that does not say 'any hour'; such a row ('[화수목 해피아워] 시간 상관 없이 …') is checked on its own
  const timed = cand.filter(({ r }) => !ANY_TIME.test(S[r[2]]));
  const pick = timed.find(({ r }) => /해피\s*아워/.test(S[r[2]])) || timed[0] || cand[0];
  const anyTime = cand.find(({ r }) => ANY_TIME.test(S[r[2]]));
  const b = pick.r[0], name = S[pick.r[2]];
  console.log(`row: ${name} @ branch ${b} · tags ${S[pick.r[6]]} · days ${daysOf(pick.r)}`);

  const br = await chromium.launch();
  const ctx = await br.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('')); /* '' = 전국 */ }); await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');

  // the row on its branch page, found with the branch search; returns the badge texts and titles of the first line with that
  // name that carries the badge `label`
  const rowBadges = async (b_ = b, name_ = name, label = LABEL) => {
    await p.goto(BASE + `#branch/${b_}`); await p.waitForSelector('input[aria-label="이 지점에서 시술 찾기"]');
    await p.fill('input[aria-label="이 지점에서 시술 찾기"]', name_); await p.waitForTimeout(300);
    return p.$$eval('#main .card.flush li .item', (its, [n, lb]) => {
      const it = its.filter((x) => x.querySelector('.t') && x.querySelector('.t').textContent === n)
        .find((x) => [...x.querySelectorAll('.k.kt')].some((k) => k.textContent === lb)) || null;
      return it ? [...it.querySelectorAll('.k')].map((k) => [k.textContent, k.getAttribute('title') || '']) : null;
    }, [name_, label]);
  };
  // the price sheet of that line (its ⓘ — 위계 점검 47): its whole text
  const sheetOf = async (name_, label) => {
    await p.locator('#main .card.flush li', { has: p.locator('.item .k.kt', { hasText: label }) }).filter({ has: p.locator('.item > .t', { hasText: name_ }) }).first()
      .locator(':scope > .infob').click();
    await p.waitForSelector('.sheet[aria-label="가격 확인"]');
    const t = await p.locator('.sheet[aria-label="가격 확인"]').textContent();
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    return t;
  };
  const names = (bad) => bad ? bad.map((x) => x[0]).join(',') : '(줄 없음)';
  let bad = await rowBadges();
  ok('지점 가격표: 평일 낮 태그는 \'평일·시간 한정\' 배지', !!bad, names(bad));
  ok('배지 설명(title)에 해피아워·화수목', !!bad && bad.some(([t, ti]) => t === LABEL && /해피아워/.test(ti) && /화수목/.test(ti)));
  ok('화면 어디에도 옛 배지 \'평일 낮\'·태그 이름 \'시간대\' 없음', await p.$$eval('.k', (ks) => !ks.some((k) => k.textContent === '평일 낮' || k.textContent === '시간대')));

  // price sheet: the condition line is '요일·시간 조건' (not '평일 낮 조건')
  await p.locator('#main .card.flush li', { has: p.locator('.item .k.kt', { hasText: LABEL }) }).filter({ has: p.locator('.item > .t', { hasText: name }) }).first()
    .locator(':scope > .infob').click();
  await p.waitForSelector('.sheet[aria-label="가격 확인"]');
  const sheetTxt = await p.locator('.sheet[aria-label="가격 확인"]').textContent();
  ok('가격 확인: 조건에 \'요일·시간 조건\'', sheetTxt.includes('요일·시간 조건') && !sheetTxt.includes('평일 낮 조건'));
  ok('가격 확인: 배지도 \'평일·시간 한정\'', await p.locator('.sheet[aria-label="가격 확인"] .k.kt', { hasText: LABEL }).count() > 0);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  // legend (데이터 상태와 출처) and data notes (마이 → 데이터 안내): 해피아워 is not only '평일 낮' any more (C #83)
  await p.goto(BASE + '#about'); await p.waitForTimeout(400);
  const about = await p.locator('#main').textContent();
  const dts = await p.$$eval('#main dl.kv dt .k.kt', (ks) => ks.map((k) => k.textContent));
  // one colour for a condition (2026-10-16 hierarchy audit T1): the condition tags (.kt) are butter like 체험가·한정가, not the
  // grey of the end-date badge (.k4); '급변·확인 중' is a state of the data — grey with an icon (.kw, 2026-10-19 위계 점검 27), not
  // butter and not coral; the butter text stays >= 4.5:1, light and dark
  for (const scheme of ['light', 'dark']) {
    await p.emulateMedia({ colorScheme: scheme }); await p.waitForTimeout(150);
    const col = await p.$$eval('#main dl.kv dt .k', (ks) => {
      const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      return ks.map((k) => { const cs = getComputedStyle(k); return { cls: k.className, t: k.textContent, bg: cs.backgroundColor, cr: +ratio(cs.color, cs.backgroundColor).toFixed(2) }; });
    });
    const of = (c) => col.filter((x) => x.cls.split(' ').includes(c));
    const butter = of('k1')[0] && of('k1')[0].bg;
    ok(`조건 배지 한 색(${scheme}): 평일·시간 한정·정해진 시간만 = 체험가·한정가 버터, '~10/17까지'·고시가는 회색`,
      !!butter && of('kt').length >= 2 && of('kt').every((x) => x.bg === butter) && of('k2').every((x) => x.bg === butter) && of('k4').length >= 2 && of('k4').every((x) => x.bg !== butter) && of('kx').every((x) => x.bg !== butter) && of('kw').length >= 1 && of('kw').every((x) => x.bg === of('k4')[0].bg),
      col.map((x) => `${x.t}:${x.bg}`).join(' / '));
    ok(`조건 배지 글자 대비 4.5:1 이상(${scheme})`, col.length > 0 && col.every((x) => x.cr >= 4.5), col.map((x) => `${x.t} ${x.cr}`).join(' / '));
  }
  await p.emulateMedia({ colorScheme: 'light' });
  // '토요일만 등' (a badge only the site's days can make) is listed only when the file has them, like the visit sheet's words
  ok(WHEN ? '가격 종류 설명: \'평일·시간 한정\'·\'정해진 시간만\'·\'토요일만 등\'' : '가격 종류 설명(요일 칸 없는 자료): \'평일·시간 한정\'·\'정해진 시간만\', \'토요일만 등\' 없음',
    dts.includes(LABEL) && dts.includes(SLOT) && dts.includes('토요일만 등') === WHEN && !about.includes('평일 낮 등'), dts.join(' / '));
  ok('설명: 평일 낮·화수목·평일 해피아워 / 점심·해피아워(정해진 시간)', about.includes('평일 낮·화수목·평일 해피아워처럼 평일 중 정해진 요일·시간에만 되는 가격')
    && about.includes('점심·해피아워처럼 정해진 시간에만 되는 가격') && !about.includes('평일 낮·해피아워·화수목처럼'));
  await p.goto(BASE + '#me'); await p.waitForTimeout(400);
  const me = await p.locator('#main').textContent();
  ok('마이 → 데이터 안내 문장도 새 이름', me.includes(`'${LABEL}'(평일 낮·화수목·평일 해피아워 등), '${SLOT}'(점심·해피아워 등), '일요일'${WHEN ? "·'토요일만'" : ''} 같은 표시는`)
    && !me.includes("'평일 낮', '일요일'"));

  // visit-date sheet (비교 화면의 방문일 칩): the explanation, the weekend line, then the filter itself
  const openWhen = async () => { await p.goto(BASE + '#compare?k=X12'); await p.waitForTimeout(500);
    await p.locator('#main button.chip', { hasText: '방문' }).first().click(); await p.waitForSelector('.sheet[aria-label="언제 갈 거예요?"]'); return p.locator('.sheet[aria-label="언제 갈 거예요?"]'); };
  const visit = async (date, time = '') => { const sh = await openWhen();
    await sh.locator('input[type="date"]').fill(date); await sh.locator('select[aria-label="방문 시간"]').selectOption(time); await p.waitForTimeout(100);
    await sh.locator('button', { hasText: '적용' }).click(); await p.waitForTimeout(400); };
  let sh = await openWhen();
  const intro = await sh.locator('.sub').first().textContent();
  ok('방문일 안내: 두 배지 이름', intro.startsWith(`'${LABEL}', '${SLOT}', '일요일'처럼`) && !intro.includes('평일 낮'), intro);
  ok(WHEN ? '방문일 안내: 사이트에 적힌 요일·시간으로 거른다고 말함' : '방문일 안내(요일 칸 없는 자료): 화수목은 병원에 확인',
    WHEN ? intro.includes('사이트에 적힌 요일·시간') && !intro.includes('화수목') : intro.includes('화수목') && !intro.includes('사이트에 적힌'), intro);
  await sh.locator('input[type="date"]').fill(sat); await p.waitForTimeout(100);
  const info = await sh.locator('.sub').nth(1).textContent();
  ok('토요일을 고르면 \'주말 — 평일에만 되는 가격은 빠져요\'', info.includes('주말 — 평일에만 되는 가격은 빠져요'), `${sat} ${info}`);
  // a weekday public holiday (within the sheet's 120 days): weekend-only prices are left out too, and the sheet says clinics differ
  const wkHol = (() => { const d = new Date(); for (let i = 1; i < 120; i++) { d.setDate(d.getDate() + 1); const s = ymd(d); if (KR_HOLIDAYS[s] && d.getDay() >= 1 && d.getDay() <= 5) return s; } return null; })();
  if (wkHol) {
    await sh.locator('input[type="date"]').fill(wkHol); await p.waitForTimeout(100);
    const hi = await sh.locator('.sub').nth(1).textContent();
    ok(WHEN ? '평일 공휴일: 주말에만 되는 가격도 빠지고, 병원에 따라 된다고 안내' : '평일 공휴일(요일 칸 없는 자료): 평일 가격만 빠진다고 안내',
      WHEN ? hi.includes('주말에만 되는 가격은 빠져요') && hi.includes('병원에 확인하세요') : hi.includes('평일에만 되는 가격은 빠져요') && !hi.includes('주말에만'), `${wkHol} ${hi}`);
    await sh.locator('input[type="date"]').fill(sat); await p.waitForTimeout(100);
  } else console.log('SKIP | 120일 안에 평일 공휴일이 없음');
  await sh.locator('button', { hasText: '적용' }).click(); await p.waitForTimeout(400);
  bad = await rowBadges();
  ok('토요일 방문: 그 가격에 \'방문일엔 안 됨\'', !!bad && bad.some(([t]) => t === '방문일엔 안 됨'), names(bad));

  await visit(wed, '');
  bad = await rowBadges();
  ok('수요일 방문(시간 상관없음): 걸리지 않음', !!bad && !bad.some(([t]) => t === '방문일엔 안 됨' || t === '시간 확인 필요'), names(bad));

  await visit(wed, '11:00');
  bad = await rowBadges();
  const unclear = bad && bad.find(([t]) => t === '시간 확인 필요');
  ok('수요일 11:00 방문: 시간이 안 적힌 가격은 \'시간 확인 필요\'', !!unclear && !bad.some(([t]) => t === '방문일엔 안 됨'), names(bad));
  ok('\'시간 확인 필요\' 설명은 앱이 모른다는 뜻', !!unclear && unclear[1].includes('앱이 알지 못해요'), unclear ? unclear[1] : '');
  if (anyTime) {
    const ab = await rowBadges(anyTime.r[0], S[anyTime.r[2]]);
    ok('수요일 11:00 방문: 이름이 \'시간 상관 없이\'면 시간 확인 필요 없음', !!ab && !ab.some(([t]) => t === '시간 확인 필요' || t === '방문일엔 안 됨'), `${S[anyTime.r[2]]} | ${names(ab)}`);
  } else skip('이름에 \'시간 상관 없이\'가 있는 평일 낮 가격', '이 자료엔 없음');

  // ---- the site's days / hours (C #71)
  // the badge a row should carry for its days / hours: the tag's own badge, or for an untagged one '토요일만' / '화·수·목만'
  const WHEN_TAGS = ['평일 낮', '시간대', '일요일'];
  const badgeOf = (r) => { const t = tagsOf(r).find((x) => WHEN_TAGS.includes(x)); return t ? P.condLabel(t) : P.whenBadge(daysOf(r), hoursOf(r)); };
  if (!WHEN) skip('요일·시간 칸(화수목·시간 범위·가격 확인 줄)', '이 data.json엔 요일·시간 칸이 없음(C #71 전)');
  else {
    // a 화·수·목 price (days 14) with no hours: Monday no, Wednesday yes; the sheet lists the days
    const hhs = all.find(({ r }) => daysOf(r) === 14 && !hoursOf(r) && !tagsOf(r).includes('일요일')) || all.find(({ r }) => daysOf(r) === 14);
    ok('데이터에 화·수·목(14) 가격이 있음', !!hhs, hhs ? `${S[hhs.r[2]]} · ${S[hhs.r[6]] || '태그 없음'} · ${hoursOf(hhs.r)}` : '');
    if (hhs) {
      const n = S[hhs.r[2]], lb = badgeOf(hhs.r), t = hoursOf(hhs.r);
      const inside = t ? hm(TIMES.find((m) => P.condState('', '', { date: wed, time: hm(m) }, { hours: t }) === 0) ?? 0) : '';
      await visit(mon, inside);
      bad = await rowBadges(hhs.r[0], n, lb);
      ok('화수목 가격: 월요일 방문은 \'방문일엔 안 됨\'', !!bad && bad.some(([x]) => x === '방문일엔 안 됨'), `${mon} ${n} | ${names(bad)}`);
      await visit(wed, inside);
      bad = await rowBadges(hhs.r[0], n, lb);
      ok('화수목 가격: 수요일 방문은 걸리지 않음', !!bad && !bad.some(([x]) => x === '방문일엔 안 됨'), `${wed} ${inside} | ${names(bad)}`);
      ok('화수목 가격: 배지 설명에 \'되는 요일: 화·수·목\'', !!bad && bad.some(([x, ti]) => x === lb && ti.includes('되는 요일: 화·수·목')), bad ? (bad.find(([x]) => x === lb) || [])[1] : '');
      const st = await sheetOf(n, lb);
      ok('가격 확인: 조건에 \'되는 요일: 화·수·목\'', st.includes('되는 요일: 화·수·목'), n);
      ok('가격 확인: 가격 종류는 조건부', st.includes('조건부 — 첫 방문·요일·시간 같은 조건이 맞을 때만') || /체험가 —|한정가 —/.test(st), n);
    }
    // a price with hours, valid on Wednesdays: outside the window no, inside yes; the sheet lists the hours
    const wbit = bit(3);
    const timedRow = all.find(({ r }) => { const t = hoursOf(r), dd = daysOf(r); if (!t || (dd && !(dd & wbit))) return false;
      const st = TIMES.map((m) => P.condState(S[r[6]], S[r[2]], { date: wed, time: hm(m) }, { days: dd, hours: t }));
      return st.includes(0) && st.includes(1); });
    ok('데이터에 시간 범위가 적힌 가격이 있음', !!timedRow, timedRow ? `${S[timedRow.r[2]]} · ${hoursOf(timedRow.r)} · days ${daysOf(timedRow.r)}` : '');
    if (timedRow) {
      const r = timedRow.r, n = S[r[2]], t = hoursOf(r), lb = badgeOf(r);
      const at = (s) => hm(TIMES.find((m) => P.condState(S[r[6]], n, { date: wed, time: hm(m) }, { days: daysOf(r), hours: t }) === s));
      const out = at(1), inn = at(0);
      await visit(wed, out);
      bad = await rowBadges(r[0], n, lb);
      ok(`시간 범위 ${t}: 수요일 ${out} 방문은 '방문일엔 안 됨'`, !!bad && bad.some(([x]) => x === '방문일엔 안 됨'), names(bad));
      await visit(wed, inn);
      bad = await rowBadges(r[0], n, lb);
      ok(`시간 범위 ${t}: 수요일 ${inn} 방문은 걸리지 않음(시간 확인 필요도 아님)`, !!bad && !bad.some(([x]) => x === '방문일엔 안 됨' || x === '시간 확인 필요'), names(bad));
      const line = P.whenLines(0, t)[0];
      ok(`시간 범위: 배지 설명에 '${line}'`, !!bad && bad.some(([x, ti]) => x === lb && ti.includes(line)), bad ? (bad.find(([x]) => x === lb) || [])[1] : '');
      const st = await sheetOf(n, lb);
      ok(`가격 확인: 조건에 '${line}'`, st.includes(line), n);
    }
    // a day price with no condition tag ('토요일이벤트' …): the visit date filters it too, its own badge, a conditional price in
    // the sheet, and it is not a plain price — with 특가 off it leaves the branch's list. Picked so that no plain row of the same
    // name at that branch can stand in for it (the list shows one line per name).
    const condLike = (r) => r[5] === 1 || r[5] === 2 || !!S[r[6]] || P.whenLimited(daysOf(r), hoursOf(r));
    const sameName = new Map(); for (const r of D.rows) { const k = `${r[0]}|${S[r[2]]}`; if (!sameName.has(k)) sameName.set(k, []); sameName.get(k).push(r); }
    const alone = (r) => sameName.get(`${r[0]}|${S[r[2]]}`).every(condLike);
    // the first day (from Monday) whose bit the row has / has not
    const dayIn = (d, has) => [1, 2, 3, 4, 5, 6, 0].map((w) => ((d & bit(w)) !== 0) === has ? nextDay(w) : null).find(Boolean) || null;
    const untagged = all.find(({ r }) => !S[r[6]] && !r[5] && daysOf(r) && !hoursOf(r) && P.whenLimited(daysOf(r), '') && alone(r));
    if (untagged) {
      const r = untagged.r, n = S[r[2]], lb = P.whenBadge(daysOf(r), ''), off = dayIn(daysOf(r), false), on = dayIn(daysOf(r), true);
      await visit(off, '');
      bad = await rowBadges(r[0], n, lb);
      ok(`태그 없는 요일 가격(${lb}): 그 요일 밖 방문은 '방문일엔 안 됨'`, !!bad && bad.some(([x]) => x === '방문일엔 안 됨'), `${off} ${n} | ${names(bad)}`);
      await visit(on, '11:00');
      bad = await rowBadges(r[0], n, lb);
      ok(`태그 없는 요일 가격(${lb}): 그 요일 11:00 방문은 걸리지 않음(시간 확인 필요도 아님)`, !!bad && !bad.some(([x]) => x === '방문일엔 안 됨' || x === '시간 확인 필요'), `${on} | ${names(bad)}`);
      sh = await openWhen(); await sh.locator('button', { hasText: '지우기' }).click(); await p.waitForTimeout(300);   // no visit date
      bad = await rowBadges(r[0], n, lb);
      ok(`태그 없는 요일 가격: '${lb}' 배지`, !!bad, `${n} | ${names(bad)}`);
      const st = await sheetOf(n, lb);
      ok('태그 없는 요일 가격: 가격 확인은 조건부, 되는 요일 줄', st.includes('조건부 — 첫 방문·요일·시간 같은 조건이 맞을 때만') && st.includes(P.whenLines(daysOf(r), '')[0]), n);
      // 특가 off (the branch page's switch): a price for some weekdays only is not a plain price, so it is not listed
      const special = async (on_) => { const sw = p.locator('#main label.switch', { hasText: '특가 포함' }).first();
        if ((await sw.locator('input').isChecked()) !== on_) await sw.click(); await p.waitForTimeout(400); };
      await special(false);
      await p.goto(BASE + '#about'); await p.waitForTimeout(200);
      bad = await rowBadges(r[0], n, lb);
      ok('태그 없는 요일 가격: 특가를 끄면 지점 가격표에서 빠짐(일반가 아님)', bad === null, `${n} | ${names(bad)}`);
      await p.goto(BASE + `#branch/${r[0]}`); await p.waitForSelector('#main label.switch'); await special(true);
      await p.goto(BASE + '#about'); await p.waitForTimeout(200);
      bad = await rowBadges(r[0], n, lb);
      ok('… 특가를 다시 켜면 보임', !!bad, names(bad));
    } else skip('태그 없는 요일 가격', '이 자료엔 없음');
    // an hours-only price with no condition tag ('[10:30~16:00] … (타임이벤트)'): outside the hours no, inside yes
    const hoursOnly = all.find(({ r }) => { if (S[r[6]] || r[5] || daysOf(r) || !hoursOf(r)) return false;
      const st = TIMES.map((m) => P.condState('', S[r[2]], { date: wed, time: hm(m) }, { hours: hoursOf(r) }));
      return st.includes(0) && st.includes(1); });
    if (hoursOnly) {
      const r = hoursOnly.r, n = S[r[2]], t = hoursOf(r), lb = P.whenBadge(0, t);
      const at = (s) => hm(TIMES.find((m) => P.condState('', n, { date: wed, time: hm(m) }, { hours: t }) === s));
      await visit(wed, at(1));
      bad = await rowBadges(r[0], n, lb);
      ok(`태그 없는 시간 가격 ${t}: 수요일 ${at(1)} 방문은 '방문일엔 안 됨'`, !!bad && bad.some(([x]) => x === '방문일엔 안 됨'), `${n} | ${names(bad)}`);
      await visit(wed, at(0));
      bad = await rowBadges(r[0], n, lb);
      ok(`태그 없는 시간 가격 ${t}: 수요일 ${at(0)} 방문은 걸리지 않음`, !!bad && !bad.some(([x]) => x === '방문일엔 안 됨' || x === '시간 확인 필요'), `${n} | ${names(bad)}`);
    } else skip('태그 없이 시간만 적힌 가격', '이 자료엔 없음');
  }

  // ---- '시간대' (C #83): '정해진 시간만', any day
  const slot = all.find(({ r }) => tagsOf(r).includes('시간대') && (!daysOf(r) || (daysOf(r) & bit(6))));
  if (!slot) skip('\'시간대\' 태그(정해진 시간만)', '이 data.json엔 \'시간대\' 태그가 없음(C #83 전)');
  else {
    const r = slot.r, n = S[r[2]];
    await visit(sat, '');
    bad = await rowBadges(r[0], n, SLOT);
    ok('시간대 태그: 배지는 \'정해진 시간만\'', !!bad, `${n} | ${names(bad)}`);
    const ti = bad ? (bad.find(([x]) => x === SLOT) || [])[1] : '';
    ok('시간대 배지 설명: 정해진 시간에만 되는 가격', /정해진 시간에만 되는 가격이에요/.test(ti || '') && (P.dayList(daysOf(r)) ? !ti.includes('되는 요일은 앱이 알지 못해요') : ti.includes('되는 요일은 앱이 알지 못해요')), ti);
    ok('시간대 태그: 토요일 방문으로 빠지지 않음', !!bad && !bad.some(([x]) => x === '방문일엔 안 됨'), `${sat} | ${names(bad)}`);
    const st = await sheetOf(n, SLOT);
    ok('시간대 태그: 가격 확인 조건은 \'요일·시간 조건\'(\'시간대 조건\' 아님)', st.includes('요일·시간 조건') && !st.includes('시간대 조건'), n);
  }
  // 내 견적 경고와 복사 문구도 같은 말(예전 '시간대 미표기'는 사이트에 시간이 있어도 나와 틀린 말)
  ok('앱 문구에 \'시간대 미표기\' 없음', !(await (await fetch(BASE + 'app.js')).text()).includes('미표기'));

  ok('스크립트 오류 없음', !errs.length, errs.join(' '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await br.close(); process.exitCode = R.every(Boolean) ? 0 : 1;
})();
