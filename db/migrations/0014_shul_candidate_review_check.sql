-- Migration 0014: CHECK constraint on shul_candidate.review_status (M17).
--
-- The column is unconstrained `text` (vs data_source.review_status's pgEnum),
-- so a typo or code drift could land a junk status with no DB guard. A CHECK
-- is the lightweight fix — less invasive than a text→enum conversion (no type
-- rewrite, no risk of failing on an unexpected existing value). Covers every
-- value the code writes (pending/approved/rejected/duplicate) plus the legacy
-- `deferred` (kept for any old rows; the pill was already dropped from the UI).
--
-- Additive + non-destructive. Verified before applying: live values are only
-- pending/approved/rejected, all of which satisfy the constraint.

ALTER TABLE "shul_candidate"
  DROP CONSTRAINT IF EXISTS "shul_candidate_review_status_check";

ALTER TABLE "shul_candidate"
  ADD CONSTRAINT "shul_candidate_review_status_check"
  CHECK ("review_status" IN ('pending', 'approved', 'rejected', 'duplicate', 'deferred'));
