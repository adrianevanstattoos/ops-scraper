import type {
  ClientRecord,
  Env,
  SeenRecord,
  SettingsRecord
} from "./types";

const CLIENTS_KEY = "clients";
const SETTINGS_KEY = "settings";

const DEFAULT_SETTINGS: SettingsRecord = {
  last_synced_at: null,
  dry_run: true,
  sync_enabled: true,
  default_platforms: ["instagram", "facebook", "tiktok", "youtube"]
};

export async function getClients(env: Env): Promise<ClientRecord[]> {
  const data = await env.DB.get(CLIENTS_KEY, "json");
  if (!Array.isArray(data)) return [];
  return data as ClientRecord[];
}

export async function getSettings(env: Env): Promise<SettingsRecord> {
  const data = await env.DB.get(SETTINGS_KEY, "json");
  if (!data || typeof data !== "object") return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...(data as Partial<SettingsRecord>)
  };
}

export function seenKey(accountId: string): string {
  return `seen:${accountId}`;
}

export async function getSeen(
  env: Env,
  accountId: string
): Promise<SeenRecord | null> {
  const data = await env.DB.get(seenKey(accountId), "json");
  if (!data || typeof data !== "object") return null;
  const rec = data as Partial<SeenRecord>;
  if (!rec.postUrl || !rec.seenAt) return null;
  return {
    postUrl: rec.postUrl,
    seenAt: rec.seenAt
  };
}

export async function putSeen(
  env: Env,
  accountId: string,
  record: SeenRecord
): Promise<void> {
  await env.DB.put(seenKey(accountId), JSON.stringify(record));
}

export async function updateLastSyncedAt(
  env: Env,
  settings: SettingsRecord,
  iso: string
): Promise<void> {
  const next: SettingsRecord = {
    ...settings,
    last_synced_at: iso
  };
  await env.DB.put(SETTINGS_KEY, JSON.stringify(next));


  export async function getScrapeMeta(env: Env, accountId: string) {
  const raw = await env.DB.get(`scrape_meta:${accountId}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
  await env.DB.put(`scrape_meta:${accountId}`, JSON.stringify(value));
}


  export async function getLatestCache(
  env: Env,
  platform: string,
  accountId: string
) {
  const raw = await env.DB.get(`latest_cache:${platform}:${accountId}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putLatestCache(
  env: Env,
  platform: string,
  accountId: string,
  data: unknown
) {
  await env.DB.put(
    `latest_cache:${platform}:${accountId}`,
    JSON.stringify({
      savedAt: new Date().toISOString(),
      data
    })
  );
}
}
