// Anthropic tool definition for STRUCTURED EXTRACTION OUTPUT.
//
// Replaces the v1 pattern of "Claude emits a JSON string in its
// response → we parse the string → Zod validates." The v2 pipeline
// instead defines the extraction schema as an Anthropic tool. Claude
// is forced to call the tool with valid arguments — no JSON parsing,
// no markdown-fence stripping, no truncation handling. Anthropic
// enforces the input_schema at the API level.
//
// Per EXTRACTION-ONE-SHOT-PLAN.md → "Anthropic tool use — structured
// output" section.

import type Anthropic from "@anthropic-ai/sdk";

// JSON Schema mirroring lib/llm/schema.ts ExtractionSchema. Kept in
// sync by hand — the Zod schema is the source of truth for parsing,
// this is the source of truth for Anthropic. If you change one,
// change the other.
//
// The schema is INTENTIONALLY strict on sourceQuote (required) at the
// tool-input-schema level — Claude cannot emit a rule without quoting
// the source text it came from. This is the v2 grounding requirement.

const TIME_SCHEMA: Record<string, unknown> = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fixed"] },
        clock: {
          type: "string",
          pattern: "^\\d{1,2}:\\d{2}$",
          description: "24-hour clock time, e.g. '07:00' or '19:15'.",
        },
      },
      required: ["kind", "clock"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["zmanim"] },
        anchor: {
          type: "string",
          enum: [
            "shkia",
            "tzeis_72",
            "tzeis_42",
            "alos",
            "netz",
            "misheyakir",
            "sof_zman_tefillah_mga",
            "sof_zman_tefillah_gra",
            "sof_zman_shma_mga",
            "sof_zman_shma_gra",
            "chatzos",
            "mincha_gedolah",
            "plag_mincha",
            "candle_lighting",
          ],
        },
        offsetMin: {
          type: "integer",
          description:
            "Offset in minutes from the anchor. Negative = before, positive = after.",
        },
      },
      required: ["kind", "anchor", "offsetMin"],
      additionalProperties: false,
    },
  ],
};

const RULE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    tefillah: {
      type: "string",
      enum: ["shacharis", "mincha", "maariv", "selichos", "neilah", "other"],
      description:
        "Use 'other' only when the row is clearly a minyan/tefillah that doesn't fit. Skip rows that aren't minyanim — shiurim, classes, kiddush sponsors.",
    },
    tefillahLabel: {
      type: "string",
      maxLength: 64,
      description:
        "Free-text label when tefillah='other' (e.g. 'Vasikin Shacharis').",
    },
    daysOfWeek: {
      type: "array",
      items: { type: "integer", minimum: 0, maximum: 6 },
      description: "Days the rule applies to. 0=Sunday … 6=Shabbos.",
    },
    time: TIME_SCHEMA,
    validFrom: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description:
        "ISO date (YYYY-MM-DD). Only set for date-bounded special-schedule rules.",
    },
    validTo: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description: "ISO date (YYYY-MM-DD). Defaults to validFrom for single-date.",
    },
    specialScheduleKind: {
      type: "string",
      enum: [
        "regular",
        "yom_tov",
        "three_weeks",
        "aseres_yemei_teshuvah",
        "fast_day",
        "rosh_chodesh",
        "ad_hoc",
      ],
      description:
        "Default 'regular'. Use a special kind when the source page clearly tags the section.",
    },
    nusach: {
      type: "string",
      maxLength: 32,
      description:
        "Override of the shul's default nusach when one minyan differs.",
    },
    notes: {
      type: "string",
      maxLength: 280,
      description:
        "Short note attached to this rule from the source (e.g. 'Main sanctuary').",
    },
    sourceQuote: {
      type: "string",
      maxLength: 500,
      description:
        "REQUIRED: the exact text from the source that this rule was extracted from. Quote verbatim, no paraphrasing. If you cannot quote where you found this rule, do NOT emit the rule.",
    },
  },
  required: ["tefillah", "time", "sourceQuote"],
  additionalProperties: false,
};

// Use a plain (non-readonly) object so it matches Anthropic's
// InputSchema type. The schema is hand-authored, not generated, so
// `as const` would add narrow-type benefits we don't need here.
const EXTRACTION_INPUT_SCHEMA = {
  type: "object",
  properties: {
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description:
        "0.0-1.0. Use ≥0.9 only when the page is unambiguously a minyan schedule with clear times. Use ≤0.3 when uncertain.",
    },
    reasoning: {
      type: "string",
      maxLength: 800,
      description:
        "1-3 sentences. Where on the page did you find the times? What made you confident or uncertain?",
    },
    rules: {
      type: "array",
      items: RULE_SCHEMA,
      description: "All minyan rules extracted. May be empty if none present.",
    },
    shulName: {
      type: "string",
      maxLength: 200,
      description: "If the shul name is clearly visible, include it.",
    },
    shulAddress: {
      type: "string",
      maxLength: 300,
      description: "If a street address is visible, include it verbatim.",
    },
    shulWebsite: {
      type: "string",
      maxLength: 300,
      description: "Canonical root URL of the shul's own website if visible.",
    },
  },
  required: ["confidence", "reasoning", "rules"],
  additionalProperties: false,
} as unknown as Anthropic.Messages.Tool["input_schema"];

/**
 * The Anthropic tool that wraps the entire extraction output schema.
 * The model is forced to call this tool with valid arguments — no
 * free-form JSON in the response.
 *
 * Use with `messages.create({ tools: [extractionOutputTool],
 * tool_choice: { type: "tool", name: "emit_extraction" } })`.
 */
export const extractionOutputTool: Anthropic.Messages.Tool = {
  name: "emit_extraction",
  description:
    "Emit the structured extraction result. Every minyan rule MUST include a sourceQuote citing the exact text from the source page.",
  input_schema: EXTRACTION_INPUT_SCHEMA,
};
