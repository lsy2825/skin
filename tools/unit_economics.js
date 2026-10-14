#!/usr/bin/env node
// 크레딧 단위 경제성 표 (docs/PRICING_AND_UNIT_ECONOMICS.md). 가정값(app/domain/economics.js)으로 계산해요 — 계약 요율·실제 AI 비용이
// 생기면 그 값으로 바꾸고, 운영 중에는 서버의 commerce_economics(실측)를 봐요.
// Usage: node tools/unit_economics.js [WEB_PG|APPLE_IAP|GOOGLE_PLAY]
const E = require("../app/domain/economics.js");
const W = require("../app/domain/demowallet.js");
const ch = process.argv[2] || "WEB_PG";
// store prices are their own price points (supabase/commerce_seed.sql, inactive until approved)
const STORE = { APPLE_IAP: [1100, 2200, 4400], GOOGLE_PLAY: [1100, 2200, 4400] };
const products = W.PRODUCTS.map((p, i) => (STORE[ch] ? { ...p, price_krw: STORE[ch][i] } : p));
const t = E.table(products, Object.fromEntries(Object.entries(W.FEATURES).map(([k, v]) => [k, v.credits])), ch);
console.log(`채널 ${ch} — ${t.packs[0].fee_note}`);
console.log("묶음 | 가격 | 부가세 | 수수료 | 순수익 | 크레딧당");
for (const p of t.packs) console.log(`${p.code} | ${p.price_krw} | ${p.vat} | ${p.fee} | ${p.net} | ${p.net_per_credit}`);
console.log(`\n기능별 (가장 싼 크레딧 ${t.worst_net_per_credit}원 기준, 비용은 가정)`);
for (const f of t.features) console.log(`${f.code} | ${f.credits}C | 매출 ${f.revenue} | 비용 ${f.cost} | 남음 ${f.margin} (${f.margin_rate}%)`);
