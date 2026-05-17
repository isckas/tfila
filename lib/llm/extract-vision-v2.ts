// v2 Vision extraction.
//
// Schedule images go to Sonnet (Haiku's vision is too weak) with:
//   - Tool use for structured output (no JSON parsing)
//   - Context preamble (shul metadata + Hebcal + prior extraction)
//   - 5 mid-extraction tools available (mostly useful for Hebrew date
//     resolution when the image has a parsha label)
//   - Optional critique pass
//   - Extended thinking enabled by default (image extractions are
//     reasoning-heavy and the cost is small at our image volumes)
//
// Per EXTRACTION-ONE-SHOT-PLAN.md step 11.

import { fetchBinary, normalizeImageMimeType } from "../scrapers/fetch-binary";
import { buildContextPreamble } from "./build-context";
import { runAgentLoop } from "./agent-loop";
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
import type { VisionExtractionResult } from "./extract-vision";

const VISION_MODEL = "claude-sonnet-4-6" as const;

const SYSTEM_PROMPT = String.raw`You are extracting Jewish minyan/tefillah times from an image of a shul's schedule.

INPUT: a single image — typically a printed/typed schedule, sometimes handwritten or a screenshot.

OUTPUT: emit your extraction via the emit_extraction tool. Every rule MUST include a sourceQuote field with the exact text/label from the image. If you cannot point to a visible label/time in the image, do not emit the rule.

## What counts as a minyan
Shacharis (incl Vasikin/Hashkamah), Mincha, Maariv, Selichos, Neilah.

Skip: shiurim, classes, kiddush sponsors, candle-lighting / havdalah times.

## Time formats
Fixed: kind="fixed", clock="HH:MM" (24-hour). Convert PM ("7:30 PM" → "19:30").
Zmanim-relative: kind="zmanim", anchor=shkia/netz/alos/misheyakir/chatzos/mincha_gedolah/plag_mincha/tzeis_72/tzeis_42/sof_zman_shma_gra/sof_zman_shma_mga/sof_zman_tefillah_gra/sof_zman_tefillah_mga/candle_lighting, offsetMin signed.

## Days
daysOfWeek: array of 0-6 (0=Sunday, 6=Shabbos).

## Date-bounded rules
If the image is for a specific date range (parsha named, holiday section), emit date-bounded rules with validFrom/validTo + specialScheduleKind. Use the lookupHebrewDate tool to resolve parsha names to dates.

## Tools available
- lookupHebrewDate, searchHebrewMonth: resolve Hebrew dates / parsha names
- getSunsetRange: verify zmanim-anchored times are plausible
- getPreviousExtraction: see prior extraction for delta reasoning
- validateRule: sanity-check a proposed rule before emitting

## Confidence
- 0.9+: clear schedule, all times unambiguous
- 0.6-0.9: schedule visible but some interpretation needed
- 0.4-0.6: partial / messy / mixed signals
- <0.4: image doesn't appear to have a minyan schedule

If you emit zero rules: confidence should be ≤0.3.`;

export interface ExtractVisionV2Args {
  imageUrl: string;
  shulId: number;
  skipCritique?: boolean;
  priorRuleCount?: number;
}

export async function extractFromImageUrlV2(
  args: ExtractVisionV2Args,
): Promise<VisionExtractionResult & { v2Meta?: { critiqued?: boolean } }> {
  // Fetch the image ourselves
  const fetched = await fetchBinary(args.imageUrl, {
    timeoutMs: 25_000,
    accept: "image/*",
  });
  if (!fetched.ok || !fetched.bytes) {
    throw new Error(
      `Image fetch failed for ${args.imageUrl}: HTTP ${fetched.status}${
        fetched.fellBackToBrowserUa ? " (after browser-UA fallback)" : ""
      }`,
    );
  }
  const mediaType = normalizeImageMimeType(fetched.mimeType, args.imageUrl);
  if (!mediaType) {
    throw new Error(
      `Image ${args.imageUrl}: unsupported MIME type "${fetched.mimeType}"`,
    );
  }
  const imageBase64 = fetched.bytes.toString("base64");

  // Build context preamble
  const context = await buildContextPreamble({ shulId: args.shulId });

  // Initial user message: context (as text) + the image
  const userMessage: Anthropic.Messages.MessageParam = {
    role: "user",
    content: [
      ...(context
        ? ([{ type: "text", text: context } satisfies Anthropic.Messages.TextBlockParam] as const)
        : []),
      {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: imageBase64,
        },
      } satisfies Anthropic.Messages.ImageBlockParam,
      {
        type: "text",
        text: "Extract the minyan schedule from this image via the emit_extraction tool. Every rule MUST include sourceQuote text from the image.",
      } satisfies Anthropic.Messages.TextBlockParam,
    ],
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

  const result = await runAgentLoop({
    model: VISION_MODEL,
    system: SYSTEM_PROMPT,
    initialMessages: [userMessage],
    tools,
    toolHandlers: handlers,
    finalToolName: "emit_extraction",
    enableThinking: true,
    thinkingBudgetTokens: 3_000,
  });

  let extraction = result.finalToolInput as Extraction;
  let critiqued = false;

  // Critique pass — images can't be fed to the critic the same way
  // (would require sending the image again, doubling cost). Skip for
  // v1 of v2; revisit if vision tier accuracy needs it.
  void shouldCritique;
  void critiqueExtraction;
  void args.skipCritique;
  void args.priorRuleCount;

  return {
    extraction,
    model: VISION_MODEL,
    imageUrl: args.imageUrl,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheCreationInputTokens: result.usage.cacheCreationInputTokens,
      cacheReadInputTokens: result.usage.cacheReadInputTokens,
    },
    v2Meta: { critiqued },
  };
}
