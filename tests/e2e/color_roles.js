// Colour roles (2026-10-19 사용자 결정, 위계 점검 27·43·44·45·46): words in ink / ink-2 / muted; one accent — a chosen control is
// filled with charcoal (ink), the tab bar's pill too; butter = a condition on a price (and 죠미's face, bubble and entry card);
// coral = a price that cannot be had and an input error (and the heart, and the medical safety notes); a state of the data is grey
// with an icon (.kw); the tab counts are charcoal. Dark: the two greys apart (ink/ink-2 and ink-2/muted ≥ 1.5, muted ≥ 4.5:1).
// 2026-10-20 사용자 결정 ('같은 역할은 같은 모양'): a switch that is on is chosen — the charcoal track of every chosen control, its
// knob in the colour on it (the dark theme turns both round, like a chosen chip), never sage; the count on the chosen tab is the
// pill turned round (light, charcoal words; dark, ivory words), on the other tabs charcoal; 비교함에 있음 (.shortbtn) is a list the
// branch is in, like 담김: the same light green. No switch is green.
// 1) app/styles.css and app.js: where coral and butter may be used, the grey steps. 2) In a browser (390 px, light and dark):
// what is coral or butter on each screen, the look of every chosen control, the tab count, '제품 표기 없음', the compare header's
// 담기 (an outline), the small switch '전에 이 시술을 받아 봤어요' (36×22 to see, 44 to press, a 13/400 grey label), search's ×,
// every switch on and off (track and knob, ≥ 3:1 on the card and to each other) and its focus ring (2px charcoal, 2px apart),
// the count on the chosen tab and on the others, 비교함에 있음 on the branch page and in 가격 근거.
// A list in a butter box (ul.warns) is a price's conditions only — 가격 근거 '조건', the quote's '확인할 조건'; the treatment
// sheet's side effects · cautions · sources and 고민 '시술 말고 할 수 있는 관리' are grey (ul.notes) — and 빠른 비교's date chip is grey.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/color_roles.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 300)}`); };
const ROOT = path.join(__dirname, '..', '..');

// ---- 1) the source
const cssRaw = fs.readFileSync(path.join(ROOT, 'app/styles.css'), 'utf8'), css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const lum = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const block = (re) => { const m = css.match(re); const o = {}; if (m) for (const [, k, v] of m[1].matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)) o[k] = v; return o; };
const LIGHT = block(/:root\s*\{([^}]*)\}/), DARK1 = block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/), DARK2 = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
ok('어두운 화면 색 정의 두 곳이 같음', JSON.stringify(DARK1) === JSON.stringify(DARK2) && Object.keys(DARK1).length > 10, `${Object.keys(DARK1).length}개`);
for (const [name, T] of [['밝은', LIGHT], ['어두운', DARK1]]) {
  const st = { 'ink/ink-2': ratio(T['--ink'], T['--ink-2']), 'ink-2/muted': ratio(T['--ink-2'], T['--muted']) };
  // the backgrounds that hold words (--fill-2 holds none: the range bar's track, a pressed − / + button)
  const bgs = ['--bg', '--surface', '--sunken', '--fill', '--butter-soft', '--sage-soft', '--coral-soft'];
  const low = bgs.map((b) => [b, ratio(T['--muted'], T[b])]).filter(([, c]) => c < 4.5);
  ok(`${name} 화면: 진한·회색 글자 단계가 보임(ink/ink-2, ink-2/muted 모두 1.5 이상)`, st['ink/ink-2'] >= 1.5 && st['ink-2/muted'] >= 1.5, Object.entries(st).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · '));
  ok(`${name} 화면: 가장 옅은 글자(muted)도 글자 바탕 7가지 위에서 4.5:1 이상`, !low.length, low.length ? low.map(([b, c]) => `${b} ${c.toFixed(2)}`).join(', ') : bgs.map((b) => ratio(T['--muted'], T[b]).toFixed(2)).join(' · '));
}
ok('어두운 화면 회색 두 단계: --ink-2 #c6beb0 · --muted #a09889 (위계 점검 45)', DARK1['--ink-2'] === '#c6beb0' && DARK1['--muted'] === '#a09889', `${DARK1['--ink-2']} / ${DARK1['--muted']}`);
// where a colour token is used: the selectors of every rule that names it
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] })).filter((r) => !/^(:root|@)/.test(r.sel) && !/^--/.test(r.body.trim()));
const usedBy = (re) => rules.filter((r) => re.test(r.body)).map((r) => r.sel);
const CORAL_OK = /^(\.kx|\.unav|\.ferr|\[aria-invalid="true"\]|\.gate \.gmsg\.err|\.cov \.cov-x|\.clsbox\.cls-never|\.favbtn\[aria-pressed="true"\]|\.card\.calert( h3, \.card\.cwarn h3)?|\.card\.cwarn)$/;
const coralAt = usedBy(/var\(--(coral|coral-soft|pricey|pricey-soft)\)/), coralBad = coralAt.filter((s) => !CORAL_OK.test(s));
ok('코랄은 쓸 수 없는 가격(.kx·.unav·없음)·입력 오류·관심 하트·의료 안전 안내에만', !coralBad.length, coralBad.length ? coralBad.join(' | ') : coralAt.join(' | '));
const BUTTER_OK = /^(\.k1, \.k2, \.kt, \.kc|ul\.warns|\.elig li\.el-limit \.ei2|\.mascot|\.jomi-say \.bub|\.entry\.e-concern)$/;
const butterAt = usedBy(/var\(--(butter|butter-soft|butter-ink|on-butter)\)/), butterBad = butterAt.filter((s) => !BUTTER_OK.test(s));
ok('버터는 조건(배지·조건 목록)과 죠미(얼굴·말풍선·입구)에만 — 선택·순위·알림 막대에 없음', !butterBad.length, butterBad.length ? butterBad.join(' | ') : butterAt.join(' | '));
ok('검색창 ×: 브라우저 기본(파랑) 대신 회색 24px 버튼', /input\[type="search"\]::-webkit-search-cancel-button\s*\{[^}]*-webkit-appearance:\s*none[^}]*width:\s*24px[^}]*height:\s*24px[^}]*background:\s*var\(--muted\)/.test(css));
// screens/about.js, screens/concern.js and screens/map.js hold code split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-2~3-4): checked the same way
const inl = ['app.js', 'screens/about.js', 'screens/concern.js', 'screens/map.js'].flatMap((f) => fs.readFileSync(path.join(ROOT, 'app', f), 'utf8').split('\n').map((l, i) => [i + 1, l])
  .filter(([, l]) => /style:\s*["`][^"`]*color:\s*var\(--(pricey|coral|butter|butter-ink|butter-soft)\)/.test(l)).map(([n]) => `${f}:${n}`));
ok('app.js에 직접 적은 코랄·버터 글자색 없음(클래스로)', !inl.length, inl.join(', '));

// ---- 2) the screens
const scan = (sel) => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const root = getComputedStyle(document.documentElement);
  const rgb = (n) => { const h = root.getPropertyValue(n).trim().replace('#', ''), v = parseInt(h, 16); return `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`; };
  const C = { coral: rgb('--coral'), coralS: rgb('--coral-soft'), butter: rgb('--butter'), butterS: rgb('--butter-soft'), butterI: rgb('--butter-ink'), ink: rgb('--ink'), surface: rgb('--surface'),
    onP: rgb('--on-primary'), track: rgb('--track'), sage: rgb('--sage'), sageS: rgb('--sage-soft'), fill: rgb('--fill'), bg: rgb('--bg') };
  // contrast of two computed colours ('rgb(r, g, b)'), and the colour a thing sits on (the first ancestor with a fill)
  const lumOf = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const cr = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const under = (el) => { for (let x = el; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return C.bg; };
  const lab = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''}«${(el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 16)}»`;
  const coralOk = (el) => !!el.closest('.kx, .unav, .ferr, .favbtn, .cov-x, .calert, .cwarn, .gmsg.err');
  // a butter list box: only a price's conditions (가격 근거 '조건' · the quote's '확인할 조건'), never an explanation
  const condList = (u) => { const f = u.closest('.fact'); return f ? ((f.querySelector('dt') || {}).textContent || '').trim() === '조건' : !!u.closest('li.qrow, .t3card'); };
  const butterOk = (el) => { const u = el.closest('ul.warns'); return u ? condList(u) : !!el.closest('.k1, .k2, .kt, .kc, .mascot, .jomi-say, .e-concern, .el-limit'); };
  const out = { coral: [], coralBad: [], butter: [], butterBad: [], chosen: [], chosenBad: [], badge: [], prodk: [], kw: [], kwBad: [], sw: [], short: [] };
  for (const el of document.querySelectorAll(sel || '#main *, nav.tabs *, header.top *')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el), own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if ((own && cs.color === C.coral) || cs.backgroundColor === C.coral || cs.backgroundColor === C.coralS) { out.coral.push(lab(el)); if (!coralOk(el)) out.coralBad.push(lab(el)); }
    if ((own && cs.color === C.butterI) || cs.backgroundColor === C.butter || cs.backgroundColor === C.butterS) { out.butter.push(lab(el)); if (!butterOk(el)) out.butterBad.push(lab(el)); }
  }
  // a chosen control: the charcoal fill (the tab bar's pill too). Not here: 담김 (light green, 사용자 결정), 비교함에 있음 (a list the
  // branch is in, like 담김: its icon and words change), the heart, the brand filter (all on by default: on is an ordinary chip,
  // off is dashed), and where you are (the path's step, 비교's tab row)
  for (const el of document.querySelectorAll('[aria-pressed="true"], [aria-checked="true"], [aria-selected="true"], nav.tabs [aria-current="page"]')) {
    if (!vis(el) || el.matches('input, .favbtn, .addbtn, .shortbtn, .bchip, .subnav button, .crumb button')) continue;
    const t = el.matches('nav.tabs button') ? el.querySelector('.ti') : el, bg = getComputedStyle(t).backgroundColor;
    out.chosen.push(lab(el)); if (bg !== C.ink) out.chosenBad.push(`${lab(el)} ${bg}`);
  }
  // a count: charcoal (ivory in the dark), on the chosen tab the pill turned round — light with charcoal words in it, ringed 2px in
  // the pill's own colour (사용자 결정 2026-10-20: without the ring the plain badge's --bg ring shows, and the light badge's top,
  // standing above the pill, melts into the tab bar)
  for (const el of document.querySelectorAll('nav.tabs .badge, header.top .badge')) if (vis(el)) {
    const cs = getComputedStyle(el), chosen = !!el.closest('nav.tabs [aria-current="page"]'), ring = cs.boxShadow === `${C.ink} 0px 0px 0px 2px`;
    out.badge.push({ chosen, ok: chosen ? cs.backgroundColor === C.onP && cs.color === C.ink && ring && cr(cs.backgroundColor, C.ink) >= 3 && cr(cs.color, cs.backgroundColor) >= 4.5
      : cs.backgroundColor === C.ink && cs.color === C.onP, d: `${chosen ? '고른 탭' : '다른 탭'} ${cs.backgroundColor}/${cs.color}${chosen ? ` 테두리 ${cs.boxShadow}` : ''}` }); }
  // a switch: on = the charcoal track with the knob in the colour on it, ≥ 3:1 on what it sits on and to each other; off = the grey track
  for (const l of document.querySelectorAll(sel ? '.sheet label.switch' : '#main label.switch')) {
    const tr = l.querySelector('.tr'), inp = l.querySelector('input'); if (!tr || !inp || !vis(tr)) continue;
    const t = getComputedStyle(tr).backgroundColor, k = getComputedStyle(tr, '::after').backgroundColor, on = inp.checked, bg = under(l.parentElement);
    out.sw.push({ on, ok: on ? t === C.ink && k === C.onP && cr(t, bg) >= 3 && cr(k, t) >= 3 : t === C.track && t !== C.sage,
      d: `${(l.textContent || '').trim().slice(0, 14)} ${on ? '켜짐' : '꺼짐'} ${t}/${k} 바탕 ${cr(t, bg).toFixed(1)} 손잡이 ${cr(k, t).toFixed(1)}` }); }
  // 비교함에 있음: 담김's light green; 비교함 (not in it): the grey button
  for (const el of document.querySelectorAll('.shortbtn')) if (vis(el)) {
    const cs = getComputedStyle(el), on = el.getAttribute('aria-pressed') === 'true';
    out.short.push({ on, ok: on ? cs.backgroundColor === C.sageS && cs.color === C.sage && cr(cs.color, cs.backgroundColor) >= 4.5 : cs.backgroundColor === C.fill,
      d: `${el.textContent.trim()} ${cs.backgroundColor}/${cs.color}` }); }
  for (const el of document.querySelectorAll('#main .k.prodk')) if (vis(el)) { const cs = getComputedStyle(el); out.prodk.push(cs.backgroundColor === 'rgba(0, 0, 0, 0)' && /inset/.test(cs.boxShadow)); }
  for (const el of document.querySelectorAll('#main .k.kw')) if (vis(el)) { out.kw.push(lab(el)); const cs = getComputedStyle(el); if (!el.querySelector('svg.i') || cs.backgroundColor === C.coralS || cs.backgroundColor === C.butterS) out.kwBad.push(lab(el)); }
  return out;
};
(async () => {
  const b = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    const W = scheme === 'light' ? '밝은' : '어두운';
    // reduced motion: no colour is read halfway through a transition (the tab pill fades in over 0.24s)
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: 'reduce' });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await p.goto(BASE);
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('수도권'));
      localStorage.setItem('pc:carts', JSON.stringify([{ id: 'h', name: '점검용 견적', items: [{ t: 'k', k: 'X14', q: 3, done: true }, { t: 'k', k: 'X01', q: 2 }, { t: 'k', k: 'X12', q: 1 }] }]));
      localStorage.setItem('pc:ci', '0'); });
    await p.reload();
    for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
    await p.waitForFunction(() => window.App && window.App.data() && !window.App.data().meta.partial, null, { timeout: 90000 });
    const bi = await p.evaluate(() => { const { D } = App.state(); const i = D.branches.findIndex((x) => D.s[x[1]] === '강남역점'); return i >= 0 ? i : 0; });
    // 비교함: three 강남 branches, for 빠른 비교 (#quick)
    await p.evaluate(() => { const { D } = App.state(), keys = []; for (const x of D.branches) if (/강남/.test(D.s[x[1]]) && keys.length < 3) keys.push(`${D.meta.brands[x[0]][0]}|${D.s[x[1]]}`);
      localStorage.setItem('pc:short', JSON.stringify(keys)); });
    const screens = [['홈', '#home'], ['검색', '#search?q=' + encodeURIComponent('리쥬란')], ['비교', '#compare?k=X01'], ['비교(제품 섞임)', '#compare?k=X35'], ['지점', `#branch/${bi}`],
      ['내 견적', '#cart'], ['내 견적 병원별', '#cart', 'quote'], ['가격 변동', '#change'], ['마이', '#me'], ['전체 가격표', '#table'], ['빠른 비교', '#quick?k=X01'], ['고민', '#concern?c=pigment']];
    const seen = { coral: new Set(), kc: 0, kw: 0, prodk: 0, chosen: 0, badgeOn: 0, badgeOff: 0, swOn: 0, swOff: 0, shortOn: 0 };
    for (const [label, hash, step] of screens) {
      await p.goto(BASE + hash); await p.waitForTimeout(900);
      if (step) { const ex = p.locator('.cartsum button[aria-expanded="false"]'); if (await ex.count()) { await ex.first().click(); await p.waitForTimeout(500); } }
      // the whole page, not only the first screen: lines drawn later (비교 '모두 보기' is not opened) are in the DOM already
      const r = await p.evaluate(scan, null);
      r.coral.forEach((x) => seen.coral.add(x.replace(/«.*/, ''))); seen.kw += r.kw.length; seen.prodk += r.prodk.length; seen.chosen += r.chosen.length;
      ok(`${W} ${label}: 코랄은 쓸 수 없는 가격·입력 오류·하트에만`, !r.coralBad.length, r.coralBad.slice(0, 4).join(', ') || `${r.coral.length}곳`);
      ok(`${W} ${label}: 버터는 조건과 죠미에만`, !r.butterBad.length, r.butterBad.slice(0, 4).join(', ') || `${r.butter.length}곳`);
      ok(`${W} ${label}: 고른 것은 차콜 채움 하나`, !r.chosenBad.length, r.chosenBad.slice(0, 3).join(', ') || r.chosen.slice(0, 4).join(', '));
      ok(`${W} ${label}: 숫자 배지는 진한 색, 고른 탭 안에서는 반전 + 알약 색 테두리 2px(알약과 구분)`, r.badge.every((x) => x.ok), r.badge.map((x) => x.d).join(', ') || '없음');
      seen.badgeOn += r.badge.filter((x) => x.chosen).length; seen.badgeOff += r.badge.filter((x) => !x.chosen).length;
      if (r.sw.length) ok(`${W} ${label}: 켠 스위치는 차콜(고른 것과 같은 모양), 끈 스위치는 회색`, r.sw.every((x) => x.ok), r.sw.filter((x) => !x.ok).map((x) => x.d).slice(0, 3).join(', ') || r.sw.map((x) => x.d).slice(0, 2).join(', '));
      seen.swOn += r.sw.filter((x) => x.on).length; seen.swOff += r.sw.filter((x) => !x.on).length;
      if (r.short.length) ok(`${W} ${label}: '비교함에 있음'은 담김처럼 연한 초록, '비교함'은 회색`, r.short.every((x) => x.ok), r.short.map((x) => x.d).slice(0, 3).join(', '));
      seen.shortOn += r.short.filter((x) => x.on).length;
      ok(`${W} ${label}: 데이터 상태 배지(.kw)는 회색 + 아이콘`, !r.kwBad.length, r.kwBad.slice(0, 3).join(', ') || r.kw.slice(0, 3).join(', '));
      if (r.prodk.length) ok(`${W} ${label}: '제품 표기 없음'·제품 알약은 테두리(채움 없음)`, r.prodk.every(Boolean), `${r.prodk.length}개`);
      if (step === 'quote') { const q = await p.$$eval('#main li.qrow .rank .k', (ks) => ks.filter((k) => /^확인할 조건 \d+개$/.test(k.textContent.trim())).map((k) => k.className));
        seen.kc += q.length; ok(`${W} 견적 병원별: '확인할 조건 N개'는 버터(조건), 코랄 아님`, q.length > 0 && q.every((c) => /\bkc\b/.test(c)), `${q.length}줄`); }
      if (hash.startsWith('#quick')) { const d = await p.$$eval('#main li.qrow2 .m .k', (ks) => ks.filter((k) => /까지$/.test(k.textContent.trim())).map((k) => `${k.className} ${k.textContent.trim()}`));
        ok(`${W} 빠른 비교: 기간 칩은 회색 날짜 배지('~M/D까지', 다른 가격 줄과 같은 모양)`, d.length > 0 && d.every((x) => /^k k4 ~\d{1,2}\/\d{1,2}까지$/.test(x)), d.slice(0, 3).join(', ') || '없음'); }
      if (hash.startsWith('#concern')) { const l = await p.$$eval('#main .card.concern ul', (us) => us.map((u) => u.className));
        ok(`${W} 고민: '시술 말고 할 수 있는 관리'는 회색 목록(ul.notes)`, l.includes('notes') && !l.includes('warns'), l.join(', ') || '고민 카드 없음'); }
    }
    ok(`${W} 시험이 볼 것이 있었음(데이터 상태 배지·제품 알약·고른 것·켠/끈 스위치·고른 탭/다른 탭의 배지)`, seen.kw > 0 && seen.prodk > 0 && seen.chosen > 10
      && seen.swOn > 0 && seen.swOff > 0 && seen.badgeOn > 0 && seen.badgeOff > 0,
      `kw ${seen.kw} · prodk ${seen.prodk} · chosen ${seen.chosen} · 스위치 켬 ${seen.swOn}/끔 ${seen.swOff} · 배지 고른 탭 ${seen.badgeOn}/다른 탭 ${seen.badgeOff}`);
    // 비교함에 있음 on the branch page (and 가격 근거's, the same button): pressed = 담김's light green, unpressed = grey (사용자 결정 2026-10-20)
    await p.goto(BASE + `#branch/${bi}`); await p.waitForTimeout(900);
    { const sb = p.locator('#main .shortbtn').first(), was = (await sb.getAttribute('aria-pressed')) === 'true';
      if (!was) { await sb.click(); await p.waitForTimeout(400); }
      const on = await p.evaluate(scan, '#main .shortbtn'), onB = on.short.find((x) => x.on);
      ok(`${W} 지점 '비교함에 있음'은 담김과 같은 연한 초록`, !!onB && onB.ok && /비교함에 있음/.test(onB.d), on.short.map((x) => x.d).join(', '));
      await sb.click(); await p.waitForTimeout(400);
      const off = await p.evaluate(scan, '#main .shortbtn');
      ok(`${W} 빼면 '비교함'은 회색 버튼으로`, off.short.length > 0 && off.short.every((x) => !x.on && x.ok), off.short.map((x) => x.d).join(', '));
      if (was) { await sb.click(); await p.waitForTimeout(400); } }
    // the focus ring of a switch that is on: 2px charcoal, 2px apart from the charcoal track (the card shows between), ≥ 3:1
    await p.goto(BASE + '#quick?k=X01'); await p.waitForTimeout(900);
    { const inp = p.locator('#main label.switch', { hasText: '특가 포함' }).first().locator('input');
      if (!(await inp.isChecked())) { await p.locator('#main label.switch', { hasText: '특가 포함' }).first().click(); await p.waitForTimeout(500); }
      await p.locator('#main label.switch', { hasText: '특가 포함' }).first().locator('input').focus(); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); await p.waitForTimeout(300);
      const f = await p.evaluate(() => { const a = document.activeElement; if (!a || !a.matches('label.switch input')) return null; const tr = a.parentElement.querySelector('.tr'), cs = getComputedStyle(tr), root = getComputedStyle(document.documentElement);
        const v = parseInt(root.getPropertyValue('--ink').trim().replace('#', ''), 16), ink = `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`;
        const lumOf = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
        let bg = 'rgb(0, 0, 0)'; for (let x = tr.parentElement; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') { bg = c; break; } }
        const l1 = lumOf(cs.outlineColor), l2 = lumOf(bg);
        return { fv: a.matches(':focus-visible'), on: a.checked, style: cs.outlineStyle, w: parseFloat(cs.outlineWidth), off: parseFloat(cs.outlineOffset), ink: cs.outlineColor === ink, track: cs.backgroundColor === ink, cr: +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2) }; });
      ok(`${W} 켠 스위치의 포커스 링: 차콜 2px, 트랙과 2px 떨어짐, 바탕과 3:1 이상`, !!f && f.fv && f.on && f.track && f.style === 'solid' && f.w >= 2 && f.off >= 2 && f.ink && f.cr >= 3, JSON.stringify(f)); }
    // the sheets: the treatment sheet (비교 '부작용·주의사항·근거 자세히') has no butter list; 가격 근거's butter is its '조건' list
    await p.goto(BASE + '#compare?k=X01'); await p.waitForTimeout(900);
    { const kb = p.locator('#main button', { hasText: '부작용·주의사항·근거 자세히' }).first();
      if (await kb.count()) { await kb.click(); await p.waitForTimeout(600);
        const r = await p.evaluate(scan, '.sheet *'), l = await p.$$eval('.sheet ul.warns, .sheet ul.notes', (us) => us.map((u) => u.className));
        ok(`${W} 시술 설명 창: 부작용·주의사항·근거 목록은 회색(ul.notes), 버터 없음`, l.length > 0 && l.every((c) => c === 'notes') && !r.butterBad.length, `${l.join(',')} ${r.butterBad.slice(0, 3).join(', ')}`);
        await p.keyboard.press('Escape'); await p.waitForTimeout(400); }
      else ok(`${W} 시술 설명 창 단추가 있음`, false); }
    { const ib = p.locator('#main li.rk > .infob').first(); await ib.click(); await p.waitForTimeout(600);
      const r = await p.evaluate(scan, '.sheet *');
      ok(`${W} 가격 근거 창: 버터는 '조건' 목록과 조건 배지에만`, !r.butterBad.length, r.butterBad.slice(0, 3).join(', ') || `${r.butter.length}곳`);
      ok(`${W} 가격 근거 창 '비교함' 버튼: 들어 있으면 담김처럼 연한 초록, 아니면 회색`, r.short.length > 0 && r.short.every((x) => x.ok), r.short.map((x) => x.d).join(', ') || '없음');
      await p.keyboard.press('Escape'); await p.waitForTimeout(400); }
    // 비교 머리글 '담기': an outline — surface inside, a charcoal line; never the screen's brightest fill in the dark (사용자 결정 4)
    await p.goto(BASE + '#compare?k=X24'); await p.waitForTimeout(900);
    const add = await p.evaluate(() => { const e = document.querySelector('.cmphead .addbtn'); if (!e) return null; const cs = getComputedStyle(e), root = getComputedStyle(document.documentElement);
      const rgb = (n) => { const v = parseInt(root.getPropertyValue(n).trim().replace('#', ''), 16); return `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`; };
      return { pressed: e.getAttribute('aria-pressed'), bg: cs.backgroundColor === rgb('--surface'), line: cs.borderTopColor === rgb('--ink') && parseFloat(cs.borderTopWidth) >= 1, range: parseFloat(getComputedStyle(document.querySelector('.pricecard .hp')).fontSize) }; });
    ok(`${W} 비교 머리글 '담기'는 테두리 버튼(채움 없음) — 가격 범위 28이 주인공`, !!add && add.pressed === 'false' && add.bg && add.line && add.range === 28, JSON.stringify(add));
    await p.locator('.cmphead .addbtn').click(); await p.waitForTimeout(500);
    const added = await p.evaluate(() => { const e = document.querySelector('.cmphead .addbtn'), root = getComputedStyle(document.documentElement);
      const rgb = (n) => { const v = parseInt(root.getPropertyValue(n).trim().replace('#', ''), 16); return `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`; };
      return e && e.getAttribute('aria-pressed') === 'true' && getComputedStyle(e).backgroundColor === rgb('--sage-soft'); });
    ok(`${W} 누르면 '담김'은 연한 초록 그대로`, added);
    // 내 견적 '전에 이 시술을 받아 봤어요': 36×22, label 13/400 grey, 44px to press; '이 병원에 다녀왔어요' keeps its own (cart_repeat G1d/G9/G12)
    await p.goto(BASE + '#cart'); await p.waitForTimeout(900);
    const sw = await p.evaluate(() => { const l = [...document.querySelectorAll('.ci .cdone label.switch')].find((x) => x.textContent.includes('전에 이 시술을 받아 봤어요')); if (!l) return null;
      const tr = l.querySelector('.tr').getBoundingClientRect(), cs = getComputedStyle(l), root = getComputedStyle(document.documentElement);
      const v = parseInt(root.getPropertyValue('--muted').trim().replace('#', ''), 16);
      return { w: Math.round(tr.width), h: Math.round(tr.height), fs: parseFloat(cs.fontSize), fw: +cs.fontWeight, grey: cs.color === `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`, press: Math.round(l.getBoundingClientRect().height) }; });
    ok(`${W} '전에 이 시술을 받아 봤어요' 스위치 36×22 · 라벨 13/400 회색 · 누르는 곳 44px`, !!sw && sw.w === 36 && sw.h === 22 && sw.fs === 13 && sw.fw === 400 && sw.grey && sw.press >= 44, JSON.stringify(sw));
    if (sw) { const l = p.locator('.ci .cdone label.switch', { hasText: '전에 이 시술을 받아 봤어요' }).first(); const was = await l.locator('input').isChecked();
      await l.click(); await p.waitForTimeout(500);
      ok(`${W} 작은 스위치도 눌러서 켜고 끔`, (await p.locator('.ci .cdone label.switch', { hasText: '전에 이 시술을 받아 봤어요' }).first().locator('input').isChecked()) !== was); }
    // search ×: a 24px button at the field's right end that clears it
    await p.goto(BASE + '#table'); await p.waitForTimeout(700);
    { const inp = p.locator('#main input[type=search]').first(); await inp.fill('보톡스'); await p.waitForTimeout(200); const bb = await inp.boundingBox();
      await p.mouse.click(bb.x + bb.width - 12, bb.y + bb.height / 2); await p.waitForTimeout(300);
      ok(`${W} 검색창 ×를 누르면 지워짐`, (await inp.inputValue()) === '', await inp.inputValue()); }
    ok(`${W} 페이지 오류 없음`, !errs.length, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  await b.close();
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} 통과`); process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
