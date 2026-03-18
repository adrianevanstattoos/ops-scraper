import type { AccountJob, LatestContent } from "../lib/types";

function extractYouTubeVideoId(html: string): string | null {
  const patterns = [
    /"videoId":"([a-zA-Z0-9_-]{11})"/,
    /watch\?v=([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /"url":"\/watch\?v=([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function detectContentType(html: string, videoId: string): string {
  if (html.includes(`/shorts/${videoId}`)) return "short";
  return "video";
}

export async function getLatestYouTubeContent(
  account: AccountJob
): Promise<LatestContent | null> {
  const resp = await fetch(account.profileUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
    }
  });

  if (!resp.ok) {
    throw new Error(`YouTube fetch failed with ${resp.status}`);
  }

  const html = await resp.text();
  const videoId = extractYouTubeVideoId(html);

  if (!videoId) {
    return null;
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
      sourceUrl: account.profileUrl
    }
  };
}
