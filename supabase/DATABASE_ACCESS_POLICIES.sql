-- 윤실장: database access policies (Supabase / PostgreSQL 15+)
-- Apply order: supabase/schema_platform.sql → supabase/schema.sql → this file. Idempotent (safe to run again).
-- Tested on PostgreSQL 16 with a Supabase stand-in (tests/db/supabase_stub.sql, tests/db/security_test.sql).
--
-- Principles
--   * Every table in the API schema has row level security. Nothing is readable or writable through the API unless a
--     policy below says so; grants are revoked first and given back one by one (least privilege).
--   * Prices and the catalog: anyone may READ verified, unexpired prices. Nobody writes them through the API except an
--     admin signed in with a second factor (MFA, JWT claim aal = 'aal2'). The weekly pipeline writes with the
--     service_role key, which lives only in GitHub Actions secrets (never in the browser) and bypasses RLS by design.
--   * User data (profile, records, carts, cart items, saved packages, alerts, favorites): only its owner (auth.uid()),
--     for each of SELECT / INSERT / UPDATE / DELETE separately. Passing someone else's user_id or cart_id does nothing.
--   * Roles live in public.user_roles, which no API user can write. Checks run in the database (policies and
--     SECURITY DEFINER functions), never in the client: hiding a button protects nothing.
--   * Every change to prices, the catalog and roles is written to audit_logs by a trigger (who, when, before → after).
--     audit_logs and verification_logs are append-only.
--   * Per-user quotas stop scripted abuse of the user tables; violations are logged (RAISE LOG) and refused with a
--     plain 'quota exceeded' (no internals in the error).
begin;

-- ---------------------------------------------------------------- 0. migration record
create table if not exists public.schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now(),
  note        text
);
alter table public.schema_migrations enable row level security;      -- no policy: not visible through the API

-- ---------------------------------------------------------------- 1. roles and the checks every policy uses
create table if not exists public.user_roles (
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('admin', 'reviewer')),
  granted_by  text not null default current_user,
  granted_at  timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;
-- roles are granted only from the Supabase SQL editor / service_role, e.g.
--   insert into public.user_roles (user_id, role) values ('<auth user uuid>', 'admin');

create or replace function public.has_role(r text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = r)
$$;
-- second factor: Supabase puts aal2 in the JWT only after an MFA challenge in this session
create or replace function public.mfa_verified() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
create or replace function public.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select public.has_role('admin') and public.mfa_verified()
$$;
create or replace function public.is_reviewer() returns boolean
language sql stable set search_path = '' as $$
  select (public.has_role('reviewer') or public.has_role('admin')) and public.mfa_verified()
$$;

-- ---------------------------------------------------------------- 2. least privilege: take everything away first
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
revoke all on function public.has_role(text), public.mfa_verified(), public.is_admin(), public.is_reviewer() from public;
grant execute on function public.has_role(text), public.mfa_verified(), public.is_admin(), public.is_reviewer() to anon, authenticated;

-- RLS on every table of the schema (new ones included when this file is run again)
do $$ declare t regclass; begin
  for t in select c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop execute format('alter table %s enable row level security', t); end loop;
end $$;

-- ---------------------------------------------------------------- 3. public read-only pricing
grant select on public.clinic_brands, public.clinic_branches, public.treatment_categories, public.treatment_products,
  public.treatment_variants, public.offers, public.offer_conditions, public.official_packages, public.official_package_items,
  public.price_snapshots, public.current_offers to anon, authenticated;
-- the snapshot partitions get no grant: history is read through public.price_snapshots and its policy only

do $$ declare t text; begin
  foreach t in array array['clinic_brands', 'clinic_branches', 'treatment_categories', 'treatment_products', 'treatment_variants'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
  end loop;
end $$;

drop policy if exists offers_read_verified on public.offers;
create policy offers_read_verified on public.offers for select to anon, authenticated
  using (verification_status = 'VERIFIED' and (valid_until is null or valid_until >= current_date));
drop policy if exists offers_read_reviewer on public.offers;                 -- the review queue (pending, stale …)
create policy offers_read_reviewer on public.offers for select to authenticated using (public.is_reviewer());

-- child rows are visible exactly when their offer is (the subquery runs under the offers policies)
drop policy if exists offer_conditions_read on public.offer_conditions;
create policy offer_conditions_read on public.offer_conditions for select to anon, authenticated
  using (exists (select 1 from public.offers o where o.id = offer_id));
drop policy if exists official_packages_read on public.official_packages;
create policy official_packages_read on public.official_packages for select to anon, authenticated
  using (exists (select 1 from public.offers o where o.id = offer_id));
drop policy if exists official_package_items_read on public.official_package_items;
create policy official_package_items_read on public.official_package_items for select to anon, authenticated
  using (exists (select 1 from public.official_packages p where p.id = package_id));
drop policy if exists price_snapshots_read on public.price_snapshots;
create policy price_snapshots_read on public.price_snapshots for select to anon, authenticated
  using (verification_status = 'VERIFIED');

-- ---------------------------------------------------------------- 4. restricted administrative writes (admin + MFA)
grant insert, update, delete on public.clinic_brands, public.clinic_branches, public.treatment_categories,
  public.treatment_products, public.treatment_variants, public.offers, public.offer_conditions, public.official_packages,
  public.official_package_items to authenticated;
grant usage on all sequences in schema public to authenticated;   -- serial ids for admin inserts (rows still need the policy)

do $$ declare t text; begin
  foreach t in array array['clinic_brands', 'clinic_branches', 'treatment_categories', 'treatment_products', 'treatment_variants',
                           'offers', 'offer_conditions', 'official_packages', 'official_package_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_admin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_admin_delete', t);
    -- admins see every row of these tables (pending and expired offers included) to edit them
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
  end loop;
end $$;

-- pipeline / operations tables: reviewers read, nobody writes through the API (service_role pipeline only)
grant select on public.source_registry, public.ingestion_jobs, public.verification_logs to authenticated;
drop policy if exists source_registry_read on public.source_registry;
create policy source_registry_read on public.source_registry for select to authenticated using (public.is_reviewer());
drop policy if exists ingestion_jobs_read on public.ingestion_jobs;
create policy ingestion_jobs_read on public.ingestion_jobs for select to authenticated using (public.is_reviewer());
drop policy if exists verification_logs_read on public.verification_logs;
create policy verification_logs_read on public.verification_logs for select to authenticated using (public.is_reviewer());

-- audit log: admins read; written only by the trigger below; nobody can change or delete it
grant select on public.audit_logs to authenticated;
drop policy if exists audit_logs_read on public.audit_logs;
create policy audit_logs_read on public.audit_logs for select to authenticated using (public.is_admin());

-- roles: a user sees only their own roles; nobody grants roles through the API
grant select on public.user_roles to authenticated;
drop policy if exists user_roles_read_own on public.user_roles;
create policy user_roles_read_own on public.user_roles for select to authenticated using (user_id = auth.uid());
drop policy if exists user_roles_read_admin on public.user_roles;
create policy user_roles_read_admin on public.user_roles for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- 5. user reports (signed-in users; reviewers handle them)
alter table public.user_reports add column if not exists user_id uuid references auth.users (id) on delete set null default auth.uid();
create index if not exists user_reports_user_idx on public.user_reports (user_id, created_at desc);
grant select on public.user_reports to authenticated;
grant insert (offer_id, reason) on public.user_reports to authenticated;   -- user_id and status come from defaults
grant update (status) on public.user_reports to authenticated;            -- only reviewers pass the policy
grant delete on public.user_reports to authenticated;                     -- only admins pass the policy
drop policy if exists user_reports_insert_own on public.user_reports;
create policy user_reports_insert_own on public.user_reports for insert to authenticated
  with check (user_id = auth.uid() and status = 'OPEN');
drop policy if exists user_reports_read on public.user_reports;
create policy user_reports_read on public.user_reports for select to authenticated using (user_id = auth.uid() or public.is_reviewer());
drop policy if exists user_reports_review on public.user_reports;
create policy user_reports_review on public.user_reports for update to authenticated using (public.is_reviewer()) with check (public.is_reviewer());
drop policy if exists user_reports_admin_delete on public.user_reports;
create policy user_reports_admin_delete on public.user_reports for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- 6. review queue action (server-side authorization)
create or replace function public.review_offer(p_offer bigint, p_action text, p_reason text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_price integer; v_status text;
begin
  if not public.is_reviewer() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action not in ('APPROVE', 'REJECT', 'EXPIRE', 'REOPEN') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  v_status := case p_action when 'APPROVE' then 'VERIFIED' when 'REJECT' then 'UNAVAILABLE' when 'EXPIRE' then 'EXPIRED' else 'PENDING_REVIEW' end;
  update public.offers set verification_status = v_status where id = p_offer returning price_krw into v_price;
  if not found then
    raise exception 'offer not found' using errcode = 'P0002';
  end if;
  insert into public.verification_logs (offer_id, action, reason, after_krw, actor)
    values (p_offer, p_action, left(p_reason, 500), v_price, auth.uid()::text);
  return v_status;
end $$;
revoke all on function public.review_offer(bigint, text, text) from public, anon;
grant execute on function public.review_offer(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------- 7. audit logging (prices, catalog, roles)
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  a jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  k text;
begin
  if tg_op = 'UPDATE' then                     -- keep only the fields that changed
    for k in select jsonb_object_keys(a) loop
      if a -> k is not distinct from b -> k then a := a - k; b := b - k; end if;
    end loop;
    if a = '{}'::jsonb then return new; end if;
  end if;
  insert into public.audit_logs (table_name, row_id, action, before, after, actor)
  values (tg_table_name,
          coalesce(to_jsonb(coalesce(new, old)) ->> 'id', concat_ws('|', to_jsonb(coalesce(new, old)) ->> 'user_id',
                   to_jsonb(coalesce(new, old)) ->> 'offer_id', to_jsonb(coalesce(new, old)) ->> 'role')),
          tg_op, b, a,
          coalesce(auth.uid()::text, nullif(auth.jwt() ->> 'role', ''), session_user));
  return coalesce(new, old);
end $$;
revoke all on function public.audit_row() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['clinic_brands', 'clinic_branches', 'treatment_products', 'treatment_variants', 'official_packages',
                           'source_registry', 'user_roles'] loop
    execute format('drop trigger if exists audit_changes on public.%I', t);
    execute format('create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;
-- offers: the weekly pipeline touches last_seen on every row; only changes that matter to users are logged
drop trigger if exists audit_changes on public.offers;
create trigger audit_changes after insert or delete or update of price_krw, list_price_krw, verification_status, valid_until, name, variant_id, kind
  on public.offers for each row execute function public.audit_row();

create or replace function public.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- the one change allowed: 'on delete set null' when the referenced offer is deleted (the log row itself stays)
  if tg_op = 'UPDATE' and (to_jsonb(new) ->> 'offer_id') is null and (to_jsonb(new) - 'offer_id') = (to_jsonb(old) - 'offer_id') then
    return new;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
drop trigger if exists append_only on public.audit_logs;
create trigger append_only before update or delete on public.audit_logs for each row execute function public.forbid_change();
drop trigger if exists append_only on public.verification_logs;
create trigger append_only before update or delete on public.verification_logs for each row execute function public.forbid_change();

-- ---------------------------------------------------------------- 8. user-owned data: one policy per command
grant select, insert, update, delete on public.profiles, public.records, public.carts, public.cart_items,
  public.saved_packages, public.price_alerts, public.favorites to authenticated;
-- (anon gets nothing on these tables)

drop policy if exists "own profile" on public.profiles;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated using (id = auth.uid());

drop policy if exists "own records" on public.records;
drop policy if exists "own carts" on public.carts;
drop policy if exists "own packages" on public.saved_packages;
do $$ declare t text; begin
  foreach t in array array['records', 'carts', 'saved_packages', 'favorites'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid())', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;

-- cart items belong to whoever owns the cart; an item can never be moved into, or added to, someone else's cart
drop policy if exists "own cart items" on public.cart_items;
drop policy if exists cart_items_select on public.cart_items;
create policy cart_items_select on public.cart_items for select to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()));
drop policy if exists cart_items_insert on public.cart_items;
create policy cart_items_insert on public.cart_items for insert to authenticated
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()));
drop policy if exists cart_items_update on public.cart_items;
create policy cart_items_update on public.cart_items for update to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()));
drop policy if exists cart_items_delete on public.cart_items;
create policy cart_items_delete on public.cart_items for delete to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()));

-- alerts: own rows, and a cart alert may point only at one of your own carts
drop policy if exists "own alerts" on public.price_alerts;
drop policy if exists price_alerts_select on public.price_alerts;
create policy price_alerts_select on public.price_alerts for select to authenticated using (user_id = auth.uid());
drop policy if exists price_alerts_insert on public.price_alerts;
create policy price_alerts_insert on public.price_alerts for insert to authenticated
  with check (user_id = auth.uid() and (cart_id is null or exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid())));
drop policy if exists price_alerts_update on public.price_alerts;
create policy price_alerts_update on public.price_alerts for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and (cart_id is null or exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid())));
drop policy if exists price_alerts_delete on public.price_alerts;
create policy price_alerts_delete on public.price_alerts for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- 9. quotas (abuse prevention on user writes)
-- tg_argv: [0] max rows, [1] owner column, [2] optional time window on created_at (e.g. '1 day')
create or replace function public.enforce_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim integer := tg_argv[0]::integer; col text := tg_argv[1]; win interval := nullif(tg_argv[2], '')::interval;
        owner text; n integer;
begin
  owner := to_jsonb(new) ->> col;
  if win is null then
    execute format('select count(*) from %I.%I where %I::text = $1', tg_table_schema, tg_table_name, col) into n using owner;
  else
    execute format('select count(*) from %I.%I where %I::text = $1 and created_at > now() - $2', tg_table_schema, tg_table_name, col) into n using owner, win;
  end if;
  if n >= lim then
    raise log 'quota_exceeded table=%.% owner=% limit=%', tg_table_schema, tg_table_name, owner, lim;   -- abuse signal in the Postgres log
    raise exception 'quota exceeded' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.enforce_quota() from public, anon, authenticated;

drop trigger if exists quota on public.carts;
create trigger quota before insert on public.carts for each row execute function public.enforce_quota('30', 'user_id');
drop trigger if exists quota on public.cart_items;
create trigger quota before insert on public.cart_items for each row execute function public.enforce_quota('50', 'cart_id');
drop trigger if exists quota on public.saved_packages;
create trigger quota before insert on public.saved_packages for each row execute function public.enforce_quota('50', 'user_id');
drop trigger if exists quota on public.price_alerts;
create trigger quota before insert on public.price_alerts for each row execute function public.enforce_quota('100', 'user_id');
drop trigger if exists quota on public.favorites;
create trigger quota before insert on public.favorites for each row execute function public.enforce_quota('500', 'user_id');
drop trigger if exists quota on public.records;
create trigger quota before insert on public.records for each row execute function public.enforce_quota('2000', 'user_id');
drop trigger if exists quota on public.user_reports;
create trigger quota before insert on public.user_reports for each row execute function public.enforce_quota('10', 'user_id', '1 day');

-- ---------------------------------------------------------------- 10. account deletion stays available to the owner only
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

insert into public.schema_migrations (version, note) values ('2026-10-13-security-1',
  'RLS on all tables, explicit per-command policies, admin = role + MFA, audit triggers, append-only logs, quotas')
  on conflict (version) do nothing;
commit;
