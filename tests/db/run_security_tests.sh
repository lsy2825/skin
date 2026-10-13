#!/usr/bin/env bash
# Database security tests on a throwaway PostgreSQL database (never a real one):
#   Supabase stand-in → schema_platform.sql → schema.sql → DATABASE_ACCESS_POLICIES.sql (applied twice: must be
#   idempotent) → tests/db/security_test.sql. Prints PASS lines and 'SECURITY TESTS OK', exits non-zero on any FAIL.
# usage: bash tests/db/run_security_tests.sh        (PSQL / PGDATABASE-style env vars respected; DB name: $TEST_DB)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-skin_security_test}
PSQL=${PSQL:-psql}
POLICIES=${POLICIES:-supabase/DATABASE_ACCESS_POLICIES.sql}   # another file only for mutation checks of the tests themselves
export PGOPTIONS="-c client_min_messages=warning"
$PSQL -X -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
trap '$PSQL -X -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
for f in tests/db/supabase_stub.sql supabase/schema_platform.sql supabase/schema.sql "$POLICIES" "$POLICIES"; do
  $PSQL -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" > /dev/null
done
PGOPTIONS="-c client_min_messages=notice" $PSQL -X -v ON_ERROR_STOP=1 -d "$DB" -f tests/db/security_test.sql 2>&1 | sed -n 's/^psql:[^:]*:[0-9]*: //p; s/^ *\(SECURITY TESTS OK\)$/\1/p'
