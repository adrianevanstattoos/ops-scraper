import type { AccountJob, LatestContent } from "../lib/types";

function normalizeInstagramProfileUrl(url: string): string {
  const clean = String(url || "").trim().replace(/\/+$/, "");
  if (!clean) return clean;
  return clean;
}

function extractInstagramPostUrl(html: string): {
  url: string | null;
  matchedBy: string | null;
} {
  const patterns: Array<{ name: string; regex: RegExp }> = [
    {
      name: "permalink",
      regex: /"permalink":"(https:\\\/\\\/www\.instagram\.com\\\/(?:p|reel)\\\/[^"\\]+\\\/?)"/
    },
    {
      name: "post_path",
      regex: /"(\/(?:p|reel)\/[A-Za-z0-9_-]+\/)"/
    },
    {
      name: "og_url",
      regex: /property="og:url"\s+content="(https:\/\/www\.instagram\.com\/(?:p|reel)\/[^"]+\/?)"/
    }
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern.regex);
    if (match?.[1]) {
      let url = match[1]
        .replaceAll("\\/", "/")
        .replaceAll("\\u0026", "&");

      if (url.startsWith("/")) {
        url = `https://www.instagram.com${url}`;
      }

      return { url, matchedBy: pattern.name };
    }
  }

  return { url: null, matchedBy: null };
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

export async function getLatestInstagramContent(
  account: AccountJob
): Promise<LatestContent | null> {
  const sourceUrl = normalizeInstagramProfileUrl(account.profileUrl);

  if (!sourceUrl) {
    throw new Error("Missing Instagram profileUrl");
  }

  const resp = await fetch(sourceUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      "accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "pragma": "no-cache"
    }
  });

  if (!resp.ok) {
    throw new Error(`Instagram fetch failed with ${resp.status}`);
  }

  const html = await resp.text();
  const { url, matchedBy } = extractInstagramPostUrl(html);
  const contentType = inferInstagramContentType(url);
  const contentId = extractInstagramContentId(url);

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
      matchedBy
    }
  };
}
