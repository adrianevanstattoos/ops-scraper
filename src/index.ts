import type {
  AccountJob,
  AccountRunResult,
  Env,
  QueueItem,
  RunSummary,
} from "./types";
import { appendJobError, calcProgress, createJob, patchJob } from "./lib/jobs";
import {
  enqueueIfNew,
  flattenActiveAccounts,
  getClients,
  getSeen,
  getSettings,
  putSeen,
  putSettings,
} from "./lib/kv";
import { getLatestForPlatform } from "./platforms";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function getJobId(): string {
  return `scrape_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

async function processAccount(
  env: Env,
  account: AccountJob,
  opts: { dryRun?: boolean } = {}
): Promise<AccountRunResult> {
  const latest = await getLatestForPlatform(env, account);

  if (!latest.ok || !latest.postUrl) {
    return {
      accountId: account.accountId,
      clientId: account.clientId,
      clientName: account.clientName,
      platform: account.platform,
      handle: account.handle,
      profileUrl: account.profileUrl,
      status: "skipped",
      reason: latest.reason || "no_latest_content_found",
      source: latest.source || "unknown",
    };
  }

  const seen = await getSeen(env, account.accountId);

  if (seen?.lastPostUrl === latest.postUrl) {
    return {
      accountId: account.accountId,
      clientId: account.clientId,
      clientName: account.clientName,
      platform: account.platform,
      handle: account.handle,
      profileUrl: account.profileUrl,
      status: "unchanged",
      postUrl: latest.postUrl,
      postId: latest.postId || null,
      source: latest.source || "unknown",
    };
  }

  if (!opts.dryRun) {
    const queueItem: QueueItem = {
      id: crypto.randomUUID(),
      accountId: account.accountId,
      clientId: account.clientId,
      clientName: account.clientName,
      platform: account.platform,
      handle: account.handle,
      profileUrl: account.profileUrl,
      postUrl: latest.postUrl,
      createdAt: new Date().toISOString(),
      status: "pending",
      notes: "Pulled from scraper",
      source: latest.source || "unknown",
    };

    await enqueueIfNew(env, queueItem);

    await putSeen(env, account.accountId, {
      accountId: account.accountId,
      platform: account.platform,
      profileUrl: account.profileUrl,
      lastPostUrl: latest.postUrl,
      lastPostId: latest.postId || null,
      seenAt: new Date().toISOString(),
      source: latest.source || "unknown",
    });
  }

  return {
    accountId: account.accountId,
    clientId: account.clientId,
    clientName: account.clientName,
    platform: account.platform,
    handle: account.handle,
    profileUrl: account.profileUrl,
    status: "updated",
    postUrl: latest.postUrl,
    postId: latest.postId || null,
    source: latest.source || "unknown",
  };
}

async function runScrapeJob(
  env: Env,
  jobId: string,
  accounts: AccountJob[],
  opts: { dryRun?: boolean } = {}
): Promise<RunSummary> {
  const totalAccounts = accounts.length;

  await patchJob(env, jobId, {
    status: "running",
    totalAccounts,
    processed: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    progressPercent: 0,
    statusText: totalAccounts ? `processing 0/${totalAccounts}` : "no accounts",
  });

  const results: AccountRunResult[] = [];
  let processed = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;
  const startedAt = new Date().toISOString();

  try {
    for (const account of accounts) {
      await patchJob(env, jobId, {
        statusText: `processing ${processed + 1}/${totalAccounts}`,
      });

      try {
        const result = await processAccount(env, account, opts);
        results.push(result);

        if (result.status === "updated") updated += 1;
        else if (result.status === "unchanged") unchanged += 1;
        else if (result.status === "skipped") skipped += 1;
        else if (result.status === "failed") failed += 1;
      } catch (error: any) {
        results.push({
          accountId: account.accountId,
          clientId: account.clientId,
          clientName: account.clientName,
          platform: account.platform,
          handle: account.handle,
          profileUrl: account.profileUrl,
          status: "failed",
          error: error?.message || "Unknown account error",
          source: "unknown",
        });

        await appendJobError(env, jobId, {
          at: new Date().toISOString(),
          accountId: account.accountId,
          platform: account.platform,
          message: error?.message || "Unknown account error",
          detail: error?.stack?.slice?.(0, 4000) || String(error),
        });
      }

      processed += 1;
      failed = results.filter((r) => r.status === "failed").length;

      await patchJob(env, jobId, {
        processed,
        updated,
        unchanged,
        skipped,
        failed,
        progressPercent: calcProgress(processed, totalAccounts),
        statusText:
          processed >= totalAccounts
            ? "finalizing"
            : `processing ${processed}/${totalAccounts}`,
      });
    }

    const finishedAt = new Date().toISOString();

    const summary: RunSummary = {
      ok: true,
      startedAt,
      finishedAt,
      totalAccounts,
      checked: processed,
      updated,
      unchanged,
      skipped,
      failed,
      dryRun: !!opts.dryRun,
      results,
    };

    await patchJob(env, jobId, {
      status: "done",
      finishedAt,
      progressPercent: 100,
      statusText: "done",
      error: null,
      result: summary,
    });

    const settings = await getSettings(env);
    settings.last_synced_at = finishedAt;
    await putSettings(env, settings);

    return summary;
  } catch (fatal: any) {
    const finishedAt = new Date().toISOString();

    await patchJob(env, jobId, {
      status: "failed",
      finishedAt,
      progressPercent: calcProgress(processed, totalAccounts),
      statusText: "failed",
      error: fatal?.message || "Fatal job error",
      result: {
        ok: false,
        error: fatal?.message || "Fatal job error",
        results,
      },
    });

    throw fatal;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    try {
      if (url.pathname === "/health") {
        return json({ ok: true });
      }

      if (url.pathname === "/job" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const mode = body?.mode === "account" ? "account" : "all";
        const accountId = typeof body?.accountId === "string" ? body.accountId : null;

        const jobId = getJobId();
        await createJob(env, {
          id: jobId,
          mode,
          accountId,
        });

        const clients = await getClients(env);
        const settings = await getSettings(env);
        const accounts = flattenActiveAccounts(clients, settings, accountId);
        const dryRun = !!settings.dry_run;

        ctx.waitUntil(
          runScrapeJob(env, jobId, accounts, { dryRun }).catch(async (error: any) => {
            try {
              await patchJob(env, jobId, {
                status: "failed",
                finishedAt: new Date().toISOString(),
                statusText: "failed",
                error: error?.message || "Background job failed",
              });
            } catch {}
          })
        );

        return json({
          ok: true,
          id: jobId,
          mode,
          accountId,
          status: "running",
          startedAt: new Date().toISOString(),
          totalAccounts: accounts.length,
          progressPercent: 0,
          processed: 0,
        });
      }

      if (url.pathname.startsWith("/job/") && request.method === "GET") {
        const jobId = url.pathname.split("/").pop() || "";
        const raw = await env.DB.get(`job:${jobId}`);

        if (!raw) {
          return json({ ok: false, error: "Job not found" }, 404);
        }

        return new Response(raw, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      }

      if (url.pathname === "/debug/queue" && request.method === "GET") {
        const raw = await env.DB.get("queue");
        return new Response(raw || "[]", {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error: any) {
      return json(
        {
          ok: false,
          error: error?.message || "Unknown server error",
          detail: error?.stack || null,
        },
        500
      );
    }
  },
};
