// Deployment check (round-2 R11): the page's Content-Security-Policy must allow exactly the origins app/config.js will call.
// A server API origin set in config.js but missing from connect-src is blocked by the browser (every paid call fails); an
// origin in the CSP that nothing uses is an unneeded opening. Run before each deploy: node tools/check_csp.js [appDir]
// Exit 0 = consistent. Toss checkout script origins are listed in TOSS_ORIGINS and are NOT verified against a live Toss page
// (docs/STORE_READINESS.md: confirm them against Toss's current integration guide before the first sandbox run).
const fs = require("node:fs");
const path = require("node:path");
const dir = path.resolve(process.argv[2] || path.join(__dirname, "../app"));
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const cfgSrc = fs.readFileSync(path.join(dir, "config.js"), "utf8");
const TOSS_ORIGINS = ["https://js.tosspayments.com", "https://api.tosspayments.com"];
// read-only origins the app calls on its own, not the commerce API: the price factory's run status (app/screens/ops.js)
const KNOWN_ORIGINS = ["https://yoonsiljang-factory.lsy2825.workers.dev"];

function check(htmlText, cfgText) {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(htmlText);
  if (!m) return { ok: false, problems: ["CSP meta tag not found"] };
  const dirs = Object.fromEntries(m[1].split(";").map((s) => s.trim().split(/\s+/)).filter((x) => x[0]).map(([k, ...v]) => [k, v]));
  const connect = dirs["connect-src"] || [], script = dirs["script-src"] || [];
  const win = {}; new Function("window", cfgText)(win);
  const cfg = win.APP_CONFIG || {}, problems = [], notes = [];
  const origin = (u) => { try { return new URL(u).origin; } catch (e) { return null; } };
  const allows = (list, o) => list.includes(o) || list.some((x) => x.includes("*") && new RegExp("^" + x.replace(/[.]/g, "\\.").replace("*", "[^.]+") + "$").test(o));
  const api = cfg.commerce && cfg.commerce.apiBase ? origin(cfg.commerce.apiBase) : null;
  if (cfg.commerce && cfg.commerce.apiBase && !api) problems.push(`commerce.apiBase is not a URL: ${cfg.commerce.apiBase}`);
  if (api && !api.startsWith("https://")) problems.push(`commerce.apiBase must be https: ${api}`);
  if (api && !allows(connect, api)) problems.push(`connect-src is missing the API origin ${api}`);
  if (cfg.supabaseUrl && !allows(connect, origin(cfg.supabaseUrl))) problems.push(`connect-src is missing ${origin(cfg.supabaseUrl)}`);
  if (cfg.commerce && cfg.commerce.mode === "WEB_PG") {
    for (const o of TOSS_ORIGINS) if (!allows(script, o) && !allows(connect, o)) problems.push(`Toss origin ${o} is not allowed (script-src/connect-src)`);
    notes.push("Toss origins are taken from the integration guide as read on 2026-10-14 — re-check before the sandbox run");
  }
  if (!api && connect.some((x) => /workers\.dev|yoonsiljang/.test(x) && !KNOWN_ORIGINS.includes(x))) problems.push("connect-src allows an API origin but commerce.apiBase is empty");
  if (script.some((x) => x === "'unsafe-inline'" || x === "'unsafe-eval'")) problems.push("script-src must not allow inline/eval scripts");
  return { ok: !problems.length, problems, notes, connect, api };
}
module.exports = { check };
if (require.main === module) {
  const r = check(html, cfgSrc);
  console.log(JSON.stringify(r, null, 1));
  process.exit(r.ok ? 0 : 1);
}
