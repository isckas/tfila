// Docling PDF preprocessor.
//
// Docling is IBM's open-source PDF parser — agentic OCR + layout
// detection + table-structure preservation. Self-hosted (Python), free
// forever. Run it as a separate service (Vercel Python serverless,
// Render hobby instance, Cloudflare Worker via Python wasm, etc.) and
// point DOCLING_URL at it.
//
// When DOCLING_URL is unset, fetchViaDocling returns ok=false so the
// caller can fall back to the existing direct-Claude-on-PDF path. This
// lets v2 ship the integration code without blocking on deployment.
//
// Per EXTRACTION-ONE-SHOT-PLAN.md → "Docling" section.

const DEFAULT_TIMEOUT_MS = 60_000;

export interface DoclingResult {
  ok: boolean;
  /** Clean markdown with table structure preserved. Empty when ok=false. */
  markdown: string;
  /** Number of pages parsed (informational). */
  pageCount?: number;
  /** When ok=false, why. */
  error?: string;
  /** When ok=false because Docling isn't configured (vs failed). */
  notConfigured?: boolean;
}

export interface DoclingOpts {
  timeoutMs?: number;
}

/**
 * Send a PDF URL to Docling for parsing. Returns clean markdown.
 *
 * If DOCLING_URL is unset, returns { ok: false, notConfigured: true }
 * so callers can fall back gracefully (e.g. direct PDF-to-Claude path).
 *
 * Expected DOCLING_URL endpoint contract:
 *   POST <DOCLING_URL>/parse
 *   body: { url: "https://..." }
 *   response: { markdown: string, pageCount?: number }
 *
 * If your hosting differs (e.g. exposes a different path or accepts
 * the PDF body directly), update this function to match.
 */
export async function fetchViaDocling(
  pdfUrl: string,
  opts: DoclingOpts = {},
): Promise<DoclingResult> {
  const baseUrl = process.env.DOCLING_URL?.trim();
  if (!baseUrl) {
    return {
      ok: false,
      markdown: "",
      notConfigured: true,
      error:
        "DOCLING_URL env var is not set — Docling not configured. Caller should fall back to direct PDF-to-Claude.",
    };
  }

  const endpoint = baseUrl.endsWith("/") ? baseUrl + "parse" : baseUrl + "/parse";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.DOCLING_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.DOCLING_TOKEN}`;
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: pdfUrl }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      markdown: "",
      error: `docling fetch failed: ${(err as Error).message}`,
    };
  }
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      markdown: "",
      error: `docling HTTP ${res.status}: ${body.slice(0, 200)}`,
    };
  }

  let json: { markdown?: string; pageCount?: number };
  try {
    json = (await res.json()) as { markdown?: string; pageCount?: number };
  } catch (err) {
    return {
      ok: false,
      markdown: "",
      error: `docling response was not JSON: ${(err as Error).message}`,
    };
  }

  if (!json.markdown || json.markdown.trim().length === 0) {
    return {
      ok: false,
      markdown: "",
      error: "docling returned empty markdown",
    };
  }

  return {
    ok: true,
    markdown: json.markdown,
    pageCount: json.pageCount,
  };
}

/**
 * True iff DOCLING_URL is configured AND a quick health probe succeeds.
 * Useful at boot or for monitoring. Doesn't actually parse anything.
 */
export async function doclingIsAvailable(): Promise<boolean> {
  const baseUrl = process.env.DOCLING_URL?.trim();
  if (!baseUrl) return false;
  const endpoint = baseUrl.endsWith("/") ? baseUrl + "health" : baseUrl + "/health";
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}
