-- Migration 0004: shul.match_domain for dedup across submission channels
--
-- See FEATURES.md "Deduplication: same shul, different submissions"
-- (Option A: registrable-domain dedup via tldts).
--
-- Adds the column + an index. Backfill is done in a separate Node
-- script (scripts/backfill-match-domain.ts) because the eTLD+1
-- computation needs the tldts library, which we don't want to embed
-- in raw SQL.

ALTER TABLE "shul"
  ADD COLUMN "match_domain" varchar(253);

CREATE INDEX IF NOT EXISTS "shul_match_domain_idx"
  ON "shul" ("match_domain");
