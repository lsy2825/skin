#!/usr/bin/env bash
# What the factory box does when Cloudflare starts it (src/index.js passes these as environment variables):
#   MODE / ARG          the factory step (tools/factory.sh weekly|scrape|rebuild|price-check N|source-check)
#   ARTIFACTS_REMOTE    git address of the code on Cloudflare Artifacts
#   ARTIFACTS_TOKEN     short-lived repo token (minted per run, write scope, expires on its own)
#   REPORT_URL / RUN_ID / RUN_TOKEN   where to say how the run ended; RUN_TOKEN is good for this run only
#   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID   for `wrangler deploy` of the app (factory.sh unsets it before the build, but code in this box can still read it back from /proc — not a wall; docs/CLOUDFLARE_MIGRATION.md)
#   PUBLIC_DEPLOY       "on" = also deploy the public Worker; anything else = admin host only (paused 2026-10-15)
#   FACTORY_NO_PUSH=1   trial runs: commit inside the box, push and deploy nothing
set -uo pipefail
WORK=/home/factory/skin
RESULT=/home/factory/result
STEP=start

report() {   # $1 = ok | skipped | failed | stopped
  [ -n "${REPORT_URL:-}" ] || { echo "== result: $1 ($STEP)"; return 0; }
  python3 - "$1" "$STEP" <<'PY'
import json, os, subprocess, sys, urllib.request
work = "/home/factory/skin"
def git(*a):
    try: return subprocess.run(["git", "-C", work, *a], capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception: return ""
summary = ""
try: summary = open(os.path.join(work, "data2/report.md"), encoding="utf-8").read()[:3000]
except OSError: pass
body = {"run": os.environ.get("RUN_ID", ""), "result": sys.argv[1], "step": sys.argv[2],
        "commit": git("log", "-1", "--format=%h %s"), "summary": summary}
req = urllib.request.Request(os.environ["REPORT_URL"], data=json.dumps(body).encode(), method="POST",
                             headers={"content-type": "application/json", "authorization": "Bearer " + os.environ.get("RUN_TOKEN", "")})
for _ in range(3):
    try: urllib.request.urlopen(req, timeout=20); break
    except Exception as e: print("report failed:", e, file=sys.stderr)
PY
}
trap 'report stopped; exit 143' TERM

STEP=clone
git -c http.extraHeader="Authorization: Bearer ${ARTIFACTS_TOKEN}" clone -q --depth 50 --branch main "$ARTIFACTS_REMOTE" "$WORK" \
  || { report failed; exit 1; }
# later pull/push in factory.sh use the same short-lived token; it lives only in this box's throwaway disk
git -C "$WORK" config http.extraHeader "Authorization: Bearer ${ARTIFACTS_TOKEN}"
unset ARTIFACTS_TOKEN
echo "== code: $(git -C "$WORK" log -1 --format='%h %s')"

STEP=$MODE
FACTORY_RESULT_FILE=$RESULT FACTORY_INSTALL=1 \
FACTORY_BOT_NAME="factory bot" FACTORY_BOT_EMAIL="factory@yoonsiljang.invalid" \
  bash "$WORK/tools/factory.sh" "$MODE" "${ARG:-}"
code=$?
if [ $code -eq 0 ]; then report "$(cat "$RESULT" 2>/dev/null || echo ok)"; else report failed; fi
exit $code
