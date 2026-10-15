-- 윤실장(피부과 가격비교): 회원 정보 테이블 (Supabase → SQL Editor에 붙여 넣고 Run)
-- 적용 순서: supabase/schema_platform.sql → 이 파일 → supabase/DATABASE_ACCESS_POLICIES.sql
-- 이 파일은 테이블만 만들고 모든 테이블에 row level security를 켜요. 접근 정책(누가 무엇을 읽고 쓰는지)은
-- DATABASE_ACCESS_POLICIES.sql에만 있어요. 그래서 이 파일만 적용하면 API로는 아무도 읽거나 쓸 수 없어요(안전한 기본값).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nick text check (char_length(nick) <= 20),
  gender text check (gender in ('여성', '남성', '선택 안 함')),
  age_band text check (age_band in ('10대', '20대 초반', '20대 후반', '30대 초반', '30대 후반', '40대', '50대', '60대 이상')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.records (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  done_on date not null,
  procedure text not null check (char_length(procedure) <= 200),
  brand text not null default '',
  branch text not null default '',
  price integer check (price >= 0),
  memo text check (char_length(memo) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists records_user_idx on public.records (user_id, done_on desc);

alter table public.profiles enable row level security;
alter table public.records enable row level security;

-- 회원 탈퇴: 본인 로그인 계정 삭제(프로필·기록은 on delete cascade로 같이 지워짐).
-- 6.0에서 크레딧 장부(monetization.sql)가 빠지면서 그쪽 delete_me(jsonb 반환)도 없어졌다. 옛 DB에 그 함수가 남아 있으면
-- 반환 형식이 달라 바꿔 쓰기가 실패하므로 먼저 지운다. app/auth.js는 빈 응답을 '삭제됨'으로 받는다.
drop function if exists public.delete_me();
create or replace function public.delete_me() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

-- ---- 장바구니·저장한 패키지·가격 알림 (로그인 시 기기 장바구니와 합쳐요: app/auth.js)
create table if not exists public.carts (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) <= 30),
  updated_at  timestamptz not null default now()
);
create table if not exists public.cart_items (
  cart_id     uuid not null references public.carts (id) on delete cascade,
  position    smallint not null,
  kind        text not null check (kind in ('k', 'r')),          -- k = 비교 시술(X12), r = 지점 상품 그대로
  key_code    text,                                               -- treatment_variants.code
  row_name    text check (char_length(row_name) <= 200),
  branch_key  text,                                               -- '브랜드|지점' (r일 때 담은 곳)
  qty         smallint not null default 1 check (qty between 1 and 20),
  special     boolean,                                            -- 이 시술만 특가 포함/제외 (null = 전체 설정)
  overrides   jsonb not null default '{}',                        -- 지점별로 고른 옵션 {'브랜드|지점': 상품 이름}
  primary key (cart_id, position)
);
create table if not exists public.saved_packages (                -- 이름 붙여 저장한 조합(공유 링크 포함)
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) <= 30),
  items       jsonb not null,
  created_at  timestamptz not null default now()
);
create table if not exists public.price_alerts (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  type        text not null check (type in ('target', 'newlow', 'cartdrop', 'expiring', 'newmatch')),
  key_code    text, cart_id uuid references public.carts (id) on delete cascade, row_name text, branch_key text,
  target_krw  integer check (target_krw is null or target_krw > 0),
  base        integer, last_value integer, last_sent_on date,       -- 중복 방지·하루 1번
  email       boolean not null default false,                      -- 메일 발송은 발송 서비스 연결 후
  created_at  timestamptz not null default now()
);
create table if not exists public.favorites (                     -- 즐겨찾는 시술·지점
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('k', 'b')),             -- k = 비교 시술 코드(X12), b = 지점('브랜드|지점')
  ref         text not null check (char_length(ref) between 1 and 120),
  created_at  timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
create index if not exists carts_user_idx on public.carts (user_id);
create index if not exists price_alerts_user_idx on public.price_alerts (user_id);
-- jsonb size limits (payload abuse): overrides and saved package items stay small
alter table public.cart_items drop constraint if exists cart_items_overrides_size;
alter table public.cart_items add constraint cart_items_overrides_size check (jsonb_typeof(overrides) = 'object' and pg_column_size(overrides) <= 8192);
alter table public.saved_packages drop constraint if exists saved_packages_items_size;
alter table public.saved_packages add constraint saved_packages_items_size check (jsonb_typeof(items) = 'array' and pg_column_size(items) <= 32768);

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.saved_packages enable row level security;
alter table public.price_alerts enable row level security;
alter table public.favorites enable row level security;
-- 정책: supabase/DATABASE_ACCESS_POLICIES.sql

-- ---- Round 2 (review R16): a cart is saved in ONE transaction with a version check. Before, the app upserted the cart,
-- deleted every item and inserted the new ones in three requests — a failure in between left an empty cart on the server,
-- and two devices saving at once mixed their items. save_cart(p): {id, name, items: [...], expected_version (null = new)}
-- → {version} | VERSION_CONFLICT (the caller pulls the newer copy instead of overwriting it).
alter table public.carts add column if not exists version integer not null default 0;
create or replace function public.save_cart(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); c public.carts; cid uuid := (p ->> 'id')::uuid; it jsonb; i int := 0;
begin
  if u is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if cid is null or jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') > 60 then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  select * into c from public.carts where id = cid for update;
  if found and c.user_id <> u then raise exception 'NOT_FOUND' using errcode = '22023'; end if;          -- someone else's id: never taken over
  if found and p ? 'expected_version' and p ->> 'expected_version' is not null and c.version <> (p ->> 'expected_version')::int then
    raise exception 'VERSION_CONFLICT' using errcode = '22023', detail = c.version::text; end if;
  if not found then
    insert into public.carts (id, user_id, name, version) values (cid, u, left(coalesce(p ->> 'name', '장바구니'), 30), 1) returning * into c;
  else
    update public.carts set name = left(coalesce(p ->> 'name', name), 30), version = version + 1, updated_at = now() where id = cid returning * into c;
    delete from public.cart_items where cart_id = cid;
  end if;
  for it in select * from jsonb_array_elements(p -> 'items') loop
    insert into public.cart_items (cart_id, position, kind, key_code, row_name, branch_key, qty, special, overrides)
    values (cid, i, it ->> 't', case when it ->> 't' = 'k' then it ->> 'k' end, case when it ->> 't' = 'r' then left(it ->> 'n', 200) end,
            case when it ->> 't' = 'r' then it ->> 'br' end, least(greatest(coalesce((it ->> 'q')::int, 1), 1), 20),
            (it ->> 'sp')::boolean, coalesce(it -> 'ov', '{}'));
    i := i + 1;
  end loop;
  return jsonb_build_object('id', c.id, 'version', c.version);
end $$;
revoke all on function public.save_cart(jsonb) from public, anon;
grant execute on function public.save_cart(jsonb) to authenticated;
