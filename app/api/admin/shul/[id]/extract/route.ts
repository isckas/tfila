import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource, shul } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { runCascade } from "@/lib/llm/cascade";
import { backfillShulLocation } from "@/lib/geocoding";
import { insertRuleFromExtraction } from "@/lib/pipeline/persist-submission";

/**
 * Trigger an immediate (inline, synchronous) extraction cascade for
 * a shul. The cascade runs HTML → JS-rendered → Vision → PDF → failed.
 * Whatever strategy succeeds gets persisted on the data_source so
 * weekly rescrapes skip the earlier tiers.
 *
 * Caps at 300s (Vercel platform default since 2026-Q1). Worst case is
 * all four tiers — HTML ~10s + JS render ~30s + Vision ~20s + PDF
 * ~60s for a large multi-page bulletin = ~120s.
 */
export const maxDuration = 300;

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

  // Look up the shul + its URL
  const rows = await db
    .select({
      id: shul.id,
      slug: shul.slug,
      name: shul.name,
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

  // Run the cascade. Cascade itself doesn't throw on missing rules —
  // it returns strategy='failed' instead. It only throws on Anthropic
  // hard errors (credit balance, rate limit).
  let cascade;
  try {
    cascade = await runCascade(s.submittedUrl, { timeoutMs: 25_000 });
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    const tag =
      msg.includes("credit balance") || msg.includes("invalid_request_error")
        ? "no-credits"
        : msg.includes("rate_limit")
          ? "rate-limited"
          : "llm-error";
    return NextResponse.redirect(
      new URL(
        `/admin/shul/${s.slug}?err=${encodeURIComponent(tag + ": " + msg.slice(0, 80))}`,
        req.url,
      ),
      303,
    );
  }

  // ─── Failed cascade: record + mark shul unsupported ────────────────
  if (cascade.strategy === "failed" || !cascade.extraction) {
    await db.transaction(async (tx) => {
      await tx.insert(dataSource).values({
        shulId: s.id,
        kind: "website_llm",
        identifier: s.submittedUrl!,
        configJson: {
          version: 2,
          submitted_url: s.submittedUrl,
          cascade_attempts: cascade.attempts,
          usage: cascade.usage,
          extracted_at: new Date().toISOString(),
          trigger: "admin_manual_extract",
        },
        extractionStrategy: "failed",
        confidenceScore: null,
        priority: 40,
        builtBy: "llm",
        builtAt: new Date(),
        lastRunAt: new Date(),
        lastRunStatus: "broken",
        reviewStatus: "pending",
      });
      await tx
        .update(shul)
        .set({ status: "unsupported", updatedAt: new Date() })
        .where(eq(shul.id, s.id));
    });
    return NextResponse.redirect(
      new URL(
        `/admin/shul/${s.slug}?err=${encodeURIComponent(
          "Extraction failed across all tiers. See the per-tier breakdown below for what each strategy tried and why it didn't produce rules.",
        )}`,
        req.url,
      ),
      303,
    );
  }

  // ─── Success: persist ──────────────────────────────────────────────
  const { extraction, model, winningUrl, strategy, attempts } = cascade;

  // For non-HTML strategies (vision_image, pdf_document), the winning URL
  // is a specific resource (this week's schedule image / bulletin PDF)
  // whose filename will change next week — e.g. Times-Bamidbar5786.png
  // becomes Times-Naso5786.png. Storing it as the identifier would make
  // weekly rescrapes 404. Instead we keep the submitted page URL as the
  // identifier so rescrapes re-discover the current week's resource;
  // the actual resource URL goes to configJson.last_extracted_resource
  // as an informational audit trail.
  const isResourceStrategy =
    strategy === "vision_image" || strategy === "pdf_document";
  const identifier = isResourceStrategy ? s.submittedUrl! : winningUrl;

  await db.transaction(async (tx) => {
    const [ds] = await tx
      .insert(dataSource)
      .values({
        shulId: s.id,
        kind: "website_llm",
        identifier,
        configJson: {
          version: 2,
          page_url: isResourceStrategy ? s.submittedUrl : winningUrl,
          submitted_url: s.submittedUrl,
          extraction_strategy: strategy,
          last_extracted_resource: isResourceStrategy ? winningUrl : undefined,
          cascade_attempts: attempts,
          page_content_hash: cascade.pageContentHash,
          model,
          prompt_version: "tfila-v1",
          extracted_at: new Date().toISOString(),
          reasoning: extraction.reasoning,
          usage: cascade.usage,
          trigger: "admin_manual_extract",
        },
        confidenceScore: extraction.confidence,
        extractionStrategy: strategy,
        priority: 40,
        builtBy: "llm",
        builtAt: new Date(),
        lastRunAt: new Date(),
        lastRunStatus: "ok",
        reviewStatus: "pending",
      })
      .returning({ id: dataSource.id });

    const lastSeenAt = new Date();
    for (const r of extraction.rules) {
      await insertRuleFromExtraction(tx, {
        shulId: s.id,
        dataSourceId: ds.id,
        rule: r,
        lastSeenAt,
      });
    }

    if (extraction.shulName) {
      await tx.execute(sql`
        UPDATE shul SET name = ${extraction.shulName}, updated_at = NOW()
        WHERE id = ${s.id} AND (name LIKE '%.%' OR name = '')
      `);
    }
    if (extraction.shulAddress) {
      await tx.execute(sql`
        UPDATE shul SET address = COALESCE(address, ${extraction.shulAddress}), updated_at = NOW()
        WHERE id = ${s.id}
      `);
    }
    // If shul was previously marked unsupported, restore to pending_review.
    await tx
      .update(shul)
      .set({ status: "pending_review", updatedAt: new Date() })
      .where(eq(shul.id, s.id))
      .execute()
      .catch(() => {});
  });

  // ─── Address fallback: Google Places search if shul has no address
  // Shared with URL + email submission paths via lib/geocoding.ts.
  let addressFromPlaces = false;
  try {
    const post = await db
      .select({ name: shul.name })
      .from(shul)
      .where(eq(shul.id, s.id))
      .limit(1);
    if (post[0]) {
      const result = await backfillShulLocation({
        shulId: s.id,
        name: extraction.shulName ?? post[0].name,
        urlHint: s.submittedUrl,
      });
      addressFromPlaces = result.applied;
    }
  } catch {
    // Non-fatal — address backfill failure shouldn't block extraction success.
  }

  const qs = new URLSearchParams({ extracted: "1", strategy });
  if (addressFromPlaces) qs.set("address", "places");
  // The "from" param triggers the "you should update your source URL"
  // banner. That advice only applies for the HTML same-origin fallback
  // (e.g. submitted /calendar but rules came from /worship/shabbat).
  // For vision/PDF, the winning URL is a per-week resource — admin
  // shouldn't change the source URL to chase a weekly-rotating filename.
  if (!isResourceStrategy && winningUrl !== s.submittedUrl) {
    qs.set("from", winningUrl);
  }
  if (isResourceStrategy) {
    qs.set("resource", winningUrl);
  }
  return NextResponse.redirect(
    new URL(`/admin/shul/${s.slug}?${qs.toString()}`, req.url),
    303,
  );
}
