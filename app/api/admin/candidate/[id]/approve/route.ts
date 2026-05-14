// Approve a shul_candidate: create a real shul row (with Places-derived
// name + address + lat/lng pre-populated) and queue the extraction
// pipeline if there's a website. Idempotent — if the candidate is
// already approved/rejected/duplicate, no-ops.
//
// Two paths based on URL availability:
//   - WITH URL (Places returned websiteUri OR admin pasted one in the
//     form's `urlOverride` field): shul.status = 'pending_review',
//     fire data-source.requested for the extraction cascade.
//   - WITHOUT URL: shul.status = 'no_url', no extraction fired. The
//     row is excluded from all public queries — tfila.co only lists
//     live non-stale times. Admin recovers by pasting a URL into the
//     Source URL field on /admin/shul/[slug] later.
//
// On dedup-merge (candidate's URL domain matches existing shul), the
// existing shul is backfilled with Places address/location if those
// fields were null. Closes the "email/URL created first, candidate
// found second" gap from FEATURES.md unified-pipeline parity entry.

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { shul, shulCandidate } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { slugify } from "@/lib/slug";
import { inngest } from "@/lib/inngest/client";
import { matchDomainOf } from "@/lib/dedup";

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

  // Admin-pasted URL (when Places didn't return one). Optional.
  const form = await req.formData().catch(() => null);
  const rawOverride = (form?.get("urlOverride") as string | null)?.trim() || "";
  let urlOverride: string | null = null;
  if (rawOverride) {
    try {
      const u = new URL(
        /^https?:\/\//i.test(rawOverride) ? rawOverride : `https://${rawOverride}`,
      );
      if (u.protocol === "http:" || u.protocol === "https:") {
        urlOverride = u.toString();
      }
    } catch {
      // Invalid URL — treat as if no override was provided.
    }
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
      return {
        ok: false,
        reason: `already ${c.reviewStatus}`,
        shulId: c.linkedShulId ?? undefined,
      } as const;
    }

    // Effective URL: admin override wins, else Places-returned, else null.
    const effectiveUrl = urlOverride ?? c.websiteUri ?? null;

    // ─── Domain-match dedup: if this candidate's URL resolves to a
    // domain already attached to a shul, mark as duplicate AND backfill
    // address/location on the existing shul if it was missing.
    const matchDomain = effectiveUrl ? matchDomainOf(effectiveUrl) : null;
    if (matchDomain) {
      const existing = await tx
        .select({ id: shul.id, address: shul.address })
        .from(shul)
        .where(eq(shul.matchDomain, matchDomain))
        .limit(1);
      if (existing[0]) {
        // Backfill address / location on existing shul when missing.
        // Treat empty string as missing too (defensive).
        const needsAddress = !existing[0].address;
        if (needsAddress && c.formattedAddress) {
          await tx.execute(sql`
            UPDATE shul
               SET address = COALESCE(address, ${c.formattedAddress}),
                   updated_at = NOW()
             WHERE id = ${existing[0].id}
          `);
        }
        if (c.lat != null && c.lng != null) {
          await tx.execute(sql`
            UPDATE shul
               SET location = COALESCE(
                     location,
                     ST_SetSRID(ST_MakePoint(${c.lng}, ${c.lat}), 4326)::geography
                   ),
                   updated_at = NOW()
             WHERE id = ${existing[0].id}
          `);
        }
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
      (effectiveUrl ? slugify(new URL(effectiveUrl).hostname) : null) ||
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

    // ─── Create the shul row. Status depends on URL presence:
    //   - URL present:  pending_review (extraction will run, then admin
    //                   approves rules to flip to active)
    //   - URL absent:   no_url (will NOT publish; admin needs to add a
    //                   URL on /admin/shul/[slug] to escalate)
    const newStatus = effectiveUrl ? "pending_review" : "no_url";
    const [newShul] = await tx
      .insert(shul)
      .values({
        slug: candidateSlug,
        name: c.name,
        address: c.formattedAddress,
        submittedUrl: effectiveUrl,
        matchDomain,
        status: newStatus,
      })
      .returning({ id: shul.id, slug: shul.slug });

    if (c.lat != null && c.lng != null) {
      await tx.execute(sql`
        UPDATE shul
           SET location = ST_SetSRID(ST_MakePoint(${c.lng}, ${c.lat}), 4326)::geography,
               updated_at = NOW()
         WHERE id = ${newShul.id}
      `);
    }

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
      url: effectiveUrl,
    } as const;
  });

  // Fire extraction AFTER transaction commits, only when we have a URL
  if (result.ok && !result.dedup && result.url) {
    try {
      await inngest.send({
        name: "data-source.requested",
        data: {
          shulId: result.shulId!,
          url: result.url,
          sourceKind: "website_llm",
        },
      });
    } catch (err) {
      console.error("[candidate/approve] inngest.send failed:", (err as Error).message);
    }
  }

  // Redirect strategy:
  //   - approve-with-URL: send admin to the shul page to watch extraction
  //     land (better workflow than bouncing back to candidates list).
  //   - dedup-merge or no_url: back to candidates (referer preserves filter).
  if (result.ok && !result.dedup && result.url && result.slug) {
    return NextResponse.redirect(
      new URL(`/admin/shul/${result.slug}?from=candidate`, req.url),
      303,
    );
  }
  const back = req.headers.get("referer") ?? "/admin/candidates";
  return NextResponse.redirect(new URL(back, req.url), 303);
}
