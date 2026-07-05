import { describe, it, expect } from "vitest";
import { parseIncomeStatement } from "@/lib/income-statement";

describe("parseIncomeStatement", () => {
  it("parses a full fn_accounting_income_statement payload", () => {
    const is = parseIncomeStatement({
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      revenue: [{ code: "4000", name_ar: "إيرادات", amount: 5000 }],
      expenses: [{ code: "5000", name_ar: "مصروفات تشغيلية", amount: 3000, kind: "operating" }],
      revenue_total: 5000,
      expenses_total: 3000,
      operating_expenses: 3000,
      net_income: 2000,
    });
    expect(is.periodStart).toBe("2026-03-01");
    expect(is.revenue[0]).toEqual({ code: "4000", nameAr: "إيرادات", amount: 5000, kind: null });
    expect(is.expenses[0].kind).toBe("operating");
    expect(is.revenueTotal).toBe(5000);
    expect(is.expensesTotal).toBe(3000);
    expect(is.netIncome).toBe(2000);
  });

  it("coerces missing/malformed fields to safe defaults (0 / [], never NaN)", () => {
    const is = parseIncomeStatement({ revenue_total: "nope", revenue: "oops" });
    expect(is.revenueTotal).toBe(0);
    expect(Number.isNaN(is.revenueTotal)).toBe(false);
    expect(is.revenue).toEqual([]);
    expect(is.expenses).toEqual([]);
    expect(is.periodStart).toBeNull();
    expect(is.netIncome).toBe(0);
  });

  it("treats null/non-object input as an empty statement", () => {
    for (const bad of [null, undefined, 7, [1]]) {
      const is = parseIncomeStatement(bad);
      expect(is.revenueTotal).toBe(0);
      expect(is.expenses).toEqual([]);
      expect(is.netIncome).toBe(0);
    }
  });

  it("reads numeric strings (jsonb numerics arrive as strings)", () => {
    const is = parseIncomeStatement({
      revenue_total: "5000",
      expenses_total: "3000",
      net_income: "2000",
      expenses: [{ code: "5000", name_ar: "م", amount: "3000", kind: "operating" }],
    });
    expect(is.revenueTotal).toBe(5000);
    expect(is.expensesTotal).toBe(3000);
    expect(is.netIncome).toBe(2000);
    expect(is.expenses[0].amount).toBe(3000);
  });
});
