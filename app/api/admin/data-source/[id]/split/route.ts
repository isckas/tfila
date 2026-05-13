// POST /api/admin/data-source/[id]/split
//
// Splits a data_source out of its current shul into a new standalone
// shul. Used to undo a wrong dedup auto-merge — e.g. two shuls were
// merged because they share a hosting domain (chabad.org) but are
// actually separate physical shuls.
//
// What it does:
//   1. Load the data_source + its rules
//   2. Build a new slug from the data_source's identifier
//   3. Create a new shul row (status=pending_review)
//   4. Re-parent the data_source + all its minyan_rule rows to the
//      new shul
//   5. If the original shul now has zero data_sources, leave it as-is
//      (admin can archive manually) — we DON'T delete it because
//      shul rows are referenced from the URL slug and we want
//      bookmarks to keep resolving.
//
// Auth: admin only.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource, minyanRule, shul } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { slugify } from "@/lib/slug";
import { matchDomainOf } from "@/lib/dedup";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const dsId = Number(id);
  if (!Number.isInteger(dsId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // Load the data_source + the originating shul's slug.
  const rows = await db
    .select({
      dsId: dataSource.id,
      kind: dataSource.kind,
      identifier: dataSource.identifier,
      originalShulId: dataSource.shulId,
      originalShulSlug: shul.slug,
    })
    .from(dataSource)
    .innerJoin(shul, eq(shul.id, dataSource.shulId))
    .where(eq(dataSource.id, dsId))
    .limit(1);
  const ds = rows[0];
  if (!ds) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Build a slug + display name for the new shul.
  // Identifier is a URL for website kinds and an email address for
  // email_newsletter — derive a sensible label either way.
  const newLabel = labelFromIdentifier(ds.identifier);
  const newMatchDomain = matchDomainOf(ds.identifier);
  const baseSlug = slugify(newLabel) || "shul";
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

  // Move the data_source + rules to the new shul in a single
  // transaction.
  let newShulSlug = "";
  await db.transaction(async (tx) => {
    const [newShul] = await tx
      .insert(shul)
      .values({
        slug: candidateSlug,
        name: `${newLabel} (split)`,
        submittedUrl: ds.kind === "email_newsletter" ? null : ds.identifier,
        contactEmail: ds.kind === "email_newsletter" ? ds.identifier : null,
        matchDomain: newMatchDomain,
        status: "pending_review",
      })
      .returning({ id: shul.id, slug: shul.slug });

    // Re-parent the data_source.
    await tx
      .update(dataSource)
      .set({ shulId: newShul.id, updatedAt: new Date() })
      .where(eq(dataSource.id, ds.dsId));

    // Re-parent its live rules.
    await tx
      .update(minyanRule)
      .set({ shulId: newShul.id, updatedAt: new Date() })
      .where(eq(minyanRule.dataSourceId, ds.dsId));

    newShulSlug = newShul.slug;
  });

  return NextResponse.redirect(
    new URL(
      `/admin/shul/${newShulSlug}?split=1&from=${encodeURIComponent(ds.originalShulSlug)}`,
      req.url,
    ),
    303,
  );
}

function labelFromIdentifier(identifier: string): string {
  // Email → use the local part as the label
  const atIdx = identifier.lastIndexOf("@");
  if (atIdx > 0) {
    return identifier.slice(0, atIdx);
  }
  // URL → hostname stripped of `www.`
  try {
    const u = new URL(identifier);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return identifier;
  }
}

