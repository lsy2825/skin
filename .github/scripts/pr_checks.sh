#!/usr/bin/env bash
# PR checks: the fast suites that need no browser, no PIN, no database and no network — the same commands the price factory
# runs before every deploy (tools/factory.sh checks()) plus the quick suites of tests/run_regression.sh. Run by
# .github/workflows/pr-checks.yml on every pull request to main; also runnable locally: bash .github/scripts/pr_checks.sh
# Runs every suite even after a failure, prints one line per suite, writes a GitHub error annotation per failed suite and
# exits 1 if any failed. tests/security/pr_checks.test.js keeps this list in step with factory.sh and run_regression.sh.
set -u
cd "$(dirname "$0")/../.."
fail=0; failed=()
check() {
  local name="$1"; shift
  local out rc
  out=$("$@" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then echo "OK   | $name"
  else
    echo "FAIL | $name"; printf '%s\n' "$out" | grep -E 'not ok|FAIL|Error|Traceback|assert' | head -12
    [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=PR check failed::$name"
    fail=1; failed+=("$name")
  fi
}
# --- the price factory's own checks (tools/factory.sh checks()), in the same order
check "unit (tests/*.test.js)"            bash -c "node --test tests/*.test.js"
check "comparison keys (xkeys)"           python3 build2/xkeys.py
check "weekly value guard"                python3 tests/weekly_guard_test.py
check "taxonomy"                          python3 build2/taxonomy.py
check "treatment knowledge"               python3 build2/knowledge.py
check "secret scan"                       python3 tests/security/scan_secrets.py
check "price re-check parser"             python3 tests/verify_prices_test.py
# --- quick suites of tests/run_regression.sh (no browser, no PostgreSQL)
check "server push pieces"                bash -c "cd server && node --test test/push.test.mjs"
for d in cf/*/test; do
  ls "$d"/*.test.mjs >/dev/null 2>&1 || continue
  check "worker ${d%/test} (unit)"        bash -c "node --test $d/*.test.mjs"
done
check "security guards (tests/security/*.test.js)" bash -c "node --test tests/security/*.test.js"
check "CSP vs config origins"             node tools/check_csp.js
check "security headers (app/_headers)"   python3 tests/security/headers_test.py
check "monitoring alerts"                 python3 tests/security/monitor_test.py
check "brand collectors (saved pages)"    python3 tests/brand_parsers_test.py
check "spec labels"                       python3 tests/labels_test.py
check "branch addresses (saved pages)"    python3 tests/branch_addr_test.py
if [ $fail -ne 0 ]; then echo "failed: ${failed[*]}"; fi
exit $fail
