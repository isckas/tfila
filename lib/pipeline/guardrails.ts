// Broken-extraction guardrails. Shared across the three sites that
// can land a fresh LLM extraction on top of an existing one:
//   - URL rescrape, HTML tier (lib/inngest/functions/scrape-one-shul.ts)
//   - URL rescrape, non-HTML tiers (same file, rescrapeNonHtml)
//   - Email re-forward of an existing data_source (process-email.ts)
//
// When confidence is low or rule count drops sharply, hold the previous
// rules in place and flag the data_source for admin review instead of
// silently replacing — daveners keep seeing the last-known-good schedule
// while admin investigates. See FEATURES.md "Unified post-ingestion
// pipeline" for the principle.

/** Confidence below this → hold old rules, flag for review. */
export const MIN_AUTO_APPLY_CONFIDENCE = 0.6;

/**
 * If new rule count is < this fraction of previous (and we had >=3
 * before), treat as broken. Tuned to allow normal week-to-week drift
 * (a special-schedule week dropping a couple of minyanim) but catch
 * a wholesale extraction failure (12 rules → 2).
 */
export const BROKEN_DROP_THRESHOLD = 0.5;

export interface GuardrailVerdict {
  shouldFlagBroken: boolean;
  /** Human-readable reason — null when not broken. */
  reason: string | null;
  confidenceTooLow: boolean;
  ruleDropSuspicious: boolean;
  /** True when newRuleCount === 0 AND prevRuleCount > 0. */
  zeroRulesAfterPrior: boolean;
}

export function evaluateExtractionGuardrails(args: {
  prevRuleCount: number;
  newRuleCount: number;
  newConfidence: number;
}): GuardrailVerdict {
  const confidenceTooLow = args.newConfidence < MIN_AUTO_APPLY_CONFIDENCE;
  const ruleDropSuspicious =
    args.prevRuleCount >= 3 &&
    args.newRuleCount < args.prevRuleCount * BROKEN_DROP_THRESHOLD;
  const zeroRulesAfterPrior =
    args.newRuleCount === 0 && args.prevRuleCount > 0;
  const zeroRules = args.newRuleCount === 0;

  const shouldFlagBroken =
    confidenceTooLow || ruleDropSuspicious || zeroRules;

  if (!shouldFlagBroken) {
    return {
      shouldFlagBroken: false,
      reason: null,
      confidenceTooLow: false,
      ruleDropSuspicious: false,
      zeroRulesAfterPrior: false,
    };
  }

  const parts: string[] = [];
  if (confidenceTooLow) {
    parts.push(
      `confidence ${args.newConfidence.toFixed(2)} < ${MIN_AUTO_APPLY_CONFIDENCE}`,
    );
  }
  if (ruleDropSuspicious) {
    parts.push(
      `rule count dropped from ${args.prevRuleCount} → ${args.newRuleCount} (>${(1 - BROKEN_DROP_THRESHOLD) * 100}% drop)`,
    );
  }
  if (zeroRulesAfterPrior) {
    parts.push(`new extraction produced 0 rules (previous: ${args.prevRuleCount})`);
  }

  return {
    shouldFlagBroken,
    reason: parts.join("; ") || "broken (unknown reason)",
    confidenceTooLow,
    ruleDropSuspicious,
    zeroRulesAfterPrior,
  };
}
