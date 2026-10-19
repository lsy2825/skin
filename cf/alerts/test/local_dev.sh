#!/usr/bin/env bash
# Local check of the alerts Worker in the real runtime (workerd via wrangler dev) with a local D1:
#   bash cf/alerts/test/local_dev.sh
# migrate a throw-away local D1 → wrangler dev on a free port (8795-8799) → subscribe / rules / delete / factory export
# with curl → notify.mjs on app/data.json against it (computed, the same prices again = done, a start sent again with its
# nonce = the same lease, busy, deferred — the free profile, PLAN "free", so the D1-day cap is 3 —, a wrong secret =
# startfail) → D1 rows read (and written per phone, 11th review) of a
# finish and a send run on the same runtime (test/d1_reads.mjs) → stop wrangler by its process group. Needs node + npx (no
# account, no network to Cloudflare). The factory secret is made up for this run only. The Worker uses the real clock: the
# cap section expects 'reserve' before 21:00 UTC (06:00 KST) and 'cap' after it, and the script waits out 23:30–24:00 UTC
# (no computation starts in the last 15 minutes of a D1 day — 10th review).
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
# grep_none WHAT GREP-ARGS...: fails unless grep finds nothing (exit 1). A match (0) fails, and so does a grep error (2) —
# 8th review: an id that starts with '-' (1 in 64) was read as an option, grep stopped with 2 and the check printed ok
# without looking. Patterns always go after -e.
grep_none() { local what=$1 rc=0; shift; grep "$@" >/dev/null || rc=$?; [ "$rc" = 1 ] || fail "$what (grep exit $rc)"; }

# the D1 day's edge (23:45–24:00 UTC): wait until the new D1 day so the starts below are not 'deferred (edge)'
while [ "$(date -u +%H%M)" -ge 2330 ]; do echo "waiting for 00:00 UTC (the D1 day's edge)"; sleep 30; done
echo "== migrate local D1"
$WRANGLER d1 migrations apply DB --local --config "$CONF" --persist-to "$STATE" >"$STATE/migrate.log" 2>&1 || { cat "$STATE/migrate.log"; exit 1; }

echo "== wrangler dev on :$PORT"
setsid $WRANGLER dev --local --config "$CONF" --port "$PORT" --ip 127.0.0.1 --persist-to "$STATE" \
  --compatibility-date 2026-10-07 --test-scheduled --var "ALERTS_SECRET:$SECRET" --var "DEV_ORIGINS:http://localhost:8766" --var "PLAN:free" \
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
case "$H" in *'"compute":"ok"'*'"plan":"free"'*) ;; *) fail "health should carry compute ok and plan free (--var PLAN:free): $H";; esac

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
# the same prices again the same KST day (9th review): start answers done — one request, nothing written (stat 'finish' +
# 'data' name today's finished prices by their fingerprint, not by the file's bytes)
ALERTS_URL=$BASE ALERTS_SECRET=$SECRET node cf/alerts/notify.mjs app/data.json | tee "$STATE/notify2.log"
grep -q '^price alerts: these prices were already computed (same fingerprint) — nothing to do$' "$STATE/notify2.log" || fail "the same prices again the same day must stop at start"
DS=$($WRANGLER d1 execute DB --local --config "$CONF" --persist-to "$STATE" --json --command "SELECT n FROM stat WHERE k = 'data'" 2>/dev/null) || fail "could not read the local D1 data stamp"
WANT=$(node --input-type=module -e 'import { fingerprint } from "./cf/alerts/notify.mjs"; import { readFileSync } from "node:fs"; console.log(parseInt(fingerprint(JSON.parse(readFileSync("app/data.json", "utf8"))).slice(0, 13), 16))')
case "$DS" in *'"n": '"$WANT"*|*'"n":'"$WANT"*) ;; *) fail "stat 'data' should hold the tag of app/data.json's fingerprint ($WANT): $DS";; esac
echo "ok   same prices again the same day: done at start (stat data = the fingerprint's tag)"
# another computation holding the lease → a start sent again with its nonce gets the same lease (counted once, 10th review);
# a run with other prices is busy; once it finishes: before 21:00 UTC the D1 day's last computation is kept for 06:00 KST
# (deferred 'reserve', until=06:00), after it a third computation runs and a fourth is deferred ('cap', until=09:00) — the
# first deferred factory run of the D1 day gets deferred=true + until for the workflow's one Telegram line
# other prices: the first row's listed price (column 3) 1,000 won up
node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync("app/data.json","utf8"));if(d.cols)d.cols[3][0]+=1000;else d.rows[0][3]+=1000;fs.writeFileSync(process.argv[1],JSON.stringify(d))' "$STATE/data2.json"
FPB=$(printf 'b%.0s' $(seq 64)); FPC=$(printf 'c%.0s' $(seq 64)); NB=0123456789abc
G=$(req POST /v1/internal/start '{"fp":"'$FPB'","nonce":"'$NB'"}' -H "authorization: Bearer $SECRET"); expect 200 "$G" "start of a second computation (takes the lease)"
LEASE=$(node -e 'const g=JSON.parse(process.argv[1]);if(g.go!=="compute")process.exit(1);console.log(g.lease)' "${G#* }") || fail "start should answer compute: $G"
G2=$(req POST /v1/internal/start '{"fp":"'$FPB'","nonce":"'$NB'"}' -H "authorization: Bearer $SECRET"); expect 200 "$G2" "the same start again (its answer was lost)"
[ "$(node -e 'const g=JSON.parse(process.argv[1]);console.log(g.go+" "+g.lease)' "${G2#* }")" = "compute $LEASE" ] || fail "a start sent again with its nonce must get the same lease: $G2"
: >"$STATE/gh-output"
GITHUB_OUTPUT=$STATE/gh-output ALERTS_URL=$BASE ALERTS_SECRET=$SECRET node cf/alerts/notify.mjs "$STATE/data2.json" | tee "$STATE/notify3.log"
grep -q '^::notice title=price alerts::another run is computing alerts right now — the alerts-catchup run (every 30 minutes) checks these prices again$' "$STATE/notify3.log" || fail "other prices while a computation holds the lease must be busy"
TODAY=$(TZ=Asia/Seoul date +%F)
# (the run notify.mjs computed: app/data.json's collection date | today — a finish prunes the pairs of any other run)
RUN="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("app/data.json","utf8")).meta.updated)')|$TODAY"
expect 200 "$(req POST /v1/internal/finish '{"run":"'$RUN'","today":"'$TODAY'","fp":"'$FPB'","lease":'$LEASE'}' -H "authorization: Bearer $SECRET")" "its finish frees the lease"
# the same finish sent again (its first try committed, the answer was lost — 12th review): bound to its lease, which is gone
# → the D1 batch's guard fails and the whole batch is rolled back (nothing written); these prices are noted as finished
# today → 200 finished "before", whoever holds the lease (13th/14th review: notify.mjs takes it as finished on any try). The
# same lease with other prices (not the ones noted) → 409 LEASE_LOST
FA=$(req POST /v1/internal/finish '{"run":"'$RUN'","today":"'$TODAY'","fp":"'$FPB'","lease":'$LEASE'}' -H "authorization: Bearer $SECRET"); expect 200 "$FA" "the same finish sent again"
case "$FA" in *'"finished":"before"'*) ;; *) fail "a finish sent again after it committed must answer finished \"before\": $FA";; esac
FL=$(req POST /v1/internal/finish '{"run":"'$RUN'","today":"'$TODAY'","fp":"'$FPC'","lease":'$LEASE'}' -H "authorization: Bearer $SECRET"); expect 409 "$FL" "a finish whose lease is gone, other prices"
case "$FL" in *LEASE_LOST*) ;; *) fail "a finish whose lease is gone and whose prices are not the ones finished must answer LEASE_LOST: $FL";; esac
if [ "$(date -u +%H)" -ge 21 ]; then
  G=$(req POST /v1/internal/start '{"fp":"'$FPC'"}' -H "authorization: Bearer $SECRET"); expect 200 "$G" "a third computation this UTC day (after 21:00 UTC)"
  LEASE=$(node -e 'const g=JSON.parse(process.argv[1]);if(g.go!=="compute")process.exit(1);console.log(g.lease)' "${G#* }") || fail "the third start should answer compute: $G"
  expect 200 "$(req POST /v1/internal/finish '{"run":"'$RUN'","today":"'$TODAY'","fp":"'$FPC'","lease":'$LEASE'}' -H "authorization: Bearer $SECRET")" "its finish"
  WANT_MSG="^::warning title=price alerts::this D1 day's computations (the Worker's COMPUTES_PER_DAY, the D1 write budget) are used up"; WANT_OUT=$'deferred=true\nuntil=09:00'; WANT_FC=3
else
  WANT_MSG="^::warning title=price alerts::the D1 day's last computation (the Worker's COMPUTES_PER_DAY) is kept for the 06:00 KST run"; WANT_OUT=$'deferred=true\nuntil=06:00'; WANT_FC=2
fi
GITHUB_OUTPUT=$STATE/gh-output ALERTS_URL=$BASE ALERTS_SECRET=$SECRET node cf/alerts/notify.mjs "$STATE/data2.json" | tee "$STATE/notify4.log"
grep -q "$WANT_MSG" "$STATE/notify4.log" || fail "new prices past the D1 day's share must be deferred"
[ "$(cat "$STATE/gh-output")" = "$WANT_OUT" ] || fail "deferred and until must reach \$GITHUB_OUTPUT: $(cat "$STATE/gh-output")"
: >"$STATE/gh-output"
GITHUB_OUTPUT=$STATE/gh-output ALERTS_URL=$BASE ALERTS_SECRET=$SECRET node cf/alerts/notify.mjs "$STATE/data2.json" >/dev/null
[ ! -s "$STATE/gh-output" ] || fail "a second deferred run the same D1 day must not ask for another Telegram line: $(cat "$STATE/gh-output")"
FC=$($WRANGLER d1 execute DB --local --config "$CONF" --persist-to "$STATE" --json --command "SELECT n % 100 AS c, (SELECT count(*) FROM stat WHERE k = 'lease') AS l FROM stat WHERE k = 'fc'" 2>/dev/null) || fail "could not read the local D1 computation count"
case "$FC" in *'"c": '$WANT_FC*'"l": 0'*|*'"c":'$WANT_FC*'"l":0'*) ;; *) fail "$WANT_FC computations counted, no lease left: $FC";; esac
H3=$(req GET /health); case "$H3" in *'"compute":"deferred"'*) ;; *) fail "health should say compute deferred: $H3";; esac
echo "ok   start: the same lease for a resent start, busy while a computation holds the lease, a resent finish 200 finished \"before\" (13th), another fp 409 LEASE_LOST, deferred past the D1 day's share (deferred=true + until once a D1 day), /health compute deferred"
# a start no retry can cure (11th review): another ALERTS_SECRET than the Worker's → 401 → startfail=true for the workflow's
# Telegram line, and the ::warning does not promise a catch-up
: >"$STATE/gh-output"
GITHUB_OUTPUT=$STATE/gh-output ALERTS_URL=$BASE ALERTS_SECRET=not-the-workers-secret node cf/alerts/notify.mjs app/data.json | tee "$STATE/notify5.log"
grep -q '^::warning title=price alerts::price alert check failed (/v1/internal/start answered 401) — trying again will not help' "$STATE/notify5.log" || fail "a 401 at start must say that trying again will not help"
[ "$(cat "$STATE/gh-output")" = "startfail=true" ] || fail "a 401 at start must write startfail=true: $(cat "$STATE/gh-output")"
echo "ok   start answered 401 (another secret): startfail=true, no promise of a catch-up"
# notify.mjs sent app/data.json's key set first (one row in the local D1); since then a rule naming a key that data.json
# does not have is still stored (6th review) and answered exactly as 약속 1 says (7th review); a malformed key set is 400
KS=$($WRANGLER d1 execute DB --local --config "$CONF" --persist-to "$STATE" --json --command "SELECT count(*) AS c, json_array_length(max(keys)) AS n FROM keyset" 2>/dev/null) || fail "could not read the local D1 key set"
NKEYS=$(node -e 'const d=JSON.parse(require("fs").readFileSync("app/data.json","utf8"));console.log(new Set(d.keys.map((k)=>k[0])).size)')
case "$KS" in *'"c": 1'*'"n": '"$NKEYS"*|*'"c":1'*'"n":'"$NKEYS"*) ;; *) fail "the key set should be one row of $NKEYS keys: $KS";; esac
echo "ok   key set stored: one row, $NKEYS keys"
# (a PUT, so the subscribe rate limit of 3 a minute stays for the subscriptions below; POST takes the same path: node tests)
U=$(req PUT "/v1/push/rules/$ID" '{"rules":[{"kind":"watch","key":"X24"},{"kind":"watch","key":"TZZZZZZZ"}]}' -H "origin: $APP")
expect 200 "$U" "a rule naming a key data.json does not have: stored"
case "$(cat "$STATE/out")" in '{"ok":true}') ;; *) fail "should answer {\"ok\":true} (약속 1): $U";; esac
RU=$($WRANGLER d1 execute DB --local --config "$CONF" --persist-to "$STATE" --json --command "SELECT rules FROM subs WHERE endpoint LIKE '%local-dev-1'" 2>/dev/null) || fail "could not read the local D1 rules"
case "$RU" in *TZZZZZZZ*) ;; *) fail "the rule with the unknown key should be stored: $RU";; esac
expect 200 "$(req PUT "/v1/push/rules/$ID" '{"rules":[{"kind":"watch","key":"X24"}]}' -H "origin: $APP")" "known keys only"
case "$(cat "$STATE/out")" in '{"ok":true}') ;; *) fail "known keys should answer {\"ok\":true}: $(cat "$STATE/out")";; esac
expect 400 "$(req POST /v1/internal/keys '{"keys":["X24","X01"]}' -H "authorization: Bearer $SECRET")" "a key set out of order (BAD_KEYS)"
expect 401 "$(req POST /v1/internal/keys '{"keys":["X01"]}')" "key set without the secret"

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
grep_none "the Worker logged an error" -F -e 'alerts send failed' -e 'alerts error' "$LOG"
# our own console lines (not wrangler's local access log, which prints URLs; deployed, invocation logs are off)
RC=0; grep -v -e '^\[wrangler:' "$LOG" >"$STATE/own.log" || RC=$?
[ "$RC" -le 1 ] || fail "could not read the wrangler log (grep exit $RC)"
grep_none "the Worker's console log shows an id or endpoint" -F -e "$ID" -e "$ID3" -e 'local-dev-' "$STATE/own.log"
echo "ok   Worker console log has no ids or endpoints"

# D1 rows READ on this runtime's D1 (7th review: the finish must not read more when exp_sent lists are long; per-phone
# ceilings of the src/worker.js arithmetic): test/d1_reads.mjs with the wrangler package (getPlatformProxy, a throw-away D1)
if [ -x "${WRANGLER%% *}" ] && [ "$WRANGLER" = "${WRANGLER%% *}" ]; then
  WR_PKG=$(cd "$(dirname "$(readlink -f "$WRANGLER")")/.." && pwd)
  node cf/alerts/test/d1_reads.mjs "$WR_PKG" || fail "D1 rows read above the ceiling (test/d1_reads.mjs)"
else
  npx --yes -p wrangler@4.145.0 -c 'node cf/alerts/test/d1_reads.mjs "$(cd "$(dirname "$(readlink -f "$(command -v wrangler)")")/.." && pwd)"' || fail "D1 rows read above the ceiling (test/d1_reads.mjs)"
fi
echo "local dev check: all good"
