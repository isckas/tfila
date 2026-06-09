import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { minyanRule } from "@/db/schema";
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
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // Fix EE: mark as manual edit AND soft-delete. The is_manual_edit flag
  // prevents the weekly cron from re-creating this rule via the rule-
  // replacement step. Without the flag, an admin "delete" would silently
  // come back on the next extraction.
  await db
    .update(minyanRule)
    .set({
      deletedAt: new Date(),
      isManualEdit: true,
      updatedAt: new Date(),
    })
    .where(eq(minyanRule.id, ruleId));

  // The explicit ?dsId is a more specific, trustworthy target than the Referer,
  // so prefer it: land on the deep data_source review page (full rules list) —
  // both for a deep-page delete AND an inbox-expander delete (where the expander
  // would otherwise collapse on a bare /admin reload mid-review). Fall back to
  // the Referer/inbox only when no dsId is present.
  const url = new URL(req.url);
  const dsId = url.searchParams.get("dsId");
  if (dsId && /^\d+$/.test(dsId)) {
    return NextResponse.redirect(
      new URL(`/admin/data-source/${dsId}`, req.url),
      303,
    );
  }
  return safeRedirect(req, "/admin");
}
