// Spacing steps (2026-10-19 사용자 결정, 위계 점검 51 · 6.0 규칙 3): 8px units — 8 inside a block, 16 inside a card (its padding,
// between its blocks), 24 between a screen's blocks, 32 for the big breaks; 4 only inside a badge or chip (and between a badge
// row's lines). Off the grid on purpose (docs/DESIGN_SYSTEM.md §2 '간격'): the words' start line in a list line 14 (6 + 14 = a
// card's 20 — 위계 점검 52), a card's 20 at the sides, a list card's 6, and 1–3px that line an icon up with its words.
// 1) app/styles.css: the tokens, and every margin · padding · gap on the steps (or one of those exceptions, at the sides only);
//    app.js style="" spacing too. 2) In a browser at 390 and 320 px: a screen's blocks are 8 · 16 · 24 · 32 apart, cards and list
//    lines have their steps, and most spacing on screen is a multiple of 8.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/space_steps.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 300)}`); };
const ROOT = path.join(__dirname, '..', '..');

// ---- 1) the source
const css = fs.readFileSync(path.join(ROOT, 'app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
const root = (css.match(/:root\s*\{([^}]*)\}/) || [, ''])[1];
const TOK = { '--sp-1': '4px', '--sp-2': '8px', '--sp-3': '16px', '--sp-4': '24px', '--sp-5': '32px' };
const tokBad = Object.entries(TOK).filter(([k, v]) => !new RegExp(`${k}:\\s*${v}\\s*;`).test(root)).map(([k]) => k);
ok('간격 토큰 5개가 :root에 정한 값으로 있음', !tokBad.length, tokBad.join(', ') || Object.entries(TOK).map(([k, v]) => `${k} ${v}`).join(' · '));

// small things whose inside may step by 4: badges, chips, pills, segmented controls, the path, little charts. Matched on the rule's
// own element — the last compound of each selector, or for a bare element (`.seg button`, `.shortl li`) the one it sits in —
// never on an ancestor anywhere in the selector (검토: '.row'·'.m' anywhere let any rule through). A badge row (.m, .row) may
// use 4 only between its lines (row-gap, or gap's first value).
const CHIP_CLS = new Set(['k', 'kw', 'badge', 'chip', 'chips', 'mini-chip', 'pchip', 'seg', 'vchips', 'addbtn', 'linkbtn', 'regbtn', 'mapbtn', 'infotag', 'pin-cluster',
  'jomi-hello', 'nb-act', 'qty', 'termb', 'sibs', 'chev', 'back', 'opt', 'shortl', 'crumb', 'subnav', 'sortchips', 'mini', 'lat', 'qbr', 'cbar', 'pbars', 'vbar', 'bdate', 'specnotes',
  'toast', 'upd']);
const CHIP_SEL = new Set(['.cbar .side']);   // the two halves of a little bar chart's line
const ROW_CLS = new Set(['m', 'row']);
const own = (part) => { const cs = part.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean); let i = cs.length - 1;
  if (!/[.#[]|cancel-button/.test(cs[i].replace(/::?[\w-]+(\([^)]*\))?/g, '')) && i > 0) i--;   // a bare element: the one it sits in
  return cs[i]; };
const clsOf = (c) => (c.replace(/\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, '').match(/\.[\w-]+/g) || []).map((x) => x.slice(1));
const chipPart = (part) => { if (CHIP_SEL.has(part.trim())) return true; const c = own(part);
  return /^nav\.tabs\b/.test(c) || /\.btn\.sm\b/.test(c) || /cancel-button/.test(c) || clsOf(c).some((x) => CHIP_CLS.has(x)); };
const rowPart = (part) => clsOf(own(part)).some((x) => ROW_CLS.has(x));
const CHIP = { test: (sel) => sel.split(',').every(chipPart) };
const isRowGap = (sel, prop, i) => sel.split(',').every(rowPart) && (prop === 'row-gap' || (prop === 'gap' && i === 0));
// the check checks itself: these must stay outside (an ancestor named like a chip) and inside
const chipSelf = [['.row .foo', false], ['.m .bar', false], ['.card .row', false], ['.toast .x .y', false], ['.chip', true], ['.seg button', true], ['.shortl li', true],
  ['header.top .upd::before', true], ['.cmphead .crumb button', true], ['.pwrap > .addbtn', true], ['.cbar .side', true], ['.btn.sm', true]].filter(([sel, want]) => CHIP.test(sel) !== want);
ok('배지·칩 판별이 선택자의 자기 요소만 봄(조상 이름으로 통과하지 않음)', !chipSelf.length, chipSelf.map(([x]) => x).join(', '));
// the words' start line in a list line (14), a card's sides (20), a list card's sides (6) — only at the sides
const SIDE = new Set([14, 20, 6]);
const OPTICAL = /svg|mascot|input|\.subnav button/;   // 1–3px: an icon lined up with its words, a tab's line over the border
const splitTop = (v) => { const out = []; let depth = 0, cur = '';
  for (const ch of v) { if (ch === '(') depth++; if (ch === ')') depth--; if (/\s/.test(ch) && !depth) { if (cur) out.push(cur); cur = ''; } else cur += ch; }
  if (cur) out.push(cur); return out; };
// (scroll-padding-top is the sticky headers' height, not a space between things: left out)
const PROPS = /(?:^|[;{\s])((?:margin|padding|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?|scroll-padding(?=\s*:))\s*:\s*([^;}]+)/g;
const bad = []; let nDecl = 0, nVal = 0, n8 = 0;
for (const m of css.matchAll(PROPS)) {
  const prop = m[1], val = m[2].trim(); nDecl++;
  const b = css.lastIndexOf('{', m.index), sel = css.slice(Math.max(css.lastIndexOf('}', b), css.lastIndexOf('{', b - 1)) + 1, b).replace(/\s+/g, ' ').trim();
  const parts = splitTop(val);
  const side = (i) => /-(left|right|inline)$/.test(prop) || (/^(margin|padding|scroll-padding)$/.test(prop) && (i === 1 || i === 3)) || (prop === 'gap' && i === 1) || prop === 'column-gap';
  parts.forEach((t, i) => {
    if (t === '0' || t === 'auto' || /^var\(--sp-[2-5]\)$/.test(t)) { if (t !== '0' && t !== 'auto') { nVal++; n8++; } return; }
    if (t === 'var(--sp-1)') { nVal++; if (!CHIP.test(sel) && !isRowGap(sel, prop, i)) bad.push(`${sel} { ${prop}: ${val} } — 4는 배지·칩 안쪽만`); return; }
    if (t.startsWith('calc(')) {   // a calc of tokens, the bars' heights, env(); or the small switch's (32 − 44) / 2
      const nums = [...t.matchAll(/(-?\d*\.?\d+)px/g)].map((x) => +x[1]);
      if (!(sel.includes('.switch.sm') && t === 'calc((32px - 44px) / 2)') && nums.some((x) => x % 8)) bad.push(`${sel} { ${prop}: ${val} }`);
      return; }
    const px = /^(-?\d*\.?\d+)px$/.exec(t); if (!px) { bad.push(`${sel} { ${prop}: ${val} } — 알 수 없는 값`); return; }
    const v = +px[1], a = Math.abs(v); nVal++;
    if (a % 8 === 0) { n8++; return; }
    if (a % 4 === 0 && (CHIP.test(sel) || (a === 4 && isRowGap(sel, prop, i)))) return;
    if (SIDE.has(a) && side(i)) return;
    if (a <= 3 && OPTICAL.test(sel)) return;
    bad.push(`${sel} { ${prop}: ${val} }`);
  });
}
ok('styles.css의 margin·padding·gap은 모두 단계 위(8의 배수, 배지·칩 안 4, 정한 예외는 옆에만)', !bad.length, bad.length ? `${bad.length}곳: ${bad.slice(0, 5).join(' | ')}` : `${nDecl}곳`);
ok('styles.css 간격 값 중 8의 배수 70% 이상(위계 점검 51: 19%였음)', n8 / nVal >= 0.7, `${n8}/${nVal} = ${(100 * n8 / nVal).toFixed(0)}%`);

const js = ['app/app.js', 'app/screens/about.js', 'app/screens/concern.js', 'app/screens/map.js', 'app/screens/branch.js', 'app/commerce.js'].filter((f) => fs.existsSync(path.join(ROOT, f))).map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
const jsBad = []; let jsN = 0;
for (const [f, s] of js) for (const m of s.matchAll(/style: "([^"]*)"/g)) {
  for (const d of m[1].split(';')) { const [prop, v] = d.split(':').map((x) => (x || '').trim());
    if (!/^(margin|padding|gap|row-gap|column-gap)(-(top|right|bottom|left))?$/.test(prop)) continue; jsN++;
    splitTop(v).forEach((t, i) => {
      const side = /-(left|right)$/.test(prop) || ((prop === 'margin' || prop === 'padding') && (i === 1 || i === 3));
      if (t === '0' || t === 'auto' || /^var\(--sp-[2-5]\)$/.test(t)) return;
      if (t === 'var(--sp-1)' && prop === 'gap') return;   // a badge row
      const px = /^(-?\d+)px$/.exec(t);
      if (px && (+px[1] % 8 === 0 || (side && Math.abs(+px[1]) === 14))) return;
      jsBad.push(`${f}:${s.slice(0, m.index).split('\n').length} ${d}`); }); }
}
ok('app.js style 속성의 간격도 단계 위(토큰, 줄 시작선 14는 옆에만)', !jsBad.length, jsBad.length ? jsBad.slice(0, 6).join(' | ') : `${jsN}곳`);
const assign = js.flatMap(([f, s]) => s.split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => /\.style\.(margin|padding|gap)\w*\s*=/.test(l)).map(([f, n]) => `${f}:${n}`));
ok('app.js가 el.style로 간격을 직접 넣지 않음', !assign.length, assign.join(', '));

// ---- 2) the screens
const scan = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
  const view = document.querySelector('#main .view'); const out = { gaps: [], cards: [], lines: [], n: 0, n8: 0 };
  if (!view) return out;
  const kids = [...view.children].filter((e) => vis(e) && !/fixed/.test(getComputedStyle(e).position));
  for (let i = 1; i < kids.length; i++) { const a = kids[i - 1], b = kids[i];
    if (/sticky/.test(getComputedStyle(a).position + getComputedStyle(b).position) && b.classList.contains('cartbar')) continue;
    const g = Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom); if (g < 0) continue;
    out.gaps.push([g, `${name(a).slice(0, 28)} → ${name(b).slice(0, 28)}`]); }
  for (const c of document.querySelectorAll('#main .card')) { if (!vis(c)) continue; const cs = getComputedStyle(c);
    out.cards.push([parseFloat(cs.paddingTop), parseFloat(cs.paddingLeft), name(c).slice(0, 40)]); }
  for (const l of document.querySelectorAll('#main .list > li > .item, #main .list > li > .rank, #main li.rk > .item, #main li.rk > .rank')) { if (!vis(l)) continue; const cs = getComputedStyle(l);
    out.lines.push([parseFloat(cs.paddingLeft), parseFloat(cs.paddingTop), name(l).slice(0, 30), !!(l.previousElementSibling && l.previousElementSibling.classList.contains('sgh'))]); }
  for (const el of document.querySelectorAll('#main *')) { if (!vis(el)) continue; const cs = getComputedStyle(el);
    const vals = [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft, cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft];
    if (/flex|grid/.test(cs.display)) vals.push(cs.rowGap, cs.columnGap);
    for (const v of vals) { const x = Math.abs(parseFloat(v)); if (!x || !isFinite(x)) continue; out.n++; if (Math.round(x) % 8 === 0) out.n8++; } }
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
      ['내 견적 병원별', '#cart', 'quote'], ['탐색', '#explore'], ['관심', '#saved'], ['마이', '#me'], ['지점 비교', '#versus'], ['전체 가격표', '#table']];
    for (const [label, hash, step] of screens) {
      await p.goto(BASE + hash); await p.waitForTimeout(900);
      if (step) { const ex = p.locator('.cartsum button[aria-expanded="false"]'); if (await ex.count()) { await ex.first().click(); await p.waitForTimeout(500); } }
      const r = await p.evaluate(scan);
      const offG = r.gaps.filter(([g]) => ![8, 16, 24, 32].includes(g));
      ok(`${W} ${label}: 덩어리 사이 간격은 8·16·24·32`, r.gaps.length >= 1 && !offG.length, `${r.gaps.map(([g]) => g).join(',')}${offG.length ? ' | 밖: ' + offG.slice(0, 3).map(([g, n]) => `${g} ${n}`).join(', ') : ''}`);
      const has24 = r.gaps.some(([g]) => g === 24) || r.gaps.length < 2;
      ok(`${W} ${label}: 덩어리 사이 24가 있음(앞뒤 덩어리)`, has24, r.gaps.map(([g]) => g).join(','));
      const offC = r.cards.filter(([t, l]) => ![0, 16].includes(t) || ![6, 14, 16, 20].includes(l));   // 14: a part of a fold card (6 + 14)
      ok(`${W} ${label}: 카드 안쪽 위 16(목록 카드 0), 옆 20(목록 카드 6, 접기 카드 안 14, 작은 카드 16)`, !offC.length, offC.length ? offC.slice(0, 3).map((c) => c.join(' ')).join(' | ') : `${r.cards.length}장`);
      const offL = r.lines.filter(([l, t, , head]) => l !== 14 || t !== (head ? 8 : 16));   // under a clinic's head (검색 지역·이름순): 8
      ok(`${W} ${label}: 목록 줄 안쪽은 위 16(지점 머리 아래 8) · 글자 시작선 14`, !offL.length, offL.length ? offL.slice(0, 3).map((c) => c.join(' ')).join(' | ') : `${r.lines.length}줄`);
      ok(`${W} ${label}: 화면의 간격 값 중 8의 배수 40% 이상(정한 예외 14·20·6과 배지·칩 4 빼면 거의 전부)`, r.n8 / r.n >= 0.4, `${r.n8}/${r.n} = ${(100 * r.n8 / r.n).toFixed(0)}%`);
    }
    ok(`${W} 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  const pass = R.filter(Boolean).length; console.log(`TOTAL ${pass}/${R.length} ${pass === R.length ? 'PASS' : 'FAIL'}`); process.exitCode = pass === R.length ? 0 : 1;
})();
