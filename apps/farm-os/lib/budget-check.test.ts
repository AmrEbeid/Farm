import { describe, expect, it } from "vitest";
import {
  aggregateBudgetLinesByCategory,
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
  it("aggregates repeated category rows instead of picking an arbitrary budget line", () => {
    const byCategory = aggregateBudgetLinesByCategory([
      { budget_id: "budget-1", category: "أسمدة", planned: 100, approved: 90, committed: 10, actual: 20 },
      { budget_id: "budget-1", category: "أسمدة", planned: "200", approved: "150", committed: "5", actual: "15" },
      { category: null, planned: 999, approved: 999 },
    ]);

    expect(byCategory.get("أسمدة")).toMatchObject({
      category: "أسمدة",
      planned: 300,
      approved: 240,
      committed: 15,
      actual: 35,
      lineCount: 2,
      budgetScopeCount: 1,
      hasMultipleBudgetScopes: false,
    });
  });

  it("blocks when this category's planned cost exceeds what's available", () => {
    const view = buildCategoryBudgetView(
      "أسمدة",
      { category: "أسمدة", planned: 100000, approved: 100000, committed: 7000, actual: 87000 },
      { knownCost: 42000, unknownCostCount: 0, hasUnknownCost: false },
      { actual: 87000, actualSource: "live", committedSource: "live" },
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

  it("requires finance review instead of a green pass when live budget state is incomplete", () => {
    const view = buildCategoryBudgetView(
      "أسمدة",
      { category: "أسمدة", planned: 100000, approved: 100000, committed: 0, actual: 0 },
      { knownCost: 1200, unknownCostCount: 0, hasUnknownCost: false },
      { actualSource: "unavailable", committedSource: "static" },
    );

    expect(view.actual).toBeNull();
    expect(view.needsFinanceReview).toBe(true);
    expect(view.verdict).toBe("approval-needed");
  });

  it("hard-blocks when this plan's own cost exceeds the approved ceiling even without live actuals", () => {
    const view = buildCategoryBudgetView(
      "أسمدة",
      { category: "أسمدة", planned: 100000, approved: 100000, committed: 0, actual: 0 },
      { knownCost: 120000, unknownCostCount: 0, hasUnknownCost: false },
      { actualSource: "unavailable", committedSource: "static" },
    );

    expect(view.available).toBe(100000);
    expect(view.after).toBe(-20000);
    expect(view.verdict).toBe("block");
  });

  it("warns for finance review instead of hard-blocking when no budget line exists", () => {
    const view = buildCategoryBudgetView(
      "عمليات أخرى",
      null,
      { knownCost: 2500, unknownCostCount: 0, hasUnknownCost: false },
      { actualSource: "unavailable", committedSource: "static" },
    );

    expect(view.approved).toBe(0);
    expect(view.after).toBe(-2500);
    expect(view.needsFinanceReview).toBe(true);
    expect(view.verdict).toBe("approval-needed");
  });

  it("uses the highest single budget scope ceiling instead of summing duplicates for hard-blocks", () => {
    const byCategory = aggregateBudgetLinesByCategory([
      { budget_id: "budget-1", category: "أسمدة", planned: 1000, approved: 1000, committed: 0, actual: 0 },
      { budget_id: "budget-2", category: "أسمدة", planned: 1000, approved: 1000, committed: 0, actual: 0 },
    ]);
    const view = buildCategoryBudgetView(
      "أسمدة",
      byCategory.get("أسمدة"),
      { knownCost: 1500, unknownCostCount: 0, hasUnknownCost: false },
      { actualSource: "unavailable", committedSource: "static" },
    );

    expect(view.hasMultipleBudgetScopes).toBe(true);
    expect(view.approved).toBe(1000);
    expect(view.after).toBe(-500);
    expect(view.verdict).toBe("block");
  });
});
