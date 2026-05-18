// Tool: getPreviousExtraction
//
// Claude calls this mid-extraction to compare against the last
// successful extraction for the same shul. Enables delta reasoning:
// "Mincha was 19:15 last week, today says 19:30 — consistent with
// seasonal shkia shift, confidence high." OR catches sharp drops:
// "Last week had 8 rules, this extraction would emit 2 — am I
// missing sections?"

import { and, desc, eq, isNull } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../../../db/client";
import { minyanRule, dataSource } from "../../../db/schema";
import type { MinyanTime } from "../../../db/schema";

export interface PreviousExtractionArgs {
  shulId: number;
}

export interface PreviousExtractionRule {
  tefillah: string;
  tefillahLabel: string | null;
  daysOfWeek: number[] | null;
  time: MinyanTime;
  validFrom: string | null;
  validTo: string | null;
  specialScheduleKind: string;
  nusach: string | null;
  notes: string | null;
}

export interface PreviousExtractionResult {
  shulId: number;
  /** Total count of live rules across all approved data_sources. */
  ruleCount: number;
  /** When the most recent successful extraction landed. ISO string. */
  lastExtractedAt: string | null;
  /** All live (non-deleted) rules — same shape we'd extract now. */
  rules: PreviousExtractionRule[];
}

export async function getPreviousExtraction(
  args: PreviousExtractionArgs,
): Promise<PreviousExtractionResult | { error: string }> {
  if (!Number.isInteger(args.shulId)) {
    return { error: "shulId must be an integer" };
  }

  const rows = await db
    .select({
      tefillah: minyanRule.tefillah,
      tefillahLabel: minyanRule.tefillahLabel,
      daysOfWeek: minyanRule.daysOfWeek,
      time: minyanRule.time,
      validFrom: minyanRule.validFrom,
      validTo: minyanRule.validTo,
      specialScheduleKind: minyanRule.specialScheduleKind,
      nusach: minyanRule.nusach,
      notes: minyanRule.notes,
    })
    .from(minyanRule)
    .where(
      and(eq(minyanRule.shulId, args.shulId), isNull(minyanRule.deletedAt)),
    )
    .orderBy(desc(minyanRule.priority), minyanRule.tefillah);

  // Most recent ok data_source for the shul (for the timestamp)
  const dsRows = await db
    .select({ lastRunAt: dataSource.lastRunAt })
    .from(dataSource)
    .where(
      and(eq(dataSource.shulId, args.shulId), eq(dataSource.lastRunStatus, "ok")),
    )
    .orderBy(desc(dataSource.lastRunAt))
    .limit(1);

  return {
    shulId: args.shulId,
    ruleCount: rows.length,
    lastExtractedAt: dsRows[0]?.lastRunAt?.toISOString() ?? null,
    rules: rows.map((r) => ({
      tefillah: r.tefillah,
      tefillahLabel: r.tefillahLabel,
      daysOfWeek: r.daysOfWeek,
      time: r.time as MinyanTime,
      validFrom: r.validFrom,
      validTo: r.validTo,
      specialScheduleKind: r.specialScheduleKind,
      nusach: r.nusach,
      notes: r.notes,
    })),
  };
}

export const getPreviousExtractionTool: Anthropic.Messages.Tool = {
  name: "getPreviousExtraction",
  description:
    "Get the last successful extraction for a shul. Use this to detect sharp rule-count drops (am I missing a section?) or to validate that a seemingly-changed time is actually plausible (Mincha shifts seasonally).",
  input_schema: {
    type: "object",
    properties: {
      shulId: {
        type: "integer",
        description: "Internal numeric ID of the shul.",
      },
    },
    required: ["shulId"],
  },
};
