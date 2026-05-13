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
        md = matchDomainOf(emailSource[0].identifier);
        if (md) source = "email_data_source";
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
