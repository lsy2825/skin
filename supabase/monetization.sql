-- 윤실장 5.0 — credits, orders, payments, premium jobs (docs/CREDIT_LEDGER_SPEC.md, docs/MONETIZATION_ARCHITECTURE.md).
--
-- Rules this file enforces in the database itself, so no client, API bug or retry can break them:
--   * money and credits change only inside the commerce_* functions below (security definer, service_role only).
--     authenticated users can read their own rows; they cannot insert, update or delete any commerce table.
--   * credit_transactions is an append-only ledger. Every row says what it did to the balance and to the reserved
--     amount (effect_balance / effect_reserved); credit_wallets is a projection of it, updated in the same transaction,
--     and commerce_verify_wallet() recomputes it from the ledger.
--   * paid (purchased) and promotional credits are separate buckets. Paid credits never expire. Promo credits are spent
--     first. A wallet can never go below zero (check constraints) — a refund of spent credits is recorded as
--     'unrecovered', never as a negative balance.
--   * exactly once: unique keys on idempotency keys, provider payment ids, refund ids, (user, job idempotency key),
--     one payment per order; row locks (for update) on the order / wallet / job being changed.
--   * prices are snapshotted into the order when it is created; a later catalog change never touches an order.
--
-- Needs: Supabase (or tests/db/supabase_stub.sql) for auth.users / auth.uid() and the anon / authenticated /
-- service_role roles; supabase/schema_platform.sql for public.audit_logs. Idempotent: safe to run twice.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- 1. versioned catalogs (prices are data, not code)
create table if not exists public.credit_products (
  code          text not null check (code ~ '^[A-Z][A-Z0-9_]{1,30}$'),           -- MINI · STANDARD · PLUS
  version       int  not null check (version > 0),
  channel       text not null check (channel in ('WEB_PG', 'APPLE_IAP', 'GOOGLE_PLAY', 'DEMO')),
  store_product_id text,                                                         -- App Store / Play product id (native only)
  price_krw     int  not null check (price_krw > 0),
  vat_included  boolean not null,
  paid_credits  int  not null check (paid_credits > 0),
  adfree_days   int  not null default 0 check (adfree_days >= 0),
  active        boolean not null default false,
  approved_by   text,                                                            -- business approval (required for live channels)
  approved_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  primary key (code, version, channel),
  check (channel = 'DEMO' or not active or approved_by is not null)              -- a real channel sells only approved prices
);
create unique index if not exists credit_products_one_active on public.credit_products (code, channel) where active;

create table if not exists public.premium_features (
  code             text not null check (code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  version          int  not null check (version > 0),
  credits          int  not null check (credits > 0),
  entitlement_days int  not null default 0 check (entitlement_days >= 0),       -- planner 30 · watch 7/30 · one-off 0
  title            text not null,
  active           boolean not null default false,
  created_at       timestamptz not null default now(),
  primary key (code, version)
);
create unique index if not exists premium_features_one_active on public.premium_features (code) where active;

-- ---------------------------------------------------------------- 2. wallet + ledger
create table if not exists public.credit_wallets (
  user_id        uuid primary key references auth.users (id) on delete restrict,
  paid_balance   int not null default 0 check (paid_balance >= 0),
  promo_balance  int not null default 0 check (promo_balance >= 0),
  paid_reserved  int not null default 0 check (paid_reserved >= 0),
  promo_reserved int not null default 0 check (promo_reserved >= 0),
  updated_at     timestamptz not null default now(),
  check (paid_reserved <= paid_balance), check (promo_reserved <= promo_balance)
);

create table if not exists public.credit_transactions (
  id              bigserial primary key,
  user_id         uuid not null references auth.users (id) on delete restrict,
  type            text not null check (type in ('PURCHASE_GRANTED', 'PROMOTIONAL_GRANTED', 'CREDIT_RESERVED', 'CREDIT_CAPTURED',
                                                 'CREDIT_RELEASED', 'PURCHASE_REFUNDED', 'PAYMENT_REVERSED', 'ADMIN_ADJUSTMENT')),
  bucket          text not null check (bucket in ('PAID', 'PROMO')),
  amount          int  not null check (amount > 0),
  effect_balance  int  not null,                    -- what this row did to the bucket's balance
  effect_reserved int  not null,                    -- … and to its reserved amount
  order_id        uuid,
  job_id          uuid,
  payment_id      bigint,
  refund_id       bigint,
  source          text not null,                    -- WEB_PG · APPLE_IAP · GOOGLE_PLAY · DEMO · JOB · ADMIN · SYSTEM
  idempotency_key text not null unique,
  actor           text not null,
  reason          text,
  created_at      timestamptz not null default now(),
  check (type <> 'ADMIN_ADJUSTMENT' or reason is not null)
);
create index if not exists credit_transactions_user on public.credit_transactions (user_id, created_at);

-- ---------------------------------------------------------------- 3. orders and payments
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete restrict,
  product_code    text not null,
  product_version int  not null,
  channel         text not null,
  amount_krw      int  not null check (amount_krw > 0),    -- snapshot: never recomputed from the catalog
  currency        text not null default 'KRW' check (currency = 'KRW'),
  vat_included    boolean not null,
  paid_credits    int  not null check (paid_credits > 0),
  adfree_days     int  not null check (adfree_days >= 0),
  order_name      text not null,
  status          text not null default 'CREATED' check (status in ('CREATED', 'FULFILLED', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED', 'PARTIAL_REFUNDED')),
  idempotency_key text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '30 minutes',
  fulfilled_at    timestamptz,
  status_reason   text,
  unique (user_id, idempotency_key),
  foreign key (product_code, product_version, channel) references public.credit_products (code, version, channel)
);
create index if not exists orders_open on public.orders (status, created_at) where status = 'CREATED';
create index if not exists orders_late on public.orders (status, created_at) where status = 'EXPIRED';

create table if not exists public.payments (
  id                  bigserial primary key,
  order_id            uuid not null unique references public.orders (id) on delete restrict,   -- one payment per order
  provider            text not null check (provider in ('TOSS', 'APPLE', 'GOOGLE', 'DEMO')),
  provider_payment_id text not null,               -- Toss paymentKey · Apple transactionId · Play orderId/purchaseToken
  amount_krw          int  not null,
  currency            text not null,
  status              text not null,               -- provider status (DONE, CANCELED, PARTIAL_CANCELED …)
  method              text,
  approved_at         timestamptz,
  refunded_krw        int not null default 0 check (refunded_krw >= 0),
  raw                 jsonb,                       -- provider response, card numbers already masked by the provider
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider, provider_payment_id),
  check (refunded_krw <= amount_krw)
);

create table if not exists public.payment_provider_events (
  id           bigserial primary key,
  provider     text not null,
  event_key    text not null,                      -- provider event id, or a hash of the body when there is none
  type         text not null,
  payload      jsonb not null,
  verified     text not null,                      -- SIGNATURE · API_LOOKUP · NONE (NONE never changes balances)
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  result       text,
  unique (provider, event_key)
);

create table if not exists public.payment_refunds (
  id                  bigserial primary key,
  payment_id          bigint not null references public.payments (id) on delete restrict,
  provider            text not null,
  provider_refund_id  text not null,
  kind                text not null check (kind in ('REFUND', 'CHARGEBACK', 'REVOCATION')),
  amount_krw          int  not null check (amount_krw > 0),
  credits_target      int  not null,               -- credits that this refund takes back (proportional to the amount)
  credits_reversed    int  not null,               -- … actually taken back (never more than the unspent paid balance)
  credits_unrecovered int  not null,               -- … already spent: recorded, never a negative balance
  adfree_days_removed int  not null default 0,
  reason              text,
  actor               text not null,
  created_at          timestamptz not null default now(),
  unique (provider, provider_refund_id)
);

create table if not exists public.payment_reconciliation_jobs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  checked     int not null default 0,
  fixed       int not null default 0,
  mismatches  jsonb not null default '[]'
);

-- ---------------------------------------------------------------- 4. premium jobs, reservations, reports, entitlements
create table if not exists public.premium_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete restrict,
  feature_code    text not null,
  feature_version int  not null,
  credits         int  not null check (credits >= 0),      -- 0 = covered by an active entitlement
  status          text not null check (status in ('RESERVED', 'RUNNING', 'SUCCEEDED', 'RELEASED')),
  idempotency_key text not null,
  input_hash      text,
  scope           jsonb not null default '{}',
  report_id       uuid,
  error           text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  expires_at      timestamptz not null default now() + interval '10 minutes',   -- a crashed job is released after this
  unique (user_id, idempotency_key),
  foreign key (feature_code, feature_version) references public.premium_features (code, version)
);
create index if not exists premium_jobs_open on public.premium_jobs (expires_at) where status in ('RESERVED', 'RUNNING');

create table if not exists public.credit_reservations (
  job_id     uuid primary key references public.premium_jobs (id) on delete restrict,
  user_id    uuid not null,
  paid       int  not null check (paid >= 0),
  promo      int  not null check (promo >= 0),
  status     text not null check (status in ('RESERVED', 'CAPTURED', 'RELEASED')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create table if not exists public.premium_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete restrict,
  job_id        uuid unique references public.premium_jobs (id),
  kind          text not null,
  title         text not null,
  payload       jsonb,                             -- null after the user deletes it
  share_token   text unique,
  share_summary jsonb,                             -- privacy-safe public part (no uploads, no personal text)
  created_at    timestamptz not null default now(),
  retain_until  timestamptz not null default now() + interval '1 year',
  deleted_at    timestamptz
);

create table if not exists public.premium_entitlements (
  id           bigserial primary key,
  user_id      uuid not null references auth.users (id) on delete restrict,
  feature_code text not null,
  job_id       uuid not null unique references public.premium_jobs (id),
  scope        jsonb not null default '{}',
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz not null
);
create index if not exists premium_entitlements_active on public.premium_entitlements (user_id, feature_code, ends_at);

create table if not exists public.ad_free_entitlements (
  user_id    uuid primary key references auth.users (id) on delete restrict,
  ends_at    timestamptz not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.ad_free_grants (
  id           bigserial primary key,
  user_id      uuid not null,
  order_id     uuid not null unique references public.orders (id),
  days         int  not null check (days >= 0),
  from_at      timestamptz not null,
  to_at        timestamptz not null,
  revoked_days int  not null default 0,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- 5. price watch, push, uploads, costs
create table if not exists public.price_watch_rules (
  id             bigserial primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  entitlement_id bigint references public.premium_entitlements (id),
  key_id         text not null,                    -- comparison id in data.json (X12, T…)
  kind           text not null check (kind in ('watch', 'target', 'newlow', 'newmatch', 'expiring')),
  target_krw     int check (target_krw is null or target_krw > 0),
  region         text not null default '전국',
  quiet_start    smallint check (quiet_start between 0 and 23),
  quiet_end      smallint check (quiet_end between 0 and 23),
  active         boolean not null default true,
  baseline       jsonb,
  created_at     timestamptz not null default now()
);
create table if not exists public.push_subscriptions (
  id          bigserial primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://'),
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  failures    int not null default 0
);
create table if not exists public.price_watch_events (
  id          bigserial primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  rule_id     bigint not null references public.price_watch_rules (id) on delete cascade,
  event_key   text not null,                       -- type|key|branch|data version: one notice per change
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (user_id, rule_id, event_key)
);
create table if not exists public.uploaded_assets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime         text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  bytes        int  not null check (bytes > 0 and bytes <= 8388608),
  storage_key  text not null,
  purpose      text not null check (purpose in ('EVENT_IMAGE', 'QUOTATION')),
  created_at   timestamptz not null default now(),
  delete_after timestamptz not null default now() + interval '7 days',  -- originals are deleted; extracted fields stay in the report
  deleted_at   timestamptz,
  unique (user_id, sha256, purpose)
);
create table if not exists public.model_cost_config (
  id                         bigserial primary key,
  provider                   text not null,
  model                      text not null,
  effective_date             date not null,
  input_cost_per_million     numeric not null check (input_cost_per_million >= 0),
  cached_input_cost_per_million numeric not null check (cached_input_cost_per_million >= 0),
  output_cost_per_million    numeric not null check (output_cost_per_million >= 0),
  image_cost_calculation_method text not null,     -- e.g. 'tokens reported in usage.input_tokens'
  currency                   text not null default 'USD',
  exchange_rate_used         numeric not null check (exchange_rate_used > 0),   -- KRW per currency unit, at effective_date
  pricing_source             text not null,
  last_verified_at           timestamptz not null,
  unique (provider, model, effective_date)
);
create table if not exists public.ai_usage_records (
  id                  bigserial primary key,
  job_id              uuid references public.premium_jobs (id),
  user_id             uuid,
  provider            text not null,
  model               text not null,
  call_kind           text not null check (call_kind in ('PRIMARY', 'FALLBACK', 'RETRY')),
  input_tokens        int not null default 0 check (input_tokens >= 0),
  cached_input_tokens int not null default 0 check (cached_input_tokens >= 0),
  output_tokens       int not null default 0 check (output_tokens >= 0),
  image_count         int not null default 0,
  cost_config_id      bigint references public.model_cost_config (id),
  cost_krw            numeric,                     -- null when no price schedule covers the call date (reported as such)
  ok                  boolean not null,
  created_at          timestamptz not null default now()
);
create table if not exists public.service_cost_records (
  id           bigserial primary key,
  category     text not null check (category in ('AI', 'INFRA', 'DATA', 'COMMERCE', 'OPERATIONS')),
  item         text not null,
  period_start date not null,
  period_end   date not null,
  amount_krw   numeric not null,
  kind         text not null check (kind in ('ACTUAL', 'BUDGET')),   -- verified invoices vs assumptions, never mixed up
  source       text not null,
  note         text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- 6. append-only + access control
create or replace function public.commerce_forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
drop trigger if exists append_only on public.credit_transactions;
create trigger append_only before update or delete on public.credit_transactions for each row execute function public.commerce_forbid_change();
drop trigger if exists append_only on public.payment_refunds;
create trigger append_only before update or delete on public.payment_refunds for each row execute function public.commerce_forbid_change();
drop trigger if exists append_only on public.ai_usage_records;
create trigger append_only before update or delete on public.ai_usage_records for each row execute function public.commerce_forbid_change();

do $$ declare t text; begin
  foreach t in array array['credit_products', 'premium_features', 'credit_wallets', 'credit_transactions', 'orders', 'payments',
    'payment_provider_events', 'payment_refunds', 'payment_reconciliation_jobs', 'premium_jobs', 'credit_reservations',
    'premium_reports', 'premium_entitlements', 'ad_free_entitlements', 'ad_free_grants', 'price_watch_rules', 'push_subscriptions',
    'price_watch_events', 'uploaded_assets', 'model_cost_config', 'ai_usage_records', 'service_cost_records']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);   -- undo Supabase's default grants
  end loop;
end $$;
-- catalogs: anyone reads the active prices
grant select on public.credit_products, public.premium_features to anon, authenticated;
drop policy if exists credit_products_read on public.credit_products;
create policy credit_products_read on public.credit_products for select to anon, authenticated using (active);
drop policy if exists premium_features_read on public.premium_features;
create policy premium_features_read on public.premium_features for select to anon, authenticated using (active);
-- own rows, read only
do $$ declare t text; begin
  foreach t in array array['credit_wallets', 'credit_transactions', 'orders', 'premium_jobs', 'premium_entitlements',
    'ad_free_entitlements', 'ad_free_grants', 'price_watch_rules', 'push_subscriptions', 'price_watch_events', 'uploaded_assets']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', t || '_own', t);
  end loop;
end $$;
grant select on public.premium_reports to authenticated;
drop policy if exists premium_reports_own on public.premium_reports;
create policy premium_reports_own on public.premium_reports for select to authenticated using (user_id = auth.uid() and deleted_at is null);
grant select on public.payments to authenticated;
drop policy if exists payments_own on public.payments;
create policy payments_own on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));

-- ---------------------------------------------------------------- 7. functions (the only writers)
create or replace function public.commerce_audit(p_table text, p_row text, p_action text, p_after jsonb, p_actor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (table_name, row_id, action, before, after, actor) values (p_table, p_row, p_action, null, p_after, p_actor);
  end if;
end $$;

-- one ledger row + the wallet projection, in the caller's transaction (the caller holds the wallet lock)
create or replace function public.commerce_post(p_user uuid, p_type text, p_bucket text, p_amount int, p_eb int, p_er int,
  p_key text, p_source text, p_actor text, p_reason text default null, p_order uuid default null, p_job uuid default null,
  p_payment bigint default null, p_refund bigint default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.credit_transactions (user_id, type, bucket, amount, effect_balance, effect_reserved, order_id, job_id, payment_id,
    refund_id, source, idempotency_key, actor, reason)
  values (p_user, p_type, p_bucket, p_amount, p_eb, p_er, p_order, p_job, p_payment, p_refund, p_source, p_key, p_actor, p_reason)
  on conflict (idempotency_key) do nothing;
  if not found then return false; end if;                    -- already posted: never applied twice
  if p_bucket = 'PAID' then
    update public.credit_wallets set paid_balance = paid_balance + p_eb, paid_reserved = paid_reserved + p_er, updated_at = now() where user_id = p_user;
  else
    update public.credit_wallets set promo_balance = promo_balance + p_eb, promo_reserved = promo_reserved + p_er, updated_at = now() where user_id = p_user;
  end if;
  return true;
end $$;

create or replace function public.commerce_lock_wallet(p_user uuid) returns public.credit_wallets
language plpgsql security definer set search_path = '' as $$
declare w public.credit_wallets;
begin
  insert into public.credit_wallets (user_id) values (p_user) on conflict do nothing;
  select * into w from public.credit_wallets where user_id = p_user for update;
  return w;
end $$;

create or replace function public.commerce_wallet(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := (p ->> 'user_id')::uuid; w public.credit_wallets; af timestamptz;
begin
  select * into w from public.credit_wallets where user_id = u;
  select ends_at into af from public.ad_free_entitlements where user_id = u;
  return jsonb_build_object('user_id', u, 'paid', coalesce(w.paid_balance, 0), 'promo', coalesce(w.promo_balance, 0),
    'paid_reserved', coalesce(w.paid_reserved, 0), 'promo_reserved', coalesce(w.promo_reserved, 0),
    'available', coalesce(w.paid_balance - w.paid_reserved + w.promo_balance - w.promo_reserved, 0),
    'ad_free_until', case when af > now() then af end);
end $$;

-- the wallet recomputed from the ledger (ok = projection equals the sums)
create or replace function public.commerce_verify_wallet(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := (p ->> 'user_id')::uuid; s record; w public.credit_wallets;
begin
  select coalesce(sum(effect_balance) filter (where bucket = 'PAID'), 0) pb, coalesce(sum(effect_reserved) filter (where bucket = 'PAID'), 0) pr,
         coalesce(sum(effect_balance) filter (where bucket = 'PROMO'), 0) qb, coalesce(sum(effect_reserved) filter (where bucket = 'PROMO'), 0) qr
    into s from public.credit_transactions where user_id = u;
  select * into w from public.credit_wallets where user_id = u;
  return jsonb_build_object('ok', coalesce(w.paid_balance, 0) = s.pb and coalesce(w.paid_reserved, 0) = s.pr and coalesce(w.promo_balance, 0) = s.qb
    and coalesce(w.promo_reserved, 0) = s.qr and s.pr = (select coalesce(sum(paid), 0) from public.credit_reservations where user_id = u and status = 'RESERVED')
    and s.qr = (select coalesce(sum(promo), 0) from public.credit_reservations where user_id = u and status = 'RESERVED'),
    'ledger', jsonb_build_object('paid', s.pb, 'paid_reserved', s.pr, 'promo', s.qb, 'promo_reserved', s.qr),
    'wallet', jsonb_build_object('paid', w.paid_balance, 'paid_reserved', w.paid_reserved, 'promo', w.promo_balance, 'promo_reserved', w.promo_reserved));
end $$;

-- order with an immutable price snapshot from the active catalog row. Same (user, idempotency key) → the same order;
-- the same key for a different product is refused (a client cannot swap the product behind an order).
create or replace function public.commerce_create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := (p ->> 'user_id')::uuid; pr public.credit_products; o public.orders;
begin
  if u is null or coalesce(p ->> 'idempotency_key', '') !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  select * into o from public.orders where user_id = u and idempotency_key = p ->> 'idempotency_key';
  if found then
    if o.product_code <> p ->> 'product_code' or o.channel <> p ->> 'channel' then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505'; end if;
    return to_jsonb(o);
  end if;
  select * into pr from public.credit_products where code = p ->> 'product_code' and channel = p ->> 'channel' and active;
  if not found then raise exception 'PRODUCT_NOT_FOR_SALE' using errcode = '22023'; end if;
  insert into public.orders (user_id, product_code, product_version, channel, amount_krw, vat_included, paid_credits, adfree_days, order_name, idempotency_key)
  values (u, pr.code, pr.version, pr.channel, pr.price_krw, pr.vat_included, pr.paid_credits, pr.adfree_days,
          format('윤실장 크레딧 %s (%s크레딧)', pr.code, pr.paid_credits), p ->> 'idempotency_key')
  returning * into o;
  return to_jsonb(o);
end $$;

-- a verified payment → credits + ad-free days, exactly once. p: order_id, provider, provider_payment_id, amount, currency,
-- status (must be DONE / provider's paid state, mapped by the adapter), method, approved_at, raw, actor
create or replace function public.commerce_fulfill_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; pay public.payments; prov text := p ->> 'provider'; ch text; af timestamptz; nf timestamptz; actor text := coalesce(p ->> 'actor', 'system');
begin
  select * into o from public.orders where id = (p ->> 'order_id')::uuid for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = '22023'; end if;
  ch := case prov when 'TOSS' then 'WEB_PG' when 'APPLE' then 'APPLE_IAP' when 'GOOGLE' then 'GOOGLE_PLAY' when 'DEMO' then 'DEMO' end;
  if ch is distinct from o.channel then raise exception 'CHANNEL_MISMATCH' using errcode = '22023'; end if;
  select * into pay from public.payments where order_id = o.id;
  if found then
    if pay.provider = prov and pay.provider_payment_id = p ->> 'provider_payment_id' then
      return jsonb_build_object('already', true, 'order', to_jsonb(o), 'wallet', public.commerce_wallet(jsonb_build_object('user_id', o.user_id)));
    end if;
    raise exception 'ORDER_ALREADY_PAID' using errcode = '23505';   -- a second, different payment for one order: refund it by hand
  end if;
  if (p ->> 'amount')::int is distinct from o.amount_krw then raise exception 'AMOUNT_MISMATCH' using errcode = '22023'; end if;
  if coalesce(p ->> 'currency', '') <> o.currency then raise exception 'CURRENCY_MISMATCH' using errcode = '22023'; end if;
  if coalesce(p ->> 'status', '') <> 'DONE' then raise exception 'PAYMENT_NOT_DONE' using errcode = '22023'; end if;
  if o.status not in ('CREATED', 'EXPIRED', 'FAILED', 'CANCELED') then raise exception 'ORDER_NOT_PAYABLE' using errcode = '22023'; end if;
  -- (a payment that arrives after the order expired or was abandoned is still real money: it is fulfilled — late confirmation)
  insert into public.payments (order_id, provider, provider_payment_id, amount_krw, currency, status, method, approved_at, raw)
  values (o.id, prov, p ->> 'provider_payment_id', o.amount_krw, o.currency, 'DONE', p ->> 'method', nullif(p ->> 'approved_at', '')::timestamptz, p -> 'raw')
  returning * into pay;
  perform public.commerce_lock_wallet(o.user_id);
  perform public.commerce_post(o.user_id, 'PURCHASE_GRANTED', 'PAID', o.paid_credits, o.paid_credits, 0, 'grant:' || o.id, o.channel, actor,
    null, o.id, null, pay.id);
  if o.adfree_days > 0 then
    select ends_at into af from public.ad_free_entitlements where user_id = o.user_id for update;
    nf := greatest(now(), coalesce(af, now())) + make_interval(days => o.adfree_days);   -- extend from the later of now / current end
    insert into public.ad_free_entitlements (user_id, ends_at) values (o.user_id, nf)
      on conflict (user_id) do update set ends_at = excluded.ends_at, updated_at = now();
    insert into public.ad_free_grants (user_id, order_id, days, from_at, to_at) values (o.user_id, o.id, o.adfree_days, nf - make_interval(days => o.adfree_days), nf);
  end if;
  update public.orders set status = 'FULFILLED', fulfilled_at = now(), status_reason = null where id = o.id returning * into o;
  perform public.commerce_audit('orders', o.id::text, 'UPDATE', jsonb_build_object('status', 'FULFILLED', 'payment', pay.provider_payment_id), actor);
  return jsonb_build_object('already', false, 'order', to_jsonb(o), 'wallet', public.commerce_wallet(jsonb_build_object('user_id', o.user_id)));
end $$;

-- an order the provider says was not paid (failed / cancelled by the buyer / expired). Never touches a fulfilled order.
create or replace function public.commerce_close_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if p ->> 'status' not in ('FAILED', 'CANCELED', 'EXPIRED') then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  update public.orders set status = p ->> 'status', status_reason = left(p ->> 'reason', 200)
   where id = (p ->> 'order_id')::uuid and status = 'CREATED' returning * into o;
  return jsonb_build_object('changed', o.id is not null);
end $$;

-- refund / chargeback / store revocation. Credits taken back = round(paid_credits × refund ÷ amount), but never more than the
-- unspent paid balance (no negative wallet); the rest is recorded as unrecovered. kind REFUND requested by us is refused
-- when credits were already spent unless p.provider_done = true (the provider already returned the money: record it).
create or replace function public.commerce_refund(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pay public.payments; o public.orders; w public.credit_wallets; r public.payment_refunds; amt int := (p ->> 'amount')::int;
        target int; avail int; back int; g public.ad_free_grants; v_days int := 0; actor text := coalesce(p ->> 'actor', 'system');
begin
  select * into r from public.payment_refunds where provider = p ->> 'provider' and provider_refund_id = p ->> 'provider_refund_id';
  if found then return jsonb_build_object('already', true, 'refund', to_jsonb(r)); end if;
  select * into pay from public.payments where provider = p ->> 'provider' and provider_payment_id = p ->> 'provider_payment_id' for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = '22023'; end if;
  if amt is null or amt <= 0 or pay.refunded_krw + amt > pay.amount_krw then raise exception 'REFUND_AMOUNT_INVALID' using errcode = '22023'; end if;
  select * into o from public.orders where id = pay.order_id for update;
  w := public.commerce_lock_wallet(o.user_id);
  -- cumulative: what all refunds so far should have taken minus what they did (5.1 audit: per-refund rounding over-took credits)
  target := greatest(0, round(o.paid_credits::numeric * (pay.refunded_krw + amt) / pay.amount_krw)::int
                        - coalesce((select sum(credits_target) from public.payment_refunds where payment_id = pay.id), 0));
  avail := w.paid_balance - w.paid_reserved;
  back := least(target, greatest(avail, 0));
  if back < target and coalesce(p ->> 'kind', 'REFUND') = 'REFUND' and not coalesce((p ->> 'provider_done')::boolean, false) then
    raise exception 'CREDITS_ALREADY_SPENT' using errcode = '22023', detail = format('target %s, unspent %s', target, avail);
  end if;
  if pay.refunded_krw + amt = pay.amount_krw then                      -- full refund: the pack's ad-free days go too
    select * into g from public.ad_free_grants where order_id = o.id;
    if found then
      v_days := g.days - g.revoked_days;
      update public.ad_free_entitlements set ends_at = greatest(now(), ends_at - make_interval(days => v_days)), updated_at = now() where user_id = o.user_id;
    end if;
  end if;
  insert into public.payment_refunds (payment_id, provider, provider_refund_id, kind, amount_krw, credits_target, credits_reversed, credits_unrecovered,
    adfree_days_removed, reason, actor)
  values (pay.id, pay.provider, p ->> 'provider_refund_id', coalesce(p ->> 'kind', 'REFUND'), amt, target, back, target - back, v_days, left(p ->> 'reason', 300), actor)
  returning * into r;
  if v_days > 0 then
    -- ad_free_grants is not append-only: revoked days are counted there so a second refund cannot remove them twice
    update public.ad_free_grants set revoked_days = revoked_days + v_days where order_id = o.id;
  end if;
  if back > 0 then
    perform public.commerce_post(o.user_id, case when r.kind = 'REFUND' then 'PURCHASE_REFUNDED' else 'PAYMENT_REVERSED' end, 'PAID', back, -back, 0,
      'refund:' || r.id, o.channel, actor, r.reason, o.id, null, pay.id, r.id);
  end if;
  update public.payments set refunded_krw = refunded_krw + amt, status = case when refunded_krw + amt = amount_krw then 'CANCELED' else 'PARTIAL_CANCELED' end,
    updated_at = now() where id = pay.id;
  update public.orders set status = case when pay.refunded_krw + amt = pay.amount_krw then 'REFUNDED' else 'PARTIAL_REFUNDED' end where id = o.id;
  perform public.commerce_audit('payment_refunds', r.id::text, 'INSERT', to_jsonb(r), actor);
  return jsonb_build_object('already', false, 'refund', to_jsonb(r), 'wallet', public.commerce_wallet(jsonb_build_object('user_id', o.user_id)));
end $$;

-- what a refund would do, without doing it (support screen, refund policy)
create or replace function public.commerce_preview_refund(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pay public.payments; o public.orders; w public.credit_wallets; amt int; target int;
begin
  select * into pay from public.payments where provider = p ->> 'provider' and provider_payment_id = p ->> 'provider_payment_id';
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = '22023'; end if;
  select * into o from public.orders where id = pay.order_id;
  select * into w from public.credit_wallets where user_id = o.user_id;
  amt := coalesce((p ->> 'amount')::int, pay.amount_krw - pay.refunded_krw);
  target := round(o.paid_credits::numeric * amt / pay.amount_krw)::int;
  return jsonb_build_object('refundable_krw', pay.amount_krw - pay.refunded_krw, 'credits_target', target,
    'unspent', w.paid_balance - w.paid_reserved, 'automatic', w.paid_balance - w.paid_reserved >= target);
end $$;

-- reserve credits for a premium job. Same (user, idempotency key) → the same job (repeated taps, refreshes, retries never
-- charge twice). An active entitlement for the same feature and scope (planner 30 days) → a 0-credit job. Promo first.
create or replace function public.commerce_reserve(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := (p ->> 'user_id')::uuid; f public.premium_features; j public.premium_jobs; w public.credit_wallets; e public.premium_entitlements;
        use_promo int; use_paid int; need int;
begin
  if u is null or coalesce(p ->> 'idempotency_key', '') !~ '^[A-Za-z0-9_:-]{8,80}$' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  select * into j from public.premium_jobs where user_id = u and idempotency_key = p ->> 'idempotency_key';
  if found then return jsonb_build_object('job', to_jsonb(j), 'repeat', true); end if;
  select * into f from public.premium_features where code = p ->> 'feature_code' and active;
  if not found then raise exception 'FEATURE_NOT_AVAILABLE' using errcode = '22023'; end if;
  w := public.commerce_lock_wallet(u);                               -- serialises this user's concurrent spends
  select * into e from public.premium_entitlements where user_id = u and feature_code = f.code and ends_at > now()
     and scope = coalesce(p -> 'scope', '{}'::jsonb) order by ends_at desc limit 1;
  need := case when found then 0 else f.credits end;
  use_promo := least(need, w.promo_balance - w.promo_reserved);
  use_paid := need - use_promo;
  if use_paid > w.paid_balance - w.paid_reserved then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '22023', detail = format('need %s, available %s', need, w.paid_balance - w.paid_reserved + w.promo_balance - w.promo_reserved);
  end if;
  insert into public.premium_jobs (user_id, feature_code, feature_version, credits, status, idempotency_key, input_hash, scope, expires_at)
  values (u, f.code, f.version, need, 'RESERVED', p ->> 'idempotency_key', p ->> 'input_hash', coalesce(p -> 'scope', '{}'::jsonb),
          now() + make_interval(secs => coalesce((p ->> 'timeout_seconds')::int, 600)))
  returning * into j;
  insert into public.credit_reservations (job_id, user_id, paid, promo, status) values (j.id, u, use_paid, use_promo, 'RESERVED');
  if use_promo > 0 then perform public.commerce_post(u, 'CREDIT_RESERVED', 'PROMO', use_promo, 0, use_promo, 'reserve:' || j.id || ':PROMO', 'JOB', 'system', f.code, null, j.id); end if;
  if use_paid > 0 then perform public.commerce_post(u, 'CREDIT_RESERVED', 'PAID', use_paid, 0, use_paid, 'reserve:' || j.id || ':PAID', 'JOB', 'system', f.code, null, j.id); end if;
  return jsonb_build_object('job', to_jsonb(j), 'repeat', false, 'covered_by_entitlement', need = 0, 'wallet', public.commerce_wallet(jsonb_build_object('user_id', u)));
end $$;

create or replace function public.commerce_start_job(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.premium_jobs;
begin
  update public.premium_jobs set status = 'RUNNING', started_at = now() where id = (p ->> 'job_id')::uuid and status = 'RESERVED' returning * into j;
  return jsonb_build_object('started', j.id is not null);
end $$;

-- a delivered, validated result: capture the reservation, store the report, open the entitlement window. Idempotent.
create or replace function public.commerce_capture(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.premium_jobs; r public.credit_reservations; f public.premium_features; rep public.premium_reports; ent bigint;
begin
  select * into j from public.premium_jobs where id = (p ->> 'job_id')::uuid for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = '22023'; end if;
  if j.status = 'SUCCEEDED' then return jsonb_build_object('already', true, 'job', to_jsonb(j)); end if;
  if j.status = 'RELEASED' then raise exception 'JOB_RELEASED' using errcode = '22023'; end if;   -- too late: credits were already given back
  if p -> 'report' is null or coalesce(p -> 'report' ->> 'title', '') = '' then raise exception 'NO_DELIVERABLE' using errcode = '22023'; end if;
  perform public.commerce_lock_wallet(j.user_id);
  select * into r from public.credit_reservations where job_id = j.id for update;
  if r.promo > 0 then perform public.commerce_post(j.user_id, 'CREDIT_CAPTURED', 'PROMO', r.promo, -r.promo, -r.promo, 'capture:' || j.id || ':PROMO', 'JOB', 'system', j.feature_code, null, j.id); end if;
  if r.paid > 0 then perform public.commerce_post(j.user_id, 'CREDIT_CAPTURED', 'PAID', r.paid, -r.paid, -r.paid, 'capture:' || j.id || ':PAID', 'JOB', 'system', j.feature_code, null, j.id); end if;
  update public.credit_reservations set status = 'CAPTURED', settled_at = now() where job_id = j.id;
  insert into public.premium_reports (user_id, job_id, kind, title, payload, share_summary, retain_until)
  values (j.user_id, j.id, coalesce(p -> 'report' ->> 'kind', j.feature_code), p -> 'report' ->> 'title', p -> 'report' -> 'payload',
          p -> 'report' -> 'share_summary', now() + make_interval(days => coalesce((p -> 'report' ->> 'retain_days')::int, 365)))
  returning * into rep;
  select * into f from public.premium_features where code = j.feature_code and version = j.feature_version;
  if f.entitlement_days > 0 and j.credits > 0 then
    insert into public.premium_entitlements (user_id, feature_code, job_id, scope, ends_at)
    values (j.user_id, j.feature_code, j.id, j.scope, now() + make_interval(days => f.entitlement_days)) returning id into ent;
  end if;
  update public.premium_jobs set status = 'SUCCEEDED', finished_at = now(), report_id = rep.id where id = j.id returning * into j;
  return jsonb_build_object('already', false, 'job', to_jsonb(j), 'report_id', rep.id, 'entitlement_id', ent,
    'wallet', public.commerce_wallet(jsonb_build_object('user_id', j.user_id)));
end $$;

-- no usable result (provider error, validation failure, timeout, crash) → the reservation goes back. Idempotent.
create or replace function public.commerce_release(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.premium_jobs; r public.credit_reservations;
begin
  select * into j from public.premium_jobs where id = (p ->> 'job_id')::uuid for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = '22023'; end if;
  if j.status in ('RELEASED', 'SUCCEEDED') then return jsonb_build_object('changed', false, 'status', j.status); end if;
  perform public.commerce_lock_wallet(j.user_id);
  select * into r from public.credit_reservations where job_id = j.id for update;
  if r.promo > 0 then perform public.commerce_post(j.user_id, 'CREDIT_RELEASED', 'PROMO', r.promo, 0, -r.promo, 'release:' || j.id || ':PROMO', 'JOB', 'system', left(p ->> 'reason', 200), null, j.id); end if;
  if r.paid > 0 then perform public.commerce_post(j.user_id, 'CREDIT_RELEASED', 'PAID', r.paid, 0, -r.paid, 'release:' || j.id || ':PAID', 'JOB', 'system', left(p ->> 'reason', 200), null, j.id); end if;
  update public.credit_reservations set status = 'RELEASED', settled_at = now() where job_id = j.id;
  update public.premium_jobs set status = 'RELEASED', finished_at = now(), error = left(p ->> 'reason', 300) where id = j.id;
  return jsonb_build_object('changed', true, 'wallet', public.commerce_wallet(jsonb_build_object('user_id', j.user_id)));
end $$;

-- crash recovery: every job still reserved / running after its deadline is released (scheduled worker, every few minutes)
create or replace function public.commerce_expire_jobs(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j record; n int := 0;
begin
  for j in select id from public.premium_jobs where status in ('RESERVED', 'RUNNING') and expires_at < now() order by expires_at limit 500 loop
    perform public.commerce_release(jsonb_build_object('job_id', j.id, 'reason', 'TIMEOUT'));
    n := n + 1;
  end loop;
  return jsonb_build_object('released', n);
end $$;

create or replace function public.commerce_grant_promo(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := (p ->> 'user_id')::uuid; n int := (p ->> 'amount')::int; posted boolean;
begin
  if n is null or n <= 0 or n > 100 or coalesce(p ->> 'reason', '') = '' or coalesce(p ->> 'actor', '') = '' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  perform public.commerce_lock_wallet(u);
  posted := public.commerce_post(u, 'PROMOTIONAL_GRANTED', 'PROMO', n, n, 0, 'promo:' || (p ->> 'idempotency_key'), 'ADMIN', p ->> 'actor', p ->> 'reason');
  if posted then perform public.commerce_audit('credit_transactions', u::text, 'INSERT', p, p ->> 'actor'); end if;
  return jsonb_build_object('posted', posted, 'wallet', public.commerce_wallet(jsonb_build_object('user_id', u)));
end $$;

-- a correction by an admin: reason and actor required, audited, cannot push a balance below what is reserved or below zero
create or replace function public.commerce_admin_adjust(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := (p ->> 'user_id')::uuid; d int := (p ->> 'delta')::int; b text := p ->> 'bucket'; w public.credit_wallets; posted boolean;
begin
  if d is null or d = 0 or b not in ('PAID', 'PROMO') or coalesce(p ->> 'reason', '') = '' or coalesce(p ->> 'actor', '') = '' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  w := public.commerce_lock_wallet(u);
  if (b = 'PAID' and w.paid_balance + d < w.paid_reserved) or (b = 'PROMO' and w.promo_balance + d < w.promo_reserved) then
    raise exception 'WOULD_GO_NEGATIVE' using errcode = '22023';
  end if;
  posted := public.commerce_post(u, 'ADMIN_ADJUSTMENT', b, abs(d), d, 0, 'adjust:' || (p ->> 'idempotency_key'), 'ADMIN', p ->> 'actor', p ->> 'reason');
  if posted then perform public.commerce_audit('credit_transactions', u::text, 'INSERT', p, p ->> 'actor'); end if;
  return jsonb_build_object('posted', posted, 'wallet', public.commerce_wallet(jsonb_build_object('user_id', u)));
end $$;

-- AI call cost from the price schedule in force on the call date (null + reported when no schedule covers it)
create or replace function public.commerce_record_ai_usage(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.model_cost_config; cost numeric; id bigint;
begin
  select * into c from public.model_cost_config where provider = p ->> 'provider' and model = p ->> 'model'
     and effective_date <= coalesce((p ->> 'at')::date, current_date) order by effective_date desc limit 1;
  if found then
    cost := ((coalesce((p ->> 'input_tokens')::int, 0) - coalesce((p ->> 'cached_input_tokens')::int, 0)) * c.input_cost_per_million
           + coalesce((p ->> 'cached_input_tokens')::int, 0) * c.cached_input_cost_per_million
           + coalesce((p ->> 'output_tokens')::int, 0) * c.output_cost_per_million) / 1000000 * c.exchange_rate_used;
  end if;
  insert into public.ai_usage_records (job_id, user_id, provider, model, call_kind, input_tokens, cached_input_tokens, output_tokens, image_count, cost_config_id, cost_krw, ok)
  values (nullif(p ->> 'job_id', '')::uuid, nullif(p ->> 'user_id', '')::uuid, p ->> 'provider', p ->> 'model', coalesce(p ->> 'call_kind', 'PRIMARY'),
          coalesce((p ->> 'input_tokens')::int, 0), coalesce((p ->> 'cached_input_tokens')::int, 0), coalesce((p ->> 'output_tokens')::int, 0),
          coalesce((p ->> 'image_count')::int, 0), c.id, round(cost, 4), coalesce((p ->> 'ok')::boolean, false))
  returning ai_usage_records.id into id;
  return jsonb_build_object('id', id, 'cost_krw', round(cost, 4), 'priced', c.id is not null);
end $$;

-- the provider event log: insert once per (provider, event key); the second delivery says 'duplicate'
create or replace function public.commerce_record_event(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare id bigint;
begin
  insert into public.payment_provider_events (provider, event_key, type, payload, verified)
  values (p ->> 'provider', p ->> 'event_key', p ->> 'type', p -> 'payload', coalesce(p ->> 'verified', 'NONE'))
  on conflict (provider, event_key) do nothing returning payment_provider_events.id into id;
  return jsonb_build_object('id', id, 'duplicate', id is null);
end $$;
create or replace function public.commerce_event_done(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.payment_provider_events set processed_at = now(), result = left(p ->> 'result', 300) where id = (p ->> 'id')::bigint;
  return jsonb_build_object('ok', true);
end $$;

-- the user deletes a report: payload and share link go, the row (and the ledger) stay for accounting
create or replace function public.commerce_delete_report(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.premium_reports set payload = null, share_token = null, share_summary = null, deleted_at = now()
   where id = (p ->> 'report_id')::uuid and user_id = (p ->> 'user_id')::uuid and deleted_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('deleted', n = 1);
end $$;

-- an order of this user (a confirm request for someone else's order is refused as not found)
create or replace function public.commerce_get_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = (p ->> 'order_id')::uuid and (p ->> 'user_id' is null or user_id = (p ->> 'user_id')::uuid);
  return case when found then to_jsonb(o) end;
end $$;

-- orders still waiting for a confirmation after p.minutes (missed redirect / missed webhook) → the reconciliation job asks the provider
create or replace function public.commerce_open_orders(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  -- 5.1 audit: open CREATED orders first, newest first (a pile of abandoned orders must not hide a fresh paid one); EXPIRED
  -- orders only for 2 days (late payments), after them
  return coalesce((select jsonb_agg(to_jsonb(o) order by o.status = 'CREATED' desc, o.created_at desc) from (select * from public.orders
    where channel = coalesce(p ->> 'channel', channel) and created_at < now() - make_interval(mins => coalesce((p ->> 'minutes')::int, 10))
      and ((status = 'CREATED' and created_at > now() - interval '7 days') or (status = 'EXPIRED' and created_at > now() - interval '2 days'))
    order by status = 'CREATED' desc, created_at desc limit coalesce((p ->> 'limit')::int, 100)) o), '[]'::jsonb);
end $$;

create or replace function public.commerce_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pay public.payments;
begin
  select * into pay from public.payments where provider = p ->> 'provider' and provider_payment_id = p ->> 'provider_payment_id';
  return case when found then to_jsonb(pay) end;
end $$;

-- native store purchase (Apple / Google): the client buys first, the server verifies the store transaction and then creates and
-- fulfils the order in one step. The store transaction id is the idempotency key: a replayed transaction never grants twice.
create or replace function public.commerce_store_grant(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := (p ->> 'user_id')::uuid; pr public.credit_products; ch text; o jsonb; prov text := p ->> 'provider';
begin
  ch := case prov when 'APPLE' then 'APPLE_IAP' when 'GOOGLE' then 'GOOGLE_PLAY' end;
  if ch is null then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  if exists (select 1 from public.payments where provider = prov and provider_payment_id = p ->> 'transaction_id') then
    return jsonb_build_object('already', true, 'wallet', public.commerce_wallet(jsonb_build_object('user_id', u)));
  end if;
  select * into pr from public.credit_products where store_product_id = p ->> 'store_product_id' and channel = ch and active;
  if not found then raise exception 'PRODUCT_NOT_FOR_SALE' using errcode = '22023'; end if;
  o := public.commerce_create_order(jsonb_build_object('user_id', u, 'product_code', pr.code, 'channel', ch,
         'idempotency_key', lower(prov) || '-' || left(regexp_replace(p ->> 'transaction_id', '[^A-Za-z0-9_-]', '', 'g'), 50)));
  return public.commerce_fulfill_payment(jsonb_build_object('order_id', o ->> 'id', 'provider', prov, 'provider_payment_id', p ->> 'transaction_id',
    'amount', (o ->> 'amount_krw')::int, 'currency', 'KRW', 'status', 'DONE', 'approved_at', p ->> 'purchased_at', 'raw', p -> 'raw', 'actor', 'store:' || prov));
end $$;

-- reports: read own, share (a random token, the privacy-safe summary only), read a share by token (anyone)
create or replace function public.commerce_report(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.premium_reports;
begin
  select * into r from public.premium_reports where id = (p ->> 'report_id')::uuid and user_id = (p ->> 'user_id')::uuid and deleted_at is null;
  return case when found then to_jsonb(r) end;
end $$;
create or replace function public.commerce_reports(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'created_at', created_at, 'shared', share_token is not null) order by created_at desc)
    from (select * from public.premium_reports where user_id = (p ->> 'user_id')::uuid and deleted_at is null order by created_at desc limit 200) r), '[]'::jsonb);
end $$;
create or replace function public.commerce_share_report(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  update public.premium_reports set share_token = coalesce(share_token, replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', ''))
   where id = (p ->> 'report_id')::uuid and user_id = (p ->> 'user_id')::uuid and deleted_at is null and share_summary is not null
   returning share_token into t;
  return jsonb_build_object('token', t);
end $$;
create or replace function public.commerce_shared(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.premium_reports;
begin
  select * into r from public.premium_reports where share_token = p ->> 'token' and deleted_at is null and retain_until > now();
  return case when found then jsonb_build_object('kind', r.kind, 'title', r.title, 'created_at', r.created_at, 'summary', r.share_summary) end;
end $$;

-- the owner edits a paid result (corrections re-matched, follow-up questions of a Jomi session): free, never a new charge
create or replace function public.commerce_update_report(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.premium_reports;
begin
  if p -> 'payload' is null or jsonb_typeof(p -> 'payload') <> 'object' or length((p -> 'payload')::text) > 400000 then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  update public.premium_reports set payload = p -> 'payload', share_summary = coalesce(p -> 'share_summary', share_summary),
         title = coalesce(nullif(left(p ->> 'title', 200), ''), title)
   where id = (p ->> 'report_id')::uuid and user_id = (p ->> 'user_id')::uuid and deleted_at is null returning * into r;
  if not found then raise exception 'REPORT_NOT_FOUND' using errcode = '22023'; end if;
  return to_jsonb(r);
end $$;

-- one reconciliation run, for the operations screen (checked orders, fixed ones, anything that did not add up)
create or replace function public.commerce_reconcile_log(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare id bigint;
begin
  insert into public.payment_reconciliation_jobs (started_at, finished_at, checked, fixed, mismatches)
  values (coalesce((p ->> 'started_at')::timestamptz, now()), now(), coalesce((p ->> 'checked')::int, 0), coalesce((p ->> 'fixed')::int, 0), coalesce(p -> 'mismatches', '[]'))
  returning payment_reconciliation_jobs.id into id;
  return jsonb_build_object('id', id);
end $$;

-- push subscriptions and price watch rules (rules need an active watch entitlement)
create or replace function public.commerce_push_subscribe(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p ->> 'endpoint', '') !~ '^https://' or length(p ->> 'endpoint') > 1000 then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  if (select count(*) from public.push_subscriptions where user_id = (p ->> 'user_id')::uuid) >= 10
     and not exists (select 1 from public.push_subscriptions where endpoint = p ->> 'endpoint') then raise exception 'TOO_MANY_SUBSCRIPTIONS' using errcode = '22023'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ((p ->> 'user_id')::uuid, p ->> 'endpoint', p ->> 'p256dh', p ->> 'auth')
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, failures = 0
    where public.push_subscriptions.user_id = excluded.user_id;          -- 5.1 audit: an endpoint is never taken over by another user
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.commerce_watch_rule(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := (p ->> 'user_id')::uuid; e public.premium_entitlements; id bigint;
begin
  select * into e from public.premium_entitlements where user_id = u and feature_code in ('PRICE_WATCH_7D', 'PRICE_WATCH_30D') and ends_at > now() order by ends_at desc limit 1;
  if not found then raise exception 'NO_WATCH_ENTITLEMENT' using errcode = '22023'; end if;
  if (select count(*) from public.price_watch_rules where user_id = u and active) >= 50 then raise exception 'TOO_MANY_RULES' using errcode = '22023'; end if;
  insert into public.price_watch_rules (user_id, entitlement_id, key_id, kind, target_krw, region, quiet_start, quiet_end, baseline)
  values (u, e.id, p ->> 'key_id', p ->> 'kind', nullif(p ->> 'target_krw', '')::int, coalesce(p ->> 'region', '전국'),
          nullif(p ->> 'quiet_start', '')::smallint, nullif(p ->> 'quiet_end', '')::smallint, p -> 'baseline')
  returning price_watch_rules.id into id;
  return jsonb_build_object('id', id, 'until', e.ends_at);
end $$;

-- price watch runner (scheduled, after a data update): active rules whose entitlement is still open
create or replace function public.commerce_watch_due(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'key_id', x.key_id, 'kind', x.kind, 'target_krw', x.target_krw,
           'region', x.region, 'quiet_start', x.quiet_start, 'quiet_end', x.quiet_end, 'baseline', x.baseline) order by x.id)
    from (select r.* from public.price_watch_rules r join public.premium_entitlements e on e.id = r.entitlement_id
           where r.active and e.ends_at > now() and r.id > coalesce((p ->> 'after')::bigint, 0) order by r.id limit 500) x), '[]'::jsonb);
end $$;
-- one notice per (rule, change): a second run over the same data inserts nothing
create or replace function public.commerce_watch_event(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if p ->> 'event_key' is null then                    -- first look at a new rule: remember where prices stood, no notice
    update public.price_watch_rules set baseline = p -> 'baseline' where id = (p ->> 'rule_id')::bigint and baseline is null;
    return jsonb_build_object('id', null, 'new', false);
  end if;
  insert into public.price_watch_events (user_id, rule_id, event_key, payload)
  select r.user_id, r.id, left(p ->> 'event_key', 200), p -> 'payload' from public.price_watch_rules r where r.id = (p ->> 'rule_id')::bigint
  on conflict do nothing returning price_watch_events.id into v_id;
  if p -> 'baseline' is not null then update public.price_watch_rules set baseline = p -> 'baseline' where id = (p ->> 'rule_id')::bigint; end if;
  return jsonb_build_object('id', v_id, 'new', v_id is not null);
end $$;
-- users with notices not yet pushed (quiet hours are decided by the runner, which leaves those for the next run)
create or replace function public.commerce_push_pending(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'n', x.n, 'subs', x.subs, 'quiet_start', x.qs, 'quiet_end', x.qe))
    from (select e.user_id, count(*) n, (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint)), '[]'::jsonb) from public.push_subscriptions s where s.user_id = e.user_id) subs,
                 (select r.quiet_start from public.price_watch_rules r where r.user_id = e.user_id and r.active order by r.id limit 1) qs,
                 (select r.quiet_end from public.price_watch_rules r where r.user_id = e.user_id and r.active order by r.id limit 1) qe
            from public.price_watch_events e where e.notified_at is null and e.created_at > now() - interval '3 days' group by e.user_id limit 1000) x), '[]'::jsonb);
end $$;
create or replace function public.commerce_push_done(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p ? 'user_id' then update public.price_watch_events set notified_at = now() where user_id = (p ->> 'user_id')::uuid and notified_at is null; end if;
  if p ? 'endpoint' then
    if coalesce((p ->> 'gone')::boolean, false) then delete from public.push_subscriptions where endpoint = p ->> 'endpoint';
    elsif coalesce((p ->> 'ok')::boolean, false) then update public.push_subscriptions set last_ok_at = now(), failures = 0 where endpoint = p ->> 'endpoint';
    else update public.push_subscriptions set failures = failures + 1 where endpoint = p ->> 'endpoint'; delete from public.push_subscriptions where endpoint = p ->> 'endpoint' and failures >= 5;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;
-- the notices a user reads in the app after a push (the push itself carries no content)
create or replace function public.commerce_notices(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'rule_id', rule_id, 'payload', payload, 'created_at', created_at) order by created_at desc)
    from (select * from public.price_watch_events where user_id = (p ->> 'user_id')::uuid order by created_at desc limit 50) e), '[]'::jsonb);
end $$;

-- what the store screen shows: the active products of the channels this environment sells, and the feature prices
create or replace function public.commerce_catalog(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'products', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'version', version, 'channel', channel, 'store_product_id', store_product_id,
        'price_krw', price_krw, 'vat_included', vat_included, 'credits', paid_credits, 'adfree_days', adfree_days) order by channel, price_krw)
      from public.credit_products where active and channel in (select jsonb_array_elements_text(coalesce(p -> 'channels', '["DEMO"]'::jsonb)))), '[]'::jsonb),
    'features', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'version', version, 'credits', credits, 'entitlement_days', entitlement_days, 'title', title) order by code)
      from public.premium_features where active), '[]'::jsonb));
end $$;

-- unit economics for a period (operations screen): money in, credits, AI and service costs. Every number is a sum of rows;
-- AI calls without a price schedule are counted separately (unpriced), never guessed. BUDGET rows are reported apart from ACTUAL.
create or replace function public.commerce_economics(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f date := coalesce((p ->> 'from')::date, current_date - 30); t date := coalesce((p ->> 'to')::date, current_date);
begin
  return jsonb_build_object('from', f, 'to', t,
    'revenue', (select jsonb_object_agg(channel, jsonb_build_object('orders', n, 'gross_krw', g)) from (
        select o.channel, count(*) n, sum(o.amount_krw) g from public.orders o where o.fulfilled_at::date between f and t group by o.channel) x),
    'refunds', (select jsonb_build_object('count', count(*), 'krw', coalesce(sum(amount_krw), 0), 'credits_reversed', coalesce(sum(credits_reversed), 0),
        'credits_unrecovered', coalesce(sum(credits_unrecovered), 0)) from public.payment_refunds where created_at::date between f and t),
    'credits', (select jsonb_object_agg(type || ':' || bucket, s) from (select type, bucket, sum(amount) s from public.credit_transactions
        where created_at::date between f and t group by type, bucket) x),
    'features', (select jsonb_object_agg(feature_code, jsonb_build_object('jobs', n, 'succeeded', ok, 'released', rel, 'credits_captured', cr)) from (
        select feature_code, count(*) n, count(*) filter (where status = 'SUCCEEDED') ok, count(*) filter (where status = 'RELEASED') rel,
               coalesce(sum(credits) filter (where status = 'SUCCEEDED'), 0) cr from public.premium_jobs where created_at::date between f and t group by feature_code) x),
    'ai', (select jsonb_build_object('calls', count(*), 'cost_krw', coalesce(sum(cost_krw), 0), 'unpriced_calls', count(*) filter (where cost_krw is null),
        'fallback_calls', count(*) filter (where call_kind = 'FALLBACK'), 'failed_calls', count(*) filter (where not ok)) from public.ai_usage_records where created_at::date between f and t),
    'ai_by_feature', (select jsonb_object_agg(coalesce(feature_code, '-'), c) from (select j.feature_code, round(sum(a.cost_krw), 2) c
        from public.ai_usage_records a left join public.premium_jobs j on j.id = a.job_id where a.created_at::date between f and t group by j.feature_code) x),
    'service_costs', (select jsonb_object_agg(kind, jsonb_build_object('krw', s, 'items', items)) from (select kind, sum(amount_krw) s, jsonb_agg(jsonb_build_object('category', category, 'item', item, 'krw', amount_krw, 'source', source)) items
        from public.service_cost_records where period_start <= t and period_end >= f group by kind) x));
end $$;

-- AI spend guard (5.1 audit: one credit must not buy unlimited model calls). Counts every call, failed ones too, per user per
-- KST day, and the whole service's priced cost per KST day; a model with no price schedule for today cannot be called.
create or replace function public.commerce_ai_guard(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d0 timestamptz := (date_trunc('day', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul'; uc int; dk numeric; priced boolean;
begin
  select count(*) into uc from public.ai_usage_records where user_id = (p ->> 'user_id')::uuid and created_at >= d0;
  select coalesce(sum(cost_krw), 0) into dk from public.ai_usage_records where created_at >= d0;
  select exists (select 1 from public.model_cost_config where provider = p ->> 'provider' and model = p ->> 'model' and effective_date <= current_date) into priced;
  return jsonb_build_object('ok', priced and uc < coalesce((p ->> 'max_user_calls')::int, 30) and dk < coalesce((p ->> 'max_day_krw')::numeric, 30000),
    'priced', priced, 'user_calls_today', uc, 'service_krw_today', dk);
end $$;
create index if not exists ai_usage_user_day on public.ai_usage_records (user_id, created_at);
create index if not exists ai_usage_day on public.ai_usage_records (created_at);

-- Jomi session turns: a slot is taken atomically before the model is called (5.1 audit: parallel follow-ups passed the limit)
create or replace function public.commerce_jomi_turn(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
-- a Jomi session turn (round-2 R15). take: one slot per turn_key (a retried request with the same key gets the stored
-- answer back, never a second slot); append: store the answer and mark the key done; release: give the slot back when the
-- answer could not be made. Free answers (empty question, safety notice, treatment not found) never call take at all.
declare r public.premium_reports; used int; k text := nullif(p ->> 'turn_key', ''); st text; prev jsonb;
begin
  select * into r from public.premium_reports where id = (p ->> 'report_id')::uuid and user_id = (p ->> 'user_id')::uuid
     and deleted_at is null and kind = 'JOMI_QA' for update;
  if not found then raise exception 'REPORT_NOT_FOUND' using errcode = '22023'; end if;
  used := coalesce((r.payload ->> 'turns_used')::int, jsonb_array_length(coalesce(r.payload -> 'turns', '[]')));
  st := case when k is null then null else r.payload -> 'turn_keys' ->> k end;
  if p ->> 'action' = 'take' then
    if st = 'done' then
      select t into prev from jsonb_array_elements(coalesce(r.payload -> 'turns', '[]')) t where t ->> 'turn_key' = k limit 1;
      return jsonb_build_object('repeat', true, 'turn', prev, 'turns_used', used, 'max_turns', coalesce((r.payload ->> 'max_turns')::int, 5), 'job_id', r.job_id);
    end if;
    if st = 'pending' then raise exception 'TURN_IN_PROGRESS' using errcode = '22023'; end if;
    if used >= coalesce((r.payload ->> 'max_turns')::int, 5) then raise exception 'SESSION_FULL' using errcode = '22023'; end if;
    update public.premium_reports set payload = jsonb_set(case when k is null then payload
             else jsonb_set(payload, '{turn_keys}', coalesce(payload -> 'turn_keys', '{}') || jsonb_build_object(k, 'pending')) end,
             '{turns_used}', to_jsonb(used + 1))
     where id = r.id returning * into r;
    return jsonb_build_object('turns_used', used + 1, 'max_turns', coalesce((r.payload ->> 'max_turns')::int, 5), 'job_id', r.job_id);
  elsif p ->> 'action' = 'release' then
    if st = 'pending' then
      update public.premium_reports set payload = jsonb_set(payload #- array['turn_keys', k], '{turns_used}', to_jsonb(greatest(used - 1, 0)))
       where id = r.id;
      return jsonb_build_object('released', true, 'turns_used', greatest(used - 1, 0));
    end if;
    return jsonb_build_object('released', false, 'turns_used', used);
  end if;
  -- append: add the answered turn to the list (the row lock above serialises concurrent turns)
  update public.premium_reports set payload = jsonb_set(case when k is null then payload
           else jsonb_set(payload, '{turn_keys}', coalesce(payload -> 'turn_keys', '{}') || jsonb_build_object(k, 'done')) end,
           '{turns}', coalesce(payload -> 'turns', '[]') || jsonb_build_array(case when k is null then p -> 'turn' else (p -> 'turn') || jsonb_build_object('turn_key', k) end))
   where id = r.id returning * into r;
  return jsonb_build_object('turns', jsonb_array_length(r.payload -> 'turns'));
end $$;

create index if not exists premium_reports_user on public.premium_reports (user_id, created_at);
create index if not exists price_watch_events_pending on public.price_watch_events (created_at) where notified_at is null;
create index if not exists price_watch_rules_user on public.price_watch_rules (user_id) where active;
create index if not exists payment_refunds_payment on public.payment_refunds (payment_id);

-- admin dashboard (5.1): every number is a sum of rows (ACTUAL). Estimates (fees, margins) are computed by the API from
-- these and labelled as estimates. Days are KST.
create or replace function public.commerce_admin_dashboard(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare kst text := 'Asia/Seoul'; d30 timestamptz := now() - interval '30 days';
begin
  return jsonb_build_object(
    'generated_at', now(),
    'revenue_daily', coalesce((select jsonb_agg(x order by x.day desc) from (select (fulfilled_at at time zone kst)::date as day, channel, count(*) orders, sum(amount_krw) gross_krw
        from public.orders where fulfilled_at > d30 group by 1, 2) x), '[]'),
    'revenue_monthly', coalesce((select jsonb_agg(x order by x.month desc) from (select to_char(fulfilled_at at time zone kst, 'YYYY-MM') as month, channel, count(*) orders, sum(amount_krw) gross_krw
        from public.orders where fulfilled_at > now() - interval '12 months' group by 1, 2) x), '[]'),
    'orders_by_status_30d', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.orders where created_at > d30 group by status) x), '{}'),
    'payments_by_status_30d', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.payments where created_at > d30 group by status) x), '{}'),
    'refunds_daily', coalesce((select jsonb_agg(x order by x.day desc) from (select (created_at at time zone kst)::date as day, kind, count(*) n, sum(amount_krw) krw,
        sum(credits_reversed) credits_reversed, sum(credits_unrecovered) credits_unrecovered from public.payment_refunds where created_at > d30 group by 1, 2) x), '[]'),
    'credits_daily', coalesce((select jsonb_agg(x order by x.day desc) from (select (created_at at time zone kst)::date as day,
        sum(amount) filter (where type = 'PURCHASE_GRANTED') issued_paid, sum(amount) filter (where type = 'PROMOTIONAL_GRANTED') issued_promo,
        sum(amount) filter (where type = 'CREDIT_CAPTURED') consumed, sum(amount) filter (where type = 'CREDIT_RELEASED') released,
        sum(amount) filter (where type in ('PURCHASE_REFUNDED', 'PAYMENT_REVERSED')) reversed from public.credit_transactions where created_at > d30 group by 1) x), '[]'),
    'outstanding_credits', (select jsonb_build_object('paid', coalesce(sum(paid_balance), 0), 'promo', coalesce(sum(promo_balance), 0), 'reserved', coalesce(sum(paid_reserved + promo_reserved), 0)) from public.credit_wallets),
    'ai_daily', coalesce((select jsonb_agg(x order by x.day desc) from (select (created_at at time zone kst)::date as day, count(*) calls, count(*) filter (where not ok) failed,
        count(*) filter (where call_kind = 'FALLBACK') fallback, count(*) filter (where cost_krw is null) unpriced, round(coalesce(sum(cost_krw), 0), 2) cost_krw,
        sum(input_tokens) input_tokens, sum(output_tokens) output_tokens from public.ai_usage_records where created_at > d30 group by 1) x), '[]'),
    'features_30d', coalesce((select jsonb_agg(x) from (select j.feature_code, count(*) jobs, count(*) filter (where j.status = 'SUCCEEDED') succeeded,
        count(*) filter (where j.status = 'RELEASED') released, coalesce(sum(j.credits) filter (where j.status = 'SUCCEEDED'), 0) credits_captured,
        round(coalesce((select sum(a.cost_krw) from public.ai_usage_records a join public.premium_jobs j2 on j2.id = a.job_id where j2.feature_code = j.feature_code and a.created_at > d30), 0), 2) ai_cost_krw
        from public.premium_jobs j where j.created_at > d30 group by j.feature_code) x), '[]'),
    'premium_users', jsonb_build_object(
        'active_7d', (select count(distinct user_id) from public.premium_jobs where status = 'SUCCEEDED' and created_at > now() - interval '7 days'),
        'active_30d', (select count(distinct user_id) from public.premium_jobs where status = 'SUCCEEDED' and created_at > d30),
        'open_entitlements', (select count(*) from public.premium_entitlements where ends_at > now()),
        'ad_free_active', (select count(*) from public.ad_free_entitlements where ends_at > now())),
    'health', jsonb_build_object(
        'db_now', now(), 'db_size_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
        'jobs_open', (select count(*) from public.premium_jobs where status in ('RESERVED', 'RUNNING')),
        'jobs_overdue', (select count(*) from public.premium_jobs where status in ('RESERVED', 'RUNNING') and expires_at < now()),
        'webhooks_unprocessed_15m', (select count(*) from public.payment_provider_events where processed_at is null and received_at < now() - interval '15 minutes'),
        'orders_open_over_1h', (select count(*) from public.orders where status = 'CREATED' and created_at < now() - interval '1 hour' and created_at > now() - interval '7 days'),
        'last_reconcile', (select jsonb_build_object('at', finished_at, 'checked', checked, 'fixed', fixed, 'mismatches', jsonb_array_length(mismatches)) from public.payment_reconciliation_jobs order by id desc limit 1)),
    'service_costs_30d', coalesce((select jsonb_object_agg(kind, s) from (select kind, sum(amount_krw) s from public.service_cost_records where period_end > (now() - interval '30 days')::date group by kind) x), '{}'));
end $$;

-- only the API server (service_role) calls these; users and anon cannot, even through PostgREST
do $$ declare f text; begin
  foreach f in array array['commerce_audit(text,text,text,jsonb,text)', 'commerce_post(uuid,text,text,int,int,int,text,text,text,text,uuid,uuid,bigint,bigint)',
    'commerce_lock_wallet(uuid)', 'commerce_wallet(jsonb)', 'commerce_verify_wallet(jsonb)', 'commerce_create_order(jsonb)',
    'commerce_fulfill_payment(jsonb)', 'commerce_close_order(jsonb)', 'commerce_refund(jsonb)', 'commerce_preview_refund(jsonb)',
    'commerce_reserve(jsonb)', 'commerce_start_job(jsonb)', 'commerce_capture(jsonb)', 'commerce_release(jsonb)', 'commerce_expire_jobs(jsonb)',
    'commerce_grant_promo(jsonb)', 'commerce_admin_adjust(jsonb)', 'commerce_record_ai_usage(jsonb)', 'commerce_record_event(jsonb)',
    'commerce_event_done(jsonb)', 'commerce_delete_report(jsonb)', 'commerce_forbid_change()', 'commerce_get_order(jsonb)',
    'commerce_open_orders(jsonb)', 'commerce_payment(jsonb)', 'commerce_store_grant(jsonb)', 'commerce_report(jsonb)', 'commerce_reports(jsonb)',
    'commerce_share_report(jsonb)', 'commerce_shared(jsonb)', 'commerce_update_report(jsonb)', 'commerce_reconcile_log(jsonb)', 'commerce_watch_due(jsonb)', 'commerce_watch_event(jsonb)', 'commerce_push_pending(jsonb)', 'commerce_push_done(jsonb)', 'commerce_notices(jsonb)', 'commerce_catalog(jsonb)', 'commerce_economics(jsonb)', 'commerce_ai_guard(jsonb)', 'commerce_admin_dashboard(jsonb)', 'commerce_jomi_turn(jsonb)', 'commerce_push_subscribe(jsonb)', 'commerce_watch_rule(jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
