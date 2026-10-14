// Builds the search index (domain/search.js buildIndex: normalized names + vocabulary) off the main thread, right after
// the price data is in, so the first search does not spend ~1.4 s on a slow phone building it (round-2 O3). Same
// function, same input as the app's own fallback in searchIndex(); the result is plain data (strings, numbers).
/* global importScripts */
importScripts("../domain/search.js");
self.onmessage = (e) => {
  const { id, names, extra } = e.data || {};
  try { self.postMessage({ id, ok: true, idx: self.Search.buildIndex(names || [], extra || []) }); }
  catch (err) { self.postMessage({ id, ok: false }); }
};
