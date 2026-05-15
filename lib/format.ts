// Shared display formatters. Consolidates the byte-identical (or worse,
// near-identical-with-drifting-thresholds) helpers that were copy/pasted
// across MinyanList, MinyanListByShul, and lib/shul-schedule.ts.

/**
 * Format an ISO timestamp as a 12-hour clock label in the given
 * timezone. Falls back to America/New_York when timezone is null —
 * same default the shul page uses, and most shuls in our DB are
 * Eastern. Without an explicit timeZone, server-side rendering uses
 * the host TZ (UTC on Vercel) and produces wrong wall-clock times.
 */
export function formatClockFromIso(
  iso: string,
  timezone: string | null,
): string {
  return new Date(iso).toLocaleTimeString([], {
    timeZone: timezone ?? "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Same as above but takes a Date instead of an ISO string. Used by
 * the shul page (lib/shul-schedule.ts re-exports as formatClock12).
 */
export function formatClockFromDate(date: Date, timezone: string): string {
  return date.toLocaleTimeString([], {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Distance in meters → human-readable. <100m shows meters, <10mi shows
 * one decimal, >=10mi rounds to nearest mile. Single source of truth —
 * the shul-schedule helper takes miles instead of meters.
 */
export function formatDistanceMeters(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return `${Math.round(meters)} m`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/** Same threshold ladder, takes miles. Used by the shul page. */
export function formatDistanceMiles(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 1609.344)} m`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
