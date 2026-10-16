// Make the VAPID key pair for price-alert pushes, once. Two ways:
//
//   node cf/alerts/vapid-keygen.mjs
//       On your own computer: prints the public key (87 characters: app/config.js pushPublicKey) and the private JWK (paste
//       it as the Worker secret VAPID_PRIVATE_JWK; keep a copy only in a password manager). Writes nothing to disk.
//       Refuses to run on GitHub Actions: the logs of this repository are public.
//
//   node cf/alerts/vapid-keygen.mjs --put <wrangler> <wrangler config> <public key file>
//       What .github/workflows/cf-alerts.yml runs for "Run workflow → setup_keys". The private JWK never leaves this
//       process except through the stdin pipe of `<wrangler> secret put VAPID_PRIVATE_JWK --config <wrangler config>`:
//       never an argument, never a file, never printed. On GitHub Actions, before anything else, it writes ::add-mask::
//       for the JWK and for its d (the runner takes those lines as commands, not log text), so GitHub hides both in
//       everything logged after, in case anything ever echoed them. Only the public key is written, to <public key file>.
//       If wrangler fails it exits non-zero and the key is dropped (if the secret did get stored, GET /health "key" shows
//       its public key).
//
// The Worker derives the public key from the JWK (GET /health "key"), so cf/alerts/wrangler.jsonc VAPID_PUBLIC_KEY can stay
// empty. Changing the pair later means every phone has to subscribe again.
import { webcrypto as wc } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync, writeSync } from "node:fs";

async function makePair() {
  const pair = await wc.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = Buffer.from(await wc.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
  const { kty, crv, x, y, d } = await wc.subtle.exportKey("jwk", pair.privateKey);
  return { pub, jwk: JSON.stringify({ kty, crv, x, y, d }), d };
}

const args = process.argv.slice(2);
if (args[0] === "--put") {
  const [, wrangler, config, pubFile] = args;
  if (args.length !== 4 || !wrangler || !config || !pubFile) {
    console.error("usage: node cf/alerts/vapid-keygen.mjs --put <wrangler> <wrangler config> <public key file>");
    process.exit(2);
  }
  const { pub, jwk, d } = await makePair();
  // FIRST, before anything else is printed: GitHub hides these two strings from here on (writeSync: on the pipe before
  // wrangler starts). Only on Actions — anywhere else these lines would just print the key.
  if (process.env.GITHUB_ACTIONS === "true") writeSync(1, `::add-mask::${jwk}\n::add-mask::${d}\n`);
  const r = spawnSync(wrangler, ["secret", "put", "VAPID_PRIVATE_JWK", "--config", config], { input: jwk, stdio: ["pipe", "inherit", "inherit"] });
  if (r.status !== 0) {
    console.error(`vapid-keygen: wrangler secret put VAPID_PRIVATE_JWK failed (${r.error ? r.error.code : `exit ${r.status}`}) — the new key was dropped; if the secret did get stored, GET /health "key" shows its public key`);
    process.exit(1);
  }
  writeFileSync(pubFile, `${pub}\n`);
  console.log("vapid-keygen: private key stored as the Worker secret VAPID_PRIVATE_JWK (not shown, not saved anywhere else)");
} else if (args.length) {
  console.error("usage: node cf/alerts/vapid-keygen.mjs   |   node cf/alerts/vapid-keygen.mjs --put <wrangler> <wrangler config> <public key file>");
  process.exit(2);
} else if (process.env.GITHUB_ACTIONS === "true") {
  console.error("vapid-keygen: this prints the private key, and the logs of this repository are public — on GitHub Actions use --put (cf-alerts.yml, Run workflow → setup_keys)");
  process.exit(1);
} else {
  const { pub, jwk } = await makePair();
  console.log("VAPID public key (app/config.js pushPublicKey; cf/alerts/wrangler.jsonc VAPID_PUBLIC_KEY may stay empty):");
  console.log(pub);
  console.log("");
  console.log("VAPID private JWK (Worker secret VAPID_PRIVATE_JWK — shown once, do not save it in the repository):");
  console.log(jwk);
}
