import { z } from "zod";

// ─── Time tagged-union ───────────────────────────────────────────────────
// Mirrors db/schema.ts MinyanTime — keep the two in sync.
export const TimeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixed"),
    clock: z
      .string()
      .regex(/^\d{1,2}:\d{2}$/, "HH:MM (24-hour) required")
      .describe("24-hour clock time, e.g. '07:00' or '19:15'."),
  }),
  z.object({
    kind: z.literal("zmanim"),
    anchor: z.enum([
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
    ]).describe(
      "The zmanim anchor this rule is relative to. 'shkia' = sunset, 'netz' = sunrise, 'tzeis_72' = nightfall at 72-min standard.",
    ),
    offsetMin: z
      .number()
      .int()
      .describe(
        "Offset in minutes from the anchor. Negative = before, positive = after. 'Mincha 18 min before shkia' → offsetMin: -18.",
      ),
  }),
]);

export type ExtractedTime = z.infer<typeof TimeSchema>;

// ─── Single minyan rule ──────────────────────────────────────────────────
export const RuleSchema = z.object({
  tefillah: z
    .enum(["shacharis", "mincha", "maariv", "selichos", "neilah", "other"])
    .describe(
      "Use 'other' only when the row is clearly a minyan/tefillah that doesn't fit the listed names. Skip rows that are not minyanim — shiurim (Daf Yomi, Mishna Yomi), tehillim groups, classes, kiddush sponsors.",
    ),
  tefillahLabel: z
    .string()
    .max(64)
    .optional()
    .describe("Free-text label when tefillah='other' (e.g. 'Vasikin Shacharis' or 'Hashkamah')."),
  daysOfWeek: z
    .array(z.number().int().min(0).max(6))
    .optional()
    .describe(
      "Days the rule applies to. 0=Sunday … 6=Shabbos. Omit for one-off date-bounded rules; use specialScheduleKind+validFrom/To instead.",
    ),
  time: TimeSchema,
  validFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("ISO date (YYYY-MM-DD). Only set for date-bounded special-schedule rules."),
  validTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("ISO date (YYYY-MM-DD). Defaults to validFrom for single-date rules."),
  specialScheduleKind: z
    .enum([
      "regular",
      "yom_tov",
      "three_weeks",
      "aseres_yemei_teshuvah",
      "fast_day",
      "rosh_chodesh",
      "ad_hoc",
    ])
    .default("regular")
    .describe(
      "Default 'regular'. Use a special kind when the source page clearly tags the section (e.g. 'Tisha B'Av schedule', 'Three Weeks', 'Yom Kippur', 'Rosh Chodesh').",
    ),
  nusach: z
    .string()
    .max(32)
    .optional()
    .describe(
      "Override of the shul's default nusach when one minyan differs (e.g. shul is Ashkenaz, but this minyan is Sefard).",
    ),
  notes: z
    .string()
    .max(280)
    .optional()
    .describe(
      "Short note attached to this rule from the source (e.g. 'Main sanctuary', 'Beis Medrash'). Don't include marketing copy.",
    ),
});

export type ExtractedRule = z.infer<typeof RuleSchema>;

// ─── Top-level extraction output ─────────────────────────────────────────
export const ExtractionSchema = z.object({
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "0.0-1.0. Use ≥0.9 only when the page is unambiguously a minyan schedule with clear times. Use ≤0.3 when uncertain (prose page, non-shul site, generic 'about' page). The reviewer uses this to triage.",
    ),
  reasoning: z
    .string()
    .max(800)
    .describe(
      "1-3 sentences. Where on the page did you find the times? What made you confident or uncertain? Note anything weird (mixed weekly/Shabbos, summer vs winter, etc.).",
    ),
  rules: z
    .array(RuleSchema)
    .describe("All minyan rules extracted. May be empty if no minyan times are present."),
  shulName: z
    .string()
    .max(200)
    .optional()
    .describe("If the shul name is clearly visible (page title, header), include it."),
  shulAddress: z
    .string()
    .max(300)
    .optional()
    .describe("If a street address is visible (footer, contact section), include it verbatim."),
  shulWebsite: z
    .string()
    .max(300)
    .optional()
    .describe(
      "Canonical root URL of the shul's own website if it appears in the source (e.g. 'https://edmondjsafrasynagogue.com'). Skip mailing-list platforms, link-tracking redirects, social media, image CDNs, and generic mail providers.",
    ),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
