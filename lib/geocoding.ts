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
