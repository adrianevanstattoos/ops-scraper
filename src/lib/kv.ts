import { flattenActiveAccounts, findAccountJobById } from "./flatten";
import {
  getClients,
  getSeen,
  getSettings,
  putSeen,
  updateLastSyncedAt,
  getScrapeMeta,
  putScrapeMeta,
  getLatestCache,
  putLatestCache
} from "./kv";
import type { AccountJob, AccountRunResult, Env, RunSummary } from "./types";
import { getLatestContentForAccount } from "../platforms";

const INSTAGRAM_DELAY_MIN_MS = 2500;
const INSTAGRAM_DELAY_MAX_MS = 4500;
const INSTAGRAM_FAILURE_DELAY_MS = 8000;

const INSTAGRAM_MIN_RECHECK_MS = 45 * 60 * 1000;
const TIKTOK_MIN_RECHECK_MS = 20 * 60 * 1000;
const YOUTUBE_MIN_RECHECK_MS = 20 * 60 * 1000;
const FACEBOOK_MIN_RECHECK_MS = 30 * 60 * 1000;

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

function getMinRecheckMs(platform: string): number {
  if (platform === "instagram") return INSTAGRAM_MIN_RECHECK_MS;
  if (platform === "tiktok") return TIKTOK_MIN_RECHECK_MS;
  if (platform === "youtube") return YOUTUBE_MIN_RECHECK_MS;
  if (platform === "facebook") return FACEBOOK_MIN_RECHECK_MS;
  return 30 * 60 * 1000;
}

function shouldSkipRecentAttempt(lastAttemptAt: string | null, platform: string): boolean {
  if (!lastAttemptAt) return false;
  const t = new Date(lastAttemptAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < getMinRecheckMs(platform);
}

function getCacheTtlMs(platform: string): number {
  if (platform === "instagram") return 45 * 60 * 1000;
  if (platform === "tiktok") return 15 * 60 * 1000;
  if (platform === "youtube") return 15 * 60 * 1000;
  if (platform === "facebook") return 20 * 60 * 1000;
  return 15 * 60 * 1000;
}

function isFreshCache(savedAt: string | null, platform: string): boolean {
  if (!savedAt) return false;
  const t = new Date(savedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < getCacheTtlMs(platform);
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
  const cached = await getLatestCache(env, account.platform, account.accountId);

  let latest = null;

  if (cached && isFreshCache(cached.savedAt || null, account.platform)) {
    latest = cached.data;
  } else {
    latest = await getLatestContentForAccount(account);

    if (latest?.latestContentUrl) {
      await putLatestCache(env, account.platform, account.accountId, latest);
    }
  }

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
    summary.results.push({
      accountId: opts?.accountId || "",
      clientName: "",
      platform: "instagram",
      handle: "",
      status: "skipped",
      reason: "sync_disabled"
    });
    return summary;
  }

  let jobs: AccountJob[] = [];

  if (opts?.accountId) {
    const one = findAccountJobById(clients, settings, opts.accountId);
    if (!one) {
      summary.ok = false;
      summary.finishedAt = new Date().toISOString();
      summary.results.push({
        accountId: opts.accountId,
        clientName: "",
        platform: "instagram",
        handle: "",
        status: "failed",
        reason: "account_not_found_or_not_active"
      });
      summary.failed = 1;
      return summary;
    }
    jobs = [one];
  } else {
    jobs = flattenActiveAccounts(clients, settings);
  }

  summary.totalAccounts = jobs.length;

  for (let i = 0; i < jobs.length; i++) {
    const account = jobs[i];
    const scrapeMeta = await getScrapeMeta(env, account.accountId);

    if (shouldSkipRecentAttempt(scrapeMeta?.lastAttemptAt || null, account.platform)) {
      summary.skipped += 1;
      summary.results.push({
        accountId: account.accountId,
        clientName: account.clientName,
        platform: account.platform,
        handle: account.handle,
        status: "skipped",
        reason: "cooldown_active"
      });
      continue;
    }

    await putScrapeMeta(env, account.accountId, {
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: scrapeMeta?.lastSuccessAt || null,
      lastStatus: "attempted",
      lastLatestContentUrl: scrapeMeta?.lastLatestContentUrl || null
    });

    try {
      await maybePauseBeforeAccount(account);

      summary.checked += 1;
      const result = await runOneAccount(env, account, settings.dry_run);
      summary.results.push(result);

      if (result.status === "updated") summary.updated += 1;
      if (result.status === "unchanged") summary.unchanged += 1;
      if (result.status === "skipped") summary.skipped += 1;

      const latestUrl =
        "latestUrl" in result && result.latestUrl
          ? result.latestUrl
          : scrapeMeta?.lastLatestContentUrl || null;

      await putScrapeMeta(env, account.accountId, {
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastStatus: result.status,
        lastLatestContentUrl: latestUrl
      });
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

      await putScrapeMeta(env, account.accountId, {
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: scrapeMeta?.lastSuccessAt || null,
        lastStatus: "failed",
        lastLatestContentUrl: scrapeMeta?.lastLatestContentUrl || null
      });

      await maybePauseAfterFailure(account, reason);
    }
  }

  const finishedAt = new Date().toISOString();
  summary.finishedAt = finishedAt;

  if (!settings.dry_run) {
    await updateLastSyncedAt(env, settings, finishedAt);
  }

  return summary;
}
