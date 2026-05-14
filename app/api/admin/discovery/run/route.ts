// Admin-triggered discovery run: hits Google Places Text Search v1 for
// one target (or "all"), inserts candidates into shul_candidate, logs
// each call into discovery_run. Reads GOOGLE_GEOCODING_API_KEY from
// the in-process Vercel env — never exposes the key over the network.
//
// POST /api/admin/discovery/run
//   form fields:
//     target  - name from data/discovery-targets.json, or "all"
//
// Redirects back to /admin/candidates with a result summary in
// query params (?ran=<name>&new=<n>&dup=<n>&queries=<n>&errors=<n>).

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { discoveryRun, shulCandidate } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
// Import the targets JSON directly so Next.js bundles it into the
// function output (resolveJsonModule=true in tsconfig). No runtime
// fs.readFileSync needed; the data ships with the deploy.
import targetsJson from "@/data/discovery-targets.json";

export const dynamic = "force-dynamic";
// Places + DB writes for one target can take ~5-15s. Allow plenty of
// headroom; Fluid Compute default is 300s anyway.
export const maxDuration = 120;

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

interface Target {
  name: string;
  region: string;
  tier: number;
  lat: number;
  lng: number;
  radius_m: number;
  queries: string[];
}

const TARGETS: Target[] = (targetsJson as { targets: Target[] }).targets;

interface PlacesPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  websiteUri?: string;
}

async function placesSearch(
  query: string,
  lat: number,
  lng: number,
  radius: number,
  apiKey: string,
): Promise<PlacesPlace[]> {
  const body = {
    textQuery: query,
    maxResultCount: 20,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius,
      },
    },
  };
  const res = await fetch(PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.websiteUri",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Places ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { places?: PlacesPlace[] };
  return json.places ?? [];
}

async function runOneTarget(target: Target, apiKey: string) {
  let totals = { new: 0, dup: 0, queries: 0, errors: 0 };

  for (const queryText of target.queries) {
    // Open audit row
    const [runRow] = await db
      .insert(discoveryRun)
      .values({
        targetName: target.name,
        queryText,
        centerLat: target.lat,
        centerLng: target.lng,
        radiusM: target.radius_m,
      })
      .returning({ id: discoveryRun.id });
    totals.queries++;

    try {
      const places = await placesSearch(
        queryText,
        target.lat,
        target.lng,
        target.radius_m,
        apiKey,
      );

      let newCount = 0;
      let dupCount = 0;
      for (const p of places) {
        if (!p.id) continue;
        // Use Drizzle's typed insert builder so the text[] (types)
        // column is serialized as a proper Postgres ARRAY, not a tuple
        // expression. Returning gives us a row when the insert happened,
        // empty array when ON CONFLICT skipped it.
        const ins = await db
          .insert(shulCandidate)
          .values({
            placeId: p.id,
            name: p.displayName?.text ?? "(unknown)",
            formattedAddress: p.formattedAddress ?? null,
            lat: p.location?.latitude ?? null,
            lng: p.location?.longitude ?? null,
            websiteUri: p.websiteUri ?? null,
            types: p.types ?? [],
            source: "google_places",
            sourceDetail: `query=${queryText}`,
            discoveryTargetName: target.name,
            rawResponseJsonb: p,
          })
          .onConflictDoNothing({ target: shulCandidate.placeId })
          .returning({ id: shulCandidate.id });
        if (ins.length > 0) newCount++;
        else dupCount++;
      }

      await db.execute(sql`
        UPDATE discovery_run
           SET finished_at = NOW(),
               result_count = ${places.length},
               candidates_new = ${newCount},
               candidates_dup = ${dupCount}
         WHERE id = ${runRow.id}
      `);
      totals.new += newCount;
      totals.dup += dupCount;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.execute(sql`
        UPDATE discovery_run
           SET finished_at = NOW(), error = ${msg.slice(0, 1000)}
         WHERE id = ${runRow.id}
      `);
      totals.errors++;
      console.error(`[discovery] target=${target.name} query=${queryText} failed:`, msg);
    }
  }

  return totals;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "no API key in env (GOOGLE_PLACES_API_KEY / GOOGLE_GEOCODING_API_KEY)" },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const targetName = (form.get("target") as string | null)?.trim();
  if (!targetName) {
    return NextResponse.json({ error: "missing target" }, { status: 400 });
  }

  const selected =
    targetName === "all"
      ? TARGETS
      : TARGETS.filter((t) => t.name === targetName);
  if (selected.length === 0) {
    return NextResponse.json(
      { error: `no target matched "${targetName}"` },
      { status: 400 },
    );
  }

  const aggregate = { new: 0, dup: 0, queries: 0, errors: 0 };
  for (const t of selected) {
    const r = await runOneTarget(t, apiKey);
    aggregate.new += r.new;
    aggregate.dup += r.dup;
    aggregate.queries += r.queries;
    aggregate.errors += r.errors;
  }

  const qs = new URLSearchParams({
    ran: targetName,
    new: String(aggregate.new),
    dup: String(aggregate.dup),
    queries: String(aggregate.queries),
    errors: String(aggregate.errors),
  });
  return NextResponse.redirect(
    new URL(`/admin/candidates?${qs.toString()}`, req.url),
    303,
  );
}
