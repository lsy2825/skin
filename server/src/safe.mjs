// Untrusted input at the edge (docs/SECURITY_AND_PRIVACY_AUDIT.md): public event URLs (SSRF) and uploaded images (file type,
// size, pixel bombs). The URL decoder reads one public page the user pointed at — no login, no cookies, no CAPTCHA solving,
// no retry around a block: a page that refuses us is reported as "읽을 수 없음" and the reservation is released.
import { HttpError } from "./http.mjs";

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^198\.1[89]\./, /^2(2[4-9]|[3-5]\d)\./];
export function checkPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch (e) { throw new HttpError(400, "BAD_URL", "주소 형식이 올바르지 않아요"); }
  if (u.protocol !== "https:") throw new HttpError(400, "BAD_URL", "https 주소만 읽을 수 있어요");
  if (u.username || u.password) throw new HttpError(400, "BAD_URL", "계정 정보가 들어간 주소는 읽지 않아요");
  if (u.port && u.port !== "443") throw new HttpError(400, "BAD_URL", "표준 포트(443) 주소만 읽을 수 있어요");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /^\[|:/.test(host) || /^\d+(\.\d+){3}$/.test(host) || /^\d+$/.test(host) || /^0x/i.test(host))
    throw new HttpError(400, "BAD_URL", "IP 주소가 아닌 공개 도메인 주소만 읽을 수 있어요");
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa)$/.test(host) || /metadata/.test(host)) throw new HttpError(400, "BAD_URL", "공개 인터넷 주소가 아니에요");
  if (u.href.length > 2000) throw new HttpError(400, "BAD_URL", "주소가 너무 길어요");
  return u;
}
export const isPrivateIp = (ip) => PRIVATE_V4.some((rx) => rx.test(ip)) || /^(::1|fc|fd|fe80|::ffff:(10|127|192\.168)\.)/i.test(ip);

// one public HTML page → plain text (≤ maxBytes, ≤ 3 redirects each re-checked, short timeout, no credentials)
export async function fetchPublicText(raw, { fetch: f = fetch, maxBytes = 1_000_000, timeoutMs = 8000 } = {}) {
  let u = checkPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
    let r;
    try { r = await f(u.href, { redirect: "manual", signal: ctl.signal, credentials: "omit", headers: { accept: "text/html,text/plain;q=0.9", "user-agent": "YoonSiljangBot/1.0 (+user-requested single page read)" } }); }
    catch (e) { clearTimeout(t); throw new HttpError(502, "FETCH_FAILED", "페이지를 읽지 못했어요"); }
    clearTimeout(t);
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = checkPublicUrl(new URL(r.headers.get("location"), u).href); continue; }
    if (r.status === 401 || r.status === 403 || r.status === 429) throw new HttpError(422, "PAGE_BLOCKED", "로그인이 필요하거나 접근을 막은 페이지라 읽지 않았어요");
    if (!r.ok) throw new HttpError(422, "PAGE_UNREADABLE", `페이지가 응답하지 않았어요(${r.status})`);
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!/text\/html|text\/plain|application\/xhtml/.test(ct)) throw new HttpError(422, "PAGE_UNREADABLE", "웹 페이지(HTML)가 아니에요");
    const reader = r.body.getReader(); let got = 0; const parts = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; if (got > maxBytes) { reader.cancel(); break; } parts.push(value); }
    const html = new TextDecoder().decode(concat(parts));
    if (/captcha|recaptcha|hcaptcha|cf-challenge|접근이 차단/i.test(html.slice(0, 20000))) throw new HttpError(422, "PAGE_BLOCKED", "자동 접근 확인(CAPTCHA) 페이지라 읽지 않았어요");
    return { url: u.href, text: htmlToText(html) };
  }
  throw new HttpError(422, "PAGE_UNREADABLE", "다른 주소로 너무 여러 번 넘어가요");
}
const concat = (parts) => { const n = parts.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
export function htmlToText(html) {
  return String(html).replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 20000);
}

// uploaded image: the bytes decide the type (not the name or the declared type); JPEG / PNG / WebP only; ≤ 8 MB; ≤ 40 MP
export function checkImage(bytes, { maxBytes = 8 * 1024 * 1024, maxPixels = 40_000_000 } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!b.length) throw new HttpError(400, "BAD_IMAGE", "빈 파일이에요");
  if (b.length > maxBytes) throw new HttpError(413, "TOO_LARGE", "8MB 이하 사진만 올릴 수 있어요");
  let mime = null, w = 0, hgt = 0;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    mime = "image/png"; w = u32(b, 16); hgt = u32(b, 20);
  } else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    mime = "image/jpeg";
    for (let i = 2; i + 9 < b.length;) {                       // walk the segments to the frame header (SOF0..SOF15 except DHT/JPG/DAC)
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { hgt = (b[i + 5] << 8) | b[i + 6]; w = (b[i + 7] << 8) | b[i + 8]; break; }
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      i += 2 + len;
    }
  } else if (str(b, 0, 4) === "RIFF" && str(b, 8, 4) === "WEBP") {
    mime = "image/webp";
    const kind = str(b, 12, 4);
    if (kind === "VP8X") { w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16)); hgt = 1 + (b[27] | (b[28] << 8) | (b[29] << 16)); }
    else if (kind === "VP8 ") { w = (b[26] | (b[27] << 8)) & 0x3fff; hgt = (b[28] | (b[29] << 8)) & 0x3fff; }
    else if (kind === "VP8L") { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); w = (v & 0x3fff) + 1; hgt = ((v >> 14) & 0x3fff) + 1; }
  }
  if (!mime) throw new HttpError(415, "BAD_IMAGE", "JPG·PNG·WebP 사진만 올릴 수 있어요");
  if (!w || !hgt) throw new HttpError(400, "BAD_IMAGE", "사진 크기를 읽지 못했어요(손상된 파일)");
  if (w * hgt > maxPixels) throw new HttpError(413, "TOO_LARGE", "사진 해상도가 너무 커요");
  return { mime, width: w, height: hgt, bytes: b.length };
}
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const str = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
