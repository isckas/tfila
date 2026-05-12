import { notFound } from "next/navigation";
import { getShulBySlug, getPublicRulesForShul } from "@/lib/queries";
import { resolveRuleTime } from "@/lib/zmanim/resolve";
import { computeZmanimStrip } from "@/lib/zmanim/strip";
import {
  TEFILLAH_LABEL,
  TEFILLAH_ORDER,
  formatClock12,
  formatTimeLabel,
  daysLabel,
  isoDateInTz,
  parseDateOnly,
} from "@/lib/shul-schedule";
import type { MinyanTime } from "@/db/schema";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
}

export const dynamic = "force-dynamic";

export default async function ShulPrintPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const shul = await getShulBySlug(slug);
  if (!shul) notFound();

  const tz = shul.timezone ?? "America/New_York";
  const now = new Date();
  const todayIso = isoDateInTz(now, tz);
  const selectedIso = sp.date && parseDateOnly(sp.date) ? sp.date! : todayIso;
  const selectedDate = parseDateOnly(selectedIso) ?? now;

  const rules = await getPublicRulesForShul(shul.id);

  const recurring: Record<string, typeof rules> = {};
  for (const r of rules) {
    if (r.specialScheduleKind && r.specialScheduleKind !== "regular") continue;
    if (!recurring[r.tefillah]) recurring[r.tefillah] = [];
    recurring[r.tefillah].push(r);
  }

  const zmanim =
    shul.lat != null && shul.lng != null
      ? computeZmanimStrip(
          { lat: shul.lat, lng: shul.lng, timezone: tz },
          selectedDate,
        )
      : null;

  return (
    <main className="mx-auto max-w-xl bg-white px-6 py-8 text-black print:max-w-none print:px-0 print:py-2">
      <header className="border-b-2 border-black pb-3">
        <h1 className="text-2xl font-bold">{shul.name}</h1>
        {shul.address && <p className="text-sm">{shul.address}</p>}
        <p className="mt-1 text-xs">
          Minyan schedule for{" "}
          {selectedDate.toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: tz,
          })}
          {shul.nusach && ` · Nusach ${shul.nusach}`}
        </p>
      </header>

      {/* Today's zmanim — compact */}
      {zmanim && (
        <section className="mt-3 grid grid-cols-3 gap-x-3 gap-y-1 text-xs sm:grid-cols-4 print:grid-cols-5">
          {[
            ["Alos", zmanim.alos],
            ["Netz", zmanim.netz],
            ["Sof Shma", zmanim.sofZmanShmaGra],
            ["Sof Tef", zmanim.sofZmanTefillahGra],
            ["Chatzos", zmanim.chatzos],
            ["Mincha G", zmanim.minchaGedolah],
            ["Plag", zmanim.plag],
            ["Shkia", zmanim.shkia],
            ["Tzeis", zmanim.tzeis72],
          ]
            .filter(([, v]) => v != null)
            .map(([label, v]) => (
              <div key={label as string} className="flex justify-between gap-2">
                <span className="text-neutral-600">{label as string}</span>
                <span className="font-medium tabular-nums">
                  {(v as Date).toLocaleTimeString([], {
                    timeZone: tz,
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </span>
              </div>
            ))}
        </section>
      )}

      {/* Today's actual minyanim (resolved) */}
      <section className="mt-5">
        <h2 className="border-b border-black pb-1 text-sm font-bold uppercase tracking-wide">
          Today
        </h2>
        <table className="mt-1 w-full text-sm">
          <tbody>
            {(() => {
              const selectedDow = new Date(selectedIso + "T12:00:00Z").getUTCDay();
              const items: Array<{
                ruleId: number;
                tefillah: string;
                time: string;
                key: number;
                notes: string | null;
              }> = [];
              for (const r of rules) {
                if (r.specialScheduleKind && r.specialScheduleKind !== "regular") {
                  if (r.validFrom && selectedIso < r.validFrom) continue;
                  if (r.validTo && selectedIso > r.validTo) continue;
                } else {
                  if (!r.daysOfWeek?.includes(selectedDow)) continue;
                }
                const resolved = resolveRuleTime(
                  r.time as MinyanTime,
                  { lat: shul.lat ?? 0, lng: shul.lng ?? 0, timezone: tz },
                  selectedDate,
                );
                if (!resolved) continue;
                items.push({
                  ruleId: r.id,
                  tefillah: r.tefillah,
                  time: formatClock12(resolved, tz),
                  key: resolved.getTime(),
                  notes: r.notes,
                });
              }
              items.sort((a, b) => a.key - b.key);
              if (items.length === 0) {
                return (
                  <tr>
                    <td className="py-1 text-xs italic">No minyanim listed.</td>
                  </tr>
                );
              }
              return items.map((it) => (
                <tr key={it.ruleId}>
                  <td className="w-40 py-1 align-top">
                    {TEFILLAH_LABEL[it.tefillah] ?? it.tefillah}
                  </td>
                  <td className="py-1 align-top font-medium tabular-nums">
                    {it.time}
                  </td>
                  <td className="py-1 pl-3 align-top text-xs text-neutral-700">
                    {it.notes ?? ""}
                  </td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </section>

      {/* Recurring weekly */}
      <section className="mt-5">
        <h2 className="border-b border-black pb-1 text-sm font-bold uppercase tracking-wide">
          Weekly schedule
        </h2>
        {Object.keys(recurring).length === 0 ? (
          <p className="mt-2 text-xs italic">No recurring rules on file.</p>
        ) : (
          <table className="mt-1 w-full text-sm">
            <tbody>
              {TEFILLAH_ORDER.flatMap((tef) =>
                (recurring[tef] ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="w-32 py-1 align-top font-medium">
                      {TEFILLAH_LABEL[r.tefillah] ?? r.tefillah}
                    </td>
                    <td className="w-40 py-1 align-top">
                      {daysLabel(r.daysOfWeek)}
                    </td>
                    <td className="py-1 align-top tabular-nums">
                      {formatTimeLabel(r.time as MinyanTime)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </section>

      <footer className="mt-6 border-t border-black pt-2 text-xs">
        tfila.co/shul/{shul.slug}
        {shul.submittedUrl && (
          <>
            {" · "}
            <span className="text-neutral-600">{shul.submittedUrl}</span>
          </>
        )}
      </footer>
    </main>
  );
}
