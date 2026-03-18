import type { AccountJob, LatestContent } from "../lib/types";

export async function getLatestFacebookContent(
  account: AccountJob
): Promise<LatestContent | null> {
  void account;
  return null;
}
