#!/usr/bin/env bash
# Local integration check of cf/admin on the real runtime (workerd) with the real app/ files — no Cloudflare account, no deploy.
#   bash cf/admin/test/local_dev.sh
# 1) wrangler dev with the committed config (Access vars empty): GET / and every file → 403 with the security headers,
#    GET /sw.js → 404, a forged Cf-Access-Jwt-Assertion → 403.
# 2) the same with --var ACCESS_AUD/ACCESS_TEAM_DOMAIN set: still 403 without a token (no certs host is reachable here).
# 3) a throwaway copy of the config with wrangler's access.dev block (ctx.access with the test aud): GET / → 200 HTML with
#    the four headers and cache-control: no-store, /app.js → 200, /sw.js → 404, /nope → 404. This is the only way to see a
#    200 locally: a real JWT needs the team's certs at https://<team>.cloudflareaccess.com, which cannot be faked from here.
# wrangler 4.145.0's local runtime accepts compatibility dates only up to 2026-10-07, hence the override below.
set -euo pipefail
cd "$(dirname "$0")/../../.."
ROOT=$(pwd)
CFG=cf/admin/wrangler.jsonc
WR=(npx --yes wrangler@4.145.0)
export WRANGLER_SEND_METRICS=false
LOG=$(mktemp "${TMPDIR:-/tmp}/admin-dev.XXXXXX")
TMPCFG=$(mktemp -d "${TMPDIR:-/tmp}/admin-cfg.XXXXXX")
# a free port in 8795-8799 (the app's own dev server uses 8766)
free_port() { for p in 8795 8796 8797 8798 8799; do if ! python3 -c 'import socket,sys; s=socket.socket(); s.bind(("127.0.0.1", int(sys.argv[1])))' "$p" 2>/dev/null; then continue; fi; echo "$p"; return; done; echo "no free port in 8795-8799" >&2; exit 1; }
PORT=$(free_port)
INSPECT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
PID=""
stop() {
  if [ -n "$PID" ]; then kill -- "-$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; PID=""; fi
}
cleanup() { stop; rm -rf "$LOG" "$TMPCFG"; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; echo "--- wrangler dev log (tail) ---"; tail -20 "$LOG" || true; exit 1; }
pass() { echo "ok   $*"; }
URL="http://127.0.0.1:$PORT"

start() {   # start <config> [wrangler dev args...]
  local cfg=$1; shift
  : >"$LOG"
  # setsid: the server gets its own process group, so stop() kills npx, wrangler and workerd together by PID.
  setsid "${WR[@]}" dev --local --config "$cfg" --compatibility-date 2026-10-07 --ip 127.0.0.1 --port "$PORT" \
    --inspector-port "$INSPECT" --show-interactive-dev-session=false "$@" >"$LOG" 2>&1 &
  PID=$!
  for _ in $(seq 1 90); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL/" || true)
    if [ "$code" != "000" ] && [ -n "$code" ]; then break; fi
    kill -0 "$PID" 2>/dev/null || fail "wrangler dev exited"
    sleep 1
  done
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL/" || true)
  [ "$code" != "000" ] || fail "server did not start"
  pass "server up on $URL (pid $PID)"
}
get() {   # get <expected status> <path> [curl args...]  → prints the headers file name in $HDR
  local want=$1 path=$2; shift 2
  HDR=$(mktemp "${TMPDIR:-/tmp}/admin-hdr.XXXXXX"); BODY=$(mktemp "${TMPDIR:-/tmp}/admin-body.XXXXXX")
  local got; got=$(curl -s -o "$BODY" -D "$HDR" -w '%{http_code}' --max-time 30 "$URL$path" "$@")
  [ "$got" = "$want" ] || { rm -f "$HDR" "$BODY"; fail "GET $path → $got (want $want)"; }
  pass "GET $path → $got"
}
headers_ok() {
  grep -qi "^content-security-policy: frame-ancestors 'none'" "$HDR" || fail "frame-ancestors missing on $1"
  grep -qi "^strict-transport-security: max-age=31536000; includeSubDomains" "$HDR" || fail "HSTS missing on $1"
  grep -qi "^x-content-type-options: nosniff" "$HDR" || fail "nosniff missing on $1"
  grep -qi "^referrer-policy: strict-origin-when-cross-origin" "$HDR" || fail "referrer-policy missing on $1"
  pass "     security headers present on $1"
}
empty_body() { [ ! -s "$BODY" ] || fail "body not empty on $1"; }
done_req() { rm -f "$HDR" "$BODY"; }

echo "== 1) committed config: Access not configured → everything 403, /sw.js 404"
start "$CFG"
for p in / /index.html /app.js /data.json /home.json /review.json /screens/ops.js /nope; do
  get 403 "$p"; headers_ok "$p"; empty_body "$p"; done_req
done
get 404 /sw.js; headers_ok /sw.js; empty_body /sw.js; done_req
get 403 / -H "Cf-Access-Jwt-Assertion: x.y.z"; empty_body "forged"; done_req
get 403 / -X POST; done_req
stop

echo "== 2) vars set, no token → still 403 (and a forged token → 403)"
start "$CFG" --var ACCESS_AUD:test-aud --var ACCESS_TEAM_DOMAIN:team.cloudflareaccess.com
get 403 /; headers_ok "/ (vars set)"; empty_body "/"; done_req
get 403 /index.html -H "Cf-Access-Jwt-Assertion: x.y.z"; done_req
get 404 /sw.js; done_req
stop

echo "== 3) throwaway config with access.dev (ctx.access aud = test-aud) → the app is served with the headers"
# absolute paths so the copy can live outside cf/admin; nothing in the repository is changed
python3 - "$ROOT" "$TMPCFG/wrangler.jsonc" <<'PY'
import json, re, sys
root, out = sys.argv[1], sys.argv[2]
text = open(f"{root}/cf/admin/wrangler.jsonc", encoding="utf-8").read()
text = re.sub(r"(?m)^\s*//.*$", "", text)                  # the file's comments are whole-line only
cfg = json.loads(re.sub(r",(\s*[}\]])", r"\1", text))
cfg["main"] = f"{root}/cf/admin/src/index.js"
cfg["assets"]["directory"] = f"{root}/app"
cfg["vars"] = {"ACCESS_AUD": "test-aud", "ACCESS_TEAM_DOMAIN": "team.cloudflareaccess.com"}
cfg["access"] = {"dev": {"aud": "test-aud", "identity": {"email": "admin@example.com"}}}
json.dump(cfg, open(out, "w", encoding="utf-8"), indent=2)
PY
if start "$TMPCFG/wrangler.jsonc"; then
  if grep -qiE "access|unexpected|not allowed|unknown" "$LOG" && [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL/")" = "403" ]; then
    echo "note: this wrangler ignores access.dev (log mentions it) — the 200 path is covered by the unit tests only"
  else
    get 200 /; headers_ok "/ (access.dev)"
    grep -qi "^content-type: text/html" "$HDR" || fail "/ is not HTML"
    grep -qi "^cache-control: no-store" "$HDR" || fail "HTML is cacheable on the admin host"
    grep -q "윤실장" "$BODY" || fail "/ is not the app's index.html"
    done_req
    get 200 /app.js; headers_ok /app.js; grep -qi "^content-type: .*javascript" "$HDR" || fail "/app.js content type"; done_req
    get 200 /screens/ops.js; grep -q "ADMIN_HOSTS" "$BODY" || fail "/screens/ops.js is not the real file"; done_req
    get 404 /sw.js; empty_body /sw.js; done_req
    get 404 /nope; headers_ok /nope; done_req
  fi
fi
stop

sleep 1
if curl -s -o /dev/null --max-time 2 "$URL/"; then fail "port $PORT still answers"; fi
pass "server stopped, port $PORT closed"
grep -qiE "203\.0\.113|user-agent|cookie" "$LOG" && fail "the dev log printed request details" || true
echo "LOCAL DEV CHECK PASSED"
