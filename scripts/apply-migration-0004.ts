// One-shot: apply migration 0004 (shul.match_domain) to whatever DB
// .env.local DATABASE_URL points at. Idempotent.

import { sql } from "drizzle-orm";
import { db } from "../db/client";

async function main() {
  await db.execute(sql`
    ALTER TABLE shul ADD COLUMN IF NOT EXISTS match_domain varchar(253)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS shul_match_domain_idx ON shul (match_domain)
  `);
  const verify = await db.execute<{ column_name: string; data_type: string }>(sql`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_name = 'shul' AND column_name = 'match_domain'
  `);
  if (verify.rows.length === 0) {
    console.error("✗ migration 0004 failed — column not present after apply");
    process.exit(1);
  }
  console.log("✅ migration 0004 applied. match_domain column:", verify.rows[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error("migration 0004 failed:", err);
  process.exit(1);
});
