import { describe, expect, it } from "vitest";
import { formatDistanceMeters, formatRelativeDays } from "./format";

// First test in the project — establishes the Vitest harness (plan L11). The
// codebase had zero automated tests, which is part of how the geo-tz 500 and
// the v2 regression shipped unnoticed. format.ts is pure (no deps), so it's a
// safe, fast first guard; P1/P2 add resolution + status-derivation tests.

describe("formatDistanceMeters", () => {
  it("shows meters under 0.1 mi", () => {
    expect(formatDistanceMeters(50)).toBe("50 m");
  });
  it("shows one decimal under 10 mi", () => {
    expect(formatDistanceMeters(1609.344)).toBe("1.0 mi");
  });
  it("rounds to whole miles at/above 10 mi", () => {
    expect(formatDistanceMeters(1609.344 * 12.4)).toBe("12 mi");
  });
});

describe("formatRelativeDays", () => {
  const now = new Date("2026-06-07T12:00:00Z");
  it("'just now' under an hour", () => {
    expect(formatRelativeDays(new Date("2026-06-07T11:30:00Z"), now)).toBe("just now");
  });
  it("hours under a day", () => {
    expect(formatRelativeDays(new Date("2026-06-07T09:00:00Z"), now)).toBe("3h ago");
  });
  it("days under two weeks", () => {
    expect(formatRelativeDays(new Date("2026-06-04T12:00:00Z"), now)).toBe("3d ago");
  });
  it("weeks beyond two", () => {
    expect(formatRelativeDays(new Date("2026-05-10T12:00:00Z"), now)).toBe("4 weeks ago");
  });
});
