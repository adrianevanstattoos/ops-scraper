import type { Env, LatestContentResult } from "../types";
import { fetchHtml } from "../lib/http";

export async function getLatestFacebook(
  env: Env,
  profileUrl: string
): Promise<LatestContentResult> {
  const page = await fetchHtml(env, profileUrl, {
    useScrapfly: true,
    country: "us",
  });

  const html = page.html || "";

  const patterns = [
    /https:\/\/www\.facebook\.com\/[^\/"]+\/posts\/([A-Za-z0-9_-]+)/i,
    /https:\/\/www\.facebook\.com\/[^\/"]+\/videos\/([A-Za-z0-9_-]+)/i,
    /"story":{"url":"(https:\\\/\\\/www\.facebook\.com\\\/[^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;

    const postUrl = (match[1]?.startsWith?.("https://") ? match[1] : match[0]).replace(
      /\\\//g,
      "/"
    );
    const idMatch = postUrl.match(/\/(?:posts|videos)\/([A-Za-z0-9_-]+)/i);

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
