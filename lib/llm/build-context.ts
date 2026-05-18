// Build the context preamble injected BEFORE the page content in v2
// extraction. Front-loads everything Claude could use:
//   - shul metadata (name, address, timezone, nusach)
//   - prior successful extraction (so the model can do delta reasoning)
//   - today's Hebrew calendar context (date, upcoming Yom Tov, current parsha)
//
// The result is a string that prepends to the user message. It's
// designed for prompt caching — the metadata changes only when the
// shul row changes or a new extraction lands, so most invocations hit
// the cache.
//
// Per EXTRACTION-ONE-SHOT-PLAN.md → "Context-rich prompts" section.

import { HDate, HebrewCalendar } from "@hebcal/core";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { shul } from "../../db/schema";
import { getPreviousExtraction } from "./tools/previous-extraction";

export interface BuildContextArgs {
  /** Shul ID to pull metadata + prior extraction for. */
  shulId: number;
}

/**
 * Returns a context block ready to prepend to the user message.
 * Empty string if shul not found (caller can choose how to react).
 */
export async function buildContextPreamble(
  args: BuildContextArgs,
): Promise<string> {
  const shulRows = await db
    .select({
      id: shul.id,
      name: shul.name,
      address: shul.address,
      timezone: shul.timezone,
      nusach: shul.nusach,
      adminNotes: shul.adminNotes,
    })
    .from(shul)
    .where(eq(shul.id, args.shulId))
    .limit(1);
  const s = shulRows[0];
  if (!s) return "";

  const prior = await getPreviousExtraction({ shulId: args.shulId });
  const priorOk = !("error" in prior) ? prior : null;

  const today = new Date();
  const hToday = new HDate(today);
  const upcomingEvents = HebrewCalendar.calendar({
    start: today,
    end: new Date(today.getTime() + 30 * 86_400_000),
    candlelighting: false,
    sedrot: true,
    noMinorFast: true,
    noRoshChodesh: false,
  });
  const upcomingHolidays = upcomingEvents
    .filter((e) => {
      const desc = e.getDesc();
      // Major Yom Tov + fasts; skip parsha rows here, those are listed separately
      return (
        !desc.toLowerCase().startsWith("parashat") &&
        !desc.toLowerCase().startsWith("erev")
      );
    })
    .slice(0, 4);
  const nextParsha = upcomingEvents.find((e) =>
    e.getDesc().toLowerCase().startsWith("parashat"),
  );

  const lines: string[] = [];
  lines.push("=== CONTEXT FOR THIS EXTRACTION ===");
  lines.push("");
  lines.push(`Shul: ${s.name}`);
  lines.push(`Internal ID: ${s.id}`);
  if (s.address) lines.push(`Address: ${s.address}`);
  if (s.timezone) lines.push(`Timezone: ${s.timezone}`);
  if (s.nusach) lines.push(`Nusach (from prior extraction): ${s.nusach}`);
  if (s.adminNotes && s.adminNotes.trim().length > 0) {
    lines.push(`Admin notes about this shul:`);
    for (const line of s.adminNotes.trim().split("\n").slice(0, 10)) {
      lines.push(`  ${line}`);
    }
  }

  lines.push("");
  lines.push(`Today (Gregorian): ${today.toISOString().slice(0, 10)}`);
  lines.push(
    `Today (Hebrew): ${hToday.getDate()} ${hToday.getMonthName()} ${hToday.getFullYear()}`,
  );
  if (nextParsha) {
    lines.push(
      `Next parsha: ${nextParsha.getDesc().replace("Parashat", "Parshas")} (Shabbos ${nextParsha
        .getDate()
        .greg()
        .toISOString()
        .slice(0, 10)})`,
    );
  }
  if (upcomingHolidays.length > 0) {
    lines.push("Upcoming holidays / observances (next 30 days):");
    for (const e of upcomingHolidays) {
      lines.push(
        `  - ${e.getDesc()} on ${e.getDate().greg().toISOString().slice(0, 10)}`,
      );
    }
  }

  if (priorOk && priorOk.ruleCount > 0) {
    lines.push("");
    lines.push(
      `Last successful extraction: ${priorOk.lastExtractedAt ?? "unknown date"}`,
    );
    lines.push(`Previous rule count: ${priorOk.ruleCount}`);
    lines.push("Previous rules (summary, for delta reasoning):");
    for (const r of priorOk.rules.slice(0, 30)) {
      const days = r.daysOfWeek?.join(",") ?? "—";
      const time =
        r.time.kind === "fixed"
          ? r.time.clock
          : `${r.time.anchor}${r.time.offsetMin >= 0 ? "+" : ""}${r.time.offsetMin}min`;
      const kind = r.specialScheduleKind === "regular" ? "" : ` [${r.specialScheduleKind}]`;
      const dates =
        r.validFrom || r.validTo
          ? ` (${r.validFrom ?? "?"} → ${r.validTo ?? "?"})`
          : "";
      lines.push(
        `  - ${r.tefillah}${r.tefillahLabel ? " (" + r.tefillahLabel + ")" : ""}: days=${days} time=${time}${kind}${dates}`,
      );
    }
    if (priorOk.rules.length > 30) {
      lines.push(`  …and ${priorOk.rules.length - 30} more`);
    }
    lines.push("");
    lines.push(
      "Use the previous extraction as context. If a time shifted slightly (e.g. Mincha moved 15 min later), that's likely a seasonal shift — high confidence. If the rule count drops sharply (e.g. half the rules disappear), the source may have a section you missed — re-check before emitting.",
    );
  } else {
    lines.push("");
    lines.push(
      "No prior successful extraction. This is a fresh shul or all previous attempts failed.",
    );
  }

  lines.push("");
  lines.push("=== END CONTEXT — page content follows ===");

  return lines.join("\n");
}
