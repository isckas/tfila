// Cost circuit-breaker. Two layers of defense against runaway LLM spend:
//
// 1. EXTRACTION_DISABLED=true — kill switch. Bypasses extraction entirely.
//    Set during an incident or while debugging a cost spike.
//
// 2. Daily USD ceiling — soft cap. Walks data_source.config_json from rows
//    created today (UTC), sums inputTokens + outputTokens across the
//    nested usage structure, prices each row using its `model` field, and
//    refuses new extractions once today's total exceeds the ceiling.
//
// Why a JSON walker instead of SQL aggregation: the writers stamp usage
// under multiple shapes — keyed by strategy (`usage.html`, `usage.js_rendered`,
// `usage.vision_image[]`, `usage.pdf_document[]`) with inner `{haiku, sonnet}`
// objects (HTML/JS tiers) or arrays of TokenUsage (vision/PDF tiers). A
// recursive sum-of-inputTokens/outputTokens is robust to the variation
// without coupling the gate to the cascade's evolving usage schema.

import { sql } from "drizzle-orm";
import { db } from "@/db/client";

const DEFAULT_DAILY_BUDGET_USD = 25;

// Per-MTok pricing snapshot (Anthropic, early-2026 list). Update when prices
// change. Slight over-estimate is fine — the gate is meant to be a soft cap.
const PRICE_INPUT_HAIKU = 1.0;
const PRICE_OUTPUT_HAIKU = 5.0;
const PRICE_INPUT_SONNET = 3.0;
const PRICE_OUTPUT_SONNET = 15.0;

interface ConfigRow extends Record<string, unknown> {
  config: unknown;
}

function sumTokens(value: unknown): { input: number; output: number } {
  let input = 0;
  let output = 0;
  function walk(v: unknown): void {
    if (v == null) return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (typeof v !== "object") return;
    const obj = v as Record<string, unknown>;
    if (typeof obj.inputTokens === "number") input += obj.inputTokens;
    if (typeof obj.outputTokens === "number") output += obj.outputTokens;
    for (const key of Object.keys(obj)) walk(obj[key]);
  }
  walk(value);
  return { input, output };
}

function pricingForModel(model: unknown): {
  inputPerMTok: number;
  outputPerMTok: number;
} {
  // Default to Sonnet rates when model is missing — over-estimating is safe
  // for a budget gate. Anything labeled Sonnet wins. Anything labeled Haiku
  // gets Haiku rates.
  if (typeof model === "string" && model.toLowerCase().includes("haiku")) {
    return { inputPerMTok: PRICE_INPUT_HAIKU, outputPerMTok: PRICE_OUTPUT_HAIKU };
  }
  return { inputPerMTok: PRICE_INPUT_SONNET, outputPerMTok: PRICE_OUTPUT_SONNET };
}

async function todayCumulativeUsd(): Promise<number> {
  // E-D2: count rows RESCRAPED today, not just CREATED today. The weekly cron
  // (the single biggest spend event) UPDATEs existing data_source rows — it
  // overwrites config_json.usage with the new run's tokens and bumps
  // last_run_at — so a `created_at`-only filter was blind to all cron spend.
  // Including `last_run_at >= today` captures both initial builds and rescrapes;
  // config_json.usage reflects the latest run, so each row is counted once at
  // today's cost.
  const rows = await db.execute<ConfigRow>(sql`
    SELECT config_json AS config
    FROM data_source
    WHERE created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
       OR last_run_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
  `);

  let usd = 0;
  for (const r of rows.rows) {
    const cfg = r.config as Record<string, unknown> | null;
    if (!cfg) continue;
    const { input, output } = sumTokens(cfg.usage);
    if (input === 0 && output === 0) continue;
    const { inputPerMTok, outputPerMTok } = pricingForModel(cfg.model);
    usd += (input / 1_000_000) * inputPerMTok + (output / 1_000_000) * outputPerMTok;
  }
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
    return { allowed: true };
  }

  let todayUsd: number;
  try {
    todayUsd = await todayCumulativeUsd();
  } catch (err) {
    // DB hiccup mid-extraction shouldn't kill extraction. Fail open and log.
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
