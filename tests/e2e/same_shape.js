// 위계 점검 묶음 5 '같은 역할은 같은 모양, 가까운 것끼리' (hierarchy audit REPORT 순번 29·30·31·32·33·34·35·39·47·50·52; 6.0 규칙
// 3·4). What it holds on the screens the person reads, at 390 and 320 wide:
//  29. a price line's badges in one order everywhere — kind & conditions (체험가·한정가·고시가, 첫 방문·평일·시간 한정 …) →
//      warnings (기간 끝남 kx, 기간 확인 필요 kc, 초저가·조건 확인 kw …) → information (~10/31까지, VAT, 추가 옵션, 제품·장비): 비교 지점 줄,
//      지점 가격표, 검색 결과, 견적 펼친 줄
//  30. every fold's summary line has the same chevron (one CSS mark, no svg / ▾ / none) at the line's right end; the compare
//      screen's block folds are cards (no 12px extra above them: the view's 24 between blocks — 위계 점검 51), and opened they hold no card in a card
//  31. the compare price card holds no framed or filled box: 제품 안내 (mixnote) is a line with no frame, still above the price
//      range (C: TREATMENT_TAXONOMY §4); 조건부 가격 · 확인 필요 초저가 sit under a hairline with a badge, sentence unchanged
//  32. search: between the filters and the results nothing else — two blocks 24px apart; '이렇게 찾았어요' in the filter card,
//      the count line (.searchstat, role=status) and '가격만으로 고르지 마세요' in the results card
//  33. search in 지역·이름순: a clinic is named once over its lines (a head per run of lines), its lines carry no clinic link;
//      another order names the clinic on every line; the price sits on the name's first line
//  34. 견적 펼친 줄: '2회째부터' and its badges start their own line under the first price's 출처
//  35. 지점 머리: the actions are equal halves, two per row, none alone; 길찾기 · 병원 홈페이지 carry ↗ and open a new tab; at
//      320 none is cut
//  39. a long key (picked from the week's data — a T key is a hash of its name): 담기 names the short name, uncut, its
//      aria-label the full one
//  47. the way to a price's evidence is one ⓘ on every price line (비교·지점·검색), no '가격 근거' / '출처' text links on the
//      lines; the ⓘ opens the sheet whose '원본' line links the clinic's page; the clinic link stays (search)
//  50. 홈: '전체 비교' sits 8px under the cards it continues, the next block 24px away
//  52. the words of every kind of line start at one x (비교 줄, 지점·검색 줄, 견적 머리줄·펼친 줄)
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/same_shape.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 260)}`); };
const CART = [{ t: 'k', k: 'X14', q: 3 }, { t: 'k', k: 'X01', q: 2 }, { t: 'k', k: 'X12', q: 1 }];

// in-page helpers
const HELP = () => {
  window.__vis = (el) => !!el && el.checkVisibility() && el.getBoundingClientRect().width > 0;
  // a badge's group: 0 kind & condition (butter k1 k2 kt, and 고시가), 1 warning — a price that cannot be had (kx), a condition to
  // check (kc), a state of the data (kw) — or check (ok), 2 information (k4, prodk). The colour roles (위계 점검 27) gave the
  // warnings three colours; their place in the line is the same
  window.__grp = (k) => (k.matches('.k1, .k2, .kt') || k.textContent.trim() === '고시가') ? 0 : k.matches('.kx, .kc, .kw, .ok') ? 1 : 2;
  window.__badOrder = (box) => { let mx = 0; for (const k of [...box.querySelectorAll('.k')].filter(__vis)) { const g = __grp(k); if (g < mx) return [...box.querySelectorAll('.k')].filter(__vis).map((x) => x.textContent.trim()).join(' > '); mx = Math.max(mx, g); } return null; };
  // a fold's chevron: the ::after box (one mark for every fold) at the summary line's right end
  window.__chev = (s) => { const af = getComputedStyle(s, '::after'), cs = getComputedStyle(s), sr = s.getBoundingClientRect();
    const box = af.content === '""' && parseFloat(af.width) === 8 && parseFloat(af.borderRightWidth) >= 1 && parseFloat(af.borderBottomWidth) >= 1 && parseFloat(af.borderTopWidth) === 0;
    const svg = [...s.querySelectorAll('svg.i')].some((x) => /chevron/.test(x.innerHTML) || x.querySelector('path[d^="m6 9"], path[d^="m18 15"]'));
    const rg = document.createRange(); rg.selectNodeContents(s); const rs = [...rg.getClientRects()].filter((r) => r.width > 0);
    const textRight = rs.length ? Math.max(...rs.map((r) => r.right)) : sr.left, lines = new Set(rs.map((r) => Math.round(r.top / 4))).size;
    const right = /flex/.test(cs.display) && (parseFloat(af.marginLeft) > 2 || lines > 1 || sr.right - parseFloat(cs.paddingRight) - textRight < 30);
    return { box, svg, right, text: s.textContent.trim().slice(0, 30), cls: s.parentElement.className };
  };
  // a line's ⓘ: 36px to see, 44 to press — the press area reaches 8px right of it (probed with elementFromPoint 7px out, so
  // nothing clips it) and not left of it (probed 2px out: the 4px to 담기 stay a gap)
  window.__hit = (li) => { const ib = li.querySelector(':scope > .infob'); if (!ib) return null; li.scrollIntoView({ block: 'center' });
    const ir = ib.getBoundingClientRect(), add = li.querySelector('.addbtn'), ar = add && add.getBoundingClientRect(), y = ar ? ar.top + ar.height / 2 : ir.top + ir.height / 2;
    const at = (x) => { const e = document.elementFromPoint(x, y); return !!e && e.closest('.infob') === ib; }, af = getComputedStyle(ib, '::after');
    return { vis: Math.round(ir.width), press: Math.round(ir.width - parseFloat(af.left || 0) - parseFloat(af.right || 0)), right: at(ir.right + 7), left: at(ir.left - 2),
      gap: ar ? Math.round(ir.left - ar.right) : null }; };
  window.__framed = (e) => { const cs = getComputedStyle(e); const bd = ['Top', 'Right', 'Bottom', 'Left'].filter((x) => parseFloat(cs[`border${x}Width`]) > 0 && cs[`border${x}Style`] !== 'none').length >= 3;
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent'; return bd || bg; };
};

(async () => {
  const b = await chromium.launch();
  const page = async (vp, region = '수도권', scheme = 'light') => {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: true, hasTouch: true, colorScheme: scheme }); await ctx.addInitScript(HELP);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await p.goto(BASE); await p.evaluate(([region, items]) => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify(region));
      localStorage.setItem('pc:carts', JSON.stringify([{ id: 's', name: '모양 시험', items }])); localStorage.setItem('pc:ci', '0'); }, [region, CART]);
    await p.reload();
    if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
    await p.waitForSelector('#main .card'); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    return { ctx, p, errs };
  };
  const go = async (p, hash, wait = 1000) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(wait); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(150); };
  const folds = (p) => p.evaluate(() => [...document.querySelectorAll('#main details')].map((d) => d.querySelector(':scope > summary')).filter((s) => __vis(s)).map(__chev));
  const __hitOkN = (h) => !!h && h.vis === 36 && h.press >= 44 && h.right && !h.left && (h.gap == null || h.gap >= 4);
  const badFolds = (fs) => fs.filter((f) => !f.box || f.svg || !f.right).map((f) => `${f.cls}«${f.text}» box=${f.box} svg=${f.svg} right=${f.right}`);

  for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const tag = `${vp.width}`;
    const { ctx, p, errs } = await page(vp);
    const wide = vp.width === 390;

    // ---------- 비교 (X01)
    await go(p, '#compare?k=X01', 1500);
    const cmp = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('#clinics li.rk')];
      const bad = rows.map((li) => __badOrder(li.querySelector('.m'))).filter(Boolean);
      const both = rows.filter((li) => li.querySelector('.m .k.kt, .m .k.k1, .m .k.k2') && li.querySelector('.m .k.k4')).length;
      const pc = document.querySelector('.pricecard');
      const boxes = [...pc.querySelectorAll('*')].filter((e) => __vis(e) && !e.matches('.k, .k *, button, button *, a, a *, svg, svg *, .prange, .prange *') && __framed(e)).map((e) => e.className || e.tagName);
      const cl = [...pc.querySelectorAll('.condlow')].map((c) => { const cs = getComputedStyle(c); return { line: parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none', fill: __framed(c), badges: [...c.querySelectorAll('.k')].filter(__vis).map((k) => k.className + ':' + k.textContent.trim()), sub: (c.querySelector('.sub') || {}).textContent || '' }; });
      const cf = [...document.querySelectorAll('#main details.cmpfold')].map((d) => { const prev = d.previousElementSibling; return { card: d.classList.contains('card'), gap: prev ? Math.round(d.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) : null }; });
      const rk = rows[0] && rows[0].querySelector('.rank .b'), card = document.querySelector('#clinics');
      const infob = rows.filter((li) => li.querySelectorAll(':scope > .infob').length === 1 && /가격 정보/.test(li.querySelector(':scope > .infob').getAttribute('aria-label'))).length;
      const hits = rows.slice(0, 3).map(__hit); scrollTo(0, 0);
      return { n: rows.length, bad, both, boxes, cl, cf, textX: rk ? rk.getBoundingClientRect().left - card.getBoundingClientRect().left : null, infob, hits,
        priceR: rows[0] ? card.getBoundingClientRect().right - rows[0].querySelector('.rank .p').getBoundingClientRect().right : null };
    });
    ok(`29 ${tag} 비교 줄 배지 순서: 종류·조건 → 경고 → 정보`, cmp.n >= 5 && !cmp.bad.length, `${cmp.n}줄 · 어긋난 줄 ${cmp.bad.length} ${cmp.bad.slice(0, 2).join(' | ')}`);
    if (wide) ok('29 비교: 조건 배지와 날짜 배지가 같이 있는 줄이 있음(순서가 시험됨)', cmp.both > 0, `${cmp.both}줄`);
    ok(`31 ${tag} 가격 카드 안에 테두리·채움 상자 없음`, !cmp.boxes.length, cmp.boxes.join(', '));
    ok(`31 ${tag} 특가·초저가: 위 선 + 배지, 채움 없음, 문장 그대로`, cmp.cl.length >= 1 && cmp.cl.every((c) => c.line && !c.fill && c.badges.length >= 1)
      && cmp.cl.some((c) => /조건이 맞을 때만 이 가격이에요\.$/.test(c.sub)), JSON.stringify(cmp.cl).slice(0, 240));
    ok(`30 ${tag} 비교 덩어리 접기 2개는 카드, 위 간격은 화면 간격(덩어리 사이) 24px`, cmp.cf.length === 2 && cmp.cf.every((c) => c.card && c.gap === 24), JSON.stringify(cmp.cf));
    ok(`47 ${tag} 비교 줄: ⓘ 하나(가격 정보)`, cmp.infob === cmp.n, `${cmp.infob}/${cmp.n}`);
    ok(`47 ${tag} 비교 줄 ⓘ: 보이는 칸 36, 누르는 곳 44(오른쪽으로만 넓힘)`, cmp.hits.length === 3 && cmp.hits.every(__hitOkN), JSON.stringify(cmp.hits[0]));
    await p.evaluate(() => { for (const d of document.querySelectorAll('details.cmpfold')) d.open = true; }); await p.waitForTimeout(300);
    const inner = await p.evaluate(() => [...document.querySelectorAll('details.cmpfold')].map((d) => [...d.querySelectorAll('*')].filter((e) => __vis(e) && (e.matches('.card, .guide') || (e.closest('.cmpfold') === d && getComputedStyle(e).boxShadow !== 'none' && e.matches('div, section'))) && __framed(e)).map((e) => e.className)));
    ok(`30 ${tag} 펼친 덩어리 접기 안에 카드 없음`, inner.every((x) => !x.length), JSON.stringify(inner));
    const cf = await folds(p);
    ok(`30 ${tag} 비교 화면 접기 요약 줄: 모두 같은 꺾쇠, 오른쪽 끝`, cf.length >= 4 && !badFolds(cf).length, `${cf.length}개 ${badFolds(cf).join(' | ')}`);
    const cmpX = cmp.textX;

    // ---------- 제품 안내 (X35 전국: devices mixed)
    if (wide) {
      await p.evaluate(() => { localStorage.setItem('pc:region', '""'); }); await p.reload(); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
      await go(p, '#compare?k=X35', 1500);
      const mx = await p.evaluate(() => { const m = document.querySelector('.pricecard .mixnote'); if (!m) return null; const hero = document.querySelector('.pricecard .hero'); const s = m.querySelector('summary');
        return { framed: __framed(m), above: m.getBoundingClientRect().bottom <= hero.getBoundingClientRect().top + 1, chev: __chev(s), open: m.open, text: s.textContent.trim() }; });
      ok('31 제품 안내: 테두리·채움 없는 한 줄, 가격 범위 위(C 규칙), 같은 꺾쇠로 펼침', !!mx && !mx.framed && mx.above && mx.chev.box && mx.chev.right && !mx.open && /섞여 있어요/.test(mx.text), JSON.stringify(mx));
      await p.evaluate(() => { localStorage.setItem('pc:region', JSON.stringify('수도권')); }); await p.reload(); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    }

    // ---------- 긴 이름 키: the keys are picked from this week's data (a T key is a hash of its name — 검토: no key written here)
    if (wide) {
      // the app's 담기 words: the family's option name ('기본' → the key's own), short (Spec.shortLabel)
      const pick = await p.evaluate(() => { const { D, FAM } = App.state(); const famOf = D.keys.map(() => null);
        FAM.forEach((f) => f.vs.forEach((v) => { if (!famOf[v.k]) famOf[v.k] = { f, label: v.label }; }));
        const full = (k) => (famOf[k] && famOf[k].label !== '기본' ? famOf[k].label : D.keys[k][2]).replace(/\s+/g, ' ').trim();
        const longs = [];
        for (let k = 0; k < D.keys.length; k++) { const a = full(k); if (a.length <= 20) continue;
          const s = Spec.shortLabel(a); if (s !== a && s.length >= 4 && s.length <= 14) longs.push({ id: D.keys[k][0], full: a, short: s }); }
        return longs.sort((x, y) => (x.id < y.id ? -1 : 1)).slice(0, 12); });
      let pk = null;
      for (const c of pick) { await go(p, '#compare?k=' + c.id, 1100);
        const x = await p.evaluate(() => { const a = document.querySelector('.cmphead .addbtn'); const sp = a && a.querySelector(':scope > span');
          return a ? { add: a.innerText.replace(/\s+/g, ' ').trim(), cut: sp.scrollWidth > sp.clientWidth + 1, label: a.getAttribute('aria-label'), title: document.querySelector('.cmphead .cmpt').textContent } : null; });
        if (x) { pk = { ...c, ...x }; break; } }
      if (!pk) console.log('SKIP | 39 긴 이름 키: 이번 자료에 줄일 수 있는 긴 이름(가격 있는 키)이 없음');
      else ok('39 긴 이름 키: 담기 글자는 짧은 이름(잘리지 않음), 화면 읽기 이름은 전체 이름', pk.add === `담기 · ${pk.short}` && !pk.cut && pk.label.includes(pk.title), JSON.stringify(pk));
    }

    // ---------- 검색 '리쥬란 2cc' (기본 정렬: 지역·이름순)
    await go(p, '#search/' + encodeURIComponent('리쥬란 2cc'), 1600);
    const se = await p.evaluate(() => {
      const res = document.querySelector('#main .card.results'), inner = res && res.parentElement;
      const kids = inner ? [...inner.children].filter(__vis) : [];
      const fi = kids.findIndex((e) => e.querySelector('.fgrid')), ri = kids.indexOf(res);
      const gap = fi >= 0 && ri > fi ? Math.round(res.getBoundingClientRect().top - kids[ri - 1].getBoundingClientRect().bottom) : null;
      const lis = res ? [...res.querySelectorAll(':scope > ul.list > li')] : [];
      const runs = []; for (const li of lis) { const b = li.querySelector('.addbtn').getAttribute('aria-label').split(' · ').pop().replace(/ 내 견적에 담기$/, ''); if (!runs.length || runs[runs.length - 1].b !== b) runs.push({ b, head: !!li.querySelector(':scope > .sgh'), n: 1 }); else { runs[runs.length - 1].n++; if (li.querySelector(':scope > .sgh')) runs[runs.length - 1].extraHead = true; } }
      const headName = [...res.querySelectorAll('.sgh .sgname')].map((x) => x.textContent.trim());
      const lineLinks = lis.filter((li) => li.querySelector('.item .m .linkbtn')).length;
      const textLinks = lis.filter((li) => [...li.querySelectorAll('.linkbtn, a.src')].some((x) => __vis(x) && /^(가격 근거|출처)$/.test(x.textContent.trim()))).length;
      const infob = lis.filter((li) => li.querySelectorAll(':scope > .infob').length === 1).length;
      const align = lis.map((li) => { const t = li.querySelector('.item > .t'), pr = li.querySelector('.item > .p'); const rg = document.createRange(); rg.selectNodeContents(t); const first = [...rg.getClientRects()][0];
        return first ? Math.abs(pr.getBoundingClientRect().bottom - first.bottom) : 99; });
      const it = lis[0] && lis[0].querySelector('.item > .t');
      return { blocks: kids.length, between: ri - fi - 1, gap, filterHasQ: !!(kids[fi] && kids[fi].querySelector('.qcard')), statIn: !!(res && res.querySelector('.searchstat[role=status]')),
        warnIn: !!res && /가격만으로 고르지 마세요/.test(res.querySelector('.reshead').innerText), n: lis.length, runs, headName, lineLinks, textLinks, infob, align: Math.max(...align),
        textX: it ? it.getBoundingClientRect().left - res.getBoundingClientRect().left : null, bad: lis.map((li) => __badOrder(li.querySelector('.item .m'))).filter(Boolean) };
    });
    ok(`32 ${tag} 검색: 필터와 결과 두 덩어리, 사이에 다른 상자 없음, 24px`, se.between === 0 && se.gap === 24 && se.statIn && se.warnIn, `사이 ${se.between} · 간격 ${se.gap}px · 결과 머리 ${se.statIn}/${se.warnIn}`);
    ok(`33 ${tag} 지역·이름순: 지점마다 머리 한 번, 줄에는 지점 링크 없음`, se.n >= 10 && se.runs.length >= 2 && se.runs.every((r) => r.head && !r.extraHead) && se.headName.length === se.runs.length && se.lineLinks === 0,
      `${se.n}줄 · 지점 ${se.runs.length}곳 · 머리 ${se.headName.length} · 줄 링크 ${se.lineLinks}`);
    ok(`33 ${tag} 가격은 상품명 첫 줄에 맞춤(아랫선 차이 5px 안 — 15px 이름 · 16px 가격의 같은 기준선)`, se.align <= 5, `${se.align.toFixed(1)}px`);
    ok(`47 ${tag} 검색 줄: ⓘ 하나, '가격 근거'·'출처' 글자 링크 없음`, se.infob === se.n && se.textLinks === 0, `ⓘ ${se.infob}/${se.n} · 글자 링크 ${se.textLinks}`);
    ok(`29 ${tag} 검색 줄 배지 순서`, !se.bad.length, se.bad.slice(0, 2).join(' | '));
    // a clinic's head sits with its own lines (24 above it, 8 to its first line — 검토: 16 / 16 read as one more line), and the
    // ⓘ of a search line is pressed over 44px without coming nearer 담기
    const sx = await p.evaluate(() => { const heads = [...document.querySelectorAll('#main .results li.rk.sgs')].slice(1, 4);
      const prox = heads.map((li) => { const hn = li.querySelector('.sgname').getBoundingClientRect(), t = li.querySelector('.item > .t').getBoundingClientRect();
        return { above: Math.round(hn.top - li.getBoundingClientRect().top), below: Math.round(t.top - hn.bottom) }; });
      const hits = [...document.querySelectorAll('#main .results ul.list > li.rk')].slice(0, 3).map(__hit); scrollTo(0, 0); return { prox, hits }; });
    ok(`33 ${tag} 지점 머리: 위 24px, 첫 줄까지 8px 안팎(머리는 아래 줄들 쪽)`, sx.prox.length >= 1 && sx.prox.every((x) => x.above === 24 && x.below >= 8 && x.below <= 11), JSON.stringify(sx.prox));
    ok(`47 ${tag} 검색 줄 ⓘ: 보이는 칸 36, 누르는 곳 44, 담기와 4px 그대로`, sx.hits.length === 3 && sx.hits.every(__hitOkN), JSON.stringify(sx.hits[0]));
    ok(`52 ${tag} 검색 줄과 비교 줄의 글자 시작선이 같음`, cmpX != null && Math.abs(se.textX - cmpX) < 0.6, `비교 ${cmpX} · 검색 ${se.textX}`);
    const sf = await folds(p);
    ok(`30 ${tag} 검색 화면 접기 요약 줄(검색 팁·상세 필터·더 좁히기·비슷한 종류): 같은 꺾쇠, 오른쪽 끝`, sf.length >= 3 && !badFolds(sf).length, `${sf.length}개 ${badFolds(sf).join(' | ')}`);
    if (wide) {
      // the ⓘ opens the evidence; its '원본' line links the clinic's page
      await p.locator('#main .card.results li.rk > .infob').first().click(); await p.waitForTimeout(300);
      const sh = await p.evaluate(() => { const s = document.querySelector('.sheet[aria-label="가격 정보"]'); if (!s) return null; const dt = [...s.querySelectorAll('dt')].find((x) => x.textContent === '원본');
        return { orig: !!dt, link: !!(dt && dt.nextElementSibling.querySelector('a[href^="http"][target=_blank]')) || /원본 링크 없음/.test(dt ? dt.nextElementSibling.textContent : '') }; });
      ok('47 검색 ⓘ → 가격 정보 창, \'원본\' 줄에 병원 원본 링크', !!sh && sh.orig && sh.link, JSON.stringify(sh));
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      // 이렇게 찾았어요 goes in the filter card
      await go(p, '#search/' + encodeURIComponent('사각턱 50U -제오민') + '?nl=0', 1500);
      const q = await p.evaluate(() => { const qc = document.querySelector('#main .qcard'); return qc ? { inFilter: !!qc.closest('.card') && !!qc.closest('.card').querySelector('.fgrid'), framed: __framed(qc), text: qc.innerText.replace(/\s+/g, ' ') } : null; });
      ok('32 \'이렇게 찾았어요\'는 필터 카드 맨 위 한 줄(상자 없음)', !!q && q.inFilter && !q.framed && /빼기: 제오민/.test(q.text), JSON.stringify(q));
      // another order: every line names its clinic
      await go(p, '#search/' + encodeURIComponent('리쥬란 2cc') + '?sort=price', 1500);
      const pr = await p.evaluate(() => { const lis = [...document.querySelectorAll('#main .card.results > ul.list > li')]; return { n: lis.length, heads: document.querySelectorAll('#main .card.results .sgh').length, links: lis.filter((li) => li.querySelector('.item .m .linkbtn .bdot')).length }; });
      ok('33 낮은 가격순: 지점 머리 없이 줄마다 지점 이름 링크(지점명 링크는 남음)', pr.n >= 10 && pr.heads === 0 && pr.links === pr.n, JSON.stringify(pr));
    }
    // the '종류' card: a line with no ⓘ (no note for that family) keeps its 14px right margin — its price ends where the hairlines
    // end; a line with ⓘ has 8px (위계 점검 51: 8px steps — it was 4) and the ⓘ column (검토: that margin reached the lines with no ⓘ)
    await go(p, '#search/' + encodeURIComponent('물광'), 1500);
    const fm = await p.evaluate(() => { const lis = [...document.querySelectorAll('#main .fams ul.list > li.rk')].filter(__vis);
      return lis.map((li) => { const it = li.querySelector(':scope > .item'), pp = it.querySelector('.p, .num'); const lr = li.getBoundingClientRect();
        return { ib: !!li.querySelector(':scope > .infob'), pad: parseFloat(getComputedStyle(it).paddingRight), priceR: pp ? Math.round(lr.right - pp.getBoundingClientRect().right) : null }; }); });
    const fNo = fm.filter((x) => !x.ib), fYes = fm.filter((x) => x.ib);
    if (!fNo.length) console.log(`SKIP | 52 ${tag} '종류' 카드에 ⓘ 없는 줄이 없음`);
    else ok(`52 ${tag} '종류' 카드: ⓘ 없는 줄은 오른쪽 여백 14px(가는 선 끝), ⓘ 있는 줄은 8px + ⓘ 칸`, fNo.every((x) => x.pad === 14 && x.priceR >= 14) && fYes.every((x) => x.pad === 8), JSON.stringify(fm.slice(0, 5)));

    // ---------- 지점 (블리비 강남역점)
    const bi = await p.evaluate(() => { const { D } = App.state(); const x = D.branches.findIndex((y) => D.s[y[1]] === '강남역점'); return x >= 0 ? x : 0; });
    await go(p, `#branch/${bi}`, 1300);
    const br = await p.evaluate(() => {
      const box = document.querySelector('#main .bbtns'); const btns = box ? [...box.children].filter(__vis) : [];
      const r = btns.map((x) => { const q = x.getBoundingClientRect(); return { t: x.textContent.replace(/ — 새 창에서 열려요/, '').trim(), w: Math.round(q.width), x: Math.round(q.left), y: Math.round(q.top),
        out: x.matches('a[target=_blank]'), arrow: [...x.querySelectorAll('svg.i')].some((s) => s.innerHTML.includes('M7 7h10v10')), cut: x.scrollWidth > x.clientWidth + 1 }; });
      const rows = [...new Set(r.map((x) => x.y))].map((y) => r.filter((x) => x.y === y).length);
      const lis = [...document.querySelectorAll('#main .card.flush ul.list > li.rk')];
      const textLinks = lis.filter((li) => [...li.querySelectorAll('.linkbtn, a.src')].some((x) => __vis(x) && /^(가격 근거|출처)$/.test(x.textContent.trim()))).length;
      const t0 = lis[0] && lis[0].querySelector('.item > .t'), card = lis[0] && lis[0].closest('.card');
      return { r, rows, widths: [...new Set(r.map((x) => x.w))], n: lis.length, infob: lis.filter((li) => li.querySelectorAll(':scope > .infob').length === 1).length, textLinks,
        textX: t0 ? t0.getBoundingClientRect().left - card.getBoundingClientRect().left : null, bad: lis.map((li) => __badOrder(li.querySelector('.item .m'))).filter(Boolean), overflow: document.documentElement.scrollWidth > innerWidth,
        hits: lis.slice(0, 3).map(__hit) };
    });
    const ext = br.r.filter((x) => /길찾기|병원 홈페이지/.test(x.t));
    ok(`35 ${tag} 지점 머리 버튼: 같은 폭 2칸 격자, 혼자 남는 줄 없음`, br.r.length === 6 && br.widths.length === 1 && br.rows.every((n) => n === 2), `폭 ${br.widths.join('/')} · 줄마다 ${br.rows.join('·')}`);
    ok(`35 ${tag} 앱 밖으로 나가는 버튼(길찾기·병원 홈페이지)에 ↗, 새 창`, ext.length === 2 && ext.every((x) => x.out && x.arrow) && br.r.filter((x) => !/길찾기|병원 홈페이지/.test(x.t)).every((x) => !x.arrow), JSON.stringify(ext.map((x) => [x.t, x.out, x.arrow])));
    ok(`35 ${tag} 버튼 글자 잘림·가로 넘침 없음`, br.r.every((x) => !x.cut) && !br.overflow, br.r.filter((x) => x.cut).map((x) => x.t).join(','));
    ok(`47 ${tag} 지점 가격표 줄: ⓘ 하나, '가격 근거'·'출처' 글자 링크 없음`, br.n >= 10 && br.infob === br.n && br.textLinks === 0, `ⓘ ${br.infob}/${br.n} · 글자 링크 ${br.textLinks}`);
    ok(`29 ${tag} 지점 가격표 배지 순서`, !br.bad.length, br.bad.slice(0, 2).join(' | '));
    ok(`47 ${tag} 지점 줄 ⓘ: 보이는 칸 36, 누르는 곳 44, 담기와 4px 그대로`, br.hits.length === 3 && br.hits.every(__hitOkN), JSON.stringify(br.hits[0]));
    ok(`52 ${tag} 지점 줄과 비교 줄의 글자 시작선이 같음`, cmpX != null && Math.abs(br.textX - cmpX) < 0.6, `비교 ${cmpX} · 지점 ${br.textX}`);
    if (wide) {
      await p.locator('#main .card.flush ul.list > li.rk > .infob').first().click(); await p.waitForTimeout(300);
      ok('47 지점 ⓘ → 가격 정보 창(원본 줄)', await p.locator('.sheet[aria-label="가격 정보"] dt', { hasText: /^원본$/ }).count() === 1);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    }

    // ---------- 홈
    await go(p, '#home', 900);
    const hm = await p.evaluate(() => { const g = document.querySelector('#main .grid'), btn = [...document.querySelectorAll('#main .morelist.hall')].find((x) => /전체 비교/.test(x.textContent));
      const ent = document.querySelector('#main .entries'); if (!g || !btn || !ent) return null;
      const prev = ent.previousElementSibling;
      return { under: btn.previousElementSibling === g, gap: Math.round(btn.getBoundingClientRect().top - g.getBoundingClientRect().bottom), next: Math.round(ent.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) }; });
    ok(`50 ${tag} 홈 '전체 비교'는 카드 바로 아래 8px, 다음 덩어리는 24px`, !!hm && hm.under && hm.gap === 8 && hm.next === 24, JSON.stringify(hm));

    // ---------- 내 견적: folds, the open quote ('2회째부터' line), line start
    await go(p, '#cart', 900); await p.waitForSelector('#main .cart-items');
    const ex = p.locator('.cartsum button[aria-expanded="false"]'); if (await ex.count()) { await ex.first().click(); await p.waitForTimeout(600); }
    let qt = null;
    const nq = await p.locator('li.qrow > button.rank').count();
    for (let j = 0; j < Math.min(nq, 30) && !qt; j++) {
      await p.locator('li.qrow > button.rank').nth(j).click(); await p.waitForTimeout(250);
      qt = await p.evaluate(() => { const open = document.querySelector('#main li.qrow.open'); if (!open) return null;
        const ls = [...open.querySelectorAll('.qline')].filter((q) => q.querySelector('.m .lat')); if (!ls.length) return null;
        const head = open.querySelector(':scope > .rank .b') || open.querySelector(':scope > .rank'), card = open.closest('.card');
        return { name: open.querySelector(':scope > .rank').innerText.split('\n')[0], lines: ls.map((q) => { const lat = q.querySelector('.m .lat'), lr = lat.getBoundingClientRect(), src = q.querySelector('.m a.src');
          const others = [...q.querySelectorAll('.m > *')].filter((e) => e !== lat && !e.matches('.qbr, .qmore') && __vis(e) && Math.abs(e.getBoundingClientRect().top - lr.top) < 6).map((e) => e.textContent.trim());
          return { below: !src || src.getBoundingClientRect().bottom <= lr.top + 1, others, left: Math.round(lr.left - q.getBoundingClientRect().left) }; }),
          headX: head.getBoundingClientRect().left - card.getBoundingClientRect().left, lineX: open.querySelector('.qline .row b').getBoundingClientRect().left - card.getBoundingClientRect().left,
          bad: [...open.querySelectorAll('.qline .m')].map((m) => __badOrder(m)).filter(Boolean) }; });
      if (!qt) { await p.locator('li.qrow > button.rank').nth(j).click(); await p.waitForTimeout(150); }
    }
    ok(`34 ${tag} 견적 펼친 줄: '2회째부터'는 출처 아래 자기 줄(첫 가격 글자와 섞이지 않음)`, !!qt && qt.lines.every((l) => l.below && !l.others.length && l.left === 0), qt ? `${qt.name} ${JSON.stringify(qt.lines)}` : '2회째부터 줄을 찾지 못함');
    ok(`52 ${tag} 견적 머리줄과 펼친 줄의 글자 시작선이 같음`, !!qt && Math.abs(qt.headX - qt.lineX) < 0.6, qt ? `머리 ${qt.headX} · 줄 ${qt.lineX}` : '');
    ok(`29 ${tag} 견적 줄 배지 순서`, !!qt && !qt.bad.length, qt ? qt.bad.join(' | ') : '');
    const qb = await p.evaluate(() => { const b = document.querySelector('#main li.qrow.open .qbody .bbtns'); return b ? { mt: getComputedStyle(b).marginTop, inline: b.getAttribute('style') } : null; });
    ok(`35 ${tag} 견적 펼침 끝 버튼 격자: 위 16px(8px 단계, 따로 적은 10px 없음)`, !!qb && qb.mt === '16px' && !qb.inline, JSON.stringify(qb));
    const kf = await folds(p);
    ok(`30 ${tag} 내 견적 접기(관리·고급 설정·자세히·합계 계산 방법): 같은 꺾쇠, 오른쪽 끝`, kf.length >= 4 && !badFolds(kf).length, `${kf.length}개 ${badFolds(kf).join(' | ')}`);
    const chev = await p.evaluate(() => { const c = document.querySelector('#main li.qrow.open > .rank .chev'); if (!c) return null; const af = getComputedStyle(c, '::after'); return { box: af.content === '""' && parseFloat(af.width) === 8, svg: !!c.querySelector('svg') }; });
    ok(`30 ${tag} 견적 머리줄 '접기'도 같은 꺾쇠`, !!chev && chev.box && !chev.svg, JSON.stringify(chev));

    // ---------- 마이
    await go(p, '#me', 900);
    const mf = await folds(p);
    ok(`30 ${tag} 마이 접기(내 설정·데이터 안내·지점 목록): 같은 꺾쇠, 오른쪽 끝`, mf.length >= 3 && !badFolds(mf).length, `${mf.length}개 ${badFolds(mf).join(' | ')}`);
    ok(`${tag} 페이지 오류 없음`, !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // ---------- 디자인 통일 묶음 A (2026-10-20 · U01~U13, docs/DESIGN_SYSTEM.md): one role, one shape — the sources first, then the
  // screens at 390 (and the brand tiles at 320)
  {
    const fs = require('fs'), path = require('path'), ROOT = path.join(__dirname, '..', '..');
    const SRC = ['app.js', 'core.js', 'screens/about.js', 'screens/concern.js', 'screens/map.js'].map((f) => [f, fs.readFileSync(path.join(ROOT, 'app', f), 'utf8')]);
    const hits = (re) => SRC.flatMap(([f, s]) => s.split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => !/^\s*\/\//.test(l) && re.test(l)).map(([f, n, l]) => `${f}:${n} ${l.trim().slice(0, 70)}`));
    const css = fs.readFileSync(path.join(ROOT, 'app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // U01: an empty state is built by emptyBox / emptyLine / jomiEmpty only — no hand-made .empty, no .chartempty, no 'card empty'
    const handEmpty = hits(/class: "(card )?empty"|chartempty|class: "empty", style/).filter((x) => !/const (emptyBox|emptyLine|jomiEmpty) =/.test(x));
    ok('U01 빈 상태는 emptyBox·emptyLine·jomiEmpty로만(손으로 만든 .empty·.chartempty·card empty 없음)', !handEmpty.length && !/\.chartempty/.test(css), handEmpty.slice(0, 3).join(' | '));
    // U02: no range written as 'X원 ~ Y원' / 'X원~Y원' by hand. The range bar's words read aloud ('가격 범위 X원~Y원') belong to the
    // range bar's own work (app/range-dot) and are left to it
    const handRange = hits(/won\([^)]*\)\s*\}?\s*~\s*\$?\{?won\(|" ~ "/).filter((x) => !/const words = `\$\{opts\.name/.test(x));
    ok("U02 범위는 Pricing.rangeText·rangeEl로만('X원 ~ Y원'·'X원~Y원'을 손으로 쓰지 않음)", !handRange.length, handRange.slice(0, 3).join(' | '));
    // U04: no ISO date sliced by hand for a screen, no 'UTC' / toLocaleString time
    const handDate = hits(/toLocaleString\("ko-KR", \{ month|\} UTC`|\.slice\(5\)\.replace\("-", "\/"\)|\.d\.slice\(5\)/);
    ok('U04 날짜는 md·mdhm으로만(손으로 자른 날짜·UTC·toLocaleString 시각 없음)', !handDate.length, handDate.join(' | '));
    // U05: every checkbox charcoal (one rule), no sage accent
    ok('U05 체크박스 색은 규칙 하나(input[type=checkbox] → --primary), 세이지 accent-color 없음', /input\[type="checkbox"\][^{]*\{[^}]*accent-color:\s*var\(--primary\)/.test(css) && !/accent-color:\s*var\(--accent\)/.test(css));
    // U08: no '−' (U+2212 — not in the font subset) or '+N%' for a price move
    const handMove = hits(/"−" : "\+"|\? "−"|\}%`\)\]|\}↓`/);
    ok("U08 가격 방향은 Stats.moveText('▼ 80%')·▼▲로만('−'·'+N%'·'N원↓' 없음)", !handMove.length, handMove.join(' | '));
    // U11: no filled search by an inline background, no search input as a 48px .field
    const handSearch = hits(/class: "search", style: "[^"]*background|type: "search", class: "field"|class: "search" \}, h\("span", \{ html/);
    ok('U11 찾기 칸은 searchBox(.search / .search.inset)로만(인라인 배경·.field 찾기 칸·인라인 svg 없음)', !handSearch.length, handSearch.join(' | '));
    // U12: the 14px-corner spec tile is gone
    ok('U12 규격 칩 .vchip 없음(쉬운 보기 = .chip, 자세히 = .opt)', !hits(/"vchip"/).length && !/\.vchip\b/.test(css));

    const { ctx, p, errs } = await page({ width: 390, height: 844 });
    const reload = async () => { await p.reload(); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 }); };
    // the shape of every empty state on the screen: box (icon circle + title + sentence), line (one grey line), or 죠미
    const empties = () => p.evaluate(() => [...document.querySelectorAll('#main .empty')].filter(__vis).map((e) => {
      const ei = e.querySelector(':scope > .ei > svg'), b = e.querySelector(':scope > b'), img = e.querySelector(':scope > img.portrait');
      const kind = e.classList.contains('one') ? 'line' : e.classList.contains('jomi-empty') ? 'jomi' : 'box';
      const ok = kind === 'line' ? !ei && !b && !img && e.children.length === 0 && parseFloat(getComputedStyle(e).fontSize) === 15
        : kind === 'jomi' ? !!img && !ei && !!b : !!ei && !!b && !img && getComputedStyle(e.querySelector('.ei')).borderRadius === '50%';
      return { kind, ok, t: e.textContent.trim().slice(0, 24) }; }));
    // 관심 with nothing in it: 가격 알림 and 관심 지점 are boxes, 알림 기록 (a list under its own title) a line, no 죠미 (the screen is not empty)
    await p.evaluate(() => { for (const k of ['favs', 'alerts', 'notes', 'recent']) localStorage.removeItem('pc:' + k); }); await reload();
    await go(p, '#saved', 1200);
    const sv = await empties();
    ok('U01 관심 빈 화면: 카드는 상자(아이콘 원·제목·문장), 알림 기록은 한 줄, 죠미 없음, 회색 sub 문장 없음', sv.length >= 3 && sv.every((x) => x.ok) && sv.filter((x) => x.kind === 'box').length >= 2
      && sv.some((x) => x.kind === 'line' && /기록이 없어요/.test(x.t)) && !sv.some((x) => x.kind === 'jomi') && !(await p.locator('#main .card p.sub', { hasText: /하트를 누르면|기록이 없어요/ }).count()), JSON.stringify(sv));
    // the whole screen empty: 죠미 (빈 내 견적, 검색 결과 없음); 마이 '받은 시술 기록' a box
    await p.evaluate(() => { localStorage.setItem('pc:carts', JSON.stringify([{ id: 'e', name: '내 견적', items: [] }])); localStorage.setItem('pc:ci', '0'); }); await reload();
    await go(p, '#cart', 1200); const ce = await empties();
    await go(p, '#search/' + encodeURIComponent('없는시술zzz'), 1500); const se2 = await empties();
    await go(p, '#me', 1000); const me = await empties();
    ok('U01 화면 전체가 빌 때만 죠미(빈 내 견적·검색 결과 없음), 마이 기록은 상자', ce.length === 1 && ce[0].kind === 'jomi' && ce[0].ok && se2.length === 1 && se2[0].kind === 'jomi' && se2[0].ok && me.some((x) => x.kind === 'box') && me.every((x) => x.ok),
      JSON.stringify([ce, se2, me]));
    await p.evaluate((items) => { localStorage.setItem('pc:carts', JSON.stringify([{ id: 's', name: '모양 시험', items }])); localStorage.setItem('pc:favs', JSON.stringify({ k: ['X01'], b: [] })); }, CART); await reload();
    // a filtered list with no line: one line (가격 변동 search with nothing matching)
    await go(p, '#change', 1200); await p.fill('#main input[type=search]', '없는시술zzz'); await p.waitForTimeout(300);
    const ch0 = await empties();
    ok('U01 걸러서 줄이 없으면 한 줄(가격 변동 찾기)', ch0.length === 1 && ch0[0].kind === 'line' && ch0[0].ok, JSON.stringify(ch0));

    // U02 · U03: a range is the same words everywhere — the compare card's 28 too, 만 when both ends are 10만 or more; 내 견적 in won
    const RANGE = /^[\d,.]+만?~[\d,.]+만?원$/, BAD = /[\d,]원\s*~\s*[\d,.]+/;
    await go(p, '#compare?k=X14', 1300);
    const r14 = await p.evaluate(() => { const hp = document.querySelector('.pricecard .hero .hp'); return { t: hp.textContent.trim(), fs: getComputedStyle(hp).fontSize, nw: hp.querySelectorAll('.nw').length }; });
    await go(p, '#compare?k=X01', 1300);
    const r01 = await p.evaluate(() => document.querySelector('.pricecard .hero .hp').textContent.trim());
    ok('U02 비교 가격 카드 28: 다른 범위와 같은 글자(10만 이상 양 끝은 만, 아니면 원 — 띄어쓰기 없이 끝에 원 한 번)', r14.fs === '28px' && /^[\d.]+만~[\d.]+만원$/.test(r14.t) && r14.nw === 2 && /^[\d,]+~[\d,]+원$/.test(r01), `${r14.t} (${r14.fs}) · ${r01}`);
    await p.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; }); await p.waitForTimeout(600);
    const bt = await p.evaluate(() => [...document.querySelectorAll('#main .bcard .tile b.num')].map((b) => ({ t: b.textContent.trim(), ends: b.querySelectorAll('.nw').length,
      split: [...b.querySelectorAll('.nw')].some((s) => new Set([...s.getClientRects()].map((r) => Math.round(r.top))).size > 1) })));
    ok('U03 브랜드별 비교 칸: 범위는 rangeEl — 끝마다 한 줄, \'~\'에서만 줄바꿈(390)', bt.length >= 3 && bt.every((x) => RANGE.test(x.t) || /^[\d,]+원$/.test(x.t)) && bt.every((x) => x.ends === 2 || /^[\d,]+원$/.test(x.t)) && !bt.some((x) => x.split), JSON.stringify(bt.slice(0, 3)));
    await go(p, '#saved', 1200);
    const svT = await p.locator('#main').innerText();
    await go(p, '#cart', 1200);
    const ct = await p.evaluate(() => ({ hp: (document.querySelector('.cartsum .hp') || {}).textContent, tl: (document.querySelector('.totline b') || {}).textContent, bar: (document.querySelector('.cartbar .cb-t b') || {}).textContent }));
    ok('U02 내 견적: 요약 카드 28 = 예상 총액 줄 = 아래 고정 요약, 양 끝 원(한 모양)', /^[\d,]+~[\d,]+원$/.test(ct.hp) && ct.hp === ct.tl && ct.hp === ct.bar, JSON.stringify(ct));
    ok('U02 관심 시술 가격 줄도 같은 범위 글자(\'중간값 · X원 ~ Y원\' 없음)', !BAD.test(svT) && /[\d,.]+만?~[\d,.]+만?원/.test(svT), svT.split('\n').filter((l) => /~/.test(l)).slice(0, 2).join(' / '));

    // U04: dates are 'M/D', the data's date word is 수집, a time Korea time 'M/D HH:MM'; nothing ISO on these screens
    // (a data version id '2026-10-19.7498fa52' is a name, not a date; a quoted clinic sentence (“…”) is the clinic's words)
    const ISO = /\b20\d\d-\d\d-\d\d\b(?!\.[0-9a-f])/;
    const dates = {};
    for (const [hash, k] of [['#explore', '탐색'], ['#compare?k=X12', '비교'], ['#saved', '관심'], ['#change', '가격 변동'], ['#about', '데이터 안내'], ['#me', '마이']]) {
      await go(p, hash, 1300); await p.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; }); await p.waitForTimeout(300);
      dates[k] = (await p.evaluate(() => document.querySelector('#main').innerText)).replace(/“[^”]*”/g, ''); }
    const bi0 = await p.evaluate(() => { const { D } = App.state(); const x = D.branches.findIndex((y) => D.s[y[1]] === '강남역점'); return x >= 0 ? x : 0; });
    await go(p, `#branch/${bi0}`, 1300); dates['지점'] = await p.evaluate(() => document.querySelector('#main').innerText.slice(0, 4000));
    const badDates = Object.entries(dates).filter(([, t]) => ISO.test(t) || /UTC|오전 \d|오후 \d|\d{1,2}\/\d{1,2} 기준|데이터 \d|\d 모음/.test(t)).map(([k, t]) => `${k}: ${(t.match(ISO) || t.match(/UTC|오전 \d|오후 \d|\d{1,2}\/\d{1,2} 기준|데이터 \d|\d 모음/))[0]}`);
    const upd = await p.locator('#upd').innerText();
    ok('U04 날짜는 M/D, 데이터 날짜는 \'수집\', 확인일은 \'확인 M/D\', 시각은 한국 시간(ISO·UTC·오전/오후 없음)', !badDates.length && /^\d{1,2}\/\d{1,2} 수집 · \d+곳$/.test(upd)
      && /\d{1,2}\/\d{1,2} \d\d:\d\d/.test(dates['데이터 안내']) && /확인 \d{1,2}\/\d{1,2}/.test(dates['관심']) && /\d{1,2}\/\d{1,2} \(\d+일 전\)|\d{1,2}\/\d{1,2} \(오늘\)/.test(dates['지점']), `${upd} · ${badDates.join(' | ')}`);

    // U05: the alert sheet's checkboxes are charcoal like the chosen tile above them
    await go(p, '#compare?k=X12', 1300);
    await p.locator('#main .morebtn').first().click(); await p.waitForTimeout(500);
    await p.locator('.sheet button', { hasText: /알림/ }).first().click(); await p.waitForTimeout(700);
    const cb = await p.evaluate(() => { const s = [...document.querySelectorAll('.sheet')].pop(), prim = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(), v = parseInt(prim.replace('#', ''), 16);
      const want = `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`; const xs = [...s.querySelectorAll('input[type=checkbox]')];
      return { n: xs.length, colours: [...new Set(xs.map((x) => getComputedStyle(x).accentColor))], want, tile: getComputedStyle(s.querySelector('.opt[aria-pressed=true]')).backgroundColor }; });
    ok('U05 가격 알림 창: 체크박스 6개 모두 차콜(고른 타일과 같은 색)', cb.n >= 6 && cb.colours.length === 1 && cb.colours[0] === cb.want && cb.tile === cb.want, JSON.stringify(cb));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.keyboard.press('Escape'); await p.waitForTimeout(300);

    // U08: a price move is '▼ N%' / '▲ N%' on 홈 and 가격 변동 alike; A/B says the cheaper side with ▼; no '−' (U+2212)
    const MOVE = /^[▼▲] \d+(\.\d)?%$|^0%$/;
    await go(p, '#home', 1500);
    const hmv = await p.evaluate(() => [...document.querySelectorAll('#main .card.flush .item .m > span.down, #main .card.flush .item .m > span.up')].map((x) => x.textContent.trim()));
    await go(p, '#change', 1300);
    const cmv = await p.evaluate(() => [...document.querySelectorAll('#main .card.flush ul.list .item .m > span.down, #main .card.flush ul.list .item .m > span.up')].slice(0, 40).map((x) => x.textContent.trim()));
    const cmt = await p.evaluate(() => document.querySelector('#main').innerText);
    await go(p, `#versus/${bi0}/${bi0 + 1}`, 1500);
    const vs = await p.evaluate(() => [...document.querySelectorAll('#main .card.flush ul.list .item > .p')].slice(0, 40).map((x) => x.textContent.trim()));
    ok('U08 가격 방향 한 모양: 홈·가격 변동 \'▼ 80%\'·\'▲ 124%\', A/B \'A ▼ N원\', \'−\'·\'↓\' 없음', (!hmv.length || hmv.every((t) => MOVE.test(t))) && cmv.length > 0 && cmv.every((t) => MOVE.test(t)) && !/−/.test(cmt)
      && vs.length > 0 && vs.every((t) => /^(A|B) ▼ [\d,]+원$|^같음$/.test(t)), `${hmv.slice(0, 2)} · ${cmv.slice(0, 3)} · ${vs.slice(0, 3)}`);

    // U09: a grey action button has its edge; a grey badge (~10/31까지) has none
    await go(p, `#branch/${bi0}`, 1300);
    const gb = await p.evaluate(() => { const L = (c) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map((x) => +x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const btns = [...document.querySelectorAll('#main .bbtns > .btn.gray:not([aria-pressed="true"])')].filter(__vis), k = [...document.querySelectorAll('#main .k.k4')].filter(__vis)[0];
      const edge = (e) => { const m = /inset 0px 0px 0px 1px|rgb[^)]*\) 0px 0px 0px 1px inset/.test(getComputedStyle(e).boxShadow) ? (getComputedStyle(e).boxShadow.match(/rgba?\([^)]*\)/) || [''])[0] : null; return m; };
      return { n: btns.length, edges: btns.map((b) => !!edge(b)), contrast: btns[0] && edge(btns[0]) ? ratio(edge(btns[0]), getComputedStyle(btns[0]).backgroundColor).toFixed(2) : null, badge: k ? getComputedStyle(k).boxShadow : null, badgeBg: k && getComputedStyle(k).backgroundColor === (btns[0] && getComputedStyle(btns[0]).backgroundColor) }; });
    ok('U09 회색 동작 버튼: 1px 안쪽 테두리(바탕과 1.4:1 이상), 같은 바탕의 회색 배지는 테두리 없음', gb.n >= 4 && gb.edges.every(Boolean) && +gb.contrast >= 1.4 && gb.badge === 'none' && gb.badgeBg, JSON.stringify(gb));

    // U10: a text link that takes you to another screen is 'words ›'; one that opens a sheet or moves here is 'icon words'.
    // Read from what it does: tap each, see whether the address changed or a sheet opened
    // a link named by the place it opens (a variant's or a branch's own name) carries no mark: it must go somewhere
    const linkShape = (sel, i) => p.evaluate(([sel, i]) => { const l = [...document.querySelectorAll(sel)].filter(__vis)[i]; if (!l) return null;
      const nodes = [...l.childNodes].filter((n) => n.nodeType === 1 || n.textContent.trim()), svg = (n) => !!n && n.nodeName === 'svg';
      const chev = (s) => svg(s) && !!s.querySelector('path[d="m9 18 6-6-6-6"]'), first = nodes[0], last = nodes[nodes.length - 1];
      return { t: l.textContent.trim(), lead: svg(first) && !chev(first), trail: chev(last) && nodes.length > 1, bare: !l.querySelector('svg') }; }, [sel, i]);
    const lk = [];
    for (const [hash, sel, open] of [['#compare?k=X01', '#main .pricecard .linkbtn', false], ['#compare?k=X01', '#main details.cmpfold .linkbtn:not(.src)', true], ['#home', '#main p.foot .linkbtn', false]]) {
      await go(p, hash, 1300); if (open) { await p.evaluate(() => { for (const d of document.querySelectorAll('#main details.cmpfold')) d.open = true; }); await p.waitForTimeout(400); }
      const n = await p.evaluate((sel) => [...document.querySelectorAll(sel)].filter(__vis).length, sel);
      for (let i = 0; i < Math.min(n, 8); i++) {
        await go(p, hash, 1100); if (open) { await p.evaluate(() => { for (const d of document.querySelectorAll('#main details.cmpfold')) d.open = true; }); await p.waitForTimeout(300); }
        const s = await linkShape(sel, i); if (!s) continue;
        const before = await p.evaluate(() => ({ h: location.hash, sheets: document.querySelectorAll('.sheet').length }));
        await p.evaluate(([sel, i]) => [...document.querySelectorAll(sel)].filter(__vis)[i].click(), [sel, i]); await p.waitForTimeout(500);
        const after = await p.evaluate(() => ({ h: location.hash, sheets: document.querySelectorAll('.sheet').length }));
        const goes = after.h !== before.h && after.sheets <= before.sheets;
        lk.push({ ...s, goes, ok: s.bare ? goes : goes ? s.trail && !s.lead : s.lead && !s.trail });
        await p.keyboard.press('Escape'); await p.waitForTimeout(250);
      }
    }
    ok('U10 글자 링크: 다른 화면으로 가면 \'글자 ›\', 창을 열거나 이 화면 안이면 \'아이콘 글자\'(꺾쇠 없음), 이름 링크는 표시 없이 이동', lk.length >= 6 && lk.every((x) => x.ok)
      && lk.some((x) => x.goes && x.trail) && lk.some((x) => !x.goes && x.lead),
      JSON.stringify(lk.filter((x) => !x.ok).concat(lk.slice(0, 2)).map((x) => [x.t, x.goes, x.lead, x.trail])));

    // U11: every search field has the magnifier, 57px and the 18 corner; the app's own search is white, a screen's own list filled
    const fields = [];
    for (const [hash, own] of [['#home', true], ['#explore', true], ['#search/' + encodeURIComponent('보톡스'), true], ['#change', false], ['#table', false], [`#branch/${bi0}`, false],
      [`#versus/${bi0}/${bi0 + 1}`, false], ['#terms', false], ['#guide', false], ['#map', false], ['#compare?k=X01', false]]) {
      await go(p, hash, hash === '#map' ? 2200 : 1300);
      if (hash.startsWith('#compare')) { await p.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; }); await p.waitForTimeout(300); }
      fields.push(...await p.evaluate(([hash, own]) => [...document.querySelectorAll('#main input[type=search]')].filter(__vis).map((inp) => { const box = inp.closest('.search');
        if (!box) return { hash, ok: false, why: 'no .search', l: inp.getAttribute('aria-label') };
        const r = box.getBoundingClientRect(), cs = getComputedStyle(box), root = getComputedStyle(document.documentElement), tok = (n) => { const v = parseInt(root.getPropertyValue(n).trim().replace('#', ''), 16); return `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`; };
        const mag = !!box.firstElementChild && box.firstElementChild.nodeName === 'svg' && !!box.firstElementChild.querySelector('circle[r="8"]');
        const inset = box.classList.contains('inset');
        return { hash, l: inp.getAttribute('aria-label'), ok: mag && r.height >= 56 && r.height <= 60 && cs.borderTopLeftRadius === '18px' && !box.getAttribute('style')?.includes('background') && (own ? !inset && cs.backgroundColor === tok('--surface') : inset && cs.backgroundColor === tok('--fill')),
          h: Math.round(r.height), mag, inset }; }), [hash, own]));
    }
    ok('U11 찾기 칸 한 모양: 돋보기·같은 높이·반경 18, 앱 검색은 흰 바탕, 화면 안 목록 찾기는 채움(.search.inset)', fields.length >= 11 && fields.every((x) => x.ok) && new Set(fields.map((x) => x.h)).size === 1, JSON.stringify(fields.filter((x) => !x.ok).slice(0, 3)) + ` · ${fields.length}칸 · 높이 ${[...new Set(fields.map((x) => x.h))]}`);

    // U12: 쉬운 보기's spec chips are the app's chip (pill 13/600, chosen charcoal), like the 분야 chips under them
    await go(p, '#compare?k=X01', 1300); await p.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; }); await p.waitForTimeout(500);
    const chs = await p.evaluate(() => { const st = (e) => { const c = getComputedStyle(e); return `${c.borderTopLeftRadius}/${c.fontSize}/${c.fontWeight}/${c.minHeight}`; };
      const spec = [...document.querySelectorAll('#cmppick .vstep button')], cat = document.querySelector('#cmppick details.cmpother > .chips > .chip:not([aria-pressed=true])');
      const on = spec.find((x) => x.getAttribute('aria-checked') === 'true');
      return { n: spec.length, allChip: spec.every((x) => x.classList.contains('chip')), looks: [...new Set(spec.filter((x) => x.getAttribute('aria-checked') !== 'true').map(st))], cat: cat ? st(cat) : null,
        on: on ? getComputedStyle(on).backgroundColor : null, ink: getComputedStyle(document.querySelector('#cmppick details.cmpother > .chips > .chip[aria-pressed=true]') || document.body).backgroundColor }; });
    ok('U12 규격 칩(쉬운 보기) = 분야 칩: 알약·13/600, 고른 것은 같은 차콜', chs.n >= 2 && chs.allChip && chs.looks.length === 1 && chs.looks[0] === chs.cat && chs.on === chs.ink, JSON.stringify(chs));
    await p.evaluate(() => { const b = [...document.querySelectorAll('#cmppick .seg button')].find((x) => /자세히/.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(700);
    const det = await p.evaluate(() => ({ opt: document.querySelectorAll('#cmppick .vrows .opt').length, two: [...document.querySelectorAll('#cmppick .vrows .opt')].slice(0, 3).every((o) => o.children.length === 2) }));
    ok('U12 자세히(둘째 줄 가격)는 옵션 타일(.opt)', det.opt >= 2 && det.two, JSON.stringify(det));
    await p.evaluate(() => { const b = [...document.querySelectorAll('#cmppick .seg button')].find((x) => /쉬운 보기/.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(400);

    // U13: 비교함 담기 has the toast every 담기 has — 죠미, a fixed first line with the count, a second line, 되돌리기 (빠른 비교 from two)
    await p.evaluate(() => localStorage.removeItem('pc:short'));
    await go(p, '#compare?k=X12', 1300);
    await p.evaluate(() => { const b = [...document.querySelectorAll('#main .seg.vsw button')].find((x) => /카드/.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(800);
    const tst = () => p.evaluate(() => { const t = document.querySelector('#toast'), tm = t.querySelector('.tm'), ts = t.querySelector('.ts'), b = t.querySelector('button'), tt = t.querySelector('.tt');
      return { jt: t.classList.contains('jt'), face: !!t.querySelector('img.mascot'), tm: tm && tm.textContent, tt: tt && tt.textContent, cut: !!tm && tm.scrollWidth > tm.clientWidth + 1, ts: ts && ts.textContent, btn: b && b.textContent }; });
    await p.evaluate(() => { const b = [...document.querySelectorAll('#main .ccard .shortbtn')][0]; b.scrollIntoView({ block: 'center' }); b.click(); }); await p.waitForTimeout(300);
    const t1 = await tst();
    await p.locator('#toast button', { hasText: '되돌리기' }).click(); await p.waitForTimeout(300);
    const undone = await p.evaluate(() => JSON.parse(localStorage.getItem('pc:short') || '[]').length);
    await go(p, '#compare?k=X12', 1300);
    await p.evaluate(() => { for (const b of [...document.querySelectorAll('#main .ccard .shortbtn')].slice(0, 2)) b.click(); }); await p.waitForTimeout(300);
    const t2 = await tst();
    await go(p, '#home', 1300); await p.evaluate(() => { scrollTo(0, 0); document.querySelector('#main .pwrap > .addbtn:not([aria-pressed="true"])').click(); }); await p.waitForTimeout(300);   // a card not in the cart: one tap puts it in
    const t3 = await tst();
    ok('U13 비교함 담기 알림 = 내 견적 담기 알림: 죠미·고정 첫 줄(n/4)·둘째 줄·되돌리기(2곳부터 빠른 비교), 잘림 없음',
      t1.jt && t1.face && t1.tm === '비교함에 담았어요 (1/4)' && !t1.cut && !!t1.ts && t1.btn === '되돌리기' && undone === 0 && t2.tm === '비교함에 담았어요 (2/4)' && t2.btn === '빠른 비교'
      && t3.jt && t3.face && /^내 견적에 담았어요/.test(t3.tm) && !!t3.ts && t3.btn === '되돌리기', JSON.stringify([t1, t2, t3]));
    await p.evaluate(() => { localStorage.removeItem('pc:short'); localStorage.setItem('pc:jomiPrefs', JSON.stringify({ freq: 'off' })); }); await reload();
    await go(p, '#compare?k=X12', 1300);
    await p.evaluate(() => { const b = [...document.querySelectorAll('#main .seg.vsw button')].find((x) => /카드/.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(800);
    await p.evaluate(() => { const b = [...document.querySelectorAll('#main .ccard .shortbtn')][0]; b.scrollIntoView({ block: 'center' }); b.click(); }); await p.waitForTimeout(300);
    const t4 = await tst();
    ok('U13 죠미 \'끄기\': 첫 줄만(얼굴·둘째 줄 없음)', t4.jt && !t4.face && t4.tt === '비교함에 담았어요 (1/4)' && !t4.ts && t4.btn === '되돌리기', JSON.stringify(t4));
    ok('U01~U13 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close();

    // U03 at 320: the brand tiles break only at '~'
    const n3 = await page({ width: 320, height: 640 });
    await go(n3.p, '#compare?k=X01', 1500); await n3.p.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; }); await n3.p.waitForTimeout(600);
    const bt3 = await n3.p.evaluate(() => [...document.querySelectorAll('#main .bcard .tile b.num')].map((b) => ({ t: b.textContent.trim(), split: [...b.querySelectorAll('.nw')].some((s) => new Set([...s.getClientRects()].map((r) => Math.round(r.top))).size > 1),
      over: b.scrollWidth > b.clientWidth + 1 })));
    ok('U03 320 브랜드별 비교 칸: 숫자 중간에서 줄이 바뀌지 않음, 넘침 없음', bt3.length >= 3 && !bt3.some((x) => x.split || x.over), JSON.stringify(bt3.filter((x) => x.split || x.over).slice(0, 3)));
    await n3.ctx.close();
  }

  // ---------- 디자인 통일 묶음 B (2026-10-20 · U06 U14 U15 U16 U17, docs/DESIGN_SYSTEM.md §3): card heads, price lines, a
  // treatment's numbers, the heads of the screens outside the tabs, '전체 보기' — the sources first, then the screens
  {
    const fs = require('fs'), path = require('path'), ROOT = path.join(__dirname, '..', '..');
    const SRC = ['app.js', 'core.js', 'screens/about.js', 'screens/concern.js', 'screens/map.js'].map((f) => [f, fs.readFileSync(path.join(ROOT, 'app', f), 'utf8')]);
    const hits = (re) => SRC.flatMap(([f, s]) => s.split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => !/^\s*\/\//.test(l) && re.test(l)).map(([f, n, l]) => `${f}:${n} ${l.trim().slice(0, 70)}`));
    // U06: no count written into a card title, no card title said again on the right (용량·종류 바꾸기 · k.label)
    const countTitle = hits(/h\("h3", \{[^}]*\}, `[^`]*\$\{[^}]+\}\s*(개|곳|가지)[^`]*`\)/);
    ok('U06 카드 제목 안에 개수 없음(개수는 cardHead의 오른쪽 메타)', !countTitle.length, countTitle.join(' | '));
    // U15: a treatment's numbers in one order — no 'N곳 · lo~hi원' / '중간 가격 · N곳' / 'N곳 · 중간 X원' written by hand, in the
    // words of #153 ('중간 X원' on a narrow line, '중간 가격 X원' in a sentence) or the old '중간값' (the 가격 종류별·지역별 line,
    // axisLine, is kept by range_shape.js and left as it is)
    const badOrder = hits(/곳 · \$\{Pricing\.rangeText|`중간(값| 가격)? · \$\{|곳 · 중간(값| 가격)? \$\{/).filter((x) => !/kids: \[h\("div", \{ class: "row" \}, h\("b", \{\}, name\)/.test(x));
    ok("U15 시술 숫자는 한 순서('lo~hi원 · 중간 X원 · N곳'), 'N곳 · 범위'·'중간 가격 · N곳' 없음", !badOrder.length, badOrder.join(' | '));
    // U17: no outlined button that leads to another screen's whole list
    ok("U17 '전체 보기'는 .morelist 한 모양(테두리 버튼 .btn.line.block.hall 없음)", !hits(/btn line block hall/).length);

    const { ctx, p, errs } = await page({ width: 390, height: 844 });
    await p.evaluate(() => { localStorage.setItem('pc:favs', JSON.stringify({ k: ['X01'], b: [] })); localStorage.setItem('pc:alerts', '[]'); });
    await p.reload(); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
    const bi = await p.evaluate(() => { const { D } = App.state(); const x = D.branches.findIndex((y) => D.s[y[1]] === '강남역점'); return x >= 0 ? x : 0; });
    const COUNT = /^\d[\d,]*(곳|개|가지|개 브랜드|개 지역)$|^\d+\/\d+$/;
    // every card head on a screen: h3 17 · count 13 grey on the same line, right of the title · basis 13 under the title
    const heads = () => p.evaluate(() => [...document.querySelectorAll('#main .chead')].filter(__vis).map((c) => {
      const t = c.querySelector(':scope > .row > h3'), m = c.querySelector(':scope > .row > .cmeta'), d = c.querySelector(':scope > .cdesc'), cs = (e) => e && getComputedStyle(e);
      const tr = t.getBoundingClientRect(), mr = m && m.getBoundingClientRect();
      return { t: t.textContent, ts: cs(t).fontSize, m: m ? m.textContent : null, ms: m ? cs(m).fontSize : null, mc: m ? cs(m).color : null,
        right: !m || (mr.left >= tr.right && Math.abs((mr.top + mr.bottom) / 2 - (tr.top + tr.bottom) / 2) < 12), d: d ? d.textContent : null, ds: d ? cs(d).fontSize : null,
        under: !d || d.getBoundingClientRect().top >= tr.bottom - 1, muted: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() }; }));
    const seen = {};
    await go(p, '#compare?k=X12', 1500); await p.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; }); await p.waitForTimeout(700);
    seen['비교'] = await heads();
    await go(p, `#branch/${bi}`, 1300); seen['지점'] = await heads();
    await go(p, '#cart', 1300); await p.locator('#main button', { hasText: '병원별 비교 보기' }).first().click().catch(() => {}); await p.waitForTimeout(800);
    seen['내 견적'] = await heads();
    await go(p, '#saved', 1300); seen['관심'] = await heads();
    await go(p, '#search/' + encodeURIComponent('리쥬란 2cc'), 1500); seen['검색'] = await heads();
    await go(p, '#map', 2600); seen['지도'] = await heads();
    const all = Object.values(seen).flat(), titles = all.map((x) => x.t);
    const need = ['병원별 가격 분포', '가격 종류별 범위', '지역별 가격', '브랜드별 비교', '지점별 가격', '용량·종류 바꾸기', '가격표', '담은 시술', '방문 계획 비교', '모두 받을 수 있는 곳', '가격 알림', '관심 시술 가격', '관심 지점', '용량·종류별 가격 비교', '지도에 보이는 지점'];
    const missing = need.filter((t) => !titles.includes(t));
    const badHead = all.filter((x) => x.ts !== '17px' || /\d+\s*(곳|개|가지)/.test(x.t) || (x.m != null && (!COUNT.test(x.m) || x.ms !== '13px' || !x.right)) || (x.d != null && (x.ds !== '13px' || !x.under || /\d+(곳|개)(?![가-힣])/.test(x.d))));
    ok('U06 카드 머리 한 틀: 제목 17(개수 없음) · 오른쪽 메타 13 = 개수 · 제목 아래 설명 13 = 기준(비교 접기·지점별 가격·용량·종류 바꾸기·가격표·내 견적·관심·검색·지도)',
      !missing.length && !badHead.length && all.length >= need.length, `없음 ${missing.join(',')} · 어긋남 ${badHead.slice(0, 3).map((x) => JSON.stringify(x)).join(' | ')}`);
    const fold = seen['비교'].filter((x) => ['병원별 가격 분포', '가격 종류별 범위', '지역별 가격', '브랜드별 비교'].includes(x.t));
    ok('U06 비교 접기 네 카드: 모두 오른쪽 메타 = 개수, 아래 설명 = 기준', fold.length === 4 && fold.every((x) => x.m && COUNT.test(x.m) && x.d), JSON.stringify(fold.map((x) => [x.t, x.m, (x.d || '').slice(0, 16)])));
    const pick = seen['비교'].find((x) => x.t === '용량·종류 바꾸기');
    ok('U06 용량·종류 바꾸기: 오른쪽에 시술 이름을 다시 쓰지 않음', !!pick && pick.m == null, JSON.stringify(pick));

    // U14: a price line is one frame — name 15/600 · price 15/760 on line 1, the grey words on line 2, the badges on a line of
    // their own (비교 줄 · 검색 줄 included), the quote's item name 600 too
    await go(p, '#compare?k=X01', 1500);
    const rowShape = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].filter(__vis).slice(0, 30).map((li) => {
      const m = li.querySelector('.m'), ks = [...m.querySelectorAll(':scope > .k')].filter(__vis), words = [...m.childNodes].filter((n) => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && !n.matches('.k, .mbr, svg') && __vis(n)));
      if (!ks.length || !words.length) return null;
      const rg = document.createRange(); const wb = Math.max(...words.map((n) => { if (n.nodeType === 3) { rg.selectNodeContents(n); return rg.getBoundingClientRect().bottom; } return n.getBoundingClientRect().bottom; }));
      const kt = Math.min(...ks.map((k) => k.getBoundingClientRect().top));
      return { own: kt >= wb - 1, after: !!m.querySelector(':scope > .mbr') && ks.every((k) => m.querySelector(':scope > .mbr').compareDocumentPosition(k) & 4), t: li.textContent.slice(0, 24) }; }).filter(Boolean), sel);
    const cmpRows = await rowShape('#clinics li.rk');
    const fontsOf = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].filter(__vis).slice(0, 5).map((e) => `${getComputedStyle(e).fontSize}/${getComputedStyle(e).fontWeight}`), sel);
    const cmpName = await fontsOf('#clinics li.rk .rank .b'), cmpP = await fontsOf('#clinics li.rk .rank .p');
    await go(p, '#search/' + encodeURIComponent('보톡스') + '?sort=price', 1800);
    const srRows = await rowShape('#main .results li.rk');
    const srName = await fontsOf('#main .results li.rk .item .t'), srP = await fontsOf('#main .results li.rk .item .p');
    await go(p, '#cart', 1300); const cn = await fontsOf('#main .ci .cn');
    ok('U14 비교 줄·검색 줄: 배지는 회색 글자 줄 아래 자기 줄', cmpRows.length >= 3 && srRows.length >= 3 && [...cmpRows, ...srRows].every((x) => x.own && x.after),
      `비교 ${cmpRows.length}줄 · 검색 ${srRows.length}줄 ${[...cmpRows, ...srRows].filter((x) => !x.own || !x.after).slice(0, 2).map((x) => x.t).join(' | ')}`);
    ok('U14 가격 줄 글자: 이름 15/600 · 가격 15/760(비교·검색), 견적 담은 시술 이름도 600', [...cmpName, ...srName].every((x) => x === '15px/600') && [...cmpP, ...srP].every((x) => x === '15px/760') && cn.length >= 3 && cn.every((x) => x === '15px/600'),
      `${cmpName[0]} ${cmpP[0]} · ${srName[0]} ${srP[0]} · 견적 ${cn.join(',')}`);

    // U15: one order for a treatment's numbers, and the numbers of the comparison it opens (keyNums)
    const RNG = '[\\d,.]+만?~[\\d,.]+만?원|[\\d,]+원';
    await go(p, '#home', 1500);
    const card = await p.evaluate(() => { const c = document.querySelector('#main .grid .pc'), sh = [...document.querySelectorAll('#main .sec-h')].find((x) => /인기 시술/.test(x.textContent));
      return { pk: c.querySelector('.pk') ? c.querySelector('.pk').textContent : null, p: c.querySelector('.p').textContent, save: c.querySelector('.save').textContent, head: sh ? sh.textContent : '',
        labels: [...document.querySelectorAll('#main .grid .pc')].filter((x) => /중간/.test(x.textContent)).length }; });
    const disc = await p.evaluate(() => { const m = document.querySelector('#main .disc-row .m'); return m ? [...m.children].map((x) => x.textContent).join(' · ') : null; });
    await p.locator('#main .grid .pc').first().click(); await p.waitForTimeout(1300);
    const hd = await p.evaluate(() => ({ med: document.querySelector('.cmphead .hmed').textContent.replace(/\D/g, ''), n: (/(\d+)곳/.exec(document.querySelector('.cmphead .basis').textContent) || [])[1],
      hp: document.querySelector('.pricecard .hero .hp').textContent.trim() }));
    // the words #153's: '중간 가격' once beside the section title, no label on each of the six cards
    ok("U15 홈 인기 카드: 가격 · 'lo~hi원 · N곳'(비교 머리글·가격 카드와 같은 숫자), '중간 가격'은 구역 제목 옆에 한 번", card.pk == null && !card.labels && /중간 가격/.test(card.head) && new RegExp(`^(${RNG}) · \\d+곳$|^모두 같은 가격 · \\d+곳$`).test(card.save)
      && card.p.replace(/\D/g, '') === hd.med && card.save.endsWith(` · ${hd.n}곳`) && (card.save.startsWith('모두') || card.save.split(' · ')[0] === hd.hp), `${JSON.stringify(card)} → ${JSON.stringify(hd)}`);
    ok("U15 홈 발견 줄: 'lo~hi원 · 중간 X원 · N곳'(기준 순서)", !disc || new RegExp(`^(${RNG}) · 중간 [\\d,]+원 · \\d+곳$`).test(disc), disc);
    await go(p, '#compare?k=X01', 1300);
    const x01 = await p.evaluate(() => ({ hp: document.querySelector('.pricecard .hero .hp').textContent.trim(), n: (/(\d+)곳/.exec(document.querySelector('.cmphead .basis').textContent) || [])[1],
      med: document.querySelector('.cmphead .hmed').textContent.replace(/\D/g, '') }));
    await go(p, '#saved', 1300);
    const sv = await p.evaluate(() => { const it = document.querySelector('#main section[aria-label="관심 시술 가격"] li .item'); return it ? { p: it.querySelector('.p').textContent.replace(/\D/g, ''), m: it.querySelector('.m > span').textContent } : null; });
    ok("U15 관심 시술 줄: 가격 = 중간 가격, 'lo~hi원 · N곳'(이름표 없음) = 비교 화면의 숫자", !!sv && sv.p === x01.med && sv.m === `${x01.hp} · ${x01.n}곳`, `${JSON.stringify(sv)} ↔ ${JSON.stringify(x01)}`);
    await go(p, '#search/' + encodeURIComponent('리쥬란 2cc'), 1500);
    const kr = await p.evaluate(() => [...document.querySelectorAll('#main .card.keys li .item .m')].map((m) => m.firstElementChild.textContent));
    ok("U15 검색 바로가기 줄: 숫자 먼저 'lo~hi원 · N곳', 분야는 그 뒤", kr.length > 0 && kr.every((t) => new RegExp(`^(${RNG}) · \\d+곳$|^모두 같은 가격 · \\d+곳$|^\\d+곳$`).test(t)), kr.slice(0, 3).join(' / '));
    await go(p, '#compare?k=X12', 1300); await p.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; }); await p.waitForTimeout(500);
    const bt = await p.evaluate(() => [...document.querySelectorAll('#main .bcard .tile')].map((t) => t.querySelectorAll('.w')[0].textContent));
    ok("U15 브랜드별 칸: 큰 범위 아래 '중간 X원 · N곳'", bt.length >= 2 && bt.every((t) => /^중간 [\d,]+원 · \d+곳$/.test(t)), bt.slice(0, 2).join(' / '));
    await p.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#main .cmphead .morebtn').click(); }); await p.waitForTimeout(500);
    await p.locator('.sheet button', { hasText: '횟수·다른 옵션으로 담기' }).click(); await p.waitForTimeout(700);
    const note = await p.evaluate(() => { const n = [...document.querySelectorAll('.sheet .note')].pop(); return n ? n.textContent : ''; });
    ok("U15 담기 창 안내: '… · lo~hi원 · 중간 가격 X원 · N곳'", new RegExp(`· (${RNG}) · 중간 가격 [\\d,]+원 · (일반가|특가 포함) \\d+곳$`).test(note), note);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.keyboard.press('Escape'); await p.waitForTimeout(300);

    // U16: a screen outside the tabs opens with 뒤로, then its title 22 at the top of the first card, 죠미 (if any) under the
    // title, and one line 13 saying what the screen is
    const sh = [];
    for (const hash of ['#guide', '#terms', '#change', '#map', '#quick']) {
      await go(p, hash, hash === '#map' ? 2400 : 1300);
      sh.push(await p.evaluate((hash) => { const v = document.querySelector('#main .view') || document.querySelector('#main > *'), first = v.firstElementChild, c = v.querySelector(':scope > .card');
        const h2 = c && c.querySelector('h2'), say = c && c.querySelector('.jomi-say'), d = c && [...c.querySelectorAll('.sub')].find((x) => __vis(x) && getComputedStyle(x).fontSize === '13px');
        const top = h2 && [...c.querySelectorAll('*')].filter((e) => __vis(e) && e.getBoundingClientRect().height > 0).every((e) => e.getBoundingClientRect().bottom > h2.getBoundingClientRect().top - 1 || e.contains(h2));
        return { hash, back: !!first && first.matches('button.back'), h2: h2 ? getComputedStyle(h2).fontSize : null, top, sayUnder: !say || !!(h2.compareDocumentPosition(say) & 4), desc: !!d && !!(h2.compareDocumentPosition(d) & 4) }; }, hash));
    }
    ok("U16 탭 밖 화면 머리 한 모양: '뒤로' → 첫 카드 맨 위 제목 22 → 죠미(있으면) → 설명 13(사전·용어·가격 변동·지도·빠른 비교)",
      sh.every((x) => x.back && x.h2 === '22px' && x.top && x.sayUnder && x.desc), JSON.stringify(sh.filter((x) => !(x.back && x.h2 === '22px' && x.top && x.sayUnder && x.desc))));

    // U17: '시술 N개 전체 비교' is the '가격 변동 전체 ›' line: accent 15/600, '›' after the words, no outline
    await go(p, '#home', 1500);
    const mg = await p.evaluate(() => { const st = (e) => { const c = getComputedStyle(e); const last = [...e.childNodes].filter((n) => n.nodeType === 1 || n.textContent.trim()).pop();
      return { c: c.color, f: `${c.fontSize}/${c.fontWeight}`, bg: c.backgroundColor, sh: c.boxShadow, chev: !!last && last.nodeName === 'svg' && !!last.querySelector('path[d="m9 18 6-6-6-6"]'), cls: e.className }; };
      const hall = [...document.querySelectorAll('#main button')].find((x) => /전체 비교/.test(x.textContent)), chg = [...document.querySelectorAll('#main button')].find((x) => /가격 변동 전체/.test(x.textContent));
      return { hall: hall && st(hall), chg: chg && st(chg) }; });
    ok("U17 홈 '전체 비교' = '가격 변동 전체 ›' 모양(.morelist, 초록 15/600, 뒤 ›, 테두리 없음)", !!mg.hall && !!mg.chg && /\bmorelist\b/.test(mg.hall.cls) && mg.hall.c === mg.chg.c && mg.hall.f === '15px/600' && mg.chg.f === '15px/600'
      && mg.hall.chev && mg.chg.chev && mg.hall.sh === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(mg.hall.bg), JSON.stringify(mg));
    ok('U06·U14·U15·U16·U17 페이지 오류 없음', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  // ---------- 디자인 통일 묶음 C (2026-10-20 · U18~U22, docs/DESIGN_SYSTEM.md): the last five 'one role, two or three shapes' — the
  // sources first, then the screens at 390 and 320 in a browser of its own
  {
    const fs = require('fs'), path = require('path'), ROOT = path.join(__dirname, '..', '..');
    const app = fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8'), css = fs.readFileSync(path.join(ROOT, 'app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const lines = app.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*\/\//.test(l));
    // U21: figures are built by statRow only — no hand-made .stats / .qstats, no .tile that is not a button but 가격 이력's four
    // (keyTrend: app/unify-ab dates those lines — statRow once both are in; the CSS gives them the same shape meanwhile)
    const kt0 = app.indexOf('function keyTrend('), kt1 = app.indexOf('\n  }\n', kt0), ktFrom = app.slice(0, kt0).split('\n').length, ktTo = app.slice(0, kt1).split('\n').length;
    const handStats = lines.filter(([, l]) => /class: "q?stats"|"qstats"/.test(l)).map(([n, l]) => `${n} ${l.trim().slice(0, 60)}`);
    const plainTile = lines.filter(([n, l]) => /\{ class: "tile" \}/.test(l) && !(n > ktFrom && n < ktTo)).map(([n, l]) => `${n} ${l.trim().slice(0, 60)}`);
    ok('U21 숫자 요약은 statRow로만(손으로 만든 .stats·.qstats 없음, 누르지 않는 .tile은 가격 이력 4칸뿐)', !handStats.length && !plainTile.length && !/\.qstats\s*\{/.test(css), [...handStats, ...plainTile].slice(0, 3).join(' | '));
    // U22: a pick of what to list is a .seg — no tile pressed in place (aria-pressed .tile)
    ok('U22 고르기는 .seg로만(누르는 타일 aria-pressed 없음)', !lines.some(([, l]) => /class: "tile tbtn"[^}]*"aria-pressed"/.test(l)) && !/\.tile\.tbtn\[aria-pressed/.test(css));
    // U20: no icon button drawn by hand with an edge or another size
    ok('U20 아이콘 버튼 CSS 하나(.sibs·.swap·⋯에 따로 그린 테두리·크기 없음)', !/(\.sibs button|\.swap|\.morebtn|\.cx)\s*\{[^}]*(border|width|height|radius)/.test(css));

    const b2 = await chromium.launch();
    const SHORT = ['블리비|강남역점', '쁨|홍대점', '톡스앤필|강남본점'];
    const open = async (vp) => {
      const ctx = await b2.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: true, hasTouch: true, colorScheme: 'light' }); await ctx.addInitScript(HELP);
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
      await p.goto(BASE); await p.evaluate(([items, short]) => { localStorage.clear(); localStorage.setItem('pc:region', JSON.stringify('수도권'));
        localStorage.setItem('pc:carts', JSON.stringify([{ id: 's', name: '모양 시험', items }])); localStorage.setItem('pc:ci', '0'); localStorage.setItem('pc:short', JSON.stringify(short)); }, [CART, SHORT]);
      await p.reload();
      if (await p.locator('#gate-pad').isVisible().catch(() => false)) for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`);
      await p.waitForSelector('#main .card'); await p.waitForFunction(() => window.App && App.Data && App.Data.SYNC.have && !App.state().D.meta.partial, null, { timeout: 60000 });
      return { ctx, p, errs };
    };
    // every button with an icon and no words on the screen (and its sheet): the line's ⓘ (.infob — the line's 36px column, 위계
    // 점검 47) and a name's ⓘ in its words (.linkbtn — 내 견적 '설명 보기'), the − / + of a count (.qty — one control), the map's
    // own zoom and a search field's × are other parts
    // (a sheet open: the sheet's only; the top bar and the sticky compare head measured at the top, before the list scrolls under them)
    const iconBtns = async (p) => { await p.mouse.move(1, 1); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300); return p.evaluate(() => {
      const sh = document.querySelector('.sheet'), all = [...document.querySelectorAll(sh ? '.sheet button' : 'header.top button, #main button')].filter((e) => __vis(e) && !e.textContent.trim() && e.querySelector('svg')
      && !e.matches('.infob, .linkbtn, .qty button, .leaflet-control *, .search button'));
      const top = (e) => !!e.closest('header.top, .cmphead');
      return [...all.filter(top), ...all.filter((e) => !top(e))].map((e) => {
      if (!top(e)) e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(), cs = getComputedStyle(e), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const at = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === e || e.contains(t)); };
      const sv = e.querySelector('svg').getBoundingClientRect();
      return { n: e.getAttribute('aria-label') || e.title || e.className, w: Math.round(r.width), h: Math.round(r.height), rad: cs.borderTopLeftRadius,
        edge: ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0) || (cs.boxShadow !== 'none' && /inset/.test(cs.boxShadow)),
        fill: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && !e.matches('[aria-expanded="true"]'), ic: Math.round(sv.width),
        press: at(cx - 21, cy) && at(cx + 21, cy) && at(cx, cy - 21) && at(cx, cy + 21) }; }); }); };
    const badIcon = (xs) => xs.filter((x) => x.w !== 40 || x.h !== 40 || x.rad !== '50%' || x.edge || x.fill || x.ic !== 22 || !x.press).map((x) => `${x.n} ${x.w}x${x.h} r${x.rad} edge=${x.edge} fill=${x.fill} ic=${x.ic} press=${x.press}`);

    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
      const tag = `${vp.width}`, wide = vp.width === 390;
      const { ctx, p, errs } = await open(vp);
      await p.mouse.move(0, 0);
      const bi = await p.evaluate(() => { const { D } = App.state(); const x = D.branches.findIndex((y) => D.s[y[1]] === '강남역점'); return x >= 0 ? x : 0; });

      // U18: 비교함's ✓ / ⊕ is a state — seen in the branch head's half and across the compare card, at 320 too; the other buttons'
      // icons before their words go at 320 as before; nothing is cut
      const cmpBox = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].filter(__vis).slice(0, 2).map((e) => { const s = e.querySelector(':scope > svg.i');
        return { t: e.textContent.trim(), on: e.getAttribute('aria-pressed'), icon: !!s && __vis(s) && s.getBoundingClientRect().width >= 14, cut: e.scrollWidth > e.clientWidth + 1, w: Math.round(e.getBoundingClientRect().width) }; }), sel);
      await go(p, `#branch/${bi}`, 1300);
      const hb = await cmpBox('#main .bbtns > .shortbtn');
      const others = await p.evaluate(() => [...document.querySelectorAll('#main .bbtns > .btn:not(.shortbtn) > svg.i.sm:first-child')].filter(__vis).length);
      await p.locator('#main .bbtns > .shortbtn').first().click(); await p.waitForTimeout(250);
      const hb2 = await cmpBox('#main .bbtns > .shortbtn');
      await p.locator('#main .bbtns > .shortbtn').first().click(); await p.waitForTimeout(250);
      await go(p, '#compare?k=X01', 1500);
      await p.locator('#clinics .seg.vsw button', { hasText: '카드' }).click(); await p.waitForTimeout(600);
      const cb = await cmpBox('#clinics .ccard .shortbtn');
      const states = [...hb, ...hb2, ...cb];
      ok(`U18 ${tag} 비교함의 ✓·⊕는 지점 머리 반 칸·비교 카드 어디서나 보임(잘림 없음)`, hb.length === 1 && hb2.length === 1 && cb.length >= 1 && states.every((x) => x.icon && !x.cut)
        && new Set(states.map((x) => x.on)).size === 2, JSON.stringify(states));
      ok(`U18 ${tag} 다른 버튼의 꾸밈 아이콘은 ${wide ? '보임' : '320에서 숨김(그대로)'}`, wide ? others >= 3 : others === 0, `${others}개`);
      // U20: the compare cards' ‹ › and the compare head (♡ ⋯) and the top bar
      const ib = { cards: await iconBtns(p) };
      await p.locator('#clinics .seg.vsw button', { hasText: '목록' }).click(); await p.waitForTimeout(400); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(200);
      ib.head = await iconBtns(p);
      const pair = await p.evaluate(() => { const a = document.querySelector('.cmphead .addbtn').getBoundingClientRect(), m = document.querySelector('.cmphead .morebtn').getBoundingClientRect();
        return { mid: Math.abs((a.top + a.bottom) / 2 - (m.top + m.bottom) / 2), gap: Math.round(m.left - a.right) }; });
      ok(`U20 ${tag} 비교 머리 ⋯는 담기와 가운데 맞춤, 사이 8px`, pair.mid < 1 && pair.gap === 8, JSON.stringify(pair));
      await p.locator('.cmphead .morebtn').click(); await p.waitForTimeout(350);
      ib.sheet = await iconBtns(p); await p.keyboard.press('Escape'); await p.waitForTimeout(250);
      await go(p, `#branch/${bi}`, 1300); ib.branch = await iconBtns(p);
      await go(p, '#cart', 1000); ib.cart = await iconBtns(p);
      await go(p, '#versus', 1300); ib.versus = await iconBtns(p);
      await go(p, '#quick', 1000); ib.quick = await iconBtns(p);
      const want = { cards: /이전 지점/, head: /더 보기/, sheet: /닫기/, branch: /같은 브랜드 다음 지점/, cart: /빼기/, versus: /A와 B 바꾸기/, quick: /빼기/ };
      const miss = Object.entries(want).filter(([k, re]) => !ib[k].some((x) => re.test(x.n))).map(([k]) => k);
      const bad = Object.entries(ib).flatMap(([k, xs]) => badIcon(xs).map((x) => `${k}: ${x}`));
      ok(`U20 ${tag} 글자 없는 아이콘 버튼은 한 모양(테두리 없는 40 원, 아이콘 22, 누르는 곳 44) — 위 막대·시트 닫기·♡·⋯·지점 ‹ ›·카드 ‹ ›·빼기 ×·A↔B`,
        !miss.length && !bad.length, `${Object.values(ib).flat().length}개 · 못 찾음 ${miss.join(',')} · ${bad.slice(0, 3).join(' | ')}`);

      // U21: figures — the name over the number, left-aligned, no box (비교 가격 카드 · 마이 · 지점 비교), and 가격 이력's .tile (CSS, put
      // on the screen here: it shows from 8 weeks of records); 브랜드별 tiles, buttons, keep their box
      const figs = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].filter(__vis).map((row) => [...row.children].filter(__vis).map((c) => {
        const k = c.querySelector(':scope > .sk, :scope > .k'), v = c.querySelector(':scope > b'), cr = c.getBoundingClientRect();
        const kr = k && k.getBoundingClientRect(), vr = v && v.getBoundingClientRect(), cs = getComputedStyle(c);
        return { k: k && k.textContent.trim(), order: !!k && !!v && kr.bottom <= vr.top + 1, left: !!k && !!v && Math.abs(kr.left - vr.left) < 1 && Math.abs(kr.left - (cr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft))) < 1,
          align: cs.textAlign, box: __framed(c), kfs: k && getComputedStyle(k).fontSize, vfs: v && getComputedStyle(v).fontSize, vfw: v && getComputedStyle(v).fontWeight }; })), sel);
      // the number 17, but 15 in the price card: there the figures are the second line under its 28px range, and at 17 a third of
      // the card split them ('1,108,250 / 원', '최대 / 2.5배' — 검토 2026-10-20)
      const goodFig = (rows, vfs = '17px') => rows.length >= 1 && rows.every((r) => r.length >= 1 && r.every((c) => c.order && c.left && c.align !== 'center' && !c.box && c.kfs === '13px' && c.vfs === vfs && c.vfw === '760'));
      // every figure's name and number on one line (a split number reads as two: '1,108,250' and '원')
      const figLines = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].filter(__vis).flatMap((row) => [...row.children].filter(__vis).flatMap((c) =>
        [...c.querySelectorAll(':scope > .sk, :scope > b')].map((e) => { const rg = document.createRange(); rg.selectNodeContents(e);
          return { t: e.textContent.trim(), n: new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size, cut: e.scrollWidth > e.clientWidth + 1 || c.scrollWidth > c.clientWidth + 1 }; }))), sel);
      await go(p, '#compare?k=X01', 1300); const f1 = await figs('.pricecard .stats');
      await go(p, '#me', 900); const f2 = await figs('#main .stats'); const l2 = await figLines('#main .stats');
      await go(p, '#versus', 1300); const f3 = await figs('#main .stats'); const l3 = await figLines('#main .stats');
      const f4 = await p.evaluate(() => { const c = document.createElement('div'); c.className = 'card'; c.id = '__kt';
        c.innerHTML = '<div class="tiles">' + ['현재 최저가', '기록 최저 / 최고', '기간 중간 가격', '최저가 변동'].map((k) => `<div class="tile"><span class="k">${k}</span><b class="num">1,000원</b><span class="w">확인 10/19</span></div>`).join('') + '</div>';
        document.querySelector('#main .view').append(c); return true; }) && await figs('#__kt .tiles');
      await p.evaluate(() => document.querySelector('#__kt').remove());
      ok(`U21 ${tag} 숫자 요약 한 모양: 이름 13 위 · 숫자 760 아래(가격 카드 15, 마이·지점 비교·가격 이력 17) · 왼쪽 맞춤 · 상자 없음`, goodFig(f1, '15px') && [f2, f3, f4].every((f) => goodFig(f)),
        JSON.stringify([f1, f2, f3, f4].map((f) => f[0] && f[0][0])));
      // every popular procedure's price card (36 X keys), and 마이 · 지점 비교: no figure split over two lines, none cut
      const pcKeys = await p.evaluate(() => { const K = App.state().KEYS; return (Array.isArray(K) ? K : Object.values(K)).map((k) => k.id).filter((x) => /^X\d+$/.test(x)); });
      const split = [];
      for (const k of pcKeys) { await p.evaluate((k) => { location.hash = `#compare?k=${k}`; }, k); await p.waitForTimeout(250);
        for (const x of await figLines('.pricecard .stats')) if (x.n !== 1 || x.cut) split.push(`${k} ${x.t} ${x.n}줄${x.cut ? ' 잘림' : ''}`); }
      for (const x of [...l2, ...l3]) if (x.n !== 1 || x.cut) split.push(`마이·지점 비교 ${x.t} ${x.n}줄${x.cut ? ' 잘림' : ''}`);
      ok(`U21 ${tag} 숫자 요약은 한 줄: 인기 시술 가격 카드 ${pcKeys.length}개 모두 + 마이·지점 비교(갈림·잘림 없음)`, pcKeys.length >= 30 && !split.length && l2.length >= 3 && l3.length >= 3, `${split.length}곳 ${split.slice(0, 4).join(' | ')}`);
      if (wide) {
        await go(p, '#compare?k=X12', 1500); await p.evaluate(() => { for (const d of document.querySelectorAll('details.cmpfold')) d.open = true; }); await p.waitForTimeout(400);
        const bt = await p.evaluate(() => [...document.querySelectorAll('.bcard .tile')].filter(__vis).map((t) => ({ btn: t.tagName === 'BUTTON', box: __framed(t) })));
        ok('U21 브랜드별 타일은 누르는 칸이라 상자 그대로', bt.length >= 2 && bt.every((x) => x.btn && x.box), JSON.stringify(bt.slice(0, 2)));
      }

      // U22: 가격 변동's pick is 홈's .seg: the same buttons (size, weight, corner, chosen fill), 'name count', two to a row; the
      // counts are 홈's; a pick lists that kind, pressed again lists all
      await go(p, '#home', 1000);
      const segStyle = (sel) => p.evaluate((sel) => { const s = document.querySelector(sel); if (!s) return null; const bs = [...s.querySelectorAll(':scope > button')];
        const cs = (e) => { const c = getComputedStyle(e); return [c.fontSize, c.fontWeight, c.borderTopLeftRadius, c.paddingTop, c.backgroundColor, c.color].join(' '); };
        const on = bs.find((x) => x.matches('[aria-selected="true"], [aria-pressed="true"]')), off = bs.find((x) => !x.matches('[aria-selected="true"], [aria-pressed="true"]'));
        return { cls: s.className, n: bs.length, t: bs.map((x) => x.textContent.trim()), on: on ? cs(on) : null, off: off ? cs(off) : null, box: cs(s),
          rows: new Set(bs.map((x) => Math.round(x.getBoundingClientRect().top))).size, cut: bs.some((x) => x.scrollWidth > x.clientWidth + 1),
          lines: bs.map((x) => Math.round(x.getBoundingClientRect().height)) }; }, sel);
      const hs = await segStyle('#main .card.flush .seg');
      await go(p, '#change', 1300);
      const cs0 = await segStyle('#main .view > .card .seg');
      const noTile = await p.evaluate(() => !document.querySelector('#main .tile'));
      const pick = p.locator('#main .view > .card .seg button', { hasText: '새로 생겼어요' }), can = (await pick.count()) === 1;
      let cs1 = null, cs2 = null, listed = [];
      if (can) { await pick.click(); await p.waitForTimeout(300); cs1 = await segStyle('#main .view > .card .seg');
        listed = await p.evaluate(() => [...document.querySelectorAll('#main .card.flush > ul.list > li')].filter(__vis).map((li) => !!li.querySelector('.k.k4') && /새로 생김/.test(li.textContent)));
        await pick.click(); await p.waitForTimeout(300); cs2 = await segStyle('#main .view > .card .seg'); }
      const num = (t, w) => { const x = (t.find((y) => y.startsWith(w)) || '').match(/(\d+)$/); return x ? +x[1] : null; };
      ok(`U22 ${tag} 가격 변동 고르기 = 홈과 같은 .seg(글자 '이름 개수', 버튼 모양·고른 칸 채움 같음)`, !!hs && !!cs0 && !!cs1 && noTile && cs0.n === 4 && cs0.t.every((x) => /^\S.* \d+$/.test(x))
        && cs0.off === hs.off && cs1.on === hs.on && cs0.box === hs.box, JSON.stringify({ home: hs && [hs.on, hs.off, hs.box], change: cs1 && [cs1.on, cs0.off, cs0.box], t: cs0 && cs0.t }));
      ok(`U22 ${tag} 4칸은 2칸씩 두 줄, 한 줄 글자, 잘림 없음`, !!cs0 && cs0.rows === 2 && !cs0.cut && new Set(cs0.lines).size === 1, JSON.stringify(cs0 && [cs0.rows, cs0.lines]));
      ok(`U22 ${tag} 개수는 홈과 같음(내렸어요·올랐어요)`, !!hs && !!cs0 && num(hs.t, '내렸어요') === num(cs0.t, '내렸어요') && num(hs.t, '올랐어요') === num(cs0.t, '올랐어요'), `${hs && hs.t} | ${cs0 && cs0.t}`);
      ok(`U22 ${tag} 고르면 그 종류만, 다시 누르면 전체`, !!cs1 && cs1.on && listed.length >= 1 && listed.every(Boolean) && !!cs2 && !cs2.on, `${listed.length}줄`);

      // U19: 규격 확인 — 확인 light green; 추정 · 미확인 grey with an icon (both states of the data)
      if (wide) {
        await go(p, '#compare?k=X01', 1300); await p.evaluate(() => { for (const d of document.querySelectorAll('details.cmpfold')) d.open = true; }); await p.waitForTimeout(400);
        const sp = await p.evaluate(() => [...document.querySelectorAll('.speccard .specs dd')].map((dd) => { const k = dd.querySelector('.k'); const cs = getComputedStyle(k);
          return { t: k.textContent.trim(), cls: k.className, icon: !!k.querySelector('svg.i'), bg: cs.backgroundColor }; }));
        const by = (t) => sp.filter((x) => x.t === t), fillBg = await p.evaluate(() => { const e = document.createElement('span'); e.className = 'k kw'; document.body.append(e); const c = getComputedStyle(e).backgroundColor; e.remove(); return c; });
        ok('U19 규격 확인 배지: 확인 = 연한 초록(아이콘 없음), 추정·미확인 = 회색 + 아이콘(.kw)', by('확인').length >= 1 && by('추정').length >= 1 && by('미확인').length >= 1
          && by('확인').every((x) => /\bok\b/.test(x.cls) && !x.icon) && [...by('추정'), ...by('미확인')].every((x) => /\bkw\b/.test(x.cls) && x.icon && x.bg === fillBg), JSON.stringify(sp));
      }
      // U20's 40px ‹ › left the branch name 74px at 320 beside ♡ and them (검토 2026-10-20: 3 lines or more at 133 of 수도권's 289,
      // 54 before U20; at 390 2). ♡ ‹ n/m › are on the brand line now: every branch's name in this head (a branch with ‹ ›, the
      // narrowest name), 3 lines or more at 0 at 390, at 320 not over the 54 before; the brand line at its widest (닥터에버스,
      // '88/88') stays inside the card
      await go(p, `#branch/${bi}`, 1300);
      const nm = await p.evaluate(() => { const { D, BR } = App.state(), h2 = document.querySelector('#main .view > .card h2'), keep = h2.textContent, out = { n: 0, two: 0, three: [] };
        const lines = () => { const rg = document.createRange(); rg.selectNodeContents(h2); return new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
        for (const y of BR) { h2.textContent = `${D.meta.brands[y.brand][0]} ${y.name}`; const n = lines(); out.n++; if (n === 2) out.two++; if (n >= 3) out.three.push(h2.textContent); }
        h2.textContent = keep;
        const line = document.querySelector('#main .view > .card .brline'), sub = line && line.querySelector(':scope > .sub'), sb = line && line.querySelector('.sibs > .sub');
        const long = D.meta.brands.map((x) => x[0]).sort((a, c) => c.length - a.length)[0];
        if (sub) sub.textContent = long; if (sb) sb.textContent = '88/88';
        const card = h2.closest('.card').getBoundingClientRect(), last = line && line.lastElementChild.getBoundingClientRect();
        // (by the boxes: a button's 44px pressing ring, 2px past its circle, is in the line's scrollWidth)
        const lr = line && line.getBoundingClientRect();
        out.brand = !!line && !!sb && last.right <= lr.right + 0.5 && lr.right <= card.right - 8 && sub.clientWidth >= 24 && sb.scrollWidth <= sb.clientWidth + 1;
        out.bd = line && { last: Math.round(last.right), line: Math.round(lr.right), card: Math.round(card.right), sub: sub.clientWidth, sb: [sb.scrollWidth, sb.clientWidth] };
        out.h2w = Math.round(h2.getBoundingClientRect().width); out.cardw = Math.round(card.width); return out; });
      await go(p, '#home', 600);
      ok(`U20 ${tag} 지점 머리: ♡·‹ n/m ›는 브랜드 줄에, 이름이 카드 폭 전체(3줄 이상 ${wide ? '0곳' : '54곳 이하'}, 지점 ${nm.n}곳)`,
        nm.n >= 289 && nm.h2w >= nm.cardw - 42 && (wide ? !nm.three.length : nm.three.length <= 54), `2줄 ${nm.two} · 3줄+ ${nm.three.length} ${nm.three.slice(0, 3).join(' | ')} · 이름 폭 ${nm.h2w}/${nm.cardw}`);
      ok(`U20 ${tag} 브랜드 줄(가장 긴 브랜드 이름 + '88/88')이 카드 안에 들어감`, nm.brand, JSON.stringify(nm.bd));
      ok(`U18~U22 ${tag} 페이지 오류 없음`, !errs.length, errs.join(' | '));
      await ctx.close();
    }
    await b2.close();
  }
  const pass = R.filter(Boolean).length; console.log(`\n${pass}/${R.length} 통과`); process.exit(pass === R.length ? 0 : 1);
})();
