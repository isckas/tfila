// Extraction cascade orchestrator.
//
// Tries progressively more expensive strategies for getting minyan
// rules out of a URL:
//
//   1. HTML       — fetch + extract from raw HTML (cheapest)
//   2. JS-rendered — fetch through Browserless (runs JS) + HTML extract
//   3. Vision     — find a schedule-looking <img>, send to Claude w/ vision
//   4. PDF        — find a .pdf link on the page, send to Claude
//   5. Failed     — give up, mark the shul unsupported
//
// Vision runs BEFORE PDF deliberately: shul-published schedule images
// are typically small (~100KB), clean single-page snapshots, while
// shul bulletin PDFs are often multi-MB multi-page documents with the
// schedule buried among announcements/ads. Vision is faster and
// usually higher-signal per dollar when both are available.
//
// Each tier only runs if the previous one yielded no useful rules. The
// strategy that succeeded is persisted on data_source so weekly
// rescrapes skip the cascade and go straight to the known-good tier.

import { fetchHtml } from "../scrapers/fetch";
import { renderHtml } from "../scrapers/render";
import { extractFromHtml, type ExtractionResult } from "./extract";
import { extractFromPdfUrl, type PdfExtractionResult } from "./extract-pdf";
import {
  extractFromImageUrl,
  type VisionExtractionResult,
} from "./extract-vision";
import { extractFromUrlWithFallback } from "./extract-with-fallback";
import { z } from "zod";

const MIN_USEFUL_CONFIDENCE = 0.4;

export type ExtractionStrategy =
  | "html"
  | "js_rendered"
  | "pdf_document"
  | "vision_image"
  | "failed";

// Zod schema for one cascade attempt. Used by admin UI (and any future
// consumer) to validate `configJson.cascade_attempts` at read time.
// Drizzle types `configJson` as `unknown` since it's JSONB, so without
// this schema the admin UI silently swallows shape drift.
export const CascadeAttemptSchema = z.object({
  strategy: z.enum([
    "html",
    "js_rendered",
    "pdf_document",
    "vision_image",
    "failed",
  ]),
  status: z.enum(["extracted", "fetch_failed", "extract_failed", "skipped"]),
  rulesCount: z.number().int(),
  confidence: z.number().nullable(),
  resourceUrl: z.string().optional(),
  httpStatus: z.number().int().optional(),
  errorMessage: z.string().optional(),
});

export const CascadeAttemptsSchema = z.array(CascadeAttemptSchema);

export type CascadeAttempt = z.infer<typeof CascadeAttemptSchema>;

/**
 * Read a `cascade_attempts` array out of a `configJson` blob safely.
 * Returns an empty array (not null) on missing/malformed input so
 * the UI can render unconditionally.
 *
 * Logs a console.warn in dev if validation strips fields, so we
 * notice shape drift early.
 */
export function parseCascadeAttempts(raw: unknown): CascadeAttempt[] {
  if (!raw) return [];
  const result = CascadeAttemptsSchema.safeParse(raw);
  if (!result.success) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[cascade] cascade_attempts failed schema validation:",
        result.error.issues.slice(0, 3),
      );
    }
    return [];
  }
  return result.data;
}

export interface CascadeResult {
  strategy: ExtractionStrategy;
  /** Null when strategy = 'failed'. */
  extraction: ExtractionResult["extraction"] | null;
  model: string | null;
  pageContentHash: string | null;
  /** Per-tier usage records; only populated for tiers that ran. */
  usage: Record<string, unknown>;
  /** The URL that produced the winning extraction. */
  winningUrl: string;
  attempts: CascadeAttempt[];
}

interface CascadeOpts {
  /** When set, skip directly to this tier (used by weekly rescrapes). */
  preferredStrategy?: ExtractionStrategy;
  timeoutMs?: number;
  /**
   * Shul ID — accepted for caller convenience / logging but not required by
   * the cascade. (Was used by the retired v2 context preamble.)
   */
  shulId?: number;
}

function isUseful(rules: number, confidence: number): boolean {
  return rules > 0 && confidence >= MIN_USEFUL_CONFIDENCE;
}

// NOTE: the v2 agent-loop pipeline (router + agent-loop + 5 tools + critique +
// Jina/Docling) and its EXTRACTION_PIPELINE_V2 / EXTRACTION_V2_SHUL_IDS feature
// flags were retired in the P1 consolidation. v2 underperformed v1 (0.527 avg
// confidence vs v1's working canary) and its extra per-shul LLM calls amplified
// the 2026-05-24 429 storm. v1 is now the only pipeline. See plan E-DECISION-1.

/**
 * Find PDF links on a page. Accepts multiple HTML sources (e.g. static
 * + JS-rendered) because Browserless's rendered output sometimes strips
 * links present in the static HTML (saw this with theshul.org's
 * weekly-magazine PDF). Dedupes by absolute URL.
 *
 * Ranks by URL keywords — link text is often unhelpful since many sites
 * wrap PDF links around <img> thumbnails rather than text.
 */
function findPdfCandidates(htmls: string[], baseUrl: string): string[] {
  const seen = new Set<string>();
  const ranked: Array<{ url: string; rank: number }> = [];
  for (const html of htmls) {
    if (!html) continue;
    const matches = Array.from(
      html.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi),
    );
    for (const m of matches) {
      const href = m[1];
      let absUrl: string;
      try {
        absUrl = new URL(href, baseUrl).toString();
      } catch {
        continue;
      }
      if (seen.has(absUrl)) continue;
      seen.add(absUrl);
      const combined = absUrl.toLowerCase();
      let rank = 0;
      if (/(schedule|minyan|davening|bulletin|weekly|magazine|times|zmanim|tefilla)/.test(combined)) rank += 10;
      if (/(parsha|parashas|behar|bamidbar|vayikra|shabbos|shabbat)/.test(combined)) rank += 5;
      if (/(donation|sponsor|partner|fundrais|membership|brochure|application)/.test(combined)) rank -= 20;
      ranked.push({ url: absUrl, rank });
    }
  }
  // Cap at 1 — bulletin PDFs are slow to fetch + process; if the
  // best-scored candidate doesn't yield rules, the next is unlikely
  // to either, and we'd blow the function timeout.
  return ranked
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 1)
    .map((r) => r.url);
}

/**
 * Find candidate schedule images. Accepts multiple HTML sources because
 * some sites have empty `src` attrs in static HTML (e.g. anash.ca/daven's
 * `<img id="daven-image" src="" />` populated by JS), while others have
 * the working URLs in static but not rendered.
 *
 * Heuristics: alt text / IDs / classes mentioning schedule keywords,
 * file extensions, etc.
 */
function findImageCandidates(htmls: string[], baseUrl: string): string[] {
  const seen = new Set<string>();
  const ranked: Array<{ url: string; rank: number }> = [];
  for (const html of htmls) {
    if (!html) continue;
    const matches = Array.from(html.matchAll(/<img\b([^>]*)>/gi));
    for (const m of matches) {
      const attrs = m[1];
      const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
      if (!srcMatch) continue;
      const src = srcMatch[1];
      if (!src || src.startsWith("data:")) continue;
      // Skip obvious non-content images
      if (/(logo|icon|favicon|sprite|pixel|tracking|avatar|profile)/i.test(src)) continue;
      let absUrl: string;
      try {
        absUrl = new URL(src, baseUrl).toString();
      } catch {
        continue;
      }
      if (seen.has(absUrl)) continue;
      seen.add(absUrl);
      const altMatch = attrs.match(/\balt=["']([^"']*)["']/i);
      const idMatch = attrs.match(/\bid=["']([^"']*)["']/i);
      const classMatch = attrs.match(/\bclass=["']([^"']*)["']/i);
      const combined = (
        src +
        " " +
        (altMatch?.[1] ?? "") +
        " " +
        (idMatch?.[1] ?? "") +
        " " +
        (classMatch?.[1] ?? "")
      ).toLowerCase();
      let rank = 0;
      if (/(schedule|davening|daven|minyan|bulletin|times|zmanim|tefilla)/.test(combined)) rank += 20;
      if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(src)) rank += 2;
      if (/(banner|hero|cover|background)/i.test(combined)) rank -= 5;
      ranked.push({ url: absUrl, rank });
    }
  }
  return ranked
    .filter((r) => r.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .map((r) => r.url);
}

/**
 * Top-level cascade entry point. Runs the 4-tier extraction cascade
 * (HTML → JS-rendered → Vision → PDF) behind a cost circuit-breaker.
 */
export async function runCascade(
  submittedUrl: string,
  opts: CascadeOpts = {},
): Promise<CascadeResult> {
  // Cost circuit-breaker. Two short-circuit conditions:
  //   - EXTRACTION_DISABLED=true (kill switch for an incident)
  //   - Today's LLM spend exceeds LLM_DAILY_BUDGET_USD (soft cap)
  // Either returns a failed cascade result with a marker error message so
  // the data source row records the bail rather than silently 200ing.
  const { checkCostGate } = await import("./cost-gate");
  const gate = await checkCostGate();
  if (!gate.allowed) {
    const msg =
      gate.reason === "kill_switch"
        ? "extraction disabled via EXTRACTION_DISABLED kill switch"
        : `daily LLM budget exceeded (today $${gate.todayUsd?.toFixed(2)} / cap $${gate.budgetUsd?.toFixed(2)})`;
    console.warn("[cascade] cost-gated:", msg);
    return {
      strategy: "failed",
      extraction: null,
      model: null,
      pageContentHash: null,
      usage: {},
      winningUrl: submittedUrl,
      attempts: [
        {
          strategy: "failed",
          status: "skipped",
          rulesCount: 0,
          confidence: null,
          errorMessage: msg,
        },
      ],
    };
  }

  return runCascadeV1Internal(submittedUrl, opts);
}

async function runCascadeV1Internal(
  submittedUrl: string,
  opts: CascadeOpts = {},
): Promise<CascadeResult> {
  const attempts: CascadeAttempt[] = [];
  const usage: Record<string, unknown> = {};
  const timeoutMs = opts.timeoutMs ?? 25_000;

  let html: string | null = null;
  let renderedHtml: string | null = null;
  let baseUrl = submittedUrl;

  // ─── Tier 1: HTML ───────────────────────────────────────────
  if (!opts.preferredStrategy || opts.preferredStrategy === "html") {
    try {
      // Use the existing same-origin URL fallback (PR 21) so /calendar →
      // /worship/shabbat etc still works at this tier.
      const r = await extractFromUrlWithFallback(submittedUrl, { timeoutMs });
      attempts.push({
        strategy: "html",
        status: "extracted",
        rulesCount: r.result.extraction.rules.length,
        confidence: r.result.extraction.confidence,
        resourceUrl: r.winningUrl,
      });
      // Capture html for later tiers if needed.
      try {
        const fetched = await fetchHtml(r.winningUrl, { timeoutMs });
        if (fetched.ok) {
          html = fetched.html;
          baseUrl = r.winningUrl;
        }
      } catch {
        // non-fatal
      }
      if (
        isUseful(
          r.result.extraction.rules.length,
          r.result.extraction.confidence,
        )
      ) {
        usage["html"] = r.result.usage;
        return {
          strategy: "html",
          extraction: r.result.extraction,
          model: r.result.model,
          pageContentHash: r.result.pageContentHash,
          usage,
          winningUrl: r.winningUrl,
          attempts,
        };
      }
      usage["html"] = r.result.usage;
    } catch (err) {
      attempts.push({
        strategy: "html",
        status: "extract_failed",
        rulesCount: 0,
        confidence: null,
        errorMessage: (err as Error).message.slice(0, 120),
      });
      // Try to grab the html anyway for later tiers
      try {
        const fetched = await fetchHtml(submittedUrl, { timeoutMs });
        if (fetched.ok) html = fetched.html;
      } catch {
        // non-fatal
      }
    }
  } else {
    attempts.push({
      strategy: "html",
      status: "skipped",
      rulesCount: 0,
      confidence: null,
    });
  }

  // ─── Tier 2: JS rendered ────────────────────────────────────
  if (!opts.preferredStrategy || opts.preferredStrategy === "js_rendered") {
    const rendered = await renderHtml(submittedUrl, { timeoutMs });
    if (rendered.ok && rendered.html) {
      renderedHtml = rendered.html;
      // Re-run HTML extraction on the rendered output.
      try {
        const r = await extractFromHtml(rendered.html);
        attempts.push({
          strategy: "js_rendered",
          status: "extracted",
          rulesCount: r.extraction.rules.length,
          confidence: r.extraction.confidence,
          resourceUrl: submittedUrl,
        });
        usage["js_rendered"] = r.usage;
        if (isUseful(r.extraction.rules.length, r.extraction.confidence)) {
          return {
            strategy: "js_rendered",
            extraction: r.extraction,
            model: r.model,
            pageContentHash: r.pageContentHash,
            usage,
            winningUrl: submittedUrl,
            attempts,
          };
        }
      } catch (err) {
        attempts.push({
          strategy: "js_rendered",
          status: "extract_failed",
          rulesCount: 0,
          confidence: null,
          errorMessage: (err as Error).message.slice(0, 120),
        });
      }
    } else {
      attempts.push({
        strategy: "js_rendered",
        status: "fetch_failed",
        rulesCount: 0,
        confidence: null,
        errorMessage: rendered.error,
      });
    }
  } else {
    attempts.push({
      strategy: "js_rendered",
      status: "skipped",
      rulesCount: 0,
      confidence: null,
    });
  }

  // Scan BOTH static and rendered HTML for PDF/image candidates and
  // dedupe by absolute URL. Browserless's rendered output sometimes
  // strips links that exist in the static HTML (saw this with
  // theshul.org's weekly-magazine PDF link).
  const searchHtmls = [renderedHtml, html].filter(
    (h): h is string => typeof h === "string" && h.length > 0,
  );

  // ─── Tier 3: Vision ─────────────────────────────────────────
  // Runs BEFORE PDF — schedule images are typically small + clean;
  // bulletin PDFs are multi-MB and slow to process.
  if (!opts.preferredStrategy || opts.preferredStrategy === "vision_image") {
    if (searchHtmls.length === 0) {
      attempts.push({
        strategy: "vision_image",
        status: "skipped",
        rulesCount: 0,
        confidence: null,
        errorMessage: "no HTML available to scan for schedule images",
      });
    } else {
      const imgCandidates = findImageCandidates(searchHtmls, baseUrl);
      if (imgCandidates.length === 0) {
        attempts.push({
          strategy: "vision_image",
          status: "skipped",
          rulesCount: 0,
          confidence: null,
          errorMessage:
            "no schedule-looking images on the page (alt/id/class with 'schedule|davening|minyan|bulletin' etc.)",
        });
      }
      // Accumulate usage across all attempted candidates. Vision tier
      // tries up to 3 images — if we only stored r.usage on each step
      // (overwrite), cost-tracking would only see the last candidate.
      const visionUsages: unknown[] = [];
      for (const imgUrl of imgCandidates) {
        try {
          const r = await extractFromImageUrl(imgUrl);
          visionUsages.push(r.usage);
          attempts.push({
            strategy: "vision_image",
            status: "extracted",
            rulesCount: r.extraction.rules.length,
            confidence: r.extraction.confidence,
            resourceUrl: imgUrl,
          });
          if (isUseful(r.extraction.rules.length, r.extraction.confidence)) {
            usage["vision_image"] = visionUsages;
            return {
              strategy: "vision_image",
              extraction: r.extraction,
              model: r.model,
              pageContentHash: null,
              usage,
              winningUrl: imgUrl,
              attempts,
            };
          }
        } catch (err) {
          attempts.push({
            strategy: "vision_image",
            status: "extract_failed",
            rulesCount: 0,
            confidence: null,
            resourceUrl: imgUrl,
            errorMessage: (err as Error).message.slice(0, 200),
          });
        }
      }
      if (visionUsages.length > 0) usage["vision_image"] = visionUsages;
    }
  } else {
    attempts.push({
      strategy: "vision_image",
      status: "skipped",
      rulesCount: 0,
      confidence: null,
      errorMessage: `pinned to ${opts.preferredStrategy}`,
    });
  }

  // ─── Tier 4: PDF ────────────────────────────────────────────
  // Last resort — bulletin PDFs are slow (multi-page, multi-MB).
  // Capped at 1 candidate to stay within Vercel function timeouts.
  if (!opts.preferredStrategy || opts.preferredStrategy === "pdf_document") {
    if (searchHtmls.length === 0) {
      attempts.push({
        strategy: "pdf_document",
        status: "skipped",
        rulesCount: 0,
        confidence: null,
        errorMessage: "no HTML available to scan for PDF links",
      });
    } else {
      const pdfCandidates = findPdfCandidates(searchHtmls, baseUrl);
      if (pdfCandidates.length === 0) {
        attempts.push({
          strategy: "pdf_document",
          status: "skipped",
          rulesCount: 0,
          confidence: null,
          errorMessage: "no .pdf links found on the page",
        });
      }
      // Accumulate usage across all attempted PDFs (same pattern as
      // Vision tier above). PDF tier is currently capped at 1 candidate
      // so this is defensive — keeps the shape consistent if the cap
      // ever loosens.
      const pdfUsages: unknown[] = [];
      for (const pdfUrl of pdfCandidates) {
        try {
          const r = await extractFromPdfUrl(pdfUrl);
          pdfUsages.push(r.usage);
          attempts.push({
            strategy: "pdf_document",
            status: "extracted",
            rulesCount: r.extraction.rules.length,
            confidence: r.extraction.confidence,
            resourceUrl: pdfUrl,
          });
          if (isUseful(r.extraction.rules.length, r.extraction.confidence)) {
            usage["pdf_document"] = pdfUsages;
            return {
              strategy: "pdf_document",
              extraction: r.extraction,
              model: r.model,
              pageContentHash: null,
              usage,
              winningUrl: pdfUrl,
              attempts,
            };
          }
        } catch (err) {
          attempts.push({
            strategy: "pdf_document",
            status: "extract_failed",
            rulesCount: 0,
            confidence: null,
            resourceUrl: pdfUrl,
            errorMessage: (err as Error).message.slice(0, 200),
          });
        }
      }
      if (pdfUsages.length > 0) usage["pdf_document"] = pdfUsages;
    }
  } else {
    attempts.push({
      strategy: "pdf_document",
      status: "skipped",
      rulesCount: 0,
      confidence: null,
      errorMessage: `pinned to ${opts.preferredStrategy}`,
    });
  }

  // ─── All tiers exhausted ────────────────────────────────────
  return {
    strategy: "failed",
    extraction: null,
    model: null,
    pageContentHash: null,
    usage,
    winningUrl: submittedUrl,
    attempts,
  };
}

/** Helper used by Inngest/admin route to consume the result. */
export function isFailed(r: CascadeResult): r is CascadeResult & {
  strategy: "failed";
  extraction: null;
} {
  return r.strategy === "failed";
}

// Re-export types for downstream
export type { ExtractionResult, PdfExtractionResult, VisionExtractionResult };
