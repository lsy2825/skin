#!/usr/bin/env bash
# Backup → restore check on throwaway databases (never the real one). Also the documented restore procedure
# (docs/INCIDENT_RESPONSE_PLAN.md) in executable form.
#   1. build a source DB: Supabase stand-in + schemas + access policies + the real current data (data2/db/*.csv from
#      python build2/export_db.py)
#   2. pg_dump (custom format) → pg_restore into an empty DB
#   3. compare row counts of every table, a checksum of every offer and snapshot, and the number of RLS policies,
#      triggers and tables with RLS enabled. Prints 'BACKUP RESTORE OK' or exits non-zero.
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL=${PSQL:-psql}; SRC=skin_backup_src; DST=skin_backup_dst
export PGOPTIONS="-c client_min_messages=warning"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"; for d in $SRC $DST; do $PSQL -X -q -d postgres -c "drop database if exists $d" >/dev/null 2>&1 || true; done' EXIT
[ -f data2/db/offers.csv ] || { echo "run python build2/export_db.py first"; exit 2; }
for d in $SRC $DST; do $PSQL -X -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $d" -c "create database $d"; done
# (6.0: the credit ledger — supabase/monetization.sql — was removed with the credits, so there is no ledger to carry over)
for f in tests/db/supabase_stub.sql supabase/schema_platform.sql supabase/schema.sql supabase/DATABASE_ACCESS_POLICIES.sql supabase/load_platform.sql; do
  $PSQL -X -q -v ON_ERROR_STOP=1 -d $SRC -f "$f" > /dev/null
done
FP="select json_build_object(
  'rows', (select json_object_agg(t, n order by t) from (select 'offers' t, count(*) n from public.offers union all select 'price_snapshots', count(*) from public.price_snapshots
           union all select 'clinic_branches', count(*) from public.clinic_branches union all select 'treatment_variants', count(*) from public.treatment_variants
           union all select 'official_package_items', count(*) from public.official_package_items union all select 'offer_conditions', count(*) from public.offer_conditions
           union all select 'audit_logs', count(*) from public.audit_logs) x),
  'offers_md5', (select md5(string_agg(o::text, '|' order by o.id)) from public.offers o),
  'snapshots_md5', (select md5(string_agg(s::text, '|' order by s.observed_on, s.offer_id)) from public.price_snapshots s),
  'policies', (select count(*) from pg_policies where schemaname = 'public'),
  'rls_tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity),
  'triggers', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal))"
before=$($PSQL -X -tA -d $SRC -c "$FP")
pg_dump -Fc -d $SRC -f "$TMP/backup.dump"
pg_restore -d $DST --exit-on-error "$TMP/backup.dump"
after=$($PSQL -X -tA -d $DST -c "$FP")
echo "backup size: $(du -h "$TMP/backup.dump" | cut -f1)"
echo "source:   $before"
echo "restored: $after"
[ "$before" = "$after" ] && echo "BACKUP RESTORE OK" || { echo "BACKUP RESTORE MISMATCH"; exit 1; }
