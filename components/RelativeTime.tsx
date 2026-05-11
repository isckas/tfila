"use client";

import { useEffect, useState } from "react";

interface Props {
  /** ISO string. Stable across server/client renders. */
  iso: string;
  /** Update interval in ms. Default 30s. */
  intervalMs?: number;
}

/**
 * Displays "in 12m", "starting now", "started 4m ago" etc. for an
 * upcoming/in-progress minyan time. Updates itself on a timer so the
 * page stays accurate without server round-trips.
 */
export function RelativeTime({ iso, intervalMs = 30_000 }: Props) {
  const target = new Date(iso).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const diffMs = target - now;
  const label = formatRelative(diffMs);
  const tone =
    diffMs < -30 * 60_000
      ? "text-neutral-400"
      : diffMs < 0
        ? "text-amber-700"
        : diffMs < 30 * 60_000
          ? "text-emerald-700"
          : "text-neutral-600";

  return <span className={`tabular-nums ${tone}`}>{label}</span>;
}

function formatRelative(diffMs: number): string {
  const absMin = Math.round(Math.abs(diffMs) / 60_000);
  if (Math.abs(diffMs) < 60_000) return diffMs < 0 ? "starting now" : "starting now";
  if (diffMs > 0) {
    if (absMin < 60) return `in ${absMin}m`;
    const h = Math.floor(absMin / 60);
    const m = absMin % 60;
    return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
  }
  // past
  if (absMin < 60) return `started ${absMin}m ago`;
  const h = Math.floor(absMin / 60);
  return `started ${h}h ago`;
}
