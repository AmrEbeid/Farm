import { describe, expect, it } from "vitest";
import { computeSprayComplianceWindow } from "./spray-compliance";

describe("computeSprayComplianceWindow", () => {
  it("returns null windows when the operation has not been executed yet (no occurredAt)", () => {
    const result = computeSprayComplianceWindow({ occurredAt: null, reiHours: 48, phiDays: 14 });
    expect(result).toEqual({
      safeReentryAt: null,
      earliestSafeHarvestAt: null,
      withinReentryWindow: false,
      withinHarvestWindow: false,
    });
  });

  it("returns null windows when reiHours/phiDays are unset — never guesses a value (non-negotiable #1)", () => {
    const result = computeSprayComplianceWindow({
      occurredAt: "2026-07-01T10:00:00.000Z",
      reiHours: null,
      phiDays: undefined,
    });
    expect(result.safeReentryAt).toBeNull();
    expect(result.earliestSafeHarvestAt).toBeNull();
    expect(result.withinReentryWindow).toBe(false);
    expect(result.withinHarvestWindow).toBe(false);
  });

  it("computes safeReentryAt as occurredAt + reiHours", () => {
    const result = computeSprayComplianceWindow(
      { occurredAt: "2026-07-01T10:00:00.000Z", reiHours: 48, phiDays: null },
      new Date("2026-07-01T12:00:00.000Z"),
    );
    expect(result.safeReentryAt).toBe("2026-07-03T10:00:00.000Z");
  });

  it("computes earliestSafeHarvestAt as occurredAt + phiDays", () => {
    const result = computeSprayComplianceWindow(
      { occurredAt: "2026-07-01T10:00:00.000Z", reiHours: null, phiDays: 14 },
      new Date("2026-07-01T12:00:00.000Z"),
    );
    expect(result.earliestSafeHarvestAt).toBe("2026-07-15T10:00:00.000Z");
  });

  it("flags withinReentryWindow=true while now is still inside the REI window", () => {
    const result = computeSprayComplianceWindow(
      { occurredAt: "2026-07-01T10:00:00.000Z", reiHours: 48, phiDays: null },
      new Date("2026-07-02T00:00:00.000Z"), // 14h in, well before the 48h mark
    );
    expect(result.withinReentryWindow).toBe(true);
  });

  it("flags withinReentryWindow=false once now is past the REI window", () => {
    const result = computeSprayComplianceWindow(
      { occurredAt: "2026-07-01T10:00:00.000Z", reiHours: 48, phiDays: null },
      new Date("2026-07-04T00:00:00.000Z"), // well past 48h
    );
    expect(result.withinReentryWindow).toBe(false);
  });

  it("flags withinHarvestWindow=true while now is still inside the PHI window", () => {
    const result = computeSprayComplianceWindow(
      { occurredAt: "2026-07-01T10:00:00.000Z", reiHours: null, phiDays: 14 },
      new Date("2026-07-05T00:00:00.000Z"),
    );
    expect(result.withinHarvestWindow).toBe(true);
  });

  it("flags withinHarvestWindow=false once now is past the PHI window", () => {
    const result = computeSprayComplianceWindow(
      { occurredAt: "2026-07-01T10:00:00.000Z", reiHours: null, phiDays: 14 },
      new Date("2026-07-20T00:00:00.000Z"),
    );
    expect(result.withinHarvestWindow).toBe(false);
  });

  it("treats a negative reiHours/phiDays as unset rather than manufacturing a false verdict", () => {
    const result = computeSprayComplianceWindow(
      { occurredAt: "2026-07-01T10:00:00.000Z", reiHours: -5, phiDays: -1 },
      new Date("2026-07-01T12:00:00.000Z"),
    );
    expect(result.safeReentryAt).toBeNull();
    expect(result.earliestSafeHarvestAt).toBeNull();
  });

  it("treats an invalid occurredAt string as not-yet-executed", () => {
    const result = computeSprayComplianceWindow({
      occurredAt: "not-a-date",
      reiHours: 48,
      phiDays: 14,
    });
    expect(result.safeReentryAt).toBeNull();
    expect(result.earliestSafeHarvestAt).toBeNull();
  });

  it("computes both windows together for a real spray record", () => {
    const result = computeSprayComplianceWindow(
      { occurredAt: "2026-07-01T18:00:00.000Z", reiHours: 24, phiDays: 7 },
      new Date("2026-07-02T10:00:00.000Z"),
    );
    expect(result.safeReentryAt).toBe("2026-07-02T18:00:00.000Z");
    expect(result.earliestSafeHarvestAt).toBe("2026-07-08T18:00:00.000Z");
    expect(result.withinReentryWindow).toBe(true); // 16h in, before the 24h mark
    expect(result.withinHarvestWindow).toBe(true); // well before the 7-day mark
  });
});
