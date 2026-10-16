#!/usr/bin/env bash
# Local check of the alerts Worker in the real runtime (workerd via wrangler dev) with a local D1:
#   bash cf/alerts/test/local_dev.sh
# migrate a throw-away local D1 → wrangler dev on a free port (8795-8799) → subscribe / rules / delete / factory export
# with curl → notify.mjs on app/data.json against it → stop wrangler by its process group. Needs node + npx (no account,
# no network to Cloudflare). The factory secret is made up for this run only.
set -euo pipefail
cd "$(dirname "$0")/../../.."
WRANGLER=${WRANGLER:-npx --yes wrangler@4.145.0}
CONF=cf/alerts/wrangler.jsonc
export WRANGLER_SEND_METRICS=false
STATE=$(mktemp -d)
LOG=$STATE/dev.log
SECRET=$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')
# a throw-away VAPID pair for this run (the real one is made once with vapid-keygen.mjs and never written to a file). Only
# the private JWK goes to the Worker, as in production: it derives the public key itself (GET /health "key" must be VPUB).
KEYS=$(node -e 'const {generateKeyPairSync}=require("crypto");const {publicKey,privateKey}=generateKeyPairSync("ec",{namedCurve:"P-256"});
const j=privateKey.export({format:"jwk"});const p=publicKey.export({format:"jwk"});
console.log(Buffer.concat([Buffer.from([4]),Buffer.from(p.x,"base64url"),Buffer.from(p.y,"base64url")]).toString("base64url"));console.log(JSON.stringify(j))')
VPUB=$(echo "$KEYS" | sed -n 1p); VJWK=$(echo "$KEYS" | sed -n 2p)
PORT=""
for p in 8795 8796 8797 8798 8799; do
  if ! (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; then PORT=$p; break; fi
done
[ -n "$PORT" ] || { echo "no free port in 8795-8799" >&2; exit 1; }
BASE=http://127.0.0.1:$PORT
APP=https://yoonsiljang.lsy2825.workers.dev
PID=""
cleanup() { if [ -n "$PID" ]; then kill -- -"$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi; rm -rf "$STATE"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; echo "--- wrangler log ---" >&2; tail -30 "$LOG" >&2 || true; exit 1; }

echo "== migrate local D1"
$WRANGLER d1 migrations apply DB --local --config "$CONF" --persist-to "$STATE" >"$STATE/migrate.log" 2>&1 || { cat "$STATE/migrate.log"; exit 1; }

echo "== wrangler dev on :$PORT"
setsid $WRANGLER dev --local --config "$CONF" --port "$PORT" --ip 127.0.0.1 --persist-to "$STATE" \
  --compatibility-date 2026-10-07 --test-scheduled --var "ALERTS_SECRET:$SECRET" --var "DEV_ORIGINS:http://localhost:8766" \
  --var "VAPID_PRIVATE_JWK:$VJWK" >"$LOG" 2>&1 &
PID=$!
for _ in $(seq 1 90); do curl -fsS "$BASE/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$BASE/health" >/dev/null 2>&1 || fail "wrangler dev did not start"

# req METHOD PATH [BODY] [extra curl args...] → prints "STATUS BODY"
req() { local m=$1 p=$2 b=${3:-}; shift 3 || shift $#
  if [ -n "$b" ]; then curl -sS -o "$STATE/out" -w '%{http_code}' -X "$m" "$BASE$p" -H "content-type: application/json" --data "$b" "$@"
  else curl -sS -o "$STATE/out" -w '%{http_code}' -X "$m" "$BASE$p" "$@"; fi
  echo " $(cat "$STATE/out")"; }
expect() { local want=$1 got=$2 what=$3; [ "${got%% *}" = "$want" ] || fail "$what: want $want, got $got"; echo "ok   $what → ${got:0:90}"; }

H=$(req GET /health); expect 200 "$H" "health (D1 answers)"
case "$H" in *'{"ok":true,'*'"sending":true'*) ;; *) fail "health should be {\"ok\":true,…,\"sending\":true} with a matching VAPID pair";; esac
case "$H" in *'"key":"'"$VPUB"'"'*) ;; *) fail "health should show the public key derived from VAPID_PRIVATE_JWK: $H";; esac
case "$H" in *'"refusing":false'*) ;; *) fail "health should carry refusing false: $H";; esac
case "$H" in *'"capacity":"ok"'*'"stale":false'*|*'"stale":false'*'"capacity":"ok"'*) ;; *) fail "health should carry capacity ok and stale false: $H";; esac

SUB='{"subscription":{"endpoint":"https://fcm.googleapis.com/fcm/send/local-dev-1","keys":{"p256dh":"'$(printf 'B%.0s' $(seq 87))'","auth":"aaaaaaaaaaaaaaaaaaaaaa"}},"rules":[{"kind":"watch","key":"X24"},{"kind":"target","key":"X24","max":150000,"region":"서울"},{"kind":"expiring","key":"X01"}]}'
R=$(req POST /v1/push/subscribe "$SUB" -H "origin: $APP"); expect 201 "$R" "subscribe"
ID=$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "${R#* }")
[[ "$ID" =~ ^[A-Za-z0-9_-]{22}$ ]] || fail "id shape"
expect 403 "$(req POST /v1/push/subscribe "$SUB" -H 'origin: https://evil.example')" "foreign origin refused"
expect 204 "$(req OPTIONS /v1/push/subscribe '' -H "origin: $APP" -H 'access-control-request-method: POST')" "preflight"
expect 400 "$(req POST /v1/push/subscribe '{"subscription":{"endpoint":"https://evil.example/x","keys":{}},"rules":[{"kind":"watch","key":"X24"}]}')" "unknown push host"
expect 400 "$(req POST /v1/push/subscribe "${SUB%%,\"rules\"*},\"rules\":[]}")" "empty rules refused"
expect 413 "$(head -c 9000 /dev/zero | tr '\0' ' ' | curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/push/subscribe" -H 'content-type: application/json' -H 'transfer-encoding: chunked' --data-binary @-)" "chunked body over 8 KB (no Content-Length)"
RULES21=$(node -e 'console.log(JSON.stringify({rules:Array.from({length:21},(_,i)=>({kind:"watch",key:"X"+String(i+1).padStart(2,"0")}))}))')
expect 400 "$(req PUT "/v1/push/rules/$ID" "$RULES21")" "21 rules refused"
expect 200 "$(req PUT "/v1/push/rules/$ID" '{"rules":[{"kind":"expiring","key":"X01"},{"kind":"watch","key":"X24"},{"kind":"target","key":"X24","max":150000,"region":"서울"}]}')" "PUT rules (another order)"
expect 404 "$(req PUT /v1/push/rules/AAAAAAAAAAAAAAAAAAAAAA '{"rules":[]}')" "PUT unknown id"

expect 401 "$(req GET '/v1/internal/watched?at=0')" "watched without the secret"
W=$(req GET '/v1/internal/watched?at=0' '' -H "authorization: Bearer $SECRET"); expect 200 "$W" "watched (factory)"
case "$W" in *"$ID"*|*fcm.googleapis*) fail "watched leaked an id or endpoint";; esac
case "$W" in *'"k":"X24","r":"서울"'*) ;; *) fail "watched misses X24|서울";; esac

echo "== notify.mjs on app/data.json against the local Worker"
ALERTS_URL=$BASE ALERTS_SECRET=$SECRET node cf/alerts/notify.mjs app/data.json | tee "$STATE/notify.log"
grep -q '^price alerts: 3 watched pairs' "$STATE/notify.log" || fail "notify did not see the 3 pairs"
# baselines live only in D1 (watched returns pairs, never numbers): read the local D1 directly
SNAP=$($WRANGLER d1 execute DB --local --config "$CONF" --persist-to "$STATE" --json --command "SELECT count(*) AS c FROM snap WHERE p = 0" 2>/dev/null) || fail "could not read the local D1"
case "$SNAP" in *'"c": 3'*|*'"c":3'*) ;; *) fail "baselines were not stored: $SNAP";; esac
echo "ok   baselines stored for the 3 watched pairs"
ALERTS_URL=$BASE ALERTS_SECRET=$SECRET node cf/alerts/notify.mjs app/data.json | tee "$STATE/notify2.log"
grep -q '^price alerts: 3 watched pairs (0 skipped, 0 changed' "$STATE/notify2.log" || fail "the same data again must not change anything"
echo "ok   same data again: nothing changed"

expect 204 "$(req DELETE "/v1/push/subscribe/$ID")" "DELETE"
expect 404 "$(req PUT "/v1/push/rules/$ID" '{"rules":[]}')" "PUT after DELETE"
expect 204 "$(req DELETE "/v1/push/subscribe/$ID")" "DELETE again (idempotent)"

# PUT with no rules deletes the subscription (real workerd + local D1: DELETE … RETURNING, the counter trigger), then 404
SUB3=${SUB//local-dev-1/local-dev-off}
R3=$(req POST /v1/push/subscribe "$SUB3" -H "origin: $APP"); expect 201 "$R3" "subscribe a phone that will switch alerts off"
ID3=$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "${R3#* }")
expect 200 "$(req PUT "/v1/push/rules/$ID3" '{"rules":[]}')" "PUT with no rules deletes the subscription"
expect 404 "$(req PUT "/v1/push/rules/$ID3" '{"rules":[]}')" "that id is 404 afterwards"
STAT=$($WRANGLER d1 execute DB --local --config "$CONF" --persist-to "$STATE" --json --command "SELECT k, n FROM stat WHERE k = 'subs' OR k LIKE 'new:%' ORDER BY k" 2>/dev/null) || fail "could not read the local D1 counters"
case "$STAT" in *'"k": "subs"'*'"n": 0'*|*'"n": 0'*'"k": "subs"'*) ;; *) fail "the subscription counter must be back to 0 after the deletes: $STAT";; esac
case "$STAT" in *'"k": "new:'$(TZ=Asia/Seoul date +%F)'"'*) ;; *) fail "today's new-subscription counter (the Worker's own KST day) is missing: $STAT";; esac
echo "ok   counters: subs back to 0, new:<today> from the Worker's clock"

# one send run in workerd + local D1: mark news for X24 through the factory endpoints, then POST /v1/internal/send.
# The push goes to fcm.googleapis.com with a made-up token (outcome depends on this machine's network: unreachable =
# retry, 404 = gone, 400 = retry — any is fine; what is checked is that the run signs, claims and records without error).
SUB2=${SUB//local-dev-1/local-dev-2}
expect 201 "$(req POST /v1/push/subscribe "$SUB2" -H "origin: $APP")" "subscribe a second phone"
TODAY=$(TZ=Asia/Seoul date +%F)
# the entry must carry X24's regroup day (data.json meta.recl) as notify.mjs does: a different g re-bases without news
G=$(node --input-type=module -e 'import { reclDate } from "./cf/alerts/notify.mjs"; import { readFileSync } from "node:fs"; console.log(reclDate(JSON.parse(readFileSync("app/data.json", "utf8")), "X24"))')
E='{"run":"2099-01-01|'$TODAY'","entries":[{"k":"X24","r":"","m":1000,"n":3,"med":2000,"g":"'$G'"}]}'
expect 200 "$(req POST /v1/internal/digest "$E" -H "authorization: Bearer $SECRET")" "digest with news (a new low; fewer branches is held)"
F=$(req POST /v1/internal/finish '{"run":"2099-01-01|'$TODAY'","today":"'$TODAY'"}' -H "authorization: Bearer $SECRET"); expect 200 "$F" "finish marks the phone"
case "$F" in *'"weekly":1'*) ;; *) fail "finish should mark 1 weekly";; esac
F2=$(req POST /v1/internal/finish '{"run":"2099-01-01|'$TODAY'","today":"'$TODAY'"}' -H "authorization: Bearer $SECRET"); expect 200 "$F2" "finish again"
case "$F2" in *'"changed":0'*) ;; *) fail "a second finish must not find the same news again";; esac
H2=$(req GET /health); expect 200 "$H2" "health after a finish"
case "$H2" in *'"finished":"'$TODAY'"'*) ;; *) fail "health should show the last finish day ($TODAY)";; esac
S=$(req POST /v1/internal/send '' -H "authorization: Bearer $SECRET"); expect 200 "$S" "send run"
case "$S" in
  *'"skipped":"window"'*) echo "note outside 08:00-20:45 KST — the send run correctly did nothing";;
  *'"sent":1'*|*'"retry":1'*|*'"gone":1'*|*'"refused":1'*|*'"stopped":1'*) ;;
  *) fail "send run should handle exactly one push";;
esac
expect 200 "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/__scheduled?cron=*/10+23,0-11+*+*+*")" "cron handler runs"
grep -q 'alerts send failed\|alerts error' "$LOG" && fail "the Worker logged an error"
# our own console lines (not wrangler's local access log, which prints URLs; deployed, invocation logs are off)
if grep -v '^\[wrangler:' "$LOG" | grep -E "$ID|local-dev-" >/dev/null; then fail "the Worker's console log shows an id or endpoint"; fi
echo "ok   Worker console log has no ids or endpoints"
echo "local dev check: all good"
