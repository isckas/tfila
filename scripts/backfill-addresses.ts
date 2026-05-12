// One-shot backfill: for each shul missing location, fetch its homepage,
// LLM-extract the address, geocode via Google, persist.
//
//   ANTHROPIC_API_KEY=... GOOGLE_GEOCODING_API_KEY=... npx tsx scripts/backfill-addresses.ts
//
// Optional flags:
//   --limit=5        process at most N shuls
//   --dry-run        don't write to DB
//   --shul=<slug>    target a single shul by slug

import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { Client } from "pg";
import { fetchHtml } from "../lib/scrapers/fetch";
import { extractAddressFromHtml } from "../lib/llm/extract-address";
import { geocode, GeocodeError } from "../lib/geocoding";
import { resolveDatabaseUrl } from "../db/client";

interface ShulRow {
  id: number;
  slug: string;
  name: string;
  submitted_url: string | null;
  address: string | null;
  has_location: boolean;
}

interface PerShulOutcome {
  shulId: number;
  slug: string;
  name: string;
  status:
    | "updated"
    | "skipped_no_url"
    | "skipped_fetch_failed"
    | "skipped_no_address"
    | "skipped_low_confidence"
    | "skipped_geocode_failed"
    | "skipped_dry_run";
  address?: string;
  lat?: number;
  lng?: number;
  llmConfidence?: number;
  reason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

const MIN_ADDRESS_CONFIDENCE = 0.55;

async function main() {
  const limitFlag = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitFlag ? parseInt(limitFlag.split("=")[1], 10) : Infinity;
  const dryRun = process.argv.includes("--dry-run");
  const shulFlag = process.argv.find((a) => a.startsWith("--shul="));
  const shulSlug = shulFlag ? shulFlag.split("=")[1] : null;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set in .env.local.");
    process.exit(2);
  }
  if (!dryRun && !process.env.GOOGLE_GEOCODING_API_KEY) {
    console.error(
      "GOOGLE_GEOCODING_API_KEY is not set in .env.local. Set it or pass --dry-run to test LLM extraction only.",
    );
    process.exit(2);
  }

  const url = resolveDatabaseUrl();
  const c = new Client({ connectionString: url });
  await c.connect();

  try {
    let where = "submitted_url IS NOT NULL AND location IS NULL";
    const params: unknown[] = [];
    if (shulSlug) {
      where += ` AND slug = $1`;
      params.push(shulSlug);
    }
    const { rows: shuls } = await c.query<ShulRow>(
      `SELECT id, slug, name, submitted_url, address,
              location IS NOT NULL AS has_location
         FROM shul
        WHERE ${where}
        ORDER BY id
        ${Number.isFinite(limit) ? "LIMIT " + Math.floor(limit) : ""}`,
      params,
    );

    console.log(
      `Processing ${shuls.length} shul(s)${dryRun ? " (DRY RUN)" : ""}${shulSlug ? ` (slug=${shulSlug})` : ""}`,
    );
    console.log("");

    const outcomes: PerShulOutcome[] = [];

    for (let i = 0; i < shuls.length; i++) {
      const s = shuls[i];
      const prefix = `[${(i + 1).toString().padStart(2)}/${shuls.length}] ${s.slug.padEnd(40).slice(0, 40)}`;

      if (!s.submitted_url) {
        outcomes.push({ shulId: s.id, slug: s.slug, name: s.name, status: "skipped_no_url" });
        console.log(`${prefix}  ⊘ no submitted_url`);
        continue;
      }

      // Try multiple candidate URLs — shul homepages often don't show
      // addresses; /contact or /about pages do. Take the first one that
      // yields a high-confidence address.
      const candidates = buildCandidateUrls(s.submitted_url);
      let bestLLM: Awaited<ReturnType<typeof extractAddressFromHtml>> | null = null;
      let bestUrl: string | null = null;
      let totalIn = 0;
      let totalOut = 0;
      let triedCount = 0;
      let fetchFailures = 0;

      for (const candidate of candidates) {
        triedCount++;
        let html: string;
        try {
          const fetched = await fetchHtml(candidate, { timeoutMs: 15_000 });
          if (!fetched.ok || !fetched.html) {
            fetchFailures++;
            continue;
          }
          html = fetched.html;
        } catch {
          fetchFailures++;
          continue;
        }
        try {
          const llm = await extractAddressFromHtml(html);
          totalIn += llm.inputTokens;
          totalOut += llm.outputTokens;
          if (
            llm.extraction.address &&
            llm.extraction.confidence >= MIN_ADDRESS_CONFIDENCE
          ) {
            bestLLM = llm;
            bestUrl = candidate;
            break; // good enough, stop trying more URLs
          }
        } catch (err) {
          console.log(
            `${prefix}  ⚠ LLM error on ${candidate.slice(0, 50)}: ${(err as Error).message.slice(0, 100)}`,
          );
        }
        await new Promise((r) => setTimeout(r, 200)); // polite between candidates
      }

      if (fetchFailures === triedCount) {
        outcomes.push({
          shulId: s.id,
          slug: s.slug,
          name: s.name,
          status: "skipped_fetch_failed",
          reason: `all ${triedCount} candidate URLs failed to fetch`,
        });
        console.log(`${prefix}  ✗ all ${triedCount} URLs failed to fetch`);
        continue;
      }

      if (!bestLLM || !bestLLM.extraction.address) {
        outcomes.push({
          shulId: s.id,
          slug: s.slug,
          name: s.name,
          status: "skipped_no_address",
          reason: `tried ${triedCount} URLs, no address ≥${MIN_ADDRESS_CONFIDENCE} confidence`,
          inputTokens: totalIn,
          outputTokens: totalOut,
        });
        console.log(`${prefix}  ⊘ no address found across ${triedCount} URLs`);
        continue;
      }

      const addr = bestLLM.extraction.address;
      const conf = bestLLM.extraction.confidence;
      // (low-confidence shortcut path no longer needed — we filter inside the loop)

      if (dryRun) {
        outcomes.push({
          shulId: s.id,
          slug: s.slug,
          name: s.name,
          status: "skipped_dry_run",
          address: addr,
          llmConfidence: conf,
          inputTokens: totalIn,
          outputTokens: totalOut,
        });
        console.log(
          `${prefix}  → "${addr.slice(0, 60)}" (conf=${conf.toFixed(2)}, via ${new URL(bestUrl!).pathname || "/"}, dry-run)`,
        );
        continue;
      }

      // Geocode
      let lat: number, lng: number;
      try {
        const result = await geocode(addr);
        if (!result) {
          outcomes.push({
            shulId: s.id,
            slug: s.slug,
            name: s.name,
            status: "skipped_geocode_failed",
            address: addr,
            llmConfidence: conf,
            reason: "geocoder returned ZERO_RESULTS",
          });
          console.log(`${prefix}  ✗ geocode ZERO_RESULTS for "${addr.slice(0, 50)}"`);
          continue;
        }
        lat = result.lat;
        lng = result.lng;
      } catch (err) {
        const msg = err instanceof GeocodeError ? `${err.status}: ${err.message}` : (err as Error).message;
        outcomes.push({
          shulId: s.id,
          slug: s.slug,
          name: s.name,
          status: "skipped_geocode_failed",
          address: addr,
          llmConfidence: conf,
          reason: msg,
        });
        console.log(`${prefix}  ✗ geocode error: ${msg.slice(0, 60)}`);
        continue;
      }

      // Persist
      await c.query(
        `UPDATE shul
            SET address = $1,
                location = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography,
                updated_at = NOW()
          WHERE id = $4`,
        [addr, lng, lat, s.id],
      );
      outcomes.push({
        shulId: s.id,
        slug: s.slug,
        name: s.name,
        status: "updated",
        address: addr,
        lat,
        lng,
        llmConfidence: conf,
        inputTokens: totalIn,
        outputTokens: totalOut,
      });
      console.log(
        `${prefix}  ✓ ${addr.slice(0, 40).padEnd(40)}  ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      );

      // Polite delay between requests so we don't hammer shul sites or geocoder
      await new Promise((r) => setTimeout(r, 400));
    }

    // ─── Summary ────────────────────────────────────────────────
    console.log("");
    console.log("──────── Summary ────────");
    const grouped = outcomes.reduce<Record<string, number>>((acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    }, {});
    for (const [k, v] of Object.entries(grouped)) {
      console.log(`  ${k.padEnd(28)}: ${v}`);
    }
    const totalIn = outcomes.reduce((s, o) => s + (o.inputTokens ?? 0), 0);
    const totalOut = outcomes.reduce((s, o) => s + (o.outputTokens ?? 0), 0);
    console.log(`  Token usage (Haiku 4.5)     : in=${totalIn}  out=${totalOut}`);
    const estCost = (totalIn * 1) / 1_000_000 + (totalOut * 5) / 1_000_000;
    console.log(`  Estimated LLM cost          : ~$${estCost.toFixed(4)}`);

    process.exit(0);
  } finally {
    await c.end();
  }
}

/**
 * Build candidate URLs to try, in priority order. We start from the
 * submitted_url, then strip down to root, then try common contact-page
 * paths. First high-confidence address wins.
 */
function buildCandidateUrls(submittedUrl: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => {
    if (!seen.has(u)) {
      seen.add(u);
      candidates.push(u);
    }
  };
  add(submittedUrl);
  try {
    const url = new URL(submittedUrl);
    const root = `${url.protocol}//${url.host}`;
    add(`${root}/`);
    add(`${root}/contact`);
    add(`${root}/contact-us`);
    add(`${root}/about`);
    add(`${root}/directions`);
  } catch {
    // submittedUrl wasn't a valid URL — leave just the original
  }
  return candidates;
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
