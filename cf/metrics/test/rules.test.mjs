// Pure rules + static promises of cf/metrics (stage list, body shape, KST day, date range, table columns, logging off).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  STAGES, MAX_BODY_BYTES, isStage, contentTypeOk, parseStageBody, kstDay, dailyRange, accessConfig,
} from "../src/rules.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const bytes = (s) => new TextEncoder().encode(s);

test("exactly the 8 stages of the brief, frozen", () => {
  assert.deepEqual([...STAGES],
    ["open", "first_price", "compare_open", "keep_cart", "keep_fav", "keep_alert", "cart_open", "return_7d"]);
  assert.ok(Object.isFrozen(STAGES));
  for (const bad of ["OPEN", " open", "open ", "", "__proto__", "constructor", "toString", "return_7d\u0000", null, 1, ["open"]]) {
    assert.equal(isStage(bad), false, String(bad));
  }
});

test("body: only {\"s\": <stage>} passes", () => {
  for (const s of STAGES) assert.deepEqual(parseStageBody(bytes(JSON.stringify({ s }))), { stage: s });
  const refused = [
    "", "nope", "null", "[]", '["open"]', '"open"', "1", "{}", '{"s":"evil"}', '{"s":"OPEN"}', '{"s":" open"}',
    '{"s":1}', '{"s":null}', '{"s":["open"]}', '{"s":{"x":1}}', '{"s":"open","t":1}', '{"s":"open","d":"2026-10-15"}',
    '{"S":"open"}', '{"__proto__":"open"}', '{"s":"constructor"}', '{"s":"open"', `{"s":"${"a".repeat(300)}"}`,
  ];
  for (const b of refused) assert.ok(parseStageBody(bytes(b)).error, b);
  assert.equal(parseStageBody(new Uint8Array([0x7b, 0xff, 0x7d])).error, "utf8");
  assert.equal(parseStageBody(bytes(" ".repeat(MAX_BODY_BYTES - 12) + '{"s":"open"}')).stage, "open");   // 256 bytes ok
  assert.equal(parseStageBody(bytes(" ".repeat(MAX_BODY_BYTES - 11) + '{"s":"open"}')).error, "size");   // 257 refused
});

test("content types: text/plain (sendBeacon string) and application/json only", () => {
  for (const ok of ["text/plain;charset=UTF-8", "text/plain", "TEXT/PLAIN; charset=utf-8", "application/json"]) {
    assert.ok(contentTypeOk(ok), ok);
  }
  for (const bad of [null, undefined, "", "application/x-www-form-urlencoded", "multipart/form-data", "text/html", "application/jsonx"]) {
    assert.equal(contentTypeOk(bad), false, String(bad));
  }
});

test("KST day rolls over at 00:00 KST (15:00 UTC), not at UTC midnight", () => {
  assert.equal(kstDay(Date.parse("2026-10-15T14:59:59.999Z")), "2026-10-15");   // 23:59:59 KST
  assert.equal(kstDay(Date.parse("2026-10-15T15:00:00.000Z")), "2026-10-16");   // 00:00 KST
  assert.equal(kstDay(Date.parse("2026-12-31T15:00:00Z")), "2027-01-01");
  assert.equal(kstDay(Date.parse("2026-10-15T00:30:00Z")), "2026-10-15");       // 09:30 KST
});

test("daily range: YYYY-MM-DD, inclusive, at most 366 days, defaults to the last 30 KST days", () => {
  const now = Date.parse("2026-10-15T16:00:00Z");   // 2026-10-16 01:00 KST
  assert.deepEqual(dailyRange(null, null, now), { from: "2026-09-17", to: "2026-10-16" });
  assert.deepEqual(dailyRange("2026-01-01", "2026-01-01", now), { from: "2026-01-01", to: "2026-01-01" });
  assert.deepEqual(dailyRange("2024-01-01", "2024-12-31", now), { from: "2024-01-01", to: "2024-12-31" });  // 366 (leap)
  assert.equal(dailyRange("2024-01-01", "2025-01-01", now).error, "span");                                   // 367
  assert.equal(dailyRange("2026-10-02", "2026-10-01", now).error, "order");
  for (const bad of ["2026-02-30", "2026-13-01", "26-10-01", "2026-10-1", "2026-10-01T00:00", "x", "2026-10-01' OR 1=1"]) {
    assert.ok(dailyRange(bad, "2026-10-15", now).error, bad);
    assert.ok(dailyRange("2026-01-01", bad, now).error, bad);
  }
});

test("Access config: empty or odd values mean not configured", () => {
  assert.equal(accessConfig({}), null);
  assert.equal(accessConfig({ ACCESS_AUD: "", ACCESS_TEAM_DOMAIN: "" }), null);
  assert.equal(accessConfig({ ACCESS_AUD: "abc", ACCESS_TEAM_DOMAIN: "" }), null);
  assert.equal(accessConfig({ ACCESS_AUD: "", ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com" }), null);
  assert.equal(accessConfig({ ACCESS_AUD: "abc", ACCESS_TEAM_DOMAIN: "evil.example.com" }), null);
  assert.equal(accessConfig({ ACCESS_AUD: "abc", ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com/../x" }), null);
  assert.deepEqual(accessConfig({ ACCESS_AUD: " abc ", ACCESS_TEAM_DOMAIN: "https://Team.cloudflareaccess.com/" }),
    { aud: "abc", issuer: "https://team.cloudflareaccess.com", certsUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/certs" });
});

test("table holds only day, stage, n — and its stage CHECK equals STAGES", () => {
  const files = readdirSync(root + "migrations");
  assert.deepEqual(files, ["0001_daily_counts.sql"]);
  const sql = read("migrations/0001_daily_counts.sql").replace(/--[^\n]*/g, "");
  const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, 1, "one statement: no extra tables, indexes or triggers");
  const m = statements[0].match(/^CREATE TABLE daily_counts \(([\s\S]*)\) WITHOUT ROWID$/);
  assert.ok(m, statements[0]);
  const defs = m[1].split(/,\s*\n/).map((d) => d.trim());
  const columns = defs.filter((d) => !/^PRIMARY KEY/.test(d)).map((d) => d.split(/\s+/)[0]);
  assert.deepEqual(columns, ["day", "stage", "n"]);
  assert.ok(defs.includes("PRIMARY KEY (day, stage)"));
  const check = statements[0].match(/stage IN \(([^)]*)\)/)[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(check, [...STAGES]);
});

// JSONC → JSON: drop // comments outside strings, then trailing commas.
function jsonc(text) {
  let out = "", inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { out += c; if (c === "\\") out += text[++i]; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

test("wrangler.jsonc: every request log and trace is off, no preview hosts, Access unset (fail closed)", () => {
  const cfg = jsonc(read("wrangler.jsonc"));
  assert.equal(cfg.name, "yoonsiljang-metrics");
  assert.equal(cfg.main, "src/index.js");
  assert.equal(cfg.preview_urls, false);
  assert.equal(cfg.logpush, false);
  const o = cfg.observability;
  assert.equal(o.enabled, false);
  assert.equal(o.logs.enabled, false);
  assert.equal(o.logs.invocation_logs, false);
  assert.equal(o.logs.persist, false);
  assert.equal(o.traces.enabled, false);
  assert.equal(o.traces.persist, false);
  assert.equal(o.issues.enabled, false);
  assert.equal(cfg.tail_consumers, undefined);
  assert.equal(cfg.streaming_tail_consumers, undefined);
  assert.equal(cfg.access, undefined, "access.dev would make every local request look authenticated");
  // nothing that could export or re-enable logs elsewhere: no OpenTelemetry destinations, no per-env or preview overrides
  assert.equal(o.logs.destinations, undefined);
  assert.equal(o.traces.destinations, undefined);
  assert.equal(cfg.env, undefined);
  assert.equal(cfg.previews, undefined);
  assert.deepEqual(cfg.d1_databases.map((d) => [d.binding, d.database_name, d.migrations_dir]), [["DB", "yoonsiljang-metrics", "migrations"]]);
  assert.equal(cfg.vars.ALLOWED_ORIGIN, "https://yoonsiljang.lsy2825.workers.dev");
  assert.equal(typeof cfg.vars.ACCESS_AUD, "string");
  assert.equal(typeof cfg.vars.ACCESS_TEAM_DOMAIN, "string");
});

test("source never touches client identity headers, cookies, the cf object or the console", () => {
  for (const f of ["src/index.js", "src/handler.js", "src/rules.js"]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");   // comments may name them
    for (const banned of [/cf-connecting-ip/i, /x-forwarded-for/i, /x-real-ip/i, /true-client-ip/i, /user-agent/i,
      /cookie/i, /\.cf\b/, /console\./, /referer/i, /\.headers\.(entries|keys|values|forEach)\b/, /\[\.\.\.\s*request\.headers/]) {
      assert.equal(banned.test(code), false, `${f} matches ${banned}`);
    }
  }
});

test("the entry module has only a default export (workerd rejects named exports that are not handlers)", () => {
  const exports = read("src/index.js").split("\n").filter((l) => /^\s*export\b/.test(l));
  assert.deepEqual(exports, ["export default createHandler();"]);
});
