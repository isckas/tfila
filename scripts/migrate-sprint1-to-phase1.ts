// Reads sprint-1 tables (shuls, minyanim) and populates the new
// schema (shul, data_source, minyan_rule). Idempotent: re-running
// is a no-op if the new tables already contain a sprint-1-derived
// shul slug.
//
// Drops candles/havdalah from minyanim (those are zmanim, not
// minyan times — computed dynamically via @hebcal/core later).
//
// Leaves shul.location NULL since sprint-1 has neither addresses
// nor lat/lng. A separate pass will geocode once addresses are
// captured.
//
// Run with: npx tsx scripts/migrate-sprint1-to-phase1.ts

import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { Client } from "pg";
import { resolveDatabaseUrl } from "../db/client";

interface Sprint1Shul {
  id: number;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postal_code: string | null;
  lat: number | null;
  lon: number | null;
  timezone: string | null;
  nusach: string | null;
  scrape_url: string | null;
  email: string | null;
  source_platform: string | null;
  scrape_enabled: boolean;
  last_scraped_at: Date | null;
  created_at: Date;
}

interface Sprint1Minyan {
  id: number;
  shul_id: number;
  service: string;
  day_rule: string;
  specific_date: Date | null;
  time_kind: string;
  time_fixed: string | null;
  time_offset_minutes: number | null;
  nusach: string | null;
  notes: string | null;
}

// Sprint-1 day_rule → new days_of_week array (0=Sun, 6=Shabbos)
const DAY_RULE_MAP: Record<string, number[] | null> = {
  sunday: [0],
  monday: [1],
  tuesday: [2],
  wednesday: [3],
  thursday: [4],
  friday: [5],
  shabbos: [6],
  weekday: [1, 2, 3, 4, 5],
  rosh_chodesh: null, // express via special_schedule_kind, not days_of_week
  yom_tov: null,
  specific_date: null,
};

// Sprint-1 service → new tefillah. candles/havdalah are intentionally
// excluded — those will be displayed via the zmanim panel.
const SERVICE_MAP: Record<string, string | null> = {
  shacharis: "shacharis",
  mincha: "mincha",
  maariv: "maariv",
  selichos: "selichos",
  other: "other",
  candles: null, // DROP
  havdalah: null, // DROP
};

function mapShulStatus(scrape_enabled: boolean): string {
  return scrape_enabled ? "active" : "archived";
}

function mapPlatformToSourceKind(platform: string | null): string {
  if (platform === "shulcloud") return "shulcloud_website";
  return "manual";
}

function buildTimeJson(m: Sprint1Minyan): unknown {
  if (m.time_kind === "fixed" && m.time_fixed) {
    return { kind: "fixed", clock: m.time_fixed };
  }
  // Sprint-1 had relative_* time kinds but none populated in this snapshot.
  // Map them defensively if they appear.
  const anchorMap: Record<string, string> = {
    relative_sunrise: "netz",
    relative_sunset: "shkia",
    relative_plag: "plag_mincha",
    relative_chatzos: "chatzos",
  };
  const anchor = anchorMap[m.time_kind];
  if (anchor) {
    return {
      kind: "zmanim",
      anchor,
      offsetMin: m.time_offset_minutes ?? 0,
    };
  }
  // Unrecognised — preserve as raw for inspection
  return {
    kind: "fixed",
    clock: m.time_fixed ?? "00:00",
    _unmapped: m.time_kind,
  };
}

async function main() {
  const url = resolveDatabaseUrl();
  console.log(`Connecting to: ${maskUrl(url)}`);
  const c = new Client({ connectionString: url });
  await c.connect();

  try {
    // Idempotency check
    const already = await c.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM shul WHERE id IN (SELECT id FROM shul LIMIT 1)",
    );
    const existingShuls = parseInt(already.rows[0]?.n ?? "0", 10);
    if (existingShuls > 0) {
      console.log(
        `⚠  shul table already has ${existingShuls} row(s). Aborting to avoid duplicates. Truncate first if you want to re-run:`,
      );
      console.log(
        "    TRUNCATE shul, data_source, minyan_rule, scrape_run RESTART IDENTITY CASCADE;",
      );
      return;
    }

    await c.query("BEGIN");

    // ─── Migrate shuls ──────────────────────────────────────────
    const shulRows = await c.query<Sprint1Shul>(
      "SELECT * FROM shuls ORDER BY id",
    );
    console.log(`Reading ${shulRows.rowCount} sprint-1 shul(s)...`);

    const shulIdMap = new Map<number, number>(); // sprint1 id → new id
    const dataSourceIdByShul = new Map<number, number>(); // new shul id → data_source id

    for (const s of shulRows.rows) {
      const composedAddress = [s.address, s.city, s.region, s.postal_code, s.country]
        .filter(Boolean)
        .join(", ");
      const status = mapShulStatus(s.scrape_enabled);
      const insertShul = await c.query<{ id: number }>(
        `INSERT INTO shul (
           slug, name, address, location, timezone, nusach,
           submitted_url, contact_email, status, submitted_at, activated_at,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3,
           CASE WHEN $4::float8 IS NOT NULL AND $5::float8 IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326)::geography
                ELSE NULL END,
           $6, $7, $8, $9, $10::shul_status, $11, $12,
           $11, NOW()
         )
         RETURNING id`,
        [
          s.slug,
          s.name,
          composedAddress || null,
          s.lat,
          s.lon,
          s.timezone,
          s.nusach,
          s.scrape_url,
          s.email,
          status,
          s.created_at,
          status === "active" ? s.created_at : null,
        ],
      );
      const newShulId = insertShul.rows[0].id;
      shulIdMap.set(s.id, newShulId);

      // 1 data_source per shul — keep the existing scrape pipeline alive
      // by tagging as `shulcloud_website` (the sprint-1 extractor handled it).
      if (s.scrape_url) {
        const kind = mapPlatformToSourceKind(s.source_platform);
        const insertSource = await c.query<{ id: number }>(
          `INSERT INTO data_source (
             shul_id, kind, identifier, priority,
             built_at, built_by, last_run_at, last_run_status,
             review_status, created_at, updated_at
           ) VALUES (
             $1, $2::data_source_kind, $3, 30,
             $4, 'manual', $5, NULL,
             'approved', $4, NOW()
           )
           RETURNING id`,
          [
            newShulId,
            kind,
            s.scrape_url,
            s.created_at,
            s.last_scraped_at,
          ],
        );
        dataSourceIdByShul.set(newShulId, insertSource.rows[0].id);
      }
    }

    console.log(`✓ Inserted ${shulIdMap.size} shul(s).`);
    console.log(`✓ Inserted ${dataSourceIdByShul.size} data_source(s).`);

    // ─── Migrate minyanim ───────────────────────────────────────
    const minyanRows = await c.query<Sprint1Minyan>(
      "SELECT * FROM minyanim ORDER BY id",
    );
    console.log(`Reading ${minyanRows.rowCount} sprint-1 minyan row(s)...`);

    const droppedByService: Record<string, number> = {};
    let inserted = 0;

    for (const m of minyanRows.rows) {
      const newShulId = shulIdMap.get(m.shul_id);
      if (!newShulId) {
        console.warn(`  skip minyan ${m.id}: shul_id ${m.shul_id} not migrated`);
        continue;
      }

      const tefillah = SERVICE_MAP[m.service];
      if (tefillah === null || tefillah === undefined) {
        droppedByService[m.service] = (droppedByService[m.service] ?? 0) + 1;
        continue;
      }

      const days = DAY_RULE_MAP[m.day_rule] ?? null;
      const specialKind =
        m.day_rule === "rosh_chodesh"
          ? "rosh_chodesh"
          : m.day_rule === "yom_tov"
            ? "yom_tov"
            : m.day_rule === "specific_date"
              ? "ad_hoc"
              : "regular";

      let validFrom: Date | null = null;
      let validTo: Date | null = null;
      if (m.day_rule === "specific_date" && m.specific_date) {
        validFrom = m.specific_date;
        validTo = m.specific_date;
      }

      const time = buildTimeJson(m);
      const dataSourceId = dataSourceIdByShul.get(newShulId) ?? null;

      await c.query(
        `INSERT INTO minyan_rule (
           shul_id, data_source_id, tefillah, days_of_week, time,
           valid_from, valid_to, special_schedule_kind, priority,
           nusach, notes,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3::tefillah, $4::smallint[], $5::jsonb,
           $6, $7, $8::special_schedule_kind, 0,
           $9, $10,
           NOW(), NOW()
         )`,
        [
          newShulId,
          dataSourceId,
          tefillah,
          days,
          JSON.stringify(time),
          validFrom,
          validTo,
          specialKind,
          m.nusach,
          m.notes,
        ],
      );
      inserted++;
    }

    await c.query("COMMIT");

    console.log(`✓ Inserted ${inserted} minyan_rule row(s).`);
    if (Object.keys(droppedByService).length > 0) {
      console.log("Dropped (not real minyanim — moved to zmanim panel):");
      for (const [svc, n] of Object.entries(droppedByService)) {
        console.log(`  ${svc}: ${n}`);
      }
    }

    // ─── Summary ────────────────────────────────────────────────
    console.log("\n──────── New schema state ────────");
    const summary = await c.query(`
      SELECT
        (SELECT COUNT(*) FROM shul)::int AS shul_n,
        (SELECT COUNT(*) FROM shul WHERE location IS NOT NULL)::int AS shul_with_loc,
        (SELECT COUNT(*) FROM data_source)::int AS source_n,
        (SELECT COUNT(*) FROM minyan_rule)::int AS rule_n,
        (SELECT COUNT(DISTINCT tefillah) FROM minyan_rule)::int AS tefillah_kinds
    `);
    console.table(summary.rows);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

function maskUrl(u: string): string {
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.username}:***@${url.host}${url.pathname}`;
  } catch {
    return "<unparseable>";
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
