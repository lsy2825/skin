// Environment for the commerce API (docs/MONETIZATION_ARCHITECTURE.md §6). Secrets come only from the runtime's secret store
// (Cloudflare Worker secrets / env vars); none is in the repository. The environment decides what money can move:
//   DEMO       — no provider at all; the DEMO payment adapter grants demo credits (labelled), no real money
//   SANDBOX    — provider TEST keys only (test_ prefix for Toss); a live key here is refused
//   PRODUCTION — live keys only, and only with LIVE_PAYMENTS_APPROVED set by the owner (see PRODUCTION_LAUNCH_CHECKLIST.md)
export class ConfigError extends Error {}

export function loadConfig(env) {
  const E = (k, d = "") => (env[k] == null ? d : String(env[k]));
  // 5.1 audit: no default — a missing ENV used to mean DEMO (demo payments on) even next to a real database and live keys
  if (!E("ENV")) throw new ConfigError("ENV is required (DEMO, SANDBOX or PRODUCTION)");
  const mode = E("ENV").toUpperCase();
  if (!["DEMO", "SANDBOX", "PRODUCTION"].includes(mode)) throw new ConfigError(`ENV must be DEMO, SANDBOX or PRODUCTION (got ${mode})`);
  const toss = E("TOSS_SECRET_KEY");
  const problems = [];
  if (mode === "DEMO" && (/^live_/.test(toss) || E("LIVE_PAYMENTS_APPROVED"))) problems.push("DEMO must not run with live payment settings");
  if (mode === "SANDBOX" && toss && !/^test_/.test(toss)) problems.push("SANDBOX accepts only Toss TEST secret keys (test_…)");
  if (mode === "PRODUCTION") {
    if (toss && !/^live_/.test(toss)) problems.push("PRODUCTION needs a Toss LIVE secret key");
    // the owner's written approval, e.g. 'approved:2026-11-01:owner' — set by hand in the secret store, never by code
    if (!/^approved:\d{4}-\d{2}-\d{2}:\S+$/.test(E("LIVE_PAYMENTS_APPROVED"))) problems.push("PRODUCTION needs LIVE_PAYMENTS_APPROVED (owner approval)");
  }
  if (mode !== "DEMO" && (!E("SUPABASE_URL") || !E("SUPABASE_SERVICE_ROLE_KEY"))) problems.push("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required outside DEMO");
  if (problems.length) throw new ConfigError(problems.join("; "));
  return {
    mode,
    demoPayments: mode !== "PRODUCTION",                        // the DEMO adapter never runs in production
    origins: E("ALLOWED_ORIGINS", "https://lsy2825.github.io").split(",").map((s) => s.trim()).filter(Boolean),
    supabase: { url: E("SUPABASE_URL").replace(/\/$/, ""), serviceKey: E("SUPABASE_SERVICE_ROLE_KEY"), jwtSecret: E("SUPABASE_JWT_SECRET") },
    toss: { secretKey: toss, clientKey: E("TOSS_CLIENT_KEY"), base: E("TOSS_API_BASE", "https://api.tosspayments.com") },
    openai: {
      apiKey: E("OPENAI_API_KEY"),
      // round-2 O7: AI stays OFF unless the operator turns it on explicitly — a key alone does not start spending
      enabled: E("AI_FEATURES_ENABLED", "false") === "true",
      base: E("OPENAI_API_BASE", "https://api.openai.com").replace(/\/(v1)?\/?$/, ""),   // adapters add /v1/responses
      // model names are configuration: check the provider's current model list and prices before changing them
      model: E("OPENAI_MODEL_DEFAULT"), strongModel: E("OPENAI_MODEL_STRONG"), textModel: E("OPENAI_MODEL_TEXT"),
      maxOutputTokens: +E("AI_MAX_OUTPUT_TOKENS", "1500"),
      maxKrwPerJob: +E("AI_MAX_KRW_PER_JOB", "60"),              // hard budget per paid job (1 credit ≈ 131원 net on the web, docs/PRICING_AND_UNIT_ECONOMICS.md)
      timeoutMs: +E("AI_TIMEOUT_MS", "45000"),
      maxUserCallsPerDay: +E("AI_MAX_USER_CALLS_PER_DAY", "30"),   // every model call counts, failed ones too (KST day)
      maxServiceKrwPerDay: +E("AI_MAX_SERVICE_KRW_PER_DAY", "30000"),   // whole-service daily AI budget; over it, AI features pause
    },
    push: { publicKey: E("VAPID_PUBLIC_KEY"), privateJwk: E("VAPID_PRIVATE_JWK"), subject: E("VAPID_SUBJECT", "mailto:privacy@example.invalid") },
    apple: { bundleId: E("APPLE_BUNDLE_ID"), environment: E("APPLE_ENVIRONMENT", mode === "PRODUCTION" ? "Production" : "Sandbox"), rootCertsB64: E("APPLE_ROOT_CERTS_B64").split(",").map((s) => s.trim()).filter(Boolean) },
    google: { packageName: E("GOOGLE_PLAY_PACKAGE"), serviceAccountJson: E("GOOGLE_SERVICE_ACCOUNT_JSON") },
    dataUrl: E("DATA_URL", "https://lsy2825.github.io/skin/data.json"),
    uploadMaxBytes: +E("UPLOAD_MAX_BYTES", String(8 * 1024 * 1024)),
  };
}
