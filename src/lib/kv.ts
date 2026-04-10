import type {
  AccountJob,
  ClientRecord,
  Env,
  QueueItem,
  SeenRecord,
  SettingsRecord,
} from "../types";

export async function getClients(env: Env): Promise<ClientRecord[]> {
  const raw = await env.DB.get("clients");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getSettings(env: Env): Promise<SettingsRecord> {
  const raw = await env.DB.get("settings");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function putSettings(env: Env, settings: SettingsRecord): Promise<void> {
  await env.DB.put("settings", JSON.stringify(settings));
}

export function flattenActiveAccounts(
  clients: ClientRecord[],
  settings: SettingsRecord,
  targetAccountId?: string | null
): AccountJob[] {
  const allowedPlatforms = new Set(
    Array.isArray(settings.default_platforms) && settings.default_platforms.length
      ? settings.default_platforms
      : ["instagram", "youtube", "tiktok", "facebook"]
  );

  const jobs: AccountJob[] = [];

  for (const client of clients) {
    if (client.active === false) continue;
    const accounts = Array.isArray(client.accounts) ? client.accounts : [];

    for (const account of accounts) {
      if (account.active === false) continue;
      if (!account.profileUrl) continue;
      if (!allowedPlatforms.has(account.platform)) continue;
      if (targetAccountId && account.id !== targetAccountId) continue;

      jobs.push({
        clientId: client.id,
        clientName: client.name,
        accountId: account.id,
        platform: account.platform,
        handle: account.handle,
        profileUrl: account.profileUrl,
        package: client.package,
      });
    }
  }

  return jobs;
}

export async function getSeen(env: Env, accountId: string): Promise<SeenRecord | null> {
  const raw = await env.DB.get(`seen:${accountId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function putSeen(env: Env, accountId: string, value: SeenRecord): Promise<void> {
  await env.DB.put(`seen:${accountId}`, JSON.stringify(value));
}

export async function getQueue(env: Env): Promise<QueueItem[]> {
  const raw = await env.DB.get("queue");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function putQueue(env: Env, items: QueueItem[]): Promise<void> {
  await env.DB.put("queue", JSON.stringify(items));
}

export async function enqueueIfNew(env: Env, item: QueueItem): Promise<boolean> {
  const queue = await getQueue(env);

  const alreadyQueued = queue.some(
    (q) =>
      q.accountId === item.accountId &&
      q.postUrl === item.postUrl &&
      q.status !== "completed"
  );

  if (alreadyQueued) return false;

  queue.unshift(item);
  await putQueue(env, queue);
  return true;
}
