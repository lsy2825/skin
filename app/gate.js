// PIN screen (a screen lock, not data protection: data.json is still a public file).
// HASH = sha256("velyb-gate:" + PIN). New PIN: python3 -c "import hashlib;print(hashlib.sha256(b'velyb-gate:NEWPIN').hexdigest())",
// paste it below and bump VER in sw.js (gate.js is served cache-first). A 4-digit PIN hash is easy to brute-force: this
// only keeps casual viewers out; data.json and the repo stay public.
// 5th wrong try locks 5 min, each further wrong try doubles it (cap 24 h). Unlock lasts for this tab (sessionStorage).

// Clickjacking guard, before anything else. GitHub Pages cannot send X-Frame-Options or a CSP frame-ancestors header (and
// frame-ancestors is ignored in a <meta> tag), so another site could show this app inside an invisible frame and trick
// taps on the PIN pad or buttons. Inside another site's frame the page hides itself and offers to open on its own; a
// same-site frame is left alone. It lives here, not in its own file in <head>, so it costs no extra blocking request
// before the first paint. A stopgap until a domain + proxy can send the header (docs/SECURITY_REMEDIATION.md R-open-4).
(function () {
  "use strict";
  if (window.top === window.self) return;
  var sameSite = false;
  try { sameSite = window.top.location.origin === window.location.origin; } catch (e) { /* cross-origin parent */ }
  if (sameSite) return;
  var root = document.documentElement;
  root.setAttribute("data-framed", "");
  root.style.setProperty("display", "none", "important");
  // top-level navigation from a cross-site frame needs a user tap in current browsers, so give one button to tap
  document.addEventListener("DOMContentLoaded", function () {
    var a = document.createElement("a");
    a.href = window.location.href; a.target = "_blank"; a.rel = "noopener";
    a.textContent = "윤실장은 다른 사이트 안에서 열 수 없어요. 새 창에서 열기";
    a.setAttribute("style", "display:block;margin:40px 16px;font:16px/1.5 sans-serif;color:#1f1d1a");
    document.body.replaceChildren(a);
    root.style.removeProperty("display");
  });
})();

(function () {
  "use strict";
  if (document.documentElement.hasAttribute("data-framed")) return;   // no PIN pad inside another site's frame (above)
  const HASH = "e836cf70b3fa90a7ecdbcbd417ffa1e25e181af957c2a68a58dd1f5e0a355671", FREE = 5, BASE = 5 * 60 * 1000, CAP = 24 * 60 * 60 * 1000;
  const root = document.documentElement;
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };
  let mem = { f: 0, until: 0 };
  const load = () => { try { const v = JSON.parse(localStorage.getItem("pc:gate") || "null"); if (v) mem = v; } catch (e) {} return mem; };
  const save = (v) => { mem = v; try { localStorage.setItem("pc:gate", JSON.stringify(v)); } catch (e) {} };
  window.lockApp = () => { try { sessionStorage.removeItem("pc:gate-ok"); } catch (e) {} location.reload(); };
  if (ss.get("pc:gate-ok") === HASH) return;
  root.classList.add("locked");

  function sha256(str) {
    const K = [], H = [];
    let n = 2, c = 0;
    const frac = (x) => ((x - Math.floor(x)) * 4294967296) | 0;
    while (c < 64) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) { if (c < 8) H[c] = frac(Math.pow(n, 1 / 2)); K[c++] = frac(Math.pow(n, 1 / 3)); } n++; }
    const b = Array.from(new TextEncoder().encode(str)), l = b.length * 8;
    b.push(0x80); while (b.length % 64 !== 56) b.push(0);
    for (let i = 7; i >= 0; i--) b.push(i >= 4 ? 0 : (l >>> (i * 8)) & 255);
    const r = (x, k) => (x >>> k) | (x << (32 - k)), w = new Array(64);
    for (let o = 0; o < b.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
      for (let i = 16; i < 64; i++) { const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      let [A, B, C, D, E, F, G, X] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (X + (r(E, 6) ^ r(E, 11) ^ r(E, 25)) + ((E & F) ^ (~E & G)) + K[i] + w[i]) | 0, t2 = ((r(A, 2) ^ r(A, 13) ^ r(A, 22)) + ((A & B) ^ (A & C) ^ (B & C))) | 0;
        X = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
      }
      H[0] = (H[0] + A) | 0; H[1] = (H[1] + B) | 0; H[2] = (H[2] + C) | 0; H[3] = (H[3] + D) | 0; H[4] = (H[4] + E) | 0; H[5] = (H[5] + F) | 0; H[6] = (H[6] + G) | 0; H[7] = (H[7] + X) | 0;
    }
    return H.map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
  }
  window.__sha256 = sha256;

  function init() {
    const msg = document.getElementById("gate-msg"), dots = document.getElementById("gate-dots"), pad = document.getElementById("gate-pad");
    let pin = "", timer = null;
    const paint = () => dots.querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < pin.length));
    const say = (t, err) => { msg.textContent = t; msg.classList.toggle("err", !!err); };
    const mmss = (ms) => { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
      return h ? `${h}시간 ${m}분` : m ? `${m}분 ${String(x).padStart(2, "0")}초` : `${x}초`; };
    function lockTick() {
      const left = load().until - Date.now(), locked = left > 0;
      pad.querySelectorAll("button").forEach((btn) => { btn.disabled = locked; });
      if (locked) { say(`여러 번 틀려서 잠겼어요. ${mmss(left)} 뒤에 다시 시도해 주세요`, true); clearTimeout(timer); timer = setTimeout(lockTick, 1000); }
      else if (/잠겼/.test(msg.textContent)) say("다시 입력해 주세요");
      return locked;
    }
    function check() {
      if (sha256("velyb-gate:" + pin) === HASH) {
        save({ f: 0, until: 0 }); ss.set("pc:gate-ok", HASH);
        root.classList.remove("locked"); window.dispatchEvent(new Event("unlocked")); return;
      }
      const f = (load().f || 0) + 1;
      save({ f, until: f >= FREE ? Date.now() + Math.min(CAP, BASE * Math.pow(2, f - FREE)) : 0 });
      pin = ""; paint();
      dots.classList.remove("shake"); void dots.offsetWidth; dots.classList.add("shake");
      if (!lockTick()) say(`비밀번호가 달라요 (${f}/${FREE}번)`, true);
    }
    function press(d) {
      if (lockTick()) return;
      if (d === "del") pin = pin.slice(0, -1); else if (pin.length < 4) pin += d;
      paint();
      if (pin.length === 4) setTimeout(check, 120);
    }
    pad.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) press(b.dataset.d); });
    document.addEventListener("keydown", (e) => {
      if (!root.classList.contains("locked")) return;
      if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); } else if (e.key === "Backspace") { press("del"); e.preventDefault(); }
    });
    lockTick();
  }
  if (document.getElementById("gate-pad")) init(); else document.addEventListener("DOMContentLoaded", init);
})();
