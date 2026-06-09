import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource, shul } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { safeRedirect } from "@/lib/safe-redirect";

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

  // Fix M: refuse to approve a data_source whose cascade failed. There's
  // nothing to approve when zero rules were extracted, and approval would
  // pollute the shul-level state. Auto-rejection happens at insertion
  // (persist-submission.ts Fix D); this guards against a stale row that
  // already exists.
  const existing = await db
    .select({
      shulId: dataSource.shulId,
      extractionStrategy: dataSource.extractionStrategy,
    })
    .from(dataSource)
    .where(eq(dataSource.id, dsId))
    .limit(1);

  if (!existing[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (existing[0].extractionStrategy === "failed") {
    // err rides onto whichever target wins (inbox or deep page) — see
    // safeRedirect's search arg; a bare fallback would lose it on a
    // same-origin Referer redirect.
    return safeRedirect(req, `/admin/data-source/${dsId}`, {
      err: "Can't approve — the extraction cascade failed (0 rules). Re-extract or reject.",
    });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(dataSource)
      .set({
        reviewStatus: "approved",
        reviewerNotes: `Approved by ${session.email} at ${new Date().toISOString()}`,
        updatedAt: new Date(),
      })
      .where(eq(dataSource.id, dsId));

    // Fix BB: only flip shul.status to active from pending_review /
    // unsupported. Refuse to silently un-archive a shul via source-approval.
    await tx
      .update(shul)
      .set({
        status: "active",
        activatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(shul.id, existing[0].shulId),
          inArray(shul.status, ["pending_review", "unsupported"]),
        ),
      );
  });

  // Return to wherever the admin approved from — the inbox expander (/admin)
  // or the deep review page — via the same-origin Referer; fall back to /admin.
  // An approved shul goes live, so it leaves the inbox on reload.
  return safeRedirect(req, "/admin");
}
