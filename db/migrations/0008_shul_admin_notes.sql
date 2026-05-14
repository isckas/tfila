-- Migration 0008: shul.admin_notes scratchpad
--
-- See FEATURES.md "Admin notes per shul". Free-text field on each
-- shul for institutional knowledge that doesn't fit any structured
-- column ("moved domains in March", "gabbai responds via email
-- only", etc.). Admin-only — never rendered on public surfaces.
--
-- Three columns: the text itself + last-edited-by + last-edited-at
-- so admins can see who jotted what when. No history retention;
-- save replaces the value (last-write-wins).

ALTER TABLE "shul"
  ADD COLUMN "admin_notes" text,
  ADD COLUMN "admin_notes_updated_by" text,
  ADD COLUMN "admin_notes_updated_at" timestamptz;
