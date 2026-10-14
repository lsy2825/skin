// Test helper: a throwaway PostgreSQL database with the Supabase stand-in, the platform schema, the access policies and
// the 5.0 commerce schema + seed (each applied twice: the files must be idempotent). Never points at a real database.
import { execFileSync } from "node:child_process";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILES = ["tests/db/supabase_stub.sql", "supabase/schema_platform.sql", "supabase/schema.sql", "supabase/DATABASE_ACCESS_POLICIES.sql",
  "supabase/monetization.sql", "supabase/monetization.sql", "supabase/commerce_seed.sql", "supabase/commerce_seed.sql"];
const psql = (args) => execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" }, stdio: ["ignore", "ignore", "pipe"] });

export async function freshDb(name) {
  const db = `skin_${name}_${process.pid}`;
  psql(["-d", "postgres", "-c", `drop database if exists ${db}`, "-c", `create database ${db}`]);
  for (const f of FILES) psql(["-d", db, "-f", path.join(ROOT, f)]);
  const pool = new pg.Pool({ database: db, max: 12, user: process.env.PGUSER || (await import("node:os")).userInfo().username, host: process.env.PGHOST || "/var/run/postgresql" });
  const drop = async () => { await pool.end(); psql(["-d", "postgres", "-c", `drop database if exists ${db}`]); };
  // service_role call of a commerce function, the way the API calls it through PostgREST (/rpc/<fn> with {p: …})
  const call = async (fn, p, client = pool) => {
    const c = client === pool ? await pool.connect() : client;
    try {
      await c.query("begin"); await c.query("set local role service_role");
      const r = await c.query(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(p)]);
      await c.query("commit");
      return r.rows[0].r;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { if (client === pool) c.release(); }
  };
  // a signed-in user's own query (RLS applies), like the browser through PostgREST
  const asUser = async (uid, sql, params = []) => {
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
      const r = await c.query(sql, params); await c.query("commit"); return r.rows;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  };
  const newUser = async () => { const r = await pool.query("insert into auth.users (id) values (gen_random_uuid()) returning id"); return r.rows[0].id; };
  return { pool, call, asUser, newUser, drop, name: db };
}
