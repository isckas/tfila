import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource, shul } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { inngest } from "@/lib/inngest/client";
import { safeRedirect } from "@/lib/safe-redirect";

/**
 * Fires a `data-source.requested` event so the Inngest pipeline
 * re-extracts the schedule. The function (build-data-source.ts)
 * creates a NEW data_source row — older ones coexist; admin picks
 * the canonical one.
 *
 * Returns 303 back to the shul's admin page.
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
  const dsId = Number(id);
  if (!Number.isInteger(dsId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const rows = await db
    .select({
      shulId: dataSource.shulId,
      identifier: dataSource.identifier,
      kind: dataSource.kind,
      slug: shul.slug,
    })
    .from(dataSource)
    .innerJoin(shul, eq(shul.id, dataSource.shulId))
    .where(eq(dataSource.id, dsId))
    .limit(1);
  const ds = rows[0];
  if (!ds) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Only website-kind sources are rebuildable via the URL extractor.
  if (ds.kind !== "website_llm" && ds.kind !== "shulcloud_website") {
    return NextResponse.json(
      { error: `cannot rebuild kind=${ds.kind}` },
      { status: 400 },
    );
  }

  try {
    await inngest.send({
      name: "data-source.requested",
      data: {
        shulId: ds.shulId,
        url: ds.identifier,
        sourceKind: "website_llm",
      },
    });
  } catch (err) {
    console.error("[rebuild] inngest.send failed:", (err as Error).message);
    // Don't claim a queued re-extraction when the enqueue failed (it would mount
    // a poller on a job that never started). Surface the failure instead.
    return safeRedirect(req, `/admin/shul/${ds.slug}`, {
      err: "Couldn't queue the re-extraction — the job system may be down. Try again.",
    });
  }

  // `rebuilt` → shul-page banner; `queued` → inbox banner + the shul id whose
  // row mounts a RowPoller to auto-refresh when the re-extraction lands. Both
  // ride onto whichever target wins the same-origin Referer redirect.
  return safeRedirect(req, `/admin/shul/${ds.slug}`, {
    rebuilt: "1",
    queued: String(ds.shulId),
  });
}
