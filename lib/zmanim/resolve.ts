// Resolve a stored MinyanRule.time into a concrete UTC Date for a
// given shul location + date. Two cases:
//   - { kind: 'fixed', clock: 'HH:MM' } → that wall-clock time in the
//     shul's local timezone, on the given date
//   - { kind: 'zmanim', anchor, offsetMin } → look up the named zman
//     for that date+location via @hebcal/core, add the offset
//
// Returns null if the underlying zmanim calculation can't be computed
// (rare: only in arctic latitudes around solstice).

import { Zmanim, GeoLocation } from "@hebcal/core";
import type { MinyanTime } from "../../db/schema";

export interface ShulGeo {
  lat: number;
  lng: number;
  /** IANA timezone, e.g. "America/New_York". Falls back to "America/New_York" if null. */
  timezone?: string | null;
}

const DEFAULT_TZ = "America/New_York";

/** Build a Zmanim instance for the shul + date. */
function makeZmanim(geo: ShulGeo, date: Date): Zmanim {
  const tz = geo.timezone ?? DEFAULT_TZ;
  const gloc = new GeoLocation(null, geo.lat, geo.lng, 0, tz);
  return new Zmanim(gloc, date, false);
}

/**
 * Convert a {hh, mm} wall-clock time on `date` in `timezone` into a UTC Date.
 * We compute the UTC time that, when rendered in `timezone`, lands at hh:mm
 * on the same calendar date.
 */
function localClockToUTC(
  date: Date,
  hh: number,
  mm: number,
  timezone: string,
): Date {
  // Start with the year/month/day from `date` interpreted in the target zone
  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth();
  const d = date.getUTCDate();

  // Start at the assumed UTC midnight of that calendar day, then adjust until
  // formatting in the target timezone yields the requested hh:mm.
  // This handles DST transitions correctly without pulling in tz-libs.
  let guess = new Date(Date.UTC(y, mo, d, hh, mm, 0, 0));

  // Up to two correction passes (DST jump max ~24h)
  for (let pass = 0; pass < 2; pass++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(guess);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const gotH = parseInt(get("hour") ?? "0", 10) % 24;
    const gotM = parseInt(get("minute") ?? "0", 10);
    const gotD = parseInt(get("day") ?? "0", 10);
    const gotMo = parseInt(get("month") ?? "0", 10) - 1;
    const gotY = parseInt(get("year") ?? "0", 10);

    const targetMs = Date.UTC(y, mo, d, hh, mm, 0, 0);
    const gotMs = Date.UTC(gotY, gotMo, gotD, gotH, gotM, 0, 0);
    const deltaMs = targetMs - gotMs;
    if (deltaMs === 0) return guess;
    guess = new Date(guess.getTime() + deltaMs);
  }
  return guess;
}

export function resolveRuleTime(
  time: MinyanTime,
  geo: ShulGeo,
  date: Date,
): Date | null {
  if (time.kind === "fixed") {
    const [hhStr, mmStr] = time.clock.split(":");
    const hh = parseInt(hhStr, 10);
    const mm = parseInt(mmStr, 10);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return localClockToUTC(date, hh, mm, geo.timezone ?? DEFAULT_TZ);
  }

  // Zmanim-relative
  const z = makeZmanim(geo, date);
  let anchor: Date | null;
  try {
    switch (time.anchor) {
      case "shkia":
        anchor = z.sunset();
        break;
      case "netz":
        anchor = z.sunrise();
        break;
      case "alos":
        anchor = z.alotHaShachar();
        break;
      case "misheyakir":
        anchor = z.misheyakir();
        break;
      case "chatzos":
        anchor = z.chatzot();
        break;
      case "mincha_gedolah":
        anchor = z.minchaGedola();
        break;
      case "plag_mincha":
        anchor = z.plagHaMincha();
        break;
      case "tzeis_72":
        anchor = z.sunsetOffset(72, false);
        break;
      case "tzeis_42":
        anchor = z.tzeit(7.083);
        break;
      case "sof_zman_shma_gra":
        anchor = z.sofZmanShma();
        break;
      case "sof_zman_shma_mga":
        anchor = z.sofZmanShmaMGA();
        break;
      case "sof_zman_tefillah_gra":
        anchor = z.sofZmanTfilla();
        break;
      case "sof_zman_tefillah_mga":
        anchor = z.sofZmanTfillaMGA();
        break;
      case "candle_lighting":
        // Convention: 18 min before sunset. Different cities use 20/22/40
        // — for the zmanim panel we may surface the per-city value; for a
        // minyan_rule that references candle_lighting, 18min is the
        // baseline. The rule's own offsetMin layers on top.
        anchor = z.sunsetOffset(-18, false);
        break;
      default: {
        const _exhaustive: never = time.anchor;
        return null;
      }
    }
  } catch {
    return null;
  }
  if (!anchor) return null;
  return new Date(anchor.getTime() + time.offsetMin * 60_000);
}
