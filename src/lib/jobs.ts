import type { Env, JobErrorItem, ScrapeJobRecord } from "../types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function calcProgress(processed: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
}

export async function getJob(env: Env, jobId: string): Promise<ScrapeJobRecord | null> {
  const raw = await env.DB.get(`job:${jobId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function putJob(env: Env, job: ScrapeJobRecord): Promise<void> {
  job.updatedAt = nowIso();
  await env.DB.put(`job:${job.id}`, JSON.stringify(job));
}

export async function createJob(
  env: Env,
  input: Pick<ScrapeJobRecord, "id" | "mode" | "accountId">
): Promise<ScrapeJobRecord> {
  const job: ScrapeJobRecord = {
    id: input.id,
    mode: input.mode,
    accountId: input.accountId,
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    progressPercent: 0,
    totalAccounts: 0,
    processed: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    statusText: "starting",
    error: null,
    errors: [],
    result: null,
    updatedAt: nowIso(),
  };

  await putJob(env, job);
  return job;
}

export async function patchJob(
  env: Env,
  jobId: string,
  patch: Partial<ScrapeJobRecord>
): Promise<ScrapeJobRecord> {
  const current = await getJob(env, jobId);
  if (!current) throw new Error(`Job not found: ${jobId}`);

  const next: ScrapeJobRecord = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };

  await putJob(env, next);
  return next;
}

export async function appendJobError(
  env: Env,
  jobId: string,
  err: JobErrorItem
): Promise<ScrapeJobRecord> {
  const current = await getJob(env, jobId);
  if (!current) throw new Error(`Job not found: ${jobId}`);

  const next: ScrapeJobRecord = {
    ...current,
    failed: current.failed + 1,
    errors: [...current.errors, err],
    updatedAt: nowIso(),
  };

  await putJob(env, next);
  return next;
}
