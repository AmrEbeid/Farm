import { describe, expect, it } from "vitest";
import { buildFinanceInsightSummary, computeSalesRevenueByCenter, type CostCenterInsightRollup } from "./finance-insights";

const base = {
  active: true,
  is_system: false,
  enterprise: "نخيل",
  area_feddan: 10,
  credit: 0,
  net_per_feddan: 0,
} satisfies Partial<CostCenterInsightRollup>;

describe("buildFinanceInsightSummary", () => {
  it("sums leaf centers only so parent rollups do not double count", () => {
    const summary = buildFinanceInsightSummary({
      rollup: [
        { ...base, cost_center_id: "parent", parent_id: null, code: "CC-P", name_ar: "الأصل", debit: 300, net: 300 },
        { ...base, cost_center_id: "leaf-a", parent_id: "parent", code: "CC-A", name_ar: "أ", debit: 100, net: 100 },
        { ...base, cost_center_id: "leaf-b", parent_id: "parent", code: "CC-B", name_ar: "ب", debit: 200, net: 200 },
      ] as CostCenterInsightRollup[],
      flags: [],
    });

    expect(summary.totalExpense).toBe(300);
    expect(summary.centerRows.map((row) => row.code)).toEqual(["CC-B", "CC-A"]);
  });

  it("keeps unallocated visible and produces review cards", () => {
    const summary = buildFinanceInsightSummary({
      rollup: [
        {
          ...base,
          cost_center_id: "unallocated",
          parent_id: null,
          code: "CC-UNALLOC",
          name_ar: "غير موزع",
          // debit = untagged EXPENSE; credit = untagged REVENUE (revenue is never cost-center-tagged), so
          // net (=-125) is revenue-contaminated. The unallocated figure must report the untagged COST (debit),
          // NOT the net — this fixture keeps them DIFFERENT so the check actually proves it.
          debit: 75,
          credit: 200,
          net: -125,
          is_system: true,
        },
      ] as CostCenterInsightRollup[],
      flags: [{ cost_center_id: "x", flag_code: "missing_sector_link", message_ar: "راجع الربط" }],
    });

    expect(summary.unallocatedCost).toBe(75); // untagged EXPENSE (debit), NOT the revenue-contaminated net (-125)
    expect(summary.flagCount).toBe(1);
    expect(summary.score.tone).toBe("warning");
    expect(summary.cards.map((card) => card.id)).toContain("unallocated");
    expect(summary.cards.map((card) => card.id)).toContain("flags");

    // Card values must be Arabic-Indic formatted, never raw Western digits (non-negotiable #2).
    const flagsCard = summary.cards.find((card) => card.id === "flags");
    const unallocatedCard = summary.cards.find((card) => card.id === "unallocated");
    expect(flagsCard?.value).toBe("١"); // num(1)
    expect(unallocatedCard?.value).toBe("٧٥ ج.م"); // egp(75)
    for (const value of [flagsCard?.value, unallocatedCard?.value]) {
      expect(value).not.toMatch(/[0-9]/);
    }
  });

  it("sources per-center revenue from sales, not the always-0 GL credit (#701)", () => {
    // The GL credit is 0 on every real center (the revenue line is never cost-center-tagged), so
    // without salesRevenue the center would read revenue 0 and net = -expense. With the sale-sourced
    // map, revenue must reflect the sale and net = revenue - expense.
    const rollup = [
      { ...base, cost_center_id: "leaf-a", parent_id: null, code: "CC-A", name_ar: "أ", debit: 400, credit: 0, net: -400 },
    ] as CostCenterInsightRollup[];
    const salesRevenue = { byCenter: { "leaf-a": 1000 }, total: 1000 };

    const gl = buildFinanceInsightSummary({ rollup, flags: [] });
    expect(gl.centerRows[0].revenue).toBe(0); // proves the bug it fixes
    expect(gl.totalRevenue).toBe(0);

    const fixed = buildFinanceInsightSummary({ rollup, flags: [], salesRevenue });
    expect(fixed.centerRows[0].revenue).toBe(1000);
    expect(fixed.centerRows[0].net).toBe(600); // 1000 revenue - 400 expense
    expect(fixed.centerRows[0].netPerFeddan).toBe(60); // net 600 / area 10
    expect(fixed.totalRevenue).toBe(1000);
    expect(fixed.operatingNet).toBe(600);
    // Real revenue means the "الإيرادات غير مفعلة" placeholder card no longer shows (gated on totalRevenue===0).
    expect(fixed.cards.map((c) => c.id)).not.toContain("revenue-pending");
  });

  it("surfaces untagged (null-center) sale revenue so per-center reconciles to the total (#701 review)", () => {
    const rollup = [
      { ...base, cost_center_id: "leaf-a", parent_id: null, code: "CC-A", name_ar: "أ", debit: 400, credit: 0, net: -400 },
    ] as CostCenterInsightRollup[];
    // total 1200 but only 1000 attributed to a center → 200 is untagged and must be surfaced.
    const summary = buildFinanceInsightSummary({ rollup, flags: [], salesRevenue: { byCenter: { "leaf-a": 1000 }, total: 1200 } });
    expect(summary.unallocatedRevenue).toBe(200);
    const card = summary.cards.find((c) => c.id === "unallocated-revenue");
    expect(card?.value).toBe("٢٠٠ ج.م"); // egp(200) — Arabic-Indic
    expect(card?.value).not.toMatch(/[0-9]/); // Arabic-Indic only (#2)
    // Fully-attributed revenue shows no residual card.
    const clean = buildFinanceInsightSummary({ rollup, flags: [], salesRevenue: { byCenter: { "leaf-a": 1000 }, total: 1000 } });
    expect(clean.unallocatedRevenue).toBe(0);
    expect(clean.cards.map((c) => c.id)).not.toContain("unallocated-revenue");
  });
});

describe("computeSalesRevenueByCenter", () => {
  const sales = [
    { id: "s1", cost_center_id: "a", total: 1000, price_status: "finalized" },
    { id: "s2", cost_center_id: "a", total: 500, price_status: "finalized" },
    { id: "s3", cost_center_id: "b", total: 300, price_status: "finalized" },
    { id: "s4", cost_center_id: null, total: 200, price_status: "finalized" }, // untagged
    { id: "s5", cost_center_id: "a", total: 999, price_status: "pending" }, // not finalized → ignored
  ];

  it("sums finalized live-posted sales by center; total includes untagged, byCenter omits it", () => {
    const live = new Set(["s1", "s2", "s3", "s4"]);
    const { byCenter, total } = computeSalesRevenueByCenter(sales, live);
    expect(byCenter).toEqual({ a: 1500, b: 300 });
    expect(total).toBe(2000); // 1000+500+300+200 (untagged counts toward total, not byCenter)
  });

  it("excludes a finalized-but-reversed/void sale (no live posted entry) so revenue can't be overstated (#701)", () => {
    // s2 is finalized in the sales table but its journal was reversed → not in the live-posted set.
    const live = new Set(["s1", "s3", "s4"]);
    const { byCenter, total } = computeSalesRevenueByCenter(sales, live);
    expect(byCenter).toEqual({ a: 1000, b: 300 });
    expect(total).toBe(1500); // s2's 500 excluded, tying to the posted GL
  });
});
