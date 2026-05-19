import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

// Public health endpoint. Returns ONLY a boolean ok flag — no latency, no
// timing data, no DB internals. Server-side console logs capture latency
// for operator debugging without giving an unauthenticated caller a free
// timing oracle on Neon.
export async function GET() {
  const start = Date.now();
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (err) {
    console.error("[/api/health] db ping failed", err);
  }
  const elapsed = Date.now() - start;
  if (!dbOk) {
    console.warn(`[/api/health] degraded — db.ok=${dbOk} elapsedMs=${elapsed}`);
  }
  return NextResponse.json({ ok: dbOk }, { status: dbOk ? 200 : 503 });
}
