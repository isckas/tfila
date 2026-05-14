import Link from "next/link";
import { RelativeTime } from "./RelativeTime";
import { TEFILLAH_LABEL, type ResolvedMinyan } from "./MinyanList";

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
}

/**
 * Card-per-shul rendering used by the 25-mile address-search feed.
 * One shul with 8 daily minyanim shouldn't fill the screen at that
 * radius — see FEATURES.md "Home-page address search". For the dense
 * 2-mi walking feed we still use the flat MinyanList.
 */
export function MinyanListByShul({ groups }: Props) {
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
                <div className="truncate font-medium text-neutral-900">
                  {g.shulName}
                </div>
                {g.address && (
                  <div className="truncate text-xs text-neutral-500">
                    {g.address}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right text-xs tabular-nums text-neutral-500">
                {formatDistance(g.distanceMeters)}
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
                    {m.ruleNusach && (
                      <span className="ml-2 text-xs uppercase tracking-wide text-neutral-500">
                        {m.ruleNusach}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="font-semibold tabular-nums text-neutral-900">
                      {formatTime(m.startIso, m.timezone)}
                    </span>
                    <span className="ml-2 text-xs text-neutral-500">
                      <RelativeTime iso={m.startIso} />
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

function formatTime(iso: string, timezone: string | null): string {
  return new Date(iso).toLocaleTimeString([], {
    timeZone: timezone ?? "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return `${Math.round(meters)} m`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
