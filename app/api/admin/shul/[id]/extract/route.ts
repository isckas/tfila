import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource, minyanRule, shul, type MinyanTime } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { runCascade } from "@/lib/llm/cascade";

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
  await db.transaction(async (tx) => {
    const [ds] = await tx
      .insert(dataSource)
      .values({
        shulId: s.id,
        kind: "website_llm",
        identifier: winningUrl,
        configJson: {
          version: 2,
          page_url: winningUrl,
          submitted_url: s.submittedUrl,
          extraction_strategy: strategy,
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

    for (const r of extraction.rules) {
      const time: MinyanTime =
        r.time.kind === "fixed"
          ? { kind: "fixed", clock: r.time.clock }
          : { kind: "zmanim", anchor: r.time.anchor, offsetMin: r.time.offsetMin };
      await tx.insert(minyanRule).values({
        shulId: s.id,
        dataSourceId: ds.id,
        tefillah: r.tefillah,
        tefillahLabel: r.tefillahLabel ?? null,
        daysOfWeek: r.daysOfWeek ?? null,
        time: time as unknown as object,
        validFrom: r.validFrom ?? null,
        validTo: r.validTo ?? null,
        specialScheduleKind: r.specialScheduleKind,
        priority: 0,
        nusach: r.nusach ?? null,
        notes: r.notes ?? null,
        lastSeenInScrapeAt: new Date(),
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

  const qs = new URLSearchParams({ extracted: "1", strategy });
  if (winningUrl !== s.submittedUrl) qs.set("from", winningUrl);
  return NextResponse.redirect(
    new URL(`/admin/shul/${s.slug}?${qs.toString()}`, req.url),
    303,
  );
}
