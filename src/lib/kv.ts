import type { Env } from "./types";

/**
 * Base helpers
 */
async function getJson<T>(env: Env, key: string, fallback: T): Promise<T> {
  const raw = await env.DB.get(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function putJson(env: Env, key: string, value: unknown) {
  await env.DB.put(key, JSON.stringify(value));
}

/**
 * CLIENTS
 */
export async function getClients(env: Env) {
  return getJson(env, "clients", []);
}

export async function putClients(env: Env, clients: unknown) {
  await putJson(env, "clients", clients);
}

/**
 * SETTINGS
 */
export async function getSettings(env: Env) {
  return getJson(env, "settings", {
    dry_run: false,
    sync_enabled: true,
    default_platforms: ["instagram", "facebook", "tiktok", "youtube"]
  });
}

export async function updateLastSyncedAt(env: Env, settings: any, ts: string) {
  settings.last_synced_at = ts;
  await putJson(env, "settings", settings);
}

/**
 * SEEN
 */
export async function getSeen(env: Env, accountId: string) {
  const raw = await env.DB.get(`seen:${accountId}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putSeen(
  env: Env,
  accountId: string,
  value: { postUrl: string; seenAt: string }
) {
  await putJson(env, `seen:${accountId}`, value);
}

/**
 * SCRAPE META (cooldown tracking)
 */
export async function getScrapeMeta(env: Env, accountId: string) {
  return getJson(env, `scrape_meta:${accountId}`, null);
}

export async function putScrapeMeta(
  env: Env,
  accountId: string,
  value: {
    lastAttemptAt: string;
    lastSuccessAt?: string | null;
    lastStatus?: string | null;
    lastLatestContentUrl?: string | null;
  }
) {
  await putJson(env, `scrape_meta:${accountId}`, value);
}

/**
 * LATEST CACHE (result caching)
 */
export async function getLatestCache(
  env: Env,
  platform: string,
  accountId: string
) {
  return getJson(env, `latest_cache:${platform}:${accountId}`, null);
}

export async function putLatestCache(
  env: Env,
  platform: string,
  accountId: string,
  data: unknown
) {
  await putJson(env, `latest_cache:${platform}:${accountId}`, {
    savedAt: new Date().toISOString(),
    data
  });
}
