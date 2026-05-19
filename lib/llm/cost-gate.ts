// Cost circuit-breaker. Two layers of defense against runaway LLM spend:
//
// 1. EXTRACTION_DISABLED=true — kill switch. Bypasses extraction entirely.
//    Set during an incident or while debugging a cost spike.
//
// 2. Daily USD ceiling — soft cap. Sums the per-extraction `usage` token
//    counts stamped into data_source.config_json for the current UTC day
//    and refuses new extractions once today's cost exceeds the ceiling.
//
// Both are deliberately conservative — fail-closed is cheaper than the
// incident they prevent. Adjust LLM_DAILY_BUDGET_USD via env when ramping.

import { sql } from "drizzle-orm";
import { db } from "@/db/client";

const DEFAULT_DAILY_BUDGET_USD = 25;

// Per-MTok pricing snapshot (Anthropic, early-2026 list). Update when prices
// change. Slight over-estimate is fine — the gate is meant to be a soft cap.
const PRICE_INPUT_PER_MTOK: Record<string, number> = {
  haiku: 1.0,
  sonnet: 3.0,
};
const PRICE_OUTPUT_PER_MTOK: Record<string, number> = {
  haiku: 5.0,
  sonnet: 15.0,
};

interface UsageRow extends Record<string, unknown> {
  haiku_in: number;
  haiku_out: number;
  sonnet_in: number;
  sonnet_out: number;
}

async function todayCumulativeUsd(): Promise<number> {
  const rows = await db.execute<UsageRow>(sql`
    SELECT
      COALESCE(SUM((config_json->'usage'->'haiku'->>'inputTokens')::bigint), 0)
        AS haiku_in,
      COALESCE(SUM((config_json->'usage'->'haiku'->>'outputTokens')::bigint), 0)
        AS haiku_out,
      COALESCE(SUM((config_json->'usage'->'sonnet'->>'inputTokens')::bigint), 0)
        AS sonnet_in,
      COALESCE(SUM((config_json->'usage'->'sonnet'->>'outputTokens')::bigint), 0)
        AS sonnet_out
    FROM data_source
    WHERE created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
  `);

  const r = rows.rows[0];
  if (!r) return 0;

  const usd =
    (Number(r.haiku_in) / 1_000_000) * (PRICE_INPUT_PER_MTOK.haiku ?? 0) +
    (Number(r.haiku_out) / 1_000_000) * (PRICE_OUTPUT_PER_MTOK.haiku ?? 0) +
    (Number(r.sonnet_in) / 1_000_000) * (PRICE_INPUT_PER_MTOK.sonnet ?? 0) +
    (Number(r.sonnet_out) / 1_000_000) * (PRICE_OUTPUT_PER_MTOK.sonnet ?? 0);

  return usd;
}

export interface CostGateResult {
  allowed: boolean;
  reason?: "kill_switch" | "daily_budget_exceeded";
  todayUsd?: number;
  budgetUsd?: number;
}

export async function checkCostGate(): Promise<CostGateResult> {
  if (process.env.EXTRACTION_DISABLED === "true") {
    return { allowed: false, reason: "kill_switch" };
  }

  const budgetRaw = process.env.LLM_DAILY_BUDGET_USD;
  const budgetUsd = budgetRaw ? Number(budgetRaw) : DEFAULT_DAILY_BUDGET_USD;
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    // Invalid config — fail open. Operator can fix the env var.
    return { allowed: true };
  }

  let todayUsd: number;
  try {
    todayUsd = await todayCumulativeUsd();
  } catch (err) {
    // DB hiccup mid-extraction shouldn't kill extraction. Fail open and
    // log — Sentry will catch.
    console.error("[cost-gate] failed to compute today's cost; failing open", err);
    return { allowed: true };
  }

  if (todayUsd >= budgetUsd) {
    return {
      allowed: false,
      reason: "daily_budget_exceeded",
      todayUsd,
      budgetUsd,
    };
  }

  return { allowed: true, todayUsd, budgetUsd };
}
