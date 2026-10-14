// Price-data sync rules (docs/PRICE_SYNC_ARCHITECTURE.md): what the app checks before it trusts or saves a data.json, and
// which state it is in. Pure functions, no DOM, no network. window.Sync in the app, require()d by tests/sync.test.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Sync = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SCHEMA = 1;                 // data.json layout this app understands (build2/datameta.py SCHEMA)
  const STALE_DAYS = 8;             // weekly collection + a day: older data is called 'old' on screen
  const RETRY_MS = [1000, 3000];    // a failed download is tried again after 1 s and 3 s (3 tries in all)
  const KEYS = ["meta", "branches", "cols", "keys", "s"];

  // data-meta.json as received: shape only (numbers, hex, dates). Returns [] when fine, else the problems.
  function checkMeta(m) {
    const bad = [];
    if (!m || typeof m !== "object") return ["메타 파일이 비어 있어요"];
    if (m.schema !== SCHEMA) bad.push(`형식 버전이 달라요(${m.schema})`);
    if (typeof m.version !== "string" || !/^\d{4}-\d{2}-\d{2}\.[0-9a-f]{8}$/.test(m.version)) bad.push("버전 표기가 이상해요");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.updated || "")) bad.push("데이터 날짜가 없어요");
    if (!(m.bytes > 1000)) bad.push("파일 크기가 이상해요");
    if (!/^[0-9a-f]{64}$/.test(m.sha256 || "")) bad.push("체크섬이 없어요");
    if (!(m.rows > 0) || !(m.branches > 0)) bad.push("가격·지점 수가 없어요");
    if (m.version && m.sha256 && m.version.slice(11) !== m.sha256.slice(0, 8)) bad.push("버전과 체크섬이 맞지 않아요");
    return bad;
  }

  // a parsed data.json against its meta (meta may be null for an old deploy without data-meta.json): the layout, the
  // counts, the dates, no duplicate branch, every column as long as the rows. sha: hex digest of the bytes, if computed.
  function checkData(d, m, sha) {
    const bad = [];
    if (!d || typeof d !== "object") return ["가격 파일을 읽지 못했어요"];
    for (const k of KEYS) if (k !== "cols" && (d[k] == null || typeof d[k] !== "object")) bad.push(`'${k}' 항목이 없어요`);
    if (!Array.isArray(d.cols) && !Array.isArray(d.rows)) bad.push("'cols' 항목이 없어요");   // columns (data.json) or rows (older form, still read)
    if (bad.length) return bad;
    const n = d.meta.rows;
    if (Array.isArray(d.cols) ? !d.cols.length || d.cols.some((c) => !Array.isArray(c) || c.length !== n) : d.rows.length !== n) bad.push("가격 줄 수가 맞지 않아요");
    if (!Array.isArray(d.branches) || !d.branches.length) bad.push("지점 목록이 비어 있어요");
    else {
      const seen = new Set();
      for (const b of d.branches) { const key = `${b[0]}|${b[1]}`; if (seen.has(key)) { bad.push("같은 지점이 두 번 있어요"); break; } seen.add(key); }
    }
    if (m) {
      if (sha && sha !== m.sha256) bad.push("체크섬이 달라요(받는 중에 깨졌을 수 있어요)");
      if (d.meta.updated !== m.updated) bad.push("데이터 날짜가 메타와 달라요");
      if (n !== m.rows) bad.push("가격 수가 메타와 달라요");
      if (Array.isArray(d.branches) && d.branches.length !== m.branches) bad.push("지점 수가 메타와 달라요");
    }
    return bad;
  }

  const days = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

  // the state the screen shows. s: {have (data in use), loading (a download running), fromCache (data came from the
  // phone), metaOk (data-meta.json was reached), newer (a newer version is downloading or waiting), failed (last try
  // failed), updated (data date), today, stale (branches kept from an older run), branches}
  // → LOADING · PARTIALLY_READY · READY · STALE · PARTIALLY_FAILED · ERROR, plus offline (true when only the phone's copy
  // is shown because the server could not be reached)
  function stateOf(s) {
    if (!s.have) return { state: s.loading ? "LOADING" : "ERROR", offline: false };
    const offline = !!(s.fromCache && !s.metaOk);
    if (s.newer && s.loading) return { state: "PARTIALLY_READY", offline };
    const old = s.updated && s.today && days(s.updated, s.today) > STALE_DAYS;
    if (offline || old) return { state: "STALE", offline };
    if (s.stale > 0) return { state: "PARTIALLY_FAILED", offline };
    return { state: "READY", offline };
  }

  // Korean line for the header / data screen
  function label(st, s) {
    const pct = s.total ? Math.min(99, Math.floor((s.got / s.total) * 100)) : null;
    switch (st.state) {
      case "LOADING": return pct != null ? `가격 받는 중 ${pct}%` : "가격 받는 중";
      case "PARTIALLY_READY": return pct != null ? `저장된 가격 표시 중 · 새 가격 받는 중 ${pct}%` : "저장된 가격 표시 중 · 새 가격 받는 중";
      case "STALE": return st.offline ? "저장된 가격 (연결 안 됨)" : `오래된 가격 (${s.updated})`;
      case "PARTIALLY_FAILED": return `${s.stale}곳은 지난 가격`;
      case "READY": return "최신";
      default: return "가격을 불러오지 못함";
    }
  }

  // the versions to keep in the phone's cache: the one in use and at most one more (the last good one)
  function prune(versions, keep) { return versions.filter((v) => !keep.includes(v)); }

  return { SCHEMA, STALE_DAYS, RETRY_MS, checkMeta, checkData, stateOf, label, prune, days };
});
