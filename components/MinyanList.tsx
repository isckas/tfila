"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RelativeTime } from "./RelativeTime";
import {
  formatClockFromIso,
  formatDistanceMeters,
  formatRelativeDays,
} from "@/lib/format";

/**
 * Minutes after start during which a minyan is still considered "live."
 * Loose heuristic — covers the typical tefillah duration on most days.
 * Shabbos Shacharis can exceed this but the visual cue is still useful.
 */
const LIVE_WINDOW_MS = 30 * 60_000;

export interface ResolvedMinyan {
  ruleId: number;
  shulId: number;
  shulSlug: string;
  shulName: string;
  shulNusach: string | null;
  ruleNusach: string | null;
  address: string | null;
  distanceMeters: number;
  tefillah: string;
  tefillahLabel: string | null;
  /** Resolved absolute time as ISO string. */
  startIso: string;
  /**
   * The shul's timezone. Used by formatTime to render the clock in
   * local-to-the-shul time (the davener will physically be there).
   * Without this, SSR falls back to the host TZ (UTC on Vercel) and
   * a 7:49pm EDT minyan renders as "11:49 PM."
   */
  timezone: string | null;
  notes: string | null;
  /** "regular" or a special kind like "yom_tov", "fast_day", etc. */
  specialScheduleKind: string;
  /** Most-recent successful scrape time as ISO string. Powers the
   * "Verified Nd ago" trust chip. Null if no successful scrape (rare —
   * the stale-gate query already excludes those). */
  lastVerifiedIso: string | null;
  /** E-C4: true for a fixed-clock mincha/maariv — flagged as seasonally drift-prone. */
  fixedEvening?: boolean;
}

interface Props {
  items: ResolvedMinyan[];
  /** Now timestamp at server-render time, in ms. Used for "in-progress" cutoff. */
  serverNowMs: number;
}

const TEFILLAH_LABEL: Record<string, string> = {
  shacharis: "Shacharis",
  mincha: "Mincha",
  maariv: "Maariv",
  selichos: "Selichos",
  neilah: "Neilah",
  other: "Other",
};

type ChipFilter = "all" | "shacharis" | "mincha" | "maariv";

const CHIP_ORDER: ChipFilter[] = ["all", "shacharis", "mincha", "maariv"];

const CHIP_LABEL: Record<ChipFilter, string> = {
  all: "All",
  shacharis: "Shacharis",
  mincha: "Mincha",
  maariv: "Maariv",
};

export function MinyanList({ items, serverNowMs }: Props) {
  const [active, setActive] = useState<ChipFilter>("all");

  // Ticking clock — drives the "live" badge transitions and keeps the
  // SSR-server-now match on first paint (no hydration flicker).
  const [nowMs, setNowMs] = useState(serverNowMs);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Count per tefillah so we can hide empty chips (Maariv at 8am makes
  // little sense as a chip). Always show "All" + whatever is present.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of items) c[m.tefillah] = (c[m.tefillah] ?? 0) + 1;
    return c;
  }, [items]);

  const visibleChips = CHIP_ORDER.filter(
    (chip) => chip === "all" || (counts[chip] ?? 0) > 0,
  );

  const filtered = useMemo(() => {
    if (active === "all") return items;
    return items.filter((m) => m.tefillah === active);
  }, [items, active]);

  return (
    <>
      {/* Filter chip row — only renders when there are at least 2 tefillah
          buckets present (otherwise it's noise). */}
      {visibleChips.length >= 3 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {visibleChips.map((chip) => {
            const isActive = active === chip;
            return (
              <button
                key={chip}
                type="button"
                onClick={() => setActive(chip)}
                className={
                  "rounded-full border px-3 py-1 text-xs transition-colors " +
                  (isActive
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")
                }
              >
                {CHIP_LABEL[chip]}
                {chip !== "all" && (
                  <span className="ml-1 text-neutral-400">
                    {counts[chip] ?? 0}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
          {active === "all" ? (
            <>
              <p className="font-medium text-neutral-900">
                Nothing in the next few hours within walking distance.
              </p>
              <p className="mt-2 text-neutral-600">
                Know a shul nearby? Help us list it — we&apos;ll keep its tfila
                times fresh from its own website or weekly bulletin.
              </p>
              <Link
                href="/submit"
                className="mt-3 inline-block rounded-lg bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-900"
              >
                Add a shul
              </Link>
            </>
          ) : (
            `No ${CHIP_LABEL[active]} in the next few hours within walking distance.`
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((m) => {
            const startMs = new Date(m.startIso).getTime();
            const isLive =
              nowMs > startMs && nowMs - startMs < LIVE_WINDOW_MS;
            return (
              <li key={m.ruleId}>
                <Link
                  href={`/shul/${m.shulSlug}`}
                  className={
                    "block rounded-xl border bg-white px-4 py-3 hover:bg-neutral-50 " +
                    (isLive
                      ? "border-emerald-300 ring-1 ring-emerald-100"
                      : "border-neutral-200 hover:border-neutral-300")
                  }
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-neutral-900">
                        <span className="truncate">
                          {TEFILLAH_LABEL[m.tefillah] ?? m.tefillahLabel ?? m.tefillah}
                        </span>
                        {isLive && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                            live
                          </span>
                        )}
                        {m.specialScheduleKind !== "regular" && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">
                            {m.specialScheduleKind.replace(/_/g, " ")}
                          </span>
                        )}
                        {m.ruleNusach && (
                          <span className="text-xs uppercase tracking-wide text-neutral-500">
                            {m.ruleNusach}
                          </span>
                        )}
                      </div>
                      <h3 className="truncate text-sm font-normal text-neutral-600">
                        {m.shulName}
                        {m.address && (
                          <span className="ml-2 text-neutral-400">· {m.address}</span>
                        )}
                      </h3>
                      {m.lastVerifiedIso && (
                        <div className="mt-0.5 text-xs text-emerald-700">
                          Verified{" "}
                          {formatRelativeDays(
                            new Date(m.lastVerifiedIso),
                            new Date(nowMs),
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold tabular-nums text-neutral-900">
                        {formatClockFromIso(m.startIso, m.timezone)}
                      </div>
                      <div className="text-xs">
                        <RelativeTime iso={m.startIso} serverNowMs={serverNowMs} />
                      </div>
                      <div className="text-xs text-neutral-500 tabular-nums">
                        {formatDistanceMeters(m.distanceMeters)}
                      </div>
                    </div>
                  </div>
                  {m.notes && (
                    <div className="mt-1 text-xs text-neutral-500">{m.notes}</div>
                  )}
                  {m.fixedEvening && (
                    <div
                      className="mt-0.5 text-xs text-neutral-400"
                      title="This is a posted clock time, not anchored to sunset, so it may drift across the year. Double-check close to the time."
                    >
                      posted time — may shift seasonally
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export { TEFILLAH_LABEL };
