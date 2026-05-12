import Link from "next/link";
import { getNearbyShulsWithRules, countByShulStatus } from "@/lib/queries";
import { resolveRuleTime } from "@/lib/zmanim/resolve";
import { computeZmanimStrip } from "@/lib/zmanim/strip";
import { LocationGate } from "@/components/LocationGate";
import { MinyanList, type ResolvedMinyan } from "@/components/MinyanList";
import { ZmanimStrip } from "@/components/ZmanimStrip";
import { RadiusSelector } from "@/components/RadiusSelector";
import { ChangeLocationButton } from "@/components/ChangeLocationButton";

export const dynamic = "force-dynamic";

const DEFAULT_RADIUS_MILES = 2;
const PAST_WINDOW_MIN = 30;
const FUTURE_WINDOW_MIN = 24 * 60;
const MAX_ITEMS = 25;
const MILES_TO_METERS = 1609.344;

interface PageProps {
  searchParams: Promise<{
    lat?: string;
    lng?: string;
    date?: string;
    radius?: string;
    err?: string;
    q?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const lat = sp.lat ? Number(sp.lat) : null;
  const lng = sp.lng ? Number(sp.lng) : null;
  const radiusMiles = sp.radius ? Number(sp.radius) : DEFAULT_RADIUS_MILES;
  const radiusMeters = Math.max(50, Math.min(50_000, radiusMiles * MILES_TO_METERS));

  // ─── No location yet: render the gate ───────────────────────
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    const counts = await countByShulStatus();
    const total = counts.reduce((s, c) => s + Number(c.n), 0);
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
        <header className="mb-7">
          <h1 className="text-4xl font-semibold tracking-tight text-neutral-900">
            tfila<span className="text-amber-700">.</span>co
          </h1>
          <p className="mt-2 text-lg text-neutral-700">
            Find your next minyan — by name, address, or right where you are.
          </p>
        </header>

        {sp.err && (
          <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {sp.err === "no-results"
              ? `We couldn't find "${sp.q ?? ""}". Try a more specific search.`
              : sp.err === "geocode-failed"
                ? "The location lookup hit an error. Try again."
                : "Something went wrong."}
          </div>
        )}

        <LocationGate />

        <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3 text-sm text-neutral-500">
          <span>
            {total} shul{total === 1 ? "" : "s"} indexed
          </span>
          <div className="flex flex-wrap gap-4">
            <Link href="/find" className="underline-offset-2 hover:underline">
              Find a shul
            </Link>
            <Link
              href="/submit"
              className="font-medium text-amber-800 underline-offset-2 hover:underline"
            >
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

  // ─── Feed view (with location) ──────────────────────────────
  const now = new Date();
  const todayDow = now.getDay();
  const rows = await getNearbyShulsWithRules(lat, lng, radiusMeters);

  const earliest = now.getTime() - PAST_WINDOW_MIN * 60_000;
  const latest = now.getTime() + FUTURE_WINDOW_MIN * 60_000;

  const resolved: ResolvedMinyan[] = [];
  for (const r of rows) {
    if (r.specialScheduleKind !== "regular") continue;
    if (
      r.daysOfWeek &&
      r.daysOfWeek.length > 0 &&
      !r.daysOfWeek.includes(todayDow)
    )
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

  const userTz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const stripSnapshot = computeZmanimStrip({ lat, lng, timezone: userTz }, now);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {/* ─── Header ─────────────────────────────────────────── */}
      <header className="mb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <Link href="/" className="block">
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
                tfila<span className="text-amber-700">.</span>co
              </h1>
            </Link>
            <p className="mt-0.5 text-xs tabular-nums text-neutral-500">
              Near {lat.toFixed(3)}, {lng.toFixed(3)}
              {" · "}
              {now.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <RadiusSelector current={radiusMiles} />
            <ChangeLocationButton />
          </div>
        </div>

        {/* Inline search for switching to a different shul / location */}
        <form method="get" action="/api/search" className="mt-3 flex gap-1.5">
          <input
            type="search"
            name="q"
            placeholder="Switch: shul name or location…"
            className="w-full rounded border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Go
          </button>
        </form>
      </header>

      {/* ─── Zmanim grid (no horizontal scroll) ─────────────── */}
      <ZmanimStrip snapshot={stripSnapshot} timezone={userTz} />

      {/* ─── Minyanim feed ──────────────────────────────────── */}
      <section className="mt-5">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Next minyanim ({trimmed.length}
          {resolved.length > trimmed.length && ` of ${resolved.length}`})
          <span className="ml-1 text-xs font-normal text-neutral-400">
            within {radiusMiles} mi
          </span>
        </h2>
        <MinyanList items={trimmed} serverNowMs={now.getTime()} />
      </section>

      {/* ─── Footer ─────────────────────────────────────────── */}
      <footer className="mt-10 flex flex-wrap items-baseline justify-between gap-3 text-xs text-neutral-500">
        <div className="flex gap-4">
          <Link href="/find" className="underline-offset-2 hover:underline">
            Find by name
          </Link>
          <Link
            href="/submit"
            className="font-medium text-amber-800 underline-offset-2 hover:underline"
          >
            Submit your shul
          </Link>
        </div>
        <Link href="/bot" className="underline-offset-2 hover:underline">
          About
        </Link>
      </footer>
    </main>
  );
}
