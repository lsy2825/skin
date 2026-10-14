-- 윤실장 5.0 catalog, version 1 (docs/PRICING_AND_UNIT_ECONOMICS.md). These are EXPERIMENTAL prices from the 5.0 directive,
-- not approved production prices: only the DEMO channel is active. WEB_PG / APPLE_IAP / GOOGLE_PLAY rows are inactive until
-- the owner approves them (credit_products refuses an active real-channel row without approved_by).
-- A new price = a new version row (old orders keep their snapshot); never update price_krw / paid_credits in place.
insert into public.credit_products (code, version, channel, store_product_id, price_krw, vat_included, paid_credits, adfree_days, active, note) values
  ('MINI',     1, 'DEMO',        null, 990,  true, 5,  7,  true,  '시연: 실제 돈 아님'),
  ('STANDARD', 1, 'DEMO',        null, 1990, true, 12, 21, true,  '시연: 실제 돈 아님'),
  ('PLUS',     1, 'DEMO',        null, 3900, true, 26, 45, true,  '시연: 실제 돈 아님'),
  ('MINI',     1, 'WEB_PG',      null, 990,  true, 5,  7,  false, '가설 가격 — 승인 전'),
  ('STANDARD', 1, 'WEB_PG',      null, 1990, true, 12, 21, false, '가설 가격 — 승인 전'),
  ('PLUS',     1, 'WEB_PG',      null, 3900, true, 26, 45, false, '가설 가격 — 승인 전'),
  ('MINI',     1, 'APPLE_IAP',   'kr.yoonsiljang.credits.mini',     1100, true, 5,  7,  false, '스토어 가격대에서 다시 고를 것 — 승인 전'),
  ('STANDARD', 1, 'APPLE_IAP',   'kr.yoonsiljang.credits.standard', 2200, true, 12, 21, false, '스토어 가격대에서 다시 고를 것 — 승인 전'),
  ('PLUS',     1, 'APPLE_IAP',   'kr.yoonsiljang.credits.plus',     4400, true, 26, 45, false, '스토어 가격대에서 다시 고를 것 — 승인 전'),
  ('MINI',     1, 'GOOGLE_PLAY', 'credits_mini',     1100, true, 5,  7,  false, '스토어 가격대에서 다시 고를 것 — 승인 전'),
  ('STANDARD', 1, 'GOOGLE_PLAY', 'credits_standard', 2200, true, 12, 21, false, '스토어 가격대에서 다시 고를 것 — 승인 전'),
  ('PLUS',     1, 'GOOGLE_PLAY', 'credits_plus',     4400, true, 26, 45, false, '스토어 가격대에서 다시 고를 것 — 승인 전')
on conflict do nothing;

insert into public.premium_features (code, version, credits, entitlement_days, title, active) values
  ('EVENT_IMAGE_DECODER',  1, 1, 0,  'AI 이벤트 사진 읽기', true),
  ('EVENT_URL_DECODER',    1, 1, 0,  '공개 이벤트 주소·글 읽기', true),
  ('MULTI_EVENT_COMPARE',  1, 2, 0,  '이벤트 여러 개 비교', true),
  ('QUOTATION_DECODER',    1, 1, 0,  '견적·패키지 읽기', true),
  ('JOMI_QA_SESSION',      1, 1, 0,  '죠미 심화 질문(한 세션 5문답)', true),
  ('PRODUCT_DEEP_COMPARE', 1, 1, 0,  '제품 심층 비교 보고서', true),
  ('PRICE_HISTORY_REPORT', 1, 1, 0,  '가격 이력 보고서', true),
  ('REGIONAL_PRICE_REPORT',1, 1, 0,  '지역 가격 보고서', true),
  ('ADVANCED_CART_PLANNER',1, 2, 30, '고급 장바구니 계획(30일 다시 계산)', true),
  ('PRICE_WATCH_7D',       1, 1, 7,  '가격 지켜보기 7일', true),
  ('PRICE_WATCH_30D',      1, 3, 30, '가격 지켜보기 30일', true),
  ('CONSOLIDATED_REPORT',  1, 2, 0,  '종합 보고서', true)
on conflict do nothing;

-- Round 2 (2026-10-14, docs/PRODUCT_DECISIONS.md). Catalog version 2: the bonus 'ad-free days' is dropped — the app shows no
-- ads, so selling time without them explained nothing. Version 1 rows stay (old orders keep their snapshot) but are no
-- longer active; real channels stay inactive until the owner approves them.
insert into public.credit_products (code, version, channel, store_product_id, price_krw, vat_included, paid_credits, adfree_days, active, note) values
  ('MINI',     2, 'DEMO',        null, 990,  true, 5,  0, false, '시연: 실제 돈 아님'),
  ('STANDARD', 2, 'DEMO',        null, 1990, true, 12, 0, false, '시연: 실제 돈 아님'),
  ('PLUS',     2, 'DEMO',        null, 3900, true, 26, 0, false, '시연: 실제 돈 아님'),
  ('MINI',     2, 'WEB_PG',      null, 990,  true, 5,  0, false, '가설 가격 — 승인 전'),
  ('STANDARD', 2, 'WEB_PG',      null, 1990, true, 12, 0, false, '가설 가격 — 승인 전'),
  ('PLUS',     2, 'WEB_PG',      null, 3900, true, 26, 0, false, '가설 가격 — 승인 전'),
  ('MINI',     2, 'APPLE_IAP',   'kr.yoonsiljang.credits.mini',     1100, true, 5,  0, false, '스토어 가격대에서 다시 고를 것 — 승인 전'),
  ('STANDARD', 2, 'APPLE_IAP',   'kr.yoonsiljang.credits.standard', 2200, true, 12, 0, false, '스토어 가격대에서 다시 고를 것 — 승인 전'),
  ('PLUS',     2, 'APPLE_IAP',   'kr.yoonsiljang.credits.plus',     4400, true, 26, 0, false, '스토어 가격대에서 다시 고를 것 — 승인 전'),
  ('MINI',     2, 'GOOGLE_PLAY', 'credits_mini',     1100, true, 5,  0, false, '스토어 가격대에서 다시 고를 것 — 승인 전'),
  ('STANDARD', 2, 'GOOGLE_PLAY', 'credits_standard', 2200, true, 12, 0, false, '스토어 가격대에서 다시 고를 것 — 승인 전'),
  ('PLUS',     2, 'GOOGLE_PLAY', 'credits_plus',     4400, true, 26, 0, false, '스토어 가격대에서 다시 고를 것 — 승인 전')
on conflict do nothing;
-- swap the active DEMO rows to version 2: off first, then on (the one-active-per-code index is checked row by row).
-- Guarded so re-running the seed after a later version went live changes nothing.
update public.credit_products set active = false where channel = 'DEMO' and version = 1 and active
   and not exists (select 1 from public.credit_products x where x.channel = 'DEMO' and x.version > 2);
update public.credit_products c set active = true where c.channel = 'DEMO' and c.version = 2 and not c.active
   and not exists (select 1 from public.credit_products x where x.channel = 'DEMO' and x.code = c.code and x.active);

-- Paid tools reduced to the three whose value the free screens do not already give (BIZ01). The rest are not sold — the
-- server refuses them through this flag (commerce_reserve reads active features only): the free compare / cart / versus /
-- price-change screens show the same numbers, or the data (history, AI, push) is not there yet.
update public.premium_features set active = false where version = 1 and active and code in
  ('EVENT_IMAGE_DECODER', 'JOMI_QA_SESSION', 'PRODUCT_DEEP_COMPARE', 'PRICE_HISTORY_REPORT', 'REGIONAL_PRICE_REPORT',
   'ADVANCED_CART_PLANNER', 'PRICE_WATCH_7D', 'PRICE_WATCH_30D', 'CONSOLIDATED_REPORT');
