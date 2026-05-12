// Shared shul-page formatting helpers (used by both public shul page
// and print page).

import type { MinyanTime } from "../db/schema";

export const TEFILLAH_LABEL: Record<string, string> = {
  shacharis: "Shacharis",
  mincha: "Mincha",
  maariv: "Maariv",
  selichos: "Selichos",
  neilah: "Neilah",
  other: "Other",
};

export const TEFILLAH_ORDER = ["shacharis", "mincha", "maariv", "selichos", "neilah", "other"];

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Shabbos"];

export function formatClock12(date: Date, timezone: string): string {
  return date.toLocaleTimeString([], {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatTimeLabel(t: MinyanTime): string {
  if (t.kind === "fixed") {
    const [hStr, mStr] = t.clock.split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return t.clock;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
  }
  const off = t.offsetMin;
  const offDesc =
    off === 0
      ? "at"
      : off > 0
        ? `${off} min after`
        : `${Math.abs(off)} min before`;
  return `${offDesc} ${anchorLabel(t.anchor)}`;
}

const ANCHOR_LABELS: Record<string, string> = {
  shkia: "sunset",
  tzeis_72: "tzeis (72)",
  tzeis_42: "tzeis (42)",
  alos: "alos",
  netz: "sunrise",
  misheyakir: "misheyakir",
  sof_zman_tefillah_mga: "sof zman tefillah (MGA)",
  sof_zman_tefillah_gra: "sof zman tefillah (GRA)",
  sof_zman_shma_mga: "sof zman shma (MGA)",
  sof_zman_shma_gra: "sof zman shma (GRA)",
  chatzos: "chatzos",
  mincha_gedolah: "mincha gedolah",
  plag_mincha: "plag",
  candle_lighting: "candle-lighting",
};

function anchorLabel(a: string): string {
  return ANCHOR_LABELS[a] ?? a.replace(/_/g, " ");
}

export function daysLabel(days: number[] | null): string {
  if (!days || days.length === 0) return "—";
  if (days.length === 7) return "Daily";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)))
    return "Mon-Fri";
  if (days.length === 1) return DAY_NAMES_SHORT[days[0]];
  // Try to detect Mon-Thu, Sun-Thu patterns
  if (days.length === 4 && [1, 2, 3, 4].every((d) => days.includes(d)))
    return "Mon-Thu";
  if (days.length === 5 && [0, 1, 2, 3, 4].every((d) => days.includes(d)))
    return "Sun-Thu";
  return days.map((d) => DAY_NAMES_SHORT[d]).join(", ");
}

/** Haversine distance in miles. */
export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.8; // earth radius miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 1609.344)} m`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/** JS Date → "YYYY-MM-DD" in a given timezone. */
export function isoDateInTz(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

/** Parse "YYYY-MM-DD" as that calendar date at noon UTC (safe vs. timezones). */
export function parseDateOnly(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
