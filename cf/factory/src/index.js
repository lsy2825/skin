// 가격 공장 관리자 (yoonsiljang-factory): starts the factory box (Dockerfile → entry.sh → tools/factory.sh) on Cloudflare.
//   every day 06:00 KST (cron)  → weekly   (the box itself decides whether today is a scraping day)
//   a push to the code repo     → rebuild  (Artifacts event → queue; the factory's own saves are skipped)
//   POST /run  {mode, max?}     → manual run, needs  Authorization: Bearer <RUN_SECRET>
//   POST /report                → the box says how its run ended (token good for that run only)
//   GET  /status                → last runs for the app's ops screen (no secrets in it)
// One Durable Object ("main") owns the box, so two runs never overlap — same as GitHub's concurrency group before.
import { DurableObject } from "cloudflare:workers";
import { parseRun, sameSecret, bearer, newRun, closeRun, cleanReport, publicStatus, isOwnCommit, MAX_RUN_MS } from "./runs.js";

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const tokenText = (t) => (typeof t === "string" ? t : t && (t.plaintext || t.token)) || "";

export class Factory extends DurableObject {
  async state() {
    return { current: (await this.ctx.storage.get("current")) || null, runs: (await this.ctx.storage.get("runs")) || [] };
  }

  async start(mode, arg, why) {
    const { current } = await this.state();
    const box = this.ctx.container;
    if (current || box.running) return { started: false, reason: "a run is already going", current: publicStatus(current, []).current };
    // a short-lived write token for this run only (expires by itself after 2 hours)
    using repo = await this.env.ARTIFACTS.get(this.env.REPO_NAME);
    const remote = (await repo.info()).remote;
    const gitToken = tokenText(await repo.createToken("write", 7200));
    const run = { ...newRun(hex(8), mode, arg, why), token: hex(32) };
    await this.ctx.storage.put("current", run);
    box.start({
      image: box.images.factory,
      instance: this.env.INSTANCE || "basic",
      enableInternet: true,   // the scrapers read the clinics' public price pages
      env: {
        MODE: mode, ARG: arg, RUN_ID: run.id, RUN_TOKEN: run.token, REPORT_URL: `${this.env.FACTORY_URL}/report`,
        ARTIFACTS_REMOTE: remote, ARTIFACTS_TOKEN: gitToken,
        CLOUDFLARE_API_TOKEN: this.env.DRY_RUN === "1" ? "" : this.env.CF_DEPLOY_TOKEN || "",
        CLOUDFLARE_ACCOUNT_ID: this.env.CF_ACCOUNT_ID || "",
        FACTORY_NO_PUSH: this.env.DRY_RUN === "1" ? "1" : "",
      },
    });
    this.ctx.waitUntil(box.monitor().then(
      () => this.end(run.id, { state: "stopped", step: "exit 0 without a report" }),
      (e) => this.end(run.id, { state: "failed", step: `exit ${e && e.exitCode !== undefined ? e.exitCode : "?"}` })));
    await this.ctx.storage.setAlarm(Date.now() + 10 * 60e3);
    return { started: true, id: run.id };
  }

  // the box's report wins; monitor()/alarm only close a run that never reported
  async end(id, fields) {
    const { current, runs } = await this.state();
    if (!current || current.id !== id) return false;
    const next = closeRun(current, runs, fields);
    await this.ctx.storage.put("runs", next.runs);
    await this.ctx.storage.delete("current");
    return true;
  }

  async report(token, body) {
    const { current } = await this.state();
    if (!current || !sameSecret(token, current.token) || body.run !== current.id) return false;
    return this.end(current.id, cleanReport(body));
  }

  async alarm() {
    const { current } = await this.state();
    if (!current) return;
    const box = this.ctx.container;
    if (!box.running) return void (await this.end(current.id, { state: "stopped", step: "box stopped without a report" }));
    if (Date.now() - Date.parse(current.startedAt) > MAX_RUN_MS) {
      await box.destroy("time limit");
      return void (await this.end(current.id, { state: "failed", step: "time limit (100 min)" }));
    }
    await this.ctx.storage.setAlarm(Date.now() + 10 * 60e3);
  }

  async status() {
    const { current, runs } = await this.state();
    return publicStatus(current, runs);
  }
}

const factory = (env) => env.FACTORY.getByName("main");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status")
      return json(await factory(env).status(), 200, { "access-control-allow-origin": "*", "cache-control": "no-store" });
    if (request.method === "POST" && url.pathname === "/run") {
      if (!sameSecret(bearer(request), env.RUN_SECRET || "")) return json({ error: "unauthorized" }, 401);
      const ask = parseRun(await request.json().catch(() => null));
      if (ask.error) return json(ask, 400);
      const r = await factory(env).start(ask.mode, ask.arg, "manual");
      return json(r, r.started ? 202 : 409);
    }
    if (request.method === "POST" && url.pathname === "/report") {
      const ok = await factory(env).report(bearer(request), (await request.json().catch(() => null)) || {});
      return json({ ok }, ok ? 200 : 403);
    }
    return json({ error: "not found" }, 404);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(factory(env).start("weekly", "", "schedule"));
  },

  // Artifacts "pushed" events arrive through the queue; any of them means "the code may have changed"
  async queue(batch, env) {
    try {
      using repo = await env.ARTIFACTS.get(env.REPO_NAME);
      const [head] = await repo.log({ ref: "main", limit: 1 });
      if (head && !isOwnCommit(head)) await factory(env).start("rebuild", "", "push");
    } finally {
      batch.ackAll();
    }
  },
};
