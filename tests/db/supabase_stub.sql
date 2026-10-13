-- A minimal stand-in for Supabase on plain PostgreSQL 15+, for the database security tests (no Supabase account needed).
-- What it copies from Supabase: the auth schema (users, uid(), jwt() from the request.jwt.claims setting), the API roles
-- anon / authenticated / service_role (service_role bypasses RLS), and Supabase's default grants on new public tables —
-- the worst case, which supabase/DATABASE_ACCESS_POLICIES.sql has to undo. What it does not copy: PostgREST (HTTP API,
-- JWT signature and expiry checks), GoTrue (sign-in, MFA, sessions), rate limits of the hosted API.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
