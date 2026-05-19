-- Migration 0012: partial UNIQUE INDEX on data_source(shul_id, identifier)
--
-- Follow-up to migration 0011 + the dedupe scripts. Prevents future
-- accidental duplicate (shul_id, identifier) rows at the DB level —
-- the persistence layer (lib/pipeline/persist-submission.ts) already
-- supersedes existing same-tuple sources on insert, but a DB constraint
-- is the belt to that suspenders.
--
-- Partial: `WHERE review_status <> 'rejected'`. Rejected rows are an
-- audit trail (incl. superseded losers from the dedupe scripts) and
-- can legitimately repeat the same (shul_id, identifier) over time.
-- The constraint only governs the LIVE set (pending + approved).
--
-- Prereqs that must have run against prod before applying:
--   1. scripts/dedupe-data-sources.ts     (the original approved+ok dedupe)
--   2. scripts/dedupe-cross-status.ts     (cross-status cleanup)
-- Both have run as of 2026-05-19; sanity query confirms 0 duplicate
-- (shul_id, identifier) tuples across non-rejected rows.

CREATE UNIQUE INDEX IF NOT EXISTS "data_source_shul_identifier_idx"
  ON "data_source" ("shul_id", "identifier")
  WHERE "review_status" <> 'rejected';
