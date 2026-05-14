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
  /** True when we further fell back to the Cloudflare Worker proxy
   *  because both UA attempts from Vercel were blocked (403/406). */
  fellBackToCfProxy?: boolean;
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

async function fetchViaCfProxy(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; html: string; finalUrl: string; ok: boolean } | null> {
  const proxyUrl = process.env.FETCH_PROXY_URL?.trim();
  const proxyToken = process.env.FETCH_PROXY_TOKEN?.trim();
  if (!proxyUrl || !proxyToken) return null;

  const u = new URL(proxyUrl);
  u.searchParams.set("url", url);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${proxyToken}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // Worker itself errored (auth failed, target invalid, upstream
      // timeout). Treat as fetch failure so caller can record it.
      return {
        status: res.status,
        html: "",
        finalUrl: url,
        ok: false,
      };
    }
    // Worker mirrors upstream status into a header; body is the upstream payload.
    const upstreamStatus = Number(res.headers.get("X-Original-Status") ?? "0");
    const upstreamUrl = res.headers.get("X-Original-Url") ?? url;
    const html = await res.text();
    return {
      status: upstreamStatus || res.status,
      html: upstreamStatus >= 200 && upstreamStatus < 300 ? html : "",
      finalUrl: upstreamUrl,
      ok: upstreamStatus >= 200 && upstreamStatus < 300,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a URL with three-tier strategy:
 *   1. Branded "Tfila-Bot/1.0" UA (or SCRAPER_USER_AGENT). Identifies
 *      us to shul webmasters who check their logs.
 *   2. If 403/406, retry with a real Chrome UA. Some WAFs reject
 *      non-browser identities.
 *   3. If STILL 403/406 AND a Cloudflare Worker proxy is configured
 *      (FETCH_PROXY_URL + FETCH_PROXY_TOKEN), retry through the
 *      Worker. Cloudflare's edge IPs aren't typically caught by the
 *      same anti-bot blocks that flag Vercel/AWS outbound (the
 *      concrete trigger: Chabad.org's CMS 403'ing iad1 fetches).
 *
 * Trade-off: polite when politeness works, pragmatic when it doesn't.
 * The /bot page documents what we're doing.
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
  if (second.status !== 403 && second.status !== 406) {
    return { url, ...second, fellBackToBrowserUa: true };
  }

  // Attempt 3: Cloudflare Worker proxy. Only fires when both direct
  // attempts were blocked AND the proxy is configured.
  const proxied = await fetchViaCfProxy(url, timeoutMs);
  if (proxied) {
    return {
      url,
      ...proxied,
      fellBackToBrowserUa: true,
      fellBackToCfProxy: true,
    };
  }

  // No proxy configured or the proxy itself failed — return the second
  // attempt's result so the caller still sees a 403/406 (vs. a confusing
  // empty success).
  return { url, ...second, fellBackToBrowserUa: true };
}
