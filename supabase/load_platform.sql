-- data2/db/*.csv (python build2/export_db.py) -> tables of schema_platform.sql. Run with psql from the repo root:
--   psql "$DATABASE_URL" -f supabase/schema_platform.sql && psql "$DATABASE_URL" -f supabase/load_platform.sql
\set ON_ERROR_STOP on
begin;
\copy clinic_brands from 'data2/db/clinic_brands.csv' with (format csv, header true, null '')
\copy clinic_branches from 'data2/db/clinic_branches.csv' with (format csv, header true, null '')
\copy treatment_categories from 'data2/db/treatment_categories.csv' with (format csv, header true, null '')
\copy treatment_products from 'data2/db/treatment_products.csv' with (format csv, header true, null '')
\copy treatment_variants from 'data2/db/treatment_variants.csv' with (format csv, header true, null '')
\copy source_registry from 'data2/db/source_registry.csv' with (format csv, header true, null '')
\copy offers from 'data2/db/offers.csv' with (format csv, header true, null '')
\copy offer_conditions from 'data2/db/offer_conditions.csv' with (format csv, header true, null '')
\copy official_packages from 'data2/db/official_packages.csv' with (format csv, header true, null '')
\copy official_package_items from 'data2/db/official_package_items.csv' with (format csv, header true, null '')
\copy price_snapshots from 'data2/db/price_snapshots.csv' with (format csv, header true, null '')
-- serial counters continue after the loaded ids
select setval(pg_get_serial_sequence('clinic_brands', 'id'), (select max(id) from clinic_brands));
select setval(pg_get_serial_sequence('clinic_branches', 'id'), (select max(id) from clinic_branches));
select setval(pg_get_serial_sequence('treatment_categories', 'id'), (select max(id) from treatment_categories));
select setval(pg_get_serial_sequence('treatment_products', 'id'), (select max(id) from treatment_products));
select setval(pg_get_serial_sequence('treatment_variants', 'id'), (select max(id) from treatment_variants));
select setval(pg_get_serial_sequence('source_registry', 'id'), (select max(id) from source_registry));
select setval(pg_get_serial_sequence('offers', 'id'), (select max(id) from offers));
select setval(pg_get_serial_sequence('official_packages', 'id'), (select max(id) from official_packages));
commit;
