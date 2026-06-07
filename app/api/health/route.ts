import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { find as findTz } from "geo-tz";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

// Public health endpoint. Probes BOTH the DB and the located-feed's failure-
// prone dependency — the geo-tz `.geo.dat` read that 500'd the home feed for
// weeks while a bare `select 1` health check reported green (H9). Still returns
// ONLY a boolean `ok` (no latency/subsystem detail) so an unauthenticated
// caller gets no timing oracle; the breakdown is server-logged for the operator.
export async function GET() {
  const start = Date.now();

  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (err) {
    console.error("[/api/health] db ping failed", err);
  }

  let feedOk = false;
  try {
    // The exact dependency that took the feed down: geo-tz resolving a point
    // to its IANA tz via a lazily-`openSync`'d data file. If the data didn't
    // ship into the function, this throws ENOENT — and now health goes red
    // instead of the failure hiding behind a green `select 1`.
    const tz = findTz(40.6, -73.7);
    feedOk = Array.isArray(tz) && tz.length > 0;
  } catch (err) {
    console.error("[/api/health] geo-tz feed probe failed", err);
  }

  const ok = dbOk && feedOk;
  const elapsed = Date.now() - start;
  if (!ok) {
    console.warn(
      `[/api/health] degraded — db=${dbOk} feed=${feedOk} elapsedMs=${elapsed}`,
    );
  }
  return NextResponse.json({ ok }, { status: ok ? 200 : 503 });
}
