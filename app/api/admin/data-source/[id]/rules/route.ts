import { NextResponse } from "next/server";
import { getDataSourceForReview } from "@/lib/queries";
import { getAdminSession } from "@/lib/auth";
import { toReviewRule } from "@/components/admin/RulesReviewPanel";

export const dynamic = "force-dynamic";

/**
 * Read-only endpoint backing the inbox's expand-in-place rule review
 * (ReviewExpander). Returns the same data the deep /admin/data-source/[id]
 * page renders, narrowed to a serializable shape, so the admin can vet an
 * extraction without a page hop. Cookie-auth via getAdminSession (this is a
 * GET fetched from a client component, not a form-post).
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
  const dsId = Number(id);
  if (!Number.isInteger(dsId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const payload = await getDataSourceForReview(dsId);
  if (!payload) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { dataSource: ds, shul: s, rules } = payload;
  const config = (ds.configJson as Record<string, unknown> | null) ?? {};
  const reasoning =
    typeof config.reasoning === "string" ? config.reasoning : null;

  const reviewRules = rules.map(toReviewRule);

  return NextResponse.json({
    ds: {
      id: ds.id,
      kind: ds.kind,
      identifier: ds.identifier,
      reviewStatus: ds.reviewStatus,
      confidenceScore: ds.confidenceScore,
    },
    shul: { name: s?.name ?? null, slug: s?.slug ?? null },
    reasoning,
    rules: reviewRules,
  });
}
