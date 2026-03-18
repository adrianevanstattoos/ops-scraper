import { flattenActiveAccounts } from "./flatten";
import { getClients, getSeen, getSettings, putSeen, updateLastSyncedAt } from "./kv";
import type { AccountRunResult, Env, RunSummary } from "./types";
import { getLatestContentForAccount } from "../platforms";

export async function runScrape(env: Env): Promise<RunSummary> {
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
      accountId: "",
      clientName: "",
      platform: "instagram",
      handle: "",
      status: "skipped",
      reason: "sync_disabled"
    });
    return summary;
  }

  const jobs = flattenActiveAccounts(clients, settings);
  summary.totalAccounts = jobs.length;

  for (const account of jobs) {
    let result: AccountRunResult;

    try {
      summary.checked += 1;

      const latest = await getLatestContentForAccount(account);

      if (!latest?.latestContentUrl) {
        result = {
          accountId: account.accountId,
          clientName: account.clientName,
          platform: account.platform,
          handle: account.handle,
          status: "skipped",
          reason: "no_latest_content_found"
        };
        summary.skipped += 1;
        summary.results.push(result);
        continue;
      }

      const existing = await getSeen(env, account.accountId);
      const previousUrl = existing?.postUrl ?? null;
      const latestUrl = latest.latestContentUrl;

      if (previousUrl === latestUrl) {
        result = {
          accountId: account.accountId,
          clientName: account.clientName,
          platform: account.platform,
          handle: account.handle,
          status: "unchanged",
          previousUrl,
          latestUrl
        };
        summary.unchanged += 1;
        summary.results.push(result);
        continue;
      }

      if (!settings.dry_run) {
        await putSeen(env, account.accountId, {
          postUrl: latestUrl,
          seenAt: latest.scrapedAt
        });
      }

      result = {
        accountId: account.accountId,
        clientName: account.clientName,
        platform: account.platform,
        handle: account.handle,
        status: "updated",
        previousUrl,
        latestUrl
      };
      summary.updated += 1;
      summary.results.push(result);
    } catch (error) {
      result = {
        accountId: account.accountId,
        clientName: account.clientName,
        platform: account.platform,
        handle: account.handle,
        status: "failed",
        reason: error instanceof Error ? error.message : "unknown_error"
      };
      summary.failed += 1;
      summary.results.push(result);
      summary.ok = false;
    }
  }

  const finishedAt = new Date().toISOString();
  summary.finishedAt = finishedAt;

  if (!settings.dry_run) {
    await updateLastSyncedAt(env, settings, finishedAt);
  }

  return summary;
}
