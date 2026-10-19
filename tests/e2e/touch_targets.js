// hit-test probe: a target passes if points 11px above/below/left/right of its centre still hit it. A switch is its label (the
// checkbox in it is 1px); 'quotes:cart' opens the clinic comparison and every quote in it, and the branch page of a clinic with a
// revisit price has '이 병원에 다녀왔어요' in its head (review 2026-10-19: those switches were not measured)
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/touch_targets.js [out-dir]
// Needs Playwright with Chromium (PLAYWRIGHT=/path/to/node_modules/playwright if it isn't resolvable). Not part of
// `node --test`: it drives a real browser against the local server. Results are written up in docs/UX_QA_REPORT.md.
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const asRows = require('./rows');
const Pr = require(path.join(__dirname, '../../app/domain/pricing.js'));
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;   // the PIN screen's number: never written in the repo
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요 (예: APP_PIN=xxxx node ' + process.argv[1] + ')'); process.exit(2); }
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pc:carts', JSON.stringify([{ id: 'a', name: 't', items: [{ t: 'k', k: 'X12', q: 1 }, { t: 'k', k: 'X24', q: 1 }] }])); localStorage.setItem('pc:short', JSON.stringify(['블리비|강남역점', '쁨|홍대점', '톡스앤필|강남본점'])); }); await p.reload();
  for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); await p.waitForSelector('.pc');
  let tot = 0, bad = 0; const ex = {};
  const D = asRows(await (await fetch(BASE + 'data.json')).json()), rvRow = D.rows.find((x) => Pr.isRevisit(D.s[x[2]]));
  for (const r of [...(rvRow ? [`branch/${rvRow[0]}`] : []), 'quotes:cart', 'home', 'explore', 'saved', 'compare?k=X12', 'compare?k=X24', 'guide', 'search/%EB%B3%B4%ED%86%A1%EC%8A%A4', 'table', 'cart', 'me', 'branch/3', 'versus', 'change', 'about', 'ops', 'rank', 'concern?c=wrinkle',
      'table?q=%EB%B3%B4%ED%86%A1%EC%8A%A4&att=%EA%B5%AD%EC%82%B0', 'cards:compare?k=X12', 'quick', 'terms', 'data', 'search/%EC%82%AC%EA%B0%81%ED%84%B1%2050U%20-%EC%A0%9C%EC%98%A4%EB%AF%BC?nl=0']) {   // + 세부 구분 filter, compare as cards, quick compare, terms
    const cards = r.startsWith('cards:'), quotes = r.startsWith('quotes:'); await p.goto(BASE + '#' + r.replace(/^(cards|quotes):/, '')); await p.waitForTimeout(500);
    if (cards) { await p.locator('#clinics .seg.vsw button', { hasText: '카드' }).click(); await p.waitForTimeout(400); }
    if (quotes) { await p.locator('.cartsum button[aria-expanded="false"]').click(); await p.waitForTimeout(400);
      for (let n = 0; n < 40; n++) { const c = p.locator('li.qrow button.rank[aria-expanded="false"]'); if (!(await c.count())) break; await c.first().click(); await p.waitForTimeout(60); }
      console.log(`quotes: ${await p.locator('li.qrow.open').count()} open · '이 병원에 다녀왔어요' ${await p.locator('#main .visit label.switch').count()}`); }
    const res = await p.evaluate(async () => { let n = 0, fail = []; const els = [...document.querySelectorAll('#main button, #main select, #main input:not([type=hidden]), #main a[href], #main label.switch')];
      for (const e of els) { if (e.offsetParent === null) continue; if (e.matches('.switch input')) continue; if (e.closest('details:not([open])') && !e.closest('summary')) continue; if (e.matches('a') && e.closest('p, .sub, dd')) continue;
        e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); if (!r.width) continue; n++;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = (x, y) => { const t = document.elementFromPoint(x, y); return t && (t === e || e.contains(t)); };
        const okV = r.height >= 24 || (hit(cx, cy - 11) && hit(cx, cy + 11)), okH = r.width >= 24 || (hit(cx - 11, cy) && hit(cx + 11, cy));
        if (!okV || !okH) fail.push((e.className || e.tagName) + ':' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 10) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
      return { n, fail: fail.slice(0, 6), nf: fail.length }; });
    tot += res.n; bad += res.nf; if (res.nf) ex[r] = res.fail; console.log(r, res.n, res.nf, res.fail.join(' | ')); }
  console.log(`TARGETS ${tot - bad}/${tot} ≥24px hit area`); await b.close(); process.exitCode = bad ? 1 : 0; })();
