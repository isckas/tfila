// v2 extraction cascade.
//
// Mirrors the v1 cascade tier structure (HTML → JS-rendered → Vision →
// PDF → failed) but uses the v2 extractors at each tier:
//   - Tier 1 HTML: Jina Reader preprocess + router + extractFromHtmlV2
//   - Tier 2 JS-rendered: Browserless + jina-equivalent + extractFromHtmlV2
//   - Tier 3 Vision: extractFromImageUrlV2
//   - Tier 4 PDF: extractFromPdfV2 (uses Docling when configured)
//
// New pre-tier: router classifies the page and can short-circuit
// (about/blog/error pages skip HTML extraction entirely).
//
// Returns the same CascadeResult shape as v1 so the dispatch in
// cascade.ts can swap between v1 and v2 transparently.
//
// Per EXTRACTION-ONE-SHOT-PLAN.md step 13.

import { renderHtml } from "../scrapers/render";
import { fetchViaJinaReader } from "../scrapers/jina-reader";
import { fetchHtml } from "../scrapers/fetch";
import { sanitizeHtmlForLLM } from "../scrapers/sanitize";
import { extractFromHtmlV2 } from "./extract-v2";
import { extractFromImageUrlV2 } from "./extract-vision-v2";
import { extractFromPdfV2 } from "./extract-pdf-v2";
import {
  classifyPage,
  shouldSkipExtraction,
} from "./router";
import type { CascadeAttempt, CascadeResult, ExtractionStrategy } from "./cascade";

const MIN_USEFUL_CONFIDENCE = 0.4;

export interface CascadeV2Opts {
  /** Required for v2 — used by context preamble + critique. */
  shulId: number;
  preferredStrategy?: ExtractionStrategy;
  timeoutMs?: number;
}

function isUseful(rules: number, confidence: number): boolean {
  return rules > 0 && confidence >= MIN_USEFUL_CONFIDENCE;
}

/**
 * Find PDF/image candidates from HTML. Reuses v1's regex-based approach
 * since it works; just imported here to avoid circular references. (v1
 * cascade.ts has the same logic but isn't easily extracted.)
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
      if (
        /(schedule|minyan|davening|bulletin|weekly|magazine|times|zmanim|tefilla)/.test(
          combined,
        )
      )
        rank += 10;
      if (
        /(parsha|parashas|behar|bamidbar|vayikra|shabbos|shabbat)/.test(combined)
      )
        rank += 5;
      if (
        /(donation|sponsor|partner|fundrais|membership|brochure|application)/.test(
          combined,
        )
      )
        rank -= 20;
      ranked.push({ url: absUrl, rank });
    }
  }
  return ranked
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 1)
    .map((r) => r.url);
}

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
      if (/(logo|icon|favicon|sprite|pixel|tracking|avatar|profile)/i.test(src))
        continue;
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
      if (/(schedule|davening|daven|minyan|bulletin|times|zmanim|tefilla)/.test(combined))
        rank += 20;
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

export async function runCascadeV2(
  submittedUrl: string,
  opts: CascadeV2Opts,
): Promise<CascadeResult> {
  const attempts: CascadeAttempt[] = [];
  const usage: Record<string, unknown> = {};
  const timeoutMs = opts.timeoutMs ?? 25_000;

  let html: string | null = null;
  let renderedHtml: string | null = null;
  let baseUrl = submittedUrl;

  // ─── Tier 1: HTML (Jina preprocess + router + v2 extraction)
  if (!opts.preferredStrategy || opts.preferredStrategy === "html") {
    try {
      const jina = await fetchViaJinaReader(submittedUrl, { timeoutMs });
      let markdown: string;
      let inputSource: string;
      if (jina.ok) {
        markdown = jina.markdown;
        inputSource = "jina";
      } else {
        // Fall back to raw fetch + sanitize so cascade still works
        const fetched = await fetchHtml(submittedUrl, { timeoutMs });
        if (fetched.ok) {
          markdown = sanitizeHtmlForLLM(fetched.html);
          html = fetched.html; // keep raw HTML for tier 3/4 candidate scanning
          inputSource = "sanitize-fallback";
        } else {
          throw new Error(`tier 1 fetch failed: ${jina.error}; direct ${fetched.status}`);
        }
      }

      // Router classification
      const cls = await classifyPage(markdown);

      if (shouldSkipExtraction(cls.pageType)) {
        // Not a schedule page (about/blog/error) — record + continue to
        // other tiers since the page MIGHT link to a PDF/image schedule.
        attempts.push({
          strategy: "html",
          status: "skipped",
          rulesCount: 0,
          confidence: null,
          errorMessage: `router: ${cls.pageType} — ${cls.reasoning}`,
        });
      } else {
        // Always try HTML extraction. shouldRerenderJs is now advisory
        // only — recorded in v2Meta but we still attempt HTML first.
        // Reason: BAYT canary showed router classifies extractable
        // calendars as "calendar_widget" and skipping HTML lost 48
        // rules vs v1. JS tier remains as fallback if HTML returns 0.
        const r = await extractFromHtmlV2({
          source: { kind: "markdown", markdown },
          shulId: opts.shulId,
        });
        attempts.push({
          strategy: "html",
          status: "extracted",
          rulesCount: r.extraction.rules.length,
          confidence: r.extraction.confidence,
          resourceUrl: submittedUrl,
        });
        usage["html"] = {
          ...r.usage,
          v2Meta: { ...r.v2Meta, inputSource, routerPageType: cls.pageType },
        };
        if (isUseful(r.extraction.rules.length, r.extraction.confidence)) {
          return {
            strategy: "html",
            extraction: r.extraction,
            model: r.model,
            pageContentHash: r.pageContentHash,
            usage,
            winningUrl: submittedUrl,
            attempts,
          };
        }
      }

      // If we got HTML via fallback, keep it for tier 3/4 candidate scanning
      if (!html) {
        try {
          const fetched = await fetchHtml(submittedUrl, { timeoutMs });
          if (fetched.ok) {
            html = fetched.html;
            baseUrl = submittedUrl;
          }
        } catch {
          // non-fatal
        }
      }
    } catch (err) {
      attempts.push({
        strategy: "html",
        status: "extract_failed",
        rulesCount: 0,
        confidence: null,
        errorMessage: (err as Error).message.slice(0, 120),
      });
    }
  } else {
    attempts.push({
      strategy: "html",
      status: "skipped",
      rulesCount: 0,
      confidence: null,
    });
  }

  // ─── Tier 2: JS rendered
  if (!opts.preferredStrategy || opts.preferredStrategy === "js_rendered") {
    const rendered = await renderHtml(submittedUrl, { timeoutMs });
    if (rendered.ok && rendered.html) {
      renderedHtml = rendered.html;
      try {
        const r = await extractFromHtmlV2({
          source: { kind: "markdown", markdown: sanitizeHtmlForLLM(rendered.html) },
          shulId: opts.shulId,
        });
        attempts.push({
          strategy: "js_rendered",
          status: "extracted",
          rulesCount: r.extraction.rules.length,
          confidence: r.extraction.confidence,
          resourceUrl: submittedUrl,
        });
        usage["js_rendered"] = { ...r.usage, v2Meta: r.v2Meta };
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

  // Scan both static + rendered HTML for tier 3/4 candidates
  const searchHtmls = [renderedHtml, html].filter(
    (h): h is string => typeof h === "string" && h.length > 0,
  );

  // ─── Tier 3: Vision
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
          errorMessage: "no schedule-looking images on the page",
        });
      }
      const visionUsages: unknown[] = [];
      for (const imgUrl of imgCandidates) {
        try {
          const r = await extractFromImageUrlV2({
            imageUrl: imgUrl,
            shulId: opts.shulId,
          });
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

  // ─── Tier 4: PDF
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
      const pdfUsages: unknown[] = [];
      for (const pdfUrl of pdfCandidates) {
        try {
          const r = await extractFromPdfV2({
            pdfUrl,
            shulId: opts.shulId,
          });
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

  // All tiers exhausted
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
