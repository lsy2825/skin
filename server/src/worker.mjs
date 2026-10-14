// Cloudflare Workers entry (wrangler.toml.example). Secrets come from the Worker's secret store (wrangler secret put …),
// never from this repository. DEMO mode needs no provider secrets; SANDBOX needs Toss test keys; PRODUCTION refuses to start
// without live keys and the owner's written approval (config.mjs LIVE_PAYMENTS_APPROVED).
import { loadConfig } from "./config.mjs";
import { postgrestRpc } from "./db.mjs";
import { tossAdapter, demoAdapter } from "./payments/toss.mjs";
import { appleAdapter, googleAdapter } from "./payments/store.mjs";
import { openaiVision } from "./ai/openai.mjs";
import { createApp, dataLoader } from "./app.mjs";
import { dbRateStore } from "./http.mjs";

let app = null;
function build(env) {
  const config = loadConfig(env);
  const rpc = postgrestRpc({ url: config.supabase.url, serviceKey: config.supabase.serviceKey });
  const log = (event, data) => console.log(JSON.stringify({ event, ...data }));   // no tokens, no card data, no image bytes
  return createApp({
    config, rpc, log,
    toss: config.toss.secretKey ? tossAdapter({ secretKey: config.toss.secretKey, base: config.toss.base }) : null,
    demo: config.demoPayments ? demoAdapter() : null,
    vision: config.openai.enabled && config.openai.apiKey && config.openai.model ? openaiVision(config.openai, rpc) : null,
    ai: config.openai.enabled && config.openai.apiKey ? { apiKey: config.openai.apiKey, base: config.openai.base, model: config.openai.textModel || config.openai.model, timeoutMs: 20000,
      maxUserCallsPerDay: config.openai.maxUserCallsPerDay, maxServiceKrwPerDay: config.openai.maxServiceKrwPerDay } : null,
    apple: config.apple.bundleId && config.apple.rootCertsB64.length ? appleAdapter(config.apple) : null,
    google: config.google.packageName && config.google.serviceAccountJson ? googleAdapter(config.google) : null,
    loadCtx: dataLoader({ url: config.dataUrl, log }),
    rateStore: (env.RATE_LIMIT_STORE || "db") === "db" ? dbRateStore(rpc) : new Map(),
  });
}
export default {
  async fetch(req, env) { app = app || build(env); return app.fetch(req); },
  async scheduled(event, env, c) { app = app || build(env); c.waitUntil(app.scheduled(event.cron === "*/10 * * * *" ? "reconcile" : "all").then((o) => console.log(JSON.stringify({ event: "scheduled", ...o })))); },
};
