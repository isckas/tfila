import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource, minyanRule, shul, type MinyanTime } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { fetchHtml } from "@/lib/scrapers/fetch";
import { extractFromHtml } from "@/lib/llm/extract";

/**
 * Trigger an immediate (inline, synchronous) LLM extraction for a
 * shul that has no data_source yet — e.g. a fresh submission whose
 * Inngest event never got dispatched because the app isn't synced.
 *
 * Inline because:
 *  - Inngest might not be synced (the auto path may silently drop)
 *  - Admin is waiting on the response, ~30s wait is fine for one click
 *  - Failures are surfaced immediately rather than vanishing into a
 *    queue the admin can't see
 *
 * Caps at 60s. If Anthropic is rate-limited / no credits, surfaces
 * a clear error to the redirect target.
 */
export const maxDuration = 60;

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

  // Fetch the page
  let html: string;
  try {
    const fetched = await fetchHtml(s.submittedUrl, { timeoutMs: 25_000 });
    if (!fetched.ok || !fetched.html) {
      return NextResponse.redirect(
        new URL(
          `/admin/shul/${s.slug}?err=${encodeURIComponent("fetch HTTP " + fetched.status)}`,
          req.url,
        ),
        303,
      );
    }
    html = fetched.html;
  } catch (err) {
    return NextResponse.redirect(
      new URL(
        `/admin/shul/${s.slug}?err=${encodeURIComponent("fetch error: " + (err as Error).message.slice(0, 80))}`,
        req.url,
      ),
      303,
    );
  }

  // LLM extract
  let extracted;
  try {
    extracted = await extractFromHtml(html);
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

  // Persist
  await db.transaction(async (tx) => {
    const [ds] = await tx
      .insert(dataSource)
      .values({
        shulId: s.id,
        kind: "website_llm",
        identifier: s.submittedUrl!,
        configJson: {
          version: 1,
          page_url: s.submittedUrl,
          page_content_hash: extracted.pageContentHash,
          model: extracted.model,
          prompt_version: "tfila-v1",
          extracted_at: new Date().toISOString(),
          reasoning: extracted.extraction.reasoning,
          usage: extracted.usage,
          trigger: "admin_manual_extract",
        },
        confidenceScore: extracted.extraction.confidence,
        priority: 40,
        builtBy: "llm",
        builtAt: new Date(),
        lastRunAt: new Date(),
        lastRunStatus: "ok",
        reviewStatus: "pending",
      })
      .returning({ id: dataSource.id });

    for (const r of extracted.extraction.rules) {
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

    // Promote the LLM-detected shul name + address if the row still
    // has only the placeholder.
    if (extracted.extraction.shulName) {
      await tx.execute(sql`
        UPDATE shul SET name = ${extracted.extraction.shulName}, updated_at = NOW()
        WHERE id = ${s.id} AND (name LIKE '%.%' OR name = '')
      `);
    }
    if (extracted.extraction.shulAddress) {
      await tx.execute(sql`
        UPDATE shul SET address = COALESCE(address, ${extracted.extraction.shulAddress}), updated_at = NOW()
        WHERE id = ${s.id}
      `);
    }
  });

  return NextResponse.redirect(
    new URL(`/admin/shul/${s.slug}?extracted=1`, req.url),
    303,
  );
}
