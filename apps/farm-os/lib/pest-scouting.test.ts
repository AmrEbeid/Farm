import { describe, it, expect } from "vitest";
import { trapStatus } from "./pest-scouting";

const NOW = new Date("2026-04-01T00:00:00Z"); // fixed "today" for deterministic assertions

describe("trapStatus", () => {
  it("flags needsLureChange once >90 days have passed since lure_changed_at", () => {
    const justOver = trapStatus(
      { installedAt: "2025-01-01", lureChangedAt: "2025-12-31", lastCheckedAt: "2026-03-31", status: "active" },
      NOW,
    );
    expect(justOver.daysSinceLureChange).toBe(91);
    expect(justOver.needsLureChange).toBe(true);
  });

  it("does NOT flag needsLureChange at exactly 90 days (boundary is strictly >90)", () => {
    const exact90 = trapStatus(
      { installedAt: "2025-01-01", lureChangedAt: "2026-01-01", lastCheckedAt: "2026-03-31", status: "active" },
      NOW,
    );
    expect(exact90.daysSinceLureChange).toBe(90);
    expect(exact90.needsLureChange).toBe(false);
  });

  it("falls back to installedAt when lureChangedAt is null (never changed yet)", () => {
    const neverChanged = trapStatus(
      { installedAt: "2025-01-01", lureChangedAt: null, lastCheckedAt: "2026-03-31", status: "active" },
      NOW,
    );
    expect(neverChanged.daysSinceLureChange).toBe(daysBetween("2025-01-01", NOW));
    expect(neverChanged.needsLureChange).toBe(true);
  });

  it("flags overdueCheck once >10 days have passed since the last catch log", () => {
    const overdue = trapStatus(
      { installedAt: "2026-01-01", lureChangedAt: "2026-01-01", lastCheckedAt: "2026-03-20", status: "active" },
      NOW,
    );
    expect(overdue.daysSinceLastCheck).toBe(12);
    expect(overdue.overdueCheck).toBe(true);
  });

  it("does NOT flag overdueCheck at exactly 10 days (boundary is strictly >10)", () => {
    const exact10 = trapStatus(
      { installedAt: "2026-01-01", lureChangedAt: "2026-01-01", lastCheckedAt: "2026-03-22", status: "active" },
      NOW,
    );
    expect(exact10.daysSinceLastCheck).toBe(10);
    expect(exact10.overdueCheck).toBe(false);
  });

  it("falls back to installedAt when lastCheckedAt is null (never checked yet)", () => {
    const neverChecked = trapStatus(
      { installedAt: "2026-03-01", lureChangedAt: "2026-03-01", lastCheckedAt: null, status: "active" },
      NOW,
    );
    expect(neverChecked.daysSinceLastCheck).toBe(31);
    expect(neverChecked.overdueCheck).toBe(true);
  });

  it("a fresh trap (installed today, no catches yet) is not overdue", () => {
    const fresh = trapStatus(
      { installedAt: "2026-04-01", lureChangedAt: "2026-04-01", lastCheckedAt: null, status: "active" },
      NOW,
    );
    expect(fresh.overdueCheck).toBe(false);
    expect(fresh.needsLureChange).toBe(false);
  });

  it("never flags a removed trap, no matter how stale its dates are", () => {
    const removed = trapStatus(
      { installedAt: "2020-01-01", lureChangedAt: "2020-01-01", lastCheckedAt: "2020-01-01", status: "removed" },
      NOW,
    );
    expect(removed.needsLureChange).toBe(false);
    expect(removed.overdueCheck).toBe(false);
    // days-since figures are still reported (real data), just not flagged as actionable.
    expect(removed.daysSinceLureChange).toBeGreaterThan(90);
  });
});

function daysBetween(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
}
