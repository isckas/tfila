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
                AND COALESCE(ds.last_received_at, ds.last_run_at) >=
                    NOW() - INTERVAL '14 days'
           )
      `),
    );
    const staleCount = Number(stale.rows[0]?.n ?? 0);

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

    if (issues.rows.length > 0) {
      lines.push("");
      lines.push(`Broken / error (${issues.rows.length}):`);
      for (const r of issues.rows) {
        lines.push("");
        lines.push(`  [${r.run_status}] ${r.name}`);
        lines.push(`    shul ${r.shul_id} · data_source ${r.data_source_id}`);
        lines.push(`    /admin/shul/${r.slug}`);
        if (r.error) lines.push(`    ${r.error}`);
      }
    }

    if (staleCount > 0) {
      lines.push("");
      lines.push(
        `⚠ Active shuls HIDDEN from public by stale-gate (no fresh data_source in ${STALE_THRESHOLD_DAYS}d): ${staleCount}`,
      );
      lines.push("  Check /admin/shuls — red-pilled rows.");
    }

    lines.push("");
    lines.push(
      "Lookback window: last 90 min. Inngest dashboard has full per-run traces.",
    );

    await step.run("send-email", async () => {
      await notifyAdmin({
        subject: `Weekly cron · ${total} scrapes · ${issues.rows.length} issues${staleCount > 0 ? ` · ${staleCount} stale` : ""}`,
        text: lines.join("\n"),
      });
    });

    return {
      total,
      counts: Object.fromEntries(counts.rows.map((r) => [r.status, Number(r.n)])),
      issueCount: issues.rows.length,
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
