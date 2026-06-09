import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shul } from "@/db/schema";
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
  const shulId = Number(id);
  if (!Number.isInteger(shulId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // Toggle: archived → active, anything-else → archived.
  const rows = await db
    .select({ slug: shul.slug, status: shul.status })
    .from(shul)
    .where(eq(shul.id, shulId))
    .limit(1);
  const s = rows[0];
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });

  const newStatus = s.status === "archived" ? "active" : "archived";
  await db
    .update(shul)
    .set({
      status: newStatus,
      activatedAt: newStatus === "active" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(shul.id, shulId));

  return safeRedirect(req, `/admin/shul/${s.slug}`);
}
