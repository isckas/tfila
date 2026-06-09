import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { timeReport } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { safeRedirect } from "@/lib/safe-redirect";

// E-B5 — triage a "report a wrong time" report. POST with form field
// `status` = 'resolved' (admin re-extracted / fixed) or 'dismissed' (the
// reported time was actually correct). Only acts on `open` reports.
//
// This is the minimal interim admin action; the full cockpit integration
// (inline triage from the inbox) is folded into the P4 redesign.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const reportId = Number(id);
  if (!Number.isInteger(reportId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const form = await req.formData();
  const status = form.get("status");
  if (status !== "resolved" && status !== "dismissed") {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  await db
    .update(timeReport)
    .set({ status, resolvedAt: new Date(), resolvedBy: session.email })
    .where(and(eq(timeReport.id, reportId), eq(timeReport.status, "open")));

  // Return to wherever it was triaged from (the inbox); /admin/reports is
  // retired (it now redirects to /admin), so that's the fallback too.
  return safeRedirect(req, "/admin");
}
