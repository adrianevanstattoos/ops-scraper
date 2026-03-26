import type { AccountJob, LatestContent } from "../lib/types";

const REQUEST_TIMEOUT_MS = 12000;
const MAX_ATTEMPTS = 2; // initial try + 1 gentle retry
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeInstagramProfileUrl(url: string, handle?: string): string {
  const raw = cleanString(url);

  if (raw) {
    let normalized = raw;

    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }

    try {
      const u = new URL(normalized);
      u.hash = "";
      u.search = "";

      // If someone pasted an individual post/reel URL, reduce to profile path if possible.
      // Otherwise keep the path they gave.
      const path = u.pathname.replace(/\/+$/, "");
      u.pathname = path || "/";

      return u.toString().replace(/\/+$/, "");
    } catch {
      // fall through to handle-based build below
    }
  }

  const cleanHandle = cleanString(handle).replace(/^@+/, "");
  if (!cleanHandle) return "";

  return `https://www.instagram.com/${cleanHandle}`;
}

function extractInstagramPostUrl(html: string): {
  url: string | null;
  matchedBy: string | null;
} {
  const patterns: Array<{ name: string; regex: RegExp }> = [
    {
      name: "permalink",
      regex: /"permalink":"(https:\\\/\\\/www\.instagram\.com\\\/(?:p|reel)\\\/[^"\\]+\\\/?)"/i
    },
    {
      name: "post_path",
      regex: /"(\/(?:p|reel)\/[A-Za-z0-9_-]+\/)"/i
    },
    {
      name: "og_url",
      regex: /property="og:url"\s+content="(https:\/\/www\.instagram\.com\/(?:p|reel)\/[^"]+\/?)"/i
    },
    {
      name: "canonical_link",
      regex: /<link[^>]+rel="canonical"[^>]+href="(https:\/\/www\.instagram\.com\/(?:p|reel)\/[^"]+\/?)"/i
    }
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern.regex);
    if (!match?.[1]) continue;

    let url = match[1]
      .replaceAll("\\/", "/")
      .replaceAll("\\u0026", "&");

    if (url.startsWith("/")) {
      url = `https://www.instagram.com${url}`;
    }

    return { url: normalizeInstagramPostUrl(url), matchedBy: pattern.name };
  }

  return { url: null, matchedBy: null };
}

function normalizeInstagramPostUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    u.pathname = u.pathname.replace(/\/+$/, "") + "/";
    return u.toString();
  } catch {
    return cleanString(url);
  }
}

function inferInstagramContentType(url: string | null): "post" | "reel" | null {
  if (!url) return null;
  if (url.includes("/reel/")) return "reel";
  if (url.includes("/p/")) return "post";
  return null;
}

function extractInstagramContentId(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)\//);
  return match?.[1] || null;
}

function getRetryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 30000);
  }

  // gentle bounded backoff with small jitter
  const base = attempt === 1 ? 1500 : 4000;
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function isLikelyLoginWall(html: string): boolean {
  const sample = html.slice(0, 6000).toLowerCase();
  return (
    sample.includes("login") &&
    (sample.includes("instagram") || sample.includes("log in"))
  );
}

function isLikelyRateLimitPage(html: string): boolean {
  const sample = html.slice(0, 8000).toLowerCase();
  return (
    sample.includes("please wait a few minutes") ||
    sample.includes("try again later") ||
    sample.includes("rate limit")
  );
}

export async function getLatestInstagramContent(
  account: AccountJob
): Promise<LatestContent | null> {
  const sourceUrl = normalizeInstagramProfileUrl(account.profileUrl, account.handle);

  if (!sourceUrl) {
    throw new Error("Missing Instagram profileUrl");
  }

  let lastStatus: number | null = null;
  let lastHtmlSnippet: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp: Response;

    try {
      resp = await fetchWithTimeout(
        sourceUrl,
        {
          method: "GET",
          redirect: "follow",
          headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
            "cache-control": "no-cache",
            pragma: "no-cache"
          },
          cf: {
            cacheTtl: 0,
            cacheEverything: false
          }
        },
        REQUEST_TIMEOUT_MS
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Instagram request failed";

      if (attempt < MAX_ATTEMPTS) {
        await sleep(getRetryDelayMs(attempt, null));
        continue;
      }

      throw new Error(`Instagram request error: ${message}`);
    }

    lastStatus = resp.status;

    if (!resp.ok) {
      if (resp.status === 429) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(getRetryDelayMs(attempt, resp.headers.get("retry-after")));
          continue;
        }
        throw new Error("Instagram rate limited this request (429)");
      }

      if (RETRYABLE_STATUS.has(resp.status) && attempt < MAX_ATTEMPTS) {
        await sleep(getRetryDelayMs(attempt, resp.headers.get("retry-after")));
        continue;
      }

      throw new Error(`Instagram fetch failed with ${resp.status}`);
    }

    const html = await resp.text();
    lastHtmlSnippet = html.slice(0, 1000);

    if (isLikelyRateLimitPage(html)) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(getRetryDelayMs(attempt, resp.headers.get("retry-after")));
        continue;
      }
      throw new Error("Instagram returned a rate-limit/interstitial page");
    }

    if (isLikelyLoginWall(html)) {
      // Do not try to bypass. Just report it cleanly.
      throw new Error("Instagram returned a login/interstitial page");
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
        httpStatus: resp.status
      }
    };
  }

  throw new Error(
    `Instagram latest content lookup failed${lastStatus ? ` (last status ${lastStatus})` : ""}`
  );
}
