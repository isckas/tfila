// Approve a shul_candidate: create a real shul row (with Places-derived
// name + address + lat/lng pre-populated) and queue the extraction
// pipeline if the candidate has a website. Idempotent: if the candidate
// is already approved/linked, no-ops.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shul, shulCandidate, dataSource } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { slugify, nameFromTitle } from "@/lib/slug";
import { inngest } from "@/lib/inngest/client";
import { matchDomainOf } from "@/lib/dedup";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const candidateId = Number(id);
  if (!Number.isInteger(candidateId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(shulCandidate)
      .where(eq(shulCandidate.id, candidateId))
      .limit(1);
    const c = rows[0];
    if (!c) return { ok: false, reason: "not found" } as const;
    if (c.reviewStatus !== "pending") {
      return { ok: false, reason: `already ${c.reviewStatus}`, shulId: c.linkedShulId } as const;
    }

    // ─── Domain-match dedup: if this candidate's website resolves to a
    // domain already attached to a shul, mark as duplicate instead of
    // creating a new shul.
    const matchDomain = c.websiteUri ? matchDomainOf(c.websiteUri) : null;
    if (matchDomain) {
      const existing = await tx
        .select({ id: shul.id })
        .from(shul)
        .where(eq(shul.matchDomain, matchDomain))
        .limit(1);
      if (existing[0]) {
        await tx
          .update(shulCandidate)
          .set({
            reviewStatus: "duplicate",
            reviewReason: `Domain ${matchDomain} already attached to shul ${existing[0].id}`,
            linkedShulId: existing[0].id,
            reviewedAt: new Date(),
            reviewedBy: session.email,
            updatedAt: new Date(),
          })
          .where(eq(shulCandidate.id, candidateId));
        return { ok: true, dedup: true, shulId: existing[0].id } as const;
      }
    }

    // ─── Allocate a unique slug from the candidate name
    const baseSlug =
      slugify(c.name) ||
      (c.websiteUri ? slugify(new URL(c.websiteUri).hostname) : null) ||
      `candidate-${candidateId}`;
    let candidateSlug = baseSlug;
    for (let n = 2; n < 100; n++) {
      const collision = await tx
        .select({ id: shul.id })
        .from(shul)
        .where(eq(shul.slug, candidateSlug))
        .limit(1);
      if (!collision[0]) break;
      candidateSlug = `${baseSlug}-${n}`;
    }

    // ─── Create the shul row with everything we know already
    const [newShul] = await tx
      .insert(shul)
      .values({
        slug: candidateSlug,
        name: c.name,
        address: c.formattedAddress,
        submittedUrl: c.websiteUri,
        matchDomain,
        status: "pending_review",
      })
      .returning({ id: shul.id, slug: shul.slug });

    // Project lat/lng onto PostGIS GEOGRAPHY when we have it
    if (c.lat != null && c.lng != null) {
      await tx.execute(sql`
        UPDATE shul
           SET location = ST_SetSRID(ST_MakePoint(${c.lng}, ${c.lat}), 4326)::geography,
               updated_at = NOW()
         WHERE id = ${newShul.id}
      `);
    }

    // ─── Link the candidate to the new shul, mark approved
    await tx
      .update(shulCandidate)
      .set({
        reviewStatus: "approved",
        linkedShulId: newShul.id,
        reviewedAt: new Date(),
        reviewedBy: session.email,
        updatedAt: new Date(),
      })
      .where(eq(shulCandidate.id, candidateId));

    return {
      ok: true,
      dedup: false,
      shulId: newShul.id,
      slug: newShul.slug,
      hasWebsite: !!c.websiteUri,
      websiteUri: c.websiteUri,
    } as const;
  });

  // ─── Fire extraction event AFTER transaction commits (so the function
  // can see the new shul row in its own connection)
  if (result.ok && !result.dedup && result.hasWebsite && result.websiteUri) {
    try {
      await inngest.send({
        name: "data-source.requested",
        data: {
          shulId: result.shulId!,
          url: result.websiteUri,
          sourceKind: "website_llm",
        },
      });
    } catch (err) {
      console.error("[candidate/approve] inngest.send failed:", (err as Error).message);
    }
  }

  // Redirect back to the candidates page, preserving filter context via
  // referer when available
  const back = req.headers.get("referer") ?? "/admin/candidates";
  return NextResponse.redirect(new URL(back, req.url), 303);
}
