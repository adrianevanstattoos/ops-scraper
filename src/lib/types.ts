export type Platform = "instagram" | "youtube" | "tiktok" | "facebook";

export interface Env {
  DB: KVNamespace;
  SCRAPFLY_API_KEY?: string;
  SCRAPFLY_ENABLED?: string;
}

export interface AccountRecord {
  id: string;
  platform: Platform;
  handle: string;
  profileUrl: string;
  active?: boolean;
}

export interface ClientRecord {
  id: string;
  name: string;
  active?: boolean;
  package?: "starter" | "growth" | "professional" | "elite";
  accounts: AccountRecord[];
}

export interface SettingsRecord {
  dry_run?: boolean;
  sync_enabled?: boolean;
  default_platforms?: Platform[];
  package_rules?: Record<string, { weekly_target: number }>;
  last_synced_at?: string | null;
}

export interface AccountJob {
  clientId: string;
  clientName: string;
  accountId: string;
  platform: Platform;
  handle: string;
  profileUrl: string;
  package?: string;
}

export type AccountRunStatus =
  | "updated"
  | "unchanged"
  | "skipped"
  | "failed";

export interface AccountRunResult {
  accountId: string;
  clientId: string;
  clientName: string;
  platform: Platform;
  handle: string;
  profileUrl: string;
  status: AccountRunStatus;
  postUrl?: string | null;
  postId?: string | null;
  reason?: string | null;
  error?: string | null;
  source?: "direct" | "scrapfly" | "unknown";
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

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobErrorItem {
  at: string;
  accountId?: string;
  platform?: Platform;
  message: string;
  detail?: string;
}

export interface ScrapeJobRecord {
  id: string;
  mode: "all" | "account";
  accountId: string | null;
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  progressPercent: number;
  totalAccounts: number;
  processed: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  statusText: string;
  error: string | null;
  errors: JobErrorItem[];
  result: RunSummary | { ok: false; error?: string; results?: AccountRunResult[] } | null;
  updatedAt: string;
}

export interface SeenRecord {
  accountId: string;
  platform: Platform;
  profileUrl: string;
  lastPostUrl: string;
  lastPostId?: string | null;
  seenAt: string;
  source?: "direct" | "scrapfly" | "unknown";
}

export interface QueueItem {
  id: string;
  accountId: string;
  clientId: string;
  clientName: string;
  platform: Platform;
  handle: string;
  profileUrl: string;
  postUrl: string;
  createdAt: string;
  completedAt?: string | null;
  status: "pending" | "completed";
  notes?: string;
  source?: "direct" | "scrapfly" | "unknown";
}

export interface LatestContentResult {
  ok: boolean;
  postUrl?: string | null;
  postId?: string | null;
  reason?: string | null;
  source?: "direct" | "scrapfly" | "unknown";
}
