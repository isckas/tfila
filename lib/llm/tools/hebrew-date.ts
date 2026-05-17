// Tool: lookupHebrewDate
//
// Claude calls this mid-extraction when it sees a parsha reference
// without an explicit year/date ("Schedule for Parshas Behar"). The
// tool returns the actual Gregorian date range for that parsha in
// the requested year (or the upcoming occurrence if year omitted).
//
// Uses @hebcal/core (already a project dep). No network calls.

import { HDate, HebrewCalendar } from "@hebcal/core";
import type Anthropic from "@anthropic-ai/sdk";

export interface HebrewDateLookupArgs {
  parsha: string;
  /** 4-digit Gregorian year, e.g. 2026. Optional; defaults to the next upcoming occurrence. */
  year?: number;
}

export interface HebrewDateLookupResult {
  parsha: string;
  /** ISO date YYYY-MM-DD of the Shabbos when this parsha is read. */
  shabbosDate: string;
  /** ISO date YYYY-MM-DD of the Friday before (Erev Shabbos). */
  erevShabbosDate: string;
  /** Human-readable English name as returned by Hebcal. */
  englishName: string;
  /** Hebrew year (e.g. 5786) the parsha falls in. */
  hebrewYear: number;
}

const NORMALIZE_RE = /^parshas?\s+/i;
const PUNCT_RE = /[^a-zA-Z'\s]/g;

function normalize(name: string): string {
  return name
    .trim()
    .replace(NORMALIZE_RE, "")
    .replace(PUNCT_RE, "")
    .toLowerCase();
}

export async function lookupHebrewDate(
  args: HebrewDateLookupArgs,
): Promise<HebrewDateLookupResult | { error: string }> {
  const target = normalize(args.parsha);
  if (!target) return { error: "empty parsha name" };

  // Determine year range to search. If year given, scan that Gregorian
  // year. Otherwise scan from today through 18 months ahead to catch
  // the next upcoming occurrence.
  const today = new HDate(new Date());
  const startDate = args.year ? new Date(args.year, 0, 1) : new Date();
  const endDate = args.year
    ? new Date(args.year + 1, 0, 1)
    : new Date(Date.now() + 18 * 30 * 86_400_000);

  const events = HebrewCalendar.calendar({
    start: startDate,
    end: endDate,
    sedrot: true,
    noHolidays: true,
  });

  for (const ev of events) {
    // Hebcal returns parsha events with desc like "Parashat Behar" or
    // composite like "Parashat Behar-Bechukotai". Match either way.
    const desc = ev.getDesc();
    if (!desc.toLowerCase().startsWith("parashat")) continue;
    const parts = desc
      .slice("parashat".length)
      .trim()
      .toLowerCase()
      .split(/[-\s]/);
    if (!parts.includes(target)) continue;

    const date = ev.getDate();
    const gregShabbos = date.greg();
    const gregErev = new Date(gregShabbos);
    gregErev.setDate(gregErev.getDate() - 1);

    return {
      parsha: args.parsha,
      shabbosDate: iso(gregShabbos),
      erevShabbosDate: iso(gregErev),
      englishName: desc.replace("Parashat", "Parshas"),
      hebrewYear: date.getFullYear(),
    };
  }

  return {
    error: `Parsha '${args.parsha}' not found in window ${iso(startDate)} → ${iso(endDate)}. Today is Hebrew year ${today.getFullYear()}.`,
  };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const lookupHebrewDateTool: Anthropic.Messages.Tool = {
  name: "lookupHebrewDate",
  description:
    "Resolve a parsha name (e.g. 'Behar', 'Parshas Behar') to its Gregorian date. Use this when the source page references a parsha without an explicit year/date. Returns the Shabbos date + Erev Shabbos date + the Hebrew year. If year omitted, returns the next upcoming occurrence.",
  input_schema: {
    type: "object",
    properties: {
      parsha: {
        type: "string",
        description:
          "Parsha name. Accepts 'Behar', 'Parshas Behar', 'Parashat Behar', with or without prefixes/quotes.",
      },
      year: {
        type: "integer",
        description:
          "Gregorian year (e.g. 2026). Optional. If omitted, returns the next upcoming occurrence after today.",
      },
    },
    required: ["parsha"],
  },
};
