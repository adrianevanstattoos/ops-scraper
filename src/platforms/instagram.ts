import type { AccountJob, LatestContent, Env } from "../lib/types";

const MAX_ATTEMPTS = 3;

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
    { name: "permalink_json", regex: /"permalink":"(https:\\\/\\\/www\.instagram\.com\\\/(?:p|reel)\\\/[^"\\]+\\\/?)"/gi },
    { name: "og_url", regex: /property="og:url"\s+content="(https:\/\/www\.instagram\.com\/(?:p|reel)\/[^"]+\/?)"/gi },
    { name: "canonical_link", regex: /<link[^>]+rel="canonical"[^>]+href="(https:\/\/www\.instagram\.com\/(?:p|reel)\/[^"]+\/?)"/gi },
    { name: "href_absolute", regex: /href="(https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?)"/gi },
    { name: "href_relative", regex: /href="(\/(?:p|reel)\/[A-Za-z0-9_-]+\/?)"/gi },
    { name: "json_absolute", regex: /"(https:\\\/\\\/www\.instagram\.com\\\/(?:p|reel)\\\/[A-Za-z0-9_-]+\\\/?)"/gi },
    { name: "json_relative", regex: /"(\/(?:p|reel)\/[A-Za-z0-9_-]+\/?)"/gi }
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

function isLikelyLoginWall(html: string): boolean {
  const sample = html.slice(0, 20000).toLowerCase();
  return (
    sample.includes('name="username"') ||
    sample.includes('name="enc_password"') ||
    sample.includes("accounts/login") ||
    sample.includes("login_and_signup_page")
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

async function scrapeWithScrapFly(targetUrl: string, apiKey: string): Promise<string> {
  const scrapeUrl = `https://api.scrapfly.io/scrape?key=${apiKey}&url=${encodeURIComponent(targetUrl)}&asp=true&country=us&render_js=false`;

  const resp = await fetch(scrapeUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    cf: { cacheTtl: 0, cacheEverything: false }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ScrapFly failed (${resp.status}): ${text}`);
  }

  const data = await resp.json() as any;

  if (data.status !== "success" || !data.result?.content) {
    throw new Error(`ScrapFly returned error: ${data.message || JSON.stringify(data)}`);
  }

  return data.result.content;
}

export async function getLatestInstagramContent(
  account: AccountJob,
  env: Env
): Promise<LatestContent | null> {
  const sourceUrl = normalizeInstagramProfileUrl(account.profileUrl, account.handle);
  if (!sourceUrl) throw new Error("Missing Instagram profileUrl");

  if (!env.SCRAPFLY_API_KEY) {
    throw new Error("SCRAPFLY_API_KEY secret is not set in Cloudflare");
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
        throw new Error("Instagram returned a login wall");
      }

      const { url, matchedBy } = extractInstagramPostUrl(html);
      const contentType = inferInstagramContentType(url);
      const contentId = extractInstagramContentId(url);

      if (!url) {
        throw new Error("No Instagram post or reel URL found in profile HTML");
      }

      if (!contentId) {
        throw new Error(`Could not extract Instagram content ID from URL: ${url}`);
      }

      if (!contentType) {
        throw new Error(`Could not infer Instagram content type from URL: ${url}`);
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
        raw: { sourceUrl, matchedBy, via: "scrapfly" }
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
