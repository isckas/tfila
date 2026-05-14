-- Migration 0006: add 'no_url' to shul_status enum
--
-- Used by the discovery flow when a candidate is approved but Places
-- didn't return a website_uri AND the admin didn't paste one. The shul
-- row exists for tracking (name + address + lat/lng) but is excluded
-- from all public queries — tfila.co only publishes live, non-stale
-- minyan times, so a no-times row would be misleading.
--
-- Pulling out of no_url: admin opens /admin/shul/[slug], pastes the
-- URL into the Source URL field, clicks Extract now → if extraction
-- succeeds, status flips to pending_review for rule approval.

ALTER TYPE "shul_status" ADD VALUE IF NOT EXISTS 'no_url';
