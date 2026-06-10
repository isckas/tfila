// Approve a shul_candidate: create a real shul row (with Places-derived
// name + address + lat/lng pre-populated) and queue the extraction
// pipeline. Requires a URL — either Places-returned (websiteUri) or
// admin-pasted (urlOverride form field). Without a URL, returns 400.
//
// Product rule: tfila.co only publishes shuls with live extracted
// times. Approving a no-URL candidate would create a tracking row
// that could never publish, which is worse than no row at all.
// Reject the candidate, or use Google to find the shul's website and
// paste it into the urlOverride field before approving.
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
import { slugify, allocateUniqueSlug } from "@/lib/slug";
import { inngest } from "@/lib/inngest/client";
import { matchDomainOf } from "@/lib/dedup";
import { resolveScheduleUrl } from "@/lib/discovery/find-schedule-page";
import { safeRedirect } from "@/lib/safe-redirect";

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

  // ─── Pre-fetch the candidate so we can validate + resolve the URL
  // outside the DB transaction (schedule-page discovery does network
  // I/O and can take several seconds — don't hold a DB lock that long).
  const preRows = await db
    .select({
      websiteUri: shulCandidate.websiteUri,
      reviewStatus: shulCandidate.reviewStatus,
      linkedShulId: shulCandidate.linkedShulId,
    })
    .from(shulCandidate)
    .where(eq(shulCandidate.id, candidateId))
    .limit(1);
  if (!preRows[0]) {
    return NextResponse.redirect(
      new URL("/admin/candidates?err=candidate+not+found", req.url),
      303,
    );
  }
  if (preRows[0].reviewStatus !== "pending") {
    return safeRedirect(req, "/admin/candidates", {
      err: `candidate already ${preRows[0].reviewStatus}`,
    });
  }

  const submittedUrl = urlOverride ?? preRows[0].websiteUri ?? null;
  if (!submittedUrl) {
    return safeRedirect(req, "/admin/candidates", {
      err: "URL required — paste one in the Add URL & approve form, or reject this candidate",
    });
  }

  // ─── Resolve to the schedule page. For root-only URLs (Places usually
  // returns these), the hybrid resolver tries common paths, scans the
  // root page's nav for schedule keywords, and falls back to an LLM
  // pick. Admin-pasted URLs with a specific path short-circuit and
  // pass through unchanged. Worst case: we get the root URL back and
  // the extraction cascade's own same-origin fallback takes a shot.
  const resolved = await resolveScheduleUrl(submittedUrl);
  const effectiveUrl = resolved.url;

  const result = await db.transaction(async (tx) => {
    // Re-fetch inside the tx so we lock + see the latest state. Catch
    // the rare case of two admins approving the same candidate in
    // parallel.
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
    const candidateSlug = await allocateUniqueSlug(tx, baseSlug);

    // ─── Create the shul row. URL is guaranteed present (early return
    // above if not), so status = pending_review and extraction will
    // run via the data-source.requested event fired after commit.
    const [newShul] = await tx
      .insert(shul)
      .values({
        slug: candidateSlug,
        name: c.name,
        address: c.formattedAddress,
        submittedUrl: effectiveUrl,
        matchDomain,
        status: "pending_review",
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
  //   - dedup-merge: back to candidates so admin can keep triaging.
  //   - error (e.g. URL required): back to candidates with an err param
  //     so the page can surface a banner.
  if (result.ok && !result.dedup && result.url && result.slug) {
    return NextResponse.redirect(
      new URL(`/admin/shul/${result.slug}?from=candidate`, req.url),
      303,
    );
  }
  // dedup-merge / error: return via the same-origin Referer (inbox Discovery or
  // candidates page), falling back to /admin/candidates. safeRedirect's
  // same-origin guard avoids trusting a bare attacker-influenced Referer.
  if (!result.ok && result.reason) {
    return safeRedirect(req, "/admin/candidates", { err: result.reason });
  }
  return safeRedirect(req, "/admin/candidates");
}
