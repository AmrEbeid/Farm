import { describe, it, expect } from "vitest";
import { parseBudgetVsActual } from "@/lib/budget-vs-actual";

describe("parseBudgetVsActual", () => {
  it("parses a full fn_budget_vs_actual payload", () => {
    const bva = parseBudgetVsActual({
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      lines: [
        { category: "أسمدة", planned: 10000, actual: 7000, variance: 3000, over_budget: false, unbudgeted: false },
        { category: "وقود", planned: 0, actual: 2000, variance: -2000, over_budget: false, unbudgeted: true },
      ],
      planned_total: 10000,
      actual_total: 9000,
      variance_total: 1000,
    });
    expect(bva.periodStart).toBe("2026-03-01");
    expect(bva.lines).toHaveLength(2);
    expect(bva.lines[0]).toEqual({ category: "أسمدة", planned: 10000, actual: 7000, variance: 3000, overBudget: false, unbudgeted: false });
    expect(bva.lines[1].unbudgeted).toBe(true);
    expect(bva.varianceTotal).toBe(1000);
  });

  it("coerces missing/malformed fields to safe defaults (0 / [], never NaN)", () => {
    const bva = parseBudgetVsActual({ planned_total: "nope", lines: "oops" });
    expect(bva.plannedTotal).toBe(0);
    expect(Number.isNaN(bva.plannedTotal)).toBe(false);
    expect(bva.lines).toEqual([]);
    expect(bva.periodStart).toBeNull();
  });

  it("treats null/non-object input as an empty report", () => {
    for (const bad of [null, undefined, 9, [1]]) {
      const bva = parseBudgetVsActual(bad);
      expect(bva.plannedTotal).toBe(0);
      expect(bva.lines).toEqual([]);
    }
  });

  it("reads numeric strings and boolean flags from jsonb", () => {
    const bva = parseBudgetVsActual({
      lines: [{ category: "وقود", planned: "5000", actual: "6000", variance: "-1000", over_budget: true, unbudgeted: false }],
      planned_total: "5000",
    });
    expect(bva.lines[0].planned).toBe(5000);
    expect(bva.lines[0].actual).toBe(6000);
    expect(bva.lines[0].variance).toBe(-1000);
    expect(bva.lines[0].overBudget).toBe(true);
    expect(bva.plannedTotal).toBe(5000);
  });
});
