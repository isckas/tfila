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

  // Every BROKEN-LANE shul: it has an approved source but NO fresh healthy one
  // (review_status='approved' + last_run ok/no_change + within 14d). This is
  // exactly the has_broken_run / counts.broken population the inbox shows — so
  // the button's "Re-extract all N broken" promise matches what actually fires.
  // The old filter (last_run_status IN ('broken','error')) silently SKIPPED
  // stale-but-ok shuls (last run 'ok' but >14d old), which the inbox still
  // counts as broken — so the count and the action diverged. We re-extract each
  // shul's submitted URL via data-source.requested, identical to clicking the
  // per-shul Re-extract button. URL-less broken shuls can't be re-extracted
  // (the inbox shows them an "Add a source URL" link instead). LIMIT bounds a
  // single batch; scrapeOneShul's global [{limit:3}] cap + the daily cost-gate
  // keep the fan-out safe.
  const rows = await db.execute<{ shul_id: number; submitted_url: string }>(sql`
    SELECT s.id AS shul_id, s.submitted_url
      FROM shul s
     WHERE s.status <> 'archived'
       AND s.submitted_url IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM data_source d
          WHERE d.shul_id = s.id AND d.review_status = 'approved'
       )
       AND NOT EXISTS (
         SELECT 1 FROM data_source d2
          WHERE d2.shul_id = s.id
            AND d2.review_status = 'approved'
            AND d2.last_run_status IN ('ok', 'no_change')
            AND COALESCE(d2.last_received_at, d2.last_run_at) >=
                NOW() - INTERVAL '14 days'
       )
     ORDER BY s.id
     LIMIT 100
  `);

  const events = rows.rows.map((r) => ({
    name: "data-source.requested" as const,
    data: {
      shulId: r.shul_id,
      url: r.submitted_url,
      sourceKind: "website_llm" as const,
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
