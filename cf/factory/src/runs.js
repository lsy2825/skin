// Factory run bookkeeping (공장 실행 기록) — plain functions with no Cloudflare imports so tests/factory_worker.test.js can run
// them in node. src/index.js does the Cloudflare parts (container, Artifacts, storage) and calls these.

export const MODES = ["weekly", "scrape", "rebuild", "price-check", "source-check"];
export const KEEP = 20;              // runs kept in the log
export const MAX_RUN_MS = 100 * 60e3; // a run still going after this is stopped (GitHub allowed 90 minutes)
export const BOT_EMAIL = "factory@yoonsiljang.invalid";   // the factory's own commits (entry.sh) — never re-trigger a build

// what a manual /run request asks for → { mode, arg } or { error }
export function parseRun(body) {
  const mode = body && typeof body.mode === "string" ? body.mode : "";
  if (!MODES.includes(mode)) return { error: `mode must be one of ${MODES.join(", ")}` };
  if (mode !== "price-check") return { mode, arg: "" };
  const n = body.max === undefined ? 40 : Number(body.max);
  if (!Number.isInteger(n) || n < 1 || n > 200) return { error: "max must be a whole number 1-200" };
  return { mode, arg: String(n) };
}

// constant-time comparison of two secrets (both strings); empty never matches
export function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function bearer(request) {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export function newRun(id, mode, arg, why, now = Date.now()) {
  return { id, mode, arg, why, startedAt: new Date(now).toISOString(), state: "running" };
}

// close the current run with how it ended; returns the new { current, runs } (current null)
export function closeRun(current, runs, end, now = Date.now()) {
  if (!current) return { current: null, runs };
  const done = { ...current, ...end, endedAt: new Date(now).toISOString() };
  delete done.token;
  return { current: null, runs: [done, ...runs].slice(0, KEEP) };
}

// the container's own report → fields to keep (bounded, plain strings only)
export function cleanReport(body) {
  const s = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const result = ["ok", "skipped", "failed", "stopped"].includes(body && body.result) ? body.result : "failed";
  return { state: result, step: s(body && body.step, 40), commit: s(body && body.commit, 200), summary: s(body && body.summary, 3000) };
}

// what /status shows: no tokens, newest first
export function publicStatus(current, runs) {
  const strip = (r) => { if (!r) return null; const { token, ...rest } = r; return rest; };
  return { current: strip(current), runs: (runs || []).map(strip) };
}

// a push event re-runs the build unless the newest commit is the factory's own save
export function isOwnCommit(commit) {
  return JSON.stringify(commit || {}).includes(BOT_EMAIL);
}
