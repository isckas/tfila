// One-off backfill: geocode shul.address into shul.location for every
// active shul that has an address but no geocoded point. Catches the
// pre-existing bug where backfillShulLocation short-circuits when
// shul.address is set on extraction (most email-derived shuls). Without
// shul.location, the home-feed distance query (ST_DWithin) skips them
// entirely.
//
// Run once per environment after deploying the geocodeAddressIfMissingLocation
// helper. Idempotent — UPDATE is gated on `location IS NULL`.
//
// Requires:
//   DATABASE_URL                — prod connection string (paste into .env.local)
//   GOOGLE_GEOCODING_API_KEY    — already in .env.local
//
// Cost: ~$0.005/call. ~50 shuls = ~$0.25 worst case.
//
// Usage:
//   node scripts/backfill-shul-locations.mjs

import pg from "pg";
import { config } from "dotenv";
config({ path: ".env.local" });

const dbUri = process.env.DATABASE_URL;
const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
if (!dbUri || dbUri.length === 0) {
  console.error("DATABASE_URL not set in .env.local — paste prod connection string first");
  process.exit(1);
}
if (!apiKey) {
  console.error("GOOGLE_GEOCODING_API_KEY not set in .env.local");
  process.exit(1);
}

const c = new pg.Client({ connectionString: dbUri });
await c.connect();

const meta = await c.query("SELECT current_database() AS db");
console.log(`Connected to: ${meta.rows[0].db}\n`);

const { rows } = await c.query(`
  SELECT id, slug, name, address
    FROM shul
   WHERE address IS NOT NULL
     AND location IS NULL
     AND status IN ('active', 'pending_review')
   ORDER BY id
`);

console.log(`Candidates (address set, no location): ${rows.length}\n`);
if (rows.length === 0) {
  await c.end();
  process.exit(0);
}

let ok = 0;
let zero = 0;
let fail = 0;

for (const r of rows) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", r.address);
  url.searchParams.set("key", apiKey);

  let json;
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      console.warn(`[fail] #${r.id} ${r.slug}: HTTP ${res.status}`);
      fail++;
      continue;
    }
    json = await res.json();
  } catch (e) {
    console.warn(`[fail] #${r.id} ${r.slug}: ${e.message}`);
    fail++;
    continue;
  }

  if (json.status === "ZERO_RESULTS") {
    console.warn(`[zero] #${r.id} ${r.slug}: no geocode for "${r.address}"`);
    zero++;
    continue;
  }
  if (json.status !== "OK" || !json.results?.[0]) {
    console.warn(`[fail] #${r.id} ${r.slug}: ${json.status} ${json.error_message ?? ""}`);
    fail++;
    continue;
  }

  const { lat, lng } = json.results[0].geometry.location;
  await c.query(
    `UPDATE shul
        SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            updated_at = NOW()
      WHERE id = $3
        AND location IS NULL`,
    [lng, lat, r.id],
  );
  console.log(`[ok]   #${r.id} ${r.slug}: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
  ok++;

  // Light rate-limit politeness — Google's default is 50 QPS, we're well under.
  await new Promise((res) => setTimeout(res, 50));
}

console.log(`\nDone. ${ok} updated, ${zero} no-result, ${fail} failed.`);
await c.end();
