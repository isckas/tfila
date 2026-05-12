import { NextResponse } from "next/server";
import { geocode } from "@/lib/geocoding";

// GET /api/search?q=<address-or-place>
//   → 303 to /?lat=X&lng=Y on success
//   → 303 to /?err=geocode-failed on no-result or API error
//   → 303 to / on empty input

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.redirect(new URL("/", req.url), 303);
  }
  try {
    const r = await geocode(q);
    if (!r) {
      return NextResponse.redirect(
        new URL(`/?err=no-results&q=${encodeURIComponent(q)}`, req.url),
        303,
      );
    }
    return NextResponse.redirect(
      new URL(`/?lat=${r.lat}&lng=${r.lng}`, req.url),
      303,
    );
  } catch {
    return NextResponse.redirect(
      new URL(`/?err=geocode-failed&q=${encodeURIComponent(q)}`, req.url),
      303,
    );
  }
}
