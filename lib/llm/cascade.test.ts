import { describe, expect, it } from "vitest";
import { isTransientCascadeFailure, type CascadeAttempt, type CascadeResult } from "./cascade";

function failed(attempts: CascadeAttempt[]): CascadeResult {
  return {
    strategy: "failed",
    extraction: null,
    model: null,
    pageContentHash: null,
    usage: {},
    winningUrl: "https://example.org",
    attempts,
  };
}

describe("isTransientCascadeFailure", () => {
  it("true for a 429 / rate_limit in errorMessage (the 2026-05-24 mechanism)", () => {
    expect(
      isTransientCascadeFailure(
        failed([
          {
            strategy: "html",
            status: "extract_failed",
            rulesCount: 0,
            confidence: null,
            errorMessage: "Haiku agent loop failed: 429 rate_limit_error",
          },
        ]),
      ),
    ).toBe(true);
  });

  it("true for an httpStatus 5xx", () => {
    expect(
      isTransientCascadeFailure(
        failed([
          { strategy: "html", status: "fetch_failed", rulesCount: 0, confidence: null, httpStatus: 503 },
        ]),
      ),
    ).toBe(true);
  });

  it("false for a genuine no-schedule extraction (terminal)", () => {
    expect(
      isTransientCascadeFailure(
        failed([{ strategy: "html", status: "extracted", rulesCount: 0, confidence: 0.1 }]),
      ),
    ).toBe(false);
  });

  it("false for the cost-gate skip (a deliberate bail, not transient)", () => {
    expect(
      isTransientCascadeFailure(
        failed([
          {
            strategy: "failed",
            status: "skipped",
            rulesCount: 0,
            confidence: null,
            errorMessage: "daily LLM budget exceeded (today $30.00 / cap $25.00)",
          },
        ]),
      ),
    ).toBe(false);
  });

  it("false when the cascade did not fail", () => {
    expect(isTransientCascadeFailure({ ...failed([]), strategy: "html" })).toBe(false);
  });
});
