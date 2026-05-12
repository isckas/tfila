import Link from "next/link";
import { getNearbyShulsWithRules, countByShulStatus } from "@/lib/queries";
import { resolveRuleTime } from "@/lib/zmanim/resolve";
import { computeZmanimStrip } from "@/lib/zmanim/strip";
import { LocationGate } from "@/components/LocationGate";
import { MinyanList, type ResolvedMinyan } from "@/components/MinyanList";
import { ZmanimStrip } from "@/components/ZmanimStrip";

export const dynamic = "force-dynamic";

// Feed parameters. Could become user-settable in a later PR.
const DEFAULT_RADIUS_METERS = 3_220; // ~2 miles
const PAST_WINDOW_MIN = 30; // show in-progress minyanim from this many minutes ago
const FUTURE_WINDOW_MIN = 24 * 60; // show upcoming minyanim up to this far out
const MAX_ITEMS = 25; // cap so the feed doesn't become a wall of text

interface PageProps {
  searchParams: Promise<{ lat?: string; lng?: string; date?: string }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const lat = sp.lat ? Number(sp.lat) : null;
  const lng = sp.lng ? Number(sp.lng) : null;

  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    // No location yet — render the gate.
    const counts = await countByShulStatus();
    const total = counts.reduce((s, c) => s + Number(c.n), 0);
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold">tfila.co</h1>
          <p className="text-neutral-600">Find your next minyan near you.</p>
        </header>
        <LocationGate />
        <p className="mt-6 text-xs text-neutral-500">
          {total} shul{total === 1 ? "" : "s"} indexed.{" "}
          <Link href="/bot" className="underline">About the scraper</Link>.
        </p>
      </main>
    );
  }

  // ─── Resolved feed ──────────────────────────────────────────────
  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const todayDow = now.getDay(); // 0 = Sunday in JS

  const rows = await getNearbyShulsWithRules(lat, lng, DEFAULT_RADIUS_METERS);

  // Resolve each rule against today's date+shul-location, filter to the
  // upcoming-or-just-started window, sort by start time.
  const earliest = now.getTime() - PAST_WINDOW_MIN * 60_000;
  const latest = now.getTime() + FUTURE_WINDOW_MIN * 60_000;

  const resolved: ResolvedMinyan[] = [];
  for (const r of rows) {
    if (r.specialScheduleKind !== "regular") continue;
    if (r.daysOfWeek && r.daysOfWeek.length > 0 && !r.daysOfWeek.includes(todayDow))
      continue;

    const startDate = resolveRuleTime(
      r.time,
      { lat: r.lat, lng: r.lng, timezone: r.timezone },
      now,
    );
    if (!startDate) continue;
    const startMs = startDate.getTime();
    if (startMs < earliest || startMs > latest) continue;

    resolved.push({
      ruleId: r.ruleId,
      shulId: r.shulId,
      shulSlug: r.slug,
      shulName: r.name,
      shulNusach: r.nusach,
      ruleNusach: r.ruleNusach,
      address: r.address,
      distanceMeters: r.distanceMeters,
      tefillah: r.tefillah,
      tefillahLabel: r.tefillahLabel,
      startIso: startDate.toISOString(),
      notes: r.notes,
    });
  }
  resolved.sort((a, b) => a.startIso.localeCompare(b.startIso));
  const trimmed = resolved.slice(0, MAX_ITEMS);

  // Zmanim strip is anchored on the user's location, not any particular shul.
  // Timezone: we don't know it without a lookup; for v1, derive from system
  // timezone of the request (Vercel servers run UTC). Fall back to ET.
  const userTz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const stripSnapshot = computeZmanimStrip({ lat, lng, timezone: userTz }, now);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">tfila.co</h1>
          <p className="text-xs text-neutral-500 tabular-nums">
            Near {lat.toFixed(3)}, {lng.toFixed(3)}
            {" · "}
            {now.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </p>
        </div>
        <Link
          href="/"
          className="text-xs text-neutral-500 underline-offset-2 hover:underline"
        >
          change location
        </Link>
      </header>

      <ZmanimStrip snapshot={stripSnapshot} />

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Next minyanim ({trimmed.length}
          {resolved.length > trimmed.length && ` of ${resolved.length}`})
        </h2>
        <MinyanList items={trimmed} serverNowMs={now.getTime()} />
      </section>

      <footer className="mt-10 text-xs text-neutral-400">
        <Link href="/bot" className="underline-offset-2 hover:underline">
          About the scraper
        </Link>
      </footer>
    </main>
  );
}
