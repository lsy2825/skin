#!/usr/bin/env bash
# One factory run (가격 공장 한 번 돌리기) — the same steps wherever it runs, so the result does not depend on the building:
#   Cloudflare: cf/factory (container, after it fetched the code from Artifacts)   GitHub: .github/workflows/weekly.yml
#
#   bash tools/factory.sh weekly            daily schedule: scrape only on Mondays or when saved events expired (needs_refresh.py)
#   bash tools/factory.sh scrape            scrape now, then build
#   bash tools/factory.sh rebuild           build from saved data only (code changed, or after a check)
#   bash tools/factory.sh price-check [N]   re-read N low prices on the clinic pages (1-200, default 40), then rebuild
#   bash tools/factory.sh source-check      re-check the source registry (data2/sources.json)
#   bash tools/factory.sh deploy            deploy app/ only (weekly.yml's deploy job; needs CLOUDFLARE_API_TOKEN)
#
# Needs: python deps from requirements.txt (FACTORY_INSTALL=1 installs them after the decision), node, git with an "origin"
# remote it may push to. Saves by committing to main and pushing (FACTORY_NO_PUSH=1: commit only — dry runs and tests).
# A build starts from main's LATEST data, not the data of the commit that was checked out: build() fetches origin main and
# takes the files a build reads and writes (the ones it saves) from there; the code stays as checked out. So a run that
# waited behind another one builds on main's newest data instead of pushing older data back (a GitHub re-run of the factory
# job is refused before it gets here — weekly.yml's first step). save() pushes a build only as it was made: if main changed
# any of the saved files after the factory took them (the replay onto main would mix two builds, or put older data back),
# it pushes nothing and fails.
# Deploys app/ with wrangler only when CLOUDFLARE_API_TOKEN is set. On GitHub the factory job gets NO token at all: with
# FACTORY_DEPLOY=separate deploy() only names the commit it saved, and weekly.yml's separate deploy job (fresh runner, the
# code of the commit the run STARTED on, only the four built data files taken from the saved commit, wrangler installed
# before the token arrives) runs `factory.sh deploy`. Taking the token out with `unset` (below) is not a
# wall: anything that ran in the same job — scrapers, pip packages, build code — could still read it back from
# /proc/<pid>/environ of this script or of the step's shell (the Cloudflare box, cf/factory, still works that way; on hold —
# docs/CLOUDFLARE_MIGRATION.md). Two Workers can get the same app/ folder: the admin "yoonsiljang-admin"
# (cf/admin/wrangler.jsonc, behind Cloudflare Access) on every build, and the public "yoonsiljang" (root wrangler.jsonc) ONLY
# when PUBLIC_DEPLOY is exactly "on" — public hosting is paused by the owner's decision of 2026-10-15 (repository variable,
# passed by weekly.yml). With the public app deployed, a public deploy failure fails the run and an admin failure is a warning.
# While public hosting is paused the admin host is the only copy that gets new builds, so its deploy failure fails the run
# (weekly.yml's alert job then sends the Telegram message). To resume: set the variable to "on", then run weekly-prices once
# by hand (Run workflow, skip_scrape) so the public address catches up.
# Re-runs: a GitHub re-run uses that run's OLD weekly.yml and OLD code, so it gets none of the guards that came later.
#   - Do not re-run a weekly-prices run that started before 2026-10-15's change: its factory.sh deploys the public Worker.
#   - Do not re-run a weekly-prices run that has no deploy job (it started before the deploy split was merged): its
#     weekly.yml hands the Cloudflare token to the factory job, and its factory.sh pushes with `pull --rebase -X theirs` and
#     no mixed-build check, then deploys from that same job. Once CLOUDFLARE_API_TOKEN lives only in the GitHub Environment
#     "cloudflare" (main only) such a re-run gets no token, but its unchecked push to main stays — so still do not re-run it.
#   - Runs that have the deploy job refuse a re-run of the factory job (weekly.yml's first step); re-running only their
#     deploy job is allowed and skips when main has a newer build or newer deploy code.
#   To build or deploy again: Run workflow (skip_scrape).
# Writes run=true|false to $GITHUB_OUTPUT when set, and ok|skipped to $FACTORY_RESULT_FILE when set.
set -euo pipefail
MODE=${1:-weekly}
ARG=${2:-}
cd "$(dirname "$0")/.."
export PYTHONUTF8=1
DEPLOY_TOKEN=${CLOUDFLARE_API_TOKEN:-}
unset CLOUDFLARE_API_TOKEN
BOT_NAME=${FACTORY_BOT_NAME:-weekly-prices bot}
BUILT=""   # set by build(): the commit that holds this run's build (deploy() names it for weekly.yml's deploy job)
BOT_EMAIL=${FACTORY_BOT_EMAIL:-actions@users.noreply.github.com}
WRANGLER=${WRANGLER:-npx --yes wrangler@4.145.0}

log() { echo "== factory[$MODE]: $*"; }
result() { [ -n "${FACTORY_RESULT_FILE:-}" ] && echo "$1" > "$FACTORY_RESULT_FILE"; return 0; }
gh_out() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "run=$1" >> "$GITHUB_OUTPUT"; return 0; }

# commit the given paths (missing ones skipped), then put the commit on top of the latest main and push — only if main
# left those paths alone meanwhile
save() {
  local msg=$1; shift
  for f in "$@"; do if [ -e "$f" ]; then git add -- "$f"; fi; done
  if git diff --cached --quiet; then log "nothing new to save"; return 0; fi
  git -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" commit -q -m "$msg $(date -u +%F)"
  if [ "${FACTORY_NO_PUSH:-}" = 1 ]; then log "committed, not pushed (FACTORY_NO_PUSH=1)"; return 0; fi
  # main may have moved meanwhile (another run, a merged PR): replay the commit on top of it and push. The replay needs a
  # committer identity like the commit above — a bare runner has none and git stops with "empty ident name" (exit 128),
  # which is how the 2026-10-15 run that overlapped a PR merge failed. Rejected pushes are retried a few times.
  # Never a mixed build: before every push, main's copy of the saved paths must still be the one this commit started from
  # (its parent — for a build, the files build() took from main) and the replay must have kept the commit's own files.
  # -X theirs alone would let a newer build on main be half-overwritten (data.json from one build, data-meta.json from
  # another) or overwritten with older data.
  local try made; made=$(git rev-parse HEAD)
  for try in 1 2 3; do
    # (the inputs commit build() made is skipped by the replay — main already has those files; no hint about it)
    git -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" -c advice.skippedCherryPicks=false pull -q --rebase -X theirs origin main
    if ! git diff --quiet "$made^" FETCH_HEAD -- "$@" || ! git diff --quiet "$made" HEAD -- "$@"; then
      log "main changed the factory's files meanwhile — not pushed"
      return 1
    fi
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
  python tests/size_guard_test.py         # the app/data.json size guard itself (build2/size_guard.py stops a build over 20 MiB)
}

build() {   # $1 = "" (scrape) or --skip-scrape
  # the files a build reads and writes — all of them saved after it
  local files=(data2/accepted data2/history data2/geocache.json data2/branches.csv data2/issues.csv data2/report.md
    app/data.json app/data-meta.json app/home.json app/review.json
    docs/CLASSIFICATION_REVIEW_QUEUE.csv docs/PRODUCT_ALIAS_MAPPING.csv data2/sources.json data2/review.csv)
  # Start from main's latest copy of those files (only those that exist there); the code stays as checked out. They are
  # noted as a local commit so that save()'s replay onto main keeps exactly what this build made (that commit is dropped
  # again by the replay: main already has the same files). No origin remote (a plain local copy): the files as they are.
  local from="" code f have=()
  code=$(git rev-parse --short HEAD)
  if git remote get-url origin >/dev/null 2>&1; then
    if ! git fetch -q origin main; then log "could not fetch origin main — not building (a build must start from main's latest data)"; exit 1; fi
    from=$(git rev-parse FETCH_HEAD)
    for f in "${files[@]}"; do if [ -n "$(git ls-tree "$from" -- "$f")" ]; then have+=("$f"); fi; done
    if [ ${#have[@]} -gt 0 ]; then
      git checkout -q --no-overlay "$from" -- "${have[@]}"
      if ! git diff --cached --quiet -- "${have[@]}"; then
        git -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" commit -q -m "Build inputs from main ${from:0:12}" -- "${have[@]}"
      fi
    fi
    log "build inputs: ${#have[@]} of ${#files[@]} paths from origin main ${from:0:12}; code stays at $code"
  else
    log "no 'origin' remote — building from the files as checked out (code $code)"
  fi
  log "build ${1:-with scraping}"
  python build2/weekly.py ${1:+"$1"}
  node tools/review_queue.js   # classification review queue + alias table (docs/TREATMENT_TAXONOMY.md)
  local before; before=$(git rev-parse HEAD)
  save "$([ -n "${1:-}" ] && echo 'Rebuild app data' || echo 'Weekly prices')" "${files[@]}"
  # nothing new to save: the build is exactly what main had when the inputs were taken, so that commit holds it
  if [ "$(git rev-parse HEAD)" = "$before" ] && [ -n "$from" ]; then BUILT=$from; else BUILT=$(git rev-parse HEAD); fi
}

deploy() {
  # GitHub: the job that ran the scrapers and the build holds no token; it hands the commit to weekly.yml's deploy job
  if [ "${FACTORY_DEPLOY:-}" = separate ]; then
    local sha; sha=${BUILT:-$(git rev-parse HEAD)}
    if [ -n "$DEPLOY_TOKEN" ]; then
      log "a Cloudflare token reached the factory job — it should only go to the deploy job (not used here)"
      if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning title=Cloudflare::CLOUDFLARE_API_TOKEN was handed to the factory job; only the deploy job should get it"; fi
    fi
    log "deploy handed to the separate deploy job: $sha"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then { echo "deploy=true"; echo "sha=$sha"; } >> "$GITHUB_OUTPUT"; fi
    return 0
  fi
  if [ -z "$DEPLOY_TOKEN" ]; then log "no CLOUDFLARE_API_TOKEN — not deployed"; return 0; fi
  # Public hosting is paused (owner's decision 2026-10-15): the public Worker is deployed only when PUBLIC_DEPLOY is exactly
  # "on" (GitHub → Settings → Secrets and variables → Actions → Variables → PUBLIC_DEPLOY). Off, the public address keeps
  # serving its last version and is not updated; the admin host below (behind Cloudflare Access) still gets every build.
  if [ "${PUBLIC_DEPLOY:-}" = on ]; then
    log "deploy app/ to Cloudflare (public)"
    CLOUDFLARE_API_TOKEN=$DEPLOY_TOKEN $WRANGLER deploy
  else
    log "public app NOT deployed (PUBLIC_DEPLOY is not 'on': public hosting paused) — the public address keeps its last version"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::notice title=Cloudflare::public app not deployed (PUBLIC_DEPLOY off) — admin host only"; fi
  fi
  log "deploy app/ to Cloudflare (admin host, cf/admin)"
  # not fatal: one bad Access/Worker setting must not turn every daily run red and hide the real factory result
  if ! CLOUDFLARE_API_TOKEN=$DEPLOY_TOKEN $WRANGLER deploy --config cf/admin/wrangler.jsonc; then
    log "admin host NOT deployed — fix cf/admin and run 'rebuild'"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning title=Cloudflare::yoonsiljang-admin (cf/admin) not deployed"; fi
    # public hosting paused: the admin host is the only copy that gets this build, so its failure must not pass silently
    if [ "${PUBLIC_DEPLOY:-}" != on ]; then log "public hosting is paused, so this fails the run"; return 1; fi
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
  deploy)   # weekly.yml's deploy job: only the deploy, of the commit checked out here; a missing token is an error here
    if [ "${FACTORY_DEPLOY:-}" = separate ]; then echo "deploy mode cannot hand the deploy on (FACTORY_DEPLOY=separate)" >&2; exit 2; fi
    if [ -z "$DEPLOY_TOKEN" ]; then echo "deploy mode needs CLOUDFLARE_API_TOKEN" >&2; exit 1; fi
    deploy ;;
  *) echo "unknown mode: $MODE (weekly|scrape|rebuild|price-check N|source-check|deploy)" >&2; exit 2 ;;
esac
result ok
log "done"
