import Link from "next/link";
import Image from "next/image";
import { find as findTz } from "geo-tz";
import {
  getNearbyShulsWithRules,
  listShulsForLookup,
} from "@/lib/queries";
import { resolveRuleTime } from "@/lib/zmanim/resolve";
import { computeZmanimStrip } from "@/lib/zmanim/strip";
import { isoDateInTz, parseDateOnly } from "@/lib/shul-schedule";
import { reverseGeocode } from "@/lib/geocoding";
import { FindCard } from "@/components/FindCard";
import { LookupCard } from "@/components/LookupCard";
import { AddCard } from "@/components/AddCard";
import { ResumeBanner } from "@/components/ResumeBanner";
import { FeedHeader } from "@/components/FeedHeader";
import { MinyanList, type ResolvedMinyan } from "@/components/MinyanList";
import {
  MinyanListByShul,
  type ShulGroup,
} from "@/components/MinyanListByShul";
import { ZmanimStrip } from "@/components/ZmanimStrip";

export const dynamic = "force-dynamic";

// Walking-default radius for the "Use my location" path.
const DEFAULT_RADIUS_MILES = 2;
// Address-search radius. Typed-address intent is usually a traveler /
// new-in-town / planning-by-car — see FEATURES.md "Home-page address
// search". Triggered by ?via=address marker emitted by /api/search.
const ADDRESS_SEARCH_RADIUS_MILES = 25;
const PAST_WINDOW_MIN = 30;
const FUTURE_WINDOW_MIN = 24 * 60;
const MAX_ITEMS = 25;
const MAX_MINYANIM_PER_SHUL = 2;
const MILES_TO_METERS = 1609.344;

interface PageProps {
  searchParams: Promise<{
    lat?: string;
    lng?: string;
    date?: string;
    radius?: string;
    err?: string;
    q?: string;
    via?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const lat = sp.lat ? Number(sp.lat) : null;
  const lng = sp.lng ? Number(sp.lng) : null;
  const isAddressSearch = sp.via === "address";
  const defaultRadius = isAddressSearch
    ? ADDRESS_SEARCH_RADIUS_MILES
    : DEFAULT_RADIUS_MILES;
  const radiusMiles = sp.radius ? Number(sp.radius) : defaultRadius;
  const radiusMeters = Math.max(
    50,
    Math.min(50_000, radiusMiles * MILES_TO_METERS),
  );

  // ─── No location yet: three-card landing ─────────────────────
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    const lookupShuls = await listShulsForLookup();

    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <header className="mb-4 sm:mb-6">
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-8">
            <div className="flex items-center gap-4 sm:gap-6">
              {/* Full logo (pin + "tfila.co" wordmark). Sized so the
                  tagline next to it stays the visual anchor. Aspect
                  ratio is ~512x721 (taller than wide because of the
                  wordmark) — set width and let height auto-scale. */}
              <Image
                src="/tfila-full.png"
                alt="tfila.co"
                width={512}
                height={721}
                priority
                className="h-auto w-12 shrink-0 sm:w-16"
              />
              <div className="text-left">
                <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
                  Tfila times that don&apos;t go stale.
                </h1>
                <p className="mt-2 text-sm text-neutral-600">
                  Every Tfila / Shul directory has the same problem
                  &mdash; times posted years ago, never updated. Tfila.co
                  reads each shul&apos;s own website or weekly email
                  bulletin, refreshes every Motzei Shabbat, for real
                  accurate Tfila times.
                </p>
              </div>
            </div>
          </div>
        </header>

        <ResumeBanner />

        {sp.err && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {sp.err === "no-results"
              ? `We couldn't find "${sp.q ?? ""}". Try a more specific search.`
              : sp.err === "geocode-failed"
                ? "The location lookup hit an error. Try again."
                : "Something went wrong."}
          </div>
        )}

        {/* ─── Three equal cards — stack on mobile, 3 cols on tablet+ ── */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Card 1 — Find (functional widget) */}
          <FindCard />

          {/* Card 2 — Look up (live fuzzy search embedded) */}
          <LookupCard shuls={lookupShuls} />

          {/* Card 3 — Add (URL form + email instructions embedded) */}
          <AddCard />
        </section>

        <footer className="mt-10 flex flex-wrap items-baseline justify-end gap-3 text-xs text-neutral-500">
          <Link href="/bot" className="underline-offset-2 hover:underline">
            About
          </Link>
        </footer>
      </main>
    );
  }

  // ─── Feed view (with location) ──────────────────────────────
  const now = new Date();
  // Travel mode: `?date=YYYY-MM-DD` anchors the schedule to that day
  // instead of "now". Use a wide full-day window so users see the full
  // day's services. Without `?date`, fall back to the "next ~24h"
  // behavior the feed has always had.
  const travelDate = sp.date ? parseDateOnly(sp.date) : null;
  const referenceDate = travelDate ?? now;
  const referenceDow = referenceDate.getDay();
  const rows = await getNearbyShulsWithRules(lat, lng, radiusMeters);

  const earliest = travelDate
    ? Date.UTC(
        travelDate.getUTCFullYear(),
        travelDate.getUTCMonth(),
        travelDate.getUTCDate(),
      ) -
      12 * 60 * 60_000
    : now.getTime() - PAST_WINDOW_MIN * 60_000;
  const latest = travelDate
    ? Date.UTC(
        travelDate.getUTCFullYear(),
        travelDate.getUTCMonth(),
        travelDate.getUTCDate(),
      ) +
      36 * 60 * 60_000
    : now.getTime() + FUTURE_WINDOW_MIN * 60_000;

  const resolved: ResolvedMinyan[] = [];
  for (const r of rows) {
    // Special-schedule rules (Yom Tov, fasts, etc.) are included when their
    // valid_from/valid_to bracket today in the shul's timezone — these are
    // exactly the days where regular rules don't apply and users need to
    // see the override. Without this branch, days like Tisha B'Av silently
    // showed nothing for the feed because the only applicable rules were
    // special. Mirrors the shul detail page's resolution logic.
    if (r.specialScheduleKind && r.specialScheduleKind !== "regular") {
      const refIso = isoDateInTz(referenceDate, r.timezone ?? "UTC");
      if (r.validFrom && refIso < r.validFrom) continue;
      if (r.validTo && refIso > r.validTo) continue;
    } else if (
      r.daysOfWeek &&
      r.daysOfWeek.length > 0 &&
      !r.daysOfWeek.includes(referenceDow)
    ) {
      continue;
    }

    const startDate = resolveRuleTime(
      r.time,
      { lat: r.lat, lng: r.lng, timezone: r.timezone },
      referenceDate,
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
      timezone: r.timezone,
      notes: r.notes,
      specialScheduleKind: r.specialScheduleKind ?? "regular",
      lastVerifiedIso: r.lastVerifiedAt ? r.lastVerifiedAt.toISOString() : null,
    });
  }
  // Sort by start time first — for address-search, this also gives each
  // shul's earliest-upcoming minyanim when we take the top N per shul below.
  resolved.sort((a, b) => a.startIso.localeCompare(b.startIso));

  // Address-search branch: per-shul grouping + distance-sort. The
  // walking-default flat list still gets the time-sort + slice below.
  let shulGroups: ShulGroup[] | null = null;
  if (isAddressSearch) {
    const byShul = new Map<number, ShulGroup>();
    for (const r of resolved) {
      let g = byShul.get(r.shulId);
      if (!g) {
        g = {
          shulId: r.shulId,
          shulSlug: r.shulSlug,
          shulName: r.shulName,
          address: r.address,
          distanceMeters: r.distanceMeters,
          minyanim: [],
        };
        byShul.set(r.shulId, g);
      }
      if (g.minyanim.length < MAX_MINYANIM_PER_SHUL) {
        g.minyanim.push(r);
      }
    }
    shulGroups = Array.from(byShul.values())
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, MAX_ITEMS);
  }

  const trimmed = resolved.slice(0, MAX_ITEMS);

  // Derive the timezone FROM lat/lng (the user's search location) — not
  // from the server's TZ. On Vercel, Intl.DateTimeFormat returns "UTC"
  // server-side, which would render every clock 4-5 hours off in NYC/LA.
  // geo-tz maps any lat/lng to its IANA tz; defensive fallback to ET
  // for the rare unmapped point.
  let userTz = "America/New_York";
  try {
    userTz = findTz(lat, lng)[0] ?? "America/New_York";
  } catch {
    // Defensive: geo-tz reads its `.geo.dat` boundary files via fs.openSync at
    // call time. If the serverless bundle is missing them (the bug this branch
    // fixes via next.config) or the point is unmapped, fall back to ET instead
    // of throwing and 500-ing the entire feed render.
  }
  const stripSnapshot = computeZmanimStrip(
    { lat, lng, timezone: userTz },
    referenceDate,
  );
  const placeName = await reverseGeocode(lat, lng).catch(() => null);
  const addressLabel = sp.q?.trim() || placeName;
  // Travel-mode date for the picker UI (always rendered, defaults to today).
  const dateInputValue = sp.date && parseDateOnly(sp.date)
    ? sp.date
    : isoDateInTz(now, userTz);
  const todayIsoInUserTz = isoDateInTz(now, userTz);
  const isTravelMode = !!travelDate && dateInputValue !== todayIsoInUserTz;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-8">
      <FeedHeader
        placeName={placeName}
        lat={lat}
        lng={lng}
        radiusMiles={radiusMiles}
      />

      {/* Travel-mode date picker — GET form so each pick is a clean
          server-rendered navigation. Defaults to today; switching to a
          future or past date flips the feed into travel-planning shape
          (full-day window instead of "next 24h"). */}
      <form
        method="get"
        action="/"
        className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600"
      >
        <input type="hidden" name="lat" value={lat} />
        <input type="hidden" name="lng" value={lng} />
        {sp.radius && <input type="hidden" name="radius" value={sp.radius} />}
        {sp.via && <input type="hidden" name="via" value={sp.via} />}
        <label className="flex items-center gap-1.5">
          <span className="text-neutral-500">Date:</span>
          <input
            type="date"
            name="date"
            defaultValue={dateInputValue}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs focus-visible:border-neutral-500 focus-visible:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
        >
          Update
        </button>
        {isTravelMode && (
          <Link
            href={`/?lat=${lat}&lng=${lng}${sp.radius ? `&radius=${sp.radius}` : ""}`}
            className="text-xs text-neutral-500 underline-offset-2 hover:underline"
          >
            back to today
          </Link>
        )}
      </form>

      {/* Zmanim */}
      <ZmanimStrip snapshot={stripSnapshot} timezone={userTz} />

      {/* Minyanim feed */}
      <section className="mt-5">
        {shulGroups ? (
          shulGroups.length > 0 ? (
            <>
              <h2 className="mb-2 text-sm font-medium text-neutral-700">
                Shuls near you ({shulGroups.length}
                {byShulCount(resolved) > shulGroups.length &&
                  ` of ${byShulCount(resolved)}`}
                )
                <span className="ml-1 text-xs font-normal text-neutral-400">
                  within {radiusMiles} mi · nearest first
                </span>
              </h2>
              <MinyanListByShul groups={shulGroups} serverNowMs={now.getTime()} />
            </>
          ) : (
            <EmptyAddressSearch addressLabel={addressLabel} radiusMiles={radiusMiles} />
          )
        ) : (
          <>
            <h2 className="mb-2 text-sm font-medium text-neutral-700">
              Next minyanim ({trimmed.length}
              {resolved.length > trimmed.length && ` of ${resolved.length}`})
              <span className="ml-1 text-xs font-normal text-neutral-400">
                within {radiusMiles} mi
              </span>
            </h2>
            <MinyanList items={trimmed} serverNowMs={now.getTime()} />
          </>
        )}
      </section>

      <footer className="mt-10 text-center text-xs text-neutral-500">
        <Link href="/bot" className="underline-offset-2 hover:underline">
          About tfila.co
        </Link>
      </footer>
    </main>
  );
}

function byShulCount(rules: ResolvedMinyan[]): number {
  const seen = new Set<number>();
  for (const r of rules) seen.add(r.shulId);
  return seen.size;
}

function EmptyAddressSearch({
  addressLabel,
  radiusMiles,
}: {
  addressLabel: string | null;
  radiusMiles: number;
}) {
  const where = addressLabel ? ` of ${addressLabel}` : "";
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-700">
      <div className="font-medium text-neutral-900">
        No minyanim within {radiusMiles} mi{where}.
      </div>
      <p className="mt-2 text-neutral-600">
        Know a shul in this area? Help us list it — we&apos;ll keep its tfila
        times fresh from its own website or weekly bulletin.
      </p>
      <Link
        href="/submit"
        className="mt-3 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
      >
        Add a shul
      </Link>
    </div>
  );
}
