-- Migration 0010: minyan_rule.source_quote nullable column
--
-- Part of EXTRACTION-ONE-SHOT-PLAN.md step 1. Adds an optional field
-- where the v2 extraction pipeline stores the exact source text that
-- each rule was extracted from. v1 pipeline doesn't populate this;
-- v2 always does.
--
-- Additive nullable column so v1 keeps working unchanged. No backfill
-- needed — old rows just have NULL until they're re-extracted under v2.
--
-- See EXTRACTION-ONE-SHOT-PLAN.md → "Source citations" section for the
-- design rationale (grounding, anti-hallucination, audit trail).

ALTER TABLE "minyan_rule"
  ADD COLUMN "source_quote" text;
