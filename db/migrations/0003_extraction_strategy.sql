-- Migration 0003: extraction strategy tracking
--
-- Adds a new enum + column to data_source so we remember which tier of
-- the extraction cascade produced the rules (HTML / JS-rendered / PDF /
-- vision). Weekly rescrapes use this to skip the whole cascade and go
-- straight to the known-good tier.
--
-- Also adds 'unsupported' to shul_status for shuls where every tier of
-- the cascade returned no rules — these get skipped by the weekly cron.

-- ─── New enum: extraction_strategy ───────────────────────────────────────
CREATE TYPE "extraction_strategy" AS ENUM (
  'html',
  'js_rendered',
  'pdf_document',
  'vision_image',
  'failed'
);

-- ─── New column on data_source ───────────────────────────────────────────
ALTER TABLE "data_source"
  ADD COLUMN "extraction_strategy" "extraction_strategy";

-- Backfill: every existing data_source was built from HTML extraction.
UPDATE "data_source"
   SET "extraction_strategy" = 'html'
 WHERE "extraction_strategy" IS NULL
   AND "kind" IN ('website_llm', 'shulcloud_website');

-- Email-newsletter sources don't fit the cascade model; leave NULL.

-- ─── Extend shul_status enum ─────────────────────────────────────────────
ALTER TYPE "shul_status" ADD VALUE IF NOT EXISTS 'unsupported';
