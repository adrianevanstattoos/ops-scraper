import type { AccountJob, LatestContent } from "../lib/types";

function normalizeYouTubeProfileUrl(url: string): string {
  const clean = String(url || "").trim().replace(/\/+$/, "");
  if (!clean) return clean;

  if (
    clean.includes("/videos") ||
    clean.includes("/shorts") ||
    clean.includes("/featured")
  ) {
    return clean;
  }

  if (
    clean.includes("youtube.com/@") ||
    clean.includes("youtube.com/channel/") ||
    clean.includes("youtube.com/c/") ||
    clean.includes("youtube.com/user/")
  ) {
    return `${clean}/videos`;
  }

  return clean;
}

function extractYouTubeVideoId(html: string): {
  videoId: string | null;
  matchedBy: string | null;
} {
  const patterns: Array<{ name: string; regex: RegExp }> = [
    { name: "videoId", regex: /"videoId":"([a-zA-Z0-9_-]{11})"/ },
    { name: "watchUrl", regex: /\/watch\?v=([a-zA-Z0-9_-]{11})/ },
    { name: "shortsUrl", regex: /\/shorts\/([a-zA-Z0-9_-]{11})/ },
    { name: "urlField", regex: /"url":"\/watch\?v=([a-zA-Z0-9_-]{11})/ }
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern.regex);
    if (match?.[1]) {
      return {
        videoId: match[1],
        matchedBy: pattern.name
      };
    }
  }

  return {
    videoId: null,
    matchedBy: null
  };
}

function detectContentType(html: string, videoId: string): "video" | "short" {
  if (
    html.includes(`/shorts/${videoId}`) ||
    html.includes(`"url":"\\/shorts\\/${videoId}`) ||
    html.includes(`"webCommandMetadata":{"url":"/shorts/${videoId}`)
  ) {
    return "short";
  }

  return "video";
}

export async function getLatestYouTubeContent(
  account: AccountJob
): Promise<LatestContent | null> {
  const sourceUrl = normalizeYouTubeProfileUrl(account.profileUrl);

  if (!sourceUrl) {
    throw new Error("Missing YouTube profileUrl");
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
    throw new Error(`YouTube fetch failed with ${resp.status}`);
  }

  const html = await resp.text();
  const { videoId, matchedBy } = extractYouTubeVideoId(html);

  if (!videoId) {
    return {
      platform: "youtube",
      accountId: account.accountId,
      handle: account.handle,
      latestContentId: null,
      latestContentUrl: null,
      contentType: null,
      publishedAt: null,
      scrapedAt: new Date().toISOString(),
      raw: {
        sourceUrl,
        matchedBy: null,
        note: "No video ID found"
      }
    };
  }

  const contentType = detectContentType(html, videoId);
  const latestContentUrl =
    contentType === "short"
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`;

  return {
    platform: "youtube",
    accountId: account.accountId,
    handle: account.handle,
    latestContentId: videoId,
    latestContentUrl,
    contentType,
    publishedAt: null,
    scrapedAt: new Date().toISOString(),
    raw: {
      sourceUrl,
      matchedBy
    }
  };
}
