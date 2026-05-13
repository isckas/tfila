// One-shot admin endpoint: backfill shul.match_domain for existing rows.
//
// POST it once after migration 0004 has been applied. Idempotent —
// only updates rows where match_domain is NULL. Derives the value from
// submittedUrl when present, otherwise from any email_newsletter
// data_source's identifier under the same shul.
//
// Admin-only. Safe to run multiple times.

import { NextResponse } from "next/server";
import { eq, isNull, and, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSource, shul } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { matchDomainOf } from "@/lib/dedup";
import { isSharedMtaDomain } from "@/lib/inbound/extract-website";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const targets = await db
    .select({
      id: shul.id,
      name: shul.name,
      submittedUrl: shul.submittedUrl,
    })
    .from(shul)
    .where(isNull(shul.matchDomain));

  const log: Array<{
    id: number;
    name: string;
    matchDomain: string | null;
    source: "submitted_url" | "email_data_source" | null;
  }> = [];
  let applied = 0;
  let skipped = 0;

  for (const s of targets) {
    let md: string | null = null;
    let source: "submitted_url" | "email_data_source" | null = null;

    if (s.submittedUrl) {
      md = matchDomainOf(s.submittedUrl);
      if (md) source = "submitted_url";
    }
    if (!md) {
      const emailSource = await db
        .select({ identifier: dataSource.identifier })
        .from(dataSource)
        .where(
          and(
            eq(dataSource.shulId, s.id),
            eq(dataSource.kind, "email_newsletter"),
          ),
        )
        .limit(1);
      if (emailSource[0]) {
        // identifier may be plain "info@myshul.com" or compound
        // "info@myshul.com::edmondjsafrasynagogue.com" — strip the
        // compound suffix first so we evaluate the right half.
        const idParts = emailSource[0].identifier.split("::");
        const candidate = idParts.length === 2 ? idParts[1] : idParts[0];
        const derived = matchDomainOf(candidate);
        // Never use a shared-MTA registrable domain as match_domain —
        // that silently merges every shul on the platform into one row.
        if (derived && !isSharedMtaDomain(derived)) {
          md = derived;
          source = "email_data_source";
        }
      }
    }

    log.push({ id: s.id, name: s.name, matchDomain: md, source });
    if (!md) {
      skipped++;
      continue;
    }
    await db.execute(sql`
      UPDATE shul SET match_domain = ${md}, updated_at = NOW() WHERE id = ${s.id}
    `);
    applied++;
  }

  return NextResponse.json({
    ok: true,
    total: targets.length,
    applied,
    skipped,
    sample: log.slice(0, 20),
  });
}
