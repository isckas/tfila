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
