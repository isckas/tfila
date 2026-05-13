// JS-rendered HTML fetcher. Uses Browserless's /content endpoint to
// pre-render pages whose schedule content is injected by client-side
// JavaScript (e.g. anash.ca/daven, some Wix/ShulCloud calendar widgets).
//
// Falls back to null if BROWSERLESS_API_KEY is unset — the cascade
// then skips this tier silently.

export interface RenderResult {
  ok: boolean;
  status: number;
  html: string | null;
  /** Error from Browserless, if any. */
  error?: string;
}

const BROWSERLESS_ENDPOINT = "https://production-sfo.browserless.io/content";

/**
 * Fetches a URL through Browserless. Waits for network-idle so JS
 * has time to populate dynamic content (image srcs, fetch results,
 * etc).
 *
 * Returns ok=false silently when BROWSERLESS_API_KEY is unset, so
 * callers can treat "missing key" the same as "tier failed" without
 * a special case.
 */
// Track whether we've warned about missing key in this process so we
// don't spam Vercel logs on every cascade invocation. Reset between
// cold starts is fine — the warn fires once per cold start, which is
// the right signal frequency.
let warnedMissingKey = false;

export async function renderHtml(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<RenderResult> {
  const key = process.env.BROWSERLESS_API_KEY;
  if (!key) {
    // In production this means the cascade's JS-rendered tier is
    // silently degraded. Surface it once per cold start.
    if (
      process.env.NODE_ENV === "production" &&
      process.env.VERCEL_ENV === "production" &&
      !warnedMissingKey
    ) {
      warnedMissingKey = true;
      console.warn(
        "[scrapers/render] BROWSERLESS_API_KEY not set in production. " +
          "Extraction cascade tier 2 (JS-rendered HTML) will be skipped for every request. " +
          "Add the key in Vercel env to enable.",
      );
    }
    return {
      ok: false,
      status: 0,
      html: null,
      error: "BROWSERLESS_API_KEY not configured",
    };
  }

  const timeoutMs = opts.timeoutMs ?? 30_000;
  const endpoint = new URL(BROWSERLESS_ENDPOINT);
  endpoint.searchParams.set("token", key);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        // gotoOptions tells the underlying Chromium when to consider
        // the page "loaded". networkidle2 = ≤2 network connections
        // open for ≥500ms; good balance for SPAs.
        gotoOptions: {
          waitUntil: "networkidle2",
          timeout: timeoutMs - 2_000,
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      status: 0,
      html: null,
      error: (err as Error).message.slice(0, 120),
    };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      html: null,
      error: `Browserless HTTP ${res.status}`,
    };
  }

  const html = await res.text();
  return {
    ok: true,
    status: res.status,
    html,
  };
}
