import type { Env } from "./lib/types";
import { runScrape } from "./lib/runner";

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    ...init
  });
}

function unauthorized() {
  return json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function hasValidRunToken(request: Request, env: Env & { SCRAPER_RUN_TOKEN?: string }): boolean {
  const headerToken = request.headers.get("x-run-token");
  return !!env.SCRAPER_RUN_TOKEN && headerToken === env.SCRAPER_RUN_TOKEN;
}

export default {
  async fetch(
    request: Request,
    env: Env & { SCRAPER_RUN_TOKEN?: string },
    ctx: ExecutionContext
  ): Promise<Response> {
    void ctx;

    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "ops-scraper",
        now: new Date().toISOString()
      });
    }

    if (url.pathname === "/run" && request.method === "POST") {
      if (!hasValidRunToken(request, env)) return unauthorized();
      const summary = await runScrape(env);
      return json(summary);
    }

    if (url.pathname === "/run-one" && request.method === "POST") {
      if (!hasValidRunToken(request, env)) return unauthorized();

      let body: { accountId?: string } = {};
      try {
        body = await request.json();
      } catch {}

      const accountId = String(body.accountId || "").trim();
      if (!accountId) {
        return json({ ok: false, error: "accountId is required" }, { status: 400 });
      }

      const summary = await runScrape(env, { accountId });
      return json(summary);
    }

    return json({ ok: false, error: "not_found" }, { status: 404 });
  },

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    void event;
    ctx.waitUntil(runScrape(env));
  }
};
