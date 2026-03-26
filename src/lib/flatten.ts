import type { AccountJob, ClientRecord, Platform, SettingsRecord } from "./types";

export function flattenActiveAccounts(
  clients: ClientRecord[],
  settings: SettingsRecord
): AccountJob[] {
  const allowed = new Set<Platform>(settings.default_platforms || []);
  const jobs: AccountJob[] = [];

  for (const client of clients) {
    if (!client || client.status !== "active") continue;
    if (!Array.isArray(client.accounts)) continue;

    for (const account of client.accounts) {
      if (!account?.active) continue;
      if (!account.profileUrl?.trim()) continue;
      if (!allowed.has(account.platform)) continue;

      jobs.push({
        clientId: client.id,
        clientName: client.name,
        accountId: account.id,
        platform: account.platform,
        handle: account.handle,
        profileUrl: account.profileUrl
      });
    }
  }

  return jobs;
}

export function findAccountJobById(
  clients: ClientRecord[],
  settings: SettingsRecord,
  accountId: string
): AccountJob | null {
  const jobs = flattenActiveAccounts(clients, settings);
  return jobs.find((job) => job.accountId === accountId) || null;
}
