-- ============================================================
-- PR 1 cleanup — drop sprint-1 tables and enums
--
-- After verifying the new schema is the source of truth and
-- you don't need sprint-1 data for any rollback purpose, run
-- this migration to retire the old tables cleanly.
--
-- Apply with:
--   npx tsx -e "import 'dotenv/config'; const {Client}=require('pg'); const fs=require('fs'); (async()=>{const c=new Client({connectionString:process.env.DATABASE_URL}); await c.connect(); await c.query(fs.readFileSync('db/migrations/0002_drop_sprint1.sql','utf8')); await c.end(); console.log('sprint-1 dropped.')})()"
--
-- Or copy/paste in psql / Drizzle Studio's SQL panel.
-- ============================================================

-- Foreign-key columns in legacy tables → cascade drop
DROP TABLE IF EXISTS edit_proposals CASCADE;
DROP TABLE IF EXISTS scrape_runs    CASCADE;
DROP TABLE IF EXISTS minyanim       CASCADE;
DROP TABLE IF EXISTS shuls          CASCADE;
DROP TABLE IF EXISTS users          CASCADE;

DROP TYPE IF EXISTS source_platform CASCADE;
DROP TYPE IF EXISTS service         CASCADE;
DROP TYPE IF EXISTS day_rule        CASCADE;
DROP TYPE IF EXISTS time_kind       CASCADE;
DROP TYPE IF EXISTS scrape_status   CASCADE;
DROP TYPE IF EXISTS edit_status     CASCADE;
