// Browser-like UA used as a fallback when a site refuses our branded
// Tfila-Bot identity. Some WAFs (Cloudflare, etc.) return 406/403 for
// non-browser User-Agents, even when we identify ourselves honestly.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BROWSER_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  ok: boolean;
  /** True when we fell back to a browser UA after the branded UA was refused. */
  fellBackToBrowserUa: boolean;
}

async function fetchOnce(
  url: string,
  ua: string,
  timeoutMs: number,
): Promise<{ status: number; html: string; finalUrl: string; ok: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: BROWSER_ACCEPT,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const html = res.ok ? await res.text() : "";
    return {
      status: res.status,
      html,
      finalUrl: res.url,
      ok: res.ok,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a URL with two-tier User-Agent strategy:
 *   1. First attempt: branded "Tfila-Bot/1.0" UA (or whatever
 *      SCRAPER_USER_AGENT is set to). Identifies us to shul
 *      webmasters who check their logs.
 *   2. If the site responds with 403 or 406, retry with a real
 *      Chrome UA so we can still extract the schedule. Some shul
 *      sites are behind WAFs that block non-browser identities.
 *
 * Trade-off: we're polite when politeness works, pragmatic when
 * it doesn't. Either way the scrape happens; either way the /bot
 * page documents what we're doing.
 */
export async function fetchHtml(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const brandedUa =
    process.env.SCRAPER_USER_AGENT?.trim() ||
    "Tfila-Bot/1.0 (+https://tfila.co/bot; contact:hello@tfila.co)";

  // Attempt 1: branded UA
  const first = await fetchOnce(url, brandedUa, timeoutMs);
  if (first.status !== 403 && first.status !== 406) {
    return { url, ...first, fellBackToBrowserUa: false };
  }

  // Attempt 2: browser UA fallback
  const second = await fetchOnce(url, BROWSER_UA, timeoutMs);
  return { url, ...second, fellBackToBrowserUa: true };
}
