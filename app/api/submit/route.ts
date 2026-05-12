import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource, minyanRule, shul, type MinyanTime } from "@/db/schema";
import { fetchHtml } from "@/lib/scrapers/fetch";
import { extractFromHtml } from "@/lib/llm/extract";
import { extractAddressFromHtml } from "@/lib/llm/extract-address";
import { geocode } from "@/lib/geocoding";
import { slugify, nameFromTitle } from "@/lib/slug";
import { find as findTz } from "geo-tz";

// Submissions are processed inline (synchronously) for now — Inngest
// is wired but we may not have signing keys in prod yet. The full
// extraction pass takes ~10-30 seconds; that's acceptable UX for a
// one-time form submission with a "we're processing" page.

export const dynamic = "force-dynamic";
export const maxDuration = 60; // give the LLM enough time

function fail(req: Request, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/submit?err=${code}`, req.url), 303);
}

export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const url = (form.get("url") as string | null)?.trim() ?? "";
  const email = (form.get("email") as string | null)?.trim() || null;

  // ─── Validate URL ────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return fail(req, "invalid");
    }
  } catch {
    return fail(req, "invalid");
  }

  // ─── Dedupe ─────────────────────────────────────────────────
  const existing = await db
    .select({ id: shul.id })
    .from(shul)
    .where(eq(shul.submittedUrl, url))
    .limit(1);
  if (existing[0]) {
    return fail(req, "duplicate");
  }

  // ─── Fetch ───────────────────────────────────────────────────
  let html: string;
  try {
    const fetched = await fetchHtml(url, { timeoutMs: 20_000 });
    if (!fetched.ok || !fetched.html) {
      return fail(req, "extract");
    }
    html = fetched.html;
  } catch {
    return fail(req, "extract");
  }

  // ─── Extract minyan rules + (best-effort) address ──────────
  let scheduleExtraction;
  try {
    scheduleExtraction = await extractFromHtml(html);
  } catch (err) {
    // Distinguish "service is down" (Anthropic API errors) from "we
    // couldn't read this particular page". The former gets retried
    // automatically once the user tops up credits; the latter needs
    // a human (or a different URL).
    const msg = (err as Error)?.message ?? "";
    if (
      msg.includes("credit balance") ||
      msg.includes("rate_limit") ||
      msg.includes("overloaded") ||
      msg.includes("invalid_request_error")
    ) {
      return fail(req, "service-unavailable");
    }
    return fail(req, "extract");
  }
  if (
    scheduleExtraction.extraction.rules.length === 0 ||
    scheduleExtraction.extraction.confidence < 0.4
  ) {
    return fail(req, "extract");
  }

  // Address: prefer what the schedule extractor found; otherwise try
  // the dedicated address extractor on the same page.
  let address: string | null = scheduleExtraction.extraction.shulAddress ?? null;
  if (!address) {
    try {
      const addrExtract = await extractAddressFromHtml(html);
      if (addrExtract.extraction.address && addrExtract.extraction.confidence >= 0.55) {
        address = addrExtract.extraction.address;
      }
    } catch {
      // non-fatal: a shul can land in the queue without an address
    }
  }

  // Geocode if we have an address
  let lat: number | null = null;
  let lng: number | null = null;
  if (address && process.env.GOOGLE_GEOCODING_API_KEY) {
    try {
      const g = await geocode(address);
      if (g) {
        lat = g.lat;
        lng = g.lng;
      }
    } catch {
      // non-fatal
    }
  }

  // ─── Persist ────────────────────────────────────────────────
  const name =
    scheduleExtraction.extraction.shulName ??
    nameFromTitle(parsed.hostname) ??
    parsed.hostname;
  let slug = slugify(name);
  if (!slug) slug = slugify(parsed.hostname);

  // Ensure slug uniqueness — append counter on collision
  for (let n = 2; n < 100; n++) {
    const collision = await db
      .select({ id: shul.id })
      .from(shul)
      .where(eq(shul.slug, slug))
      .limit(1);
    if (!collision[0]) break;
    slug = `${slugify(name)}-${n}`;
  }

  const tz = lat != null && lng != null ? findTz(lat, lng)[0] ?? null : null;

  const result = await db.transaction(async (tx) => {
    // Build location SQL fragment only if we have coords
    const locationSql =
      lat != null && lng != null
        ? sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`
        : sql`NULL`;

    const [newShul] = await tx
      .insert(shul)
      .values({
        slug,
        name,
        address,
        location: locationSql as unknown as string,
        timezone: tz,
        submittedUrl: url,
        contactEmail: email,
        status: "pending_review",
      })
      .returning({ id: shul.id });

    const [newSource] = await tx
      .insert(dataSource)
      .values({
        shulId: newShul.id,
        kind: "website_llm",
        identifier: url,
        configJson: {
          version: 1,
          page_url: url,
          page_content_hash: scheduleExtraction.pageContentHash,
          model: scheduleExtraction.model,
          prompt_version: "tfila-v1",
          extracted_at: new Date().toISOString(),
          reasoning: scheduleExtraction.extraction.reasoning,
          usage: scheduleExtraction.usage,
        },
        confidenceScore: scheduleExtraction.extraction.confidence,
        priority: 40,
        builtAt: new Date(),
        builtBy: "llm",
        lastRunAt: new Date(),
        lastRunStatus: "ok",
        reviewStatus: "pending",
      })
      .returning({ id: dataSource.id });

    for (const r of scheduleExtraction.extraction.rules) {
      const time: MinyanTime =
        r.time.kind === "fixed"
          ? { kind: "fixed", clock: r.time.clock }
          : { kind: "zmanim", anchor: r.time.anchor, offsetMin: r.time.offsetMin };
      await tx.insert(minyanRule).values({
        shulId: newShul.id,
        dataSourceId: newSource.id,
        tefillah: r.tefillah,
        tefillahLabel: r.tefillahLabel ?? null,
        daysOfWeek: r.daysOfWeek ?? null,
        time: time as unknown as object,
        validFrom: r.validFrom ?? null,
        validTo: r.validTo ?? null,
        specialScheduleKind: r.specialScheduleKind,
        priority: 0,
        nusach: r.nusach ?? null,
        notes: r.notes ?? null,
        lastSeenInScrapeAt: new Date(),
      });
    }

    return { shulId: newShul.id, dataSourceId: newSource.id };
  });

  // void unused result var (used implicitly to ensure all writes committed)
  void result;

  return NextResponse.redirect(new URL("/submit?ok=1", req.url), 303);
}
