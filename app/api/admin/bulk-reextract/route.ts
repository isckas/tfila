import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getAdminSession } from "@/lib/auth";
import { inngest } from "@/lib/inngest/client";

export const dynamic = "force-dynamic";

// Bulk re-extract all currently-broken sources (UI-5 stretch / E-D1). This is
// SAFE now — the skeptic flagged it as a 429-storm risk, but P0 added a GLOBAL
// concurrency cap on scrapeOneShul ([{ limit: 3 }]) so the fan-out throttles to
// 3-at-a-time and can't repeat the storm, and the daily cost-gate caps LLM
// spend. Admin-auth-gated here + confirm-gated in the UI (BulkReextractButton).
export async function POST(req: Request): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Every currently-broken/error source that could recover: not rejected, not
  // archived, and not a known-terminal 'failed' strategy. Mirrors the
  // recover-stranded.mjs target. LIMIT bounds a single batch.
  const rows = await db.execute<{ data_source_id: number; shul_id: number }>(sql`
    SELECT ds.id AS data_source_id, ds.shul_id
      FROM data_source ds
      JOIN shul s ON s.id = ds.shul_id
     WHERE ds.last_run_status IN ('broken', 'error')
       AND ds.review_status <> 'rejected'
       AND s.status <> 'archived'
       AND COALESCE(ds.extraction_strategy::text, 'html') <> 'failed'
     ORDER BY ds.shul_id
     LIMIT 100
  `);

  const events = rows.rows.map((r) => ({
    name: "shul.scrape.requested" as const,
    data: {
      shulId: r.shul_id,
      dataSourceId: r.data_source_id,
      reason: "manual" as const,
    },
  }));

  if (events.length > 0) {
    try {
      await inngest.send(events); // single batch send
    } catch (err) {
      console.error("[bulk-reextract] inngest.send failed:", (err as Error).message);
      return NextResponse.redirect(new URL("/admin?reextract=error", req.url), 303);
    }
  }

  return NextResponse.redirect(
    new URL(`/admin?reextract=${events.length}`, req.url),
    303,
  );
}
