// Tool: searchHebrewMonth
//
// Claude calls this mid-extraction when the source uses Hebrew month
// names ("Sivan 4", "Erev Rosh Chodesh Tammuz"). Returns the month
// index + canonical name + current Gregorian range. Pure local logic.

import { HDate, months as HMonths } from "@hebcal/core";
import type Anthropic from "@anthropic-ai/sdk";

export interface HebrewMonthArgs {
  name: string;
  /** Hebrew year, e.g. 5786. Optional; defaults to current Hebrew year. */
  hebrewYear?: number;
}

export interface HebrewMonthResult {
  /** Input name as provided. */
  inputName: string;
  /** Canonical English transliteration. */
  englishName: string;
  /** 1-based month index per Hebcal (1=Nisan, 7=Tishrei, etc.). */
  monthIndex: number;
  /** Number of days in this Hebrew month for the given year. */
  daysInMonth: number;
  /** Gregorian date of the first of this Hebrew month. */
  firstGregorianDate: string;
  /** Gregorian date of the last of this Hebrew month. */
  lastGregorianDate: string;
  hebrewYear: number;
}

// Common name variations
const ALIASES: Record<string, string> = {
  // standard
  nisan: "Nisan",
  nissan: "Nisan",
  iyar: "Iyyar",
  iyyar: "Iyyar",
  sivan: "Sivan",
  tammuz: "Tamuz",
  tamuz: "Tamuz",
  av: "Av",
  menachemav: "Av",
  elul: "Elul",
  tishrei: "Tishrei",
  tishri: "Tishrei",
  cheshvan: "Cheshvan",
  marcheshvan: "Cheshvan",
  kislev: "Kislev",
  tevet: "Tevet",
  teves: "Tevet",
  shevat: "Shvat",
  shvat: "Shvat",
  adar: "Adar",
  adari: "Adar1",
  adar1: "Adar1",
  adaraleph: "Adar1",
  adarii: "Adar2",
  adar2: "Adar2",
  adarbet: "Adar2",
};

function canonical(name: string): string | null {
  const k = name.toLowerCase().replace(/[^a-z]/g, "");
  return ALIASES[k] ?? null;
}

export async function searchHebrewMonth(
  args: HebrewMonthArgs,
): Promise<HebrewMonthResult | { error: string }> {
  const canonName = canonical(args.name);
  if (!canonName) {
    return {
      error: `Unrecognized Hebrew month name '${args.name}'. Known names: ${Object.values(
        ALIASES,
      )
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(", ")}`,
    };
  }

  const today = new HDate(new Date());
  const yyyy = args.hebrewYear ?? today.getFullYear();

  let monthIndex: number;
  try {
    monthIndex = HDate.monthFromName(canonName);
  } catch (e) {
    return { error: `monthFromName error: ${(e as Error).message}` };
  }
  // Adar handling: in leap years use Adar1/Adar2; in non-leap use ADAR (=Adar2 internally per Hebcal)
  if (canonName === "Adar1" && !HDate.isLeapYear(yyyy)) {
    return {
      error: `${yyyy} is not a leap year; there is no Adar I. Use 'Adar' instead.`,
    };
  }

  const daysInMonth = HDate.daysInMonth(monthIndex, yyyy);
  const first = new HDate(1, monthIndex, yyyy).greg();
  const last = new HDate(daysInMonth, monthIndex, yyyy).greg();

  return {
    inputName: args.name,
    englishName: canonName,
    monthIndex,
    daysInMonth,
    firstGregorianDate: first.toISOString().slice(0, 10),
    lastGregorianDate: last.toISOString().slice(0, 10),
    hebrewYear: yyyy,
  };
}

// Silence "unused import" — HMonths is here for future expansion.
void HMonths;

export const searchHebrewMonthTool: Anthropic.Messages.Tool = {
  name: "searchHebrewMonth",
  description:
    "Resolve a Hebrew month name to its index + Gregorian date range. Use this when the source uses Hebrew month names like 'Sivan' or 'Tammuz' and you need to convert to Gregorian dates.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Hebrew month name (English transliteration). Accepts variations: 'Sivan', 'Tammuz', 'Tamuz', 'Tishrei', 'Tishri', etc.",
      },
      hebrewYear: {
        type: "integer",
        description:
          "Hebrew year (e.g. 5786). Optional; defaults to current Hebrew year.",
      },
    },
    required: ["name"],
  },
};
