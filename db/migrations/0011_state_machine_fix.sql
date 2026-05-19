-- Migration 0011: state-machine fix columns
--
-- Part of the duplicate-rules + state-machine fix bundle (see
-- docs/STATE-MACHINE-FIX-PLAN.md).
--
-- 1. minyan_rule.is_manual_edit — when true, the weekly cron's
--    rule-replacement step skips this row so admin edits survive
--    re-extractions. Default false. Set true by the manual edit/delete
--    endpoints in app/api/admin/rule/[id]/.
--
-- 2. data_source.first_broken_at — timestamp of the first run in the
--    current consecutive-broken streak. Set when last_run_status
--    transitions ok|null → broken|error. Cleared (NULL) on transition
--    back to ok. Powers admin "Broken since N days" badge + weekly
--    digest NEW-vs-CHRONIC split.
--
-- Both additive nullable/defaulted; no backfill required. Existing
-- rows: is_manual_edit defaults to false; first_broken_at stays NULL
-- (interpreted as "broken streak start unknown" — the writer back-fills
-- on next status transition).
--
-- DEFERRED to a follow-up migration: UNIQUE INDEX on
-- data_source(shul_id, identifier). That requires scripts/dedupe-data-sources.ts
-- to run first against prod to clean up the 7 current duplicate pairs.

ALTER TABLE "minyan_rule"
  ADD COLUMN "is_manual_edit" boolean DEFAULT false NOT NULL;

ALTER TABLE "data_source"
  ADD COLUMN "first_broken_at" timestamp with time zone;
