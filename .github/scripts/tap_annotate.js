// node .github/scripts/tap_annotate.js <tap file>
// Reads the TAP output of `node --test --test-reporter=tap` and prints the totals plus one GitHub error annotation per
// failing test (file and line from the test's location, so the PR's Files tab shows it next to the test). Used by the
// Windows job of .github/workflows/pr-checks.yml. Prints only test names and assertion messages (no environment).
"use strict";
const fs = require("fs");
const file = process.argv[2];
if (!file) { console.error("usage: node tap_annotate.js <tap file>"); process.exit(2); }
let text = "";
try { text = fs.readFileSync(file, "utf8"); } catch (e) { console.log(`::error title=Windows unit tests::no TAP output (${e.code || e.message})`); process.exit(0); }
const lines = text.split(/\r?\n/);
for (const l of lines) if (/^# (tests|pass|fail|skipped|todo|cancelled) \d+$/.test(l)) console.log(l);
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
const failures = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\s*not ok \d+ - (.*)$/);
  if (!m || /# SKIP/.test(lines[i])) continue;
  // the YAML block under the line: location and error
  const block = [];
  for (let j = i + 1; j < lines.length && !/^\s*(ok|not ok) \d+ /.test(lines[j]) && !/^# Subtest:/.test(lines[j].trim()); j++) block.push(lines[j]);
  const yaml = block.join("\n");
  const loc = (yaml.match(/location: '([^']+)'/) || [])[1] || "";
  const at = loc.replace(/\\\\/g, "/").replace(/\\/g, "/").match(/(tests\/[^:]+):(\d+):\d+$/);
  // a parent test that failed only because a subtest failed has no location of its own: report the subtest only
  if (!at && /subtestsFailed/.test(yaml)) continue;
  const err = ((yaml.match(/error: \|-\n([\s\S]*?)\n\s+code:/) || [])[1] || (yaml.match(/error: (.*)/) || [])[1] || "").replace(/\s+/g, " ").trim();
  failures.push({ name: m[1].trim(), file: at ? at[1] : "", line: at ? at[2] : "", err });
}
for (const f of failures.slice(0, 50)) {
  const where = f.file ? `file=${escProp(f.file)},line=${f.line},` : "";
  console.log(`::error ${where}title=${escProp("Windows: " + f.name.slice(0, 120))}::${esc(f.err.slice(0, 900) || "failed")}`);
}
if (failures.length > 50) console.log(`::error title=Windows unit tests::${failures.length - 50} more failures (see the log)`);
