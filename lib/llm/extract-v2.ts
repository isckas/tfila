// v2 HTML extraction. Ties together the v2 pipeline pieces:
//
//   1. Pre-process: Jina Reader → clean markdown
//      (fall back to sanitize.ts on Jina failure)
//   2. Context preamble: buildContextPreamble (shul metadata + Hebcal +
//      prior extraction)
//   3. Claude as agent: messages.create with tool use, 5 mid-extraction
//      tools available, output via emit_extraction tool (structured)
//   4. Sonnet fallback with extended thinking when Haiku confidence < 0.4
//   5. Critique pass when confidence < 0.7 or sharp rule-count drop
//
// Returns the same ExtractionResult shape as v1 extract.ts so the
// cascade dispatch (step 13) can swap between v1 and v2 by feature flag.
//
// Per EXTRACTION-ONE-SHOT-PLAN.md step 9.

import { createHash } from "node:crypto";
import { SYSTEM_PROMPT } from "./prompts";
import { sanitizeHtmlForLLM } from "../scrapers/sanitize";
import { fetchHtml } from "../scrapers/fetch";
import { fetchViaJinaReader } from "../scrapers/jina-reader";
import { buildContextPreamble } from "./build-context";
import { runAgentLoop, AgentLoopError } from "./agent-loop";
import { extractionOutputTool } from "./tools/extraction-output";
import {
  lookupHebrewDate,
  lookupHebrewDateTool,
} from "./tools/hebrew-date";
import {
  getSunsetRange,
  getSunsetRangeTool,
} from "./tools/sunset-range";
import {
  getPreviousExtraction,
  getPreviousExtractionTool,
} from "./tools/previous-extraction";
import { validateRule, validateRuleTool } from "./tools/validate-rule";
import {
  searchHebrewMonth,
  searchHebrewMonthTool,
} from "./tools/hebrew-month";
import {
  critiqueExtraction,
  shouldCritique,
} from "./extract-critique";
import type Anthropic from "@anthropic-ai/sdk";
import type { Extraction } from "./schema";
import type { ExtractionResult, TokenUsage } from "./extract";

const MAX_INPUT_CHARS = 120_000;
const HAIKU_CONFIDENCE_FLOOR = 0.4;

export interface ExtractV2Args {
  /** Provide pre-fetched markdown OR a URL we'll fetch via Jina. */
  source:
    | { kind: "markdown"; markdown: string }
    | { kind: "url"; url: string };
  /** Shul ID for context preamble + critique. */
  shulId: number;
  /** Skip the critique pass even if the trigger fires. */
  skipCritique?: boolean;
  /** Known prior rule count for the shouldCritique() decision. */
  priorRuleCount?: number;
}

/**
 * V2 extraction pipeline. Same return shape as v1 extract.ts so callers
 * can switch between them via feature flag without code changes.
 *
 * Adds:
 *   - extraction.rules[].sourceQuote (required by the tool schema; v1
 *     leaves this absent)
 *   - Audit info available via the underlying agent loop's toolCalls
 *     (not surfaced in ExtractionResult to keep the shape backward-
 *     compatible; the cascade can log if it wants)
 */
export async function extractFromHtmlV2(
  args: ExtractV2Args,
): Promise<ExtractionResult & { v2Meta?: ExtractionV2Meta }> {
  // ─── 1. Get markdown (Jina if URL; raw markdown if pre-fetched)
  let markdown: string;
  let inputSource: "jina" | "sanitize-fallback" | "preprocessed";
  if (args.source.kind === "markdown") {
    markdown = args.source.markdown;
    inputSource = "preprocessed";
  } else {
    const jina = await fetchViaJinaReader(args.source.url);
    if (jina.ok) {
      markdown = jina.markdown;
      inputSource = "jina";
    } else {
      // Fall back to existing fetch + sanitize pipeline so v2 still
      // works when Jina is rate-limited / down / refusing.
      const fetched = await fetchHtml(args.source.url);
      if (!fetched.ok) {
        throw new Error(
          `extractV2: both Jina and direct fetch failed for ${args.source.url}: jina=${jina.error}; direct HTTP ${fetched.status}`,
        );
      }
      markdown = sanitizeHtmlForLLM(fetched.html);
      inputSource = "sanitize-fallback";
    }
  }

  // Truncate aggressively if needed (Anthropic context limit; cost)
  let truncated = false;
  if (markdown.length > MAX_INPUT_CHARS) {
    markdown = markdown.slice(0, MAX_INPUT_CHARS);
    truncated = true;
  }

  // ─── 2. Build context preamble
  const context = await buildContextPreamble({ shulId: args.shulId });

  // ─── 3. Run the agent loop with Haiku
  const userMessage: Anthropic.Messages.MessageParam = {
    role: "user",
    content: assembleUserMessage(context, markdown, truncated),
  };

  const tools: Anthropic.Messages.Tool[] = [
    extractionOutputTool,
    lookupHebrewDateTool,
    getSunsetRangeTool,
    getPreviousExtractionTool,
    validateRuleTool,
    searchHebrewMonthTool,
  ];

  const handlers: Record<string, (input: unknown) => Promise<unknown>> = {
    [lookupHebrewDateTool.name]: (i) =>
      lookupHebrewDate(i as Parameters<typeof lookupHebrewDate>[0]),
    [getSunsetRangeTool.name]: (i) =>
      getSunsetRange(i as Parameters<typeof getSunsetRange>[0]),
    [getPreviousExtractionTool.name]: (i) =>
      getPreviousExtraction(i as Parameters<typeof getPreviousExtraction>[0]),
    [validateRuleTool.name]: (i) =>
      validateRule(i as Parameters<typeof validateRule>[0]),
    [searchHebrewMonthTool.name]: (i) =>
      searchHebrewMonth(i as Parameters<typeof searchHebrewMonth>[0]),
  };

  let model: "claude-haiku-4-5" | "claude-sonnet-4-6" = "claude-haiku-4-5";
  let haikuUsage: TokenUsage = blankUsage();
  let sonnetUsage: TokenUsage | undefined;
  let extraction: Extraction;

  try {
    const haikuResult = await runAgentLoop({
      model: "claude-haiku-4-5",
      system: SYSTEM_PROMPT,
      initialMessages: [userMessage],
      tools,
      toolHandlers: handlers,
      finalToolName: "emit_extraction",
    });
    haikuUsage = asTokenUsage(haikuResult.usage);
    extraction = haikuResult.finalToolInput as Extraction;
  } catch (err) {
    if (err instanceof AgentLoopError && err.partial) {
      haikuUsage = asTokenUsage(err.partial.usage ?? blankUsage());
    }
    throw new Error(
      `extractV2 Haiku agent loop failed: ${(err as Error).message}`,
    );
  }

  // ─── 4. Sonnet fallback with extended thinking for low-confidence cases
  if (extraction.confidence < HAIKU_CONFIDENCE_FLOOR) {
    try {
      const sonnetResult = await runAgentLoop({
        model: "claude-sonnet-4-6",
        system: SYSTEM_PROMPT,
        initialMessages: [userMessage],
        tools,
        toolHandlers: handlers,
        finalToolName: "emit_extraction",
        enableThinking: true,
        thinkingBudgetTokens: 4_000,
      });
      sonnetUsage = asTokenUsage(sonnetResult.usage);
      const sonnetExtraction = sonnetResult.finalToolInput as Extraction;
      // Take whichever has higher confidence (Sonnet usually wins)
      if (sonnetExtraction.confidence > extraction.confidence) {
        extraction = sonnetExtraction;
        model = "claude-sonnet-4-6";
      }
    } catch (err) {
      // Sonnet fallback failed — keep Haiku result. Surface in v2Meta.
      console.warn(
        "[extract-v2] Sonnet fallback failed:",
        (err as Error).message,
      );
    }
  }

  // ─── 5. Critique pass on suspicious extractions
  let critiqued = false;
  let critiqueUsage: TokenUsage | undefined;
  if (
    !args.skipCritique &&
    shouldCritique({
      firstPass: extraction,
      priorRuleCount: args.priorRuleCount ?? null,
    })
  ) {
    try {
      const critique = await critiqueExtraction({
        source: markdown,
        firstPass: extraction,
        shulId: args.shulId,
      });
      extraction = critique.extraction;
      critiqueUsage = asTokenUsage(critique.usage);
      critiqued = true;
    } catch (err) {
      console.warn(
        "[extract-v2] critique pass failed:",
        (err as Error).message,
      );
    }
  }

  // ─── 6. Compute hash for rescrape no-change shortcut
  const pageContentHash = createHash("sha256")
    .update(markdown, "utf8")
    .digest("hex");

  return {
    extraction,
    model,
    pageContentHash,
    usage: { haiku: haikuUsage, sonnet: sonnetUsage },
    v2Meta: {
      inputSource,
      truncated,
      critiqued,
      critiqueUsage,
      markdownLength: markdown.length,
    },
  };
}

export interface ExtractionV2Meta {
  inputSource: "jina" | "sanitize-fallback" | "preprocessed";
  truncated: boolean;
  critiqued: boolean;
  critiqueUsage?: TokenUsage;
  markdownLength: number;
}

/**
 * Same hash function used by the cascade's pre-flight no-change check
 * for v2. Mirrors hashSanitizedHtml in v1 but operates on markdown.
 * The cascade hash-check step needs to use THIS function when v2 is
 * active (vs hashSanitizedHtml when v1 is active).
 */
export async function hashV2Markdown(url: string): Promise<string | null> {
  const jina = await fetchViaJinaReader(url);
  if (!jina.ok) return null;
  let md = jina.markdown;
  if (md.length > MAX_INPUT_CHARS) md = md.slice(0, MAX_INPUT_CHARS);
  return createHash("sha256").update(md, "utf8").digest("hex");
}

// ─── helpers

function assembleUserMessage(
  context: string,
  markdown: string,
  truncated: boolean,
): string {
  const parts: string[] = [];
  if (context.length > 0) {
    parts.push(context);
    parts.push("");
  }
  if (truncated) {
    parts.push(
      `[NOTE: page content truncated at ${MAX_INPUT_CHARS} chars. Anything past that is missing.]`,
    );
    parts.push("");
  }
  parts.push(markdown);
  return parts.join("\n");
}

function blankUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

function asTokenUsage(u: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}): TokenUsage {
  return u;
}
