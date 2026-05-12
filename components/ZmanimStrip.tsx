import type { ZmanimSnapshot } from "@/lib/zmanim/strip";

interface Props {
  snapshot: ZmanimSnapshot;
  /** IANA tz for clock formatting. Falls back to system locale. */
  timezone?: string | null;
}

/**
 * Grid of major zmanim for one location/day. Wraps responsively
 * so all values are visible without horizontal scrolling, including
 * on narrow mobile viewports.
 */
export function ZmanimStrip({ snapshot, timezone }: Props) {
  const items: Array<{ label: string; value: Date | null; title: string }> = [
    {
      label: "Alos",
      value: snapshot.alos,
      title: "Alos Hashachar — dawn (72 min before sunrise)",
    },
    {
      label: "Netz",
      value: snapshot.netz,
      title: "Hanetz Hachama — sunrise (earliest Shacharis at sunrise)",
    },
    {
      label: "Sof Shma",
      value: snapshot.sofZmanShmaGra,
      title: "Sof Zman Krias Shma (GRA) — latest time to say morning Shma",
    },
    {
      label: "Sof Tef",
      value: snapshot.sofZmanTefillahGra,
      title:
        "Sof Zman Tefillah (GRA) — latest time to begin Shacharis Shemoneh Esrei",
    },
    {
      label: "Chatzos",
      value: snapshot.chatzos,
      title: "Chatzos Hayom — solar midday",
    },
    {
      label: "Mincha G",
      value: snapshot.minchaGedolah,
      title: "Mincha Gedolah — earliest time to daven Mincha",
    },
    {
      label: "Plag",
      value: snapshot.plag,
      title:
        "Plag Hamincha — earliest time to bring in Shabbos / start early Maariv",
    },
    {
      label: "Shkia",
      value: snapshot.shkia,
      title: "Shkia — sunset",
    },
    {
      label: "Tzeis",
      value: snapshot.tzeis72,
      title: "Tzeis Hakochavim (72 min) — full nightfall",
    },
  ];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Zmanim today
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
        {items.map((it) => (
          <div
            key={it.label}
            title={it.title}
            className="flex cursor-help flex-col items-center rounded-md bg-amber-50/60 px-2 py-1.5 ring-1 ring-amber-100"
          >
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">
              {it.label}
            </span>
            <span className="text-sm font-semibold tabular-nums text-neutral-900">
              {formatTime(it.value, timezone)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(d: Date | null, timezone?: string | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString([], {
    timeZone: timezone ?? undefined,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
