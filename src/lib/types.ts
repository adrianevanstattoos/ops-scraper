export interface Env {
  DB: KVNamespace;
}

export type Platform = "instagram" | "facebook" | "tiktok" | "youtube";

export interface ClientAccount {
  id: string;
  platform: Platform;
  handle: string;
  profileUrl: string;
  active: boolean;
}

export interface ClientRecord {
  id: string;
  name: string;
  status: string;
  notes?: string;
  accounts: ClientAccount[];
}

export interface SettingsRecord {
  last_synced_at: string | null;
  dry_run: boolean;
  sync_enabled: boolean;
  default_platforms: Platform[];
}

export interface SeenRecord {
  postUrl: string;
  seenAt: string;
}

export interface AccountJob {
  clientId: string;
  clientName: string;
  accountId: string;
  platform: Platform;
  handle: string;
  profileUrl: string;
}

export interface LatestContent {
  platform: Platform;
  accountId: string;
  handle: string;
  latestContentId: string | null;
  latestContentUrl: string | null;
  contentType: string | null;
  publishedAt: string | null;
  scrapedAt: string;
  raw?: unknown;
}

export interface AccountRunResult {
  accountId: string;
  clientName: string;
  platform: Platform;
  handle: string;
  status: "updated" | "unchanged" | "skipped" | "failed";
  reason?: string;
  previousUrl?: string | null;
  latestUrl?: string | null;
}

export interface RunSummary {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  totalAccounts: number;
  checked: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  results: AccountRunResult[];
}
