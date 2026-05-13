// Reset a shul's status from 'unsupported' back to 'pending_review' so
// admin can retry extraction after a cascade bug is fixed.
// Run: npx tsx scripts/reset-shul-status.ts <url-substring>

import { sql } from "drizzle-orm";
import { db } from "../db/client";

async function main() {
  const needle = process.argv[2];
  if (!needle) {
    console.error("Usage: tsx scripts/reset-shul-status.ts <url-substring>");
    process.exit(1);
  }

  const before = await db.execute<{
    id: number;
    name: string;
    status: string;
    submitted_url: string | null;
  }>(sql`
    SELECT id, name, status, submitted_url
      FROM shul
     WHERE submitted_url ILIKE ${`%${needle}%`}
        OR name ILIKE ${`%${needle}%`}
  `);
  console.log("Before:");
  for (const r of before.rows) console.log(` ${r.id} ${r.status.padEnd(15)} ${r.name}`);

  const updated = await db.execute(sql`
    UPDATE shul
       SET status = 'pending_review', updated_at = NOW()
     WHERE (submitted_url ILIKE ${`%${needle}%`} OR name ILIKE ${`%${needle}%`})
       AND status = 'unsupported'
    RETURNING id, name, status
  `);
  console.log(`\nReset ${updated.rowCount ?? 0} row(s) from 'unsupported' → 'pending_review'`);

  const after = await db.execute<{ id: number; name: string; status: string }>(sql`
    SELECT id, name, status FROM shul
     WHERE submitted_url ILIKE ${`%${needle}%`} OR name ILIKE ${`%${needle}%`}
  `);
  console.log("\nAfter:");
  for (const r of after.rows) console.log(` ${r.id} ${r.status.padEnd(15)} ${r.name}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("reset failed:", err);
  process.exit(1);
});
