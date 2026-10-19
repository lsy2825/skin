// Type steps (2026-10-19 사용자 결정, 위계 점검 24·25·26·41·42): screen title 22 · section 17 · body and prices 15 · aux 13, one
// 28 per screen (비교 가격 범위, 견적 합계), fields 16 (iOS zooms into a smaller one), nothing under 13; weights 400 · 600 · 760.
// 1) app/styles.css says sizes and weights only through the --fs-* / --fw-* tokens, and app.js writes no font size or weight
//    in a style attribute. 2) In a browser at 390 and 320 px, every screen's own text uses only those steps.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/type_steps.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const ROOT = path.join(__dirname, '..', '..');

// ---- 1) the source
const css = fs.readFileSync(path.join(ROOT, 'app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const TOK = { '--fs-title': '22px', '--fs-sec': '17px', '--fs-body': '15px', '--fs-aux': '13px', '--fs-num': '28px', '--fs-input': '16px',
  '--fw-reg': '400', '--fw-semi': '600', '--fw-bold': '760' };
const root = (css.match(/:root\s*\{([^}]*)\}/) || [, ''])[1];
const tokBad = Object.entries(TOK).filter(([k, v]) => !new RegExp(`${k}:\\s*${v}\\s*;`).test(root)).map(([k]) => k);
ok('토큰 9개가 :root에 정한 값으로 있음', !tokBad.length, tokBad.join(', ') || Object.entries(TOK).map(([k, v]) => `${k} ${v}`).join(' · '));
const sizes = [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim());
const badS = sizes.filter((v) => !/^var\(--fs-(title|sec|body|aux|num|input)\)$/.test(v));
ok('styles.css의 font-size는 모두 --fs-* 토큰(직접 적은 px 없음)', !badS.length, badS.length ? badS.slice(0, 8).join(', ') : `${sizes.length}곳`);
const weights = [...css.matchAll(/font-weight:\s*([^;}]+)/g)].map((m) => m[1].trim());
const badW = weights.filter((v) => !/^(var\(--fw-(reg|semi|bold)\)|inherit)$/.test(v));
ok('styles.css의 font-weight는 모두 --fw-* 토큰(400·600·760)', !badW.length, badW.length ? badW.slice(0, 8).join(', ') : `${weights.length}곳`);
const shorts = [...css.matchAll(/(?:^|[;{\s])font:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => v !== 'inherit' && !/^var\(--fs-[a-z]+\)\//.test(v));
ok('font 줄임 표기도 토큰만', !shorts.length, shorts.join(', '));
const js = ['app/app.js', 'app/commerce.js'].filter((f) => fs.existsSync(path.join(ROOT, f))).map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
const inl = js.flatMap(([f, s]) => s.split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => /font-(size|weight)\s*:|fontSize|fontWeight/.test(l)).map(([f, n]) => `${f}:${n}`));
ok('app.js에 직접 적은 글자 크기·굵기 없음(클래스로)', !inl.length, inl.slice(0, 6).join(', '));

// ---- 2) the screens
const SIZES = new Set([13, 15, 16, 17, 22, 28]), WEIGHTS = new Set([400, 600, 760]);
const scan = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
  const out = { sizes: {}, weights: {}, off: [], f16: [], big: [], fields: [], small: [] };
  for (const el of document.querySelectorAll('#main *')) {
    if (!vis(el) || el.closest('.sr')) continue;
    const cs = getComputedStyle(el), s = parseFloat(cs.fontSize), w = +cs.fontWeight;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) { if (el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'range' && s < 16) out.fields.push(`${name(el)} ${s}`); continue; }
    if (el.closest('select')) continue;   // <option>
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own) continue;
    out.sizes[s] = (out.sizes[s] || 0) + 1; out.weights[w] = (out.weights[w] || 0) + 1;
    if (s < 13) out.small.push(`${name(el)} ${s}`);
    out.off.push([s, w, `${name(el)} '${el.textContent.trim().slice(0, 16)}'`]);
    if (s === 16 && !el.closest('.pick')) out.f16.push(name(el));
    if (s === 28) { let top = el; while (top.parentElement && parseFloat(getComputedStyle(top.parentElement).fontSize) === 28) top = top.parentElement; if (!out.big.includes(top)) out.big.push(top); }
  }
  out.big = out.big.map(name);
  return out;
};

(async () => { const b = await chromium.launch();
  for (const W of [390, 320]) {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: W, height: 844 } }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await p.goto(BASE);
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('수도권'));
      localStorage.setItem('pc:carts', JSON.stringify([{ id: 'h', name: '점검용 견적', items: [{ t: 'k', k: 'X14', q: 3 }, { t: 'k', k: 'X01', q: 2 }, { t: 'k', k: 'X12', q: 1 }] }]));
      localStorage.setItem('pc:ci', '0'); });
    await p.reload();
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    await p.waitForFunction(() => window.App && window.App.data() && !window.App.data().meta.partial, null, { timeout: 90000 });
    const bi = await p.evaluate(() => { const { D } = App.state(); const i = D.branches.findIndex((x) => D.s[x[1]] === '강남역점'); return i >= 0 ? i : 0; });
    const screens = [['홈', '#home'], ['검색', '#search?q=' + encodeURIComponent('리쥬란')], ['비교', '#compare?k=X01'], ['지점', `#branch/${bi}`], ['내 견적', '#cart'],
      ['내 견적 병원별', '#cart', 'quote'], ['내 견적 나눠 받기', '#cart', 'mix'], ['탐색', '#explore'], ['관심', '#saved'], ['마이', '#me'], ['지점 비교', '#versus'], ['전체 가격표', '#table']];
    for (const [label, hash, step] of screens) {
      await p.goto(BASE + hash); await p.waitForTimeout(900);
      if (step) { const ex = p.locator('.cartsum button[aria-expanded="false"]'); if (await ex.count()) { await ex.first().click(); await p.waitForTimeout(500); }
        if (step === 'mix') { const t = p.locator('#main [role=tab], #main .seg button', { hasText: '나눠 받기' }).first(); if (await t.count()) { await t.click(); await p.waitForTimeout(500); } } }
      const r = await p.evaluate(scan);
      const ks = Object.keys(r.sizes).map(Number).sort((a, c) => c - a), kw = Object.keys(r.weights).map(Number).sort();
      const offS = r.off.filter(([s]) => !SIZES.has(s)).map(([s, , n]) => `${s}px ${n}`), offW = r.off.filter(([, w]) => !WEIGHTS.has(w)).map(([, w, n]) => `${w} ${n}`);
      ok(`${W} ${label}: 글자 크기는 단계 안(${ks.length}가지 ≤ 5)`, !offS.length && ks.length <= 5 && !r.f16.length, `${ks.join('·')}${offS.length ? ' | 밖: ' + offS.slice(0, 4).join(', ') : ''}${r.f16.length ? ' | 16(입력칸 아님): ' + r.f16.slice(0, 3).join(', ') : ''}`);
      ok(`${W} ${label}: 굵기 3단계`, !offW.length, `${kw.join('·')}${offW.length ? ' | 밖: ' + offW.slice(0, 4).join(', ') : ''}`);
      ok(`${W} ${label}: 숫자 강조 28은 하나 이하`, r.big.length <= 1, r.big.join(', ') || '없음');
      ok(`${W} ${label}: 13px보다 작은 글자 없음 · 입력칸 16px 이상`, !r.small.length && !r.fields.length, [...r.small, ...r.fields].slice(0, 4).join(', '));
      if (label === '비교') ok(`${W} 비교: 28은 가격 범위`, r.big.length === 1 && /hp/.test(r.big[0]) && /range/.test(r.big[0]), r.big.join(', '));
      if (label === '내 견적') ok(`${W} 내 견적: 28은 견적 합계`, r.big.length === 1 && await p.locator('.cartsum .hp').count() > 0, r.big.join(', '));
      if (step === 'mix') { const m = await p.evaluate(() => { const t = document.querySelector('#main [role=tab][aria-selected=true]'), e = document.querySelector('#main .hero.minor .hp');
        return { tab: t && t.textContent.trim(), hp: e ? parseFloat(getComputedStyle(e).fontSize) : null, empty: !!document.querySelector('#main .card .empty') }; });
        ok(`${W} 나눠 받기 합계는 28 아래 한 단계(22)`, m.tab === '나눠 받기' && (m.hp === 22 || (m.hp === null && m.empty)), JSON.stringify(m)); }
    }
    // the home's order: title 22 · section 17 · card name 15/600 · card price 17/760
    await p.goto(BASE + '#home'); await p.waitForTimeout(700);
    const hm = await p.evaluate(() => { const f = (s) => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return `${parseFloat(c.fontSize)}/${c.fontWeight}`; };
      return { title: f('.hero-home .display'), sec: f('.sec-h h2'), name: f('.pc .l'), price: f('.pc .p'), tab: f('nav.tabs .badge') }; });
    ok(`${W} 홈: 구호 22/760 · 섹션 17/760 · 카드 이름 15/600 · 카드 가격 17/760`, hm.title === '22/760' && hm.sec === '17/760' && hm.name === '15/600' && hm.price === '17/760', JSON.stringify(hm));
    ok(`${W} 탭 숫자 배지 13px 이상`, !hm.tab || parseFloat(hm.tab) >= 13, hm.tab || '배지 없음');
    ok(`${W} 페이지 오류 없음`, !errs.length, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  await b.close();
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} 통과`); process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
