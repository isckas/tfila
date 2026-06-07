import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { shul, minyanRule, timeReport } from "@/db/schema";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// E-B5 — "Report a wrong time" tap on the shul page. Anonymous (no auth).
// Records a lightweight time_report row that the admin triages in the cockpit
// (P4). Deliberately does NOT trigger a re-extract — an anonymous, spammable
// endpoint must never spend LLM $ on its own. See db/schema.ts timeReport.

export const dynamic = "force-dynamic";

const MAX_NOTE_CHARS = 500;

function hashIp(ip: string): string | null {
  if (!ip || ip === "unknown") return null;
  const pepper = process.env.IP_HASH_SALT ?? "tfila-report";
  return createHash("sha256").update(`${pepper}:${ip}`).digest("hex");
}

export async function POST(req: Request): Promise<NextResponse> {
  const ip = clientIp(req);

  // Coarse abuse guard (per-IP). Dedupe-per-shul is handled below.
  const rl = await checkRateLimit("reportTimeIp", ip);
  if (!rl.success) {
    return NextResponse.json({ ok: false, error: "rate-limited" }, { status: 429 });
  }

  // Parse body (the client posts JSON).
  let body: { shulId?: unknown; ruleId?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 });
  }

  const shulId = Number(body.shulId);
  if (!Number.isInteger(shulId) || shulId <= 0) {
    return NextResponse.json({ ok: false, error: "bad-shul" }, { status: 400 });
  }

  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, MAX_NOTE_CHARS)
      : null;

  // Confirm the shul exists (avoids FK errors + junk rows for random ids).
  const target = await db
    .select({ id: shul.id })
    .from(shul)
    .where(eq(shul.id, shulId))
    .limit(1);
  if (!target[0]) {
    return NextResponse.json({ ok: false, error: "no-shul" }, { status: 404 });
  }

  // Optional rule reference — only keep it if it really belongs to this shul,
  // otherwise drop to NULL (the FK would otherwise 500 on a bogus id).
  let ruleId: number | null = null;
  const rawRuleId = Number(body.ruleId);
  if (Number.isInteger(rawRuleId) && rawRuleId > 0) {
    const r = await db
      .select({ id: minyanRule.id })
      .from(minyanRule)
      .where(and(eq(minyanRule.id, rawRuleId), eq(minyanRule.shulId, shulId)))
      .limit(1);
    if (r[0]) ruleId = rawRuleId;
  }

  const ipHash = hashIp(ip);

  // Dedupe: one report per (shul, reporter) per day. Swallows an annoyed user
  // tapping repeatedly without erroring — they still see the thank-you.
  if (ipHash) {
    const dup = await db
      .select({ id: timeReport.id })
      .from(timeReport)
      .where(
        and(
          eq(timeReport.shulId, shulId),
          eq(timeReport.reporterIpHash, ipHash),
          sql`${timeReport.createdAt} > NOW() - INTERVAL '1 day'`,
        ),
      )
      .limit(1);
    if (dup[0]) {
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  await db.insert(timeReport).values({
    shulId,
    minyanRuleId: ruleId,
    note,
    reporterIpHash: ipHash,
  });

  return NextResponse.json({ ok: true });
}
