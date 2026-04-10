import type { Env, RunSummary } from "./lib/types";
import { runScrape } from "./lib/runner";

type ScrapeJobRecord = {
  id: string;
  mode: "all" | "one";
  accountId: string | null;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  result: RunSummary | null;
  error: string | null;
};

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

function hasValidRunToken(request: Request, env: Env): boolean {
  const headerToken = request.headers.get("x-run-token");
  return !!env.SCRAPER_RUN_TOKEN && headerToken === env.SCRAPER_RUN_TOKEN;
}

function makeJobId(): string {
  return `scrape_${crypto.randomUUID().slice(0, 8)}`;
}

async function putCurrentJob(env: Env, job: ScrapeJobRecord): Promise<void> {
  await env.DB.put("scraper:current_job", JSON.stringify(job));
}

async function runAndTrackJob(
  env: Env,
  opts?: { accountId?: string }
): Promise<RunSummary> {
  const startedAt = new Date().toISOString();

  const job: ScrapeJobRecord = {
    id: makeJobId(),
    mode: opts?.accountId ? "one" : "all",
    accountId: opts?.accountId ?? null,
    status: "running",
    startedAt,
    finishedAt: null,
    result: null,
    error: null
  };

  await putCurrentJob(env, job);

  try {
    const summary = await runScrape(env, opts);

    await putCurrentJob(env, {
      ...job,
      status: "completed",
      finishedAt: summary.finishedAt,
      result: summary,
      error: null
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    await putCurrentJob(env, {
      ...job,
      status: "failed",
      finishedAt: new Date().toISOString(),
      result: null,
      error: message
    });

    throw error;
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
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

    if (url.pathname === "/progress" && request.method === "GET") {
      const data = await env.DB.get("scraper:progress", { type: "json" });
      return json(data || { progressPercent: 0, totalAccounts: 0, processed: 0, status: "idle" });
    }

    if (url.pathname === "/current-job" && request.method === "GET") {
      const data = await env.DB.get("scraper:current_job", { type: "json" });
      return json(
        data || {
          id: null,
          mode: null,
          accountId: null,
          status: "idle",
          startedAt: null,
          finishedAt: null,
          result: null,
          error: null
        }
      );
    }

    if (url.pathname === "/run" && request.method === "POST") {
      if (!hasValidRunToken(request, env)) return unauthorized();
      const summary = await runAndTrackJob(env);
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

      const summary = await runAndTrackJob(env, { accountId });
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
    ctx.waitUntil(runAndTrackJob(env));
  }
};
