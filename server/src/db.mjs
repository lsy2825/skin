// Database access: every write is a commerce_* function (supabase/monetization.sql), called with the service role through
// PostgREST (/rest/v1/rpc/<fn> with {p: …}). The service role key lives only in the server's secret store.
export function postgrestRpc({ url, serviceKey, fetch: f = fetch }) {
  return async function rpc(fn, p) {
    if (!/^commerce_[a-z_]+$/.test(fn)) throw new Error("not a commerce function");
    const r = await f(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ p }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((body && body.message) || `rpc ${fn} ${r.status}`); e.detail = body && body.details; throw e; }
    return body;
  };
}
