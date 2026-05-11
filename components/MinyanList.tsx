import Link from "next/link";
import { RelativeTime } from "./RelativeTime";

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
  notes: string | null;
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

export function MinyanList({ items, serverNowMs }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
        Nothing in the next few hours within walking distance.
        <span className="block mt-2 text-xs text-neutral-500">
          (Most sprint-1 shuls don&apos;t have addresses yet, so this is expected
          for now. The address-backfill pass lands next.)
        </span>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((m) => (
        <li key={m.ruleId}>
          <Link
            href={`/shul/${m.shulSlug}`}
            className="block rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300 hover:bg-neutral-50"
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-neutral-900">
                  {TEFILLAH_LABEL[m.tefillah] ?? m.tefillahLabel ?? m.tefillah}
                  {m.ruleNusach && (
                    <span className="ml-2 text-xs uppercase tracking-wide text-neutral-500">
                      {m.ruleNusach}
                    </span>
                  )}
                </div>
                <div className="truncate text-sm text-neutral-600">
                  {m.shulName}
                  {m.address && (
                    <span className="ml-2 text-neutral-400">· {m.address}</span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold tabular-nums text-neutral-900">
                  {formatTime(m.startIso)}
                </div>
                <div className="text-xs">
                  <RelativeTime iso={m.startIso} />
                </div>
                <div className="text-xs text-neutral-500 tabular-nums">
                  {formatDistance(m.distanceMeters)}
                </div>
              </div>
            </div>
            {m.notes && (
              <div className="mt-1 text-xs text-neutral-500">{m.notes}</div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
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

export { TEFILLAH_LABEL };
