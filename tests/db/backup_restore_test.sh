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
for f in tests/db/supabase_stub.sql supabase/schema_platform.sql supabase/schema.sql supabase/DATABASE_ACCESS_POLICIES.sql supabase/load_platform.sql \
         supabase/monetization.sql supabase/commerce_seed.sql; do
  $PSQL -X -q -v ON_ERROR_STOP=1 -d $SRC -f "$f" > /dev/null
done
# 5.1: a credit ledger with a purchase, a spend and a refund must survive the backup too (append-only trigger included)
$PSQL -X -q -v ON_ERROR_STOP=1 -d $SRC > /dev/null <<'SQL'
insert into auth.users (id) values ('00000000-0000-4000-8000-000000000051');
set role service_role;
select public.commerce_fulfill_payment(jsonb_build_object('order_id', (public.commerce_create_order('{"user_id":"00000000-0000-4000-8000-000000000051","product_code":"STANDARD","channel":"DEMO","idempotency_key":"backup-test-1"}') ->> 'id'),
  'provider', 'DEMO', 'provider_payment_id', 'backup-pay-1', 'amount', 1990, 'currency', 'KRW', 'status', 'DONE'));
select public.commerce_capture(jsonb_build_object('job_id', public.commerce_reserve('{"user_id":"00000000-0000-4000-8000-000000000051","feature_code":"REGIONAL_PRICE_REPORT","idempotency_key":"backup-job-1"}') -> 'job' ->> 'id',
  'report', '{"title":"backup test","payload":{}}'::jsonb));
select public.commerce_refund('{"provider":"DEMO","provider_payment_id":"backup-pay-1","provider_refund_id":"backup-refund-1","amount":995,"kind":"REFUND","provider_done":true}');
SQL
FP="select json_build_object(
  'rows', (select json_object_agg(t, n order by t) from (select 'offers' t, count(*) n from public.offers union all select 'price_snapshots', count(*) from public.price_snapshots
           union all select 'clinic_branches', count(*) from public.clinic_branches union all select 'treatment_variants', count(*) from public.treatment_variants
           union all select 'official_package_items', count(*) from public.official_package_items union all select 'offer_conditions', count(*) from public.offer_conditions
           union all select 'audit_logs', count(*) from public.audit_logs) x),
  'offers_md5', (select md5(string_agg(o::text, '|' order by o.id)) from public.offers o),
  'snapshots_md5', (select md5(string_agg(s::text, '|' order by s.observed_on, s.offer_id)) from public.price_snapshots s),
  'policies', (select count(*) from pg_policies where schemaname = 'public'),
  'rls_tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity),
  'ledger_md5', (select md5(string_agg(row(t.user_id, t.type, t.bucket, t.amount, t.effect_balance, t.effect_reserved, t.idempotency_key)::text, '|' order by t.id)) from public.credit_transactions t),
  'wallets', (select json_agg(w order by w.user_id) from (select user_id, paid_balance, promo_balance, paid_reserved, promo_reserved from public.credit_wallets) w),
  'orders_payments_refunds', (select json_build_array((select count(*) from public.orders), (select count(*) from public.payments), (select count(*) from public.payment_refunds))),
  'commerce_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and left(p.proname, 9) = 'commerce_'),
  'triggers', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal))"
before=$($PSQL -X -tA -d $SRC -c "$FP")
pg_dump -Fc -d $SRC -f "$TMP/backup.dump"
pg_restore -d $DST --exit-on-error "$TMP/backup.dump"
after=$($PSQL -X -tA -d $DST -c "$FP")
echo "backup size: $(du -h "$TMP/backup.dump" | cut -f1)"
echo "source:   $before"
echo "restored: $after"
[ "$before" = "$after" ] && echo "BACKUP RESTORE OK" || { echo "BACKUP RESTORE MISMATCH"; exit 1; }
