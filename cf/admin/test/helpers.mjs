// Test helpers (not a test file): a fake ASSETS binding that records what it was asked for, RSA keys + JWTs for Access,
// and a console spy. No dependencies: node:test + WebCrypto only. The JWT helpers are the same as cf/metrics/test/helpers.mjs.

// Emulates the static-assets binding: a few files with the content types the real router sends, 404 for the rest.
export function fakeAssets() {
  const files = {
    "/": ["text/html; charset=utf-8", "<!doctype html><title>윤실장</title>", "public, max-age=0, must-revalidate"],
    "/index.html": ["text/html; charset=utf-8", "<!doctype html><title>윤실장</title>", "public, max-age=0, must-revalidate"],
    "/app.js": ["text/javascript; charset=utf-8", "window.App = {};", "public, max-age=0, must-revalidate"],
    "/data.json": ["application/json", "{\"meta\":{}}", "public, max-age=0, must-revalidate"],
    "/sw.js": ["text/javascript; charset=utf-8", "self.addEventListener('fetch', () => {});", "public, max-age=0, must-revalidate"],
  };
  const calls = [];
  return {
    calls,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      calls.push(`${request.method} ${pathname}`);
      const f = files[pathname];
      if (!f) return new Response(null, { status: 404 });
      const body = request.method === "HEAD" ? null : f[1];
      return new Response(body, { status: 200, headers: { "content-type": f[0], "cache-control": f[2], etag: '"x"' } });
    },
  };
}

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

// JSONC → JSON: drop // comments outside strings, then trailing commas.
export function jsonc(text) {
  let out = "", inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { out += c; if (c === "\\") out += text[++i]; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
