import Link from "next/link";
import { getNearbyShulsWithRules, countByShulStatus } from "@/lib/queries";
import { resolveRuleTime } from "@/lib/zmanim/resolve";
import { computeZmanimStrip } from "@/lib/zmanim/strip";
import { LocationGate } from "@/components/LocationGate";
import { MinyanList, type ResolvedMinyan } from "@/components/MinyanList";
import { ZmanimStrip } from "@/components/ZmanimStrip";
import { SearchBox } from "@/components/SearchBox";
import { ChangeLocationButton } from "@/components/ChangeLocationButton";

export const dynamic = "force-dynamic";

// Feed parameters. Could become user-settable in a later PR.
const DEFAULT_RADIUS_METERS = 3_220; // ~2 miles
const PAST_WINDOW_MIN = 30; // show in-progress minyanim from this many minutes ago
const FUTURE_WINDOW_MIN = 24 * 60; // show upcoming minyanim up to this far out
const MAX_ITEMS = 25; // cap so the feed doesn't become a wall of text

interface PageProps {
  searchParams: Promise<{
    lat?: string;
    lng?: string;
    date?: string;
    err?: string;
    q?: string;
  }>;
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
      <main className="mx-auto max-w-2xl px-5 py-12">
        <header className="mb-8">
          <h1 className="text-4xl font-semibold tracking-tight text-neutral-900">
            tfila<span className="text-amber-700">.</span>co
          </h1>
          <p className="mt-2 text-lg text-neutral-700">
            Find your next minyan near you.
          </p>
        </header>

        {sp.err && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {sp.err === "no-results"
              ? `We couldn't find "${sp.q ?? ""}". Try a more specific address.`
              : sp.err === "geocode-failed"
                ? "The location lookup hit an error. Try again."
                : "Something went wrong."}
          </div>
        )}

        <LocationGate />

        <div className="mt-10 flex flex-wrap items-baseline justify-between gap-3 text-xs text-neutral-500">
          <span>
            {total} shul{total === 1 ? "" : "s"} indexed.
          </span>
          <div className="flex gap-4">
            <Link href="/submit" className="font-medium text-amber-800 underline-offset-2 hover:underline">
              Submit your shul
            </Link>
            <Link href="/bot" className="underline-offset-2 hover:underline">
              About
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ─── Resolved feed ──────────────────────────────────────────────
  const now = new Date();
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
  // Use the system timezone of the request server (Vercel runs UTC) only as a
  // last-resort fallback — most shuls in the feed bring their own.
  const userTz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const stripSnapshot = computeZmanimStrip({ lat, lng, timezone: userTz }, now);

  return (
    <main className="mx-auto max-w-2xl px-5 py-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <Link href="/" className="block">
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
                tfila<span className="text-amber-700">.</span>co
              </h1>
            </Link>
            <p className="mt-0.5 text-xs text-neutral-500 tabular-nums">
              Near {lat.toFixed(3)}, {lng.toFixed(3)}
              {" · "}
              {now.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}
            </p>
          </div>
          <ChangeLocationButton />
        </div>

        <div className="mt-3">
          <SearchBox variant="compact" placeholder="Search a different location…" />
        </div>
      </header>

      <ZmanimStrip snapshot={stripSnapshot} />

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Next minyanim ({trimmed.length}
          {resolved.length > trimmed.length && ` of ${resolved.length}`})
        </h2>
        <MinyanList items={trimmed} serverNowMs={now.getTime()} />
      </section>

      <footer className="mt-10 flex flex-wrap items-baseline justify-between gap-3 text-xs text-neutral-500">
        <Link href="/submit" className="font-medium text-amber-800 underline-offset-2 hover:underline">
          Submit your shul
        </Link>
        <Link href="/bot" className="underline-offset-2 hover:underline">
          About
        </Link>
      </footer>
    </main>
  );
}
