import { describe, expect, it } from "vitest";
import {
  budgetCategoryForSubtype,
  budgetCheckResultForKnownCost,
  buildCategoryBudgetView,
  GENERAL_OPS_BUDGET_CATEGORY,
  summarizePlannedCostByCategory,
  summarizePlannedFertilizationCost,
  worstBudgetVerdict,
} from "./budget-check";

describe("budget check cost summary", () => {
  it("sums only planned fertilization operation costs", () => {
    expect(
      summarizePlannedFertilizationCost([
        { subtype: "fertilization", status: "planned", est_cost: 1200 },
        { subtype: "fertilization", status: "planned", est_cost: "300" },
        { subtype: "inspection", status: "planned", est_cost: 9999 },
        { subtype: "fertilization", status: "done", est_cost: 700 },
      ]),
    ).toEqual({ knownCost: 1500, unknownCostCount: 0, hasUnknownCost: false });
  });

  it("tracks unknown planned fertilization costs instead of treating them as free", () => {
    expect(
      summarizePlannedFertilizationCost([
        { subtype: "fertilization", status: "planned", est_cost: null },
        { subtype: "fertilization", status: "planned", est_cost: undefined },
        { subtype: "fertilization", status: "planned", est_cost: Number.NaN },
        { subtype: "fertilization", status: "planned", est_cost: 250 },
      ]),
    ).toEqual({ knownCost: 250, unknownCostCount: 3, hasUnknownCost: true });
  });
});

describe("budget check verdict", () => {
  it("warns when any planned fertilization cost is unknown", () => {
    expect(budgetCheckResultForKnownCost(1000, 0, true)).toBe("warn");
    expect(budgetCheckResultForKnownCost(1000, 300, true)).toBe("warn");
  });

  it("keeps a real overspend as block even with unknown costs", () => {
    expect(budgetCheckResultForKnownCost(1000, 1200, true)).toBe("block");
  });
});

describe("budgetCategoryForSubtype", () => {
  it("maps fertilization and irrigation to their configured budget_lines categories", () => {
    expect(budgetCategoryForSubtype("fertilization")).toBe("أسمدة");
    expect(budgetCategoryForSubtype("irrigation")).toBe("ري ووقود");
  });

  it("rolls up every other subtype (incl. new operation-vocabulary ones) into the general category", () => {
    for (const s of ["pruning_dethorning", "harvest", "pollination", "pest_scouting", "unknown_future_subtype"]) {
      expect(budgetCategoryForSubtype(s)).toBe(GENERAL_OPS_BUDGET_CATEGORY);
    }
    expect(budgetCategoryForSubtype(null)).toBe(GENERAL_OPS_BUDGET_CATEGORY);
  });
});

describe("summarizePlannedCostByCategory — generalizes the old fertilization-only sum to every subtype", () => {
  it("groups planned costs by category so non-fertilization operations are no longer counted as free", () => {
    const byCategory = summarizePlannedCostByCategory([
      { subtype: "fertilization", status: "planned", est_cost: 1000 },
      { subtype: "irrigation", status: "planned", est_cost: 500 },
      { subtype: "harvest", status: "planned", est_cost: 300 },
      { subtype: "pruning_dethorning", status: "planned", est_cost: 200 },
      { subtype: "fertilization", status: "done", est_cost: 999 }, // not planned, excluded
    ]);
    expect(byCategory.get("أسمدة")).toEqual({ knownCost: 1000, unknownCostCount: 0, hasUnknownCost: false });
    expect(byCategory.get("ري ووقود")).toEqual({ knownCost: 500, unknownCostCount: 0, hasUnknownCost: false });
    expect(byCategory.get(GENERAL_OPS_BUDGET_CATEGORY)).toEqual({
      knownCost: 500,
      unknownCostCount: 0,
      hasUnknownCost: false,
    });
  });
});

describe("worstBudgetVerdict", () => {
  it("picks block over warn over ok", () => {
    expect(worstBudgetVerdict(["ok", "warn", "block"])).toBe("block");
    expect(worstBudgetVerdict(["ok", "warn"])).toBe("warn");
    expect(worstBudgetVerdict(["ok", "ok"])).toBe("ok");
    expect(worstBudgetVerdict([])).toBe("ok");
  });
});

describe("buildCategoryBudgetView", () => {
  it("blocks when this category's planned cost exceeds what's available", () => {
    const view = buildCategoryBudgetView(
      "أسمدة",
      { category: "أسمدة", planned: 100000, approved: 100000, committed: 7000, actual: 87000 },
      { knownCost: 42000, unknownCostCount: 0, hasUnknownCost: false },
    );
    expect(view.available).toBe(6000);
    expect(view.verdict).toBe("block");
  });

  it("treats a missing budget line as zeroed-out (no configured category)", () => {
    const view = buildCategoryBudgetView(GENERAL_OPS_BUDGET_CATEGORY, null, {
      knownCost: 0,
      unknownCostCount: 0,
      hasUnknownCost: false,
    });
    expect(view.available).toBe(0);
    expect(view.verdict).toBe("ok");
  });
});
