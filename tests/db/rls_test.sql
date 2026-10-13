-- Row-level-security check for supabase/schema.sql on a plain PostgreSQL (no Supabase needed). Run in an empty DB:
--   psql -d test -v ON_ERROR_STOP=1 -f tests/db/rls_test.sql      (last line prints 'RLS OK')
-- A minimal stand-in for Supabase Auth: auth.users, auth.uid() from a session setting, role 'authenticated'.
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to anon, authenticated;
\ir ../../supabase/schema.sql
grant select, insert, update, delete on all tables in schema public to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

set role authenticated;
set request.jwt.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.profiles (id, nick) values ('00000000-0000-0000-0000-00000000000a', 'A');
insert into public.carts (id, user_id, name) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'cart');
insert into public.cart_items (cart_id, position, kind, key_code) values ('10000000-0000-0000-0000-000000000001', 0, 'k', 'X12');
insert into public.price_alerts (id, user_id, type, key_code, target_krw) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'target', 'X24', 150000);
insert into public.records (id, user_id, done_on, procedure) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-10-13', '슈링크 300샷');

set request.jwt.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.profiles) + (select count(*) from public.carts) + (select count(*) from public.cart_items)
     + (select count(*) from public.price_alerts) + (select count(*) from public.records) <> 0 then
    raise exception 'user B can read user A data';
  end if;
  begin
    insert into public.carts (id, user_id, name) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'x');
    raise exception 'user B could write a cart for user A';
  exception when insufficient_privilege then null;   -- expected: row-level security
  end;
end $$;
set request.jwt.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.carts) <> 1 or (select count(*) from public.cart_items) <> 1 then raise exception 'user A cannot see own data'; end if;
end $$;
reset role;
select 'RLS OK';
