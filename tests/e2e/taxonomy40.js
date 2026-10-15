// 4.0 Release B (docs/TREATMENT_TAXONOMY.md, docs/SEARCH_ENGINE_QA.md): product / device layer, comparability classes,
// easy (step) / detailed option picker, typed search results. Counts are checked against app/data.json.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/taxonomy40.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'); const path = require('path');
const rowsOf = require('./rows.js');
global.Search = require('../../app/domain/search.js');
const Classify = require('../../app/domain/classify.js');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 300)}`); };
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'data.json'), 'utf8')); rowsOf(D);
const S = D.s, ROWS = D.rows, TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const live = (r) => !(/^\d{4}-\d{2}-\d{2}$/.test(S[r[10]] || '') && S[r[10]] < TODAY) && !r[13];
const branchesNaming = (p) => new Set(ROWS.filter((r) => live(r) && Classify.products(S[r[2]]).includes(p)).map((r) => r[0])).size;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', '""'); localStorage.setItem('pc:special', 'true'); });
  await p.reload(); await p.waitForTimeout(200);
  if (await p.locator('#gate-pad').isVisible()) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('.pc');
  await p.waitForFunction(() => !document.querySelector('#main').hasAttribute('aria-busy'), null, { timeout: 30000 });
  const go = async (hash, wait = 1000) => { await p.goto(BASE + '#' + hash); await p.waitForTimeout(wait); };

  // 1) a group that mixes devices says so and can be narrowed to one device
  await go('compare?k=X35');
  ok('B1 장비가 섞인 묶음(X35): 가격 위에 "제품·장비가 서로 다른 가격" 안내', /제품·장비가 서로 다른 가격/.test(await p.locator('.pricecard .mixnote').innerText().catch(() => '')));
  const chip = p.locator('#clinics .prodmix .chip', { hasText: '아포지 플러스' });
  ok('B2 제품·장비 칩(전체 + 장비별 + 표기 없음)', await p.locator('#clinics .prodmix .chip').count() >= 3 && await chip.count() === 1);
  const total = +(await p.locator('#clinics h3').innerText()).replace(/\D/g, '');
  await chip.click(); await p.waitForTimeout(600);
  const names = await p.$$eval('#clinics li.rk .m', (xs) => xs.map((x) => x.textContent));
  const n = +(await p.locator('#clinics h3').innerText()).replace(/\D/g, '');
  ok('B3 아포지 플러스만: 목록 모두 아포지, 지점 수가 줄고 0보다 큼', names.length > 0 && names.every((t) => /아포지/.test(t)) && n > 0 && n < total, `${total} → ${n}`);
  ok('B4 줄마다 제품·장비 표시', await p.locator('#clinics li.rk .k.prodk').count() === names.length);

  // 2) easy (steps) by default, detailed on demand, remembered
  await go('compare?k=X24');
  ok('B5 쉬운 보기 기본: 종류 → 용량·부위 → 횟수 단계', await p.locator('.vsteps .vstep').count() >= 1 && /종류|용량|횟수/.test(await p.locator('.vsteps').innerText()));
  const kinds = p.locator('.vsteps .vstep').first().locator('.vchip');
  const before = await p.evaluate(() => location.hash);
  if (await kinds.count() > 1) {
    const other = kinds.locator('xpath=self::*[@aria-checked="false"]').first(); const t = (await other.innerText()).trim();
    await other.click(); await p.waitForTimeout(800);
    const label = await p.locator('.cmphead .cmpt').innerText().catch(() => '');
    ok('B6 다른 종류를 누르면 그 종류의 비교 묶음으로 바뀜', (await p.evaluate(() => location.hash)) !== before && label.includes(t.split(' ')[0]), `${t} → ${label}`);
  } else ok('B6 다른 종류를 누르면 그 종류의 비교 묶음으로 바뀜', false, '종류가 하나뿐');
  await p.locator('.seg.modesw button', { hasText: '자세히' }).click(); await p.waitForTimeout(700);
  ok('B7 자세히: 모든 옵션 목록, 설정이 이 기기에 저장', await p.locator('.vrows').count() >= 1 && await p.evaluate(() => localStorage.getItem('pc:cmpMode')) === '"detail"');
  await p.locator('.seg.modesw button', { hasText: '쉬운 보기' }).click(); await p.waitForTimeout(500);

  // 3) comparability class in the price sheet
  await go('compare?k=X35');
  await p.locator('#clinics li.rk .infob').first().click(); await p.waitForTimeout(500);
  const cls = await p.locator('.clsbox').innerText().catch(() => '');
  ok('B8 가격 근거에 비교 판정(A~J·R)과 이유', /비교 판정/.test(cls) && /[A-JR] · /.test(cls), cls.replace(/\s+/g, ' ').slice(0, 80));
  await p.locator('.clsbox .linkbtn', { hasText: 'A~J 뜻' }).click(); await p.waitForTimeout(400);
  ok('B9 "A~J 뜻": 판정 11가지 설명', await p.locator('.sheet .fact').count() >= 11);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // 4) typed search results
  await go('search/' + encodeURIComponent('아포지') + '?nl=0', 1200);
  const typed = await p.locator('.card.typed').innerText().catch(() => '');
  const want = branchesNaming('아포지 플러스');
  ok('B10 검색 "아포지": 제품·장비 묶음 "아포지 플러스 · N곳"(N = 데이터의 판매 지점 수)', typed.includes(`아포지 플러스 · ${want}곳`), `기대 ${want}곳 · ${typed.replace(/\s+/g, ' ').slice(0, 120)}`);
  await go('search/' + encodeURIComponent('강남'), 1200);
  const t2 = await p.locator('.card.typed').innerText().catch(() => '');
  ok('B11 검색 "강남": 병원(블리비 강남역점)·지역(강남구) 묶음', /블리비 강남역점/.test(t2) && /강남구 · \d+곳/.test(t2), t2.replace(/\s+/g, ' ').slice(0, 120));
  await p.locator('.card.typed .chip', { hasText: '블리비 강남역점' }).click(); await p.waitForTimeout(800);
  ok('B12 병원 칩 → 그 지점 화면', /#branch\//.test(await p.evaluate(() => location.hash)) && /강남역점/.test(await p.locator('#main').innerText()));
  ok('B13 페이지 오류 0개', !errs.length, errs.slice(0, 3).join(' / '));
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`TOTAL ${pass}/${R.length} ${pass === R.length ? 'PASS' : 'FAIL'}`);
  process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
