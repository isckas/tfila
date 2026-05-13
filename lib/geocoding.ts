// Google Geocoding API client. One-time per-shul use during onboarding;
// never called per-request from the davener-facing path.

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  placeId: string;
}

export class GeocodeError extends Error {
  constructor(
    message: string,
    public readonly status: string,
  ) {
    super(message);
  }
}

const ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

export async function geocode(address: string): Promise<GeocodeResult | null> {
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) {
    throw new GeocodeError(
      "GOOGLE_GEOCODING_API_KEY is not set in env. Skipping geocoding.",
      "MISSING_API_KEY",
    );
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("address", address);
  url.searchParams.set("key", key);

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new GeocodeError(
      `Geocoding HTTP ${res.status}: ${res.statusText}`,
      `HTTP_${res.status}`,
    );
  }

  const json = (await res.json()) as {
    status: string;
    results?: Array<{
      geometry: { location: { lat: number; lng: number } };
      formatted_address: string;
      place_id: string;
    }>;
    error_message?: string;
  };

  if (json.status === "ZERO_RESULTS") return null;

  if (json.status !== "OK") {
    throw new GeocodeError(
      `Geocoding error: ${json.status}${json.error_message ? " — " + json.error_message : ""}`,
      json.status,
    );
  }

  const top = json.results?.[0];
  if (!top) return null;

  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    formattedAddress: top.formatted_address,
    placeId: top.place_id,
  };
}

interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

/**
 * Reverse-geocode lat/lng → short readable place name like
 * "Crown Heights, NY" or "Toronto, ON". Returns null if no
 * usable name (or if env key is missing — caller falls back to
 * displaying coords).
 *
 * Picks the most specific human-locality component (neighborhood
 * → sublocality → locality) plus an admin code (state/province).
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return null;

  const url = new URL(ENDPOINT);
  url.searchParams.set("latlng", `${lat},${lng}`);
  url.searchParams.set("key", key);
  // Restrict to result types that yield human place names.
  url.searchParams.set(
    "result_type",
    "neighborhood|sublocality|locality|postal_town|administrative_area_level_1",
  );

  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json()) as {
    status: string;
    results?: Array<{ address_components: AddressComponent[] }>;
  };
  if (json.status !== "OK" || !json.results?.length) return null;

  // Walk all results' components and pick the best locality + state.
  const localityPreference = [
    "neighborhood",
    "sublocality",
    "sublocality_level_1",
    "locality",
    "postal_town",
  ];
  let locality: string | null = null;
  let adminCode: string | null = null;

  for (const r of json.results) {
    for (const c of r.address_components) {
      if (
        !locality &&
        c.types.some((t) => localityPreference.includes(t))
      ) {
        locality = c.long_name;
      }
      if (
        !adminCode &&
        c.types.includes("administrative_area_level_1")
      ) {
        adminCode = c.short_name;
      }
    }
    if (locality && adminCode) break;
  }

  if (!locality && !adminCode) return null;
  if (locality && adminCode) return `${locality}, ${adminCode}`;
  return locality ?? adminCode;
}

// ─── Places search fallback ──────────────────────────────────────────────
//
// When LLM extraction fails to surface a shul's address, fall back to
// searching Google Places for the shul by name + URL hostname hint.
// Confidence is computed from name similarity + place type. The caller
// applies the result only when confidence ≥ 0.7.
//
// Uses the same GOOGLE_GEOCODING_API_KEY env var — but requires the
// Places API (v1 "Text Search") enabled on the same Google Cloud
// project as the Geocoding API. If only Geocoding is enabled, calls
// return 403 and we no-op.

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

export interface PlaceMatch {
  name: string;
  address: string;
  lat: number;
  lng: number;
  placeId: string;
  types: string[];
  confidence: number;
}

/**
 * Search Google Places for a shul by name. Returns the highest-scoring
 * candidate, or null. Hint extracted from the submitted URL when
 * provided (e.g. URL host → "agudahsouth" → adds " toronto" if address
 * fragments suggest it, though for now we just rely on Places' own
 * disambiguation).
 */
export async function findShulPlace(
  name: string,
  opts: { urlHint?: string } = {},
): Promise<PlaceMatch | null> {
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return null;
  if (!name || name.trim().length < 2) return null;

  // Strip placeholder hostnames the LLM stage might have left as name
  // (e.g. "theshul.org") — Places search those literally and gives bad results.
  if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(name.trim())) return null;

  const query = `${name.trim()} synagogue`;
  const body = {
    textQuery: query,
    includedType: "synagogue",
    // Bias slightly higher result quality; we'll only keep top 1.
    maxResultCount: 5,
  };

  let res: Response;
  try {
    res = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.types",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json()) as {
    places?: Array<{
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
      types?: string[];
    }>;
  };
  const places = json.places ?? [];
  if (places.length === 0) return null;

  // Score each candidate
  const needleTokens = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  let best: PlaceMatch | null = null;
  for (const p of places) {
    if (
      !p.id ||
      !p.formattedAddress ||
      !p.location ||
      !p.displayName?.text
    ) {
      continue;
    }
    const hay = p.displayName.text.toLowerCase();
    let nameScore = 0;
    for (const t of needleTokens) {
      if (hay.includes(t)) nameScore += 1;
    }
    const nameSim =
      needleTokens.length > 0 ? nameScore / needleTokens.length : 0;

    // Type scoring
    const types = p.types ?? [];
    let typeBoost = 0;
    if (types.includes("synagogue")) typeBoost = 0.4;
    else if (types.includes("place_of_worship")) typeBoost = 0.25;
    else if (types.includes("religious_organization")) typeBoost = 0.15;

    // Final confidence: weighted blend
    const confidence = Math.min(1, nameSim * 0.7 + typeBoost);

    if (!best || confidence > best.confidence) {
      best = {
        name: p.displayName.text,
        address: p.formattedAddress,
        lat: p.location.latitude,
        lng: p.location.longitude,
        placeId: p.id,
        types,
        confidence,
      };
    }
  }
  // Mark urlHint as touched so we don't get unused-warning even when
  // we don't yet use it (kept in signature for future refinement).
  void opts.urlHint;
  return best;
}
