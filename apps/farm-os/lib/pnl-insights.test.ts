import { describe, it, expect } from "vitest";
import {
  marginFraction,
  pctChange,
  verdictForChange,
  narratePeriods,
  costDisciplineThesis,
  type PnlPeriod,
  type PnlTimeseries,
} from "./pnl-insights";

const period = (over: Partial<PnlPeriod>): PnlPeriod => ({
  period: "2026",
  revenue: 0,
  expenses: 0,
  operating_expenses: 0,
  net_income: 0,
  cumulative_net_income: 0,
  ...over,
});

describe("marginFraction", () => {
  it("computes net / revenue", () => {
    expect(marginFraction({ revenue: 5000, net_income: 2000 })).toBeCloseTo(0.4);
  });
  it("is null (not 0) with no revenue base — honest-null", () => {
    expect(marginFraction({ revenue: 0, net_income: -100 })).toBeNull();
  });
});

describe("pctChange", () => {
  it("computes a signed percent change", () => {
    expect(pctChange(100, 150)).toBeCloseTo(50);
    expect(pctChange(100, 50)).toBeCloseTo(-50);
  });
  it("uses |from| so a negative baseline stays intuitive", () => {
    // from -100 to -50 is an improvement of +50 against the magnitude
    expect(pctChange(-100, -50)).toBeCloseTo(50);
  });
  it("is null with no usable baseline (honest-null)", () => {
    expect(pctChange(0, 500)).toBeNull();
    expect(pctChange(Number.NaN, 500)).toBeNull();
  });
});

describe("verdictForChange", () => {
  it("grades revenue-like metrics directly", () => {
    expect(verdictForChange("revenue", 10)).toBe("good");
    expect(verdictForChange("revenue", -1)).toBe("mixed");
    expect(verdictForChange("revenue", -10)).toBe("bad");
  });
  it("INVERTS cost-like metrics (a cost rise is bad)", () => {
    expect(verdictForChange("expenses", 10)).toBe("bad");
    expect(verdictForChange("expenses", -10)).toBe("good");
    expect(verdictForChange("operating_expenses", 10)).toBe("bad");
  });
  it("treats margin as percentage points", () => {
    expect(verdictForChange("margin", 2)).toBe("good");
    expect(verdictForChange("margin", 0)).toBe("mixed");
    expect(verdictForChange("margin", -5)).toBe("bad");
  });
  it("returns null for a null/NaN change — never a fabricated grade", () => {
    expect(verdictForChange("revenue", null)).toBeNull();
    expect(verdictForChange("revenue", Number.NaN)).toBeNull();
  });
});

describe("narratePeriods", () => {
  it("both-profit branch: cites growth + a discipline verdict", () => {
    const prev = period({ period: "2024", revenue: 4_689_211, expenses: 2_388_331, net_income: 2_300_880 });
    const curr = period({ period: "2025", revenue: 7_684_947, expenses: 4_442_133, net_income: 3_242_814 });
    const txt = narratePeriods(prev, curr);
    expect(txt).toContain("2025");
    expect(txt).toContain("صافي الربح");
    // costs grew ~86% vs revenue ~64% → the discipline branch fires
    expect(txt).toContain("راقب انضباط التكلفة");
  });
  it("turnaround branch: loss → profit", () => {
    const prev = period({ period: "2019", revenue: 1_675_207, expenses: 2_102_800, net_income: -427_593 });
    const curr = period({ period: "2020", revenue: 2_926_668, expenses: 1_876_368, net_income: 1_050_301 });
    expect(narratePeriods(prev, curr)).toContain("تحوّل");
  });
  it("loss branch: names the loss and a corrective focus", () => {
    const prev = period({ period: "2020", revenue: 2_926_668, expenses: 1_876_368, net_income: 1_050_301 });
    const curr = period({ period: "2021", revenue: 1_452_544, expenses: 1_798_761, net_income: -346_217 });
    const txt = narratePeriods(prev, curr);
    expect(txt).toContain("صعبًا");
    expect(txt).toContain("خسارة");
  });
});

describe("costDisciplineThesis", () => {
  const series = (periods: PnlPeriod[]): PnlTimeseries => ({
    grain: "year",
    period_start: "2024-01-01",
    period_end: "2025-12-31",
    periods,
  });
  it("fires when cost growth outpaces revenue growth", () => {
    const t = costDisciplineThesis(
      series([
        period({ period: "2024", revenue: 4_689_211, expenses: 2_388_331 }),
        period({ period: "2025", revenue: 7_684_947, expenses: 4_442_133 }), // +64% rev, +86% cost
      ]),
    );
    expect(t).not.toBeNull();
    expect(t!.key).toBe("cost_watch");
    expect(t!.severity).toBe("watch");
  });
  it("stays silent when revenue outpaces cost (no false alarm)", () => {
    const t = costDisciplineThesis(
      series([
        period({ period: "2024", revenue: 4_000_000, expenses: 3_000_000 }),
        period({ period: "2025", revenue: 8_000_000, expenses: 3_300_000 }), // +100% rev, +10% cost
      ]),
    );
    expect(t).toBeNull();
  });
  it("returns null with fewer than 2 periods (no baseline)", () => {
    expect(costDisciplineThesis(series([period({ period: "2025" })]))).toBeNull();
  });
});
