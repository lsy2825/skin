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
  // empty states (2026-10-20 디자인 통일 U01, DESIGN_SYSTEM §3 '빈 상태'): a card or one block with nothing in it → emptyBox (an
  // icon in a grey circle, a title, one sentence, maybe a next step); a list that filters or sorts down to no line → emptyLine
  // (one grey line). The whole screen empty (빈 내 견적, 검색 결과 없음, 오류) is app.js jomiEmpty — 죠미 instead of the icon
  const emptyBox = (ic, title, ...kids) => h("div", { class: "empty" }, h("div", { class: "ei" }, icon(ic)), h("b", {}, title), ...kids);
  const emptyLine = (text, tag = "div") => h(tag, { class: "empty one" }, text);
  // a search field in one shape (2026-10-20 디자인 통일 U11, DESIGN_SYSTEM §3 '찾기 칸'): one height (59), radius 18, the magnifier first. The app's
  // own search (홈·탐색·검색) is white (.search); a field that narrows this screen's list or finds within it is filled (.search.inset —
  // 가격 변동·전체 가격표·지점·지점 비교·쉬운 용어·시술 사전·지도·비교 '다른 시술 찾기'). There were three: white with the magnifier,
  // filled without it (an inline background), and a 48px white .field
  const searchBox = (input, { inset = false, style, cls = "" } = {}, ...after) => h("div", { class: `search${inset ? " inset" : ""}${cls ? " " + cls : ""}`, style }, icon("search"), input, ...after);
  const km = (d) => d == null ? "" : d < 1 ? Math.round(d * 1000) + "m" : (d < 10 ? d.toFixed(1) : Math.round(d)) + "km";
  // a card's head in one shape (2026-10-20 디자인 통일 U06, DESIGN_SYSTEM §3 '카드 머리'): the title (h3 17) on the left, how many on
  // the right (13 grey — '182곳', '8개 브랜드', '0/20'), the basis under the title (13 grey — region, VAT, conditions). A control
  // the card needs at its head (보기 방식, 특가 포함) comes after the count. A count sat in three places before (in the title, on
  // the right, in the sentence under it), a basis on the right too, and a title said again on the right
  const cardHead = (title, { count, desc, end, style } = {}) => { if (end) end.classList.add("cend");
    return h("div", { class: "chead", style },
      h("div", { class: "row" }, h("h3", {}, title), h("span", { class: "sp" }), count != null && count !== "" ? h("span", { class: "cmeta num" }, count) : null, end || null),
      desc ? h("div", { class: "sub cdesc" }, desc) : null); };
  // '뒤로' at the top of every screen outside the tabs (2026-10-20 디자인 통일 U16) — the same button on each
  const backBtn = () => h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로");

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
  // a plain toast with action buttons: actToast(text, [label, fn]) — one button for 5 s; with more ([label, fn], [label, fn]: a
  // question such as '켜기' / '아니요') 8 s, so there is time to read it. Any button closes the toast first, then does its part
  function actToast(text, ...acts) {
    const el = $("#toast");
    el.replaceChildren(h("span", { class: "tt" }, text), ...acts.map((act) => h("button", { type: "button", onclick: () => { el.classList.remove("on", "act"); toastStop(); act[1](); } }, act[0])));
    el.classList.remove("jt"); el.classList.add("on", "act"); toastTimer(acts.length > 1 ? 8000 : 5000, ["on", "act"]);
  }
  async function copyText(text, done = (App.jline && App.jline("copied")) || "복사했어요") { try { await navigator.clipboard.writeText(text); toast(done); } catch (e) { toast("복사하지 못했어요"); } }

  Object.assign(App, { $, h, safeUrl, fill, icon, won, km, emptyBox, emptyLine, searchBox, cardHead, backBtn, PERSONAL, store, scope, setScope, toast, toastStop, toastTimer, undoToast, actToast, copyText });
})();
