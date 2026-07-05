import { describe, it, expect } from "vitest";
import { parseBalanceSheet } from "@/lib/balance-sheet";

describe("parseBalanceSheet", () => {
  it("parses a full fn_accounting_balance_sheet payload", () => {
    const bs = parseBalanceSheet({
      as_of: "2026-03-31",
      assets: [{ code: "1000", name_ar: "عهدة نقدية", balance: 12000 }],
      liabilities: [],
      equity: [{ code: "3000", name_ar: "تمويل المالك", balance: 10000, kind: null }],
      assets_total: 12000,
      liabilities_total: 0,
      equity_total: 10000,
      drawings_total: 0,
      revenue_total: 5000,
      expense_total: 3000,
      net_income: 2000,
      total_equity_incl_income: 12000,
      liabilities_plus_equity: 12000,
      balanced: true,
    });
    expect(bs.asOf).toBe("2026-03-31");
    expect(bs.assets).toHaveLength(1);
    expect(bs.assets[0]).toEqual({ code: "1000", nameAr: "عهدة نقدية", balance: 12000, kind: null });
    expect(bs.assetsTotal).toBe(12000);
    expect(bs.netIncome).toBe(2000);
    expect(bs.balanced).toBe(true);
  });

  it("coerces missing/malformed fields to safe defaults (0 / [] / false, never NaN)", () => {
    const bs = parseBalanceSheet({ assets_total: "not-a-number", assets: "oops" });
    expect(bs.assetsTotal).toBe(0);
    expect(Number.isNaN(bs.assetsTotal)).toBe(false);
    expect(bs.assets).toEqual([]);
    expect(bs.liabilities).toEqual([]);
    expect(bs.asOf).toBeNull();
    expect(bs.balanced).toBe(false);
  });

  it("treats null/non-object input as an empty, balanced-false sheet", () => {
    for (const bad of [null, undefined, 42, [1, 2]]) {
      const bs = parseBalanceSheet(bad);
      expect(bs.assetsTotal).toBe(0);
      expect(bs.equity).toEqual([]);
      expect(bs.balanced).toBe(false);
    }
  });

  it("reads numeric strings (jsonb numerics arrive as strings) and keeps the drawing kind", () => {
    const bs = parseBalanceSheet({
      equity: [{ code: "3100", name_ar: "مسحوبات المالك", balance: "-2000", kind: "drawing" }],
      drawings_total: "2000",
      equity_total: "-2000",
    });
    expect(bs.equity[0].kind).toBe("drawing");
    expect(bs.equity[0].balance).toBe(-2000);
    expect(bs.drawingsTotal).toBe(2000);
    expect(bs.equityTotal).toBe(-2000);
  });
});
