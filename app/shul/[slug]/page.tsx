import Link from "next/link";
import { notFound } from "next/navigation";
import { getShulBySlug, getPublicRulesForShul } from "@/lib/queries";
import { resolveRuleTime } from "@/lib/zmanim/resolve";
import { computeZmanimStrip } from "@/lib/zmanim/strip";
import { ZmanimStrip } from "@/components/ZmanimStrip";
import {
  TEFILLAH_LABEL,
  TEFILLAH_ORDER,
  formatClock12,
  formatTimeLabel,
  daysLabel,
  haversineMiles,
  formatDistance,
  isoDateInTz,
  parseDateOnly,
} from "@/lib/shul-schedule";
import type { MinyanTime } from "@/db/schema";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; lat?: string; lng?: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const shul = await getShulBySlug(slug);
  if (!shul) return { title: "Shul not found" };
  return {
    title: shul.name,
    description: shul.address
      ? `${shul.name} — minyan times. ${shul.address}.`
      : `${shul.name} minyan times`,
  };
}

export default async function ShulPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const shul = await getShulBySlug(slug);
  if (!shul) notFound();

  const tz = shul.timezone ?? "America/New_York";
  const now = new Date();
  const todayIso = isoDateInTz(now, tz);
  const selectedIso = (sp.date && parseDateOnly(sp.date)) ? sp.date! : todayIso;
  const selectedDate = parseDateOnly(selectedIso) ?? now;
  const selectedDow = new Date(selectedIso + "T12:00:00Z").getUTCDay();

  const rules = await getPublicRulesForShul(shul.id);

  // User location (from URL params, propagated by home feed link)
  const userLat = sp.lat ? Number(sp.lat) : null;
  const userLng = sp.lng ? Number(sp.lng) : null;
  const distance =
    userLat != null &&
    userLng != null &&
    shul.lat != null &&
    shul.lng != null &&
    !Number.isNaN(userLat) &&
    !Number.isNaN(userLng)
      ? haversineMiles(
          { lat: userLat, lng: userLng },
          { lat: shul.lat, lng: shul.lng },
        )
      : null;

  // ─── Resolve schedule for the selected date ─────────────────
  // Rules that apply to the selected date: special schedules whose
  // valid_from/to bracket the date, plus regular rules matching the
  // day of week.
  interface ResolvedItem {
    ruleId: number;
    tefillah: string;
    tefillahLabel: string | null;
    timeLabel: string;
    sortKey: number; // ms since epoch (for ordering)
    nusach: string | null;
    notes: string | null;
    specialScheduleKind: string;
  }

  const dayItems: ResolvedItem[] = [];
  for (const r of rules) {
    // Date-bounded special rule
    if (r.specialScheduleKind && r.specialScheduleKind !== "regular") {
      const from = r.validFrom;
      const to = r.validTo;
      if (from && selectedIso < from) continue;
      if (to && selectedIso > to) continue;
    } else {
      // Regular rule — require day of week match
      if (
        !r.daysOfWeek ||
        r.daysOfWeek.length === 0 ||
        !r.daysOfWeek.includes(selectedDow)
      )
        continue;
    }

    const resolved = resolveRuleTime(
      r.time as MinyanTime,
      { lat: shul.lat ?? 0, lng: shul.lng ?? 0, timezone: tz },
      selectedDate,
    );
    if (!resolved) continue;

    dayItems.push({
      ruleId: r.id,
      tefillah: r.tefillah,
      tefillahLabel: r.tefillahLabel,
      timeLabel: formatClock12(resolved, tz),
      sortKey: resolved.getTime(),
      nusach: r.nusach,
      notes: r.notes,
      specialScheduleKind: r.specialScheduleKind ?? "regular",
    });
  }
  dayItems.sort((a, b) => a.sortKey - b.sortKey);

  // ─── Recurring weekly schedule (regular rules only) ─────────
  const recurring: Record<string, typeof rules> = {};
  for (const r of rules) {
    if (r.specialScheduleKind && r.specialScheduleKind !== "regular") continue;
    if (!recurring[r.tefillah]) recurring[r.tefillah] = [];
    recurring[r.tefillah].push(r);
  }

  // Zmanim for selected date at the shul's location
  const zmanim =
    shul.lat != null && shul.lng != null
      ? computeZmanimStrip(
          { lat: shul.lat, lng: shul.lng, timezone: tz },
          selectedDate,
        )
      : null;

  const userLocSuffix =
    userLat != null && userLng != null ? `&lat=${userLat}&lng=${userLng}` : "";

  return (
    <main className="mx-auto max-w-2xl px-5 py-6">
      <Link
        href={userLat != null && userLng != null ? `/?lat=${userLat}&lng=${userLng}` : "/"}
        className="text-xs text-neutral-500 hover:underline"
      >
        ← back
      </Link>

      <header className="mt-3">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {shul.name}
        </h1>
        {shul.address && (
          <p className="mt-1 text-sm text-neutral-700">{shul.address}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {shul.nusach && (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800">
              {shul.nusach}
            </span>
          )}
          {distance != null && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 tabular-nums text-neutral-700">
              {formatDistance(distance)} from your location
            </span>
          )}
          {shul.lat != null && shul.lng != null && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${shul.lat},${shul.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-800 underline-offset-2 hover:underline"
            >
              directions →
            </a>
          )}
          <Link
            href={`/shul/${shul.slug}/print${selectedIso !== todayIso ? `?date=${selectedIso}` : ""}`}
            className="ml-auto text-neutral-500 underline-offset-2 hover:underline"
          >
            printable
          </Link>
        </div>
      </header>

      {/* ─── Date picker ────────────────────────────────────── */}
      <form method="get" action={`/shul/${shul.slug}`} className="mt-5 flex items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-neutral-700">View date:</span>
          <input
            type="date"
            name="date"
            defaultValue={selectedIso}
            className="rounded border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </label>
        {userLat != null && userLng != null && (
          <>
            <input type="hidden" name="lat" value={userLat} />
            <input type="hidden" name="lng" value={userLng} />
          </>
        )}
        <button
          type="submit"
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800"
        >
          Update
        </button>
        {selectedIso !== todayIso && (
          <Link
            href={`/shul/${shul.slug}${userLocSuffix.startsWith("&") ? "?" + userLocSuffix.slice(1) : ""}`}
            className="text-xs text-neutral-500 underline-offset-2 hover:underline"
          >
            today
          </Link>
        )}
      </form>

      {/* ─── Zmanim strip for selected date ─────────────────── */}
      {zmanim && (
        <section className="mt-4">
          <ZmanimStrip snapshot={zmanim} />
        </section>
      )}

      {/* ─── Schedule for selected date ─────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Schedule for{" "}
          {selectedDate.toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone: tz,
          })}
          {selectedIso === todayIso && " (today)"}
        </h2>
        {dayItems.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
            No minyanim listed for this day.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {dayItems.map((it) => (
              <li
                key={it.ruleId}
                className="flex items-baseline justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="font-medium text-neutral-900">
                    {TEFILLAH_LABEL[it.tefillah] ??
                      it.tefillahLabel ??
                      it.tefillah}
                    {it.specialScheduleKind !== "regular" && (
                      <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-800">
                        {it.specialScheduleKind.replace(/_/g, " ")}
                      </span>
                    )}
                    {it.nusach && (
                      <span className="ml-2 text-xs uppercase tracking-wide text-neutral-500">
                        {it.nusach}
                      </span>
                    )}
                  </div>
                  {it.notes && (
                    <div className="text-xs text-neutral-500">{it.notes}</div>
                  )}
                </div>
                <div className="text-base font-semibold tabular-nums text-neutral-900 shrink-0">
                  {it.timeLabel}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Recurring weekly schedule ──────────────────────── */}
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Recurring weekly schedule
        </h2>
        {Object.keys(recurring).length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            No regular weekly rules on file.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2">Tefillah</th>
                  <th className="px-3 py-2">Days</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {TEFILLAH_ORDER.flatMap((tef) =>
                  (recurring[tef] ?? []).map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-neutral-100 last:border-0"
                    >
                      <td className="px-3 py-2 font-medium">
                        {TEFILLAH_LABEL[r.tefillah] ?? r.tefillah}
                        {r.tefillahLabel && (
                          <span className="ml-1 text-xs text-neutral-500">
                            ({r.tefillahLabel})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-700">
                        {daysLabel(r.daysOfWeek)}
                      </td>
                      <td className="px-3 py-2 tabular-nums font-medium">
                        {formatTimeLabel(r.time as MinyanTime)}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-500">
                        {r.notes ?? ""}
                        {r.nusach && (
                          <span className="ml-1 rounded bg-blue-100 px-1 text-blue-800">
                            {r.nusach}
                          </span>
                        )}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Map ────────────────────────────────────────────── */}
      {shul.lat != null && shul.lng != null && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">Location</h2>
          <div className="overflow-hidden rounded-xl border border-neutral-200">
            <iframe
              title={`Map of ${shul.name}`}
              width="100%"
              height="280"
              loading="lazy"
              style={{ border: 0 }}
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${shul.lng - 0.01},${shul.lat - 0.005},${shul.lng + 0.01},${shul.lat + 0.005}&layer=mapnik&marker=${shul.lat},${shul.lng}`}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${shul.lat},${shul.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-800 underline-offset-2 hover:underline"
            >
              Open in Google Maps
            </a>
            {" · "}
            <a
              href={`https://www.openstreetmap.org/?mlat=${shul.lat}&mlon=${shul.lng}#map=16/${shul.lat}/${shul.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:underline"
            >
              View on OpenStreetMap
            </a>
          </p>
        </section>
      )}

      {/* ─── Source attribution ─────────────────────────────── */}
      {shul.submittedUrl && (
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-medium text-neutral-700">
            Schedule source
          </h2>
          <p className="text-xs text-neutral-600">
            Times above are extracted from the shul&apos;s own schedule page,
            re-checked weekly. Verify against the source directly:{" "}
            <a
              href={shul.submittedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-amber-800 underline-offset-2 hover:underline"
            >
              {shul.submittedUrl}
            </a>
          </p>
        </section>
      )}

      {/* ─── Footer ─────────────────────────────────────────── */}
      <footer className="mt-10 text-xs text-neutral-500">
        Status: <span className="font-mono">{shul.status}</span>
        {" · "}
        <Link href="/" className="underline-offset-2 hover:underline">
          home feed
        </Link>
        {" · "}
        <Link href="/find" className="underline-offset-2 hover:underline">
          find another shul
        </Link>
      </footer>
    </main>
  );
}
