-- Migration 0007: drop 'no_url' from shul_status enum
--
-- The no_url status was added in 0006 to mark shuls approved from a
-- candidate without a URL. Product call: a shul without times is
-- worse than no shul at all, so the approve flow now requires a URL
-- before creating a shul row. The enum value becomes dead code.
--
-- Postgres doesn't support ALTER TYPE DROP VALUE directly, so use
-- the standard swap-table pattern: rename old enum, create new enum
-- without the value, migrate the column, drop the old enum.
--
-- Pre-migration: any existing 'no_url' rows get downgraded to
-- 'archived' so they're excluded from public queries (same behavior
-- they had before) and the type swap doesn't error on dangling values.
-- Production has 1 such row (id=61, Congregation Chevra Shas Bais
-- Mordechai) at the time of writing.

UPDATE "shul" SET "status" = 'archived'::"shul_status", "updated_at" = NOW()
  WHERE "status"::text = 'no_url';

ALTER TYPE "shul_status" RENAME TO "shul_status_old";

CREATE TYPE "shul_status" AS ENUM (
  'pending_review',
  'active',
  'broken',
  'archived',
  'unsupported'
);

ALTER TABLE "shul"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "shul_status" USING "status"::text::"shul_status",
  ALTER COLUMN "status" SET DEFAULT 'pending_review';

DROP TYPE "shul_status_old";
