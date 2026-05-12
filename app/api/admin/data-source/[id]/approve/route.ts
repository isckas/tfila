import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource, shul } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";

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

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ shulId: dataSource.shulId })
      .from(dataSource)
      .where(eq(dataSource.id, dsId))
      .limit(1);
    if (!rows[0]) return;

    await tx
      .update(dataSource)
      .set({
        reviewStatus: "approved",
        reviewerNotes: `Approved by ${session.email} at ${new Date().toISOString()}`,
        updatedAt: new Date(),
      })
      .where(eq(dataSource.id, dsId));

    // If the shul was pending_review, activate it now.
    await tx
      .update(shul)
      .set({
        status: "active",
        activatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shul.id, rows[0].shulId));
  });

  return NextResponse.redirect(new URL("/admin/queue", req.url), 303);
}
