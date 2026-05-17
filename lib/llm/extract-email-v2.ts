// v2 Email body extraction.
//
// Uses the v2 agent loop with the email-specific system prompt + the
// 5 mid-extraction tools + critique pass. Context preamble is
// OPTIONAL since the email path is sometimes called BEFORE a shul row
// exists (the email creates the shul). Caller passes shulId when
// available, otherwise we skip the preamble.
//
// Per EXTRACTION-ONE-SHOT-PLAN.md step 12.

import { createHash } from "node:crypto";
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
import type { EmailExtractionResult } from "./extract-email";

const MAX_BODY_CHARS = 30_000;
const HAIKU_CONFIDENCE_FLOOR = 0.4;

const SYSTEM_PROMPT = String.raw`You are extracting minyan times from a Jewish shul's weekly email newsletter.

INPUT: subject line + plain-text body. Emails often include forwarded headers — ignore those, focus on the schedule.

OUTPUT: emit your extraction via the emit_extraction tool. Every rule MUST include sourceQuote (a verbatim snippet of the email body the rule was extracted from). If you can't quote where you found a rule, do NOT emit it.

## Identifying the shul

The email's "From" header is OFTEN a shared mailing-list service (info@myshul.com, news@constantcontact.com). To find the actual shul:
- shulName: look in subject line, body greeting, header, or footer ("Edmond J. Safra Synagogue").
- shulWebsite: extract the shul's own root URL ("https://edmondjsafrasynagogue.com"). RULES:
  * Only the bare origin "https://hostname" — no path/query/fragment.
  * SKIP link-tracking redirects (url429.*, click.*, track.*).
  * SKIP mailing-list platforms (myshul.com, mailchimp.com, list-manage.com, constantcontact.com).
  * SKIP image CDNs, social media, shortlinks, generic mail providers.
  * Omit if nothing qualifies.

## What counts as a minyan
Shacharis (incl Vasikin/Hashkamah), Mincha, Maariv, Selichos, Neilah.
Skip: shiurim, classes, kiddush sponsors, mazal tov, candle-lighting / havdalah.

## Time formats
Fixed: kind="fixed", clock="HH:MM" (24-hour). PM must convert.
Zmanim-relative: kind="zmanim", anchor + offsetMin.

## Date handling — IMPORTANT
- Bulletins are usually the NORMAL weekly schedule. Default specialScheduleKind="regular" with daysOfWeek; no validFrom/To.
- Only set validFrom/validTo when the TIMES themselves are special (Tisha B'Av, Yom Kippur, fast days, Shavuos with Tikkun, etc.). The parsha name in the header is decoration, not a one-off signal.
- For partial dates ("May 8-9"): NEVER default to a year in the past. Use the upcoming occurrence (today's year if dates haven't passed, next year otherwise) or the email's own send date as the floor. The lookupHebrewDate tool can resolve parsha names to dates.

## Tools available
- lookupHebrewDate, searchHebrewMonth: Hebrew date resolution
- getSunsetRange: zmanim sanity check
- getPreviousExtraction: see prior extraction for this shul (when shulId is available in context)
- validateRule: pre-emit sanity check

## Confidence
- 0.9+: clean schedule clearly labeled
- 0.6-0.9: schedule present, some interpretation needed
- 0.4-0.6: mixed signals, reviewer should look
- <0.4: probably not a schedule email

If you emit zero rules: confidence should be ≤0.3.`;

export interface ExtractEmailV2Args {
  subject: string;
  body: string;
  /** Optional: shul ID when we already know which shul this is for. */
  shulId?: number;
  skipCritique?: boolean;
  priorRuleCount?: number;
}

export async function extractFromEmailV2(
  args: ExtractEmailV2Args,
): Promise<EmailExtractionResult & { v2Meta?: { critiqued?: boolean } }> {
  const trimmed =
    args.body.length > MAX_BODY_CHARS
      ? args.body.slice(0, MAX_BODY_CHARS)
      : args.body;
  const bodyHash = createHash("sha256").update(trimmed, "utf8").digest("hex");

  // Optional context preamble (only when we know which shul this is)
  let context = "";
  if (args.shulId) {
    context = await buildContextPreamble({ shulId: args.shulId });
  }

  const userMessage: Anthropic.Messages.MessageParam = {
    role: "user",
    content: `${context ? context + "\n\n" : ""}SUBJECT: ${args.subject}\n\nBODY:\n${trimmed}`,
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

  // Haiku first
  let model: "claude-haiku-4-5" | "claude-sonnet-4-6" = "claude-haiku-4-5";
  const haikuResult = await runAgentLoop({
    model: "claude-haiku-4-5",
    system: SYSTEM_PROMPT,
    initialMessages: [userMessage],
    tools,
    toolHandlers: handlers,
    finalToolName: "emit_extraction",
  });
  let extraction = haikuResult.finalToolInput as Extraction;
  const haikuUsage = {
    inputTokens: haikuResult.usage.inputTokens,
    outputTokens: haikuResult.usage.outputTokens,
    cacheCreationInputTokens: haikuResult.usage.cacheCreationInputTokens,
    cacheReadInputTokens: haikuResult.usage.cacheReadInputTokens,
  };
  let sonnetUsage: typeof haikuUsage | undefined;

  // Sonnet fallback on low confidence
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
        thinkingBudgetTokens: 3_000,
      });
      const sonnetExtraction = sonnetResult.finalToolInput as Extraction;
      sonnetUsage = {
        inputTokens: sonnetResult.usage.inputTokens,
        outputTokens: sonnetResult.usage.outputTokens,
        cacheCreationInputTokens: sonnetResult.usage.cacheCreationInputTokens,
        cacheReadInputTokens: sonnetResult.usage.cacheReadInputTokens,
      };
      if (sonnetExtraction.confidence > extraction.confidence) {
        extraction = sonnetExtraction;
        model = "claude-sonnet-4-6";
      }
    } catch (err) {
      console.warn(
        "[extract-email-v2] Sonnet fallback failed:",
        (err as Error).message,
      );
    }
  }

  // Critique pass when shulId available and trigger fires
  let critiqued = false;
  if (
    args.shulId &&
    !args.skipCritique &&
    shouldCritique({
      firstPass: extraction,
      priorRuleCount: args.priorRuleCount ?? null,
    })
  ) {
    try {
      const critique = await critiqueExtraction({
        source: `SUBJECT: ${args.subject}\n\nBODY:\n${trimmed}`,
        firstPass: extraction,
        shulId: args.shulId,
      });
      extraction = critique.extraction;
      critiqued = true;
    } catch (err) {
      console.warn(
        "[extract-email-v2] critique pass failed:",
        (err as Error).message,
      );
    }
  }

  return {
    extraction,
    model,
    bodyHash,
    usage: { haiku: haikuUsage, sonnet: sonnetUsage },
    v2Meta: { critiqued },
  };
}
