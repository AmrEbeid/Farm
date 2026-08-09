import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isIsoCalendarDate,
  legacyPnlRedirectHref,
  legacyPnlTrendRedirectHref,
  normalizeFinanceReportDateRange,
} from "./finance report routing";

const readAppFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("canonical finance report routing", () => {
  it("preserves valid legacy P&L dates on the trusted income statement", () => {
    expect(legacyPnlRedirectHref({ from: "2026-01-01", to: "2026-08-08" })).toBe(
      "/finance/income-statement?start=2026-01-01&end=2026-08-08",
    );
    expect(legacyPnlRedirectHref({ from: "2024-02-29" })).toBe(
      "/finance/income-statement?start=2024-02-29",
    );
  });

  it("preserves only a valid scalar grain on the legacy trend route", () => {
    expect(legacyPnlTrendRedirectHref("year")).toBe("/finance/income-statement?view=trend&grain=year");
    expect(legacyPnlTrendRedirectHref("month")).toBe("/finance/income-statement?view=trend&grain=month");
    expect(legacyPnlTrendRedirectHref(["year", "month"])).toBe(
      "/finance/income-statement?view=trend&grain=month",
    );
  });

  it("drops malformed and impossible dates", () => {
    for (const invalid of [undefined, "", "2026-2-01", "2026-02-30", "2026-13-01", ["2026-01-01", "2026-02-01"]]) {
      expect(isIsoCalendarDate(invalid)).toBe(false);
    }
    expect(legacyPnlRedirectHref({ from: "2026-02-30", to: "not-a-date" })).toBe(
      "/finance/income-statement",
    );
    expect(legacyPnlRedirectHref({ from: ["2026-01-01", "2026-02-01"] })).toBe(
      "/finance/income-statement",
    );
    expect(legacyPnlRedirectHref({ from: "2026-08-01", to: "2026-01-31" })).toBe(
      "/finance/income-statement",
    );
  });

  it("never sends a reversed or partial historical range to the statement RPC", () => {
    const defaults = { fallbackStart: "2026-08-01", fallbackEnd: "2026-08-08" };
    expect(normalizeFinanceReportDateRange({ start: "2026-08-05", end: "2026-08-01", ...defaults })).toEqual({
      start: defaults.fallbackStart,
      end: defaults.fallbackEnd,
    });
    expect(normalizeFinanceReportDateRange({ start: undefined, end: "2025-12-31", ...defaults })).toEqual({
      start: defaults.fallbackStart,
      end: defaults.fallbackEnd,
    });
    expect(normalizeFinanceReportDateRange({ start: "2026-08-02", end: undefined, ...defaults })).toEqual({
      start: "2026-08-02",
      end: defaults.fallbackEnd,
    });
  });

  it("keeps one canonical launcher and removes stale revenue-model copy", () => {
    const hub = readAppFile("app/(app)/reports/page.tsx");
    const legacyPage = readAppFile("app/(app)/finance/pnl/page.tsx");
    const legacyTrendPage = readAppFile("app/(app)/finance/pnl-trend/page.tsx");
    const costCenterReport = readAppFile("app/(app)/finance/reports/page.tsx");

    expect(hub).toContain('href: "/finance/income-statement"');
    expect(hub).not.toContain('href: "/finance/pnl"');
    expect(hub).not.toContain('href: "/finance/pnl-trend"');
    expect(hub).not.toContain("ملخص التشغيل القديم");
    expect(legacyPage).toContain("redirect(legacyPnlRedirectHref(await searchParams))");
    expect(legacyTrendPage).toContain("legacyPnlTrendRedirectHref");
    expect(legacyPage).toContain('requireRole(["owner", "accountant"])');
    expect(legacyTrendPage).toContain('requireRole(["owner", "accountant"])');
    expect(`${hub}\n${legacyPage}\n${costCenterReport}`).not.toContain("لا يوجد نموذج إيرادات بعد");
  });
});
