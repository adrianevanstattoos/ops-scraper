import { flattenActiveAccounts, findAccountJobById } from "./flatten";
import { getClients, getSettings, putSeen, updateLastSyncedAt } from "./kv";
import type { AccountJob, AccountRunResult, Env, RunSummary } from "./types";
import { getLatestContentForAccount } from "../platforms";

const INSTAGRAM_DELAY_MIN_MS = 2500;
const INSTAGRAM_DELAY_MAX_MS = 4500;
const INSTAGRAM_FAILURE_DELAY_MS = 8000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isInstagramRateLimitError(message: string): boolean {
  const msg = String(message || "").toLowerCase();
  return msg.includes("429") || msg.includes("rate limit");
}

// NEW: Progress tracking in KV
async function updateProgress(env: Env, progress: number, total: number, status: string) {
  await env.DB.put("scraper:progress", JSON.stringify({
    progressPercent: progress,
    totalAccounts: total,
    processed: Math.round((progress / 100) * total),
    status,
    updatedAt: new Date().toISOString()
  }), { expirationTtl: 300 }); // expires after 5 min
}

async function maybePauseBeforeAccount(account: AccountJob): Promise<void> {
  if (account.platform !== "instagram") return;
  const delay = randomInt(INSTAGRAM_DELAY_MIN_MS, INSTAGRAM_DELAY_MAX_MS);
  await sleep(delay);
}

async function maybePauseAfterFailure(account: AccountJob, errorMessage: string): Promise<void> {
  if (account.platform !== "instagram") return;
  if (isInstagramRateLimitError(errorMessage)) {
    await sleep(INSTAGRAM_FAILURE_DELAY_MS);
  }
}

async function runOneAccount(
  env: Env,
  account: AccountJob,
  dryRun: boolean
): Promise<AccountRunResult> {
  const latest = await getLatestContentForAccount(account, env);   // ← fixed + env passed

  if (!latest?.latestContentUrl) {
    return {
      accountId: account.accountId,
      clientName: account.clientName,
      platform: account.platform,
      handle: account.handle,
      status: "skipped",
      reason: "no_latest_content_found"
    };
  }

  const existing = await getSeen(env, account.accountId);
  const previousUrl = existing?.postUrl ?? null;
  const latestUrl = latest.latestContentUrl;

  if (previousUrl === latestUrl) {
    return {
      accountId: account.accountId,
      clientName: account.clientName,
      platform: account.platform,
      handle: account.handle,
      status: "unchanged",
      previousUrl,
      latestUrl
    };
  }

  if (!dryRun) {
    await putSeen(env, account.accountId, {
      postUrl: latestUrl,
      seenAt: latest.scrapedAt
    });
  }

  return {
    accountId: account.accountId,
    clientName: account.clientName,
    platform: account.platform,
    handle: account.handle,
    status: "updated",
    previousUrl,
    latestUrl
  };
}

export async function runScrape(
  env: Env,
  opts?: { accountId?: string }
): Promise<RunSummary> {
  const startedAt = new Date().toISOString();

  await updateProgress(env, 0, 0, "starting");

  const clients = await getClients(env);
  const settings = await getSettings(env);

  const summary: RunSummary = {
    ok: true,
    startedAt,
    finishedAt: startedAt,
    totalAccounts: 0,
    checked: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    dryRun: settings.dry_run,
    results: []
  };

  if (!settings.sync_enabled) {
    summary.finishedAt = new Date().toISOString();
    await updateProgress(env, 100, 0, "skipped (sync disabled)");
    return summary;
  }

  let jobs: AccountJob[] = [];

  if (opts?.accountId) {
    const one = findAccountJobById(clients, settings, opts.accountId);
    if (!one) {
      summary.ok = false;
      summary.finishedAt = new Date().toISOString();
      await updateProgress(env, 100, 0, "failed (account not found)");
      return summary;
    }
    jobs = [one];
  } else {
    jobs = flattenActiveAccounts(clients, settings);
  }

  summary.totalAccounts = jobs.length;

  for (let i = 0; i < jobs.length; i++) {
    const account = jobs[i];
    const percent = Math.round(((i + 1) / jobs.length) * 100);

    try {
      await maybePauseBeforeAccount(account);
      await updateProgress(env, percent, jobs.length, `processing ${i + 1}/${jobs.length}`);

      summary.checked += 1;
      const result = await runOneAccount(env, account, settings.dry_run);
      summary.results.push(result);

      if (result.status === "updated") summary.updated += 1;
      if (result.status === "unchanged") summary.unchanged += 1;
      if (result.status === "skipped") summary.skipped += 1;
    } catch (error) {
      summary.ok = false;
      summary.failed += 1;

      const reason = error instanceof Error ? error.message : "unknown_error";
      summary.results.push({
        accountId: account.accountId,
        clientName: account.clientName,
        platform: account.platform,
        handle: account.handle,
        status: "failed",
        reason
      });

      await maybePauseAfterFailure(account, reason);
    }
  }

  const finishedAt = new Date().toISOString();
  summary.finishedAt = finishedAt;

  if (!settings.dry_run) {
    await updateLastSyncedAt(env, settings, finishedAt);
  }

  await updateProgress(env, 100, jobs.length, summary.ok ? "completed" : "completed with errors");
  return summary;
}
