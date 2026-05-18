// Tool: validateRule
//
// Claude calls this mid-extraction to sanity-check a proposed rule
// against local heuristics. Returns warnings the model can act on
// before emitting the final extraction. No network calls; pure logic.

import type Anthropic from "@anthropic-ai/sdk";

export interface ValidateRuleArgs {
  rule: {
    tefillah: string;
    daysOfWeek?: number[];
    time:
      | { kind: "fixed"; clock: string }
      | { kind: "zmanim"; anchor: string; offsetMin: number };
    validFrom?: string;
    validTo?: string;
    specialScheduleKind?: string;
  };
}

export interface ValidateRuleResult {
  warnings: string[];
  blocking: string[];
}

export async function validateRule(
  args: ValidateRuleArgs,
): Promise<ValidateRuleResult> {
  const warnings: string[] = [];
  const blocking: string[] = [];
  const r = args.rule;

  // Time format checks
  if (r.time.kind === "fixed") {
    const m = /^(\d{1,2}):(\d{2})$/.exec(r.time.clock);
    if (!m) {
      blocking.push(`clock '${r.time.clock}' must match HH:MM (24-hour)`);
    } else {
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h > 23 || min > 59) {
        blocking.push(`clock '${r.time.clock}' has invalid hour or minute`);
      }
      // Suspicious-time heuristics
      if (h >= 0 && h < 4) {
        warnings.push(
          `clock '${r.time.clock}' is ${h}:${m[2]} AM — unusual for a minyan, confirm`,
        );
      }
      if (r.tefillah === "shacharis" && h >= 12) {
        warnings.push(
          `Shacharis at ${r.time.clock} (after noon) — Shacharis is morning; confirm tefillah type`,
        );
      }
      if (r.tefillah === "mincha" && (h < 11 || h >= 22)) {
        warnings.push(
          `Mincha at ${r.time.clock} — Mincha is afternoon (typically 12:00-21:00); confirm`,
        );
      }
      if (r.tefillah === "maariv" && h >= 4 && h < 16) {
        warnings.push(
          `Maariv at ${r.time.clock} — Maariv is evening (typically after 17:00); confirm`,
        );
      }
    }
  } else {
    // zmanim
    if (Math.abs(r.time.offsetMin) > 120) {
      warnings.push(
        `offsetMin of ${r.time.offsetMin} is more than 2 hours from the anchor — unusual, confirm`,
      );
    }
  }

  // Days-of-week checks
  if (r.daysOfWeek && r.daysOfWeek.length === 0) {
    warnings.push(
      "daysOfWeek is an empty array — either omit it or list at least one day",
    );
  }
  if (r.daysOfWeek) {
    const invalid = r.daysOfWeek.filter((d) => d < 0 || d > 6);
    if (invalid.length > 0) {
      blocking.push(
        `daysOfWeek contains invalid day(s): ${invalid.join(", ")}. Must be 0-6.`,
      );
    }
  }

  // Date-range checks for date-bounded rules
  if (r.validFrom || r.validTo) {
    if (
      r.validFrom &&
      r.validTo &&
      r.validFrom > r.validTo
    ) {
      blocking.push(
        `validFrom (${r.validFrom}) is after validTo (${r.validTo})`,
      );
    }
    if (!r.specialScheduleKind || r.specialScheduleKind === "regular") {
      warnings.push(
        "validFrom/validTo set but specialScheduleKind is 'regular' or missing — date-bounded rules should be tagged with a special kind",
      );
    }
  }
  if (
    r.specialScheduleKind &&
    r.specialScheduleKind !== "regular" &&
    !r.validFrom
  ) {
    warnings.push(
      `specialScheduleKind '${r.specialScheduleKind}' typically requires a validFrom date`,
    );
  }

  // Days + dates combo
  if (r.daysOfWeek && (r.validFrom || r.validTo)) {
    warnings.push(
      "rule has BOTH daysOfWeek and validFrom/validTo — usually one or the other, not both",
    );
  }

  return { warnings, blocking };
}

export const validateRuleTool: Anthropic.Messages.Tool = {
  name: "validateRule",
  description:
    "Run local sanity checks against a proposed rule. Returns warnings (suspicious but not invalid — e.g. Mincha at 2 AM) and blocking issues (must fix before emitting — e.g. invalid clock format). Use this before adding a rule to the final extraction.",
  input_schema: {
    type: "object",
    properties: {
      rule: {
        type: "object",
        description:
          "The rule object to validate. Same shape as a rule in the extraction output.",
      },
    },
    required: ["rule"],
  },
};
