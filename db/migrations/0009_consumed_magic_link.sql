-- Migration 0009: consumed_magic_link table for single-use tokens
--
-- See FEATURES.md "no-stale-data" doc and the code review finding about
-- magic-link replay. Tokens are valid for 15 min after issue, but with
-- no consumed-marker an intercepted token (leaked via referrer, email
-- forwarding, or browser history) could be replayed for up to 15 min.
--
-- We store the SHA-256 of the consumed token (not the token itself) so
-- a DB read can't impersonate. The verify-link route INSERTs on first
-- use; the conflict on subsequent attempts means the token is already
-- spent and we reject.
--
-- Cleanup: rows live until the token's exp + a buffer. A periodic job
-- can DELETE rows older than ~1 hour; for now they accumulate at the
-- rate of admin sign-ins (single-digit per day).

CREATE TABLE "consumed_magic_link" (
  "token_hash" text PRIMARY KEY,
  "consumed_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX "consumed_magic_link_consumed_at_idx"
  ON "consumed_magic_link" ("consumed_at");
