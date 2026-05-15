import Link from "next/link";
import { RelativeTime } from "./RelativeTime";
import { formatClockFromIso, formatDistanceMeters } from "@/lib/format";

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
                <h3 className="truncate text-sm font-normal text-neutral-600">
                  {m.shulName}
                  {m.address && (
                    <span className="ml-2 text-neutral-400">· {m.address}</span>
                  )}
                </h3>
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold tabular-nums text-neutral-900">
                  {formatClockFromIso(m.startIso, m.timezone)}
                </div>
                <div className="text-xs">
                  <RelativeTime iso={m.startIso} />
                </div>
                <div className="text-xs text-neutral-500 tabular-nums">
                  {formatDistanceMeters(m.distanceMeters)}
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

export { TEFILLAH_LABEL };
