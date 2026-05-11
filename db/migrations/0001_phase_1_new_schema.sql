-- ============================================================
-- PR 1 — new schema for Phase 1 ("next minyan near me" pivot)
-- Creates the new tables alongside the sprint-1 tables (no
-- conflicts since names differ: `shul` vs `shuls`, etc).
-- A separate data-migration script copies sprint-1 rows into
-- the new shape. After review, `0002_drop_sprint1.sql` will
-- remove the old tables + enums.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── Enums ────────────────────────────────────────────────────
CREATE TYPE shul_status AS ENUM (
  'pending_review', 'active', 'broken', 'archived'
);

CREATE TYPE data_source_kind AS ENUM (
  'shulcloud_website', 'website_llm', 'email_newsletter', 'manual'
);

CREATE TYPE data_source_review_status AS ENUM (
  'pending', 'approved', 'rejected'
);

CREATE TYPE data_source_run_status AS ENUM (
  'ok', 'no_change', 'broken', 'error'
);

CREATE TYPE tefillah AS ENUM (
  'shacharis', 'mincha', 'maariv', 'selichos', 'neilah', 'other'
);

CREATE TYPE special_schedule_kind AS ENUM (
  'regular', 'yom_tov', 'three_weeks', 'aseres_yemei_teshuvah',
  'fast_day', 'rosh_chodesh', 'ad_hoc'
);

-- ─── shul ─────────────────────────────────────────────────────
CREATE TABLE shul (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(120) NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  location GEOGRAPHY(Point, 4326),
  timezone VARCHAR(64),
  nusach VARCHAR(32),
  submitted_url TEXT,
  contact_email TEXT,
  status shul_status NOT NULL DEFAULT 'pending_review',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX shul_slug_idx ON shul (slug);
CREATE INDEX shul_status_idx ON shul (status);
CREATE INDEX shul_location_gix ON shul USING GIST (location);

-- ─── data_source ──────────────────────────────────────────────
CREATE TABLE data_source (
  id SERIAL PRIMARY KEY,
  shul_id INTEGER NOT NULL REFERENCES shul(id) ON DELETE CASCADE,
  kind data_source_kind NOT NULL,
  identifier TEXT NOT NULL,
  config_json JSONB,
  confidence_score REAL,
  priority INTEGER NOT NULL DEFAULT 50,
  built_at TIMESTAMPTZ,
  built_by VARCHAR(16),
  last_run_at TIMESTAMPTZ,
  last_received_at TIMESTAMPTZ,
  last_run_status data_source_run_status,
  last_run_diff_summary JSONB,
  review_status data_source_review_status NOT NULL DEFAULT 'pending',
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX data_source_shul_idx ON data_source (shul_id);
CREATE INDEX data_source_review_idx ON data_source (review_status, confidence_score);

-- ─── minyan_rule ──────────────────────────────────────────────
CREATE TABLE minyan_rule (
  id SERIAL PRIMARY KEY,
  shul_id INTEGER NOT NULL REFERENCES shul(id) ON DELETE CASCADE,
  data_source_id INTEGER REFERENCES data_source(id) ON DELETE SET NULL,
  tefillah tefillah NOT NULL,
  tefillah_label TEXT,
  days_of_week SMALLINT[],
  time JSONB NOT NULL,
  valid_from DATE,
  valid_to DATE,
  special_schedule_kind special_schedule_kind NOT NULL DEFAULT 'regular',
  priority INTEGER NOT NULL DEFAULT 0,
  nusach VARCHAR(32),
  notes TEXT,
  last_seen_in_scrape_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX minyan_rule_shul_idx ON minyan_rule (shul_id);
CREATE INDEX minyan_rule_resolve_idx ON minyan_rule (shul_id, special_schedule_kind, priority);
CREATE INDEX minyan_rule_live_idx ON minyan_rule (shul_id, tefillah, deleted_at);

-- ─── scrape_run ───────────────────────────────────────────────
CREATE TABLE scrape_run (
  id SERIAL PRIMARY KEY,
  shul_id INTEGER NOT NULL REFERENCES shul(id) ON DELETE CASCADE,
  data_source_id INTEGER NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status data_source_run_status NOT NULL,
  rules_added INTEGER NOT NULL DEFAULT 0,
  rules_removed INTEGER NOT NULL DEFAULT 0,
  rules_changed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  raw_input_ref TEXT
);

CREATE INDEX scrape_run_shul_idx ON scrape_run (shul_id, started_at);
