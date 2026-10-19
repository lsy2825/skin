// 공용 뼈대 (docs/APP_JS_SPLIT_PLAN.md 1단계): DOM helpers, per-account storage and toasts, shared by app.js and the
// screen files split out of it. Everything sits on window.App; app.js takes them with `const { … } = App`. No behaviour
// of its own — the same code that used to sit at the top of app.js. Loaded right before app.js (index.html, sw.js SHELL).
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  const $ = (s, el = document) => el.querySelector(s);
  // only relative links and http(s) / mailto / tel: a 'javascript:' or 'data:' URL from scraped data never becomes a link
  function safeUrl(v) { const m = /^\s*([a-z][a-z0-9+.-]*):/i.exec(String(v)); return !m || /^(https?|mailto|tel)$/i.test(m[1]); }
  // strings from scraped data go in as text nodes (`html:` is for static markup only — XSS)
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "style") e.setAttribute("style", v);
      else if ((k === "href" || k === "src") && !safeUrl(v)) continue;   // links built from scraped data
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((c) => c != null && c !== false));
  // Lucide icon (icons.js: static markup shipped with the app, never data) → <svg class="i">
  const icon = (n, cls = "") => {
    const e = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    e.setAttribute("viewBox", "0 0 24 24"); e.setAttribute("class", cls ? `i ${cls}` : "i"); e.setAttribute("aria-hidden", "true");
    e.innerHTML = (window.ICONS || {})[n] || "";
    return e;
  };
  const won = (n) => Math.round(n).toLocaleString("ko-KR") + "원";
  const km = (d) => d == null ? "" : d < 1 ? Math.round(d * 1000) + "m" : (d < 10 ? d.toFixed(1) : Math.round(d)) + "km";

  // personal keys live in the space of whoever uses the phone (round-2 R01): "pc:<key>" before sign-in, "pc:u:<id>:<key>" for
  // an account — so a second account on the same phone never sees, merges or uploads the first one's data. Device settings
  // (theme, region, VAT mode, Jomi preferences …) stay shared. The space changes only through setScope (app.js onAccount).
  const PERSONAL = new Set(["me", "recs", "carts", "cart", "ci", "alerts", "notes", "favs", "snaps", "places", "locPlace", "recent", "recentQ", "short",
    "checks", "rechecks", "events", "reports", "sender", "lastRoute", "presets", "visited"]);
  let SCOPE = (() => { try { const u = JSON.parse(localStorage.getItem("pc:lastUid") || "null"); return u && window.APP_CONFIG && window.APP_CONFIG.supabaseUrl ? `u:${u}:` : ""; } catch (e) { return ""; } })();
  const keyOf = (k) => "pc:" + (PERSONAL.has(k) ? SCOPE : "") + k;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(keyOf(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(keyOf(k), JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    anon(k) { try { const v = localStorage.getItem("pc:" + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
    dropAnon(k) { try { localStorage.removeItem("pc:" + k); } catch (e) { /* ignore */ } },
  };
  const scope = () => SCOPE;
  const setScope = (s) => { SCOPE = s; };

  // toasts: one #toast element, one timer shared by every kind (a new toast replaces the last, never stacks)
  let toastT;
  const toastStop = () => clearTimeout(toastT);
  const toastTimer = (ms, cls) => { clearTimeout(toastT); toastT = setTimeout(() => $("#toast").classList.remove(...cls), ms); };
  const toast = (t) => { const el = $("#toast"); el.classList.remove("act", "jt"); el.textContent = t; el.classList.add("on"); toastTimer(1800, ["on"]); };
  // a toast with a '되돌리기' button for 6 s (deleting carts, items, alerts, records, presets)
  function undoToast(text, undo) {
    const el = $("#toast");
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = "되돌리기";
    btn.addEventListener("click", () => { el.classList.remove("on", "act"); toastStop(); undo(); toast((App.jline && App.jline("undone")) || "되돌렸어요"); });
    el.replaceChildren(document.createTextNode(text + " "), btn);
    el.classList.remove("jt"); el.classList.add("on", "act"); toastTimer(6000, ["on", "act"]);
  }
  // a plain toast with one action button (5 s)
  function actToast(text, act) {
    const el = $("#toast");
    el.replaceChildren(h("span", { class: "tt" }, text), h("button", { type: "button", onclick: () => { el.classList.remove("on", "act"); toastStop(); act[1](); } }, act[0]));
    el.classList.remove("jt"); el.classList.add("on", "act"); toastTimer(5000, ["on", "act"]);
  }
  async function copyText(text, done = (App.jline && App.jline("copied")) || "복사했어요") { try { await navigator.clipboard.writeText(text); toast(done); } catch (e) { toast("복사하지 못했어요"); } }

  Object.assign(App, { $, h, safeUrl, fill, icon, won, km, PERSONAL, store, scope, setScope, toast, toastStop, toastTimer, undoToast, actToast, copyText });
})();
