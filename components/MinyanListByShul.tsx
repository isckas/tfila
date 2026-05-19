import Link from "next/link";
import { RelativeTime } from "./RelativeTime";
import { TEFILLAH_LABEL, type ResolvedMinyan } from "./MinyanList";
import { formatClockFromIso, formatDistanceMeters } from "@/lib/format";

export interface ShulGroup {
  shulId: number;
  shulSlug: string;
  shulName: string;
  address: string | null;
  distanceMeters: number;
  /** Already trimmed to the closest 1-2 upcoming minyanim. */
  minyanim: ResolvedMinyan[];
}

interface Props {
  groups: ShulGroup[];
  /** Server's render-time `Date.now()`, threaded into each
   * RelativeTime to eliminate hydration flicker. */
  serverNowMs: number;
}

/**
 * Card-per-shul rendering used by the 25-mile address-search feed.
 * One shul with 8 daily minyanim shouldn't fill the screen at that
 * radius — see FEATURES.md "Home-page address search". For the dense
 * 2-mi walking feed we still use the flat MinyanList.
 */
export function MinyanListByShul({ groups, serverNowMs }: Props) {
  return (
    <ul className="space-y-2">
      {groups.map((g) => (
        <li key={g.shulId}>
          <Link
            href={`/shul/${g.shulSlug}`}
            className="block rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300 hover:bg-neutral-50"
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-medium text-neutral-900">
                  {g.shulName}
                </h3>
                {g.address && (
                  <div className="truncate text-xs text-neutral-500">
                    {g.address}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right text-xs tabular-nums text-neutral-500">
                {formatDistanceMeters(g.distanceMeters)}
              </div>
            </div>

            <ul className="mt-2 space-y-1">
              {g.minyanim.map((m) => (
                <li
                  key={m.ruleId}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="truncate text-neutral-700">
                    {TEFILLAH_LABEL[m.tefillah] ?? m.tefillahLabel ?? m.tefillah}
                    {m.specialScheduleKind !== "regular" && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        {m.specialScheduleKind.replace(/_/g, " ")}
                      </span>
                    )}
                    {m.ruleNusach && (
                      <span className="ml-2 text-xs uppercase tracking-wide text-neutral-500">
                        {m.ruleNusach}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="font-semibold tabular-nums text-neutral-900">
                      {formatClockFromIso(m.startIso, m.timezone)}
                    </span>
                    <span className="ml-2 text-xs text-neutral-500">
                      <RelativeTime iso={m.startIso} serverNowMs={serverNowMs} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Link>
        </li>
      ))}
    </ul>
  );
}

