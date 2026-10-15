#!/usr/bin/env bash
# Every browser script under app/ and every Python file in the repository at least parses. The unit tests never load
# app/app.js (and most app/ files), so a syntax error there would otherwise pass every check and be deployed to every phone.
# Used by tools/factory.sh checks() (before every deploy) and by the PR checks. Reads files only; writes nothing.
set -euo pipefail
cd "$(dirname "$0")/../.."
n=0
while IFS= read -r f; do node --check "$f"; n=$((n + 1)); done < <(git ls-files 'app/*.js')
echo "browser scripts parse: $n"
python3 - <<'PY'
import ast, subprocess
files = subprocess.check_output(["git", "ls-files", "*.py"], text=True).split()
for f in files:
    with open(f, encoding="utf-8") as fh:
        ast.parse(fh.read(), f)
print(f"python files parse: {len(files)}")
PY
