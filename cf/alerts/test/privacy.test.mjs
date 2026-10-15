// node --test cf/alerts/test/*.test.mjs — a static guard on every console.* call in the Worker and the factory runner, and
// on every log(...) call of notify.mjs (its `log` parameter, default console.log — the factory-side logging path): an
// argument may only be a string literal (no ${} but `${e && e.message}`), JSON.stringify(out) (the counts object) or
// `e && e.message` (an error's message — D1/runtime errors name no request data). So a console.log(request.headers),
// console.error("x", err), console.log(id) or a template with an endpoint can never get in. The behavioural tests
// (worker.test.mjs) run the error and abuse branches under a console spy on top of this.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const FILES = [...readdirSync(new URL("src/", ROOT)).filter((f) => f.endsWith(".js")).map((f) => `src/${f}`), "notify.mjs"];
// what an argument may look like (whitespace-trimmed)
const ALLOWED = [
  /^"(?:[^"\\]|\\.)*"$/,                              // "a string literal"
  /^'(?:[^'\\]|\\.)*'$/,
  /^`(?:[^`\\$]|\\.|\$(?!\{)|\$\{e && e\.message\})*`$/,   // `a template` with only ${e && e.message} inside
  /^JSON\.stringify\(out\)$/,
  /^e && e\.message$/,
];

// the arguments of a call that starts at `open` (the index of its '('), split at top-level commas; strings and templates
// are skipped over, nested parentheses/brackets/braces are balanced
function argsOf(src, open) {
  let depth = 0, i = open, start = open + 1, quote = null;
  const out = [];
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      depth--;
      if (depth === 0) { out.push(src.slice(start, i).trim()); return { args: out.filter(Boolean), end: i }; }
    } else if (c === "," && depth === 1) { out.push(src.slice(start, i).trim()); start = i + 1; }
  }
  throw new Error("unbalanced call");
}

test("every console.* call in src/*.js and notify.mjs logs only string literals, JSON.stringify(out) or e && e.message", () => {
  let calls = 0;
  for (const file of FILES) {
    const src = readFileSync(new URL(file, ROOT), "utf8");
    // console.<method>( — a bare `console.log` passed as a value (notify.mjs: log = console.log) is not a call
    for (const m of src.matchAll(/\bconsole\.(\w+)\s*\(/g)) {
      // skip calls inside comments (// …) — those are prose
      const lineStart = src.lastIndexOf("\n", m.index) + 1;
      if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, m.index))) continue;
      calls++;
      const { args } = argsOf(src, m.index + m[0].length - 1);
      assert.ok(args.length >= 1, `${file}: console.${m[1]} with no argument`);
      for (const a of args) assert.ok(ALLOWED.some((re) => re.test(a)), `${file}: console.${m[1]}(${a}) — only string literals, JSON.stringify(out) or e && e.message may be logged`);
    }
  }
  assert.ok(calls >= 9, `found only ${calls} console calls — the pattern missed some`);
});

// notify.mjs logs through its `log` parameter. A message there may only be a string literal or a template whose every
// placeholder is one of these count expressions (numbers from the Worker's answer and the data, or shapeProblems()'s count
// phrases). Anything new — an id, endpoint, URL, key, region name — needs a deliberate edit of this list.
const LOG_PLACEHOLDERS = ["pairs.length", "done.changed", "ending", "done.weekly", "done.expiring", 'problems.join("; ")'];
function logArgOk(a) {
  if (/^"(?:[^"\\]|\\.)*"$/.test(a) || /^'(?:[^'\\]|\\.)*'$/.test(a)) return true;
  if (!/^`(?:[^`\\]|\\.)*`$/.test(a)) return false;
  const holes = [...a.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
  return holes.every((h) => LOG_PLACEHOLDERS.includes(h)) && !/\$\{[^}]*\{/.test(a);
}
test("every log(...) call in notify.mjs is a literal or a template of count placeholders only", () => {
  const src = readFileSync(new URL("notify.mjs", ROOT), "utf8");
  let calls = 0;
  // (?<![.\w]) — a bare log( call, not console.log( (the other test) nor a name ending in log
  for (const m of src.matchAll(/(?<![.\w])log\s*\(/g)) {
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, m.index))) continue;       // a comment
    calls++;
    const { args } = argsOf(src, m.index + m[0].length - 1);
    assert.equal(args.length, 1, `log() takes exactly one message: ${args.join(" , ")}`);
    assert.ok(logArgOk(args[0]), `notify.mjs log(${args[0]}) — only literals and count placeholders (${LOG_PLACEHOLDERS.join(", ")}) may be logged`);
  }
  assert.ok(calls >= 2, `found only ${calls} log() calls — the pattern missed some`);
});

test("the log(...) guard catches what it should (secret, url, id, endpoint, key in a message)", () => {
  const bad = ['`debug ${secret} ${url}`', "`push ${s.endpoint}`", "`pair ${p.k}`", "`${pairs.length} ${id}`", 'a + b', "`x ${pairs.length + secret}`", "secret", "`${done.changed ? secret : 1}`"];
  for (const b of bad) assert.equal(logArgOk(b), false, b);
  for (const g of ['"plain"', "`${pairs.length} pairs, ${done.changed} changed`", '`shape (${problems.join("; ")})`']) assert.equal(logArgOk(g), true, g);
});

test("the guard itself catches what it should", () => {
  const bad = ['console.log("x", request.headers)', "console.error(`push ${s.endpoint} failed`)", "console.log(id)", "console.log(JSON.stringify(row))", 'console.log("a" + ip)',
    "console.error(e)", "console.log(`${e && e.message} ${id}`)"];
  for (const b of bad) {
    const { args } = argsOf(b, b.indexOf("("));
    assert.equal(args.every((a) => ALLOWED.some((re) => re.test(a))), false, b);
  }
  const good = ['console.log("alerts finish", JSON.stringify(out))', 'console.error("alerts error", e && e.message)', "console.log(`::warning title=x::failed (${e && e.message}) — next`)", 'console.log("a (b, c)")'];
  for (const g of good) {
    const { args } = argsOf(g, g.indexOf("("));
    assert.equal(args.every((a) => ALLOWED.some((re) => re.test(a))), true, g);
  }
});
