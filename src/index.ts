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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    void ctx;

    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "ops-scraper",
        now: new Date().toISOString()
      });
    }

    if (url.pathname === "/run" && (request.method === "POST" || request.method === "GET")) {
      const summary = await runScrape(env);
      return json(summary);
    }

    return json(
      {
        ok: false,
        error: "not_found"
      },
      { status: 404 }
    );
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
