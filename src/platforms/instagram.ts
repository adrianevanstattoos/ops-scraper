import type { AccountJob, LatestContent } from "../lib/types";

const REQUEST_TIMEOUT_MS = 12000;
const MAX_ATTEMPTS = 2;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36"
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
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
      u.pathname = u.pathname.replace(/\/+$/, "") || "/";
      return u.toString().replace(/\/+$/, "");
    } catch {
      // fall through
    }
  }

  const cleanHandle = cleanString(handle).replace(/^@+/, "");
  if (!cleanHandle) return "";
  return `https://www.instagram.com/${cleanHandle}`;
}

function normalizeInstagramContentUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("/") ? `https://www.instagram.com${url}` : url);
    u.hash = "";
    u.search = "";
    u.pathname = u.pathname.replace(/\/+$/, "") + "/";
    return u.toString();
  } catch {
    return cleanString(url);
  }
}

function decodeEscapedInstagramUrl(value: string): string {
  return value
    .replaceAll("\\/", "/")
    .replaceAll("\\u0026", "&")
    .replaceAll("&amp;", "&");
}

function isInstagramContentPath(path: string): boolean {
  return /^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/i.test(path);
}

function isInstagramContentUrl(url: string): boolean {
  try {
    const u = new URL(url.startsWith("/") ? `https://www.instagram.com${url}` : url);
    return /(^|\.)instagram\.com$/i.test(u.hostname) && isInstagramContentPath(u.pathname);
  } catch {
    return isInstagramContentPath(url);
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
  const match = url.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)\//i);
  return match?.[1] || null;
}

function scoreInstagramUrl(url: string, matchedBy: string): number {
  let score = 0;

  if (url.includes("/reel/")) score += 3;
  if (url.includes("/p/")) score += 3;
  if (url.startsWith("https://www.instagram.com/")) score += 2;
  if (matchedBy.includes("json")) score += 3;
  if (matchedBy.includes("shortcode")) score += 2;
  if (/\?(?!$)/.test(url)) score -= 1;
  if (url.includes("/reels/")) score -= 2;
  if (url.includes("/explore/")) score -= 5;
  if (url.includes("/stories/")) score -= 5;

  return score;
}

function collectCandidateUrls(html: string): Array<{ url: string; matchedBy: string }> {
  const candidates: Array<{ url: string; matchedBy: string }> = [];
  const seen = new Set<string>();

  const pushCandidate = (raw: string, matchedBy: string) => {
    if (!raw) return;

    const decoded = decodeEscapedInstagramUrl(raw);
    const normalized = normalizeInstagramContentUrl(decoded);

    if (!isInstagramContentUrl(normalized)) return;
    if (seen.has(normalized)) return;

    seen.add(normalized);
    candidates.push({ url: normalized, matchedBy });
  };

  const patterns: Array<{ name: string; regex: RegExp }> = [
    {
      name: "permalink_json",
      regex: /"permalink":"(https:\\\/\\\/www\.instagram\.com\\\/(?:p|reel)\\\/[^"\\]+\\\/?)"/gi
    },
    {
      name: "og_url",
      regex: /property="og:url"\s+content="(https:\/\/www\.instagram\.com\/(?:p|reel)\/[^"]+\/?)"/gi
    },
    {
      name: "canonical_link",
      regex: /<link[^>]+rel="canonical"[^>]+href="(https:\/\/www\.instagram\.com\/(?:p|reel)\/[^"]+\/?)"/gi
    },
    {
      name: "href_absolute",
      regex: /href="(https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?)"/gi
    },
    {
      name: "href_relative",
      regex: /href="(\/(?:p|reel)\/[A-Za-z0-9_-]+\/?)"/gi
    },
    {
      name: "json_absolute",
      regex: /"(https:\\\/\\\/www\.instagram\.com\\\/(?:p|reel)\\\/[A-Za-z0-9_-]+\\\/?)"/gi
    },
    {
      name: "json_relative",
      regex: /"(\/(?:p|reel)\/[A-Za-z0-9_-]+\/?)"/gi
    }
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern.regex)) {
      if (match?.[1]) pushCandidate(match[1], pattern.name);
    }
  }

  return candidates;
}

function extractShortcodeCandidatesFromHtml(html: string): Array<{ url: string; matchedBy: string }> {
  const out: Array<{ url: string; matchedBy: string }> = [];
  const seen = new Set<string>();
  const regex = /"shortcode":"([A-Za-z0-9_-]+)"/gi;

  for (const match of html.matchAll(regex)) {
    const shortcode = match?.[1];
    if (!shortcode) continue;

    const url = `https://www.instagram.com/p/${shortcode}/`;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, matchedBy: "shortcode_json" });
  }

  return out;
}

function extractEmbeddedJsonCandidates(html: string): Array<{ url: string; matchedBy: string }> {
  const candidates: Array<{ url: string; matchedBy: string }> = [];
  const seen = new Set<string>();

  const push = (url: string, matchedBy: string) => {
    const normalized = normalizeInstagramContentUrl(url);
    if (!isInstagramContentUrl(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({ url: normalized, matchedBy });
  };

  const permalinkRegexes = [
    /"permalink":"(https:\\\/\\\/www\.instagram\.com\\\/(?:p|reel)\\\/[^"\\]+\\\/?)"/gi,
    /"url":"(https:\\\/\\\/www\.instagram\.com\\\/(?:p|reel)\\\/[^"\\]+\\\/?)"/gi
  ];

  for (const regex of permalinkRegexes) {
    for (const match of html.matchAll(regex)) {
      if (match?.[1]) push(decodeEscapedInstagramUrl(match[1]), "embedded_json_permalink");
    }
  }

  for (const item of extractShortcodeCandidatesFromHtml(html)) {
    push(item.url, item.matchedBy);
  }

  return candidates;
}

function extractInstagramPostUrl(html: string): {
  url: string | null;
  matchedBy: string | null;
} {
  const candidates = [
    ...extractEmbeddedJsonCandidates(html),
    ...collectCandidateUrls(html)
  ];

  if (!candidates.length) {
    return { url: null, matchedBy: null };
  }

  candidates.sort(
    (a, b) => scoreInstagramUrl(b.url, b.matchedBy) - scoreInstagramUrl(a.url, a.matchedBy)
  );

  return {
    url: candidates[0].url,
    matchedBy: candidates[0].matchedBy
  };
}

function getRetryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 30000);
  }

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
  const sample = html.slice(0, 12000).toLowerCase();
  return (
    sample.includes("instagram") &&
    (sample.includes("log in") || sample.includes("login") || sample.includes("sign up"))
  );
}

function isLikelyRateLimitPage(html: string): boolean {
  const sample = html.slice(0, 12000).toLowerCase();
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

  const userAgent = randomItem(USER_AGENTS);

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
            pragma: "no-cache",
            "upgrade-insecure-requests": "1",
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "same-origin",
            referer: "https://www.instagram.com/",
            "user-agent": userAgent
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

    if (isLikelyRateLimitPage(html)) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(getRetryDelayMs(attempt, resp.headers.get("retry-after")));
        continue;
      }
      throw new Error("Instagram returned a rate-limit/interstitial page");
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
        httpStatus: resp.status,
        userAgent
      }
    };
  }

  return null;
}
