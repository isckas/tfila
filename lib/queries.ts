import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { dataSource, minyanRule, scrapeRun, shul, type MinyanTime } from "../db/schema";

// ─── Davener-facing reads ────────────────────────────────────────────────

export async function listActiveShuls() {
  return db
    .select({
      id: shul.id,
      slug: shul.slug,
      name: shul.name,
      address: shul.address,
      nusach: shul.nusach,
    })
    .from(shul)
    .where(eq(shul.status, "active"))
    .orderBy(asc(shul.name));
}

export async function getShulBySlug(slug: string) {
  const rows = await db
    .select({
      id: shul.id,
      slug: shul.slug,
      name: shul.name,
      address: shul.address,
      timezone: shul.timezone,
      nusach: shul.nusach,
      submittedUrl: shul.submittedUrl,
      contactEmail: shul.contactEmail,
      status: shul.status,
      // Project location to {lat, lng} via PostGIS at read time.
      lat: sql<number | null>`ST_Y(${shul.location}::geometry)`.as("lat"),
      lng: sql<number | null>`ST_X(${shul.location}::geometry)`.as("lng"),
    })
    .from(shul)
    .where(eq(shul.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLiveRulesForShul(shulId: number) {
  return db
    .select()
    .from(minyanRule)
    .where(and(eq(minyanRule.shulId, shulId), isNull(minyanRule.deletedAt)))
    .orderBy(
      desc(minyanRule.priority),
      asc(minyanRule.tefillah),
      asc(minyanRule.validFrom),
    );
}

/**
 * Rules visible to the PUBLIC for a shul. Excludes rules from
 * data_sources with `review_status='rejected'`. Rules from sources
 * with `review_status='pending'` are included — better to show low-
 * signal data than nothing, especially during pre-approval window.
 */
export async function getPublicRulesForShul(shulId: number) {
  return db
    .select({
      id: minyanRule.id,
      shulId: minyanRule.shulId,
      dataSourceId: minyanRule.dataSourceId,
      tefillah: minyanRule.tefillah,
      tefillahLabel: minyanRule.tefillahLabel,
      daysOfWeek: minyanRule.daysOfWeek,
      time: minyanRule.time,
      validFrom: minyanRule.validFrom,
      validTo: minyanRule.validTo,
      specialScheduleKind: minyanRule.specialScheduleKind,
      priority: minyanRule.priority,
      nusach: minyanRule.nusach,
      notes: minyanRule.notes,
    })
    .from(minyanRule)
    .leftJoin(dataSource, eq(dataSource.id, minyanRule.dataSourceId))
    .where(
      and(
        eq(minyanRule.shulId, shulId),
        isNull(minyanRule.deletedAt),
        sql`(${dataSource.id} IS NULL OR ${dataSource.reviewStatus} <> 'rejected')`,
      ),
    )
    .orderBy(
      desc(minyanRule.priority),
      asc(minyanRule.tefillah),
      asc(minyanRule.validFrom),
    );
}

// ─── Admin-facing reads ──────────────────────────────────────────────────

export async function listPendingDataSources() {
  return db
    .select({
      id: dataSource.id,
      shulId: dataSource.shulId,
      shulName: shul.name,
      kind: dataSource.kind,
      identifier: dataSource.identifier,
      confidenceScore: dataSource.confidenceScore,
      builtAt: dataSource.builtAt,
      builtBy: dataSource.builtBy,
    })
    .from(dataSource)
    .innerJoin(shul, eq(shul.id, dataSource.shulId))
    .where(eq(dataSource.reviewStatus, "pending"))
    .orderBy(asc(dataSource.confidenceScore), asc(dataSource.builtAt));
}

export async function listRejectedDataSources() {
  return db
    .select({
      id: dataSource.id,
      shulId: dataSource.shulId,
      shulSlug: shul.slug,
      shulName: shul.name,
      kind: dataSource.kind,
      identifier: dataSource.identifier,
      confidenceScore: dataSource.confidenceScore,
      builtAt: dataSource.builtAt,
      builtBy: dataSource.builtBy,
      reviewerNotes: dataSource.reviewerNotes,
      updatedAt: dataSource.updatedAt,
    })
    .from(dataSource)
    .innerJoin(shul, eq(shul.id, dataSource.shulId))
    .where(eq(dataSource.reviewStatus, "rejected"))
    .orderBy(desc(dataSource.updatedAt));
}

export async function getDataSourceById(id: number) {
  const rows = await db
    .select()
    .from(dataSource)
    .where(eq(dataSource.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** All data needed to render /admin/shul/[slug]. */
export async function getShulForAdmin(slug: string) {
  const shulRows = await db.select().from(shul).where(eq(shul.slug, slug)).limit(1);
  const s = shulRows[0];
  if (!s) return null;

  const sources = await db
    .select({
      id: dataSource.id,
      kind: dataSource.kind,
      identifier: dataSource.identifier,
      reviewStatus: dataSource.reviewStatus,
      confidenceScore: dataSource.confidenceScore,
      priority: dataSource.priority,
      builtAt: dataSource.builtAt,
      builtBy: dataSource.builtBy,
      lastRunAt: dataSource.lastRunAt,
      lastRunStatus: dataSource.lastRunStatus,
      extractionStrategy: dataSource.extractionStrategy,
      configJson: dataSource.configJson,
    })
    .from(dataSource)
    .where(eq(dataSource.shulId, s.id))
    .orderBy(desc(dataSource.priority), desc(dataSource.builtAt));

  // Project lat/lng if location is set
  const geo = await db.execute<{ lat: number | null; lng: number | null }>(sql`
    SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM shul WHERE id = ${s.id}
  `);
  const point = geo.rows[0];

  return {
    shul: { ...s, lat: point?.lat ?? null, lng: point?.lng ?? null },
    dataSources: sources,
  };
}

/**
 * All active shuls' lightweight payload, used by the home-page
 * Look-up card for client-side fuzzy matching. Small enough to
 * inline in the SSR HTML (~50 bytes per shul × ~150 shuls).
 */
export async function listShulsForLookup() {
  return db
    .select({
      slug: shul.slug,
      name: shul.name,
      address: shul.address,
    })
    .from(shul)
    .where(eq(shul.status, "active"))
    .orderBy(asc(shul.name));
}

/** Public free-text search across shul name/slug. Active shuls only. */
export async function searchActiveShuls(q: string, limit = 30) {
  const pattern = `%${q.trim()}%`;
  if (!q.trim()) return [];
  return db
    .select({
      id: shul.id,
      slug: shul.slug,
      name: shul.name,
      address: shul.address,
    })
    .from(shul)
    .where(
      and(
        eq(shul.status, "active"),
        sql`(${shul.name} ILIKE ${pattern} OR ${shul.slug} ILIKE ${pattern})`,
      ),
    )
    .orderBy(asc(shul.name))
    .limit(limit);
}

/** Latest scrape_run rows for a shul (audit history). */
export async function getRecentScrapeRunsForShul(shulId: number, limit = 20) {
  return db
    .select()
    .from(scrapeRun)
    .where(eq(scrapeRun.shulId, shulId))
    .orderBy(desc(scrapeRun.startedAt))
    .limit(limit);
}

/** Full review payload: data_source + the shul it belongs to + every
 *  live rule under this data_source. */
export async function getDataSourceForReview(id: number) {
  const dsRows = await db
    .select({
      id: dataSource.id,
      shulId: dataSource.shulId,
      kind: dataSource.kind,
      identifier: dataSource.identifier,
      configJson: dataSource.configJson,
      confidenceScore: dataSource.confidenceScore,
      priority: dataSource.priority,
      builtAt: dataSource.builtAt,
      builtBy: dataSource.builtBy,
      lastRunAt: dataSource.lastRunAt,
      lastRunStatus: dataSource.lastRunStatus,
      reviewStatus: dataSource.reviewStatus,
      reviewerNotes: dataSource.reviewerNotes,
    })
    .from(dataSource)
    .where(eq(dataSource.id, id))
    .limit(1);
  const ds = dsRows[0];
  if (!ds) return null;

  const shulRows = await db
    .select({
      id: shul.id,
      slug: shul.slug,
      name: shul.name,
      address: shul.address,
      status: shul.status,
      contactEmail: shul.contactEmail,
      submittedUrl: shul.submittedUrl,
      timezone: shul.timezone,
      nusach: shul.nusach,
    })
    .from(shul)
    .where(eq(shul.id, ds.shulId))
    .limit(1);
  const shulRow = shulRows[0];

  const rules = await db
    .select()
    .from(minyanRule)
    .where(and(eq(minyanRule.dataSourceId, id), isNull(minyanRule.deletedAt)))
    .orderBy(asc(minyanRule.tefillah), asc(minyanRule.id));

  return { dataSource: ds, shul: shulRow, rules };
}

// ─── Counters (used in admin landing / health) ───────────────────────────

export async function countByShulStatus() {
  return db
    .select({ status: shul.status, n: sql<number>`COUNT(*)::int` })
    .from(shul)
    .groupBy(shul.status);
}

// ─── Admin shul listing (with search + status filter) ────────────────────

export interface AdminShulRow {
  id: number;
  slug: string;
  name: string;
  status: string;
  address: string | null;
  contactEmail: string | null;
  submittedUrl: string | null;
  submittedAt: Date;
  dataSourceCount: number;
  liveRuleCount: number;
  primaryDataSourceId: number | null;
  primaryDataSourceReview: string | null;
}

export async function listAdminShuls(opts: {
  q?: string | null;
  status?: string | null;
  limit?: number;
}): Promise<AdminShulRow[]> {
  const q = opts.q?.trim();
  const status = opts.status?.trim();
  const limit = opts.limit ?? 200;

  // Compose the WHERE clause with Drizzle sql-template parameter
  // binding. Per-shul aggregates via LATERAL joins keep this a single
  // round-trip even for the search/filter combinations.
  let where = sql`1=1`;
  if (q) {
    const pattern = `%${q}%`;
    where = sql`${where} AND (s.name ILIKE ${pattern} OR s.slug ILIKE ${pattern})`;
  }
  if (status) {
    where = sql`${where} AND s.status = ${status}::shul_status`;
  }

  const res = await db.execute<{
    id: number;
    slug: string;
    name: string;
    status: string;
    address: string | null;
    contact_email: string | null;
    submitted_url: string | null;
    submitted_at: Date;
    data_source_count: number;
    live_rule_count: number;
    primary_data_source_id: number | null;
    primary_data_source_review: string | null;
  }>(sql`
    SELECT
      s.id, s.slug, s.name, s.status::text AS status, s.address, s.contact_email,
      s.submitted_url, s.submitted_at,
      COALESCE(ds_agg.cnt, 0)::int AS data_source_count,
      COALESCE(rule_agg.cnt, 0)::int AS live_rule_count,
      ds_top.id AS primary_data_source_id,
      ds_top.review_status::text AS primary_data_source_review
    FROM shul s
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt FROM data_source WHERE shul_id = s.id
    ) ds_agg ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt FROM minyan_rule
      WHERE shul_id = s.id AND deleted_at IS NULL
    ) rule_agg ON true
    LEFT JOIN LATERAL (
      SELECT id, review_status FROM data_source
       WHERE shul_id = s.id
       ORDER BY priority DESC, built_at DESC NULLS LAST, id DESC
       LIMIT 1
    ) ds_top ON true
    WHERE ${where}
    ORDER BY s.submitted_at DESC
    LIMIT ${limit}
  `);

  return res.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    address: r.address,
    contactEmail: r.contact_email,
    submittedUrl: r.submitted_url,
    submittedAt: r.submitted_at,
    dataSourceCount: Number(r.data_source_count),
    liveRuleCount: Number(r.live_rule_count),
    primaryDataSourceId: r.primary_data_source_id,
    primaryDataSourceReview: r.primary_data_source_review,
  }));
}

// ─── Davener home feed ───────────────────────────────────────────────────

export interface NearbyShulRule {
  shulId: number;
  slug: string;
  name: string;
  address: string | null;
  timezone: string | null;
  nusach: string | null;
  lat: number;
  lng: number;
  distanceMeters: number;
  ruleId: number;
  tefillah: string;
  tefillahLabel: string | null;
  daysOfWeek: number[] | null;
  time: MinyanTime;
  specialScheduleKind: string;
  priority: number;
  validFrom: string | null;
  validTo: string | null;
  ruleNusach: string | null;
  notes: string | null;
}

/**
 * Returns every (shul, live minyan_rule) within `radiusMeters` of the given
 * point. Only shuls with status='active' and rules with deleted_at IS NULL
 * are returned. Rules from data_sources whose review_status is 'rejected'
 * are excluded; 'pending' rules are still shown (low signal vs. blank).
 *
 * Filtering by date/time and special-schedule resolution happens in app
 * code after this query — keeps the SQL stable and the rule-resolution
 * algorithm testable.
 */
export async function getNearbyShulsWithRules(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
): Promise<NearbyShulRule[]> {
  const point = sql`ST_SetSRID(ST_MakePoint(${centerLng}, ${centerLat}), 4326)::geography`;

  const rows = await db.execute<{
    shul_id: number;
    slug: string;
    name: string;
    address: string | null;
    timezone: string | null;
    nusach: string | null;
    lat: number;
    lng: number;
    distance_meters: number;
    rule_id: number;
    tefillah: string;
    tefillah_label: string | null;
    days_of_week: number[] | null;
    time: MinyanTime;
    special_schedule_kind: string;
    priority: number;
    valid_from: string | null;
    valid_to: string | null;
    rule_nusach: string | null;
    notes: string | null;
  }>(sql`
    SELECT
      s.id AS shul_id,
      s.slug,
      s.name,
      s.address,
      s.timezone,
      s.nusach,
      ST_Y(s.location::geometry) AS lat,
      ST_X(s.location::geometry) AS lng,
      ST_Distance(s.location, ${point}) AS distance_meters,
      mr.id AS rule_id,
      mr.tefillah,
      mr.tefillah_label,
      mr.days_of_week,
      mr.time,
      mr.special_schedule_kind,
      mr.priority,
      mr.valid_from,
      mr.valid_to,
      mr.nusach AS rule_nusach,
      mr.notes
    FROM shul s
    JOIN minyan_rule mr ON mr.shul_id = s.id
    LEFT JOIN data_source ds ON ds.id = mr.data_source_id
    WHERE s.status = 'active'
      AND s.location IS NOT NULL
      AND mr.deleted_at IS NULL
      AND (ds.id IS NULL OR ds.review_status <> 'rejected')
      AND ST_DWithin(s.location, ${point}, ${radiusMeters})
    ORDER BY distance_meters ASC, mr.priority DESC, mr.id ASC
  `);

  return rows.rows.map((r) => ({
    shulId: r.shul_id,
    slug: r.slug,
    name: r.name,
    address: r.address,
    timezone: r.timezone,
    nusach: r.nusach,
    lat: Number(r.lat),
    lng: Number(r.lng),
    distanceMeters: Number(r.distance_meters),
    ruleId: r.rule_id,
    tefillah: r.tefillah,
    tefillahLabel: r.tefillah_label,
    daysOfWeek: r.days_of_week,
    time: r.time,
    specialScheduleKind: r.special_schedule_kind,
    priority: r.priority,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    ruleNusach: r.rule_nusach,
    notes: r.notes,
  }));
}
