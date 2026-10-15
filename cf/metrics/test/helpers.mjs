// Test helpers (not a test file): a fake D1 that records every SQL string and bound value, RSA keys + JWTs for Access,
// and a console spy. No dependencies: node:test + WebCrypto only.
import { STAGE_DAILY_CAP } from "../src/rules.js";

// Emulates just the two statements the Worker uses, so counts and the cap behave like the real table.
export function fakeD1({ failWith = null } = {}) {
  const calls = [];
  const table = new Map();          // "day|stage" → n
  const db = {
    calls, table,
    prepare(sql) {
      return {
        bind(...args) {
          const call = { sql, args };
          const exec = async () => {
            calls.push(call);
            if (failWith) throw new Error(failWith);
            if (sql.startsWith("INSERT INTO daily_counts")) {
              const [day, stage, cap] = args;
              const k = `${day}|${stage}`;
              const n = table.get(k) ?? 0;
              if (!table.has(k)) table.set(k, 1);
              else if (n < cap) table.set(k, n + 1);
              return { results: [], meta: {} };
            }
            if (sql.startsWith("SELECT day, stage, n FROM daily_counts")) {
              const [from, to] = args;
              const results = [...table].map(([k, n]) => { const [day, stage] = k.split("|"); return { day, stage, n }; })
                .filter((r) => r.day >= from && r.day <= to);
              return { results, meta: {} };
            }
            throw new Error(`unexpected SQL: ${sql}`);
          };
          return { run: exec, all: exec };
        },
        async first() {                // /health: SELECT 1
          calls.push({ sql, args: [] });
          if (failWith) throw new Error(failWith);
          if (sql === "SELECT 1 AS ok") return { ok: 1 };
          throw new Error(`unexpected SQL: ${sql}`);
        },
      };
    },
  };
  return db;
}

export const CAP = STAGE_DAILY_CAP;

const enc = new TextEncoder();
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const b64urlJson = (o) => b64url(enc.encode(JSON.stringify(o)));

export async function rsaKey() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
}

export async function publicJwk(pair, kid) {
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, kty: "RSA", alg: "RS256", use: "sig", e: jwk.e, n: jwk.n };
}

export async function signJwt(pair, header, claims) {
  const head = b64urlJson(header);
  const body = b64urlJson(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

// A certs endpoint served through the injected fetch; counts how often it is asked.
export function certsFetch(byUrl) {
  const f = async (url) => {
    f.calls.push(String(url));
    const keys = byUrl[String(url)];
    if (!keys) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { "content-type": "application/json" } });
  };
  f.calls = [];
  return f;
}

// Runs fn with every console method replaced; returns [result, calls].
export async function withConsoleSpy(fn) {
  const names = ["log", "info", "warn", "error", "debug", "trace", "dir", "table"];
  const saved = {};
  const calls = [];
  for (const n of names) { saved[n] = console[n]; console[n] = (...a) => { calls.push([n, a]); }; }
  try { return [await fn(), calls]; } finally { for (const n of names) console[n] = saved[n]; }
}
