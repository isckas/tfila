// Supplementary cleanup: resolve duplicate (shul_id, identifier) pairs that
// the original dedupe-data-sources.ts script missed because its predicate
// required BOTH rows to be `review_status='approved' AND last_run_status='ok'`.
//
// Three cross-status patterns this catches:
//   - approved+ok  vs  pending+ok   (e.g., The Shul #101 + #102)
//   - approved+ok  vs  approved+no_change   (e.g., Anshei Lubavitch #79 + #80)
//   - approved+ok  vs  multiple pending+ok   (e.g., Chevra Ahavas Yisroel)
//
// Winner: priority DESC, last_run_at DESC NULLS LAST, id DESC.
// Tiebreaker bias: approved-status row over pending-status row when last_run_at
// is identical (we want to retain the human-approved source).
//
// Run AFTER scripts/dedupe-data-sources.ts. Required before the partial
// UNIQUE INDEX migration can apply cleanly.

import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { dataSource, minyanRule } from "../db/schema";

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("=== DRY RUN — no writes will be performed ===\n");

  // Find (shul_id, identifier) tuples with >1 non-rejected source.
  const dupTuples = await db.execute<{
    shul_id: number;
    identifier: string;
    n: number;
  }>(sql`
    SELECT shul_id, identifier, COUNT(*)::int AS n
      FROM data_source
     WHERE review_status <> 'rejected'
     GROUP BY shul_id, identifier
    HAVING COUNT(*) > 1
  `);

  console.log(
    `Found ${dupTuples.rows.length} (shul_id, identifier) tuple(s) with >1 non-rejected source.`,
  );

  let supersededSources = 0;
  let supersededRules = 0;

  for (const { shul_id, identifier } of dupTuples.rows) {
    const rows = await db
      .select({
        id: dataSource.id,
        reviewStatus: dataSource.reviewStatus,
        priority: dataSource.priority,
        lastRunAt: dataSource.lastRunAt,
      })
      .from(dataSource)
      .where(
        sql`${dataSource.shulId} = ${shul_id}
            AND ${dataSource.identifier} = ${identifier}
            AND ${dataSource.reviewStatus} <> 'rejected'`,
      );

    // Sort priority for picking the winner:
    //   1. approved beats pending — we want to retain the canonical
    //      human-reviewed source, even if a more-recent pending re-extraction
    //      exists alongside it. The pending row was a missed supersede.
    //   2. ds.priority DESC — email (60) > website (40) per SCOPE.md
    //   3. last_run_at DESC NULLS LAST — recency
    //   4. id DESC — stable tiebreaker
    rows.sort((a, b) => {
      const approvedScore = (r: { reviewStatus: string }) =>
        r.reviewStatus === "approved" ? 1 : 0;
      const ab = approvedScore(b) - approvedScore(a);
      if (ab !== 0) return ab;
      if (b.priority !== a.priority) return b.priority - a.priority;
      const aT = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
      const bT = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
      if (bT !== aT) return bT - aT;
      return b.id - a.id;
    });

    const winner = rows[0];
    const losers = rows.slice(1);
    console.log(
      `  shul ${shul_id} (${identifier}): keep ds#${winner.id} (${winner.reviewStatus}), supersede ${losers.length} loser(s): ${losers.map((l) => `#${l.id}(${l.reviewStatus})`).join(", ")}`,
    );

    for (const loser of losers) {
      if (dryRun) {
        const r = await db
          .select({ id: minyanRule.id })
          .from(minyanRule)
          .where(
            sql`${minyanRule.dataSourceId} = ${loser.id}
                AND ${minyanRule.deletedAt} IS NULL`,
          );
        console.log(
          `    [dry] would supersede ds#${loser.id} + soft-delete ${r.length} rule(s)`,
        );
        supersededRules += r.length;
        supersededSources += 1;
        continue;
      }
      await db.transaction(async (tx) => {
        await tx
          .update(dataSource)
          .set({
            reviewStatus: "rejected",
            reviewerNotes: `superseded by ds#${winner.id} on ${today} (cross-status cleanup)`,
            updatedAt: new Date(),
          })
          .where(eq(dataSource.id, loser.id));

        const deleted = await tx
          .update(minyanRule)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            sql`${minyanRule.dataSourceId} = ${loser.id}
                AND ${minyanRule.deletedAt} IS NULL`,
          )
          .returning({ id: minyanRule.id });
        supersededRules += deleted.length;
        supersededSources += 1;
      });
    }
  }

  console.log(
    `\n→ Superseded ${supersededSources} loser source(s), ${supersededRules} rule row(s).`,
  );

  // Sanity check.
  const stillDup = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM (
      SELECT shul_id, identifier FROM data_source
       WHERE review_status <> 'rejected'
       GROUP BY shul_id, identifier HAVING COUNT(*) > 1
    ) x
  `);
  console.log(
    `\n─── Sanity check ───\n  (shul_id, identifier) pairs still duplicated: ${stillDup.rows[0]?.n ?? 0} (expect 0)`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
