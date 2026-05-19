import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource } from "@/db/schema";
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

  await db
    .update(dataSource)
    .set({
      reviewStatus: "rejected",
      reviewerNotes: `Rejected by ${session.email} at ${new Date().toISOString()}`,
      updatedAt: new Date(),
    })
    .where(eq(dataSource.id, dsId));

  return safeRedirect(req, "/admin/queue");
}
