#!/usr/bin/env bash
# Local integration check of cf/metrics on the real runtime (workerd) with a local D1 — no Cloudflare account, no deploy.
#   bash cf/metrics/test/local_dev.sh
# Applies the migration to a throwaway state folder, starts `wrangler dev`, sends good and bad beacons with curl (some carrying
# fake client IP / browser / cookie headers), reads the table back with `wrangler d1 execute --local`, then greps every byte
# of the local state (D1 sqlite + WAL) for those markers, checks GET /v1/m/daily → 403, and stops the server by its PID.
# wrangler 4.145.0's local runtime accepts compatibility dates only up to 2026-10-07, hence the override below.
set -euo pipefail
cd "$(dirname "$0")/../../.."
CFG=cf/metrics/wrangler.jsonc
DB=yoonsiljang-metrics
WR=(npx --yes wrangler@4.145.0)
export WRANGLER_SEND_METRICS=false
APP=https://yoonsiljang.lsy2825.workers.dev
IP=203.0.113.77; XFF=198.51.100.23; UA=ua-marker-ProbeUA/9.9; COOKIE=cookie-marker-7f3

STATE=$(mktemp -d "${TMPDIR:-/tmp}/metrics-state.XXXXXX")
LOG=$(mktemp "${TMPDIR:-/tmp}/metrics-dev.XXXXXX")
free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }
PORT=$(free_port); INSPECT=$(free_port)
PID=""
cleanup() {
  if [ -n "$PID" ]; then kill -- "-$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  rm -rf "$STATE" "$LOG"
}
trap cleanup EXIT
fail() { echo "FAIL: $*"; echo "--- wrangler dev log (tail) ---"; tail -20 "$LOG" || true; exit 1; }
pass() { echo "ok   $*"; }

echo "== migration (local)"
"${WR[@]}" d1 migrations apply "$DB" --local --persist-to "$STATE" --config "$CFG" 2>&1 | grep -E "0001_daily_counts|No migrations|✅|ERROR" || fail "migration"

echo "== wrangler dev on 127.0.0.1:$PORT"
# setsid: the server gets its own process group, so the cleanup kills npx, wrangler and workerd together by PID.
setsid "${WR[@]}" dev --local --config "$CFG" --compatibility-date 2026-10-07 --ip 127.0.0.1 --port "$PORT" \
  --inspector-port "$INSPECT" --persist-to "$STATE" --show-interactive-dev-session=false >"$LOG" 2>&1 &
PID=$!
for _ in $(seq 1 90); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then break; fi
  kill -0 "$PID" 2>/dev/null || fail "wrangler dev exited"
  sleep 1
done
curl -s -o /dev/null "http://127.0.0.1:$PORT/" || fail "server did not start"
pass "server up (pid $PID)"

URL="http://127.0.0.1:$PORT/v1/m"
post() {   # post <expected status> <body> [extra curl args...]
  local want="$1" body="$2"; shift 2
  local got; got=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H "Content-Type: text/plain;charset=UTF-8" --data-binary "$body" "$@")
  [ "$got" = "$want" ] || fail "POST ${body:0:40} → $got (want $want)"
  pass "POST ${body:0:40} → $got"
}

echo "== the 8 stages are counted"
for s in open first_price compare_open keep_cart keep_fav keep_alert cart_open return_7d; do post 204 "{\"s\":\"$s\"}" -H "Origin: $APP"; done
post 204 '{"s":"open"}' -H "Origin: $APP"
echo "== a beacon carrying fake client IP / browser / cookie headers"
post 204 '{"s":"keep_cart"}' -H "Origin: $APP" -H "CF-Connecting-IP: $IP" -H "X-Forwarded-For: $XFF, $IP" \
  -H "X-Real-IP: $IP" -H "User-Agent: $UA" -H "Cookie: sid=$COOKIE" -H "Referer: $APP/?ip=$IP"
echo "== everything else is refused"
post 400 '{"s":"evil"}' -H "Origin: $APP"
post 400 '{"s":"OPEN"}' -H "Origin: $APP"
post 400 '{"s":"open","t":1}' -H "Origin: $APP"
post 400 '{"s":1}' -H "Origin: $APP"
post 400 'nope' -H "Origin: $APP"
post 413 "{\"s\":\"open\",\"p\":\"$(printf 'x%.0s' $(seq 1 300))\"}" -H "Origin: $APP"
post 403 '{"s":"open"}'
post 403 '{"s":"open"}' -H "Origin: https://evil.example"
got=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H "Origin: $APP" -H "Content-Type: application/x-www-form-urlencoded" --data-binary '{"s":"open"}')
[ "$got" = 415 ] || fail "form content type → $got"; pass "form content type → 415"
got=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$URL" -H "Origin: $APP" -H "Access-Control-Request-Method: POST")
[ "$got" = 204 ] || fail "preflight → $got"; pass "OPTIONS (app origin) → 204"
got=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/v1/m/daily")
[ "$got" = 403 ] || fail "daily without Access → $got"; pass "GET /v1/m/daily (no Access) → 403"
got=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/v1/m/daily" -H "Cf-Access-Jwt-Assertion: x.y.z")
[ "$got" = 403 ] || fail "daily with a forged header → $got"; pass "GET /v1/m/daily (forged JWT header) → 403"
got=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/" -H "Origin: $APP" --data-binary '{"s":"open"}')
[ "$got" = 404 ] || fail "trailing slash → $got"; pass "POST /v1/m/ → 404 (no redirect)"

echo "== local D1 contents"
ROWS=$("${WR[@]}" d1 execute "$DB" --local --persist-to "$STATE" --config "$CFG" --json \
  --command "SELECT day, stage, n FROM daily_counts ORDER BY stage" 2>/dev/null)
COLS=$("${WR[@]}" d1 execute "$DB" --local --persist-to "$STATE" --config "$CFG" --json \
  --command "SELECT name FROM pragma_table_info('daily_counts')" 2>/dev/null)
TABLES=$("${WR[@]}" d1 execute "$DB" --local --persist-to "$STATE" --config "$CFG" --json \
  --command "SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name" 2>/dev/null)
ROWS="$ROWS" COLS="$COLS" TABLES="$TABLES" python3 - <<'PY' || fail "table contents"
import json, os
rows = json.loads(os.environ["ROWS"])[0]["results"]
cols = [c["name"] for c in json.loads(os.environ["COLS"])[0]["results"]]
tables = [t["name"] for t in json.loads(os.environ["TABLES"])[0]["results"]]
for r in rows: print(f"     {r['day']}  {r['stage']:<13} {r['n']}")
assert cols == ["day", "stage", "n"], cols
assert tables == ["d1_migrations", "daily_counts"], tables
counts = {r["stage"]: r["n"] for r in rows}
assert len({r["day"] for r in rows}) == 1, rows
assert counts == {"open": 2, "first_price": 1, "compare_open": 1, "keep_cart": 2, "keep_fav": 1, "keep_alert": 1,
                  "cart_open": 1, "return_7d": 1}, counts
print("ok   columns", cols, "| tables", tables, "| 8 rows, refused requests wrote nothing")
PY

echo "== no IP / browser / cookie anywhere in the local state (D1 sqlite + WAL) or the server output"
SQL_FILES=$(find "$STATE" -type f \( -name '*.sqlite' -o -name '*.sqlite-wal' -o -name '*.sqlite-shm' \) | wc -l)
[ "$SQL_FILES" -gt 0 ] || fail "no sqlite file found under the state folder"
grep -rqa keep_cart "$STATE" || fail "positive control: 'keep_cart' not found, so grep cannot see the sqlite data"
pass "positive control: stage names are visible to grep in $SQL_FILES sqlite file(s)"
if grep -rla -e "$IP" -e "$XFF" -e "ua-marker" -e "$COOKIE" "$STATE" "$LOG"; then fail "a client marker was stored or printed (files above)"; fi
if [ -d cf/metrics/.wrangler ] && grep -rla -e "$IP" -e "$XFF" -e "ua-marker" -e "$COOKIE" cf/metrics/.wrangler; then fail "marker in cf/metrics/.wrangler"; fi
pass "markers $IP / $XFF / ua-marker / $COOKIE: 0 hits"

echo "== stop the server"
kill -- "-$PID" 2>/dev/null || kill "$PID"
wait "$PID" 2>/dev/null || true
PID=""
sleep 1
if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then fail "port $PORT still answers"; fi
pass "server stopped, port $PORT closed"
echo "LOCAL DEV CHECK PASSED"
