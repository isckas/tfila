import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shul } from "@/db/schema";
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
  const shulId = Number(id);
  if (!Number.isInteger(shulId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const form = await req.formData();
  const name = (form.get("name") as string | null)?.trim();
  const address = (form.get("address") as string | null)?.trim() || null;
  const timezone = (form.get("timezone") as string | null)?.trim() || null;
  const nusach = (form.get("nusach") as string | null)?.trim() || null;
  const contactEmail =
    (form.get("contactEmail") as string | null)?.trim() || null;

  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const existing = await db
    .select({ slug: shul.slug })
    .from(shul)
    .where(eq(shul.id, shulId))
    .limit(1);
  if (!existing[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db
    .update(shul)
    .set({
      name,
      address,
      timezone,
      nusach,
      contactEmail,
      updatedAt: new Date(),
    })
    .where(eq(shul.id, shulId));

  return NextResponse.redirect(
    new URL(`/admin/shul/${existing[0].slug}`, req.url),
    303,
  );
}
