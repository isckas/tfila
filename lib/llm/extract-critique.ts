// Two-pass critique. Runs after the first-pass extraction when:
//   - confidence < CRITIQUE_TRIGGER_CONFIDENCE  OR
//   - sharp rule-count drop vs prior extraction
//
// The critic gets the SAME tool access as the first pass (Hebrew date,
// sunset range, prior extraction, validate rule, hebrew month). It
// reads the source + the proposed extraction and either confirms it
// or proposes a revised extraction. Output uses the same
// emit_extraction tool.
//
// Per EXTRACTION-ONE-SHOT-PLAN.md → "Critique pass — conditional
// second-pass audit" section.

import Anthropic from "@anthropic-ai/sdk";
import type { Extraction } from "./schema";
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

export const CRITIQUE_TRIGGER_CONFIDENCE = 0.7;
export const CRITIQUE_RULE_DROP_FRACTION = 0.5;

export interface CritiqueArgs {
  source: string;
  firstPass: Extraction;
  shulId: number;
}

export interface CritiqueResult {
  /** The confirmed-or-revised extraction. */
  extraction: Extraction;
  /** Did the critic actually change anything? */
  changed: boolean;
  /** Token usage across the critique loop. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  /** Tool calls the critic made during its audit. */
  toolCalls: Array<{ name: string; outputPreview: string }>;
}

const CRITIQUE_SYSTEM_PROMPT = `You are auditing an extraction of a Jewish shul's minyan schedule. Another extractor produced a first-pass result. Your job is to find errors before it ships.

For EACH rule in the first-pass extraction:
1. Verify the sourceQuote actually appears in the source content (verbatim, not paraphrased).
2. Check the inferred time / days / tefillah / specialScheduleKind match what the source quote actually says.

For each rule the first-pass extraction OMITTED:
- Scan the source for tefillah times that look like minyanim but aren't in the extraction. If you find any, add them with citations.
- Particularly watch for whole sections that were skipped (e.g. first pass got Shabbos schedule but missed weekday section).

Available tools you can call to help your audit:
- validateRule: sanity-check a rule's time / days / kind combo
- getPreviousExtraction: see the last successful extraction for context on what this shul typically publishes
- lookupHebrewDate: resolve a parsha or Hebrew date
- getSunsetRange: verify zmanim-anchored times are plausible
- searchHebrewMonth: convert Hebrew month names

Final output via the emit_extraction tool. If the first pass was correct, emit the SAME rules (don't drop any just to look diligent). If you found errors, emit a revised extraction. Adjust the confidence score based on what you found:
- First pass was correct + complete → keep its confidence or raise slightly.
- Minor fixes (1-2 rules wrong) → mid-range confidence (0.5-0.75).
- Major fixes (many rules wrong or many missing) → keep low confidence and explain in reasoning.

Be conservative. Never invent rules; only emit rules grounded in source content you can quote.`;

export async function critiqueExtraction(
  args: CritiqueArgs,
): Promise<CritiqueResult> {
  const initialUser: Anthropic.Messages.MessageParam = {
    role: "user",
    content: `=== SOURCE CONTENT ===

${args.source}

=== END SOURCE ===

=== FIRST-PASS EXTRACTION ===

${JSON.stringify(args.firstPass, null, 2)}

=== END FIRST-PASS ===

Audit this extraction. The shul's internal ID is ${args.shulId} (use getPreviousExtraction if helpful). Emit the final (confirmed or revised) result via the emit_extraction tool.`,
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
    model: "claude-haiku-4-5",
    system: CRITIQUE_SYSTEM_PROMPT,
    initialMessages: [initialUser],
    tools,
    toolHandlers: handlers,
    finalToolName: "emit_extraction",
    maxIterations: 8,
  });

  // Parse the final-tool input into our Extraction type. Anthropic's
  // tool-use API enforces the input_schema, so this should be safe —
  // but cast defensively in case the model produces a slightly off
  // shape that still passed the schema (e.g. extra fields).
  const revised = result.finalToolInput as Extraction;

  // Detect whether anything actually changed (rule count or any rule's
  // tefillah/time/days/source_quote). Cheap comparison.
  const changed = !extractionsEqual(args.firstPass, revised);

  return {
    extraction: revised,
    changed,
    usage: result.usage,
    toolCalls: result.toolCalls.map((c) => ({
      name: c.name,
      outputPreview: c.outputPreview,
    })),
  };
}

function extractionsEqual(a: Extraction, b: Extraction): boolean {
  if (a.rules.length !== b.rules.length) return false;
  for (let i = 0; i < a.rules.length; i++) {
    const ra = a.rules[i];
    const rb = b.rules[i];
    if (ra.tefillah !== rb.tefillah) return false;
    if (JSON.stringify(ra.time) !== JSON.stringify(rb.time)) return false;
    if (JSON.stringify(ra.daysOfWeek) !== JSON.stringify(rb.daysOfWeek)) return false;
    if ((ra.validFrom ?? null) !== (rb.validFrom ?? null)) return false;
    if ((ra.validTo ?? null) !== (rb.validTo ?? null)) return false;
    if (ra.specialScheduleKind !== rb.specialScheduleKind) return false;
  }
  return true;
}

/** Decide whether a first-pass extraction warrants a critique pass. */
export function shouldCritique(args: {
  firstPass: Extraction;
  priorRuleCount: number | null;
}): boolean {
  if (args.firstPass.confidence < CRITIQUE_TRIGGER_CONFIDENCE) return true;
  if (args.priorRuleCount != null && args.priorRuleCount >= 3) {
    const newCount = args.firstPass.rules.length;
    if (newCount < args.priorRuleCount * CRITIQUE_RULE_DROP_FRACTION) {
      return true;
    }
  }
  return false;
}
