// Pure, client-safe presentational helpers for rendering a minyan rule's
// tefillah / time / days. Extracted from app/admin/data-source/[id]/page.tsx
// so the same formatting is shared by the deep review page AND the inline
// expand-in-place RulesReviewPanel in the /admin inbox (one source of truth —
// the two surfaces must label rules identically).
//
// Type-only import of MinyanTime (erased at build) keeps this file free of any
// server-only (db) dependency, so it is safe to bundle into client components.

import type { MinyanTime } from "@/db/schema";

const TEFILLAH_LABEL: Record<string, string> = {
  shacharis: "Shacharis",
  mincha: "Mincha",
  maariv: "Maariv",
  selichos: "Selichos",
  neilah: "Neilah",
  other: "Other",
};

export function tefillahLabel(t: string): string {
  return TEFILLAH_LABEL[t] ?? t;
}

export function formatTime(t: MinyanTime): string {
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
    off === 0 ? "at" : off > 0 ? `${off} min after` : `${Math.abs(off)} min before`;
  return `${offDesc} ${t.anchor.replace(/_/g, " ")}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Shabbos"];

export function daysLabel(days: number[] | null): string {
  if (!days || days.length === 0) return "(no recurring day — check valid_from/to)";
  if (days.length === 7) return "Every day";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) {
    return "Mon-Fri";
  }
  if (days.length === 1) return DAY_NAMES[days[0]];
  return days.map((d) => DAY_NAMES[d]).join(", ");
}
