import { describe, it, expect } from "vitest";
import { computePnl, type ExpenseEntry } from "./pnl";

describe("computePnl — operating P&L with drawings separation (SPEC-0004 / #6)", () => {
  const expenses: ExpenseEntry[] = [
    { category: "أسمدة", amount: 1000, kind: "operating" },
    { category: "أسمدة", amount: 500, kind: "operating" },
    { category: "عمالة", amount: 800, kind: "operating" },
    { category: "مسحوبات المالك", amount: 5000, kind: "drawing" }, // EXCLUDED from opex (#6)
    { category: "جرار جديد", amount: 20000, kind: "capex" }, // EXCLUDED from operating P&L
  ];
  const sales = [{ amount: 4000, crop: "برحي" }, { amount: 1000, crop: "برحي" }];

  it("operating expenses EXCLUDE drawings and capex (non-negotiable #6)", () => {
    const p = computePnl(expenses, sales);
    expect(p.operatingExpenses).toBe(2300); // 1000+500+800 — NOT the 5000 drawing or 20000 capex
    expect(p.drawings).toBe(5000);
    expect(p.capex).toBe(20000);
  });

  it("net operating = revenue − operating expenses (drawings never netted in)", () => {
    const p = computePnl(expenses, sales);
    expect(p.revenue).toBe(5000);
    expect(p.netOperating).toBe(2700); // 5000 − 2300; the 5000 drawing does NOT reduce it
  });

  it("byCategory is operating-only, aggregated and sorted", () => {
    const p = computePnl(expenses, sales);
    expect(p.byCategory).toEqual([
      { category: "أسمدة", operating: 1500 },
      { category: "عمالة", operating: 800 },
    ]);
    // no drawing/capex category leaks into the operating breakdown
    expect(p.byCategory.find((c) => c.category.includes("مسحوبات"))).toBeUndefined();
  });

  it("ignores invalid/negative amounts (no fabrication, #1)", () => {
    const p = computePnl(
      [
        { category: "x", amount: 100, kind: "operating" },
        { category: "x", amount: -50, kind: "operating" }, // ignored
        { category: "x", amount: NaN, kind: "operating" }, // ignored
      ],
      [{ amount: 0 }],
    );
    expect(p.operatingExpenses).toBe(100);
    expect(p.revenue).toBe(0);
  });

  it("uncategorised operating expense falls into 'غير مصنّف', never dropped", () => {
    const p = computePnl([{ category: "", amount: 200, kind: "operating" }], []);
    expect(p.byCategory).toEqual([{ category: "غير مصنّف", operating: 200 }]);
    expect(p.netOperating).toBe(-200);
  });
});
