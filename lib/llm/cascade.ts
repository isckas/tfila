// Extraction cascade orchestrator.
//
// Tries progressively more expensive strategies for getting minyan
// rules out of a URL:
//
//   1. HTML       — fetch + extract from raw HTML (cheapest)
//   2. JS-rendered — fetch through Browserless (runs JS) + HTML extract
//   3. PDF        — find a .pdf link on the page, send to Claude
//   4. Vision     — find a schedule-looking <img>, send to Claude w/ vision
//   5. Failed     — give up, mark the shul unsupported
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

const MIN_USEFUL_CONFIDENCE = 0.4;

export type ExtractionStrategy =
  | "html"
  | "js_rendered"
  | "pdf_document"
  | "vision_image"
  | "failed";

export interface CascadeAttempt {
  strategy: ExtractionStrategy;
  status: "extracted" | "fetch_failed" | "extract_failed" | "skipped";
  rulesCount: number;
  confidence: number | null;
  resourceUrl?: string;
  errorMessage?: string;
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
}

function isUseful(rules: number, confidence: number): boolean {
  return rules > 0 && confidence >= MIN_USEFUL_CONFIDENCE;
}

/**
 * Find PDF links on a page. We bias toward links whose URL or anchor
 * text contains schedule-y keywords.
 */
function findPdfCandidates(html: string, baseUrl: string): string[] {
  const matches = Array.from(
    html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf[^"']*)["'][^>]*>([^<]*)<\/a>/gi),
  );
  const ranked: Array<{ url: string; rank: number }> = [];
  for (const m of matches) {
    const href = m[1];
    const text = (m[2] || "").toLowerCase();
    const combined = (href + " " + text).toLowerCase();
    let rank = 0;
    if (/(schedule|minyan|davening|bulletin|weekly|magazine|times)/.test(combined)) rank += 10;
    if (/(parsha|parashas|behar|shabbos|shabbat)/.test(combined)) rank += 5;
    if (/(donation|sponsor|partner|fundrais|membership)/.test(combined)) rank -= 20;
    let absUrl: string;
    try {
      absUrl = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    ranked.push({ url: absUrl, rank });
  }
  return ranked
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .map((r) => r.url);
}

/**
 * Find candidate schedule images. Heuristics: large-looking image
 * URLs, alt text mentioning schedule/davening/minyan, IDs/classes
 * mentioning the same.
 */
function findImageCandidates(html: string, baseUrl: string): string[] {
  const matches = Array.from(
    html.matchAll(/<img\b([^>]*)>/gi),
  );
  const ranked: Array<{ url: string; rank: number }> = [];
  for (const m of matches) {
    const attrs = m[1];
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    if (!src || src.startsWith("data:")) continue;
    // Skip obvious non-content images
    if (/(logo|icon|favicon|sprite|pixel|tracking|avatar|profile)/i.test(src)) continue;
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
    if (/(schedule|davening|daven|minyan|bulletin|times|zmanim)/.test(combined)) rank += 20;
    if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(src)) rank += 2;
    if (/(banner|hero|cover|background)/i.test(combined)) rank -= 5;
    let absUrl: string;
    try {
      absUrl = new URL(src, baseUrl).toString();
    } catch {
      continue;
    }
    ranked.push({ url: absUrl, rank });
  }
  return ranked
    .filter((r) => r.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .map((r) => r.url);
}

export async function runCascade(
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

  // Prefer the JS-rendered HTML (more complete) when looking for PDFs/images.
  const searchHtml = renderedHtml ?? html;

  // ─── Tier 3: PDF ────────────────────────────────────────────
  if (!opts.preferredStrategy || opts.preferredStrategy === "pdf_document") {
    if (searchHtml) {
      const pdfCandidates = findPdfCandidates(searchHtml, baseUrl);
      for (const pdfUrl of pdfCandidates) {
        try {
          const r = await extractFromPdfUrl(pdfUrl);
          attempts.push({
            strategy: "pdf_document",
            status: "extracted",
            rulesCount: r.extraction.rules.length,
            confidence: r.extraction.confidence,
            resourceUrl: pdfUrl,
          });
          usage["pdf_document"] = r.usage;
          if (
            isUseful(r.extraction.rules.length, r.extraction.confidence)
          ) {
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
            errorMessage: (err as Error).message.slice(0, 120),
          });
        }
      }
    } else {
      attempts.push({
        strategy: "pdf_document",
        status: "skipped",
        rulesCount: 0,
        confidence: null,
      });
    }
  }

  // ─── Tier 4: Vision ─────────────────────────────────────────
  if (!opts.preferredStrategy || opts.preferredStrategy === "vision_image") {
    if (searchHtml) {
      const imgCandidates = findImageCandidates(searchHtml, baseUrl);
      for (const imgUrl of imgCandidates) {
        try {
          const r = await extractFromImageUrl(imgUrl);
          attempts.push({
            strategy: "vision_image",
            status: "extracted",
            rulesCount: r.extraction.rules.length,
            confidence: r.extraction.confidence,
            resourceUrl: imgUrl,
          });
          usage["vision_image"] = r.usage;
          if (
            isUseful(r.extraction.rules.length, r.extraction.confidence)
          ) {
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
            errorMessage: (err as Error).message.slice(0, 120),
          });
        }
      }
    } else {
      attempts.push({
        strategy: "vision_image",
        status: "skipped",
        rulesCount: 0,
        confidence: null,
      });
    }
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
