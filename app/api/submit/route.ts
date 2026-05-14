import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shul, dataSource } from "@/db/schema";
import { slugify, nameFromTitle } from "@/lib/slug";
import { inngest } from "@/lib/inngest/client";
import { notifyAdmin } from "@/lib/email";
import { matchDomainOf } from "@/lib/dedup";
import { resolveScheduleUrl } from "@/lib/discovery/find-schedule-page";

// Submissions are processed ASYNC. We validate + dedupe + create a
// placeholder shul row + fire an Inngest event in <1s, then return
// success. The Inngest `data-source.requested` function does the LLM
// extraction + persistence in the background, with automatic retries
// if Anthropic is briefly unavailable.
//
// Dedup (FEATURES.md Option A): we look up by registrable domain
// across all submission channels. If a shul with the same match_domain
// already exists, we attach this new URL as an additional `data_source`
// under that shul instead of creating a duplicate shul row. Admin can
// click "Split into separate shul" if the merge was wrong (shared-
// hosting edge case).

export const dynamic = "force-dynamic";

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

  // ─── Resolve to schedule page when only a root URL was submitted ─
  // If the user pasted "jewishwindsorterrace.org" we'd otherwise miss
  // the actual /Times-and-Schedule.htm. Resolver short-circuits when
  // the input already has a meaningful path. See lib/discovery/
  // find-schedule-page.ts for the hybrid strategy.
  const resolved = await resolveScheduleUrl(url);
  const resolvedUrl = resolved.url;

  const matchDomain = matchDomainOf(resolvedUrl);

  // ─── Exact-match dedup ──────────────────────────────────────
  // If the same submittedUrl is already on a shul, don't add it again.
  // Check against the RESOLVED URL — that's what we'd be writing.
  const exact = await db
    .select({ id: shul.id, slug: shul.slug })
    .from(shul)
    .where(eq(shul.submittedUrl, resolvedUrl))
    .limit(1);
  if (exact[0]) {
    return fail(req, "duplicate");
  }

  // ─── Domain-match dedup ─────────────────────────────────────
  // Same registrable domain as an existing shul → attach as new
  // data_source under that shul. e.g. www.theshul.org/calendar
  // submitted after theshul.org/ already exists.
  let attachedShulId: number | null = null;
  let attachedShulSlug: string | null = null;
  if (matchDomain) {
    const sameDomain = await db
      .select({ id: shul.id, slug: shul.slug })
      .from(shul)
      .where(eq(shul.matchDomain, matchDomain))
      .limit(1);
    if (sameDomain[0]) {
      // Already have this exact identifier under that shul?
      const dsExists = await db
        .select({ id: dataSource.id })
        .from(dataSource)
        .where(
          and(
            eq(dataSource.shulId, sameDomain[0].id),
            eq(dataSource.identifier, resolvedUrl),
          ),
        )
        .limit(1);
      if (dsExists[0]) {
        return fail(req, "duplicate");
      }
      attachedShulId = sameDomain[0].id;
      attachedShulSlug = sameDomain[0].slug;
    }
  }

  // ─── Branch: attach to existing shul vs create new ──────────
  let finalShulId: number;
  let finalShulSlug: string;
  let placeholderName: string;

  if (attachedShulId && attachedShulSlug) {
    finalShulId = attachedShulId;
    finalShulSlug = attachedShulSlug;
    placeholderName = "(merged into existing shul)";
  } else {
    // Create a brand new shul row.
    placeholderName =
      nameFromTitle(parsed.hostname.replace(/^www\./, "")) ??
      parsed.hostname.replace(/^www\./, "");
    const baseSlug =
      slugify(placeholderName) || slugify(parsed.hostname) || "shul";
    let candidateSlug = baseSlug;
    for (let n = 2; n < 100; n++) {
      const collision = await db
        .select({ id: shul.id })
        .from(shul)
        .where(eq(shul.slug, candidateSlug))
        .limit(1);
      if (!collision[0]) break;
      candidateSlug = `${baseSlug}-${n}`;
    }

    const [newShul] = await db
      .insert(shul)
      .values({
        slug: candidateSlug,
        name: placeholderName,
        submittedUrl: resolvedUrl,
        contactEmail: email,
        matchDomain,
        status: "pending_review",
      })
      .returning({ id: shul.id, slug: shul.slug });
    finalShulId = newShul.id;
    finalShulSlug = newShul.slug;
  }

  // ─── Fire async extraction event ────────────────────────────
  // The Inngest data-source.requested handler picks this up, runs the
  // cascade, and creates the data_source row. For the auto-merge case
  // this means a new data_source gets attached to the existing shul.
  try {
    await inngest.send({
      name: "data-source.requested",
      data: {
        shulId: finalShulId,
        url: resolvedUrl,
        sourceKind: "website_llm",
      },
    });
  } catch (err) {
    console.error("[submit] inngest.send failed:", (err as Error).message);
  }

  // ─── Notify admin (best effort) ─────────────────────────────
  const origin =
    req.headers.get("origin") ?? process.env.AUTH_URL ?? new URL(req.url).origin;
  await notifyAdmin({
    subject: attachedShulId
      ? `auto-merged submission: ${placeholderName} (shul ${finalShulId})`
      : `new shul submission: ${placeholderName}`,
    text: [
      attachedShulId
        ? `A submission was auto-merged into existing shul ${finalShulId} (${finalShulSlug}) because it shared the same registrable domain.`
        : `A new shul was just submitted to tfila.co.`,
      ``,
      `Submitted URL: ${url}`,
      resolvedUrl !== url
        ? `Resolved schedule URL: ${resolvedUrl} (via ${resolved.via}, confidence ${resolved.confidence})`
        : `Resolved schedule URL: same as submitted`,
      `match_domain: ${matchDomain ?? "(none)"}`,
      `Contact email (from form): ${email ?? "(none)"}`,
      `Slug: ${finalShulSlug}`,
      ``,
      attachedShulId
        ? `If the merge was wrong (different shuls sharing hosting), click "Split into separate shul" on the new data_source row in /admin/shul/${finalShulSlug}.`
        : `Review the extracted rules here once the LLM finishes (~30s):`,
      `${origin}/admin/shul/${finalShulSlug}`,
    ].join("\n"),
  });

  return NextResponse.redirect(
    new URL(`/submit?ok=1&slug=${encodeURIComponent(finalShulSlug)}`, req.url),
    303,
  );
}
