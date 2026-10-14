// Optional sign-in (Google / Kakao) and sync of 내정보 through Supabase. Off unless app/config.js has the keys.
// Tables and row security: supabase/schema.sql. The app calls window.Auth; everything works without it.
(function () {
  "use strict";
  const cfg = window.APP_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  // supabase-js 2.45.4 (MIT), copied into the repo from the npm package so no third-party script runs (CSP: script-src 'self')
  const SDK = "vendor/supabase/supabase.js";
  let sb = null, user = null, ready = null;
  const listeners = [];
  const emit = () => listeners.forEach((f) => { try { f(user); } catch (e) { console.error(e); } });

  function load() {
    if (!enabled) return Promise.resolve(null);
    if (ready) return ready;
    ready = new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = SDK; s.async = true;
      s.onload = () => ok(); s.onerror = () => bad(new Error("로그인 모듈을 불러오지 못했어요"));
      document.head.append(s);
    }).then(async () => {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
      const { data } = await sb.auth.getSession();
      user = data.session ? data.session.user : null;
      sb.auth.onAuthStateChange((_e, session) => { user = session ? session.user : null; emit(); });
      emit();
      return sb;
    });
    return ready;
  }

  const providerName = (u) => (u && u.app_metadata && u.app_metadata.provider) || "";
  window.Auth = {
    enabled,
    // Supabase OAuth providers the app is laid out for; each needs its own keys in the Supabase dashboard (docs/로그인_설정.md)
    providers: (cfg.providers || ["kakao", "google"]).filter((p) => p === "kakao" || p === "google" || p === "apple"),
    get user() { return user; },
    providerName,
    onChange(f) { listeners.push(f); },
    init: load,
    async signIn(provider) {
      await load();
      const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
      if (error) throw error;
    },
    // logout revokes this device's refresh token on the server (not just a local flag), so a copied token stops working
    // once its short-lived access token (Supabase JWT expiry, 1 h by default) runs out
    async signOut() { await load(); await sb.auth.signOut({ scope: "local" }); },
    // server copy of profile + records (null when signed out)
    async pull() {
      await load();
      if (!user) return null;
      const [p, r] = await Promise.all([
        sb.from("profiles").select("nick,gender,age_band,updated_at").eq("id", user.id).maybeSingle(),
        sb.from("records").select("id,done_on,procedure,brand,branch,price,memo").eq("user_id", user.id).order("done_on", { ascending: false }),
      ]);
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      return { profile: p.data, records: r.data || [] };
    },
    async saveProfile(me) {
      await load();
      if (!user) return;
      const { error } = await sb.from("profiles").upsert({ id: user.id, nick: me.nick || null, gender: me.gender || null, age_band: me.age || null, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    async saveRecords(recs) {
      await load();
      if (!user || !recs.length) return;
      const rows = recs.map((x) => ({ id: x.id, user_id: user.id, done_on: x.date, procedure: x.n, brand: x.br.split("|")[0], branch: x.br.split("|")[1] || "", price: x.p || null, memo: x.memo || null }));
      const { error } = await sb.from("records").upsert(rows);
      if (error) throw error;
    },
    async deleteRecord(id) {
      await load();
      if (!user) return;
      const { error } = await sb.from("records").delete().eq("id", id).eq("user_id", user.id);
      if (error) throw error;
    },
    // carts: [{id, name, items:[{t,k,n,br,q,sp,ov}]}] <-> carts + cart_items (supabase/schema.sql)
    async pullCarts() {
      await load();
      if (!user) return [];
      const { data, error } = await sb.from("carts").select("id,name,updated_at,cart_items(position,kind,key_code,row_name,branch_key,qty,special,overrides)").eq("user_id", user.id);
      if (error) throw error;
      return (data || []).map((c) => ({ id: c.id, name: c.name, updated: c.updated_at,
        items: (c.cart_items || []).sort((a, b) => a.position - b.position).map((x) => (x.kind === "k"
          ? { t: "k", k: x.key_code, q: x.qty, sp: x.special ?? undefined, ov: x.overrides || {} }
          : { t: "r", n: x.row_name, br: x.branch_key, q: x.qty, sp: x.special ?? undefined, ov: x.overrides || {} })) }));
    },
    async saveCart(c) {
      await load();
      if (!user || !c.id) return;
      let r = await sb.from("carts").upsert({ id: c.id, user_id: user.id, name: c.name, updated_at: new Date().toISOString() });
      if (r.error) throw r.error;
      r = await sb.from("cart_items").delete().eq("cart_id", c.id);
      if (r.error) throw r.error;
      if (!c.items.length) return;
      r = await sb.from("cart_items").insert(c.items.map((it, i) => ({ cart_id: c.id, position: i, kind: it.t, key_code: it.t === "k" ? it.k : null,
        row_name: it.t === "r" ? it.n : null, branch_key: it.t === "r" ? it.br : null, qty: it.q || 1, special: it.sp ?? null, overrides: it.ov || {} })));
      if (r.error) throw r.error;
    },
    async deleteCart(id) { await load(); if (!user) return; const { error } = await sb.from("carts").delete().eq("id", id).eq("user_id", user.id); if (error) throw error; },
    // removes the profile, records and the login itself (supabase/schema.sql: delete_me)
    async deleteAccount() {
      await load();
      if (!user) return;
      const { error } = await sb.rpc("delete_me");
      if (error) throw error;
      await sb.auth.signOut();
    },
  };
  if (enabled) load().catch((e) => console.warn(e));
})();
