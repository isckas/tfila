// Backfill shul.match_domain for existing rows. Idempotent.
//
// Computes the registrable domain from:
//   1. shul.submittedUrl, if set
//   2. else: any email_newsletter data_source's identifier under this shul
//
// Run AFTER migration 0004 has been applied.
// Run: npx tsx scripts/backfill-match-domain.ts

import { eq, isNull, and, sql } from "drizzle-orm";
import { db } from "../db/client";
import { shul, dataSource } from "../db/schema";
import { matchDomainOf } from "../lib/dedup";

async function main() {
  const targets = await db
    .select({
      id: shul.id,
      name: shul.name,
      submittedUrl: shul.submittedUrl,
      matchDomain: shul.matchDomain,
    })
    .from(shul)
    .where(isNull(shul.matchDomain));

  if (targets.length === 0) {
    console.log("Nothing to backfill — every shul already has match_domain.");
    process.exit(0);
  }

  console.log(`Backfilling ${targets.length} shul(s)...`);
  let applied = 0;
  let skipped = 0;

  for (const s of targets) {
    let md: string | null = null;

    // Try submittedUrl first
    if (s.submittedUrl) {
      md = matchDomainOf(s.submittedUrl);
    }

    // Fallback: pull from any email_newsletter data_source's identifier
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
      if (emailSource[0]) md = matchDomainOf(emailSource[0].identifier);
    }

    if (!md) {
      console.log(`  ${s.id} ${s.name} — SKIP (no derivable domain)`);
      skipped++;
      continue;
    }

    await db.execute(sql`
      UPDATE shul SET match_domain = ${md}, updated_at = NOW() WHERE id = ${s.id}
    `);
    console.log(`  ${s.id} ${s.name} → ${md}`);
    applied++;
  }

  console.log("");
  console.log(`✅ Applied: ${applied}.  Skipped: ${skipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
