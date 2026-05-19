// One-shot runner for migration 0011_state_machine_fix.sql.
// Applies ONLY the two ALTER TABLE statements from that migration —
// doesn't touch anything else. Safer than `drizzle-kit push` which
// would also apply unrelated schema-vs-DB drift.
//
// Run: npx tsx scripts/apply-migration-0011.ts
//      npx tsx scripts/apply-migration-0011.ts --dry-run

import { sql } from "drizzle-orm";
import { db } from "../db/client";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Pre-check: are the columns already present?
  const before = await db.execute<{ table_name: string; column_name: string }>(sql`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND ((table_name = 'minyan_rule' AND column_name = 'is_manual_edit')
            OR (table_name = 'data_source' AND column_name = 'first_broken_at'))
  `);
  const have = new Set(before.rows.map((r) => `${r.table_name}.${r.column_name}`));

  const todo: Array<{ name: string; sql: ReturnType<typeof sql> }> = [];
  if (!have.has("minyan_rule.is_manual_edit")) {
    todo.push({
      name: "minyan_rule.is_manual_edit",
      sql: sql`ALTER TABLE "minyan_rule"
                 ADD COLUMN "is_manual_edit" boolean DEFAULT false NOT NULL`,
    });
  }
  if (!have.has("data_source.first_broken_at")) {
    todo.push({
      name: "data_source.first_broken_at",
      sql: sql`ALTER TABLE "data_source"
                 ADD COLUMN "first_broken_at" timestamp with time zone`,
    });
  }

  if (todo.length === 0) {
    console.log("Both columns already present. Nothing to do.");
    process.exit(0);
  }

  console.log(`Would apply ${todo.length} ALTER TABLE statement(s):`);
  for (const t of todo) console.log(`  + ${t.name}`);
  if (dryRun) {
    console.log("\n[dry-run] No changes made.");
    process.exit(0);
  }

  for (const t of todo) {
    console.log(`Applying: ${t.name} ...`);
    await db.execute(t.sql);
    console.log(`  ✓ done.`);
  }

  // Post-check + report.
  const after = await db.execute<{ table_name: string; column_name: string; data_type: string }>(sql`
    SELECT table_name, column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND ((table_name = 'minyan_rule' AND column_name = 'is_manual_edit')
            OR (table_name = 'data_source' AND column_name = 'first_broken_at'))
     ORDER BY table_name, column_name
  `);

  console.log("\nFinal column state:");
  for (const r of after.rows) {
    console.log(`  ${r.table_name}.${r.column_name}: ${r.data_type}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
