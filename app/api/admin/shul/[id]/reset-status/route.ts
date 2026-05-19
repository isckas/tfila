import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { shul } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";

// Fix N: admin recovery affordance for `shul.status='unsupported'`.
// Today the only way out of the unsupported one-way door is a successful
// manual Extract Now (which auto-flips status to pending_review). When
// the page DOESN'T extract cleanly but admin wants to retry later (or
// edit the source URL), they need a way to reset status manually.
//
// POST flips an `unsupported` shul to `pending_review` so it re-enters
// the admin queue + can be edited/re-extracted. Refuses to act on
// archived/active shuls (those are different lifecycle states with
// their own controls).
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

  const result = await db
    .update(shul)
    .set({ status: "pending_review", updatedAt: new Date() })
    .where(
      and(eq(shul.id, shulId), inArray(shul.status, ["unsupported"])),
    )
    .returning({ id: shul.id, slug: shul.slug });

  if (result.length === 0) {
    return NextResponse.json(
      { error: "shul is not in unsupported state" },
      { status: 409 },
    );
  }

  return NextResponse.redirect(
    new URL(`/admin/shul/${result[0].slug}`, req.url),
    303,
  );
}
