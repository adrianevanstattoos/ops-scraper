import type { Env, LatestContentResult } from "../types";
import { fetchHtml } from "../lib/http";

function cleanUrl(value: string): string {
  return value.replace(/\\\//g, "/").replace(/&amp;/g, "&");
}

export async function getLatestInstagram(
  env: Env,
  profileUrl: string
): Promise<LatestContentResult> {
  const page = await fetchHtml(env, profileUrl, {
    useScrapfly: true,
    country: "us",
  });

  const html = page.html || "";

  const patterns = [
    /https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?/i,
    /"permalink":"(https:\\\/\\\/www\.instagram\.com\\\/(?:p|reel)\\\/[^"]+)"/i,
    /"url":"(https:\\\/\\\/www\.instagram\.com\\\/(?:p|reel)\\\/[^"]+)"/i,
    /content="(https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;

    const raw = match[1] || match[0];
    const postUrl = cleanUrl(raw);
    const idMatch = postUrl.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/i);

    return {
      ok: true,
      postUrl,
      postId: idMatch?.[1] || null,
      source: page.source,
    };
  }

  return {
    ok: false,
    reason: "no_latest_content_found",
    source: page.source,
  };
}
