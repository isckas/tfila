import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { dataSource, minyanRule, shul, type MinyanTime } from "../db/schema";

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

export async function getDataSourceById(id: number) {
  const rows = await db
    .select()
    .from(dataSource)
    .where(eq(dataSource.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Counters (used in admin landing / health) ───────────────────────────

export async function countByShulStatus() {
  return db
    .select({ status: shul.status, n: sql<number>`COUNT(*)::int` })
    .from(shul)
    .groupBy(shul.status);
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
