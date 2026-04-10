import type { Env, LatestContentResult } from "../types";
import { fetchHtml } from "../lib/http";

export async function getLatestTikTok(
  env: Env,
  profileUrl: string
): Promise<LatestContentResult> {
  const page = await fetchHtml(env, profileUrl, {
    useScrapfly: true,
    country: "us",
  });

  const html = page.html || "";

  const patterns = [
    /https:\/\/www\.tiktok\.com\/@[^\/"]+\/video\/(\d+)/i,
    /"canonical":"(https:\/\/www\.tiktok\.com\/@[^"]+\/video\/(\d+))"/i,
    /"shareMeta":\{"title":[^}]*"url":"(https:\/\/www\.tiktok\.com\/@[^"]+\/video\/(\d+))"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;

    const postUrl = match[1].startsWith("https://") ? match[1] : match[0];
    const idMatch = postUrl.match(/\/video\/(\d+)/i);

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
