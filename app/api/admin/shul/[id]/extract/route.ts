import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shul } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { inngest } from "@/lib/inngest/client";
import { safeRedirect } from "@/lib/safe-redirect";

/**
 * Trigger an extraction cascade for a shul. Dispatches the
 * `data-source.requested` event to the existing `buildDataSource` Inngest
 * worker (lib/inngest/functions/build-data-source.ts), which runs the
 * cascade and persists results in the background.
 *
 * Mirrors the per-data_source "Re-extract from source" route at
 * app/api/admin/data-source/[id]/rebuild/route.ts so both admin buttons
 * behave the same way: immediate redirect with a "queued" banner; new
 * data_source appears once the worker finishes (~30-120s).
 *
 * Force-extract semantics: the build path always re-runs the cascade
 * (no hash-match short-circuit; that optimization lives in scrapeOneShul).
 * Combined with persistDataSourceWithRules' supersede-on-insert, the new
 * data_source atomically replaces any prior approved+ok one for the same
 * (shul_id, identifier).
 */
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

  const rows = await db
    .select({
      id: shul.id,
      slug: shul.slug,
      submittedUrl: shul.submittedUrl,
    })
    .from(shul)
    .where(eq(shul.id, shulId))
    .limit(1);
  const s = rows[0];
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!s.submittedUrl) {
    return NextResponse.redirect(
      new URL(`/admin/shul/${s.slug}?err=no-url`, req.url),
      303,
    );
  }

  try {
    await inngest.send({
      name: "data-source.requested",
      data: {
        shulId: s.id,
        url: s.submittedUrl,
        sourceKind: "website_llm",
      },
    });
  } catch (err) {
    console.error("[shul/extract] inngest.send failed:", (err as Error).message);
  }

  // Return to wherever the admin triggered it — the inbox row (/admin) or the
  // shul page — via the same-origin Referer; fall back to the shul page. The
  // `rebuilt` flag rides along onto either target so both surfaces show a
  // "queued" banner (the inbox row can't change yet — extraction is async).
  return safeRedirect(req, `/admin/shul/${s.slug}`, { rebuilt: "1" });
}
