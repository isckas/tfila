import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  let dbOk = false;
  let dbLatencyMs: number | null = null;
  try {
    const dbStart = Date.now();
    await db.execute(sql`select 1`);
    dbLatencyMs = Date.now() - dbStart;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const body = {
    ok: dbOk,
    db: { ok: dbOk, latencyMs: dbLatencyMs },
    ts: new Date().toISOString(),
    totalMs: Date.now() - start,
  };

  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
