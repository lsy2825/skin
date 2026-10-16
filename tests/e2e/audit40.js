// 4.0 Release A (docs/PRODUCT_AUDIT.md): the hidden problems found in the audit stay fixed.
//  data — 'N회 한정가/체험가' counted as N sessions; one comparison key holds one quantity, one session count, one product;
//         외국산 is not 국산; 제모 keys don't mix devices; a model number is not read into the amount; no page furniture
//         in addresses; a regrouped key's trend starts again; meta.keymap / meta.recl are there
//  app  — a saved cart item / favourite / alert on a replaced id moves to its successor; an id without one shows its old
//         label; an alert on a regrouped key is re-based without a notice; the price history says why weeks are missing
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/audit40.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'); const path = require('path');
const rowsOf = require('./rows.js');
const { audit } = require('../../tools/audit_data.js');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 300)}`); };
const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'data.json'), 'utf8');
const A = audit(JSON.parse(raw));
const D = JSON.parse(raw); rowsOf(D);
const S = D.s, ROWS = D.rows;
const KL = Object.fromEntries(D.keys.map(([id, , l]) => [id, l]));
const rowsOfKey = (id) => ROWS.filter((r) => (S[r[7]] || '').split(' ').includes(id));

// ---- data
// the session count is the largest 'N회' in the name ('※10회 + 10회 한정가 진행시 … 20회 추가' = 20). A purchase limit is not a
// count: '최대 3회', '1인 2회', '(*최대 3회 한정)' — 'N회 한정' without 가 (C #80, the same words as build2/xkeys.py LIMIT·LIMIT_NOTE)
const LIMIT = /최대\s*\d+\s*회|(?<!\d)1\s*인\s*(?:당\s*)?(?:최대\s*)?\d+\s*회/g, LIMIT_NOTE = /\d+\s*회\s*한정(?!\s*(?:특\s*)?가)/g;
const sessBad = (r) => { const n = S[r[2]].replace(LIMIT, ' ').replace(LIMIT_NOTE, ' '); if (!/(\d+)\s*회\s*(한정|체험)/.test(n)) return false; const mx = Math.max(...[...n.matchAll(/(\d+)\s*회(?!\s*(차|이상|이내|당|째|분))/g)].map((m) => +m[1])); return mx >= 2 && r[8] !== mx && r[8] !== 99; };
ok('A1 횟수: "N회 한정가·체험가"는 N회로 읽음(1회로 읽은 줄 0개)', !ROWS.some(sessBad), ROWS.filter(sessBad).slice(0, 3).map((r) => S[r[2]]).join(' / '));
ok('A2 비교 묶음 하나에 다른 용량 없음', !(A.keyMixedQty || []).length, JSON.stringify((A.keyMixedQty || []).slice(0, 2)));
ok('A3 비교 묶음 하나에 다른 횟수 없음', !(A.keyMixedSess || []).length, JSON.stringify((A.keyMixedSess || []).slice(0, 2)));
ok('A4 비교 묶음 하나에 다른 제품명 없음', !(A.keyMixedProduct || []).length, JSON.stringify((A.keyMixedProduct || []).slice(0, 2)));
ok('A5 같은 ID·같은 지점 두 번 없음', !(A.dupKeyId || []).length && !(A.dupBranch || []).length);
const x29 = rowsOfKey('X29').map((r) => S[r[2]]);
ok('A6 레이저토닝 1회(X29)에 10회·20회 묶음 없음', x29.length > 0 && !x29.some((n) => /([2-9]|\d{2,})\s*회/.test(n)), x29.filter((n) => /([2-9]|\d{2,})\s*회/.test(n)).slice(0, 2).join(' / '));
const x02 = rowsOfKey('X02').map((r) => S[r[2]]);
ok('A7 국산 주름 보톡스 1부위(X02)에 다한증·풀페이스 없음', x02.length > 0 && !x02.some((n) => /다한증|풀페이스/.test(n)));
const x06 = rowsOfKey('X06').map((r) => S[r[2]]);
ok('A8 국산 바디 보톡스(X06)에 외국산 없음', x06.length > 0 && !x06.some((n) => /외국산|외산/.test(n)));
// X35 '(여) 겨드랑이 제모 1회' is the hand-made cross-brand key: device-agnostic on purpose, its compare screen names the
// devices (Release B, tests/e2e/taxonomy40.js). Every automatic key has one device.
const hairMix = D.keys.filter(([id, cat]) => cat === '제모·바디' && id !== 'X35').map(([id]) => {
  const devs = new Set(rowsOfKey(id).map((r) => (/아포지|젠틀맥스|에일린|포토나|아발란체|클라리티|엘리트/.exec(S[r[2]]) || ['-'])[0].replace('아발란체', '포토나')));
  devs.delete('-'); return devs.size > 1 ? `${KL[id]}: ${[...devs]}` : null; }).filter(Boolean);
ok('A9 제모 비교 묶음 하나에 장비 둘 이상 없음', !hairMix.length, hairMix.slice(0, 3).join(' / '));
ok('A10 장비 이름의 숫자를 용량으로 읽지 않음(리프테라2 3000샷 ≠ 23000샷)', !D.keys.some(([, , l]) => /23000샷/.test(l)));
ok('A11 지점 주소에 팝업·제휴문의 같은 페이지 문구 없음', D.branches.every((b) => !/팝업|제휴\s*문의|그만\s*보기/.test(S[b[2]])));
ok('A12 바뀐 비교 ID 연결표(meta.keymap)와 다시 묶은 ID 목록(meta.recl) 있음', D.meta.keymap && typeof D.meta.keymap === 'object' && Array.isArray(D.meta.recl));
const recl = new Map(); for (const [d, ks] of D.meta.recl || []) for (const k of ks) recl.set(k, d);
const trendLeak = [...recl].filter(([k, d]) => (D.trend.k[k] || []).some((v, i) => v && D.trend.dates[i] < d));
ok('A13 다시 묶은 시술의 가격 이력은 그날부터(섞인 예전 값 안 보임)', !trendLeak.length, trendLeak.slice(0, 3).join(' / '));
// by (id, branch) once the build says which branches were regrouped (meta.reclBranches [[date, {id: [branch…]}]], C #100): a real
// change at another branch of a regrouped id may show; a file without the field, or an id it does not list, stays per id
const reclAt = new Map(D.meta.reclBranches || []).get(D.meta.updated);
const reclHit = ([k, b]) => { const id = D.keys[k][0]; return recl.get(id) === D.meta.updated && (!reclAt || !reclAt[id] || reclAt[id].includes(b)); };
ok('A14 다시 묶은 시술(그 지점)은 "가격 변동"에 안 나옴', !(D.changes || []).some(reclHit), JSON.stringify((D.changes || []).filter(reclHit).slice(0, 3)));

(async () => {
  const mapped = Object.entries(D.meta.keymap || {}).find(([, v]) => v[0] && KL[v[0]]);
  const gone = Object.entries(D.meta.keymap || {}).find(([, v]) => !v[0]);
  const reK = [...recl.keys()].find((k) => k.startsWith('X') && KL[k]) || [...recl.keys()][0];
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE);
  await p.evaluate(([m, g, rk]) => {
    localStorage.clear(); localStorage.setItem('pc:region', '""');
    localStorage.setItem('pc:carts', JSON.stringify([{ name: '내 장바구니', items: [m && { t: 'k', k: m[0], q: 1 }, g && { t: 'k', k: g[0], q: 1 }].filter(Boolean) }]));
    localStorage.setItem('pc:favs', JSON.stringify({ k: m ? [m[0]] : [], b: [] }));
    // an alert made two weeks ago on a key regrouped today, with a stale baseline that would 'drop' now
    localStorage.setItem('pc:alerts', JSON.stringify([{ id: 'a1', type: 'watch', k: rk, created: '2026-09-30', basis: 'listed', reg: '전국', sp: true, base: 99999999, low: 99999999, lowB: 'x|y', set: ['x|y'], obs: '2026-09-30' },
      m && { id: 'a2', type: 'target', k: m[0], created: '2026-09-30', basis: 'listed', reg: '전국', target: 1 }].filter(Boolean)));
  }, [mapped, gone, reK]);
  await p.reload(); await p.waitForTimeout(200);
  if (await p.locator('#gate-pad').isVisible()) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('.pc');
  await p.waitForFunction(() => document.querySelector('#main') && !document.querySelector('#main').hasAttribute('aria-busy'), null, { timeout: 30000 });
  await p.waitForTimeout(800);
  const ls = await p.evaluate(() => ({ carts: JSON.parse(localStorage.getItem('pc:carts')), favs: JSON.parse(localStorage.getItem('pc:favs')), alerts: JSON.parse(localStorage.getItem('pc:alerts')), notes: JSON.parse(localStorage.getItem('pc:notes') || '[]') }));
  if (mapped) {
    ok('B1 장바구니에 담긴 옛 비교 ID → 새 ID로 옮김', ls.carts[0].items.some((it) => it.k === mapped[1][0]) && !ls.carts[0].items.some((it) => it.k === mapped[0]), `${mapped[0]} → ${mapped[1][0]}`);
    ok('B2 관심 목록의 옛 ID → 새 ID', ls.favs.k.includes(mapped[1][0]) && !ls.favs.k.includes(mapped[0]));
    ok('B3 알림의 옛 ID → 새 ID(옛 ID는 from에 기록)', ls.alerts.some((a) => a.k === mapped[1][0] && a.from === mapped[0]));
  }
  ok('B4 다시 묶은 시술의 알림: 알림 없이 기준만 다시 잡음', ls.alerts.find((a) => a.id === 'a1').rb && !ls.notes.some((n) => n.k === reK && !n.past), JSON.stringify(ls.notes.slice(0, 2)));
  await p.goto(BASE + '#cart'); await p.waitForTimeout(900);
  const cartTxt = await p.locator('#main').textContent();   // textContent: the variant picker's options count too
  if (gone) ok('B5 이어지는 묶음이 없는 옛 ID: ID 대신 옛 이름 + "지금은 비교 묶음 없음"', cartTxt.includes(gone[1][1]) && cartTxt.includes('지금은 비교 묶음 없음') && !cartTxt.includes(gone[0]), gone[1][1]);
  // the cart shows the family name + the variant picker (its option = the variant's short label)
  const fam = (D.meta.fam || []).find((f) => f[2].some(([id]) => id === (mapped || [])[1]?.[0]));
  if (mapped) ok('B6 옮긴 항목은 새 묶음 이름·옵션으로 보임', fam ? cartTxt.includes(fam[0]) && cartTxt.includes(fam[2].find(([id]) => id === mapped[1][0])[1]) : cartTxt.includes(KL[mapped[1][0]]), fam ? fam[0] : KL[mapped[1][0]]);
  await p.goto(BASE + '#compare?k=' + encodeURIComponent(reK)); await p.waitForTimeout(1200);
  const hist = p.locator('#main .note.recl');
  // the history card (and this note with it) shows only after 8 distinct weeks of snapshots (Stats.historyReady); before
  // that neither the card nor the note may appear
  const weeks = new Set((D.trend && D.trend.dates || []).map((d) => { const t = new Date(d + 'T00:00:00Z'), w = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - w); return t.toISOString().slice(0, 10); })).size;
  if (weeks >= 8) ok('B7 가격 이력에 "비교 기준을 고쳤어요" 안내(묶는 방법·일반가 기준 모두)', await hist.count() === 1 && /비교 기준을 고쳤어요/.test(await hist.innerText()), reK);
  else ok(`B7 기록 ${weeks}주(8주 전): 가격 이력·기준 변경 안내를 그리지 않음`, await hist.count() === 0 && !/가격 이력/.test(await p.locator('#main').innerText()), reK);
  ok('B8 페이지 오류 0개', !errs.length, errs.slice(0, 3).join(' / '));
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`TOTAL ${pass}/${R.length} ${pass === R.length ? 'PASS' : 'FAIL'}`);
  process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
