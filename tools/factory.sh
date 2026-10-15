#!/usr/bin/env bash
# One factory run (가격 공장 한 번 돌리기) — the same steps wherever it runs, so the result does not depend on the building:
#   Cloudflare: cf/factory (container, after it fetched the code from Artifacts)   GitHub: .github/workflows/weekly.yml
#
#   bash tools/factory.sh weekly            daily schedule: scrape only on Mondays or when saved events expired (needs_refresh.py)
#   bash tools/factory.sh scrape            scrape now, then build
#   bash tools/factory.sh rebuild           build from saved data only (code changed, or after a check)
#   bash tools/factory.sh price-check [N]   re-read N low prices on the clinic pages (1-200, default 40), then rebuild
#   bash tools/factory.sh source-check      re-check the source registry (data2/sources.json)
#
# Needs: python deps from requirements.txt (FACTORY_INSTALL=1 installs them after the decision), node, git with an "origin"
# remote it may push to. Saves by committing to main and pushing (FACTORY_NO_PUSH=1: commit only — dry runs and tests).
# Deploys app/ with wrangler only when CLOUDFLARE_API_TOKEN is set; the token is taken out of the environment first so the
# scrapers and build steps never see it. Two Workers get the same app/ folder: the public "yoonsiljang" (root wrangler.jsonc)
# and the admin "yoonsiljang-admin" (cf/admin/wrangler.jsonc, behind Cloudflare Access — the ops screen lives there).
# The public deploy must succeed; a failed admin deploy is reported (log line, GitHub warning) but does not fail the run —
# the price data and the public app are already saved and up by then, and the admin host is not part of the product.
# Writes run=true|false to $GITHUB_OUTPUT when set, and ok|skipped to $FACTORY_RESULT_FILE when set.
set -euo pipefail
MODE=${1:-weekly}
ARG=${2:-}
cd "$(dirname "$0")/.."
export PYTHONUTF8=1
DEPLOY_TOKEN=${CLOUDFLARE_API_TOKEN:-}
unset CLOUDFLARE_API_TOKEN
BOT_NAME=${FACTORY_BOT_NAME:-weekly-prices bot}
BOT_EMAIL=${FACTORY_BOT_EMAIL:-actions@users.noreply.github.com}
WRANGLER=${WRANGLER:-npx --yes wrangler@4.145.0}

log() { echo "== factory[$MODE]: $*"; }
result() { [ -n "${FACTORY_RESULT_FILE:-}" ] && echo "$1" > "$FACTORY_RESULT_FILE"; return 0; }
gh_out() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "run=$1" >> "$GITHUB_OUTPUT"; return 0; }

# commit the given paths (missing ones skipped), then put the commit on top of the latest main and push
save() {
  local msg=$1; shift
  for f in "$@"; do if [ -e "$f" ]; then git add -- "$f"; fi; done
  if git diff --cached --quiet; then log "nothing new to save"; return 0; fi
  git -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" commit -q -m "$msg $(date -u +%F)"
  if [ "${FACTORY_NO_PUSH:-}" = 1 ]; then log "committed, not pushed (FACTORY_NO_PUSH=1)"; return 0; fi
  # main may have moved meanwhile (another run, a merged PR): replay the commit on top of it and push. The replay needs a
  # committer identity like the commit above — a bare runner has none and git stops with "empty ident name" (exit 128),
  # which is how the 2026-10-15 run that overlapped a PR merge failed. Rejected pushes are retried a few times.
  local try
  for try in 1 2 3; do
    git -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" pull -q --rebase -X theirs origin main
    if git push -q origin HEAD:main; then log "saved: $(git log -1 --format='%h %s')"; return 0; fi
    log "push to main rejected (it moved again) — try $try of 3"; sleep 3
  done
  log "could not push to main after 3 tries"
  return 1
}

install() { if [ "${FACTORY_INSTALL:-}" = 1 ]; then pip install -q -r requirements.txt; fi; }

checks() {
  log "unit tests + secret scan"
  node --test tests/*.test.js
  bash .github/scripts/parse_check.sh   # every app/*.js and *.py parses (the unit tests never load app.js)
  python build2/xkeys.py
  python tests/weekly_guard_test.py
  python build2/taxonomy.py
  python build2/knowledge.py
  python tests/security/scan_secrets.py
  python tests/verify_prices_test.py
}

build() {   # $1 = "" (scrape) or --skip-scrape
  log "build ${1:-with scraping}"
  python build2/weekly.py ${1:+"$1"}
  node tools/review_queue.js   # classification review queue + alias table (docs/TREATMENT_TAXONOMY.md)
  save "$([ -n "${1:-}" ] && echo 'Rebuild app data' || echo 'Weekly prices')" \
    data2/accepted data2/history data2/geocache.json data2/branches.csv data2/issues.csv data2/report.md \
    app/data.json app/data-meta.json app/home.json app/review.json \
    docs/CLASSIFICATION_REVIEW_QUEUE.csv docs/PRODUCT_ALIAS_MAPPING.csv data2/sources.json data2/review.csv
}

deploy() {
  if [ -z "$DEPLOY_TOKEN" ]; then log "no CLOUDFLARE_API_TOKEN — not deployed"; return 0; fi
  log "deploy app/ to Cloudflare"
  CLOUDFLARE_API_TOKEN=$DEPLOY_TOKEN $WRANGLER deploy
  log "deploy app/ to Cloudflare (admin host, cf/admin)"
  # not fatal: one bad Access/Worker setting must not turn every daily run red and hide the real factory result
  if ! CLOUDFLARE_API_TOKEN=$DEPLOY_TOKEN $WRANGLER deploy --config cf/admin/wrangler.jsonc; then
    log "admin host NOT deployed — public app is up; fix cf/admin and run 'rebuild'"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning title=Cloudflare::yoonsiljang-admin (cf/admin) not deployed — public app is up"; fi
  fi
  return 0
}

case "$MODE" in
  weekly)
    out=$(mktemp)
    GITHUB_OUTPUT=$out python build2/needs_refresh.py
    if ! grep -q '^run=true' "$out"; then rm -f "$out"; gh_out false; result skipped; log "nothing to do today"; exit 0; fi
    rm -f "$out"; gh_out true
    install; checks; build ""; deploy ;;
  scrape)  gh_out true; install; checks; build ""; deploy ;;
  rebuild) gh_out true; install; checks; build --skip-scrape; deploy ;;
  price-check)
    MAX=${ARG:-40}
    case "$MAX" in ''|*[!0-9]*) echo "price-check: N must be a number 1-200" >&2; exit 2;; esac
    if [ "$MAX" -lt 1 ] || [ "$MAX" -gt 200 ]; then echo "price-check: N must be 1-200" >&2; exit 2; fi
    gh_out true; install
    python scrape/verify_prices.py --max "$MAX"
    save "Price check" data2/price_checks.csv data2/price_checks.md
    checks; build --skip-scrape; deploy ;;
  source-check)
    gh_out true; install
    python scrape/sources.py
    save "Source check" data2/sources.json ;;
  *) echo "unknown mode: $MODE (weekly|scrape|rebuild|price-check N|source-check)" >&2; exit 2 ;;
esac
result ok
log "done"
