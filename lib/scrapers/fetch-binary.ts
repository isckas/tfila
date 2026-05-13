// Binary asset fetcher for PDF + image extraction tiers. Mirrors
// fetch.ts's two-tier UA strategy (branded Tfila-Bot first, browser
// UA fallback on 403/406). Returns the raw bytes + MIME type so
// callers can base64-encode for Claude's document/image blocks.
//
// Why we fetch ourselves instead of letting Anthropic do it: Anthropic's
// URL fetcher respects robots.txt, and ShulCloud's CDN (images.shulcloud.com)
// disallows automated agents in robots.txt. Shul webmasters publish their
// schedules to be read by daveners; the bot block on a shared CDN is
// incidental. We fetch with our own UA + the user submitted the URL.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// 25 MB cap. Bigger than typical shul bulletins (~1-3 MB) but small
// enough to keep Claude requests bounded.
const MAX_BYTES = 25 * 1024 * 1024;

export interface BinaryFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  bytes: Buffer | null;
  mimeType: string | null;
  fellBackToBrowserUa: boolean;
}

async function fetchOnce(
  url: string,
  ua: string,
  timeoutMs: number,
  accept: string,
): Promise<{
  status: number;
  bytes: Buffer | null;
  mimeType: string | null;
  finalUrl: string;
  ok: boolean;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: accept,
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        status: res.status,
        bytes: null,
        mimeType: null,
        finalUrl: res.url,
        ok: false,
      };
    }
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len && len > MAX_BYTES) {
      return {
        status: res.status,
        bytes: null,
        mimeType: res.headers.get("content-type"),
        finalUrl: res.url,
        ok: false,
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return {
        status: res.status,
        bytes: null,
        mimeType: res.headers.get("content-type"),
        finalUrl: res.url,
        ok: false,
      };
    }
    return {
      status: res.status,
      bytes: buf,
      mimeType: res.headers.get("content-type"),
      finalUrl: res.url,
      ok: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBinary(
  url: string,
  opts: { timeoutMs?: number; accept?: string } = {},
): Promise<BinaryFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const accept = opts.accept ?? "*/*";
  const brandedUa =
    process.env.SCRAPER_USER_AGENT?.trim() ||
    "Tfila-Bot/1.0 (+https://tfila.co/bot; contact:hello@tfila.co)";

  const first = await fetchOnce(url, brandedUa, timeoutMs, accept);
  if (first.status !== 403 && first.status !== 406) {
    return { url, fellBackToBrowserUa: false, ...first };
  }
  const second = await fetchOnce(url, BROWSER_UA, timeoutMs, accept);
  return { url, fellBackToBrowserUa: true, ...second };
}

/**
 * Normalize image MIME types to the four Claude accepts.
 * Falls back to detecting from URL extension if header is missing.
 */
export function normalizeImageMimeType(
  contentType: string | null,
  url: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  const lower = (contentType ?? "").toLowerCase();
  if (lower.includes("image/jpeg") || lower.includes("image/jpg")) return "image/jpeg";
  if (lower.includes("image/png")) return "image/png";
  if (lower.includes("image/gif")) return "image/gif";
  if (lower.includes("image/webp")) return "image/webp";
  // Fallback: URL extension
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  return null;
}
