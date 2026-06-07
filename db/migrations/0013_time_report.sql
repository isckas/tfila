-- Migration 0013: time_report — user "this time looks wrong" reports (E-B5).
--
-- The cheapest accuracy signal: a daven-er who's physically at the shul taps
-- "Report a wrong time" on the shul page. Anonymous (no auth); we store only a
-- SHA-256 of the reporter IP to dedupe one person spamming the same shul.
--
-- Reports are NEVER auto-actioned — they surface in the admin cockpit (P4) and
-- the admin decides whether to re-extract, so an anonymous tap can't trigger
-- LLM spend. Additive + non-destructive (CREATE only); safe to apply to prod.

DO $$ BEGIN
  CREATE TYPE "time_report_status" AS ENUM ('open', 'resolved', 'dismissed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "time_report" (
  "id"               serial PRIMARY KEY,
  "shul_id"          integer NOT NULL REFERENCES "shul"("id") ON DELETE CASCADE,
  "minyan_rule_id"   integer REFERENCES "minyan_rule"("id") ON DELETE SET NULL,
  "note"             text,
  "reporter_ip_hash" varchar(64),
  "status"           "time_report_status" NOT NULL DEFAULT 'open',
  "resolved_at"      timestamptz,
  "resolved_by"      text,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "time_report_shul_status_idx"
  ON "time_report" ("shul_id", "status", "created_at");
