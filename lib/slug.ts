import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { shul } from "../db/schema";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function nameFromTitle(title: string): string {
  if (!title) return "";
  let cleaned = title.split(/[|•·–—•]/)[0].trim();
  cleaned = cleaned.replace(/\s*-\s*Home\b.*/i, "");
  cleaned = cleaned.replace(/\s*\|\s*ShulCloud.*/i, "");
  cleaned = cleaned.replace(/^Welcome to /i, "");
  return cleaned.trim();
}

type DbOrTx =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Find a shul.slug that doesn't collide with an existing row.
 * Returns baseSlug, or baseSlug-2, baseSlug-3, ... up to baseSlug-99.
 *
 * Pass a transaction (`tx`) when called inside `db.transaction()` so the
 * uniqueness check sees in-flight inserts; pass `db` for top-level use.
 *
 * Shared by URL submit, email forward, and admin candidate-approve paths
 * — see FEATURES.md "Unified post-ingestion pipeline" entry.
 */
export async function allocateUniqueSlug(
  qr: DbOrTx,
  baseSlug: string,
): Promise<string> {
  let candidate = baseSlug;
  for (let n = 2; n < 100; n++) {
    const collision = await qr
      .select({ id: shul.id })
      .from(shul)
      .where(eq(shul.slug, candidate))
      .limit(1);
    if (!collision[0]) return candidate;
    candidate = `${baseSlug}-${n}`;
  }
  return candidate;
}
