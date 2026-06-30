import { describe, expect, it } from "vitest";
import {
  budgetCheckResultForKnownCost,
  summarizePlannedFertilizationCost,
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
