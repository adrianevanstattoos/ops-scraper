import type { AccountJob, Env, LatestContentResult } from "../types";
import { getLatestInstagram } from "./instagram";
import { getLatestYoutube } from "./youtube";
import { getLatestTikTok } from "./tiktok";
import { getLatestFacebook } from "./facebook";

export async function getLatestForPlatform(
  env: Env,
  account: AccountJob
): Promise<LatestContentResult> {
  switch (account.platform) {
    case "instagram":
      return getLatestInstagram(env, account.profileUrl);
    case "youtube":
      return getLatestYoutube(env, account.profileUrl);
    case "tiktok":
      return getLatestTikTok(env, account.profileUrl);
    case "facebook":
      return getLatestFacebook(env, account.profileUrl);
    default:
      return {
        ok: false,
        reason: "unsupported_platform",
        source: "unknown",
      };
  }
}
