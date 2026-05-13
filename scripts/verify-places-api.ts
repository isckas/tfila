// Verify Google Places API (New) is enabled on the project's GCP
// account and reachable with the existing GOOGLE_GEOCODING_API_KEY.
//
// Calls findShulPlace() against a known-good shul name and prints
// the candidate + confidence. If you get a 403 / NOT_ENABLED response,
// the API still needs to be enabled in the GCP console.
//
// Run: npx tsx scripts/verify-places-api.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { findShulPlace } from "../lib/geocoding";

const TEST_SHULS = [
  // A few real shul names spanning different cities so we test that
  // Places' built-in disambiguation is doing its job.
  "Agudath South Anshei Kielce",
  "The Shul of Bal Harbour",
  "Lincoln Square Synagogue",
];

async function main() {
  if (!process.env.GOOGLE_GEOCODING_API_KEY) {
    console.error("GOOGLE_GEOCODING_API_KEY is not set in .env.local");
    process.exit(1);
  }

  let allOk = true;
  for (const name of TEST_SHULS) {
    console.log(`\n→ ${name}`);
    try {
      const m = await findShulPlace(name);
      if (!m) {
        console.log("  (no match — Places API returned 0 results, or 403/NOT_ENABLED)");
        allOk = false;
        continue;
      }
      console.log(`  ✓ ${m.name}`);
      console.log(`    address: ${m.address}`);
      console.log(`    lat,lng: ${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}`);
      console.log(`    types:   ${m.types.join(", ")}`);
      console.log(`    conf:    ${m.confidence.toFixed(2)}`);
      console.log(`    apply?:  ${m.confidence >= 0.7 ? "yes (≥0.7)" : "no (<0.7)"}`);
    } catch (err) {
      console.log(`  ✗ error: ${(err as Error).message.slice(0, 200)}`);
      allOk = false;
    }
  }

  console.log("");
  if (allOk) {
    console.log("✅ Places API (New) is enabled and reachable. Address backfill should work in production.");
  } else {
    console.log("⚠️  At least one lookup failed. Check the Places API (New) status at:");
    console.log("    https://console.cloud.google.com/apis/library/places.googleapis.com");
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("verify failed:", err);
  process.exit(1);
});
