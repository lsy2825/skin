-- 피부과 가격비교: 회원 정보 테이블 (Supabase → SQL Editor에 붙여 넣고 Run)
-- 각 회원은 자기 행만 읽고 쓸 수 있어요(row level security). 운영자는 Supabase 대시보드(Table Editor)에서 전체를 봐요.

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

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own records" on public.records;
create policy "own records" on public.records for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 회원 탈퇴: 본인 로그인 계정 삭제(프로필·기록은 on delete cascade로 같이 지워짐)
create or replace function public.delete_me() returns void
language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;
