// 범위 막대 한 모양 (2026-10-20 사용자 지시: "메인페이지의 중간 가격 보이는 바형 레인지가 다른 것과 모양이 다르다" — 홈 '죠미의 오늘의
// 발견'의 막대와 비교 가격 카드의 막대가 달랐음). docs/DESIGN_SYSTEM.md §3 '범위 막대'. Every price range drawn as a bar is the one
// part app.js rangeBar → .prange: a 6px track with round ends (--fill-2) from the lowest to the highest price, the middle price as
// a 2px --ink-2 line 4px over and under the track, a given price as a 12px --s1 dot ringed in the card colour, '중간값 X원' (13/600
// --ink-2) 8px under the track and under the line where a screen names it. Bars on one shared scale (가격 종류별·지역별) are as
// wide as each other. The distribution chart's middle is the same line (solid 2px --ink-2), the price history's middle series
// is --ink-2 too. The other thin bars (a price as a length: 빠른 비교, A/B, 가격 변동, 순위) are 6px on the same --fill-2.
// What it holds, at 390 and 320 wide, light and dark: 홈 발견 (and with flags.discountEmphasis, the dot), 비교 가격 카드, its folds
// (분포 그래프 · 가격 종류별 범위 · 지역별 가격), and on 검색 · 지점 · 내 견적 · 가격 변동 · 빠른 비교 · A/B no other range bar shape:
//  - any role=img naming '중간값' outside a chart is a .prange; no painted thin bar (3–16px high, 3:1 wider than high, no words)
//    outside .prange except the listed value bars (and those are 6px)
//  - each .prange measured: track 6px · radius 3 · --fill-2; one line 2×14, 4px over the track, --ink-2; dot 12px --s1 ringed in
//    the card colour; label 13/600 --ink-2, 8px under the track, in the bar, over the line; the line ≥ 3:1 on the track and the
//    card, the dot ≥ 3:1 on the card (light and dark); no page wider than the screen
// Turning any of it back (the old .mrange / .rangebar / .pcl-track / .rbar, a dashed chart middle, an 8px track) fails here.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/range_shape.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 300)}`); };
const ROOT = path.join(__dirname, '..', '..');
const CART = [{ t: 'k', k: 'X14', q: 3 }, { t: 'k', k: 'X01', q: 2 }, { t: 'k', k: 'X12', q: 1 }];

// ---- the source: one part, the old ones gone; the charts' middle
const app = fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8'), css = fs.readFileSync(path.join(ROOT, 'app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const old = ['mrange', 'rangebar', 'rbar', 'pcl-track', 'pcl-bar', 'pcl-med', 'midl'].filter((c) => new RegExp(`["' .]${c}["' {]`).test(app) || new RegExp(`\\.${c}\\b`).test(css));
ok('옛 범위 막대 이름(.mrange·.rangebar·.pcl-track·.rbar)이 app.js·styles.css에 없음', !old.length, old.join(', '));
ok('범위 막대를 그리는 함수는 rangeBar 하나(class "prange"는 그 안에서만)', (app.match(/class: `prange/g) || []).length === 1 && (app.match(/function rangeBar\(/g) || []).length === 1 && !/class: "prange/.test(app));
ok('가격 이력: 중간값 선은 --ink-2(범위 막대의 선 색), 최저가는 --s1', /\{ name: "중간값", color: "var\(--ink-2\)"/.test(app) && /\{ name: "최저가", color: "var\(--s1\)"/.test(app));
ok('분포 그래프·가격 동향 작은 선: 중간값은 실선 2px --ink-2', /\.lcsvg \.med \{ stroke: var\(--ink-2\); stroke-width: 2; \}/.test(css) && !/\.lcsvg \.med \{[^}]*dasharray/.test(css) && /\.spark path \{[^}]*stroke: var\(--ink-2\)/.test(css));

// in-page helpers
const HELP = () => {
  window.__vis = (el) => !!el && el.checkVisibility() && el.getBoundingClientRect().width > 0;
  window.__tok = (v) => { const e = document.createElement('i'); e.style.background = `var(${v})`; document.body.append(e); const c = getComputedStyle(e).backgroundColor; e.remove(); return c; };
  const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (c) => rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  window.__cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  window.__bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return getComputedStyle(document.body).backgroundColor; };
  // one bar, measured against the tokens
  window.__bar = (pr) => {
    const T = { fill2: __tok('--fill-2'), ink2: __tok('--ink-2'), s1: __tok('--s1'), surface: __tok('--surface') };
    const box = pr.getBoundingClientRect(), bar = pr.querySelector(':scope > .pr-bar'), t = bar && bar.querySelector(':scope > .pr-t'), ms = bar ? [...bar.querySelectorAll(':scope > .pr-m')] : [];
    const d = bar && bar.querySelector(':scope > .pr-d'), l = pr.querySelector(':scope > .pr-l'), bad = [];
    if (!t) return { bad: ['트랙 없음'] };
    const tr = t.getBoundingClientRect(), tc = getComputedStyle(t), card = __bgOf(pr.parentElement);
    if (Math.abs(tr.height - 6) > 0.1) bad.push(`트랙 높이 ${tr.height}`);
    if (tc.borderRadius !== '3px') bad.push(`트랙 둥근 끝 ${tc.borderRadius}`);
    if (tc.backgroundColor !== T.fill2) bad.push(`트랙 색 ${tc.backgroundColor}`);
    if (tr.left < box.left - 0.5 || tr.right > box.right + 0.5) bad.push('트랙이 막대 밖');
    if (!pr.classList.contains('axis') && (Math.abs(tr.left - box.left) > 0.5 || Math.abs(tr.right - box.right) > 0.5)) bad.push('혼자 쓰는 막대인데 트랙이 끝까지 가지 않음');
    if (ms.length !== 1) bad.push(`중간값 선 ${ms.length}개`);
    const m = ms[0], mr = m && m.getBoundingClientRect(), mc = m && getComputedStyle(m);
    if (m) {
      if (Math.abs(mr.width - 2) > 0.1 || Math.abs(mr.height - 14) > 0.1) bad.push(`중간값 선 ${mr.width}×${mr.height}`);
      if (Math.abs(mr.top - (tr.top - 4)) > 0.5) bad.push(`중간값 선 위 ${(tr.top - mr.top).toFixed(1)}px`);
      if (mc.backgroundColor !== T.ink2) bad.push(`중간값 선 색 ${mc.backgroundColor}`);
      const cx = mr.left + mr.width / 2; if (cx < tr.left - 0.5 || cx > tr.right + 0.5) bad.push('중간값 선이 트랙 밖');
      if (__cr(mc.backgroundColor, tc.backgroundColor) < 3 || __cr(mc.backgroundColor, card) < 3) bad.push(`중간값 선 대비 ${__cr(mc.backgroundColor, tc.backgroundColor).toFixed(2)}/${__cr(mc.backgroundColor, card).toFixed(2)}`);
    }
    if (d) { const dr = d.getBoundingClientRect(), dc = getComputedStyle(d);
      if (Math.abs(dr.width - 12) > 0.1 || Math.abs(dr.height - 12) > 0.1 || dc.borderRadius !== '50%') bad.push(`점 ${dr.width}×${dr.height} ${dc.borderRadius}`);
      if (dc.backgroundColor !== T.s1) bad.push(`점 색 ${dc.backgroundColor}`);
      if (!dc.boxShadow.includes(T.surface) || !/ 2px$|2px\)?$/.test(dc.boxShadow.trim())) bad.push(`점 테두리 ${dc.boxShadow}`);
      if (Math.abs((dr.top + dr.bottom) / 2 - (tr.top + tr.bottom) / 2) > 0.5) bad.push('점이 트랙 가운데에 있지 않음');
      if (__cr(dc.backgroundColor, card) < 3) bad.push(`점 대비 ${__cr(dc.backgroundColor, card).toFixed(2)}`); }
    let label = null;
    if (l) { const lr = l.getBoundingClientRect(), lc = getComputedStyle(l); label = l.textContent;
      if (lc.fontSize !== '13px' || lc.fontWeight !== '600' || lc.color !== T.ink2) bad.push(`라벨 글자 ${lc.fontSize}/${lc.fontWeight} ${lc.color}`);
      if (Math.abs(lr.top - (tr.bottom + 8)) > 0.5) bad.push(`라벨 위치 트랙 아래 ${(lr.top - tr.bottom).toFixed(1)}px`);
      if (lr.left < box.left - 0.5 || lr.right > box.right + 0.5) bad.push('라벨이 막대 밖');
      const cx = mr ? mr.left + mr.width / 2 : 0; if (cx < lr.left - 0.5 || cx > lr.right + 0.5) bad.push('라벨이 중간값 선 아래가 아님');
      if (!/^중간값 [\d,]+원$/.test(l.textContent)) bad.push(`라벨 글자 «${l.textContent}»`); }
    const named = pr.getAttribute('role') === 'img' ? /가격 범위 [\d,]+원~[\d,]+원, 중간값 [\d,]+원/.test(pr.getAttribute('aria-label') || '')
      : pr.getAttribute('aria-hidden') === 'true' && /중간값/.test((pr.closest('[aria-label]') || {}).getAttribute?.('aria-label') || '');
    if (!named) bad.push(`읽는 이름 ${pr.getAttribute('role')} «${pr.getAttribute('aria-label') || ''}»`);
    return { bad, w: Math.round(box.width), axis: pr.classList.contains('axis'), dot: !!d, label };
  };
  // anything else that draws a price range: a picture named '중간값' that is not the part, a painted thin bar outside it
  window.__stray = () => {
    const VALUE = '.qbar, .qbar *, .pbars i, .cbar .side i, .prog, .prog *, .dbar, .dbar *, .vbar i';
    const imgs = [...document.querySelectorAll('#main [role=img]')].filter((e) => __vis(e) && /중간값/.test(e.getAttribute('aria-label') || '') && !e.matches('svg, .prange'))
      .map((e) => `img.${e.className}`);
    const thin = [];
    for (const e of document.querySelectorAll('#main *')) {
      if (e.closest('svg') || e.closest('.prange') || !__vis(e)) continue;
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if (r.height < 3 || r.height > 16 || r.width < r.height * 3 || r.width < 24) continue;
      if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') continue;
      if (e.textContent.trim() || e.querySelector('svg, img')) continue;
      if (e.matches(VALUE)) { if (!e.matches('.vbar i') && Math.abs(r.height - 6) > 0.1) thin.push(`${e.className || e.tagName}:${r.height}px(값 막대는 6)`); continue; }
      thin.push(`${e.tagName.toLowerCase()}.${e.className}:${Math.round(r.width)}×${r.height} in .${e.parentElement.className}`);
    }
    return [...imgs, ...thin];
  };
};

(async () => {
  const b = await chromium.launch();
  const page = async (vp, scheme, flags) => {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: true, hasTouch: true, colorScheme: scheme }); await ctx.addInitScript(HELP);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    if (flags) await p.route('**/config.js', async (r) => { const res = await r.fetch(); let t = await res.text(); for (const f of flags) t = t.replace(`${f}: false`, `${f}: true`); r.fulfill({ response: res, body: t }); });
    await p.goto(BASE); await p.evaluate((items) => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('수도권'));
      localStorage.setItem('pc:carts', JSON.stringify([{ id: 's', name: '막대 시험', items }])); localStorage.setItem('pc:ci', '0'); }, CART);
    await p.reload();
    if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
    await p.waitForSelector('#main .card'); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    return { ctx, p, errs };
  };
  const go = async (p, hash, wait = 1200) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(wait); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(150); };
  const bars = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].filter(__vis).map(__bar), sel);
  const badOf = (xs) => xs.flatMap((x, i) => x.bad.map((m) => `#${i} ${m}`));
  const wide = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  for (const [vp, scheme] of [[{ width: 390, height: 844 }, 'light'], [{ width: 390, height: 844 }, 'dark'], [{ width: 320, height: 640 }, 'light'], [{ width: 320, height: 640 }, 'dark']]) {
    const tag = `${vp.width} ${scheme === 'dark' ? '어두운' : '밝은'}`;
    const { ctx, p, errs } = await page(vp, scheme);

    // ---------- 홈 '죠미의 오늘의 발견'
    await go(p, '#home', 1500);
    const hm = await bars(p, '#main .disc-row .prange');
    const nRows = await p.locator('#main .disc-row').count();
    ok(`${tag} 홈 발견: 줄마다 범위 막대 하나(같은 부품)`, nRows >= 3 && hm.length === nRows, `줄 ${nRows} · 막대 ${hm.length}`);
    ok(`${tag} 홈 발견 막대: 트랙 6·--fill-2, 중간값 세로선 2×14 --ink-2, 라벨 없음`, hm.length && !badOf(hm).length && hm.every((x) => !x.label && !x.axis), badOf(hm).slice(0, 4).join(' | '));
    const hs = await p.evaluate(() => __stray());
    ok(`${tag} 홈: 다른 모양의 범위 막대 없음`, !hs.length, hs.slice(0, 5).join(' | '));
    ok(`${tag} 홈: 가로 넘침 없음`, (await wide(p)) <= 0, `${await wide(p)}px`);

    // ---------- 비교 가격 카드 (X12) and its folds
    await go(p, '#compare?k=X12', 1500);
    const hero = await bars(p, '#main .pricecard .hero > .prange');
    ok(`${tag} 비교 가격 카드: 같은 부품 + 중간값 라벨(선 아래, 막대 안)`, hero.length === 1 && !badOf(hero).length && /^중간값 [\d,]+원$/.test(hero[0].label || ''), JSON.stringify(hero[0] || {}).slice(0, 200));
    const hmed = await p.evaluate(() => (document.querySelector('.cmphead .hmed') || {}).textContent || '');
    ok(`${tag} 비교: 막대 라벨의 중간값 = 머리글 중간값`, !!hero[0] && hmed.replace(/[^\d]/g, '') === (hero[0].label || '').replace(/[^\d]/g, ''), `${hmed} · ${hero[0] && hero[0].label}`);
    await p.evaluate(() => { for (const d of document.querySelectorAll('#main details.cmpfold')) d.open = true; }); await p.waitForTimeout(700);
    const kinds = await bars(p, '#main .pcls .prange'), regs = await bars(p, '#main .regl .prange');
    ok(`${tag} 가격 종류별 범위: 줄마다 같은 부품(한 눈금 · 중간값 라벨)`, kinds.length >= 2 && !badOf(kinds).length && kinds.every((x) => x.axis && x.label), `${kinds.length}줄 ${badOf(kinds).slice(0, 3).join(' | ')}`);
    ok(`${tag} 지역별 가격: 줄마다 같은 부품(한 눈금)`, regs.length >= 2 && !badOf(regs).length && regs.every((x) => x.axis), `${regs.length}줄 ${badOf(regs).slice(0, 3).join(' | ')}`);
    ok(`${tag} 한 눈금의 막대는 폭이 모두 같음(가격 종류별 · 지역별)`, new Set(kinds.map((x) => x.w)).size === 1 && new Set(regs.map((x) => x.w)).size === 1 && regs[0].w >= vp.width - 100,
      `종류 ${[...new Set(kinds.map((x) => x.w))].join('/')} · 지역 ${[...new Set(regs.map((x) => x.w))].join('/')}`);
    const med = await p.evaluate(() => { const l = document.querySelector('#main .lcsvg .med'); if (!l) return null; const cs = getComputedStyle(l);
      return { stroke: cs.stroke, w: cs.strokeWidth, dash: cs.strokeDasharray, ink2: __tok('--ink-2') }; });
    ok(`${tag} 분포 그래프의 중간값: 범위 막대와 같은 세로선(실선 2px --ink-2)`, !!med && med.stroke === med.ink2 && med.w === '2px' && med.dash === 'none', JSON.stringify(med));
    const cs = await p.evaluate(() => __stray());
    ok(`${tag} 비교(접기 펼침): 다른 모양의 범위 막대 없음`, !cs.length, cs.slice(0, 5).join(' | '));
    ok(`${tag} 비교(접기 펼침): 가로 넘침 없음`, (await wide(p)) <= 0, `${await wide(p)}px`);

    // ---------- the other screens: no other range bar shape, value bars 6px
    if (scheme === 'light') {
      const bi = await p.evaluate(() => { const { D } = App.state(); const x = D.branches.findIndex((y) => D.s[y[1]] === '강남역점'); return x >= 0 ? x : 0; });
      const short = await p.evaluate((bi) => { const { D } = App.state(); return [bi, bi + 1].map((i) => `${D.meta.brands[D.branches[i][0]][0]}|${D.s[D.branches[i][1]]}`); }, bi);
      await p.evaluate((s) => localStorage.setItem('pc:short', JSON.stringify(s)), short);
      const seen = [];
      for (const [name, hash] of [['검색', '#search/' + encodeURIComponent('리쥬란 2cc')], ['지점', `#branch/${bi}`], ['내 견적', '#cart'], ['가격 변동', '#change'], ['빠른 비교', '#quick?k=X12'], ['A/B', `#versus/${bi}/${bi + 1}`], ['탐색', '#explore']]) {
        await go(p, hash, 1300);
        await p.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; }); await p.waitForTimeout(300);
        const s = await p.evaluate(() => __stray()), n = await p.evaluate(() => [...document.querySelectorAll('#main .qbar, #main .pbars i, #main .cbar .side i, #main .dbar')].filter(__vis).length);
        seen.push(`${name} 값 막대 ${n}`);
        ok(`${tag} ${name}: 다른 모양의 범위 막대 없음, 값 막대는 6px`, !s.length, s.slice(0, 4).join(' | '));
      }
      console.log(`INFO | ${tag} ${seen.join(' · ')}`);
    }
    ok(`${tag} 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // ---------- the dot: 홈 발견 with flags.discountEmphasis (the lowest plain price on the bar)
  for (const scheme of ['light', 'dark']) {
    const { ctx, p, errs } = await page({ width: 390, height: 844 }, scheme, ['discountEmphasis']);
    await go(p, '#home', 1500);
    const hm = await bars(p, '#main .disc-row .prange');
    ok(`390 ${scheme === 'dark' ? '어두운' : '밝은'} 홈 발견(할인 강조 켬): 같은 부품 + 이 가격 점(12px --s1, 바탕색 테두리)`, hm.length >= 3 && hm.every((x) => x.dot) && !badOf(hm).length, badOf(hm).slice(0, 4).join(' | ') || `${hm.length}줄`);
    const aria = await p.evaluate(() => (document.querySelector('#main .disc-row .prange') || {}).getAttribute?.('aria-label') || '');
    ok('점이 있는 막대의 읽는 이름: 범위 · 중간값 · 그 가격', /가격 범위 [\d,]+원~[\d,]+원, 중간값 [\d,]+원, .+ [\d,]+원$/.test(aria), aria);
    ok(`홈 발견(할인 강조 켬) ${scheme}: 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  const pass = R.filter(Boolean).length; console.log(`\n${pass}/${R.length} 통과`); process.exit(pass === R.length ? 0 : 1);
})();
