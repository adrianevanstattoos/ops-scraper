import type { AccountJob, LatestContent } from "../lib/types";

function normalizeTikTokProfileUrl(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "");
}

function extractTikTokVideoUrl(html: string): {
  url: string | null;
  matchedBy: string | null;
} {
  const patterns: Array<{ name: string; regex: RegExp }> = [
    {
      name: "video_path",
      regex: /"(https:\/\/www\.tiktok\.com\/@[^"\/]+\/video\/\d+)"/
    },
    {
      name: "share_url",
      regex: /"shareUrl":"(https:\\\/\\\/www\.tiktok\.com\\\/@[^"\\]+\\\/video\\\/\d+)"/
    },
    {
      name: "canonical",
      regex: /<link rel="canonical" href="(https:\/\/www\.tiktok\.com\/@[^"]+\/video\/\d+)"/
    }
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern.regex);
    if (match?.[1]) {
      const url = match[1].replaceAll("\\/", "/");
      return { url, matchedBy: pattern.name };
    }
  }

  return { url: null, matchedBy: null };
}

function extractTikTokVideoId(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/video\/(\d+)/);
  return match?.[1] || null;
}

export async function getLatestTikTokContent(
  account: AccountJob
): Promise<LatestContent | null> {
  const sourceUrl = normalizeTikTokProfileUrl(account.profileUrl);

  if (!sourceUrl) {
    throw new Error("Missing TikTok profileUrl");
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
    throw new Error(`TikTok fetch failed with ${resp.status}`);
  }

  const html = await resp.text();
  const { url, matchedBy } = extractTikTokVideoUrl(html);

  return {
    platform: "tiktok",
    accountId: account.accountId,
    handle: account.handle,
    latestContentId: extractTikTokVideoId(url),
    latestContentUrl: url,
    contentType: url ? "video" : null,
    publishedAt: null,
    scrapedAt: new Date().toISOString(),
    raw: {
      sourceUrl,
      matchedBy
    }
  };
}
