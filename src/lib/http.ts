import type { Env } from "../types";

export async function fetchHtml(
  env: Env,
  targetUrl: string,
  opts: {
    useScrapfly?: boolean;
    country?: string;
  } = {}
): Promise<{
  ok: boolean;
  status: number;
  html: string;
  finalUrl?: string;
  source: "direct" | "scrapfly";
}> {
  const scrapflyEnabled =
    opts.useScrapfly &&
    !!env.SCRAPFLY_API_KEY &&
    String(env.SCRAPFLY_ENABLED || "true").toLowerCase() !== "false";

  if (scrapflyEnabled) {
    const url = new URL("https://api.scrapfly.io/scrape");
    url.searchParams.set("key", env.SCRAPFLY_API_KEY as string);
    url.searchParams.set("url", targetUrl);
    url.searchParams.set("asp", "true");
    url.searchParams.set("render_js", "false");
    url.searchParams.set("country", opts.country || "us");

    const res = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
      },
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`Scrapfly failed ${res.status}: ${text.slice(0, 500)}`);
    }

    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Scrapfly returned non-JSON: ${text.slice(0, 500)}`);
    }

    const html = data?.result?.content || "";

    return {
      ok: true,
      status: res.status,
      html,
      finalUrl: data?.result?.url || targetUrl,
      source: "scrapfly",
    };
  }

  const res = await fetch(targetUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  });

  const html = await res.text();

  return {
    ok: res.ok,
    status: res.status,
    html,
    finalUrl: res.url,
    source: "direct",
  };
}
