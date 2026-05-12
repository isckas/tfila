// For each shul that has a location but no timezone, derive the
// timezone from lat/lng via geo-tz and persist.
//
//   npx tsx scripts/backfill-timezones.ts [--dry-run]

import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { Client } from "pg";
import { find as findTz } from "geo-tz";
import { resolveDatabaseUrl } from "../db/client";

interface Row {
  id: number;
  slug: string;
  lat: number;
  lng: number;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const c = new Client({ connectionString: resolveDatabaseUrl() });
  await c.connect();
  try {
    const { rows } = await c.query<Row>(`
      SELECT id, slug,
             ST_Y(location::geometry)::float8 AS lat,
             ST_X(location::geometry)::float8 AS lng
        FROM shul
       WHERE location IS NOT NULL AND timezone IS NULL
       ORDER BY id
    `);
    console.log(`${rows.length} shul(s) need a timezone${dryRun ? " (DRY RUN)" : ""}`);
    let updated = 0;
    for (const r of rows) {
      const tzs = findTz(r.lat, r.lng);
      if (!tzs.length) {
        console.log(`  ${r.slug.padEnd(45)}  ⊘ geo-tz returned no timezone for ${r.lat}, ${r.lng}`);
        continue;
      }
      const tz = tzs[0];
      console.log(`  ${r.slug.padEnd(45)}  ${tz}`);
      if (!dryRun) {
        await c.query(`UPDATE shul SET timezone = $1, updated_at = NOW() WHERE id = $2`, [tz, r.id]);
        updated++;
      }
    }
    console.log(`\nUpdated ${updated} of ${rows.length}`);
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
