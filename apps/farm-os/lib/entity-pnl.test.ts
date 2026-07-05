import { describe, it, expect } from "vitest";
import { computeSectorPnl, computeEnterprisePnl, type SaleLite } from "./entity-pnl";
import type { CostCenterInsightRollup } from "./finance-insights";

const cc = (over: Partial<CostCenterInsightRollup>): CostCenterInsightRollup => ({
  cost_center_id: "x",
  parent_id: null,
  code: "CC-X",
  name_ar: "س",
  enterprise: null,
  area_feddan: null,
  active: true,
  is_system: false,
  debit: 0,
  credit: 0,
  net: 0,
  net_per_feddan: null,
  ...over,
});

// A realistic rollup: a parent (non-leaf), two leaf sectors with enterprises, a leaf non-sector center, a leaf
// with no enterprise, and the system CC-UNALLOC whose net is REVENUE-CONTAMINATED (debit 200k − all revenue).
const rollup: CostCenterInsightRollup[] = [
  cc({ cost_center_id: "P", code: "CC-P" }), // a parent
  cc({ cost_center_id: "S1", parent_id: "P", code: "CC-S1", name_ar: "ال 22 فدان", enterprise: "برحي", area_feddan: 22, net: 1_150_000, debit: 1_150_000 }),
  cc({ cost_center_id: "S2", parent_id: "P", code: "CC-S2", name_ar: "الحصوة", enterprise: "بنجر", area_feddan: 30, net: 464_925, debit: 464_925 }),
  cc({ cost_center_id: "S3", code: "CC-S3", name_ar: "عام", enterprise: "عام", area_feddan: null, net: 100_000, debit: 100_000 }), // leaf, no area
  cc({ cost_center_id: "S4", code: "CC-S4", name_ar: "قطاع بلا محصول", enterprise: null, area_feddan: 5, net: 50_000, debit: 50_000 }), // leaf, no enterprise
  cc({ cost_center_id: "U", code: "CC-UNALLOC", name_ar: "غير موزّع", is_system: true, debit: 200_000, credit: 6_458_067, net: 200_000 - 6_458_067 }),
];
// P must look like a parent: give it a child (S1/S2 have parent_id 'P'), so P is excluded as non-leaf.

const sales: SaleLite[] = [
  { cost_center_id: "S1", total: 4_000_000, price_status: "finalized" },
  { cost_center_id: "S2", total: 2_308_067, price_status: "finalized" },
  { cost_center_id: null, total: 300_000, price_status: "finalized" }, // no center → unallocated
  { cost_center_id: "S3", total: 150_000, price_status: "finalized" }, // non-sector (no area) center
];

describe("computeSectorPnl", () => {
  const r = computeSectorPnl(rollup, sales);
  it("computes profit = revenue − expenses (not cost-as-profit), for area leaf sectors only", () => {
    const s1 = r.sectors.find((s) => s.id === "S1")!;
    const s2 = r.sectors.find((s) => s.id === "S2")!;
    const s4 = r.sectors.find((s) => s.id === "S4")!;
    expect(s1.net).toBe(4_000_000 - 1_150_000); // 2.85M profit
    expect(s2.net).toBe(2_308_067 - 464_925); // 1.843M
    expect(s4.net).toBe(0 - 50_000); // no sales, has area → a loss, not dropped
    expect(r.sectors.map((s) => s.id).sort()).toEqual(["S1", "S2", "S4"]); // S3 (no area) + P (parent) excluded
  });
  it("uses CC-UNALLOC.debit for untagged expense (NOT its revenue-contaminated net)", () => {
    expect(r.unallocExpense).toBe(200_000); // debit, positive — not the huge-negative net
  });
  it("routes non-sector revenue (null center OR non-sector center) to unallocRevenue, never vanishing", () => {
    expect(r.unallocRevenue).toBe(300_000 + 150_000); // null-center + the S3 (non-sector) sale
  });
});

describe("computeEnterprisePnl", () => {
  const r = computeEnterprisePnl(rollup, sales);
  const byKey = (k: string) => r.enterprises.find((e) => e.key === k)!;
  it("groups expenses + revenue by enterprise across leaf centers", () => {
    expect(byKey("برحي")).toMatchObject({ revenue: 4_000_000, expenses: 1_150_000 });
    expect(byKey("بنجر")).toMatchObject({ revenue: 2_308_067, expenses: 464_925 });
    expect(byKey("عام")).toMatchObject({ revenue: 150_000, expenses: 100_000 });
  });
  it("untagged expense = CC-UNALLOC.debit + leaf centers with no enterprise", () => {
    expect(r.unallocExpense).toBe(200_000 + 50_000); // CC-UNALLOC debit + S4 (no enterprise)
  });
  it("revenue not mapping to an enterprise → unallocRevenue", () => {
    expect(r.unallocRevenue).toBe(300_000); // the null-center sale (S3 maps to عام, so it's allocated)
  });
  it("no double-count: the parent center P is never summed", () => {
    expect(r.enterprises.some((e) => e.key === "CC-P")).toBe(false);
  });
});
