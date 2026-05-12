import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";

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

  await db
    .update(dataSource)
    .set({
      reviewStatus: "pending",
      reviewerNotes: `Re-opened by ${session.email} at ${new Date().toISOString()}`,
      updatedAt: new Date(),
    })
    .where(eq(dataSource.id, dsId));

  return NextResponse.redirect(new URL("/admin/rejected", req.url), 303);
}
