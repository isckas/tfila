import { NextResponse } from "next/server";
import { getAdminShulStateById } from "@/lib/queries";
import { deriveAdminShulState } from "@/lib/admin-state";
import { getAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Tiny derived-state endpoint an in-flight inbox row polls (RowPoller) until
 * its extraction lands. Returns the current derived AdminShulState + the newest
 * reviewable pending data_source id; the client compares against the values it
 * mounted with and calls router.refresh() when either changes. Cookie-auth
 * (GET fetched from a client component).
 */
export async function GET(
  _req: Request,
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

  const row = await getAdminShulStateById(shulId);
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    state: deriveAdminShulState(row),
    pendingDataSourceId: row.pendingDataSourceId,
    // dataSourceCount lets the poller detect a re-extraction that LANDED but
    // didn't change state/pendingId — notably a FAILED cascade, which inserts a
    // new strategy='failed' source (count++) yet leaves a broken row broken with
    // no reviewable pending source. Without this the poller spun to its cap.
    dataSourceCount: row.dataSourceCount,
  });
}
