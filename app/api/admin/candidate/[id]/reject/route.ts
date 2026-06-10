// Reject a shul_candidate — keeps the row (no DELETEs in this table)
// so re-runs of discovery filter it out of the admin queue automatically.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shulCandidate } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
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

  const form = await req.formData().catch(() => null);
  const reason =
    (form?.get("reason") as string | null)?.trim() || "no reason given";

  await db
    .update(shulCandidate)
    .set({
      reviewStatus: "rejected",
      reviewReason: reason,
      reviewedAt: new Date(),
      reviewedBy: session.email,
      updatedAt: new Date(),
    })
    .where(eq(shulCandidate.id, candidateId));

  // safeRedirect honors a same-origin Referer (inbox Discovery strip or the
  // candidates page) and falls back to /admin/candidates — without the
  // open-redirect risk of trusting a bare Referer.
  return safeRedirect(req, "/admin/candidates");
}
