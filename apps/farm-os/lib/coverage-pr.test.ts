import { describe, expect, it } from "vitest";
import { coverageDemandContext, coveragePrNeededBy } from "./coverage-pr";

describe("coveragePrNeededBy", () => {
  it("keeps a future demand date", () => {
    expect(coveragePrNeededBy("2026-07-20", "2026-07-06")).toBe("2026-07-20");
  });

  it("clamps past demand to today so scheduled receipts stay projected", () => {
    expect(coveragePrNeededBy("2026-07-01", "2026-07-06")).toBe("2026-07-06");
  });

  it("treats null-dated live demand as immediate", () => {
    expect(coveragePrNeededBy(null, "2026-07-06")).toBe("2026-07-06");
  });

  it("normalizes timestamp inputs to the date key", () => {
    expect(coveragePrNeededBy("2026-07-08T10:30:00.000Z", "2026-07-06")).toBe("2026-07-08");
  });
});

describe("coverageDemandContext", () => {
  it("attaches to the single demanding plan", () => {
    expect(coverageDemandContext([{ plan_id: "plan-1", planned_at: "2026-07-10" }])).toEqual({
      planId: "plan-1",
      plannedAt: "2026-07-10",
    });
  });

  it("keeps the earliest demand date across operations in one plan", () => {
    expect(
      coverageDemandContext([
        { plan_id: "plan-1", planned_at: "2026-07-20" },
        { plan_id: "plan-1", planned_at: "2026-07-08" },
      ]),
    ).toEqual({ planId: "plan-1", plannedAt: "2026-07-08" });
  });

  it("does not attach to a plan when several plans demand the item", () => {
    expect(
      coverageDemandContext([
        { plan_id: "plan-1", planned_at: "2026-07-08" },
        { plan_id: "plan-2", planned_at: "2026-07-09" },
      ]),
    ).toEqual({ planId: null, plannedAt: "2026-07-08" });
  });

  it("supports planless safety-stock recommendations", () => {
    expect(coverageDemandContext([])).toEqual({ planId: null, plannedAt: null });
  });
});
