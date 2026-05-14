import { NextResponse } from "next/server";
import { geocode } from "@/lib/geocoding";
import { searchActiveShuls } from "@/lib/queries";

// GET /api/search?q=...
//
// Unified search across two backends:
//   1. Shul name match (ILIKE) — if any active shuls match, send the
//      user to /find?q=... where they can pick.
//   2. Otherwise fall through to Google Geocoding — if that resolves,
//      send the user to /?lat=X&lng=Y so the location feed renders.
//   3. If neither produces results, /find?q=... shows the "no matches"
//      empty state.

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.redirect(new URL("/", req.url), 303);
  }

  // ─── 1. Shul-name lookup first ──────────────────────────────
  // Cheap (a single ILIKE query). If anything matches, prefer that
  // over location geocoding — users searching by name don't want to
  // be teleported to a city.
  let shulMatches: Awaited<ReturnType<typeof searchActiveShuls>> = [];
  try {
    shulMatches = await searchActiveShuls(q, 50);
  } catch {
    // Non-fatal — fall through to geocode.
    shulMatches = [];
  }

  if (shulMatches.length > 0) {
    return NextResponse.redirect(
      new URL(`/find?q=${encodeURIComponent(q)}`, req.url),
      303,
    );
  }

  // ─── 2. Location geocode fallback ───────────────────────────
  // ?via=address marks this as a typed-address search (vs the
  // browser-geolocation path that hits /?lat=&lng= directly). The
  // home page widens the default radius to 25 mi and sorts by
  // distance instead of time. See FEATURES.md "Home-page address
  // search" for the design.
  try {
    const r = await geocode(q);
    if (r) {
      return NextResponse.redirect(
        new URL(
          `/?lat=${r.lat}&lng=${r.lng}&via=address&q=${encodeURIComponent(q)}`,
          req.url,
        ),
        303,
      );
    }
  } catch {
    // Non-fatal — fall through to no-results.
  }

  // ─── 3. Neither matched ─────────────────────────────────────
  // Route to /find which shows the "no matches" empty state and
  // offers re-entry.
  return NextResponse.redirect(
    new URL(`/find?q=${encodeURIComponent(q)}&miss=1`, req.url),
    303,
  );
}
