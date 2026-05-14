// Discovery batch script: hits Google Places Text Search v1 for one or
// all targets in data/discovery-targets.json, persists each candidate
// into shul_candidate (idempotent on place_id), and logs each query
// into discovery_run.
//
// Usage:
//   PROD_DATABASE_URL=... GOOGLE_PLACES_API_KEY=... \
//     node scripts/run-discovery.mjs --target "Crown Heights, Brooklyn"
//
//   --target "all"            Run every target in the JSON file
//   --target "<name>"         Run a single target by its `name` field
//   --region north_america    Limit to a region (north_america|europe|travel)
//   --tier 1                  Limit by tier
//   --dry-run                 Print what would happen, don't call Places, don't write
//   --max-queries 5           Safety cap on number of Places API calls (default 200)
//
// Exit code 0 on full success; non-zero if any individual target failed
// (results from other targets are still persisted).

import pg from "pg";
import { readFileSync } from "node:fs";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const PLACES_PAGE_SIZE = 20; // v1 hard cap

function parseArgs(argv) {
  const out = { dryRun: false, maxQueries: 200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") out.target = argv[++i];
    else if (a === "--region") out.region = argv[++i];
    else if (a === "--tier") out.tier = Number(argv[++i]);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--max-queries") out.maxQueries = Number(argv[++i]);
  }
  return out;
}

function selectTargets(allTargets, opts) {
  let selected = allTargets;
  if (opts.region) selected = selected.filter((t) => t.region === opts.region);
  if (opts.tier != null) selected = selected.filter((t) => t.tier === opts.tier);
  if (opts.target && opts.target !== "all") {
    selected = selected.filter((t) => t.name === opts.target);
  }
  return selected;
}

async function placesSearch(query, lat, lng, radius, apiKey) {
  const body = {
    textQuery: query,
    maxResultCount: PLACES_PAGE_SIZE,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius,
      },
    },
  };
  const res = await fetch(PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.websiteUri",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Places ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.places ?? [];
}

/** Insert a candidate row, returning whether it was new. */
async function upsertCandidate(client, place, target, queryText) {
  const r = await client.query(
    `INSERT INTO shul_candidate (
       place_id, name, formatted_address, lat, lng, website_uri,
       types, source, source_detail, discovery_target_name,
       raw_response_jsonb
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, 'google_places', $8, $9, $10::jsonb
     )
     ON CONFLICT (place_id) DO NOTHING
     RETURNING id`,
    [
      place.id,
      place.displayName?.text ?? "(unknown)",
      place.formattedAddress ?? null,
      place.location?.latitude ?? null,
      place.location?.longitude ?? null,
      place.websiteUri ?? null,
      place.types ?? [],
      `query=${queryText}`,
      target.name,
      JSON.stringify(place),
    ],
  );
  return r.rowCount > 0;
}

async function runOneTarget(client, target, opts, apiKey) {
  const queries = target.queries ?? ["synagogue"];
  let totalCallsRemaining = opts.maxQueries;
  console.log(`\n── ${target.name} (${target.region} tier ${target.tier})`);

  for (const queryText of queries) {
    if (totalCallsRemaining <= 0) {
      console.log(`   skip "${queryText}" — max-queries budget exhausted`);
      break;
    }
    totalCallsRemaining--;

    const runRow = await client.query(
      `INSERT INTO discovery_run (
         target_name, query_text, center_lat, center_lng, radius_m
       ) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [target.name, queryText, target.lat, target.lng, target.radius_m],
    );
    const runId = runRow.rows[0].id;

    if (opts.dryRun) {
      console.log(`   [dry-run] query="${queryText}" center=${target.lat},${target.lng} radius=${target.radius_m}m`);
      await client.query(
        `UPDATE discovery_run SET finished_at = NOW(), result_count = 0,
                                  candidates_new = 0, candidates_dup = 0,
                                  error = 'dry-run, no call made'
          WHERE id = $1`,
        [runId],
      );
      continue;
    }

    try {
      const places = await placesSearch(
        queryText,
        target.lat,
        target.lng,
        target.radius_m,
        apiKey,
      );
      let newCount = 0;
      let dupCount = 0;
      for (const p of places) {
        if (!p.id) continue;
        const isNew = await upsertCandidate(client, p, target, queryText);
        if (isNew) newCount++;
        else dupCount++;
      }
      await client.query(
        `UPDATE discovery_run
            SET finished_at = NOW(), result_count = $2,
                candidates_new = $3, candidates_dup = $4
          WHERE id = $1`,
        [runId, places.length, newCount, dupCount],
      );
      console.log(
        `   ✓ "${queryText}": ${places.length} results → ${newCount} new, ${dupCount} dup`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await client.query(
        `UPDATE discovery_run SET finished_at = NOW(), error = $2 WHERE id = $1`,
        [runId, msg.slice(0, 1000)],
      );
      console.log(`   ✗ "${queryText}" failed: ${msg}`);
      throw e;
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.target && !opts.region && opts.tier == null) {
    console.error("must pass --target <name|all>, --region, or --tier");
    process.exit(2);
  }

  const dbUrl = process.env.PROD_DATABASE_URL;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
  if (!dbUrl) {
    console.error("PROD_DATABASE_URL not set");
    process.exit(2);
  }
  if (!apiKey && !opts.dryRun) {
    console.error("GOOGLE_PLACES_API_KEY (or GOOGLE_GEOCODING_API_KEY) not set; pass --dry-run to skip");
    process.exit(2);
  }

  const raw = readFileSync(
    new URL("../data/discovery-targets.json", import.meta.url),
    "utf8",
  );
  const data = JSON.parse(raw);
  const selected = selectTargets(data.targets, opts);
  if (selected.length === 0) {
    console.error("no targets matched the filter");
    process.exit(2);
  }
  console.log(`Selected ${selected.length} target(s).${opts.dryRun ? " (dry-run)" : ""}`);

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  let failures = 0;
  for (const target of selected) {
    try {
      await runOneTarget(client, target, opts, apiKey);
    } catch {
      failures++;
    }
  }

  await client.end();
  console.log(
    `\nDone. ${selected.length - failures}/${selected.length} targets succeeded.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
