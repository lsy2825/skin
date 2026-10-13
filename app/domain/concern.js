// Skin-concern discovery: rule-based classification of a free-text concern. No DOM, no network, no storage.
// Loaded as window.Concern in the app, require()d in tests/concern.test.js.
//
// What it does: safety check (warning signs → see a clinician first) → personal-decision check (diagnosis, "which one
// suits me", dose → only clinicians decide) → map the words to concerns of knowledge/concerns.json by their synonyms.
// What it never does: generate medical text, diagnose, judge suitability, decide doses, rank treatments or clinics.
// The text is used once, here, in memory; the caller must not store it or put it in the URL.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Concern = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_LEN = 200;
  // Korean particles / endings that may follow a one-syllable word ('점이', '털을', '땀때문에')
  const TAIL = /^(이|가|을|를|은|는|도|만|이랑|랑|때문에|빼기|빼고|제거|이너무|너무|많|이많|이많아요|이많아)?$/;

  const squash = (s) => String(s || "").toLowerCase().replace(/[\s.,!?·~'"“”‘’()\[\]{}<>/\\|:;_-]+/g, "");
  const tokens = (s) => String(s || "").toLowerCase().split(/[\s.,!?·~'"“”‘’()\[\]{}<>/\\|:;_-]+/).filter(Boolean);

  function safety(text, cs) {
    const t = squash(text);
    const out = [];
    for (const r of cs.safety.rules) if (new RegExp(r.pattern).test(t)) out.push({ id: r.id, level: r.level, title: r.title, message: r.message });
    return out.sort((a, b) => (a.level === "emergency" ? 0 : 1) - (b.level === "emergency" ? 0 : 1));
  }

  const personal = (text, cs) => new RegExp(cs.safety.personal.pattern).test(squash(text));

  // a synonym hits when its spaceless form is in the spaceless text; one-syllable synonyms only as a whole word
  function hits(text, syns) {
    const t = squash(text), toks = tokens(text);
    const found = syns.map(squash).filter((s) => s && (s.length > 1 ? t.includes(s) : toks.some((w) => w.startsWith(s) && TAIL.test(w.slice(s.length)))));
    // keep only the longest of overlapping hits ('이마주름' counts once, not also as '주름')
    return found.filter((s) => !found.some((o) => o !== s && o.length > s.length && o.includes(s)));
  }

  function classify(text, cs) {
    const raw = String(text || "");
    const clipped = raw.length > MAX_LEN;
    const t = clipped ? raw.slice(0, MAX_LEN) : raw;
    const matches = cs.concerns.map((c) => { const h = hits(t, c.synonyms); return { id: c.id, hits: h, score: h.reduce((a, s) => a + s.length, 0) }; })
      .filter((m) => m.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    return { clipped, safety: safety(t, cs), personal: personal(t, cs), matches, empty: !squash(t) };
  }

  return { MAX_LEN, squash, safety, personal, hits, classify };
});
