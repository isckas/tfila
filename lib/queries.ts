import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { dataSource, minyanRule, scrapeRun, shul, type MinyanTime } from "../db/schema";

// ─── Davener-facing reads ────────────────────────────────────────────────
//
// All public-facing reads gate on the FEATURES.md "no stale data" rule:
// only shuls with at least one data_source whose last successful run is
// within STALE_THRESHOLD_DAYS (14) appear publicly. The threshold lives
// in lib/freshness.ts; the SQL fragment is inlined per query for clarity.

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
    .where(
      and(
        eq(shul.status, "active"),
        sql`EXISTS (
          SELECT 1 FROM data_source ds_fresh
          WHERE ds_fresh.shul_id = ${shul.id}
            AND ds_fresh.last_run_status IN ('ok', 'no_change')
            AND ds_fresh.review_status = 'approved'
            AND COALESCE(ds_fresh.last_received_at, ds_fresh.last_run_at) >=
                NOW() - INTERVAL '14 days'
        )`,
      ),
    )
    .orderBy(asc(shul.name));
}

/**
 * Most recent successful (ok / no_change) scrape timestamp across
 * any active data_source for a shul. Used on the public shul page
 * to display a "last updated" freshness signal. Returns null when no
 * scrape has ever succeeded.
 */
export async function getMostRecentScrapeForShul(
  shulId: number,
): Promise<Date | null> {
  const rows = await db
    .select({ lastRunAt: dataSource.lastRunAt })
    .from(dataSource)
    .where(
      and(
        eq(dataSource.shulId, shulId),
        sql`${dataSource.lastRunStatus} IN ('ok', 'no_change')`,
        sql`${dataSource.lastRunAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(dataSource.lastRunAt))
    .limit(1);
  return rows[0]?.lastRunAt ?? null;
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
 *
 * **Rule-level dedup**: when the same shul has multiple approved data_sources
 * with identical (tefillah, time, days_of_week, special_schedule_kind,
 * valid_from, valid_to) rows, only one wins. Winner: data_source.priority
 * DESC, data_source.last_run_at DESC NULLS LAST, rule.id DESC. Unique rules
 * from a loser source are preserved (no conflict → both shown). Matches
 * SCOPE.md "Email > website priority, rule-level conflict resolution".
 */
export async function getPublicRulesForShul(shulId: number) {
  const rows = await db.execute<{
    id: number;
    shul_id: number;
    data_source_id: number | null;
    tefillah: string;
    tefillah_label: string | null;
    days_of_week: number[] | null;
    time: MinyanTime;
    valid_from: string | null;
    valid_to: string | null;
    special_schedule_kind: string;
    priority: number;
    nusach: string | null;
    notes: string | null;
  }>(sql`
    WITH ranked AS (
      SELECT
        mr.id, mr.shul_id, mr.data_source_id, mr.tefillah, mr.tefillah_label,
        mr.days_of_week, mr.time, mr.valid_from, mr.valid_to,
        mr.special_schedule_kind, mr.priority, mr.nusach, mr.notes,
        ROW_NUMBER() OVER (
          PARTITION BY
            mr.shul_id, mr.tefillah, mr.time::text,
            -- Normalize array order before stringifying — the LLM extractor
            -- is non-deterministic across runs (cascade tier swaps, prompt
            -- evolution), so [1,2,3] and [3,2,1] are semantically the same
            -- minyan but would otherwise hash to different partitions and
            -- defeat the dedup.
            COALESCE(
              (SELECT array_agg(d ORDER BY d)::text
                 FROM unnest(mr.days_of_week) AS d), ''),
            mr.special_schedule_kind,
            COALESCE(mr.valid_from::text, ''),
            COALESCE(mr.valid_to::text, '')
          ORDER BY
            -- Manual admin edits win over extraction-generated rows when
            -- they collide on fingerprint. Admin override is durable.
            mr.is_manual_edit DESC,
            COALESCE(ds.priority, 0) DESC,
            ds.last_run_at DESC NULLS LAST,
            mr.data_source_id DESC NULLS LAST,
            mr.id DESC
        ) AS rn
      FROM minyan_rule mr
      LEFT JOIN data_source ds ON ds.id = mr.data_source_id
      WHERE mr.shul_id = ${shulId}
        AND mr.deleted_at IS NULL
        AND (ds.id IS NULL OR ds.review_status <> 'rejected')
    )
    SELECT id, shul_id, data_source_id, tefillah, tefillah_label, days_of_week,
           time, valid_from, valid_to, special_schedule_kind, priority,
           nusach, notes
      FROM ranked
     WHERE rn = 1
     ORDER BY priority DESC, tefillah ASC, valid_from ASC NULLS LAST
  `);

  return rows.rows.map((r) => ({
    id: r.id,
    shulId: r.shul_id,
    dataSourceId: r.data_source_id,
    tefillah: r.tefillah,
    tefillahLabel: r.tefillah_label,
    daysOfWeek: r.days_of_week,
    time: r.time,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    specialScheduleKind: r.special_schedule_kind,
    priority: r.priority,
    nusach: r.nusach,
    notes: r.notes,
  }));
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
      reviewerNotes: dataSource.reviewerNotes,
      confidenceScore: dataSource.confidenceScore,
      priority: dataSource.priority,
      builtAt: dataSource.builtAt,
      builtBy: dataSource.builtBy,
      lastRunAt: dataSource.lastRunAt,
      lastRunStatus: dataSource.lastRunStatus,
      firstBrokenAt: dataSource.firstBrokenAt,
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
 * Look-up card for client-side fuzzy matching. Gated on freshness so
 * stale shuls don't appear in the typeahead.
 */
export async function listShulsForLookup() {
  return db
    .select({
      slug: shul.slug,
      name: shul.name,
      address: shul.address,
    })
    .from(shul)
    .where(
      and(
        eq(shul.status, "active"),
        sql`EXISTS (
          SELECT 1 FROM data_source ds_fresh
          WHERE ds_fresh.shul_id = ${shul.id}
            AND ds_fresh.last_run_status IN ('ok', 'no_change')
            AND ds_fresh.review_status = 'approved'
            AND COALESCE(ds_fresh.last_received_at, ds_fresh.last_run_at) >=
                NOW() - INTERVAL '14 days'
        )`,
      ),
    )
    .orderBy(asc(shul.name));
}

/** Public free-text search across shul name/slug. Active + fresh shuls only. */
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
        sql`EXISTS (
          SELECT 1 FROM data_source ds_fresh
          WHERE ds_fresh.shul_id = ${shul.id}
            AND ds_fresh.last_run_status IN ('ok', 'no_change')
            AND ds_fresh.review_status = 'approved'
            AND COALESCE(ds_fresh.last_received_at, ds_fresh.last_run_at) >=
                NOW() - INTERVAL '14 days'
        )`,
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
  /**
   * Most recent successful data_source verification timestamp across
   * all of this shul's data_sources. NULL = never had a successful run.
   * Drives the green/amber/red freshness pill (lib/freshness.ts).
   */
  lastFreshAt: Date | null;
  /**
   * Earliest first_broken_at across this shul's broken/failed
   * data_sources. NULL = no source is currently in a broken streak.
   * Powers the admin Broken inbox "Broken since N days ago" badge
   * (Fix S) and the weekly digest's NEW-vs-CHRONIC split.
   */
  firstBrokenAt: Date | null;
  /**
   * Aggregate per-shul flags over its data_sources. Used by
   * deriveAdminShulState() to compute the next-action label.
   */
  hasPendingSource: boolean;
  hasApprovedSource: boolean;
  hasRejectedSource: boolean;
  hasBrokenRun: boolean;
  pendingSourceCount: number;
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
    last_fresh_at: Date | null;
    first_broken_at: Date | null;
    has_pending_source: boolean | null;
    has_approved_source: boolean | null;
    has_rejected_source: boolean | null;
    has_broken_run: boolean | null;
    pending_source_count: number;
  }>(sql`
    SELECT
      s.id, s.slug, s.name, s.status::text AS status, s.address, s.contact_email,
      s.submitted_url, s.submitted_at,
      COALESCE(ds_agg.cnt, 0)::int AS data_source_count,
      COALESCE(rule_agg.cnt, 0)::int AS live_rule_count,
      ds_top.id AS primary_data_source_id,
      ds_top.review_status::text AS primary_data_source_review,
      fresh_agg.last_fresh_at,
      ds_state.first_broken_at,
      ds_state.has_pending_source,
      ds_state.has_approved_source,
      ds_state.has_rejected_source,
      ds_state.has_broken_run,
      COALESCE(ds_state.pending_source_count, 0)::int AS pending_source_count
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
    LEFT JOIN LATERAL (
      SELECT MAX(COALESCE(last_received_at, last_run_at)) AS last_fresh_at
        FROM data_source
       WHERE shul_id = s.id
         AND last_run_status IN ('ok', 'no_change')
         AND review_status = 'approved'
    ) fresh_agg ON true
    LEFT JOIN LATERAL (
      SELECT
        -- Fix T: pending flag ignores strategy='failed' zombies so the
        -- queue doesn't show them (an admin can't approve a failed
        -- extraction; that's now auto-rejected at persistence).
        bool_or(review_status = 'pending' AND
                (extraction_strategy IS NULL
                 OR extraction_strategy <> 'failed')) AS has_pending_source,
        bool_or(review_status = 'approved') AS has_approved_source,
        bool_or(review_status = 'rejected') AS has_rejected_source,
        -- Fix V/G: a shul is "broken" only when it has NO approved+ok+fresh
        -- source. Per-source broken flags polluted the inbox with shuls
        -- that had one healthy source + one stale broken source.
        NOT bool_or(
              review_status = 'approved'
              AND last_run_status IN ('ok', 'no_change')
              AND COALESCE(last_received_at, last_run_at) >=
                  NOW() - INTERVAL '14 days'
            ) AS has_broken_run,
        -- Fix S: earliest first_broken_at across currently-broken sources
        -- (excludes auto-rejected zombies). Powers the "Broken since" badge.
        MIN(first_broken_at) FILTER (
          WHERE first_broken_at IS NOT NULL
            AND review_status <> 'rejected'
        ) AS first_broken_at,
        COUNT(*) FILTER (
          WHERE review_status = 'pending'
            AND (extraction_strategy IS NULL
                 OR extraction_strategy <> 'failed')
        ) AS pending_source_count
      FROM data_source WHERE shul_id = s.id
    ) ds_state ON true
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
    lastFreshAt: r.last_fresh_at,
    firstBrokenAt: r.first_broken_at,
    hasPendingSource: r.has_pending_source ?? false,
    hasApprovedSource: r.has_approved_source ?? false,
    hasRejectedSource: r.has_rejected_source ?? false,
    hasBrokenRun: r.has_broken_run ?? false,
    pendingSourceCount: Number(r.pending_source_count),
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
  /** Most-recent successful scrape across all data_sources for this shul. */
  lastVerifiedAt: Date | null;
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

  // Rule-level dedup via ROW_NUMBER() CTE. When multiple approved
  // data_sources for the same shul produce rules with the SAME fingerprint
  // (tefillah + time + days_of_week + special_schedule_kind + valid_from +
  // valid_to), only the winner is returned. Winner: data_source.priority
  // DESC, last_run_at DESC NULLS LAST, rule.id DESC. Unique rules from a
  // "loser" source are preserved (no conflict → both shown). This matches
  // the SCOPE.md "Email > website priority, rule-level conflict resolution"
  // design. Manually-edited rules (is_manual_edit=true) bypass dedup
  // entirely — they're treated as durable admin overrides.
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
    last_verified_at: string | null;
  }>(sql`
    WITH eligible_shuls AS (
      SELECT
        s.id, s.slug, s.name, s.address, s.timezone, s.nusach,
        ST_Y(s.location::geometry) AS lat,
        ST_X(s.location::geometry) AS lng,
        ST_Distance(s.location, ${point}) AS distance_meters
      FROM shul s
      WHERE s.status = 'active'
        AND s.location IS NOT NULL
        AND ST_DWithin(s.location, ${point}, ${radiusMeters})
        AND EXISTS (
          SELECT 1 FROM data_source ds_fresh
          WHERE ds_fresh.shul_id = s.id
            AND ds_fresh.last_run_status IN ('ok', 'no_change')
            AND ds_fresh.review_status = 'approved'
            AND COALESCE(ds_fresh.last_received_at, ds_fresh.last_run_at) >=
                NOW() - INTERVAL '14 days'
        )
    ),
    ranked_rules AS (
      SELECT
        es.id AS shul_id, es.slug, es.name, es.address, es.timezone,
        es.nusach, es.lat, es.lng, es.distance_meters,
        mr.id AS rule_id, mr.tefillah, mr.tefillah_label, mr.days_of_week,
        mr.time, mr.special_schedule_kind, mr.priority,
        mr.valid_from, mr.valid_to, mr.nusach AS rule_nusach, mr.notes,
        ROW_NUMBER() OVER (
          PARTITION BY
            mr.shul_id, mr.tefillah, mr.time::text,
            -- Normalize days_of_week array order — [1,2,3] vs [3,2,1] is
            -- the same minyan but otherwise hashes to different partitions.
            COALESCE(
              (SELECT array_agg(d ORDER BY d)::text
                 FROM unnest(mr.days_of_week) AS d), ''),
            mr.special_schedule_kind,
            COALESCE(mr.valid_from::text, ''),
            COALESCE(mr.valid_to::text, '')
          ORDER BY
            -- Manual admin edits win over extraction-generated rows when
            -- they collide on fingerprint.
            mr.is_manual_edit DESC,
            COALESCE(ds.priority, 0) DESC,
            ds.last_run_at DESC NULLS LAST,
            mr.data_source_id DESC NULLS LAST,
            mr.id DESC
        ) AS rn
      FROM eligible_shuls es
      JOIN minyan_rule mr ON mr.shul_id = es.id
      LEFT JOIN data_source ds ON ds.id = mr.data_source_id
      WHERE mr.deleted_at IS NULL
        AND (ds.id IS NULL OR ds.review_status <> 'rejected')
    )
    SELECT
      rr.shul_id, rr.slug, rr.name, rr.address, rr.timezone, rr.nusach,
      rr.lat, rr.lng, rr.distance_meters,
      rr.rule_id, rr.tefillah, rr.tefillah_label, rr.days_of_week, rr.time,
      rr.special_schedule_kind, rr.priority,
      rr.valid_from, rr.valid_to, rr.rule_nusach, rr.notes,
      (
        SELECT MAX(COALESCE(ds2.last_received_at, ds2.last_run_at))
        FROM data_source ds2
        WHERE ds2.shul_id = rr.shul_id
          AND ds2.last_run_status IN ('ok', 'no_change')
          AND ds2.review_status = 'approved'
      ) AS last_verified_at
    FROM ranked_rules rr
    WHERE rr.rn = 1
    ORDER BY rr.distance_meters ASC, rr.priority DESC, rr.rule_id ASC
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
    lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at) : null,
  }));
}
