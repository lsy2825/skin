// The build's add-on field (data.json row field 15, build2 C2, 2026-10-15) in a real browser: the load moves it to r[19]
// before r[15] becomes the runtime state, and the '추가 옵션' badge, the price sheet's class (H) and its add-on condition
// follow it — also for names the old name rule reads the other way. With a data.json from before (15 fields) the name rule
// (Classify.isAddon) still decides, exactly as before. Runs with either file.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/addon_col.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const COND = '추가 옵션이에요(본 시술과 함께)';

(async () => { const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('')); /* '' = 전국 */ }); await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
  await p.waitForFunction(() => window.App && App.data && App.data() && !App.data().meta.partial, null, { timeout: 180000 });

  // the file as served vs the rows the app holds
  const file = await p.evaluate(async () => { const d = await (await fetch('data.json', { cache: 'no-store' })).json(), c = d.cols;
    let n = 0; if (c.length > 15) for (const v of c[15]) if (v === 1) n++;
    return { fields: c.length, rows: c[0].length, n }; });
  const has = file.fields > 15;
  const app = await p.evaluate(() => { const S = App.data().s; let one = 0, other = 0, rx = 0;
    for (const r of App.rows()) { if (r[19] === 1) one++; else if (r[19] !== 0) other++; if (Classify.isAddon(S[r[2]])) rx++; }
    return { rows: App.rows().length, one, other, rx }; });
  ok('행 수가 data.json과 같음', app.rows === file.rows, `${app.rows}/${file.rows}`);
  if (has) ok('data.json 추가 옵션 칸(16번째)이 r[19]로 옮겨짐 — 실행 중 칸에 덮이지 않음', app.one === file.n && app.other === 0 && file.n > 0, `칸 ${file.n} · 앱 ${app.one} · 이름 규칙 ${app.rx}`);
  else ok('예전 data.json(칸 15개): r[19]는 모두 0, 판정은 이름 규칙', app.one === 0 && app.other === 0 && app.rx > 0, `이름 규칙 ${app.rx}`);

  // rows to look at: a plain price (no 특가·조건 tags, so it is listed with 특가 off) whose name is unique in its branch
  const pick = (want) => p.evaluate(([w, hasCol]) => { const S = App.data().s, rows = App.rows(), seen = new Map();
    rows.forEach((r) => { const k = `${r[0]}|${S[r[2]]}`; seen.set(k, (seen.get(k) || 0) + 1); });
    const by = { colOnly: (r, n) => hasCol && r[19] === 1 && !Classify.isAddon(n), nameOnly: (r, n) => hasCol && r[19] === 0 && Classify.isAddon(n) && /\s추가$/.test(n),
      nameOnlyAny: (r, n) => hasCol && r[19] === 0 && Classify.isAddon(n), oldAddon: (r, n) => !hasCol && Classify.isAddon(n), plain: (r, n) => !Classify.isAddon(n) && r[19] !== 1 && /\d\s*회$/.test(n) };
    for (let i = 0; i < rows.length; i++) { const r = rows[i], n = S[r[2]];
      if (r[5] || S[r[6]] || r[15] || seen.get(`${r[0]}|${n}`) !== 1 || n.length > 60) continue;
      if (by[w](r, n)) return { i, b: r[0], name: n }; }
    return null; }, [want, has]);
  const look = async (x) => {
    await p.goto(BASE + `#branch/${x.b}`); await p.waitForTimeout(500);
    await p.fill('input[aria-label="이 지점에서 시술 찾기"]', x.name); await p.waitForTimeout(300);
    const exact = new RegExp(`^${x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const li = p.locator('#main ul.list li').filter({ has: p.locator('.item > .t').filter({ hasText: exact }) }).filter({ has: p.locator('button', { hasText: '가격 근거' }) }).first();
    if (!await li.count()) return null;
    const badge = await li.locator('.k', { hasText: /^추가 옵션$/ }).count() > 0;
    await li.locator('button', { hasText: '가격 근거' }).click(); await p.waitForTimeout(300);
    const sh = await p.locator('.sheet').innerText(), cls = (await p.locator('.sheet .clsb').first().textContent()).trim();
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    return { badge, cls, cond: sh.includes(COND) };
  };

  if (has) {
    const a = await pick('colOnly');
    ok('칸=1인데 이름 규칙은 아니라는 줄이 있음', !!a, a ? a.name : '');
    if (a) { const v = await look(a);
      ok('그 줄: 추가 옵션 배지·판정 H·조건 줄 모두 칸을 따름', v && v.badge && /^H /.test(v.cls) && v.cond, `${a.name} → ${JSON.stringify(v)}`); }
    const c0 = (await pick('nameOnly')) || (await pick('nameOnlyAny'));
    ok('칸=0인데 이름 규칙은 추가 옵션이라는 줄이 있음', !!c0, c0 ? c0.name : '');
    if (c0) { const v = await look(c0);
      ok('그 줄: 배지 없음·판정 H 아님·추가 옵션 조건 줄 없음', v && !v.badge && !/^H /.test(v.cls) && !v.cond, `${c0.name} → ${JSON.stringify(v)}`); }
  } else {
    const a = await pick('oldAddon');
    ok('예전 data.json: 이름 규칙이 추가 옵션이라는 줄이 있음', !!a, a ? a.name : '');
    if (a) { const v = await look(a);
      ok('그 줄: 추가 옵션 배지·판정 H(이름 규칙 그대로)', v && v.badge && /^H /.test(v.cls), `${a.name} → ${JSON.stringify(v)}`); }
  }
  const pl = await pick('plain');
  if (pl) { const v = await look(pl); ok('보통 시술 가격엔 추가 옵션 배지 없음', v && !v.badge && !/^H /.test(v.cls), `${pl.name} → ${JSON.stringify(v)}`); }
  else ok('보통 시술 가격 줄을 찾음', false);
  ok('스크립트 오류 없음', !errs.length, errs.join(' '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
