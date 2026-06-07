import { fetchHtml } from "../scrapers/fetch";
import {
  extractFromHtml,
  type ExtractionResult,
  ExtractionError,
} from "./extract";

// Paths to try on the same origin if the submitted URL yields nothing.
// Ordered by observed likelihood: Reform shuls put service times under
// /worship/*, Orthodox shuls often use /minyan or /services.
const CANDIDATE_PATHS = [
  "/worship/shabbat",
  "/services",
  "/service-times",
  "/schedule",
  "/minyan",
] as const;

// "Useful at all" — anything below counts as a miss and triggers fallback.
const MIN_USEFUL_CONFIDENCE = 0.4;
// "Good enough" — short-circuit and stop trying further candidates.
const GOOD_ENOUGH_CONFIDENCE = 0.6;

export interface FallbackAttempt {
  url: string;
  status: "extracted" | "fetch_failed" | "extract_failed";
  rulesCount: number;
  confidence: number | null;
  httpStatus?: number;
  errorMessage?: string;
}

export interface ExtractWithFallbackResult {
  result: ExtractionResult;
  winningUrl: string;
  usedFallback: boolean;
  attempts: FallbackAttempt[];
}

function isUseful(r: ExtractionResult): boolean {
  return (
    r.extraction.rules.length > 0 &&
    r.extraction.confidence >= MIN_USEFUL_CONFIDENCE
  );
}

function isGoodEnough(r: ExtractionResult): boolean {
  return (
    r.extraction.rules.length > 0 &&
    r.extraction.confidence >= GOOD_ENOUGH_CONFIDENCE
  );
}

function deriveCandidates(submittedUrl: string): string[] {
  let origin: string;
  let submittedPath: string;
  try {
    const u = new URL(submittedUrl);
    origin = u.origin;
    submittedPath = u.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return [];
  }
  return CANDIDATE_PATHS.filter((p) => p !== submittedPath).map(
    (p) => origin + p,
  );
}

export async function extractFromUrlWithFallback(
  submittedUrl: string,
  opts: { timeoutMs?: number } = {},
): Promise<ExtractWithFallbackResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const attempts: FallbackAttempt[] = [];

  const first = await tryOne(submittedUrl, timeoutMs);
  attempts.push(first.attempt);
  if (first.result && isUseful(first.result)) {
    return {
      result: first.result,
      winningUrl: submittedUrl,
      usedFallback: false,
      attempts,
    };
  }

  let best = first.result;
  let bestUrl = submittedUrl;
  for (const url of deriveCandidates(submittedUrl)) {
    const next = await tryOne(url, timeoutMs);
    attempts.push(next.attempt);
    if (!next.result) continue;
    if (isGoodEnough(next.result)) {
      return {
        result: next.result,
        winningUrl: url,
        usedFallback: true,
        attempts,
      };
    }
    if (
      best == null ||
      (next.result.extraction.rules.length > 0 &&
        next.result.extraction.confidence > best.extraction.confidence)
    ) {
      best = next.result;
      bestUrl = url;
    }
  }

  if (!best) {
    // Surface the per-candidate fetch/extract errors in the thrown message so
    // the cascade's transient classifier (isTransientCascadeFailure) can see a
    // transient token (DNS blip / 429 / timeout) that otherwise lived only in
    // a discarded inner attempt. A DNS blip hits every same-origin candidate
    // identically, so the FIRST error carries the token (kept at the front so
    // it survives the cascade's errorMessage slice). Without this, an
    // all-candidates-transiently-failed rescrape was misclassified TERMINAL and
    // the shul wrongly marked broken — the exact plan C1/M2 failure mode.
    const innerErrors = attempts
      .map((a) => a.errorMessage)
      .filter(Boolean)
      .join(" | ");
    throw new ExtractionError(
      `${innerErrors ? `${innerErrors}. ` : ""}No URL on ${submittedUrl}'s origin yielded extractable rules. Tried: ${attempts
        .map((a) => a.url)
        .join(", ")}`,
    );
  }
  return {
    result: best,
    winningUrl: bestUrl,
    usedFallback: bestUrl !== submittedUrl,
    attempts,
  };
}

async function tryOne(
  url: string,
  timeoutMs: number,
): Promise<{ result: ExtractionResult | null; attempt: FallbackAttempt }> {
  let fetched;
  try {
    fetched = await fetchHtml(url, { timeoutMs });
  } catch (err) {
    return {
      result: null,
      attempt: {
        url,
        status: "fetch_failed",
        rulesCount: 0,
        confidence: null,
        errorMessage: (err as Error).message.slice(0, 100),
      },
    };
  }
  if (!fetched.ok || !fetched.html) {
    return {
      result: null,
      attempt: {
        url,
        status: "fetch_failed",
        rulesCount: 0,
        confidence: null,
        httpStatus: fetched.status,
      },
    };
  }
  let result: ExtractionResult;
  try {
    result = await extractFromHtml(fetched.html);
  } catch (err) {
    return {
      result: null,
      attempt: {
        url,
        status: "extract_failed",
        rulesCount: 0,
        confidence: null,
        errorMessage: (err as Error).message.slice(0, 100),
      },
    };
  }
  return {
    result,
    attempt: {
      url,
      status: "extracted",
      rulesCount: result.extraction.rules.length,
      confidence: result.extraction.confidence,
    },
  };
}
