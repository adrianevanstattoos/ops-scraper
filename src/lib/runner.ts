import { flattenActiveAccounts, findAccountJobById } from "./flatten";
import { getClients, getSeen, getSettings, putSeen, updateLastSyncedAt } from "./kv";
import type { AccountJob, AccountRunResult, Env, RunSummary } from "./types";
import { getLatestContentForAccount } from "../platforms";

async function runOneAccount(
  env: Env,
  account: AccountJob,
  dryRun: boolean
): Promise<AccountRunResult> {
  const latest = await getLatestContentForAccount(account);

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

  for (const account of jobs) {
    try {
      summary.checked += 1;
      const result = await runOneAccount(env, account, settings.dry_run);
      summary.results.push(result);

      if (result.status === "updated") summary.updated += 1;
      if (result.status === "unchanged") summary.unchanged += 1;
      if (result.status === "skipped") summary.skipped += 1;
    } catch (error) {
      summary.ok = false;
      summary.failed += 1;
      summary.results.push({
        accountId: account.accountId,
        clientName: account.clientName,
        platform: account.platform,
        handle: account.handle,
        status: "failed",
        reason: error instanceof Error ? error.message : "unknown_error"
      });
    }
  }

  const finishedAt = new Date().toISOString();
  summary.finishedAt = finishedAt;

  if (!settings.dry_run) {
    await updateLastSyncedAt(env, settings, finishedAt);
  }

  return summary;
}
