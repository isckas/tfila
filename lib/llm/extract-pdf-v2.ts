// v2 PDF extraction.
//
// Strategy:
//   1. If Docling is configured (DOCLING_URL env), preprocess the PDF
//      through it → clean markdown with table structure preserved.
//      Then feed that markdown to the same agent pipeline as
//      extract-v2 (HTML path). Much higher accuracy on complex
//      multi-page bulletins than direct-PDF-to-Claude-as-base64.
//
//   2. If Docling is not configured (notConfigured=true) OR fails,
//      fall through to the existing v1 extract-pdf.ts path
//      (PDF as base64 → Claude). This keeps v2 shipping even before
//      Docling is deployed.
//
// When Docling preprocesses successfully, we run the markdown through
// extractFromHtmlV2 — which gives us the full v2 agent pipeline (5
// tools, context preamble, critique pass) for free, without
// duplicating the orchestration code.
//
// Per EXTRACTION-ONE-SHOT-PLAN.md step 10.

import { fetchViaDocling } from "../scrapers/docling";
import { extractFromHtmlV2 } from "./extract-v2";
import { extractFromPdfUrl, type PdfExtractionResult } from "./extract-pdf";

export interface ExtractPdfV2Args {
  pdfUrl: string;
  shulId: number;
  skipCritique?: boolean;
  priorRuleCount?: number;
}

export interface PdfExtractionV2Result extends PdfExtractionResult {
  v2Meta?: {
    /** Did Docling successfully preprocess, or did we fall back? */
    preprocessor: "docling" | "direct-claude-fallback";
    /** Docling page count when applicable. */
    pageCount?: number;
    /** Critique pass fired and changed the extraction. */
    critiqued?: boolean;
  };
}

export async function extractFromPdfV2(
  args: ExtractPdfV2Args,
): Promise<PdfExtractionV2Result> {
  // ─── Try Docling preprocess
  const docling = await fetchViaDocling(args.pdfUrl);
  if (!docling.ok) {
    // Docling not configured OR failed. Fall back to v1's
    // PDF-as-base64 → Claude path. No agent loop, no context
    // preamble, no critique — but it works today.
    const fallback = await extractFromPdfUrl(args.pdfUrl);
    return {
      ...fallback,
      v2Meta: {
        preprocessor: "direct-claude-fallback",
      },
    };
  }

  // ─── Docling succeeded. Feed clean markdown into the v2 HTML agent
  // pipeline. Same context preamble, same 5 tools, same critique trigger
  // — Docling just replaces the input source.
  const result = await extractFromHtmlV2({
    source: { kind: "markdown", markdown: docling.markdown },
    shulId: args.shulId,
    skipCritique: args.skipCritique,
    priorRuleCount: args.priorRuleCount,
  });

  return {
    extraction: result.extraction,
    model: result.model,
    pdfUrl: args.pdfUrl,
    usage: result.usage,
    v2Meta: {
      preprocessor: "docling",
      pageCount: docling.pageCount,
      critiqued: result.v2Meta?.critiqued,
    },
  };
}
