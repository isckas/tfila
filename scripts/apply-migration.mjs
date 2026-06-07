// Apply a single SQL migration file to the database in DATABASE_URL.
//
// Drizzle migrations in this repo are hand-authored numbered .sql files
// (db/migrations/NNNN_*.sql) applied directly to Neon. This runs one of them.
// Migrations are written to be idempotent (CREATE ... IF NOT EXISTS, guarded
// CREATE TYPE) so re-running is safe.
//
//   node scripts/apply-migration.mjs db/migrations/0013_time_report.sql
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/apply-migration.mjs <path-to-sql>");

const sql = readFileSync(file, "utf8");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

console.log(`Applying ${file} …`);
await pool.query(sql);
console.log("✓ applied");
await pool.end();
