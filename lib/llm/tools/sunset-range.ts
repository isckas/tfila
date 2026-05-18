// Tool: getSunsetRange
//
// Claude calls this mid-extraction when it needs to sanity-check a
// zmanim-anchored time. Example: "Mincha 18 min before shkia" should
// roughly equal 7:42 PM in May for Miami; if the extracted clock
// disagrees by hours, something's off.
//
// Uses @hebcal/core's Zmanim engine. No network calls.

import { Location, Zmanim } from "@hebcal/core";
import type Anthropic from "@anthropic-ai/sdk";

export interface SunsetRangeArgs {
  lat: number;
  lng: number;
  /** Number of days of sunset data to return, starting from today. Default 1. Max 7. */
  daysAhead?: number;
  /** IANA timezone for clock formatting (e.g. 'America/New_York'). Optional; defaults to UTC. */
  timezone?: string;
}

export interface SunsetRangeResult {
  dates: Array<{
    /** ISO date YYYY-MM-DD. */
    date: string;
    /** Shkia (sunset) clock time HH:MM in the given timezone. */
    shkiaClock: string;
    /** Netz (sunrise) clock time HH:MM in the given timezone. */
    netzClock: string;
    /** Tzeis 72 (nightfall, 72-min standard) clock time HH:MM. */
    tzeis72Clock: string;
  }>;
}

export async function getSunsetRange(
  args: SunsetRangeArgs,
): Promise<SunsetRangeResult | { error: string }> {
  if (!Number.isFinite(args.lat) || !Number.isFinite(args.lng)) {
    return { error: "lat and lng must be finite numbers" };
  }
  const days = Math.min(Math.max(args.daysAhead ?? 1, 1), 7);
  const tz = args.timezone ?? "UTC";

  let location: Location;
  try {
    location = new Location(args.lat, args.lng, false, tz, "lookup", "XX");
  } catch (e) {
    return { error: `invalid location: ${(e as Error).message}` };
  }

  const today = new Date();
  const dates: SunsetRangeResult["dates"] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() + i * 86_400_000);
    const zmanim = new Zmanim(location, d, false);
    dates.push({
      date: d.toISOString().slice(0, 10),
      shkiaClock: formatClock(zmanim.sunset(), tz),
      netzClock: formatClock(zmanim.sunrise(), tz),
      tzeis72Clock: formatClock(zmanim.tzeit(8.5), tz),
    });
  }

  return { dates };
}

function formatClock(d: Date | null, tz: string): string {
  if (!d) return "";
  return d.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const getSunsetRangeTool: Anthropic.Messages.Tool = {
  name: "getSunsetRange",
  description:
    "Get shkia (sunset), netz (sunrise), and tzeis72 (nightfall) times for a location over the next N days. Use this when you want to verify a zmanim-anchored rule makes sense ('Mincha 18 min before shkia' should resolve to a plausible clock time).",
  input_schema: {
    type: "object",
    properties: {
      lat: { type: "number", description: "Latitude of the location." },
      lng: { type: "number", description: "Longitude of the location." },
      daysAhead: {
        type: "integer",
        minimum: 1,
        maximum: 7,
        description: "Number of days starting today. Default 1, max 7.",
      },
      timezone: {
        type: "string",
        description:
          "IANA timezone like 'America/New_York'. Optional but recommended.",
      },
    },
    required: ["lat", "lng"],
  },
};
