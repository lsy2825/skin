// Deployment check (round-2 R11, 6.0 약속 5): the page's Content-Security-Policy must allow exactly the origins app/config.js
// will call. A server address set in config.js but missing from connect-src is blocked by the browser (every call fails
// quietly); an origin in the CSP that nothing uses is an unneeded opening. Run before each deploy: node tools/check_csp.js [appDir]
// Exit 0 = consistent. The addresses are the 6.0 Workers chat A runs (metricsApi = cf/metrics); a new one goes in API_KEYS.
const fs = require("node:fs");
const path = require("node:path");
const dir = path.resolve(process.argv[2] || path.join(__dirname, "../app"));
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const cfgSrc = fs.readFileSync(path.join(dir, "config.js"), "utf8");
// config.js keys that hold a server address the app calls with fetch/sendBeacon (connect-src)
const API_KEYS = ["metricsApi"];
// read-only origins the app calls on its own, not from config.js: the price factory's run status (app/screens/ops.js)
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
  const apis = {};
  for (const key of API_KEYS) {
    const v = cfg[key];
    if (!v) continue;
    const o = origin(v);
    if (!o) { problems.push(`${key} is not a URL: ${v}`); continue; }
    if (!o.startsWith("https://")) { problems.push(`${key} must be https: ${o}`); continue; }
    apis[key] = o;
    if (!allows(connect, o)) problems.push(`connect-src is missing the ${key} origin ${o}`);
  }
  // the app's own rule for the address (app/domain/metrics.js): with metrics on, an address it refuses means nothing is sent
  if (cfg.metrics === true && !require("../app/domain/metrics.js").endpoint(cfg))
    problems.push("metrics is on but metricsApi is not a plain https address (empty, a query, fragment or login) — the app sends nothing");
  if (cfg.supabaseUrl && !allows(connect, origin(cfg.supabaseUrl))) problems.push(`connect-src is missing ${origin(cfg.supabaseUrl)}`);
  const used = new Set([...Object.values(apis), ...KNOWN_ORIGINS]);
  for (const x of connect) if (/workers\.dev|yoonsiljang/.test(x) && !used.has(x)) problems.push(`connect-src allows ${x} but no config.js address uses it`);
  if (script.some((x) => x === "'unsafe-inline'" || x === "'unsafe-eval'")) problems.push("script-src must not allow inline/eval scripts");
  return { ok: !problems.length, problems, notes, connect, apis };
}
module.exports = { check, API_KEYS };
if (require.main === module) {
  const r = check(html, cfgSrc);
  console.log(JSON.stringify(r, null, 1));
  process.exit(r.ok ? 0 : 1);
}
