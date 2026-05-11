import type { ZmanimSnapshot } from "@/lib/zmanim/strip";

interface Props {
  snapshot: ZmanimSnapshot;
}

export function ZmanimStrip({ snapshot }: Props) {
  const pills: Array<{ label: string; value: Date | null }> = [
    { label: "Alos", value: snapshot.alos },
    { label: "Netz", value: snapshot.netz },
    { label: "Sof Shma", value: snapshot.sofZmanShmaGra },
    { label: "Sof Tef", value: snapshot.sofZmanTefillahGra },
    { label: "Chatzos", value: snapshot.chatzos },
    { label: "Mincha G", value: snapshot.minchaGedolah },
    { label: "Plag", value: snapshot.plag },
    { label: "Shkia", value: snapshot.shkia },
    { label: "Tzeis", value: snapshot.tzeis72 },
  ];

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
      <div className="flex gap-2 overflow-x-auto text-xs text-neutral-700">
        {pills.map((p) => (
          <div
            key={p.label}
            className="flex shrink-0 flex-col items-center rounded-md bg-white px-2 py-1 ring-1 ring-neutral-200"
          >
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">
              {p.label}
            </span>
            <span className="font-medium tabular-nums">{formatTime(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
