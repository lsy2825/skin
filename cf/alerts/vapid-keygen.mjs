// Make the VAPID key pair for price-alert pushes, once:  node cf/alerts/vapid-keygen.mjs
// Prints the public key (87 characters: cf/alerts/wrangler.jsonc VAPID_PUBLIC_KEY and app/config.js pushPublicKey) and the
// private JWK (paste it as the Worker secret VAPID_PRIVATE_JWK; keep a copy only in a password manager).
// Writes nothing to disk. Changing the pair later means every phone has to subscribe again.
import { webcrypto as wc } from "node:crypto";

const pair = await wc.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = Buffer.from(await wc.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
const { kty, crv, x, y, d } = await wc.subtle.exportKey("jwk", pair.privateKey);
console.log("VAPID public key (config.js pushPublicKey + wrangler.jsonc VAPID_PUBLIC_KEY):");
console.log(pub);
console.log("");
console.log("VAPID private JWK (Worker secret VAPID_PRIVATE_JWK — shown once, do not save it in the repository):");
console.log(JSON.stringify({ kty, crv, x, y, d }));
