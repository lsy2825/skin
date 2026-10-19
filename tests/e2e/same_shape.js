// 위계 점검 묶음 5 '같은 역할은 같은 모양, 가까운 것끼리' (hierarchy audit REPORT 순번 29·30·31·32·33·34·35·39·47·50·52; 6.0 규칙
// 3·4). What it holds on the screens the person reads, at 390 and 320 wide:
//  29. a price line's badges in one order everywhere — kind & conditions (체험가·한정가·고시가, 첫 방문·평일·시간 한정 …) →
//      warnings (기간 끝남 kx, 기간 확인 필요 kc, 초저가·조건 확인 kw …) → information (~10/31까지, VAT, 추가 옵션, 제품·장비): 비교 지점 줄,
//      지점 가격표, 검색 결과, 견적 펼친 줄
//  30. every fold's summary line has the same chevron (one CSS mark, no svg / ▾ / none) at the line's right end; the compare
//      screen's block folds are cards (no 12px extra above them: the view's 16), and opened they hold no card in a card
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
      const boxes = [...pc.querySelectorAll('*')].filter((e) => __vis(e) && !e.matches('.k, .k *, button, button *, a, a *, svg, svg *, .rangebar, .rangebar *') && __framed(e)).map((e) => e.className || e.tagName);
      const cl = [...pc.querySelectorAll('.condlow')].map((c) => { const cs = getComputedStyle(c); return { line: parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none', fill: __framed(c), badges: [...c.querySelectorAll('.k')].filter(__vis).map((k) => k.className + ':' + k.textContent.trim()), sub: (c.querySelector('.sub') || {}).textContent || '' }; });
      const cf = [...document.querySelectorAll('#main details.cmpfold')].map((d) => { const prev = d.previousElementSibling; return { card: d.classList.contains('card'), gap: prev ? Math.round(d.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) : null }; });
      const rk = rows[0] && rows[0].querySelector('.rank .b'), card = document.querySelector('#clinics');
      const infob = rows.filter((li) => li.querySelectorAll(':scope > .infob').length === 1 && /가격 근거/.test(li.querySelector(':scope > .infob').getAttribute('aria-label'))).length;
      const hits = rows.slice(0, 3).map(__hit); scrollTo(0, 0);
      return { n: rows.length, bad, both, boxes, cl, cf, textX: rk ? rk.getBoundingClientRect().left - card.getBoundingClientRect().left : null, infob, hits,
        priceR: rows[0] ? card.getBoundingClientRect().right - rows[0].querySelector('.rank .p').getBoundingClientRect().right : null };
    });
    ok(`29 ${tag} 비교 줄 배지 순서: 종류·조건 → 경고 → 정보`, cmp.n >= 5 && !cmp.bad.length, `${cmp.n}줄 · 어긋난 줄 ${cmp.bad.length} ${cmp.bad.slice(0, 2).join(' | ')}`);
    if (wide) ok('29 비교: 조건 배지와 날짜 배지가 같이 있는 줄이 있음(순서가 시험됨)', cmp.both > 0, `${cmp.both}줄`);
    ok(`31 ${tag} 가격 카드 안에 테두리·채움 상자 없음`, !cmp.boxes.length, cmp.boxes.join(', '));
    ok(`31 ${tag} 조건부 가격·확인 필요 초저가: 위 선 + 배지, 채움 없음, 문장 그대로`, cmp.cl.length >= 1 && cmp.cl.every((c) => c.line && !c.fill && c.badges.length >= 1)
      && cmp.cl.some((c) => /조건이 맞을 때만 이 가격이에요\.$/.test(c.sub)), JSON.stringify(cmp.cl).slice(0, 240));
    ok(`30 ${tag} 비교 덩어리 접기 2개는 카드, 위 간격은 화면 간격 16px`, cmp.cf.length === 2 && cmp.cf.every((c) => c.card && c.gap === 16), JSON.stringify(cmp.cf));
    ok(`47 ${tag} 비교 줄: ⓘ 하나(가격 근거)`, cmp.infob === cmp.n, `${cmp.infob}/${cmp.n}`);
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
      const sh = await p.evaluate(() => { const s = document.querySelector('.sheet[aria-label="가격 확인"]'); if (!s) return null; const dt = [...s.querySelectorAll('dt')].find((x) => x.textContent === '원본');
        return { orig: !!dt, link: !!(dt && dt.nextElementSibling.querySelector('a[href^="http"][target=_blank]')) || /원본 링크 없음/.test(dt ? dt.nextElementSibling.textContent : '') }; });
      ok('47 검색 ⓘ → 가격 근거 창, \'원본\' 줄에 병원 원본 링크', !!sh && sh.orig && sh.link, JSON.stringify(sh));
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
    // end; a line with ⓘ has 4px and the ⓘ column (검토: the 4px reached the lines with no ⓘ)
    await go(p, '#search/' + encodeURIComponent('물광'), 1500);
    const fm = await p.evaluate(() => { const lis = [...document.querySelectorAll('#main .fams ul.list > li.rk')].filter(__vis);
      return lis.map((li) => { const it = li.querySelector(':scope > .item'), pp = it.querySelector('.p, .num'); const lr = li.getBoundingClientRect();
        return { ib: !!li.querySelector(':scope > .infob'), pad: parseFloat(getComputedStyle(it).paddingRight), priceR: pp ? Math.round(lr.right - pp.getBoundingClientRect().right) : null }; }); });
    const fNo = fm.filter((x) => !x.ib), fYes = fm.filter((x) => x.ib);
    if (!fNo.length) console.log(`SKIP | 52 ${tag} '종류' 카드에 ⓘ 없는 줄이 없음`);
    else ok(`52 ${tag} '종류' 카드: ⓘ 없는 줄은 오른쪽 여백 14px(가는 선 끝), ⓘ 있는 줄은 4px + ⓘ 칸`, fNo.every((x) => x.pad === 14 && x.priceR >= 14) && fYes.every((x) => x.pad === 4), JSON.stringify(fm.slice(0, 5)));

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
      ok('47 지점 ⓘ → 가격 근거 창(원본 줄)', await p.locator('.sheet[aria-label="가격 확인"] dt', { hasText: /^원본$/ }).count() === 1);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    }

    // ---------- 홈
    await go(p, '#home', 900);
    const hm = await p.evaluate(() => { const g = document.querySelector('#main .grid'), btn = [...document.querySelectorAll('#main .btn.line.block')].find((x) => /전체 비교/.test(x.textContent));
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
  await b.close();
  const pass = R.filter(Boolean).length; console.log(`\n${pass}/${R.length} 통과`); process.exit(pass === R.length ? 0 : 1);
})();
