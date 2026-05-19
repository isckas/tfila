// Fix B: one-time cleanup of duplicate + legacy-broken data_sources.
//
// Two operations, idempotent and additive (soft-delete only — no DROP):
//
// 1. **Dedupe shuls with multiple approved+ok sources.** For each shul
//    where >1 data_source has review_status='approved' AND
//    last_run_status='ok', pick the winner by:
//      priority DESC, last_run_at DESC NULLS LAST, id DESC
//    Mark losers `review_status='rejected'` with
//    `reviewer_notes='superseded by ds#<winner> on YYYY-MM-DD'`.
//    Soft-delete loser data_sources' minyan_rule rows so they're hidden
//    from the public feed even if a regression in Fix A's rule-level
//    dedup CTE bypasses winner selection.
//
// 2. **Auto-reject legacy failed extractions.** For each data_source
//    where extraction_strategy='failed' AND review_status <> 'rejected',
//    mark `review_status='rejected'` with
//    `reviewer_notes='auto-rejected: legacy migration cleanup (failed extraction)'`.
//    These are sprint-1 legacy rows that the new Fix D (auto-reject at
//    persistence) would have caught if it had existed then.
//
// Run: npm run db:dedupe-sources                         (writes)
//      npm run db:dedupe-sources -- --dry-run            (reports only)
// Re-running is safe: the WHERE clauses skip already-rejected rows so
// nothing gets double-touched.

import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { dataSource, minyanRule } from "../db/schema";

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("=== DRY RUN — no writes will be performed ===\n");
  }

  // ─── 1. Find shuls with multiple approved+ok sources ──────────
  const dupShuls = await db.execute<{ shul_id: number; n: number }>(sql`
    SELECT shul_id, COUNT(*)::int AS n
      FROM data_source
     WHERE review_status = 'approved' AND last_run_status = 'ok'
     GROUP BY shul_id
    HAVING COUNT(*) > 1
  `);

  console.log(`Found ${dupShuls.rows.length} shul(s) with >1 approved+ok source.`);

  let dedupedShuls = 0;
  let dedupedSources = 0;
  let dedupedRules = 0;

  for (const { shul_id } of dupShuls.rows) {
    const sources = await db
      .select({
        id: dataSource.id,
        priority: dataSource.priority,
        lastRunAt: dataSource.lastRunAt,
      })
      .from(dataSource)
      .where(
        sql`${dataSource.shulId} = ${shul_id}
            AND ${dataSource.reviewStatus} = 'approved'
            AND ${dataSource.lastRunStatus} = 'ok'`,
      );

    // Sort by winning criteria (DESC) — first element is the keeper.
    sources.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const aT = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
      const bT = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
      if (bT !== aT) return bT - aT;
      return b.id - a.id;
    });

    const winner = sources[0];
    const losers = sources.slice(1);
    console.log(
      `  shul ${shul_id}: keep ds#${winner.id}, supersede ${losers.length} loser(s): ${losers.map((l) => `#${l.id}`).join(", ")}`,
    );

    for (const loser of losers) {
      if (dryRun) {
        // Count the rules that WOULD be soft-deleted, without writing.
        const ruleRows = await db
          .select({ id: minyanRule.id })
          .from(minyanRule)
          .where(
            sql`${minyanRule.dataSourceId} = ${loser.id}
                AND ${minyanRule.deletedAt} IS NULL`,
          );
        console.log(
          `    [dry] would supersede ds#${loser.id} + soft-delete ${ruleRows.length} rule(s)`,
        );
        dedupedRules += ruleRows.length;
        dedupedSources += 1;
        continue;
      }
      await db.transaction(async (tx) => {
        await tx
          .update(dataSource)
          .set({
            reviewStatus: "rejected",
            reviewerNotes: `superseded by ds#${winner.id} on ${today}`,
            updatedAt: new Date(),
          })
          .where(eq(dataSource.id, loser.id));

        const deletedRules = await tx
          .update(minyanRule)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            sql`${minyanRule.dataSourceId} = ${loser.id}
                AND ${minyanRule.deletedAt} IS NULL`,
          )
          .returning({ id: minyanRule.id });

        dedupedRules += deletedRules.length;
        dedupedSources += 1;
      });
    }

    dedupedShuls += 1;
  }

  console.log(
    `\n→ Deduped ${dedupedShuls} shul(s), ${dedupedSources} loser source(s), ${dedupedRules} rule row(s).`,
  );

  // ─── 2. Auto-reject legacy strategy='failed' rows ─────────────
  if (dryRun) {
    const wouldReject = await db
      .select({ id: dataSource.id })
      .from(dataSource)
      .where(
        sql`${dataSource.extractionStrategy} = 'failed'
            AND ${dataSource.reviewStatus} <> 'rejected'`,
      );
    console.log(
      `→ [dry] would auto-reject ${wouldReject.length} legacy failed source(s).`,
    );
  } else {
    const failedToReject = await db
      .update(dataSource)
      .set({
        reviewStatus: "rejected",
        reviewerNotes: `auto-rejected: legacy migration cleanup (failed extraction) on ${today}`,
        updatedAt: new Date(),
      })
      .where(
        sql`${dataSource.extractionStrategy} = 'failed'
            AND ${dataSource.reviewStatus} <> 'rejected'`,
      )
      .returning({ id: dataSource.id });
    console.log(`→ Auto-rejected ${failedToReject.length} legacy failed source(s).`);
  }

  // ─── 3. Sanity-check post-state ───────────────────────────────
  const stillDup = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM (
      SELECT shul_id FROM data_source
       WHERE review_status = 'approved' AND last_run_status = 'ok'
       GROUP BY shul_id HAVING COUNT(*) > 1
    ) x
  `);
  const stillApprovedFailed = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM data_source
     WHERE review_status = 'approved' AND extraction_strategy = 'failed'
  `);

  console.log("\n─── Sanity checks ───");
  console.log(`  shuls still with >1 approved+ok source: ${stillDup.rows[0]?.n ?? 0} (expect 0)`);
  console.log(`  approved sources with strategy=failed:   ${stillApprovedFailed.rows[0]?.n ?? 0} (expect 0)`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
