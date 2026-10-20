// 위쪽 고정 머리글·경로 (2026-10-16 위계 점검, 묶음 4 — 순번 9·19·20·23·38·40) in a real browser, 390×844 unless said:
//   9  비교를 내리면 머리글이 접힌다: 앱 위 막대가 숨고 경로·기준 줄(글자 그대로, '중간값:'도)·중간값·담기만 남아 고정된 부분이
//      화면의 25% 이하. 접혀도 목록은 문서 안에서 움직이지 않고(화면을 다시 그리지 않음), 다시 올리면 원래대로 — 접힌 곳보다
//      24px 넘게 올라가야 펴진다(경계에서 깜빡이지 않음). 초점이 머리글에 가리지 않고, 가로 화면(높이 500px 이하, 머리글이
//      붙지 않음)에서는 접지 않는다
//   19 머리글 중간값의 숫자가 두 줄로 갈라지지 않는다(X 키 36개 × 390·360·320), 머리글 줄이 가로로 넘치지 않는다
//   20 경로는 마지막 단계만 진한 굵은 글자 + aria-current, '›'는 바탕과 3:1 이상. 규격 바꾸기: 분야 칩 13 · 시술 17 · 규격 칩 15
//   23 로고를 누르면 하단 탭 '홈'처럼 홈 맨 위로, 뒤로 가기는 떠난 비교 화면으로
//   38 지점 가격표를 깊이 내리면 지점명 + 분야 칩의 작은 고정 머리글(56px), 고정 합계 30% 아래. 그 칩을 누르면 친 검색어가 남고
//      화면 전체를 다시 그리지 않으며, 가격표의 분야 칩도 같은 것이 눌린 상태. 지점명은 브랜드(위)·지점(아래) 두 줄이라 좁은
//      화면에서도 지점 이름이 남고, 낮은 화면(높이 700 이하)에서는 작은 머리글이 뜰 때 앱 위 막대가 숨는다
//   40 비교 위 탭(시술별·지점 비교·전체 가격표)은 세 화면 모두 36px 밑줄 탭(흰 알약 없음), 같은 자리
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/sticky_head.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 240)}`); };
const ready = (p) => p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 90000 });
async function open(b, vp, scheme, prep) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: true, hasTouch: true, colorScheme: scheme || 'light' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
  await p.goto(BASE); await p.evaluate((prep) => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('수도권')); if (prep) for (const [k, v] of Object.entries(prep)) localStorage.setItem(k, v); }, prep || null); await p.reload();
  if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
  await p.waitForSelector('.pc'); await ready(p);
  return { ctx, p, errs };
}
const go = (p, r) => p.evaluate((r) => { history.pushState(null, '', '#' + r); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, r);
// the compare screen's fixed parts and a few facts at the current scroll position
const head = (p) => p.evaluate(() => {
  const vh = innerHeight, q = (s) => document.querySelector(s), r = (s) => { const e = q(s); return e ? e.getBoundingClientRect() : null; };
  const inView = (s) => { const b = r(s); return !!b && b.height > 0 && b.top >= 0 && b.bottom <= vh; };
  const top = r('header.top'), hd = r('.cmphead'), nav = r('nav.tabs'), cl = r('#clinics');
  const topCover = Math.max(0, top.bottom, hd && hd.top <= 61 ? hd.bottom : 0);
  return { y: Math.round(scrollY), folded: document.documentElement.classList.contains('cmp-fold'), barHidden: top.bottom <= 0, cover: +((topCover + vh - nav.top) / vh).toFixed(3),
    crumb: inView('.cmphead .crumb'), basis: inView('.cmphead .basis'), med: inView('.cmphead .hmed'), add: inView('.cmphead .addbtn'),
    title: inView('.cmphead .cmpt') && getComputedStyle(q('.cmphead .tline')).opacity !== '0', basisTxt: (q('.cmphead .basis') || {}).innerText || '',
    basisCut: !!q('.cmphead .basis') && q('.cmphead .basis').scrollWidth > q('.cmphead .basis').clientWidth + 1,
    clinicsDoc: cl ? Math.round(cl.top + scrollY) : null, headBottom: hd ? Math.round(hd.bottom) : 0, sameView: !!(q('#main > .view') || {}).__mark };
});

(async () => { const b = await chromium.launch();
  // ---------------- 9 · 20 · 23 · 40 on the compare screen
  { const { ctx, p, errs } = await open(b, { width: 390, height: 844 });
    await go(p, 'compare?k=X01'); await p.waitForTimeout(800);
    await p.evaluate(() => { document.querySelector('#main > .view').__mark = 1; });
    const h0 = await head(p);
    ok('9 맨 위: 접히지 않음(앱 위 막대·시술명 보임)', !h0.folded && !h0.barHidden && h0.title, JSON.stringify(h0));
    const sweep = [];
    for (let y = 0; y <= 480; y += 8) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(30); const m = await head(p); sweep.push([m.y, m.clinicsDoc, m.folded ? 1 : 0]); }
    const firstFold = sweep.find((s) => s[2]);
    ok('9 내리면 접힘이 시작되고, 접힐 때 목록이 문서 안에서 움직이지 않음', !!firstFold && new Set(sweep.map((s) => s[1])).size === 1, `접힘 시작 scrollY ${firstFold && firstFold[0]} · 목록 위치 ${[...new Set(sweep.map((s) => s[1]))].join(',')}`);
    // the edge does not flicker: 8px back above the fold point it stays folded, 40px back it unfolds, and 8px under the
    // point again it stays unfolded (it folds at the point itself)
    const hy = [];
    if (firstFold) for (const d of [-8, -40, -8, 0]) { await p.evaluate((y) => scrollTo(0, y), firstFold[0] + d); await p.waitForTimeout(60); const m = await head(p); hy.push([m.y, m.folded ? 1 : 0, m.clinicsDoc]); }
    ok('9 경계에서 깜빡이지 않음: 접힌 뒤 8px 올려도 접힌 채, 40px 올리면 펴지고, 다시 경계 8px 앞까지는 펴진 채', hy.map((x) => x[1]).join('') === '1001' && hy.every((x) => x[2] === sweep[0][1]), JSON.stringify(hy));
    await p.evaluate(() => scrollTo(0, 1800)); await p.waitForTimeout(250);
    const h1 = await head(p);
    ok('9 내린 상태: 앱 위 막대 숨김, 경로·기준 줄·중간값·담기가 화면 위에', h1.folded && h1.barHidden && h1.crumb && h1.basis && h1.med && h1.add && !h1.title, JSON.stringify(h1));
    ok('9 내린 상태: 고정된 부분(머리글 + 아래 탭) 25% 이하', h1.cover <= 0.25, `${(h1.cover * 100).toFixed(1)}% (전: 36.9%)`);
    ok('9 접힌 기준 줄: 펼친 때와 같은 글자(일반가·곳 수·부가세 기준), 잘리지 않음', h1.basisTxt === h0.basisTxt && /(일반가|특가 포함) \d+곳 · (부가세 포함가|병원 표시가)/.test(h1.basisTxt) && !h1.basisCut, h1.basisTxt);
    // focus moving up the page (Shift+Tab to the price card) lands below the header, not under it
    const foc = await p.evaluate(async () => { const el = document.querySelector('.pricecard .linkbtn'); el.focus(); await new Promise((r) => setTimeout(r, 250));
      const b = el.getBoundingClientRect(), hd = document.querySelector('.cmphead').getBoundingClientRect(), top = document.querySelector('header.top').getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { top: Math.round(b.top), headBottom: Math.round(Math.max(hd.bottom, top.bottom)), hit: !!hit && (hit === el || el.contains(hit)) }; });
    ok('9 위로 초점 이동: 초점 받은 버튼이 머리글에 가리지 않음', foc.hit && foc.top >= foc.headBottom, JSON.stringify(foc));
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(250);
    const h2 = await head(p);
    ok('9 다시 올리면 원래대로(앱 위 막대·시술명), 화면은 다시 그리지 않음', !h2.folded && !h2.barHidden && h2.title && h2.sameView && h2.clinicsDoc === h0.clinicsDoc, JSON.stringify(h2));
    // 20: the path and the picker steps
    const cr = await p.evaluate(() => {
      const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number), L = (c) => { const v = rgb(c).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const segs = [...document.querySelectorAll('.cmphead .crumb button')], last = segs[segs.length - 1], bg = getComputedStyle(document.body).backgroundColor;
      const fs = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontSize : null; };
      return { n: segs.length, cur: segs.map((s) => s.getAttribute('aria-current')), lastW: +getComputedStyle(last).fontWeight, otherW: segs.slice(0, -1).map((s) => +getComputedStyle(s).fontWeight),
        lastInk: getComputedStyle(last).color === getComputedStyle(document.querySelector('.cmphead .cmpt')).color, under: segs.every((s) => getComputedStyle(s).textDecorationLine.includes('underline')),
        sep: Math.min(...[...document.querySelectorAll('.cmphead .crumb .sep')].map((s) => ratio(getComputedStyle(s).color, bg))).toFixed(2),
        cat: fs('#cmppick details.cmpother > .chips > .chip'), fam: fs('#cmppick .famname'), spec: fs('#cmppick .vstep .chip'), title: fs('#cmppick h3'),
        famW: +getComputedStyle(document.querySelector('#cmppick .famname')).fontWeight, specW: +getComputedStyle(document.querySelector('#cmppick .vstep .chip')).fontWeight,
        // the app's one chip (U12): the spec chips are pills like the 분야 chips under them
        specR: getComputedStyle(document.querySelector('#cmppick .vstep .chip')).borderRadius, catR: getComputedStyle(document.querySelector('#cmppick details.cmpother > .chips > .chip')).borderRadius };
    });
    ok('20 경로: 마지막 단계만 aria-current·진한 700, 앞 단계는 보통 굵기, 모두 밑줄(버튼)', cr.n >= 2 && cr.cur.slice(0, -1).every((c) => c === null) && cr.cur[cr.n - 1] === 'page' && cr.lastW >= 700 && cr.otherW.every((w) => w < 600) && cr.lastInk && cr.under, JSON.stringify(cr));
    ok('20 경로 \'›\' 대비 3:1 이상', +cr.sep >= 3, `${cr.sep}:1 (전: 1.84:1)`);
    // 2026-10-19 type steps: the card title is the section step (17) and the treatment sits under it — it was 17 under a 16 title.
    // 2026-10-20 디자인 통일 U12: the spec chips are the app's one chip (pill, 13/600) like the 분야 chips — they were 15/600 tiles
    ok('20 규격 바꾸기 단계: 카드 제목 17 > 시술 15/760 · 규격 칩 = 분야 칩(알약 13/600)', cr.title === '17px' && cr.cat === '13px' && cr.fam === '15px' && cr.famW === 760 && cr.spec === '13px' && cr.specW === 600
      && cr.specR === cr.catR && parseFloat(cr.specR) >= 999, `${cr.title} > ${cr.fam}/${cr.famW} · ${cr.spec}/${cr.specW} ${cr.specR} · ${cr.cat} ${cr.catR}`);
    // 40: the sub-navigation on its screens
    const sn = [];
    for (const r of ['compare?k=X01', 'versus', 'table']) {
      await go(p, r); await p.waitForTimeout(700);
      sn.push(await p.evaluate((r) => { const t = document.querySelector('#main [role=tablist]'), s = t && t.querySelector('[aria-selected=true]'), o = t && t.querySelector('[aria-selected=false]');
        if (!t || !s) return { r, none: 1 }; const cs = getComputedStyle(s), b = t.getBoundingClientRect();
        return { r, h: Math.round(b.height), top: Math.round(b.top), bg: cs.backgroundColor, line: cs.borderBottomWidth, w: +cs.fontWeight, ow: o ? +getComputedStyle(o).fontWeight : 0, fs: cs.fontSize }; }, r));
    }
    ok('40 비교 위 탭: 세 화면 모두 36px 밑줄 탭(채움 없음), 고른 탭만 굵게, 같은 자리', sn.every((x) => !x.none && x.h >= 36 && x.h <= 40 && /rgba\(0, 0, 0, 0\)|transparent/.test(x.bg) && x.line === '2px' && x.w >= 700 && x.ow < 700) && new Set(sn.map((x) => x.top)).size === 1, JSON.stringify(sn));
    // 23: the logo from a folded compare screen — keyboard focus brings the bar back, Enter goes home at the top; Back returns
    await go(p, 'compare?k=X01'); await p.waitForTimeout(700); await p.evaluate(() => scrollTo(0, 2000)); await p.waitForTimeout(250);
    await p.focus('#top a.brand'); await p.waitForTimeout(100);
    const barBack = await p.evaluate(() => Math.round(document.querySelector('header.top').getBoundingClientRect().top));
    ok('23 접힌 상태에서 키보드 초점이 로고로 가면 앱 위 막대가 다시 보임', barBack >= 0, `top ${barBack}`);
    await p.keyboard.press('Enter'); await p.waitForTimeout(700);
    const home = await p.evaluate(() => ({ hash: location.hash, y: Math.round(scrollY) }));
    ok('23 로고 → 홈 맨 위(하단 탭 홈과 같은 이동)', home.hash === '#home' && home.y === 0, JSON.stringify(home));
    await p.goBack(); await p.waitForTimeout(700);
    ok('23 뒤로 가기 → 떠난 비교 화면', /#compare\?k=X01/.test(await p.evaluate(() => location.hash)), await p.evaluate(() => `${location.hash} ${Math.round(scrollY)}`));
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(200); await p.evaluate(() => scrollTo(0, 1500)); await p.waitForTimeout(200); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(200);
    await p.click('#top a.brand'); await p.waitForTimeout(700);
    ok('23 로고 누르기(손가락) → 홈 맨 위', await p.evaluate(() => location.hash === '#home' && scrollY === 0));
    ok('페이지 오류 없음(비교·로고)', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // ---------------- 19: the median never splits — every X key at three widths
  { const { ctx, p } = await open(b, { width: 390, height: 844 });
    for (const W of [390, 360, 320]) {
      await p.setViewportSize({ width: W, height: 844 });
      const res = await p.evaluate(() => { const ids = App.state().D.keys.map((k) => k[0]).filter((i) => i[0] === 'X'), bad = [], over = [];
        for (const id of ids) { history.replaceState(null, '', '#compare?k=' + id); dispatchEvent(new PopStateEvent('popstate'));
          const med = document.querySelector('.cmphead .hmed'), row = document.querySelector('.cmphead .hrow'); if (!med) continue;
          const num = [...med.childNodes].reverse().find((n) => n.nodeType === 3 && /\d/.test(n.textContent)); if (num) { const rg = document.createRange(); rg.selectNodeContents(num);
            if (new Set([...rg.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size > 1) bad.push(`${id} ${med.textContent}`); }
          // the row's boxes stay inside it and none spills its own words; the ⋯'s press ring (.tbtn-i ::before, 2px round its 40 —
          // 2026-10-20 디자인 통일 U20) takes no room but row.scrollWidth counts it, so the boxes are measured one by one
          const rr = row.getBoundingClientRect(), kids = [...row.children];
          if (kids.some((c) => { const r = c.getBoundingClientRect(); return r.right > rr.right + 1 || r.left < rr.left - 1 || (!c.matches('.tbtn-i') && c.scrollWidth > c.clientWidth + 1); })) over.push(id); }
        return { n: ids.length, bad, over }; });
      ok(`19 머리글 중간값 숫자가 갈라지지 않음·줄 넘침 없음 (${W}px, X 키 ${res.n}개)`, res.n > 30 && !res.bad.length && !res.over.length, JSON.stringify(res));
    }
    // landscape phone: the header scrolls with the page (max-height 500) — never folded
    await p.setViewportSize({ width: 844, height: 390 }); await go(p, 'compare?k=X01'); await p.waitForTimeout(600); await p.evaluate(() => scrollTo(0, 1500)); await p.waitForTimeout(250);
    ok('9 가로 화면(높이 390): 머리글이 붙지 않으니 접지도 않음', await p.evaluate(() => !document.documentElement.classList.contains('cmp-fold') && getComputedStyle(document.querySelector('.cmphead')).position === 'static'
      && document.querySelector('header.top').getBoundingClientRect().bottom > 0));
    await ctx.close(); }

  // ---------------- 38: the branch price list's small sticky header (with one item in 내 견적: the cart bar is up too)
  { const { ctx, p, errs } = await open(b, { width: 390, height: 844 }, 'light', { 'pc:carts': JSON.stringify([{ id: 'h', name: '점검', items: [{ t: 'k', k: 'X12', q: 1 }] }]) });
    const bi = await p.evaluate(() => { const { D } = App.state(); return Math.max(0, D.branches.findIndex((x) => D.s[x[1]] === '강남역점')); });
    await go(p, `branch/${bi}`); await p.waitForTimeout(900);
    const name = await p.evaluate(() => document.querySelector('#main h2').textContent.trim());
    ok('38 맨 위: 작은 머리글은 숨어 있음(가격표의 찾기·분야 칩이 보이니)', await p.evaluate(() => !document.querySelector('.bhead.on') && getComputedStyle(document.querySelector('.bhead')).display === 'none'));
    await p.fill('#main input[aria-label="이 지점에서 시술 찾기"]', '리프팅'); await p.waitForTimeout(300);
    await p.evaluate(() => { document.querySelector('#main > .view').__mark = 1; });
    // just above and just below the point where it shows: the list does not move in the page
    const at = await p.evaluate(async () => { const card = document.querySelector('.bhead').parentElement, ul = card.querySelector('ul.list'), topH = 60, y0 = card.getBoundingClientRect().top + scrollY;
      const doc = () => Math.round(ul.getBoundingClientRect().top + scrollY), wait = () => new Promise((r) => setTimeout(r, 120)); const out = [];
      for (const d of [-2, 2, 200, -10, -30]) { scrollTo(0, y0 - topH + d); await wait(); out.push({ on: document.querySelector('.bhead').classList.contains('on'), ul: doc(), bar: Math.round(document.querySelector('header.top').getBoundingClientRect().bottom) }); }   // card top at 62 · 58 · -140 · 70 · 90
      return out; });
    ok('38 가격 목록이 앱 위 막대 밑으로 들어가면 작은 머리글이 뜨고, 뜰 때 목록이 움직이지 않음(높은 화면: 앱 위 막대는 그대로)', !at[0].on && at[1].on && at[2].on && at.every((x) => x.ul === at[0].ul && x.bar >= 60), JSON.stringify(at));
    ok('38 경계에서 깜빡이지 않음: 뜬 뒤 10px 올려도 뜬 채, 30px 올리면 숨음', at[3].on && !at[4].on, JSON.stringify(at.slice(3)));
    await p.evaluate(() => { const c = document.querySelector('.bhead').parentElement; scrollTo(0, c.getBoundingClientRect().top + scrollY + c.offsetHeight / 2); }); await p.waitForTimeout(250);
    const deep = await p.evaluate(() => { const vh = innerHeight, bh = document.querySelector('.bhead'), r = bh.getBoundingClientRect(), top = document.querySelector('header.top').getBoundingClientRect();
      const nav = document.querySelector('nav.tabs').getBoundingClientRect(), fc = document.querySelector('#fcart'), fr = fc && !fc.hidden ? fc.getBoundingClientRect() : null;
      const bottom = Math.min(nav.top, fr && fr.height ? fr.top : vh), on = bh.querySelector('.chip[aria-pressed=true]');
      return { on: bh.classList.contains('on'), top: Math.round(r.top), h: Math.round(r.height), name: bh.querySelector('.bn').textContent, chip: on ? on.textContent : null, cover: +((Math.max(top.bottom, r.bottom) + vh - bottom) / vh).toFixed(3), cart: !!fr }; });
    ok('38 깊이 내리면 지점명 + 분야 칩 머리글(56px 안팎)이 앱 위 막대 바로 밑에', deep.on && deep.top >= 58 && deep.top <= 62 && deep.h >= 48 && deep.h <= 64 && deep.name === name && deep.chip === '전체', JSON.stringify(deep));
    ok('38 고정된 부분(위 막대·작은 머리글·견적 막대·아래 탭) 30% 아래', deep.cover < 0.3 && deep.cart, `${(deep.cover * 100).toFixed(1)}%`);
    const tap = await p.evaluate(async () => { const bh = document.querySelector('.bhead'), c = [...bh.querySelectorAll('.chip')].find((x) => x.getAttribute('aria-pressed') === 'false');
      const label = c.textContent, inp = document.querySelector('#main input[aria-label="이 지점에서 시술 찾기"]'); inp.__mark = 1; c.click(); await new Promise((r) => setTimeout(r, 300));
      const inp2 = document.querySelector('#main input[aria-label="이 지점에서 시술 찾기"]'), tbl = inp2.closest('.card'), own = [...tbl.querySelector('.chips').children].find((x) => x.textContent === label);
      return { label, sameView: !!document.querySelector('#main > .view').__mark, sameInput: !!inp2.__mark, typed: inp2.value, ownPressed: own && own.getAttribute('aria-pressed'), miniPressed: c.getAttribute('aria-pressed'),
        tableTop: Math.round(tbl.getBoundingClientRect().top), focus: document.activeElement === own, rows: document.querySelectorAll('.bhead ~ ul.list > li').length }; });
    ok('38 작은 머리글의 분야 칩: 화면을 다시 그리지 않고(친 검색어 그대로) 가격표 칩도 같은 것이 눌림, 가격표로 올라가 그 칩에 초점', tap.sameView && tap.sameInput && tap.typed === '리프팅' && tap.ownPressed === 'true' && tap.miniPressed === 'true' && tap.tableTop >= 0 && tap.tableTop < 400 && tap.focus && tap.rows > 0, JSON.stringify(tap));
    ok('페이지 오류 없음(지점)', !errs.length, errs.join(' | '));
    await ctx.close(); }

  // ---------------- 38 on short screens (max-height 700): the app bar slides away while the small header shows, keyboard focus
  // brings it back; the name is the brand over the branch, so the branch's own name stays at 320. 375×667 with the cart bar up,
  // 320×568 without (with it: 56 + 48 + 72 of 568 = 31%, said in the report)
  for (const [vp, cart] of [[{ width: 375, height: 667 }, true], [{ width: 320, height: 568 }, false]]) {
    const { ctx, p, errs } = await open(b, vp, 'light', cart ? { 'pc:carts': JSON.stringify([{ id: 'h', name: '점검', items: [{ t: 'k', k: 'X12', q: 1 }] }]) } : null);
    const bi = await p.evaluate(() => { const { D } = App.state(); return Math.max(0, D.branches.findIndex((x) => D.s[x[1]] === '강남역점')); });
    await go(p, `branch/${bi}`); await p.waitForTimeout(900);
    const name = await p.evaluate(() => document.querySelector('#main h2').textContent.trim());
    await p.evaluate(() => { const c = document.querySelector('.bhead').parentElement; scrollTo(0, c.getBoundingClientRect().top + scrollY + c.offsetHeight / 2); }); await p.waitForTimeout(250);
    const m = await p.evaluate(() => { const vh = innerHeight, bh = document.querySelector('.bhead'), r = bh.getBoundingClientRect(), top = document.querySelector('header.top').getBoundingClientRect();
      const nav = document.querySelector('nav.tabs').getBoundingClientRect(), fc = document.querySelector('#fcart'), fr = fc && !fc.hidden ? fc.getBoundingClientRect() : null;
      const bottom = Math.min(nav.top, fr && fr.height ? fr.top : vh), bb = bh.querySelector('.bn .bb'), bs = bh.querySelector('.bn .bs');
      return { on: bh.classList.contains('on'), top: Math.round(r.top), barBottom: Math.round(top.bottom), name: bh.querySelector('.bn').textContent, cart: !!(fr && fr.height),
        twoLines: bs.getBoundingClientRect().top >= bb.getBoundingClientRect().bottom - 1, bsCut: bs.scrollWidth > bs.clientWidth + 1, sw: document.documentElement.scrollWidth,
        cover: +((Math.max(Math.max(0, top.bottom), r.bottom) + vh - bottom) / vh).toFixed(3) }; });
    ok(`38 ${vp.width}×${vp.height}: 작은 머리글이 뜨면 앱 위 막대가 숨고 머리글이 맨 위, 고정 합계 30% 아래${cart ? '(견적 막대 포함)' : ''}`, m.on && m.barBottom <= 0 && m.top >= 0 && m.top <= 2 && m.cart === cart && m.cover < 0.3 && m.sw <= vp.width + 1, JSON.stringify(m));
    ok(`38 ${vp.width}×${vp.height}: 지점명은 브랜드 위·지점 아래 두 줄, 지점 이름이 잘리지 않음`, m.name === name && m.twoLines && !m.bsCut, JSON.stringify(m));
    await p.focus('#top a.brand'); await p.waitForTimeout(100);
    ok(`38 ${vp.width}×${vp.height}: 키보드 초점이 앱 위 막대로 가면 막대가 다시 보임`, await p.evaluate(() => Math.round(document.querySelector('header.top').getBoundingClientRect().top) >= 0));
    ok(`페이지 오류 없음(지점 ${vp.width}×${vp.height})`, !errs.length, errs.join(' | '));
    await ctx.close(); }

  // ---------------- 9 in dark mode and at 320 (the folded header reads the same; nothing spills)
  for (const [vp, scheme] of [[{ width: 390, height: 844 }, 'dark'], [{ width: 320, height: 640 }, 'light']]) {
    const { ctx, p } = await open(b, vp, scheme);
    await go(p, 'compare?k=X01'); await p.waitForTimeout(700); await p.evaluate(() => scrollTo(0, 1800)); await p.waitForTimeout(250);
    const m = await head(p), sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(`9 ${vp.width}×${vp.height} ${scheme}: 접힌 머리글(경로·중간값·담기), 가로 넘침 없음`, m.folded && m.crumb && m.med && m.add && sw <= vp.width + 1, `${(m.cover * 100).toFixed(1)}% · scrollWidth ${sw}`);
    await ctx.close(); }
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1; })();
