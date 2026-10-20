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
//  - and what it says (2026-10-20 review): the track's two ends, the line and the dot sit where the bar's own numbers put them
//    (the numbers read aloud — its own name, or its line's — on its scale: the range, or the two ends written under a shared
//    scale), within 1px; every bar's lowest and highest price is in words on its line, or else its track is ≥ 3:1 on the card
//  - one meaning: a 홈 발견 row and the comparison it opens show the same range, middle price and branch count (the header's
//    '중간값', the price card's bar); with flags.discountEmphasis the dot is the bar's left end, the lowest plain price
//  - 지역별 가격 is the 가격 종류별 line: 'N곳 · lo~hi원', '중간값 X원' under the line; its first 8 lines, then '더 보기', and the
//    lines it adds are the same part on the same scale
//  - value bars with a ground (.qbar · .prog · .dbar) on --fill-2
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
ok('값 막대의 바탕(.qbar·.prog·.dbar)은 범위 막대 트랙과 같은 --fill-2, 6px·둥근 끝 3', ['qbar', 'prog', 'dbar'].every((c) => { const m = css.match(new RegExp(`(^|\\n)\\.${c} \\{([^}]*)\\}`)); return m && /background: var\(--fill-2\)/.test(m[2]) && /height: 6px/.test(m[2]) && /border-radius: 3px/.test(m[2]); }));
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
    const img = pr.getAttribute('role') === 'img', words = (img ? pr.getAttribute('aria-label') : ((pr.closest('[aria-label]') || {}).getAttribute?.('aria-label'))) || '';
    const named = img ? /가격 범위 [\d,]+원~[\d,]+원, 중간값 [\d,]+원/.test(words) : pr.getAttribute('aria-hidden') === 'true' && /중간값/.test(words);
    if (!named) bad.push(`읽는 이름 ${pr.getAttribute('role')} «${words}»`);
    // what it says: the numbers it is named with, placed on its scale (the range, or the shared scale's two ends written under
    // its list) — the track's ends, the line's centre and the dot's centre each within 1px of where those numbers put them
    const num = (x) => +String(x).replace(/,/g, '');
    const r2 = words.match(/가격 범위 ([\d,]+)원~([\d,]+)원/) || words.match(/([\d,]+)원부터 ([\d,]+)원까지/), r1 = !r2 && words.match(/곳, ([\d,]+)원, 중간값/);
    const lo = r2 ? num(r2[1]) : r1 ? num(r1[1]) : null, hi = r2 ? num(r2[2]) : lo, mm = words.match(/중간값 ([\d,]+)원/), med = mm ? num(mm[1]) : null;
    const ma = img && d ? words.match(/중간값 [\d,]+원, .+ ([\d,]+)원$/) : null, at = ma ? num(ma[1]) : null;
    let a = lo, b = hi;
    if (pr.classList.contains('axis')) { const ends = pr.closest('.pcls, .regl')?.nextElementSibling;
      const es = ends && ends.matches('.row.tiny') ? [...ends.children].filter((e) => /원$/.test(e.textContent)) : [];
      if (es.length === 2) { a = num(es[0].textContent.replace('원', '')); b = num(es[1].textContent.replace('원', '')); } else { a = b = null; bad.push('한 눈금인데 목록 아래 눈금 양 끝 글자가 없음'); } }
    if (lo == null || med == null) bad.push(`읽는 이름에서 범위·중간값을 못 읽음 «${words}»`);
    else if (a != null) {
      const f = (v) => (b > a ? Math.max(0, Math.min(1, (v - a) / (b - a))) : 0.5), W = box.width - 6, pos = (v) => box.left + 3 + W * f(v);
      if (Math.abs(tr.left - (pos(lo) - 3)) > 1 || Math.abs(tr.right - (pos(hi) + 3)) > 1) bad.push(`트랙 자리 ${(tr.left - box.left).toFixed(1)}~${(tr.right - box.left).toFixed(1)} (기대 ${(pos(lo) - 3 - box.left).toFixed(1)}~${(pos(hi) + 3 - box.left).toFixed(1)}, ${lo}~${hi}원)`);
      if (m && Math.abs(mr.left + mr.width / 2 - pos(med)) > 1) bad.push(`중간값 선 자리 ${(mr.left + mr.width / 2 - box.left).toFixed(1)} (기대 ${(pos(med) - box.left).toFixed(1)}, ${med}원)`);
      if (d) { const dr = d.getBoundingClientRect(); if (at == null) bad.push('점이 있는데 읽는 이름에 그 가격이 없음');
        else if (Math.abs(dr.left + dr.width / 2 - pos(at)) > 1) bad.push(`점 자리 ${(dr.left + dr.width / 2 - box.left).toFixed(1)} (기대 ${(pos(at) - box.left).toFixed(1)}, ${at}원)`); }
    }
    // the range's two ends in words on the bar's own line (or the track alone must be seen: 3:1 on the card)
    if (lo != null) { const line = pr.closest('li, .pcl, .disc-row, .hero') || pr.parentElement, txt = (line.innerText || '').replace(/\s+/g, '');
      const c = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const says = lo === hi ? txt.includes(`${c(lo)}원`) : [Pricing.rangeText(lo, hi), `${c(lo)}원~${c(hi)}원`].some((t) => txt.includes(t.replace(/\s+/g, '')));
      if (!says && __cr(tc.backgroundColor, card) < 3) bad.push(`범위 양 끝이 줄 글자에 없고 트랙은 카드와 ${__cr(tc.backgroundColor, card).toFixed(2)}:1 «${txt.slice(0, 60)}»`); }
    return { bad, w: Math.round(box.width), axis: pr.classList.contains('axis'), dot: !!d, label, lo, hi, med, at };
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
      if (e.matches(VALUE)) { if (!e.matches('.vbar i') && Math.abs(r.height - 6) > 0.1) thin.push(`${e.className || e.tagName}:${r.height}px(값 막대는 6)`);
        if (e.matches('.qbar, .prog, .dbar') && cs.backgroundColor !== __tok('--fill-2')) thin.push(`${e.className}: 바탕 ${cs.backgroundColor}(값 막대 바탕은 --fill-2)`); continue; }
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
  // 홈 발견 rows against the comparison each opens: the header's '중간값' and its count, the price card bar's range and middle
  // (dot: the dot is the bar's left end — the lowest plain price, the comparison's own lowest)
  const sameAsCompare = async (p, dot) => {
    const rows = await p.evaluate(() => [...document.querySelectorAll('#main .disc-row')].map((r) => ({ t: r.querySelector('.t').textContent, ...__bar(r.querySelector('.prange')),
      n: +(((r.querySelector('.m') || {}).textContent || '').match(/(\d+)곳$/) || [])[1] || null })));
    const bad = [];
    for (let i = 0; i < rows.length; i++) {
      await go(p, '#home', 900); await p.locator('#main .disc-row').nth(i).click(); await p.waitForTimeout(1300);
      const c = await p.evaluate(() => { const pr = document.querySelector('#main .pricecard .hero > .prange'), hm = document.querySelector('.cmphead .hmed'), bs = document.querySelector('.cmphead .basis');
        return { k: location.hash, hmed: hm ? +hm.textContent.replace(/[^\d]/g, '') : null, n: bs ? +((bs.textContent.match(/(\d+)곳/) || [])[1]) : null, bar: pr ? __bar(pr) : null }; });
      const x = rows[i], why = [];
      if (c.hmed !== x.med) why.push(`중간값 홈 ${x.med} · 비교 ${c.hmed}`);
      if (c.n !== x.n) why.push(`지점 수 홈 ${x.n} · 비교 ${c.n}`);
      if (!c.bar || c.bar.lo !== x.lo || c.bar.hi !== x.hi || c.bar.med !== x.med) why.push(`막대 홈 ${x.lo}~${x.hi}/${x.med} · 비교 ${c.bar ? `${c.bar.lo}~${c.bar.hi}/${c.bar.med}` : '없음'}`);
      if (dot && x.at !== x.lo) why.push(`점 ${x.at} ≠ 왼쪽 끝 ${x.lo}`);
      if (why.length) bad.push(`${x.t}: ${why.join(', ')}`);
    }
    return [rows.length >= 3 && !bad.length, bad.join(' | ') || `${rows.length}줄 같음`];
  };

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
    // one meaning: each row, then the comparison it opens — the same range, middle price and branch count
    if (vp.width === 390 && scheme === 'light') ok('홈 발견 줄 = 누르면 열리는 비교(범위·중간값·지점 수)', ...(await sameAsCompare(p)));

    // ---------- 비교 가격 카드 (X12) and its folds
    await go(p, '#compare?k=X12', 1500);
    const hero = await bars(p, '#main .pricecard .hero > .prange');
    ok(`${tag} 비교 가격 카드: 같은 부품 + 중간값 라벨(선 아래, 막대 안)`, hero.length === 1 && !badOf(hero).length && /^중간값 [\d,]+원$/.test(hero[0].label || ''), JSON.stringify(hero[0] || {}).slice(0, 200));
    const hmed = await p.evaluate(() => (document.querySelector('.cmphead .hmed') || {}).textContent || '');
    ok(`${tag} 비교: 막대 라벨의 중간값 = 머리글 중간값`, !!hero[0] && hmed.replace(/[^\d]/g, '') === (hero[0].label || '').replace(/[^\d]/g, ''), `${hmed} · ${hero[0] && hero[0].label}`);
    await p.evaluate(() => { for (const d of document.querySelectorAll('#main details.cmpfold')) d.open = true; }); await p.waitForTimeout(700);
    const kinds = await bars(p, '#main .pcls .prange'), regs = await bars(p, '#main .regl .prange');
    ok(`${tag} 가격 종류별 범위: 줄마다 같은 부품(한 눈금 · 중간값 라벨)`, kinds.length >= 2 && !badOf(kinds).length && kinds.every((x) => x.axis && x.label), `${kinds.length}줄 ${badOf(kinds).slice(0, 3).join(' | ')}`);
    ok(`${tag} 지역별 가격: 줄마다 같은 부품(한 눈금 · 중간값 라벨)`, regs.length >= 2 && !badOf(regs).length && regs.every((x) => x.axis && x.label), `${regs.length}줄 ${badOf(regs).slice(0, 3).join(' | ')}`);
    // the two cards' lines are one line: name (badge) · 'N곳 · lo~hi원' on the right · the bar · '중간값 X원'
    const lines = await p.evaluate(() => [...document.querySelectorAll('#main .pcls .pcl, #main .regl li')].filter(__vis).map((e) => [...e.children].map((c) => c.className).join(' + ') + ' | ' + ((e.querySelector('.rv') || {}).textContent || '')));
    ok(`${tag} 가격 종류별·지역별 줄은 한 모양(이름 · 'N곳 · lo~hi원' · 막대 · 중간값 라벨)`, lines.length >= 4 && lines.every((t) => /^row \+ prange axis \| [\d,]+곳 · [\d,.만]+(~[\d,.만]+)?원$/.test(t)), [...new Set(lines.map((t) => t.replace(/\d[\d,.만~]*/g, '#')))].join(' / '));
    const regMore = p.locator('#main section[aria-label="지역별 같은 사양 가격"] > .morelist');
    ok(`${tag} 지역별 가격: 처음 8줄, 나머지는 '더 보기'`, regs.length <= 8 && (regs.length < 8 || (await regMore.count()) === 1), `${regs.length}줄 · 더 보기 ${await regMore.count()}`);
    if (await regMore.count()) { await regMore.click(); await p.waitForTimeout(300);
      const all = await bars(p, '#main .regl .prange');
      ok(`${tag} 지역별 '더 보기'로 더한 줄도 같은 부품 · 같은 눈금`, all.length > regs.length && !badOf(all).length && all.every((x) => x.axis && x.label) && new Set(all.map((x) => x.w)).size === 1, `${regs.length} → ${all.length}줄 ${badOf(all).slice(0, 3).join(' | ')}`); }
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
    if (scheme === 'light') ok('홈 발견(할인 강조 켬) 줄 = 누르면 열리는 비교, 점 = 막대 왼쪽 끝(가장 낮은 조건 없는 가격)', ...(await sameAsCompare(p, true)));
    await go(p, '#home', 1200);
    const aria = await p.evaluate(() => (document.querySelector('#main .disc-row .prange') || {}).getAttribute?.('aria-label') || '');
    ok('점이 있는 막대의 읽는 이름: 범위 · 중간값 · 그 가격', /가격 범위 [\d,]+원~[\d,]+원, 중간값 [\d,]+원, .+ [\d,]+원$/.test(aria), aria);
    ok(`홈 발견(할인 강조 켬) ${scheme}: 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  const pass = R.filter(Boolean).length; console.log(`\n${pass}/${R.length} 통과`); process.exit(pass === R.length ? 0 : 1);
})();
