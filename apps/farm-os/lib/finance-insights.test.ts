import { describe, expect, it } from "vitest";
import { buildFinanceInsightSummary, type CostCenterInsightRollup } from "./finance-insights";

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
});
