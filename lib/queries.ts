import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { dataSource, minyanRule, shul } from "../db/schema";

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
