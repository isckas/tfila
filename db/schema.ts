import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  smallint,
  real,
  doublePrecision,
  timestamp,
  date,
  jsonb,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

// ─── PostGIS GEOGRAPHY(Point, 4326) ──────────────────────────────────────
// Drizzle has no built-in PostGIS column type. We model it as a
// hex-encoded WKB string at the driver boundary; queries that need to
// project to/from {lat,lng} use SQL helpers (ST_MakePoint, ST_Y, ST_X).
export const geographyPoint = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return "geography(Point, 4326)";
  },
});

// ─── Enums ───────────────────────────────────────────────────────────────
// shul.status semantics (see DECISIONS.md "state-machine cleanup"):
//   pending_review — newly submitted, awaiting first extraction OR awaiting
//                    admin approval after broken/failed run
//   active         — at least one approved+ok data_source produces rules
//   archived       — admin-archived, hidden from public surfaces
//   unsupported    — cascade exhausted all tiers; admin can recover via
//                    /api/admin/shul/[id]/reset-status or a successful manual
//                    Extract Now (auto-flips back to pending_review)
//   broken         — DEPRECATED: no code path writes this. Reserved for
//                    backward compatibility with existing rows that may
//                    have this value. Reads should treat as equivalent to
//                    pending_review. Do not write new rows with this value.
export const shulStatusEnum = pgEnum("shul_status", [
  "pending_review",
  "active",
  "broken",
  "archived",
  "unsupported",
]);

export const dataSourceKindEnum = pgEnum("data_source_kind", [
  "shulcloud_website",
  "website_llm",
  "email_newsletter",
  "manual",
]);

export const dataSourceReviewEnum = pgEnum("data_source_review_status", [
  "pending",
  "approved",
  "rejected",
]);

export const dataSourceRunStatusEnum = pgEnum("data_source_run_status", [
  "ok",
  "no_change",
  "broken",
  "error",
]);

// Which tier of the extraction cascade produced the rules in this
// data_source. Persisted so weekly rescrapes skip straight to the
// known-good tier instead of re-running the whole cascade.
export const extractionStrategyEnum = pgEnum("extraction_strategy", [
  "html",
  "js_rendered",
  "pdf_document",
  "vision_image",
  "failed",
]);

export const tefillahEnum = pgEnum("tefillah", [
  "shacharis",
  "mincha",
  "maariv",
  "selichos",
  "neilah",
  "other",
]);

export const specialScheduleKindEnum = pgEnum("special_schedule_kind", [
  "regular",
  "yom_tov",
  "three_weeks",
  "aseres_yemei_teshuvah",
  "fast_day",
  "rosh_chodesh",
  "ad_hoc",
]);

// Lifecycle of a user-submitted "this time looks wrong" report (E-B5).
//   open      — newly reported, awaiting admin triage
//   resolved  — admin re-extracted / confirmed-and-fixed the times
//   dismissed — admin checked; the reported time was actually correct
export const timeReportStatusEnum = pgEnum("time_report_status", [
  "open",
  "resolved",
  "dismissed",
]);

// ─── shul ────────────────────────────────────────────────────────────────
export const shul = pgTable(
  "shul",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: text("name").notNull(),
    address: text("address"),
    location: geographyPoint("location"),
    timezone: varchar("timezone", { length: 64 }),
    nusach: varchar("nusach", { length: 32 }),
    submittedUrl: text("submitted_url"),
    contactEmail: text("contact_email"),
    // Registrable domain (eTLD+1) computed from submittedUrl OR from an
    // email_newsletter data_source's identifier. Used to dedupe new
    // submissions across both channels — same shul submitted as
    // `https://theshul.org` AND `https://www.theshul.org/calendar` AND
    // `gabbai@theshul.org` all collapse to one shul row with three
    // data_sources. Admin can split if the merge was wrong (e.g.
    // shared-hosting false positive).
    matchDomain: varchar("match_domain", { length: 253 }),
    status: shulStatusEnum("status").default("pending_review").notNull(),
    // Admin scratchpad — free text. Never rendered publicly. See
    // FEATURES.md "Admin notes per shul" + migration 0008.
    adminNotes: text("admin_notes"),
    adminNotesUpdatedBy: text("admin_notes_updated_by"),
    adminNotesUpdatedAt: timestamp("admin_notes_updated_at", {
      withTimezone: true,
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("shul_slug_idx").on(t.slug),
    index("shul_status_idx").on(t.status),
    index("shul_match_domain_idx").on(t.matchDomain),
    // GIST index on the geography column is created via raw SQL in the
    // migration file (see PR 1 migration). Drizzle's `using()` helper
    // doesn't yet support a geography-typed operator class cleanly.
  ],
);

// Single-use marker for magic-link tokens. INSERT on first use; the
// PRIMARY KEY conflict on replay tells us the token is spent. See
// migration 0009 + lib/auth.ts:consumeMagicLinkToken.
export const consumedMagicLink = pgTable(
  "consumed_magic_link",
  {
    tokenHash: text("token_hash").primaryKey(),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("consumed_magic_link_consumed_at_idx").on(t.consumedAt)],
);

// ─── data_source ─────────────────────────────────────────────────────────
// 1:N from shul. A shul can have multiple data sources (website, email,
// manual). When rules from different sources conflict, the higher
// `priority` wins (email > website > manual by convention).
export const dataSource = pgTable(
  "data_source",
  {
    id: serial("id").primaryKey(),
    shulId: integer("shul_id")
      .notNull()
      .references(() => shul.id, { onDelete: "cascade" }),
    kind: dataSourceKindEnum("kind").notNull(),
    identifier: text("identifier").notNull(),
    configJson: jsonb("config_json"),
    confidenceScore: real("confidence_score"),
    priority: integer("priority").default(50).notNull(),
    builtAt: timestamp("built_at", { withTimezone: true }),
    builtBy: varchar("built_by", { length: 16 }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
    lastRunStatus: dataSourceRunStatusEnum("last_run_status"),
    // Timestamp of the FIRST run in the current consecutive-broken streak.
    // Set when lastRunStatus transitions ok|null → broken|error. Cleared
    // (NULL) when status transitions back to ok. Powers the admin
    // "Broken since" badge + the weekly digest's NEW-vs-CHRONIC split.
    firstBrokenAt: timestamp("first_broken_at", { withTimezone: true }),
    lastRunDiffSummary: jsonb("last_run_diff_summary"),
    extractionStrategy: extractionStrategyEnum("extraction_strategy"),
    reviewStatus: dataSourceReviewEnum("review_status").default("pending").notNull(),
    reviewerNotes: text("reviewer_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("data_source_shul_idx").on(t.shulId),
    index("data_source_review_idx").on(t.reviewStatus, t.confidenceScore),
    // Partial UNIQUE INDEX (migration 0012): prevents two non-rejected
    // sources from sharing the same (shul_id, identifier) tuple. Rejected
    // rows (incl. superseded losers from the dedupe scripts) can legitimately
    // repeat the same tuple as audit trail.
    uniqueIndex("data_source_shul_identifier_idx")
      .on(t.shulId, t.identifier)
      .where(sql`${t.reviewStatus} <> 'rejected'`),
  ],
);

// ─── minyan_rule ─────────────────────────────────────────────────────────
// One rule = one (tefillah × applicability) combination at a shul.
// `time` is a tagged-union JSONB:
//   { kind: 'fixed',  clock: '07:00' }
//   { kind: 'zmanim', anchor: 'shkia' | 'tzeis_72' | 'alos' | 'netz' |
//                             'misheyakir' | 'sof_zman_tefillah',
//                     offsetMin: -18 }
export const minyanRule = pgTable(
  "minyan_rule",
  {
    id: serial("id").primaryKey(),
    shulId: integer("shul_id")
      .notNull()
      .references(() => shul.id, { onDelete: "cascade" }),
    dataSourceId: integer("data_source_id").references(() => dataSource.id, {
      onDelete: "set null",
    }),
    tefillah: tefillahEnum("tefillah").notNull(),
    tefillahLabel: text("tefillah_label"),
    daysOfWeek: smallint("days_of_week").array(),
    time: jsonb("time").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    specialScheduleKind: specialScheduleKindEnum("special_schedule_kind")
      .default("regular")
      .notNull(),
    priority: integer("priority").default(0).notNull(),
    nusach: varchar("nusach", { length: 32 }),
    notes: text("notes"),
    // Exact source text the rule was extracted from. Populated by the
    // v2 extraction pipeline (EXTRACTION-ONE-SHOT-PLAN); NULL for rules
    // extracted under v1. Used for admin audit trail (hover-tooltip on
    // each rule) and for the critique pass's "did the model invent
    // this rule?" check.
    sourceQuote: text("source_quote"),
    // Set true by admin manual-edit endpoints (/api/admin/rule/[id]/edit
    // + .../delete). The weekly rule-replacement step in scrape-one-shul
    // skips rows where this is true, so admin overrides survive across
    // re-extractions. Cleared back to false when the admin explicitly
    // resets the row via a "re-link to source" admin action.
    isManualEdit: boolean("is_manual_edit").default(false).notNull(),
    lastSeenInScrapeAt: timestamp("last_seen_in_scrape_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("minyan_rule_shul_idx").on(t.shulId),
    index("minyan_rule_resolve_idx").on(
      t.shulId,
      t.specialScheduleKind,
      t.priority,
    ),
    index("minyan_rule_live_idx").on(t.shulId, t.tefillah, t.deletedAt),
  ],
);

// ─── scrape_run ──────────────────────────────────────────────────────────
export const scrapeRun = pgTable(
  "scrape_run",
  {
    id: serial("id").primaryKey(),
    shulId: integer("shul_id")
      .notNull()
      .references(() => shul.id, { onDelete: "cascade" }),
    dataSourceId: integer("data_source_id")
      .notNull()
      .references(() => dataSource.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: dataSourceRunStatusEnum("status").notNull(),
    rulesAdded: integer("rules_added").default(0).notNull(),
    rulesRemoved: integer("rules_removed").default(0).notNull(),
    rulesChanged: integer("rules_changed").default(0).notNull(),
    error: text("error"),
    rawInputRef: text("raw_input_ref"),
  },
  (t) => [index("scrape_run_shul_idx").on(t.shulId, t.startedAt)],
);

// ─── time_report ─────────────────────────────────────────────────────────
// User-submitted "this minyan time looks wrong" reports (E-B5). The cheapest
// accuracy signal we have: a daven-er who's physically there notices a wrong
// time and taps a link on the shul page. Anonymous (no auth) — we keep only a
// SHA-256 of the reporter IP so we can dedupe one person spamming the same
// shul, never the raw IP. Reports are NOT auto-actioned: they surface in the
// admin cockpit (folded into the P4 redesign) and the admin decides whether
// to re-extract, so an anonymous tap can never trigger LLM spend on its own.
export const timeReport = pgTable(
  "time_report",
  {
    id: serial("id").primaryKey(),
    shulId: integer("shul_id")
      .notNull()
      .references(() => shul.id, { onDelete: "cascade" }),
    // Optional: the specific rule the reporter flagged. NULL when the report
    // is about the shul's schedule generally (the public UI reports per-shul
    // with a free-text note rather than per-rule, so this is usually NULL).
    minyanRuleId: integer("minyan_rule_id").references(() => minyanRule.id, {
      onDelete: "set null",
    }),
    // Free-text note from the reporter (e.g. "Mincha is 7:15 not 7:00"). Capped
    // at the API layer; column is unbounded text.
    note: text("note"),
    // SHA-256 of the reporter's IP (peppered). Never the raw IP. Used only for
    // the per-(shul, reporter, day) dedupe so one annoyed user can't create 50
    // identical rows. NULL if the IP couldn't be determined.
    reporterIpHash: varchar("reporter_ip_hash", { length: 64 }),
    status: timeReportStatusEnum("status").default("open").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Admin cockpit reads open reports per shul, newest first.
    index("time_report_shul_status_idx").on(t.shulId, t.status, t.createdAt),
  ],
);

// ─── Inferred types ──────────────────────────────────────────────────────
export type Shul = typeof shul.$inferSelect;
export type NewShul = typeof shul.$inferInsert;
export type DataSource = typeof dataSource.$inferSelect;
export type NewDataSource = typeof dataSource.$inferInsert;
export type MinyanRule = typeof minyanRule.$inferSelect;
export type NewMinyanRule = typeof minyanRule.$inferInsert;
export type ScrapeRun = typeof scrapeRun.$inferSelect;
export type NewScrapeRun = typeof scrapeRun.$inferInsert;
export type TimeReport = typeof timeReport.$inferSelect;
export type NewTimeReport = typeof timeReport.$inferInsert;

// ─── Tagged-union time helper types (for app code) ───────────────────────
export type MinyanTime =
  | { kind: "fixed"; clock: string } // "HH:MM"
  | {
      kind: "zmanim";
      anchor:
        | "shkia"
        | "tzeis_72"
        | "tzeis_42"
        | "alos"
        | "netz"
        | "misheyakir"
        | "sof_zman_tefillah_mga"
        | "sof_zman_tefillah_gra"
        | "sof_zman_shma_mga"
        | "sof_zman_shma_gra"
        | "chatzos"
        | "mincha_gedolah"
        | "plag_mincha"
        | "candle_lighting";
      offsetMin: number;
    };

// SQL helper for inserting a point: db.execute(sql`...${pointFromLatLng(lat, lng)}...`)
export function pointFromLatLng(lat: number, lng: number) {
  return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
}

// Drizzle's `jsonb` column type accepts `object` for insert. Our `time`
// column is a tagged union, which TS can't narrow to `object` without
// a cast. Each call site had `time as unknown as object`. This helper
// centralizes that cast and gives the call sites a self-documenting
// name. If we ever migrate to a stricter JSONB typing, this is the
// one place to update.
export function serializeMinyanTime(t: MinyanTime): object {
  return t as unknown as object;
}

// Reference the existing `sql` import for raw SQL needs.
export { sql };

// ─── shul_candidate ──────────────────────────────────────────────────────
// Messy bucket of Google-Places-returned candidates pending admin triage.
// Once approved, an entry creates a real shul row + queues extraction via
// the existing data-source.requested pipeline. Junk stays here forever
// with review_status='rejected' so re-runs filter it out automatically.
export const shulCandidate = pgTable(
  "shul_candidate",
  {
    id: serial("id").primaryKey(),
    placeId: varchar("place_id", { length: 128 }).notNull().unique(),
    name: text("name").notNull(),
    formattedAddress: text("formatted_address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    websiteUri: text("website_uri"),
    // Postgres text[] — Drizzle treats as array of strings.
    types: text("types").array(),
    source: text("source").notNull(),
    sourceDetail: text("source_detail"),
    discoveryTargetName: text("discovery_target_name"),
    rawResponseJsonb: jsonb("raw_response_jsonb").notNull(),
    // text (not a pgEnum) but guarded by a CHECK constraint at the DB level
    // (migration 0014, M17): one of pending|approved|rejected|duplicate|deferred.
    reviewStatus: text("review_status").notNull().default("pending"),
    reviewReason: text("review_reason"),
    linkedShulId: integer("linked_shul_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shul_candidate_review_idx").on(t.reviewStatus),
    index("shul_candidate_target_idx").on(t.discoveryTargetName),
  ],
);

// ─── discovery_run ───────────────────────────────────────────────────────
// Audit log: one row per Places API call. Lets us attribute candidates
// back to a specific query and monitor cost over time.
export const discoveryRun = pgTable("discovery_run", {
  id: serial("id").primaryKey(),
  targetName: text("target_name").notNull(),
  queryText: text("query_text").notNull(),
  centerLat: doublePrecision("center_lat").notNull(),
  centerLng: doublePrecision("center_lng").notNull(),
  radiusM: integer("radius_m").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  resultCount: integer("result_count"),
  candidatesNew: integer("candidates_new"),
  candidatesDup: integer("candidates_dup"),
  error: text("error"),
});
