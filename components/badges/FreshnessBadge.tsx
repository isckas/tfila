import { shulFreshnessTier, STALE_THRESHOLD_DAYS } from "@/lib/freshness";

interface Props {
  lastFreshAt: Date | null;
  /** "compact" omits the "stale" qualifier; "full" includes it. */
  variant?: "compact" | "full";
}

/**
 * Single source of truth for the green/amber/red/gray freshness pill
 * shown across the admin surface (/admin/shuls table, /admin inbox
 * row). Prior to consolidation, two near-identical components drifted
 * on label text — `"3d stale"` vs `"stale · 3d"`.
 */
export function FreshnessBadge({ lastFreshAt, variant = "compact" }: Props) {
  const days =
    lastFreshAt == null
      ? null
      : Math.floor(
          (Date.now() - new Date(lastFreshAt).getTime()) / 86_400_000,
        );
  const tier = shulFreshnessTier(days);

  const styles: Record<string, string> = {
    fresh: "bg-emerald-100 text-emerald-800",
    warning: "bg-amber-100 text-amber-800",
    stale: "bg-rose-100 text-rose-800",
    never: "bg-neutral-100 text-neutral-500",
  };
  const text = (() => {
    if (tier === "never") return "never";
    if (tier === "stale") {
      return variant === "full" ? `stale · ${days}d` : `${days}d stale`;
    }
    return `${days}d`;
  })();
  const title =
    tier === "stale"
      ? `Hidden from public — no fresh data_source in last ${STALE_THRESHOLD_DAYS} days`
      : tier === "never"
        ? "No successful run yet"
        : `Last verified ${days}d ago`;

  return (
    <span
      title={title}
      className={`rounded px-1.5 py-0.5 text-xs tabular-nums ${styles[tier]}`}
    >
      {text}
    </span>
  );
}
