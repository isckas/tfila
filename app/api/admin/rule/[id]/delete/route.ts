import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { minyanRule } from "@/db/schema";
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
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await db
    .update(minyanRule)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(minyanRule.id, ruleId));

  // Redirect back to whichever data_source page this came from
  // (via ?dsId in the form action) — falls back to /admin/queue.
  const url = new URL(req.url);
  const dsId = url.searchParams.get("dsId");
  const target = dsId ? `/admin/data-source/${dsId}` : "/admin/queue";
  return NextResponse.redirect(new URL(target, req.url), 303);
}
