import type { Env, LatestContentResult } from "../types";
import { fetchHtml } from "../lib/http";

export async function getLatestYoutube(
  env: Env,
  profileUrl: string
): Promise<LatestContentResult> {
  const normalized = profileUrl.includes("/videos")
    ? profileUrl
    : `${profileUrl.replace(/\/$/, "")}/videos`;

  const page = await fetchHtml(env, normalized, {
    useScrapfly: true,
    country: "us",
  });

  const html = page.html || "";

  const patterns = [
    /\/watch\?v=([A-Za-z0-9_-]{11})/i,
    /\/shorts\/([A-Za-z0-9_-]{11})/i,
    /"url":"\/watch\?v=([A-Za-z0-9_-]{11})"/i,
    /"url":"\/shorts\/([A-Za-z0-9_-]{11})"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;

    const videoId = match[1];
    const isShort = match[0].includes("/shorts/");
    const postUrl = isShort
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`;

    return {
      ok: true,
      postUrl,
      postId: videoId,
      source: page.source,
    };
  }

  return {
    ok: false,
    reason: "no_latest_content_found",
    source: page.source,
  };
}
