import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { safeRedirect } from "@/lib/safe-redirect";

/**
 * Move a previously-rejected data_source back to pending so it can be
 * re-reviewed. Does NOT touch the parent shul's status — that only
 * flips on approve.
 */
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

  // Load the row so we can guard against the partial UNIQUE INDEX
  // (data_source_shul_identifier_idx WHERE review_status <> 'rejected', migration
  // 0012). Most rejected rows are *superseded* dedupe losers that share their
  // (shul_id, identifier) with a live winner; a blind UPDATE→pending would bring
  // the loser back into the governed set and collide → unhandled 500. Refuse
  // cleanly instead. (Plan H5.)
  const rows = await db
    .select({ shulId: dataSource.shulId, identifier: dataSource.identifier })
    .from(dataSource)
    .where(eq(dataSource.id, dsId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    // The "Move back to pending" button lives on the deep data_source page;
    // land back there (which renders an ?err banner). /admin/rejected was
    // retired in the mission-control redesign.
    return safeRedirect(req, `/admin/data-source/${dsId}`, {
      err: "Data source not found.",
    });
  }

  const sibling = await db
    .select({ id: dataSource.id })
    .from(dataSource)
    .where(
      and(
        eq(dataSource.shulId, row.shulId),
        eq(dataSource.identifier, row.identifier),
        ne(dataSource.reviewStatus, "rejected"),
        ne(dataSource.id, dsId),
      ),
    )
    .limit(1);
  if (sibling[0]) {
    // A live (non-rejected) source already occupies this (shul_id, identifier).
    // Re-opening would violate the unique index — this row is a superseded
    // duplicate, so there is nothing to recover.
    return safeRedirect(req, `/admin/data-source/${dsId}`, {
      err: `Can't reopen — a live source (#${sibling[0].id}) already owns this address. This rejected row is a superseded duplicate.`,
      winner: String(sibling[0].id),
    });
  }

  try {
    await db
      .update(dataSource)
      .set({
        reviewStatus: "pending",
        reviewerNotes: `Re-opened by ${session.email} at ${new Date().toISOString()}`,
        updatedAt: new Date(),
      })
      .where(eq(dataSource.id, dsId));
  } catch {
    // Belt-and-suspenders for any other unique-violation / DB hiccup — surface
    // a banner instead of a 500.
    return safeRedirect(req, `/admin/data-source/${dsId}`, {
      err: "Couldn't reopen the data source — try again.",
    });
  }

  // Success: back to the deep page (now showing the source as pending again).
  return safeRedirect(req, `/admin/data-source/${dsId}`);
}
