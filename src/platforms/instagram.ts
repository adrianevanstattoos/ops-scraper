import type { AccountJob, LatestContent } from "../lib/types";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3; // increased slightly

const USER_AGENTS = [ /* your existing array — still useful as fallback header */ ];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// ─────────────────────────────────────────────────────────────
//  Normalization & parsing helpers (unchanged — they are excellent)
function normalizeInstagramProfileUrl(url: string, handle?: string): string { /* ... your existing function ... */ }
function normalizeInstagramContentUrl(url: string): string { /* ... */ }
function decodeEscapedInstagramUrl(value: string): string { /* ... */ }
function isInstagramContentPath(path: string): boolean { /* ... */ }
function isInstagramContentUrl(url: string): boolean { /* ... */ }
function inferInstagramContentType(url: string | null): "post" | "reel" | null { /* ... */ }
function extractInstagramContentId(url: string | null): string | null { /* ... */ }
function scoreInstagramUrl(url: string, matchedBy: string): number { /* ... */ }
function collectCandidateUrls(html: string): Array<{ url: string; matchedBy: string }> { /* ... */ }
function extractShortcodeCandidatesFromHtml(html: string): Array<{ url: string; matchedBy: string }> { /* ... */ }
function extractEmbeddedJsonCandidates(html: string): Array<{ url: string; matchedBy: string }> { /* ... */ }
function extractInstagramPostUrl(html: string): { url: string | null; matchedBy: string | null } { /* ... */ }

function isLikelyLoginWall(html: string): boolean { /* ... */ }
function isLikelyRateLimitPage(html: string): boolean { /* ... */ }

// ─────────────────────────────────────────────────────────────
//  NEW: ScrapFly helper (one-line integration)
async function scrapeWithScrapFly(targetUrl: string, apiKey: string): Promise<string> {
  const scrapeUrl = `https://api.scrapfly.io/scrape?key=${apiKey}&url=${encodeURIComponent(targetUrl)}&asp=true&country=us&render_js=false`;

  const resp = await fetch(scrapeUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ScrapFly failed (${resp.status}): ${text}`);
  }

  const data = await resp.json() as any;

  if (data.status !== "success" || !data.result?.content) {
    throw new Error(`ScrapFly returned error: ${data.message || JSON.stringify(data)}`);
  }

  return data.result.content; // this is the full rendered HTML
}

// ─────────────────────────────────────────────────────────────
export async function getLatestInstagramContent(
  account: AccountJob,
  env: Env   // ← pass env so we can access the secret
): Promise<LatestContent | null> {
  const sourceUrl = normalizeInstagramProfileUrl(account.profileUrl, account.handle);
  if (!sourceUrl) throw new Error("Missing Instagram profileUrl");

  if (!env.SCRAPFLY_API_KEY) {
    throw new Error("SCRAPFLY_API_KEY secret is not set");
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const html = await scrapeWithScrapFly(sourceUrl, env.SCRAPFLY_API_KEY);

      if (isLikelyRateLimitPage(html)) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(attempt * 4000);
          continue;
        }
        throw new Error("Rate-limit page even through ScrapFly");
      }

      if (isLikelyLoginWall(html)) {
        return null;
      }

      const { url, matchedBy } = extractInstagramPostUrl(html);
      const contentType = inferInstagramContentType(url);
      const contentId = extractInstagramContentId(url);

      if (!url || !contentId || !contentType) {
        return null;
      }

      return {
        platform: "instagram",
        accountId: account.accountId,
        handle: account.handle,
        latestContentId: contentId,
        latestContentUrl: url,
        contentType,
        publishedAt: null,
        scrapedAt: new Date().toISOString(),
        raw: {
          sourceUrl,
          matchedBy,
          via: "scrapfly",
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 3000 + Math.random() * 2000);
        continue;
      }
      throw new Error(`Instagram scrape failed: ${message}`);
    }
  }

  return null;
}
