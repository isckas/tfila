// Weekly digest emailed to ADMIN_EMAIL ~1h after the rescrape cron
// fans out. Counts scrape_run rows by status for the last 90 minutes,
// includes per-shul detail for broken/error rows, plus a stale-gate
// alert if any active shul has dropped off the public surface this
// week (no fresh data_source in the last 14 days).
//
// Schedule: Sundays 04:00 UTC = Saturdays 23:00 ET (1h after the
// weekly-rescrape fan-out at Sun 03:00 UTC). 90-min lookback window
// gives plenty of buffer for the longest scrapes (vision tier can
// take 60-120s per shul) to drain before we summarize.

import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import { dataSource, scrapeRun, shul } from "../../../db/schema";
import { notifyAdmin } from "../../email";
import { STALE_THRESHOLD_DAYS } from "../../freshness";

const LOOKBACK_MINUTES = 90;

// Absolute base URL for links in the email body. Email clients won't
// auto-link relative paths — every URL has to be a full https://...
// to be clickable. Fall back to the canonical prod host if AUTH_URL
// isn't configured in the runtime env.
const BASE_URL = (
  process.env.AUTH_URL?.trim() || "https://tfila.co"
).replace(/\/$/, "");

export const weeklyRescrapeSummary = inngest.createFunction(
  {
    id: "shul-weekly-rescrape-summary",
    triggers: [{ cron: "0 4 * * SUN" }],
  },
  async ({ step }) => {
    if (process.env.SCRAPE_ENABLED === "false") {
      return { skipped: true, reason: "SCRAPE_ENABLED=false" };
    }

    // ─── Counts by status ──────────────────────────────────────
    const counts = await step.run("count-by-status", async () =>
      db.execute<{ status: string; n: number }>(sql`
        SELECT status, COUNT(*)::int AS n
          FROM scrape_run
         WHERE started_at >= NOW() - (${LOOKBACK_MINUTES} || ' minutes')::interval
         GROUP BY status
         ORDER BY n DESC
      `),
    );

    const total = counts.rows.reduce((s, r) => s + Number(r.n), 0);

    // ─── Skip the email when nothing ran ───────────────────────
    // Cron didn't fire, or the deploy was paused. Either way, sending
    // an empty digest is just noise.
    if (total === 0) {
      return { skipped: true, reason: "no scrape_run rows in lookback window" };
    }

    // ─── Per-shul detail for broken / error rows ───────────────
    const issues = await step.run("list-issues", async () =>
      db.execute<{
        run_id: number;
        shul_id: number;
        slug: string;
        name: string;
        data_source_id: number;
        run_status: string;
        error: string | null;
        started_at: Date;
      }>(sql`
        SELECT
          sr.id AS run_id,
          sr.shul_id,
          s.slug,
          s.name,
          sr.data_source_id,
          sr.status AS run_status,
          sr.error,
          sr.started_at
          FROM scrape_run sr
          JOIN shul s ON s.id = sr.shul_id
         WHERE sr.started_at >= NOW() - (${LOOKBACK_MINUTES} || ' minutes')::interval
           AND sr.status IN ('broken', 'error')
         ORDER BY sr.started_at DESC
      `),
    );

    // ─── Stale-gate signal — count active shuls hidden by 14d gate ─
    const stale = await step.run("count-stale", async () =>
      db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n
          FROM shul s
         WHERE s.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM data_source ds
              WHERE ds.shul_id = s.id
                AND ds.last_run_status = 'ok'
                AND ds.review_status = 'approved'
                AND COALESCE(ds.last_received_at, ds.last_run_at) >=
                    NOW() - INTERVAL '14 days'
           )
      `),
    );
    const staleCount = Number(stale.rows[0]?.n ?? 0);

    // Fix R: bucket currently-broken data_sources into NEW (first broken
    // within 7d) vs CHRONIC (broken longer). Powered by first_broken_at
    // which the scrape-one-shul mark-broken step now maintains via
    // COALESCE(...) — first transition into the broken streak stamps it,
    // recovery clears it.
    const brokenSources = await step.run("list-broken-sources", async () =>
      db.execute<{
        ds_id: number;
        shul_id: number;
        slug: string;
        name: string;
        first_broken_at: Date;
        days_broken: number;
        extraction_strategy: string | null;
      }>(sql`
        SELECT
          ds.id AS ds_id,
          ds.shul_id,
          s.slug,
          s.name,
          ds.first_broken_at,
          EXTRACT(EPOCH FROM (NOW() - ds.first_broken_at))::int / 86400 AS days_broken,
          ds.extraction_strategy::text AS extraction_strategy
        FROM data_source ds
        JOIN shul s ON s.id = ds.shul_id
        WHERE ds.first_broken_at IS NOT NULL
          AND ds.review_status <> 'rejected'
          AND ds.last_run_status IN ('broken', 'error')
        ORDER BY ds.first_broken_at DESC
      `),
    );
    const newBroken = brokenSources.rows.filter(
      (r) => Number(r.days_broken) < 7,
    );
    const chronicBroken = brokenSources.rows.filter(
      (r) => Number(r.days_broken) >= 7,
    );

    // ─── Format + send ────────────────────────────────────────
    const lines: string[] = [];
    lines.push(`Weekly cron summary — ${new Date().toISOString().slice(0, 10)}`);
    lines.push("─".repeat(48));
    lines.push(`Total scrapes: ${total}`);
    lines.push("");

    // Status badges with friendly framing
    const labelFor: Record<string, string> = {
      ok: "✓ ok        ",
      no_change: "· no_change ",
      broken: "⚠ broken    ",
      error: "✗ error     ",
    };
    for (const row of counts.rows) {
      const label = labelFor[row.status] ?? row.status.padEnd(12, " ");
      lines.push(`  ${label}: ${row.n}`);
    }

    // Fix R: NEW broken (first_broken_at within last 7d). Most actionable.
    if (newBroken.length > 0) {
      lines.push("");
      lines.push(`⚠ NEW broken (this week, ${newBroken.length}):`);
      for (const r of newBroken) {
        lines.push("");
        lines.push(
          `  [${r.extraction_strategy ?? "—"}] ${r.name} (broken ${Number(r.days_broken)}d)`,
        );
        lines.push(`    shul ${r.shul_id} · data_source ${r.ds_id}`);
        lines.push(`    ${BASE_URL}/admin/shul/${r.slug}`);
      }
    }

    // Fix R: CHRONIC broken (older than 7d). Lower priority but visible.
    if (chronicBroken.length > 0) {
      lines.push("");
      lines.push(`· Chronic broken (>7d, ${chronicBroken.length}):`);
      for (const r of chronicBroken) {
        lines.push(
          `  [${r.extraction_strategy ?? "—"}] ${r.name} (${Number(r.days_broken)}d) — ${BASE_URL}/admin/shul/${r.slug}`,
        );
      }
    }

    // Per-run broken/error detail from this week's scrape_run rows.
    // Complements the per-data_source NEW/CHRONIC view above by surfacing
    // the EXACT errors hit during this week's runs (e.g. fetch timeout vs
    // guardrail rule-drop).
    if (issues.rows.length > 0) {
      lines.push("");
      lines.push(`Recent scrape errors (${issues.rows.length}):`);
      for (const r of issues.rows) {
        lines.push("");
        lines.push(`  [${r.run_status}] ${r.name}`);
        lines.push(`    shul ${r.shul_id} · data_source ${r.data_source_id}`);
        lines.push(`    ${BASE_URL}/admin/shul/${r.slug}`);
        if (r.error) lines.push(`    ${r.error}`);
      }
    }

    if (staleCount > 0) {
      lines.push("");
      lines.push(
        `⚠ Active shuls HIDDEN from public by stale-gate (no fresh data_source in ${STALE_THRESHOLD_DAYS}d): ${staleCount}`,
      );
      lines.push(
        `  Check ${BASE_URL}/admin/shuls — red-pilled rows.`,
      );
    }

    lines.push("");
    lines.push(
      "Lookback window: last 90 min. Inngest dashboard has full per-run traces.",
    );

    const subjectParts = [`Weekly cron · ${total} scrapes`];
    if (newBroken.length > 0) subjectParts.push(`${newBroken.length} NEW broken`);
    if (chronicBroken.length > 0)
      subjectParts.push(`${chronicBroken.length} chronic`);
    if (staleCount > 0) subjectParts.push(`${staleCount} stale`);

    await step.run("send-email", async () => {
      await notifyAdmin({
        subject: subjectParts.join(" · "),
        text: lines.join("\n"),
      });
    });

    return {
      total,
      counts: Object.fromEntries(counts.rows.map((r) => [r.status, Number(r.n)])),
      issueCount: issues.rows.length,
      newBrokenCount: newBroken.length,
      chronicBrokenCount: chronicBroken.length,
      staleCount,
    };
  },
);

// Silence unused warnings — these are kept available for future use.
void and;
void eq;
void gte;
void isNull;
void or;
