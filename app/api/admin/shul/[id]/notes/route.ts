// Save admin notes on a shul. Free-text scratchpad — never rendered
// publicly. Last-write-wins (no optimistic locking; one-admin-mostly
// project today). Empty body clears the field.
//
// See FEATURES.md "Admin notes per shul".

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shul } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";

const MAX_NOTES_LENGTH = 10_000;

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
  const raw = (form.get("notes") as string | null) ?? "";
  const trimmed = raw.trim();

  if (trimmed.length > MAX_NOTES_LENGTH) {
    return NextResponse.json(
      { error: `notes too long (max ${MAX_NOTES_LENGTH} chars)` },
      { status: 400 },
    );
  }

  const existing = await db
    .select({ slug: shul.slug })
    .from(shul)
    .where(eq(shul.id, shulId))
    .limit(1);
  if (!existing[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const now = new Date();
  await db
    .update(shul)
    .set({
      adminNotes: trimmed.length > 0 ? trimmed : null,
      adminNotesUpdatedBy: trimmed.length > 0 ? session.email : null,
      adminNotesUpdatedAt: trimmed.length > 0 ? now : null,
      updatedAt: now,
    })
    .where(eq(shul.id, shulId));

  return NextResponse.redirect(
    new URL(`/admin/shul/${existing[0].slug}?notes=saved`, req.url),
    303,
  );
}
