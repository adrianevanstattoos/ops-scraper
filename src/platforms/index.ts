import type { AccountJob, LatestContent } from "../lib/types";
import { getLatestFacebookContent } from "./facebook";
import { getLatestInstagramContent } from "./instagram";
import { getLatestTikTokContent } from "./tiktok";
import { getLatestYouTubeContent } from "./youtube";

export async function getLatestContentForAccount(
  account: AccountJob
): Promise<LatestContent | null> {
  switch (account.platform) {
    case "youtube":
      return getLatestYouTubeContent(account);
    case "instagram":
      return getLatestInstagramContent(account);
    case "tiktok":
      return getLatestTikTokContent(account);
    case "facebook":
      return getLatestFacebookContent(account);
    default:
      return null;
  }
}
