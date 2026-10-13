-- Database security tests: supabase/DATABASE_ACCESS_POLICIES.sql on PostgreSQL with the Supabase stand-in.
-- Run with tests/db/run_security_tests.sh (throwaway database). Every check raises 'FAIL …' and stops on the first
-- failure; each passed scenario prints 'PASS …'. Scenario numbers follow docs/SECURITY_TEST_REPORT.md.
-- Users: A, B = ordinary users · C = admin · D = reviewer. aal1 = password only, aal2 = signed in with a second factor.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

-- ---------------------------------------------------------------- fixtures (database owner)
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000c', 'admin'), ('00000000-0000-0000-0000-00000000000d', 'reviewer');
insert into public.clinic_brands (id, slug, name) values (1, 'velyb', '블리비');
insert into public.clinic_branches (id, brand_id, name, region) values (1, 1, '강남역점', '서울');
insert into public.treatment_variants (id, code, label) values (1, 'X12', '슈링크 유니버스 300샷');
insert into public.offers (id, branch_id, variant_id, name, raw_name, price_krw, kind, source_url, source_hash, first_seen, last_seen, verification_status, valid_until) values
  (1, 1, 1, '슈링크 300샷', '슈링크 300샷', 10000, '일반', 'https://example.com/1', repeat('a', 64), '2026-10-01', '2026-10-13', 'VERIFIED', null),
  (2, 1, 1, '슈링크 300샷 급변', '슈링크 300샷 급변', 1000, '일반', 'https://example.com/2', repeat('b', 64), '2026-10-13', '2026-10-13', 'PENDING_REVIEW', null),
  (3, 1, 1, '지난 이벤트', '지난 이벤트', 5000, '체험가', 'https://example.com/3', repeat('c', 64), '2026-09-01', '2026-09-30', 'VERIFIED', '2026-09-30');
insert into public.offer_conditions (offer_id, condition) values (1, '평일 낮'), (2, '첫 방문');
insert into public.price_snapshots (observed_on, offer_id, branch_id, variant_id, price_krw, normalized_krw, verification_status, source_url, collected_at) values
  ('2026-10-13', 1, 1, 1, 10000, 11000, 'VERIFIED', 'https://example.com/1', now()),
  ('2026-10-13', 2, 1, 1, 1000, 1100, 'PENDING_REVIEW', 'https://example.com/2', now());
insert into public.source_registry (brand_id, method) values (1, '공개 HTML');
insert into public.profiles (id, nick) values ('00000000-0000-0000-0000-00000000000a', 'A');
insert into public.records (id, user_id, done_on, procedure) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', '2026-10-13', '슈링크');
insert into public.carts (id, user_id, name) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'cart A');
insert into public.cart_items (cart_id, position, kind, key_code) values ('10000000-0000-0000-0000-000000000001', 0, 'k', 'X12');
insert into public.saved_packages (user_id, name, items) values ('00000000-0000-0000-0000-00000000000a', 'pkg', '[]');
insert into public.price_alerts (id, user_id, type, key_code, target_krw) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'target', 'X12', 9000);
insert into public.favorites (user_id, kind, ref) values ('00000000-0000-0000-0000-00000000000a', 'k', 'X12');

-- ---------------------------------------------------------------- 1. anonymous visitor: read verified prices, change nothing
set role anon;
set request.jwt.claims = '{"role": "anon"}';
do $$ declare n integer; t text; begin
  select count(*) into n from public.offers;            if n <> 1 then raise exception 'FAIL 1a: anon sees % offers (want 1: verified and unexpired)', n; end if;
  select count(*) into n from public.current_offers;    if n <> 1 then raise exception 'FAIL 1b: view current_offers shows % rows to anon', n; end if;
  select count(*) into n from public.offer_conditions;  if n <> 1 then raise exception 'FAIL 1c: anon sees conditions of hidden offers (%)', n; end if;
  select count(*) into n from public.price_snapshots;   if n <> 1 then raise exception 'FAIL 1d: anon sees % snapshots (want 1 verified)', n; end if;
  foreach t in array array['audit_logs', 'user_roles', 'verification_logs', 'ingestion_jobs', 'source_registry', 'user_reports',
                           'price_snapshots_2026', 'schema_migrations', 'profiles', 'records', 'carts', 'cart_items',
                           'saved_packages', 'price_alerts', 'favorites'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      raise exception 'FAIL 1e: anon can read public.%', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin update public.offers set price_krw = 1; raise exception 'FAIL 1f: anon updated prices';
  exception when insufficient_privilege then null; end;
  begin insert into public.offers (branch_id, name, raw_name, price_krw, kind, source_url, source_hash, first_seen, last_seen)
        values (1, 'x', 'x', 1, '일반', 'https://x', repeat('d', 64), current_date, current_date);
        raise exception 'FAIL 1g: anon inserted a price';
  exception when insufficient_privilege then null; end;
  begin delete from public.offers; raise exception 'FAIL 1h: anon deleted prices';
  exception when insufficient_privilege then null; end;
  begin perform public.review_offer(2, 'APPROVE'); raise exception 'FAIL 1i: anon ran the review action';
  exception when insufficient_privilege then null; end;
  begin insert into public.user_reports (offer_id, reason) values (1, 'x'); raise exception 'FAIL 1j: anon filed a report';
  exception when insufficient_privilege then null; end;
  begin perform public.delete_me(); raise exception 'FAIL 1k: anon can call delete_me';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 1: anonymous visitor reads only verified, unexpired prices and cannot write or read anything else';
end $$;
reset role;

-- ---------------------------------------------------------------- 2. user B cannot read or change user A's data
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated", "aal": "aal1"}';
do $$ declare n integer; begin
  select (select count(*) from public.profiles) + (select count(*) from public.records) + (select count(*) from public.carts)
       + (select count(*) from public.cart_items) + (select count(*) from public.saved_packages)
       + (select count(*) from public.price_alerts) + (select count(*) from public.favorites) into n;
  if n <> 0 then raise exception 'FAIL 2a: user B sees % rows of user A', n; end if;
  select count(*) into n from public.carts where user_id = '00000000-0000-0000-0000-00000000000a';
  if n <> 0 then raise exception 'FAIL 2b: filtering by A''s user_id shows A''s carts'; end if;
  begin insert into public.carts (id, user_id, name) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'x');
        raise exception 'FAIL 2c: B created a cart owned by A';
  exception when insufficient_privilege then null; end;
  update public.carts set name = 'hacked' where id = '10000000-0000-0000-0000-000000000001'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2d: B renamed A''s cart'; end if;
  delete from public.carts where id = '10000000-0000-0000-0000-000000000001'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2e: B deleted A''s cart'; end if;
  begin insert into public.cart_items (cart_id, position, kind, key_code) values ('10000000-0000-0000-0000-000000000001', 5, 'k', 'X1');
        raise exception 'FAIL 2f: B added an item to A''s cart';
  exception when insufficient_privilege then null; end;
  insert into public.carts (id, user_id, name) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'cart B');
  insert into public.cart_items (cart_id, position, kind, key_code) values ('10000000-0000-0000-0000-000000000002', 0, 'k', 'X1');
  begin update public.cart_items set cart_id = '10000000-0000-0000-0000-000000000001' where cart_id = '10000000-0000-0000-0000-000000000002';
        raise exception 'FAIL 2g: B moved an item into A''s cart';
  exception when insufficient_privilege then null; end;
  begin update public.carts set user_id = '00000000-0000-0000-0000-00000000000a' where id = '10000000-0000-0000-0000-000000000002';
        raise exception 'FAIL 2h: B handed its cart over to A';
  exception when insufficient_privilege then null; end;
  begin insert into public.price_alerts (id, user_id, type, cart_id) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'cartdrop', '10000000-0000-0000-0000-000000000001');
        raise exception 'FAIL 2i: B attached an alert to A''s cart';
  exception when insufficient_privilege then null; end;
  delete from public.favorites where user_id = '00000000-0000-0000-0000-00000000000a'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2j: B deleted A''s favorites'; end if;
  update public.profiles set nick = 'x' where id = '00000000-0000-0000-0000-00000000000a'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2k: B changed A''s profile'; end if;
  select count(*) into n from public.carts; if n <> 1 then raise exception 'FAIL 2l: B does not see exactly its own cart (%)', n; end if;
  raise notice 'PASS 2: user B cannot read, create, change, move into or delete user A''s profile, records, carts, items, packages, alerts, favorites';
end $$;
reset role;
do $$ begin
  if (select name from public.carts where id = '10000000-0000-0000-0000-000000000001') <> 'cart A'
     or (select count(*) from public.favorites where user_id = '00000000-0000-0000-0000-00000000000a') <> 1 then
    raise exception 'FAIL 2m: user A''s data changed';
  end if;
end $$;

-- ---------------------------------------------------------------- 3. a signed-in user cannot change prices
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated", "aal": "aal2"}';
do $$ declare n integer; begin
  update public.offers set price_krw = 1 where id = 1; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3a: a user changed a price'; end if;
  begin insert into public.offers (branch_id, name, raw_name, price_krw, kind, source_url, source_hash, first_seen, last_seen)
        values (1, 'x', 'x', 1, '일반', 'https://x', repeat('e', 64), current_date, current_date);
        raise exception 'FAIL 3b: a user inserted a price';
  exception when insufficient_privilege then null; end;
  delete from public.offers where id = 1; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3c: a user deleted a price'; end if;
  begin insert into public.price_snapshots (observed_on, offer_id, branch_id, price_krw, normalized_krw, verification_status, source_url, collected_at)
        values (current_date, 1, 1, 1, 1, 'VERIFIED', 'https://x', now());
        raise exception 'FAIL 3d: a user wrote price history';
  exception when insufficient_privilege then null; end;
  begin perform public.review_offer(2, 'APPROVE'); raise exception 'FAIL 3e: a user ran the review action';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.offers where verification_status <> 'VERIFIED';
  if n <> 0 then raise exception 'FAIL 3f: a user sees the review queue'; end if;
  begin insert into public.user_reports (offer_id, reason, status) values (1, 'x', 'RESOLVED');
        raise exception 'FAIL 3g: a user filed a report already marked resolved';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 3: a signed-in user (even with MFA) cannot insert, change or delete prices, history or the review queue';
end $$;
reset role;
do $$ begin if (select price_krw from public.offers where id = 1) <> 10000 then raise exception 'FAIL 3h: price changed'; end if; end $$;

-- ---------------------------------------------------------------- 4. no privilege escalation; admin needs MFA; changes are audited
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated", "aal": "aal2"}';
do $$ declare n integer; begin
  begin insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000a', 'admin');
        raise exception 'FAIL 4a: a user granted itself admin';
  exception when insufficient_privilege then null; end;
  begin update public.user_roles set user_id = '00000000-0000-0000-0000-00000000000a';
        raise exception 'FAIL 4b: a user took over a role row';
  exception when insufficient_privilege then null; end;
  if public.is_admin() or public.is_reviewer() then raise exception 'FAIL 4c: a user counts as admin/reviewer'; end if;
  select count(*) into n from public.user_roles; if n <> 0 then raise exception 'FAIL 4d: a user sees others'' roles'; end if;
  select count(*) into n from public.audit_logs; if n <> 0 then raise exception 'FAIL 4e: a user reads the audit log'; end if;
  raise notice 'PASS 4a: a user cannot grant itself a role, read roles or read the audit log';
end $$;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated", "aal": "aal1"}';
do $$ declare n integer; begin
  if public.is_admin() then raise exception 'FAIL 4f: admin without MFA counts as admin'; end if;
  update public.offers set price_krw = 9000 where id = 1; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4g: admin without MFA changed a price'; end if;
  begin perform public.review_offer(2, 'APPROVE'); raise exception 'FAIL 4h: admin without MFA ran the review action';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 4b: an admin signed in without a second factor (aal1) has no admin rights';
end $$;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated", "aal": "aal2"}';
do $$ declare n integer; begin
  update public.offers set price_krw = 9000 where id = 1; get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 4i: admin with MFA could not change a price'; end if;
  select count(*) into n from public.audit_logs where table_name = 'offers' and row_id = '1' and action = 'UPDATE'
    and before ->> 'price_krw' = '10000' and after ->> 'price_krw' = '9000' and actor = '00000000-0000-0000-0000-00000000000c';
  if n <> 1 then raise exception 'FAIL 4j: the price change is not in the audit log with before/after and the admin id'; end if;
  begin update public.audit_logs set actor = 'someone else'; raise exception 'FAIL 4k: admin rewrote the audit log';
  exception when insufficient_privilege then null; end;
  begin delete from public.audit_logs; raise exception 'FAIL 4l: admin deleted the audit log';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 4c: an admin with MFA (aal2) can change a price; the change is audited (before, after, who, when) and the log cannot be changed';
end $$;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated", "aal": "aal2"}';
do $$ declare n integer; v text; begin
  select count(*) into n from public.offers where id = 2; if n <> 1 then raise exception 'FAIL 4m: reviewer cannot see the review queue'; end if;
  v := public.review_offer(2, 'APPROVE', 'checked the source page');
  if v <> 'VERIFIED' then raise exception 'FAIL 4n: review action returned %', v; end if;
  select count(*) into n from public.verification_logs where offer_id = 2 and action = 'APPROVE' and actor = '00000000-0000-0000-0000-00000000000d';
  if n <> 1 then raise exception 'FAIL 4o: review not logged'; end if;
  update public.offers set price_krw = 1 where id = 1; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4p: reviewer changed a price directly'; end if;
  raise notice 'PASS 4d: a reviewer with MFA can approve the queue through review_offer (logged) but cannot edit prices';
end $$;
reset role;
-- the pipeline (service_role key, GitHub Actions secret) bypasses RLS by design and is audited as such
set role service_role;
set request.jwt.claims = '{"role": "service_role"}';
update public.offers set price_krw = 9500 where id = 1;
reset role;
do $$ declare n integer; begin
  select count(*) into n from public.audit_logs where table_name = 'offers' and row_id = '1' and actor = 'service_role' and after ->> 'price_krw' = '9500';
  if n <> 1 then raise exception 'FAIL 4q: pipeline change not audited as service_role'; end if;
  begin update public.audit_logs set actor = 'x'; raise exception 'FAIL 4r: the database owner rewrote the audit log';
  exception when insufficient_privilege then null; end;
  delete from public.offers where id = 2;    -- allowed for the owner; its verification log keeps the row (offer_id set to null)
  select count(*) into n from public.verification_logs where offer_id is null and action = 'APPROVE';
  if n <> 1 then raise exception 'FAIL 4s: deleting an offer broke or removed its review log'; end if;
  raise notice 'PASS 4e: pipeline writes are audited as service_role; the audit log is append-only even for the database owner';
end $$;

-- ---------------------------------------------------------------- 6. quotas stop scripted abuse
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated", "aal": "aal1"}';
do $$ declare i integer; begin
  for i in 1..10 loop insert into public.user_reports (offer_id, reason) values (1, 'report ' || i); end loop;
  begin insert into public.user_reports (offer_id, reason) values (1, 'report 11'); raise exception 'FAIL 6a: 11th report in a day accepted';
  exception when sqlstate 'P0001' then null; end;
  for i in 2..30 loop insert into public.carts (id, user_id, name) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'c' || i); end loop;
  begin insert into public.carts (id, user_id, name) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'c31');
        raise exception 'FAIL 6b: 31st cart accepted';
  exception when sqlstate 'P0001' then null; end;
  begin insert into public.saved_packages (user_id, name, items)
        values ('00000000-0000-0000-0000-00000000000b', 'big', (select jsonb_agg(md5(random()::text) || md5(random()::text)) from generate_series(1, 2000)));
        raise exception 'FAIL 6c: oversized payload accepted';
  exception when check_violation then null; end;
  begin insert into public.records (id, user_id, done_on, procedure) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', current_date, repeat('x', 201));
        raise exception 'FAIL 6d: over-long text accepted';
  exception when check_violation then null; end;
  raise notice 'PASS 6: per-user quotas (10 reports/day, 30 carts) and size limits refuse abuse with a plain "quota exceeded"';
end $$;
reset role;

select 'SECURITY TESTS OK' as result;
