// One-shot admin endpoint: null out shul.match_domain on rows where the
// stored value is a shared mailing-list provider (myshul.com,
// mailchimp.com, sendgrid.net, etc.) rather than the shul's own domain.
//
// Background: before the website-based dedup fix, email submissions
// from forwarded shul emails computed match_domain from the SENDER's
// email address. Forwarded shul emails are often relayed by shared
// platforms — every MyShul-hosted shul ended up with
// match_domain = "myshul.com", so the next forward would silently
// auto-merge into the first MyShul row regardless of which shul it
// was actually for.
//
// This endpoint nulls those out so they stop wrong-merging future
// submissions. Future email forwards will re-populate match_domain
// from the LLM-extracted shul website, not the sender.
//
// Admin-only. Idempotent — safe to re-run.

import { NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { shul } from "@/db/schema";
import { getAdminSession } from "@/lib/auth";
import { SHARED_MTA_DOMAINS } from "@/lib/inbound/extract-website";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const denylist = [...SHARED_MTA_DOMAINS];

  const targets = await db
    .select({
      id: shul.id,
      name: shul.name,
      slug: shul.slug,
      matchDomain: shul.matchDomain,
    })
    .from(shul)
    .where(inArray(shul.matchDomain, denylist));

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, cleared: 0, sample: [] });
  }

  await db.execute(sql`
    UPDATE shul
    SET match_domain = NULL, updated_at = NOW()
    WHERE id IN (${sql.join(targets.map((t) => sql`${t.id}`), sql`, `)})
  `);

  return NextResponse.json({
    ok: true,
    cleared: targets.length,
    sample: targets.slice(0, 20),
  });
}
