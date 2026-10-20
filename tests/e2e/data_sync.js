// Price-data sync in a real browser (docs/PRICE_SYNC_ARCHITECTURE.md): first visit with progress, the saved copy used on the
// next visit without downloading data.json again, offline notice, a newer version waiting for '새 가격 보기', a corrupted
// download refused (old prices kept), and a first visit with a corrupted file showing what failed.
// Usage: python3 -m http.server 8766 --directory app &  then  APP_PIN=<pin> node tests/e2e/data_sync.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8766/';
const PIN = process.env.APP_PIN;
if (!PIN) { console.error('APP_PIN 환경 변수에 비밀번호를 넣어 주세요'); process.exit(2); }
const R = []; const ok = (name, pass, detail = '') => { R.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };
const APP = path.join(__dirname, '..', '..', 'app');
const metaFor = (buf, updated) => { const sha = crypto.createHash('sha256').update(buf).digest('hex'); const d = JSON.parse(buf.toString('utf8'));
  return { schema: 1, version: `${updated}.${sha.slice(0, 8)}`, updated, built: '2026-10-21T00:00:00+00:00', bytes: buf.length, sha256: sha, rows: d.meta.rows, branches: d.branches.length, verified: d.branches.length, stale: 0, brands: [] }; };
// the header's date as the app writes it (app.js paintUpd: 2026-10-19 → '10/19 기준'). The saved copy is the served
// data-meta.json's, so step 4 reads its date from there instead of a fixed day (it said 10/14 and failed after the 10-19 data)
const md = (u) => `${+u.slice(5, 7)}/${+u.slice(8, 10)}`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let dataReq = 0; p.on('request', (r) => { if (/\/data\.json/.test(r.url())) dataReq++; });
  const unlock = async () => { for (const d of PIN) await p.click(`#gate-pad button[data-d="${d}"]`); };

  // 1) first visit on a slow line: real progress in %, then prices; the checked copy is saved on the phone
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 1.6 * 1024 * 1024, uploadThroughput: 512 * 1024 });
  await p.addInitScript(() => { window.__seenTxt = []; document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => {
    for (const s of ['#load-msg', '#upd']) { const e = document.querySelector(s); if (e && e.textContent && window.__seenTxt[window.__seenTxt.length - 1] !== e.textContent) window.__seenTxt.push(e.textContent); } })
    .observe(document.body, { subtree: true, childList: true, characterData: true })); });
  await p.goto(BASE); await p.evaluate(async () => { localStorage.clear(); for (const k of await caches.keys()) await caches.delete(k); });
  await cdp.send('Network.clearBrowserCache');   // a real first visit: the goto above must not leave the price files in the HTTP cache
  dataReq = 0; await p.reload(); await unlock();
  const seen = new Set();
  // round-2 O2: the home screen may already be up from home.json — then data.json's progress is in the header caption.
  // Every text the loading line and the caption show is recorded in the page (polling missed the fast ones)
  await p.waitForFunction(() => window.App && window.App.Data.SYNC.have, null, { timeout: 30000 }).catch(() => {});
  for (const m of await p.evaluate(() => window.__seenTxt || [])) seen.add(m.replace(/\(.*\)/, '').trim());
  await p.waitForSelector('.pc', { timeout: 30000 });
  const pcts = [...seen].filter((x) => /\d+%/.test(x));
  ok('첫 방문: 받는 동안 실제 진행률(%)', pcts.length >= 2, (pcts.length ? pcts : [...seen]).slice(0, 4).join(' / '));
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const saved = await p.evaluate(async () => { const c = await caches.open('pc-data-v1'); const m = await (await c.match('current-meta')).json(); return { v: m.version, has: !!(await c.match(`data-${m.version}`)) }; });
  const meta = JSON.parse(fs.readFileSync(path.join(APP, 'data-meta.json'), 'utf8'));
  ok('확인된 사본을 휴대폰에 저장(버전 = 서버 메타)', saved.v === meta.version && saved.has, saved.v);
  ok('헤더 상태: 최신(READY)', (await p.locator('#upd').getAttribute('data-state')) === 'READY' && await p.locator('#netbar').isHidden());

  // 2) next visit, same version: data.json is not downloaded again
  dataReq = 0; await p.reload(); await p.waitForSelector('.pc');
  ok('재방문(같은 버전): 가격 파일을 다시 받지 않음', dataReq === 0, `data.json 요청 ${dataReq}번`);

  // 3) server not reachable: the saved copy, with the notice
  await p.route('**/data-meta.json', (r) => r.abort('internetdisconnected'));
  await p.route('**/data.json', (r) => r.abort('internetdisconnected'));
  await p.reload(); await p.waitForSelector('.pc');
  const nb = await p.locator('#netbar').innerText().catch(() => '');
  ok('연결 안 됨: 저장된 가격 + "저장된 가격 정보입니다. 현재 가격과 다를 수 있습니다."', /저장된 가격 정보입니다\. 현재 가격과 다를 수 있습니다\./.test(nb) && (await p.locator('#upd').getAttribute('data-state')) === 'STALE', nb);
  ok('연결 안 됨에도 가격 화면이 보임', (await p.locator('#main').innerText()).length > 200);
  await p.unroute('**/data-meta.json'); await p.unroute('**/data.json');

  // 4) a newer version on the server: old prices stay; when the new file is checked and saved → '새 가격 보기'
  const orig = fs.readFileSync(path.join(APP, 'data.json'));
  const newer = Buffer.from(orig.toString('utf8').replace(`"updated":"${meta.updated}"`, '"updated":"2026-10-21"'), 'utf8');
  const nm = metaFor(newer, '2026-10-21');
  await p.route('**/data-meta.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nm) }));
  await p.route('**/data.json', async (r) => { await new Promise((s) => setTimeout(s, 800)); r.fulfill({ status: 200, contentType: 'application/json', body: newer }); });
  await p.reload(); await p.waitForSelector('.pc');
  const during = await p.locator('#netbar').innerText().catch(() => '');
  const upd1 = await p.locator('#upd').textContent();
  ok('새 버전 받는 동안: 저장된 가격을 먼저 보여줌(PARTIALLY_READY)', /새 가격 받는 중/.test(during) && upd1.includes(`${md(meta.updated)} 기준`), `${during} | ${upd1}`);
  await p.waitForSelector('#netbar .nb-act', { timeout: 15000 }).catch(() => {});
  const readyTxt = await p.locator('#netbar').innerText().catch(() => '');
  ok('검사 통과 후 "새 가격(2026-10-21)이 준비됐어요"', /새 가격\(2026-10-21\)이 준비됐어요/.test(readyTxt), readyTxt);
  dataReq = 0;
  await p.locator('#netbar .nb-act').click(); await p.waitForSelector('.pc');
  await p.waitForTimeout(400);
  ok('새 가격 보기 → 새 사본으로 열림(다시 받지 않음)', /10\/21/.test(await p.locator('#upd').textContent()) && dataReq === 0, `${await p.locator('#upd').textContent()} · data.json ${dataReq}번`);
  await p.unroute('**/data-meta.json'); await p.unroute('**/data.json');

  // 5) a corrupted download (checksum differs) is refused 3 times; the saved copy stays in use and in the cache
  // one digit near the end changed: still valid JSON, only the checksum differs (a fixed byte offset could land on a
  // comma and make the file unparsable instead — 2026-10-15 after a data rebuild)
  const bad = Buffer.from(newer); { let i = bad.length - 10; while (i > 0 && !(bad[i] >= 0x30 && bad[i] <= 0x39)) i--; bad[i] = bad[i] === 0x31 ? 0x32 : 0x31; }
  const nm2 = metaFor(orig, meta.updated); nm2.version = `${meta.updated}.${nm2.sha256.slice(0, 8)}`;
  await p.route('**/data-meta.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...nm2, version: '2026-10-28.' + nm2.sha256.slice(0, 8), updated: '2026-10-28' }) }));
  let tries = 0; await p.route('**/data.json', (r) => { tries++; r.fulfill({ status: 200, contentType: 'application/json', body: bad }); });
  await p.reload(); await p.waitForSelector('.pc');
  await p.waitForSelector('#netbar .nb-act', { timeout: 20000 }).catch(() => {});
  const failTxt = await p.locator('#netbar').innerText().catch(() => '');
  const still = await p.evaluate(async () => { const c = await caches.open('pc-data-v1'); return (await (await c.match('current-meta')).json()).updated; });
  ok('손상된 파일: 3번 시도 후 거부, 저장된 가격 유지', tries === 3 && /받지 못해 저장된 가격을 보여줘요/.test(failTxt) && still === '2026-10-21' && /10\/21/.test(await p.locator('#upd').textContent()), `시도 ${tries}번 · 저장본 ${still} · ${failTxt}`);
  await p.unroute('**/data-meta.json'); await p.unroute('**/data.json');

  // 6) first visit with a corrupted file and nothing saved: the error screen says what failed, '다시 시도' works
  await p.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); });
  let broken = true;
  await p.route('**/data.json', (r) => broken ? r.fulfill({ status: 200, contentType: 'application/json', body: bad }) : r.continue());
  await p.route('**/home.json', (r) => broken ? r.fulfill({ status: 404, body: '' }) : r.continue());   // no home summary either (O2 case below)
  await p.reload(); await p.waitForSelector('#main [role=alert]', { timeout: 20000 }).catch(() => {});
  const et = await p.locator('#main').innerText();
  ok('첫 방문 + 손상: 오류 화면에 이유(체크섬)와 다시 시도', /불러오지 못했어요/.test(et) && /체크섬|날짜|수가/.test(et) && /다시 시도/.test(et), et.split('\n').slice(0, 4).join(' / '));
  broken = false;
  await p.locator('#main .btn', { hasText: '다시 시도' }).click(); await p.waitForSelector('.pc', { timeout: 20000 }).catch(() => {});
  ok('다시 시도 → 정상', await p.locator('.pc').count() > 0);
  await p.unroute('**/home.json');

  // 6b) round-2 O2: the same corrupted data.json, but home.json is fine — the home screen shows the checked home prices,
  // the notice bar says the full prices failed, and another screen tells why
  await p.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); });
  broken = true;
  await p.reload(); await p.waitForSelector('.pc', { timeout: 20000 }).catch(() => {});
  await p.waitForFunction(() => window.App.Data.SYNC.failed, null, { timeout: 30000 }).catch(() => {});
  const nb6 = await p.locator('#netbar').innerText().catch(() => '');
  await p.evaluate(() => { location.hash = '#compare'; }); await p.waitForTimeout(400);
  const why = await p.locator('#main').innerText();
  ok('첫 방문 + 손상(홈 요약은 정상): 홈 가격 + "전체 가격을 받지 못했어요" + 다른 화면에 이유와 다시 시도', await p.evaluate(() => window.App.Data.SYNC.partial) && /전체 가격을 받지 못했어요/.test(nb6) && /체크섬|날짜|수가/.test(why) && /다시 시도/.test(why), `${nb6} / ${why.split('\n').slice(0, 3).join(' / ')}`);
  broken = false;
  await p.locator('#main .btn', { hasText: '다시 시도' }).click();
  const back = await p.waitForFunction(() => window.App.Data.SYNC.have && !document.querySelector('#load-msg'), null, { timeout: 30000 }).then(() => true).catch(() => false);
  ok('다시 시도 → 전체 가격으로 기다리던 화면이 열림', back && /^#compare/.test(await p.evaluate(() => location.hash)));
  ok('스크립트 오류 없음', !errs.length, errs.join(' | '));
  console.log(`TOTAL ${R.filter(Boolean).length}/${R.length} PASS`); await b.close(); process.exitCode = R.every(Boolean) ? 0 : 1;
})();
