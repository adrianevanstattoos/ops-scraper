import type { AccountJob, LatestContent } from "../lib/types";

function normalizeFacebookProfileUrl(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "");
}

function extractFacebookPostUrl(html: string): {
  url: string | null;
  matchedBy: string | null;
} {
  const patterns: Array<{ name: string; regex: RegExp }> = [
    {
      name: "story_php",
      regex: /"(https:\/\/www\.facebook\.com\/story\.php\?story_fbid=[^"]+)"/
    },
    {
      name: "posts_path",
      regex: /"(https:\/\/www\.facebook\.com\/[^"\/]+\/posts\/[^"]+)"/
    },
    {
      name: "reel_path",
      regex: /"(https:\/\/www\.facebook\.com\/reel\/\d+)"/
    }
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern.regex);
    if (match?.[1]) {
      return { url: match[1], matchedBy: pattern.name };
    }
  }

  return { url: null, matchedBy: null };
}

function inferFacebookContentType(url: string | null): "post" | "reel" | null {
  if (!url) return null;
  if (url.includes("/reel/")) return "reel";
  return "post";
}

function extractFacebookContentId(url: string | null): string | null {
  if (!url) return null;
  const reelMatch = url.match(/\/reel\/(\d+)/);
  if (reelMatch?.[1]) return reelMatch[1];

  const storyMatch = url.match(/story_fbid=([^&]+)/);
  if (storyMatch?.[1]) return storyMatch[1];

  const postMatch = url.match(/\/posts\/([^/?]+)/);
  return postMatch?.[1] || null;
}

export async function getLatestFacebookContent(
  account: AccountJob
): Promise<LatestContent | null> {
  const sourceUrl = normalizeFacebookProfileUrl(account.profileUrl);

  if (!sourceUrl) {
    throw new Error("Missing Facebook profileUrl");
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
    throw new Error(`Facebook fetch failed with ${resp.status}`);
  }

  const html = await resp.text();
  const { url, matchedBy } = extractFacebookPostUrl(html);

  return {
    platform: "facebook",
    accountId: account.accountId,
    handle: account.handle,
    latestContentId: extractFacebookContentId(url),
    latestContentUrl: url,
    contentType: inferFacebookContentType(url),
    publishedAt: null,
    scrapedAt: new Date().toISOString(),
    raw: {
      sourceUrl,
      matchedBy
    }
  };
}
