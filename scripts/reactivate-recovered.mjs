// Set shul.status='active' for any non-archived shul that now HAS a fresh
// approved+ok source but whose stored status lags (pending_review / unsupported
// / the deprecated 'broken'). Public visibility is already derived from
// freshness (P0 E-A1), so this is cosmetic — it just makes shul.status match
// the admin/derived state after a recovery. Idempotent; safe to re-run.
//
//   node scripts/reactivate-recovered.mjs [--dry]
import { config } from "dotenv";
config({ path: ".env.local" });
import pg from "pg";

const dry = process.argv.includes("--dry");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query(`
  SELECT id, slug, status FROM shul s
   WHERE s.status IN ('pending_review','unsupported','broken')
     AND EXISTS (
       SELECT 1 FROM data_source ds
        WHERE ds.shul_id = s.id
          AND ds.review_status = 'approved'
          AND ds.last_run_status IN ('ok','no_change')
          AND COALESCE(ds.last_received_at, ds.last_run_at) >= now() - interval '14 days'
     )
   ORDER BY id`);

console.log(`${rows.length} recovered shul(s) to set active${dry ? " (DRY)" : ""}:`);
for (const r of rows) console.log(`  ${r.id}  ${r.slug}  (was ${r.status})`);

if (!dry && rows.length > 0) {
  const res = await pool.query(
    `UPDATE shul SET status='active', updated_at=now(), activated_at=COALESCE(activated_at, now()) WHERE id = ANY($1::int[])`,
    [rows.map((r) => r.id)],
  );
  console.log(`\nUpdated ${res.rowCount} → active.`);
}
await pool.end();
