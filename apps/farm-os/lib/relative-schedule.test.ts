import { describe, it, expect } from "vitest";
import { computeEffectiveDate, formatDependencyLabel } from "./relative-schedule";

describe("computeEffectiveDate", () => {
  it("returns null when there is no dependency date", () => {
    expect(computeEffectiveDate(null, 3)).toBeNull();
    expect(computeEffectiveDate(undefined, 3)).toBeNull();
    expect(computeEffectiveDate("", 3)).toBeNull();
  });

  it("returns null for an unparseable dependency date", () => {
    expect(computeEffectiveDate("not-a-date", 3)).toBeNull();
  });

  it("returns null for a non-finite offset", () => {
    expect(computeEffectiveDate("2026-07-01", NaN)).toBeNull();
    expect(computeEffectiveDate("2026-07-01", Infinity)).toBeNull();
  });

  it("adds a positive offset (N days after)", () => {
    expect(computeEffectiveDate("2026-07-01", 3)).toBe("2026-07-04");
  });

  it("subtracts a negative offset (N days before)", () => {
    expect(computeEffectiveDate("2026-07-10", -3)).toBe("2026-07-07");
  });

  it("treats a null/undefined offset as zero (same day)", () => {
    expect(computeEffectiveDate("2026-07-01", null)).toBe("2026-07-01");
    expect(computeEffectiveDate("2026-07-01", undefined)).toBe("2026-07-01");
  });

  it("crosses a month boundary correctly", () => {
    expect(computeEffectiveDate("2026-07-30", 3)).toBe("2026-08-02");
  });

  it("crosses a year boundary correctly", () => {
    expect(computeEffectiveDate("2026-12-30", 5)).toBe("2027-01-04");
  });

  it("handles an ISO timestamp dependency date the same as a date-only string", () => {
    expect(computeEffectiveDate("2026-07-01T00:00:00Z", 3)).toBe("2026-07-04");
  });

  it("is stable regardless of local timezone (UTC calendar-day arithmetic)", () => {
    // Late-in-the-day UTC timestamp must not roll over to the next calendar day.
    expect(computeEffectiveDate("2026-07-01T23:00:00Z", 1)).toBe("2026-07-02");
  });
});

describe("formatDependencyLabel", () => {
  it("formats a positive offset in Arabic with Arabic-Indic digits", () => {
    expect(formatDependencyLabel("رش المكافحة", 3)).toBe("بعد ٣ أيام من: رش المكافحة");
  });

  it("formats a negative offset as 'before' in Arabic", () => {
    expect(formatDependencyLabel("رش المكافحة", -3)).toBe("قبل ٣ أيام من: رش المكافحة");
  });

  it("uses the singular/dual day word for exactly 1 and 2 days", () => {
    expect(formatDependencyLabel("الري", 1)).toBe("بعد ١ يوم من: الري");
    expect(formatDependencyLabel("الري", 2)).toBe("بعد ٢ يومين من: الري");
  });

  it("formats a zero/null/undefined offset as same-day", () => {
    expect(formatDependencyLabel("الري", 0)).toBe("في نفس يوم: الري");
    expect(formatDependencyLabel("الري", null)).toBe("في نفس يوم: الري");
    expect(formatDependencyLabel("الري", undefined)).toBe("في نفس يوم: الري");
  });
});
