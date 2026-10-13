-- 가격 플랫폼 스키마 (PostgreSQL 15+ / Supabase). 가격 카탈로그·이력·수집 파이프라인용.
-- 사용자 데이터(프로필·시술 기록·장바구니·알림)는 supabase/schema.sql (Supabase Auth 필요).
-- 지금 앱은 정적 파일(app/data.json)로 동작하고, 이 스키마는 DB로 옮길 때의 설계예요.
-- 데이터 채우기: python build2/export_db.py → data2/db/*.csv → psql -f supabase/load_platform.sql
-- 원칙: 브랜드/지점 분리 · 시술 제품/변형(비교 단위) 분리 · 현재 가격(offers)과 이력(price_snapshots) 분리 ·
--       모든 가격에 출처 URL·해시·검증 상태 · 원본 이름 보존 · 금액은 정수 KRW · 스냅샷은 날짜 파티션

create extension if not exists pg_trgm;   -- 이름 부분 검색(gin trigram)

create table clinic_brands (
  id            smallserial primary key,
  slug          text not null unique,                 -- velyb, ppeum, toxnfill, lienjang
  name          text not null unique,
  homepage      text,
  vat_default   text check (vat_default in ('incl', 'excl')),   -- 사이트 원문 근거가 있을 때만
  vat_evidence  text,
  vat_checked   date
);

create table clinic_branches (
  id            serial primary key,
  brand_id      smallint not null references clinic_brands(id),
  name          text not null,                        -- 지점은 독립 개체: 같은 브랜드라도 가격·이벤트가 다름
  address       text,
  region        text,                                 -- 시·도 (서울·경기·인천 …)
  lat           numeric(9, 6),
  lng           numeric(9, 6),
  site_url      text,
  status        text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  unique (brand_id, name)
);
create index clinic_branches_region_idx on clinic_branches (region);

create table treatment_categories (
  id            smallserial primary key,
  name          text not null unique,                 -- 보톡스·필러, 리프팅, 스킨부스터 …
  sort          smallint not null default 0
);

create table treatment_products (                     -- 시술 제품군: 슈링크 유니버스, 리쥬란 …
  id            serial primary key,
  category_id   smallint references treatment_categories(id),
  name          text not null unique,
  aliases       text[] not null default '{}'          -- 검색 별칭(app/domain/search.js ALIASES와 같은 내용)
);

create table treatment_variants (                     -- 비교 단위: 같은 스펙끼리만 비교 (X12 = 슈링크 유니버스 300샷 1회)
  id            serial primary key,
  product_id    integer references treatment_products(id),
  code          text not null unique,                 -- X01..X36 (build2/xkeys.py)
  label         text not null,
  unit          text,                                 -- 샷 · cc · U · KJ
  qty           numeric,
  sessions      smallint not null default 1,
  attrs         jsonb not null default '{}'           -- 원산지·부위 등
);

create table source_registry (                        -- Source Policy Registry (data2/sources.json)
  id              serial primary key,
  brand_id        smallint not null references clinic_brands(id) unique,
  method          text not null,                      -- 공개 HTML 등
  hosts           text[] not null default '{}',
  robots_allowed  boolean,
  crawl_delay_s   integer,
  rate_limit      text,
  terms_reviewed  date,                               -- 사람이 이용약관을 읽은 날(없으면 검토 필요)
  checked_at      timestamptz,
  notes           text
);

create table ingestion_jobs (
  id              bigserial primary key,
  source_id       integer not null references source_registry(id),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED', 'KEPT_PREVIOUS', 'BLOCKED')),
  rows_read       integer,
  branches_read   integer,
  error           text
);
create index ingestion_jobs_source_idx on ingestion_jobs (source_id, started_at desc);

create table offers (                                 -- 지금 지점에 걸려 있는 가격 한 줄
  id                  bigserial primary key,
  branch_id           integer not null references clinic_branches(id),
  variant_id          integer references treatment_variants(id),   -- 같은 스펙 비교 단위(없으면 null)
  auto_group          text,                           -- 이름이 같은 옵션 묶음 키(build2/groups.py)
  name                text not null,                  -- 표시 이름(행사 라벨 정리)
  raw_name            text not null,                  -- 사이트 원문 옵션 이름 (정규화 전 보존)
  raw_group           text,
  source_category     text,
  category_id         smallint references treatment_categories(id),
  price_krw           integer not null check (price_krw > 0),
  list_price_krw      integer check (list_price_krw is null or list_price_krw >= price_krw),   -- 병원이 적은 정가만
  vat                 text not null default 'unknown' check (vat in ('incl', 'excl', 'unknown')),
  kind                text not null check (kind in ('일반', '체험가', '한정가', '구독권', '고시가')),
  sessions            smallint not null default 1,    -- 99 = 이용권/무제한
  is_addon            boolean not null default false,
  valid_until         date,                           -- 이벤트 종료일(지나면 EXPIRED)
  source_url          text not null,
  source_hash         char(64) not null,              -- sha256(지점|원문 이름|가격|정가|url): 같은 이벤트 중복 수집 방지
  first_seen          date not null,
  last_seen           date not null,
  verification_status text not null default 'VERIFIED'
                      check (verification_status in ('VERIFIED', 'PENDING_REVIEW', 'STALE', 'EXPIRED', 'UNAVAILABLE')),
  unique (branch_id, source_hash)
);
create index offers_variant_price_idx on offers (variant_id, price_krw) where verification_status = 'VERIFIED';
create index offers_branch_idx on offers (branch_id);
create index offers_group_idx on offers (auto_group);
create index offers_valid_until_idx on offers (valid_until);
create index offers_name_trgm_idx on offers using gin (name gin_trgm_ops);

create table offer_conditions (                       -- 구조화한 조건: 평일 낮 · 일요일 · 첫 방문 · 1인 1회 …
  offer_id    bigint not null references offers(id) on delete cascade,
  condition   text not null check (condition in ('평일 낮', '일요일', '타임세일', '첫 방문', '1인 1회')),
  detail      text,                                   -- '17:00 이전' 같은 원문
  primary key (offer_id, condition)
);

create table official_packages (                      -- 병원 공식 패키지('A + B' 상품)
  id          bigserial primary key,
  offer_id    bigint not null unique references offers(id) on delete cascade
);
create table official_package_items (
  package_id  bigint not null references official_packages(id) on delete cascade,
  position    smallint not null,
  part_text   text not null,                          -- 원문 구성
  variant_id  integer references treatment_variants(id),   -- 같은 스펙으로 판정된 경우만
  primary key (package_id, position)
);

-- 가격 이력: 관측한 날만 저장(빈 날을 채우지 않음). 대량 저장을 위해 관측일 기준 연 단위 파티션.
create table price_snapshots (
  observed_on         date not null,
  offer_id            bigint not null,
  branch_id           integer not null,
  variant_id          integer,
  auto_group          text,
  price_krw           integer not null check (price_krw > 0),
  normalized_krw      integer not null check (normalized_krw > 0),   -- 부가세 포함 환산
  verification_status text not null,
  source_url          text not null,
  conditions          text[] not null default '{}',
  collected_at        timestamptz not null,
  primary key (observed_on, offer_id)
) partition by range (observed_on);
create table price_snapshots_2026 partition of price_snapshots for values from ('2026-01-01') to ('2027-01-01');
create table price_snapshots_2027 partition of price_snapshots for values from ('2027-01-01') to ('2028-01-01');
create table price_snapshots_default partition of price_snapshots default;
create index price_snapshots_variant_idx on price_snapshots (variant_id, observed_on);
create index price_snapshots_branch_idx on price_snapshots (branch_id, observed_on);

create table verification_logs (                      -- 검토 큐 처리 기록 (급변 가격 승인·반려, 자동 표시)
  id          bigserial primary key,
  offer_id    bigint references offers(id) on delete set null,
  action      text not null check (action in ('AUTO_FLAG', 'APPROVE', 'REJECT', 'EXPIRE', 'REOPEN')),
  reason      text,
  before_krw  integer,
  after_krw   integer,
  actor       text not null,                          -- 'system' 또는 관리자 id
  created_at  timestamptz not null default now()
);

create table user_reports (                           -- 사용자 신고(가격 틀림 등)
  id          bigserial primary key,
  offer_id    bigint references offers(id) on delete set null,
  reason      text not null check (char_length(reason) <= 500),
  status      text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'REJECTED')),
  created_at  timestamptz not null default now()
);

create table audit_logs (                             -- 관리자 변경 기록
  id          bigserial primary key,
  table_name  text not null,
  row_id      text not null,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before      jsonb,
  after       jsonb,
  actor       text not null,
  created_at  timestamptz not null default now()
);

-- 지금 비교에 쓰는 가격: 검증됨 + 종료일 안 지남
create view current_offers as
  select o.*, b.brand_id, b.region
  from offers o join clinic_branches b on b.id = o.branch_id
  where o.verification_status = 'VERIFIED' and (o.valid_until is null or o.valid_until >= current_date);
