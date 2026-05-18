// Jina Reader HTML preprocessor.
//
// Hits https://r.jina.ai/<URL> to convert any URL to clean markdown
// via Jina's ReaderLM-v2 (1.5B model trained specifically for HTML →
// markdown conversion). Removes ads, nav, footer, scripts, styling;
// preserves tables and content hierarchy. Often handles JS rendering
// for many pages automatically.
//
// Free tier: 1M tokens/month — at ~150 shuls × ~3K tokens each weekly
// = ~450K/month, well within. Optional JINA_API_KEY env var bumps to
// paid tier when needed.
//
// Per EXTRACTION-ONE-SHOT-PLAN.md → "Jina Reader" section.
// Used by v2 extract.ts as the primary input source; falls back to
// sanitize.ts on Jina failure.

const DEFAULT_TIMEOUT_MS = 25_000;
const JINA_BASE = "https://r.jina.ai/";

export interface JinaReaderResult {
  ok: boolean;
  /** Clean markdown content. Empty when ok=false. */
  markdown: string;
  /** The URL Jina resolved to (after redirects). */
  finalUrl: string;
  /** Approximate token count of the returned markdown (Jina returns this). */
  tokenCount?: number;
  /** When ok=false, why. */
  error?: string;
}

export interface JinaReaderOpts {
  timeoutMs?: number;
  /** If true, request JS-rendered version (slower but handles SPAs). Default false. */
  withJs?: boolean;
}

/**
 * Fetch a URL via Jina Reader. Returns clean markdown ready to feed
 * to an LLM.
 *
 * Failure modes (returns ok=false):
 *   - Network error / timeout
 *   - Jina returns non-2xx (rate limit, upstream 404, etc.)
 *   - Empty body
 */
export async function fetchViaJinaReader(
  url: string,
  opts: JinaReaderOpts = {},
): Promise<JinaReaderResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const jinaUrl = JINA_BASE + url;
  const headers: Record<string, string> = {
    Accept: "text/plain",
    // Ask Jina for plain markdown output (vs JSON envelope)
    "X-Return-Format": "markdown",
  };
  if (opts.withJs) headers["X-Wait-For-Selector"] = "body"; // wait for body before extracting
  if (process.env.JINA_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
  }

  let res: Response;
  try {
    res = await fetch(jinaUrl, { method: "GET", headers, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      markdown: "",
      finalUrl: url,
      error: `jina fetch failed: ${(err as Error).message}`,
    };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return {
      ok: false,
      markdown: "",
      finalUrl: url,
      error: `jina HTTP ${res.status}`,
    };
  }

  const markdown = await res.text();
  if (!markdown || markdown.trim().length === 0) {
    return {
      ok: false,
      markdown: "",
      finalUrl: url,
      error: "jina returned empty body",
    };
  }

  const tokenCount = Number(res.headers.get("x-token-count") ?? "0") || undefined;
  const finalUrl = res.headers.get("x-redirect-url") ?? url;

  return {
    ok: true,
    markdown,
    finalUrl,
    tokenCount,
  };
}

/**
 * Convenience wrapper that returns the markdown string directly, or
 * throws on failure. Use when the caller is OK with exception-based
 * error handling (e.g. inside Inngest step.run).
 */
export async function jinaReaderOrThrow(
  url: string,
  opts: JinaReaderOpts = {},
): Promise<string> {
  const res = await fetchViaJinaReader(url, opts);
  if (!res.ok) {
    throw new Error(`Jina Reader failed for ${url}: ${res.error}`);
  }
  return res.markdown;
}
