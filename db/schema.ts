import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  smallint,
  real,
  timestamp,
  date,
  jsonb,
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
export const shulStatusEnum = pgEnum("shul_status", [
  "pending_review",
  "active",
  "broken",
  "archived",
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
    status: shulStatusEnum("status").default("pending_review").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("shul_slug_idx").on(t.slug),
    index("shul_status_idx").on(t.status),
    // GIST index on the geography column is created via raw SQL in the
    // migration file (see PR 1 migration). Drizzle's `using()` helper
    // doesn't yet support a geography-typed operator class cleanly.
  ],
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
    lastRunDiffSummary: jsonb("last_run_diff_summary"),
    reviewStatus: dataSourceReviewEnum("review_status").default("pending").notNull(),
    reviewerNotes: text("reviewer_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("data_source_shul_idx").on(t.shulId),
    index("data_source_review_idx").on(t.reviewStatus, t.confidenceScore),
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

// ─── Inferred types ──────────────────────────────────────────────────────
export type Shul = typeof shul.$inferSelect;
export type NewShul = typeof shul.$inferInsert;
export type DataSource = typeof dataSource.$inferSelect;
export type NewDataSource = typeof dataSource.$inferInsert;
export type MinyanRule = typeof minyanRule.$inferSelect;
export type NewMinyanRule = typeof minyanRule.$inferInsert;
export type ScrapeRun = typeof scrapeRun.$inferSelect;
export type NewScrapeRun = typeof scrapeRun.$inferInsert;

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

// Reference the existing `sql` import for raw SQL needs.
export { sql };
