-- Migration 0005: shul_candidate + discovery_run for Places-seeded discovery
--
-- See FEATURES.md (future entry) and docs/discovery-targets.md.
--
-- shul_candidate: messy bucket of Places-returned candidates pending admin
-- triage. Once approved, an entry creates a real `shul` row via the existing
-- submission pipeline.
--
-- discovery_run: audit log for each Places API call so we can attribute
-- candidates back to a specific query + monitor cost.

CREATE TABLE IF NOT EXISTS "shul_candidate" (
  "id"                     SERIAL PRIMARY KEY,
  "place_id"               VARCHAR(128) NOT NULL UNIQUE,
  "name"                   TEXT NOT NULL,
  "formatted_address"      TEXT,
  "lat"                    DOUBLE PRECISION,
  "lng"                    DOUBLE PRECISION,
  "website_uri"            TEXT,
  "types"                  TEXT[],
  "source"                 TEXT NOT NULL,
  "source_detail"          TEXT,
  "discovery_target_name"  TEXT,
  "raw_response_jsonb"     JSONB NOT NULL,
  "review_status"          TEXT NOT NULL DEFAULT 'pending',
  "review_reason"          TEXT,
  "linked_shul_id"         INTEGER REFERENCES "shul"("id") ON DELETE SET NULL,
  "reviewed_at"            TIMESTAMPTZ,
  "reviewed_by"            TEXT,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "shul_candidate_review_idx"
  ON "shul_candidate" ("review_status");
CREATE INDEX IF NOT EXISTS "shul_candidate_target_idx"
  ON "shul_candidate" ("discovery_target_name");

CREATE TABLE IF NOT EXISTS "discovery_run" (
  "id"               SERIAL PRIMARY KEY,
  "target_name"      TEXT NOT NULL,
  "query_text"       TEXT NOT NULL,
  "center_lat"       DOUBLE PRECISION NOT NULL,
  "center_lng"       DOUBLE PRECISION NOT NULL,
  "radius_m"         INTEGER NOT NULL,
  "started_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "finished_at"      TIMESTAMPTZ,
  "result_count"     INTEGER,
  "candidates_new"   INTEGER,
  "candidates_dup"   INTEGER,
  "error"            TEXT
);

CREATE INDEX IF NOT EXISTS "discovery_run_target_idx"
  ON "discovery_run" ("target_name", "started_at" DESC);
