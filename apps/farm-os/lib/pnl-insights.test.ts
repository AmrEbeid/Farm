import { describe, it, expect } from "vitest";
import {
  marginFraction,
  pctChange,
  verdictForChange,
  narratePeriods,
  costDisciplineThesis,
  parsePnlTimeseries,
  profitPerFeddan,
  sectorStatus,
  bestUnitBenchmark,
  concentrationThesis,
  type PnlPeriod,
  type PnlTimeseries,
  type CenterPerf,
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

describe("parsePnlTimeseries", () => {
  it("coerces string/number JSON into typed periods", () => {
    const parsed = parsePnlTimeseries({
      grain: "year",
      period_start: "2024-01-01",
      period_end: "2025-12-31",
      periods: [
        { period: "2024", revenue: "4689211", expenses: 2388331, operating_expenses: "2000000", net_income: "2300880", cumulative_net_income: "2300880" },
        { period: "2025", revenue: 7684947, expenses: "4442133", operating_expenses: 3500000, net_income: 3242814, cumulative_net_income: 5543694 },
      ],
    });
    expect(parsed.grain).toBe("year");
    expect(parsed.periods).toHaveLength(2);
    expect(parsed.periods[0].revenue).toBe(4689211);
    expect(parsed.periods[1].net_income).toBe(3242814);
  });
  it("is defensive: malformed/empty payload → empty periods, never throws", () => {
    expect(parsePnlTimeseries(null).periods).toEqual([]);
    expect(parsePnlTimeseries({}).periods).toEqual([]);
    expect(parsePnlTimeseries({ periods: "nope" }).periods).toEqual([]);
    expect(parsePnlTimeseries({ periods: [{ revenue: 5 }] }).periods).toEqual([]); // no period label → dropped
  });
  it("defaults grain to month for an unknown grain", () => {
    expect(parsePnlTimeseries({ grain: "week", periods: [] }).grain).toBe("month");
  });
});

// Sector performance modeled on the prototype's real 2025 figures (22-Feddan = crown jewel).
// NB: `net` here is real PROFIT (revenue − expenses) — the CenterPerf contract — NOT v_cost_center_rollup.net.
const centers: CenterPerf[] = [
  { id: "s1", name: "ال 22 فدان", net: 2_849_726, areaFeddan: 22 }, // ~129,533/fd
  { id: "s2", name: "الشفعه", net: 125_334, areaFeddan: 9.5 }, // ~13,193/fd
  { id: "s3", name: "حوض البابور", net: -45_356, areaFeddan: 23 }, // ~-1,972/fd
  { id: "s4", name: "الخطاره", net: 201_825, areaFeddan: 23 }, // ~8,775/fd
  { id: "s5", name: "الحصوه", net: 45_480, areaFeddan: 30 }, // ~1,516/fd
];

describe("profitPerFeddan", () => {
  it("normalizes by area", () => {
    expect(profitPerFeddan({ id: "x", name: "x", net: 2200, areaFeddan: 22 })).toBeCloseTo(100);
  });
  it("is null with no area (honest-null, never net/0)", () => {
    expect(profitPerFeddan({ id: "x", name: "x", net: 500, areaFeddan: 0 })).toBeNull();
  });
});

describe("sectorStatus", () => {
  const bench = 129_533;
  it("grades relative to the benchmark", () => {
    expect(sectorStatus(129_533, bench)).toBe("crown"); // the benchmark itself
    expect(sectorStatus(70_000, bench)).toBe("strong"); // ~54%
    expect(sectorStatus(8_775, bench)).toBe("recovering"); // positive but far below
    expect(sectorStatus(-1_972, bench)).toBe("attention"); // underwater
  });
  it("is null when it can't be graded", () => {
    expect(sectorStatus(null, bench)).toBeNull();
    expect(sectorStatus(5000, 0)).toBeNull();
  });
});

describe("bestUnitBenchmark", () => {
  it("picks the top profit/feddan and computes gap + implied upside", () => {
    const b = bestUnitBenchmark(centers)!;
    expect(b).not.toBeNull();
    expect(b.benchmarkName).toBe("ال 22 فدان");
    expect(b.benchmarkPerFeddan).toBeCloseTo(2_849_726 / 22, 0);
    // the crown jewel's own gap/upside is ~0
    expect(b.rows.find((r) => r.id === "s1")!.upside).toBeCloseTo(0, 0);
    // full potential = total area × benchmark/fd, and implied upside is positive (others lag)
    expect(b.impliedUpside).toBeGreaterThan(0);
    expect(b.fullPotential).toBeCloseTo(b.totalArea * b.benchmarkPerFeddan, 0);
  });
  it("returns null with fewer than 2 area-bearing units", () => {
    expect(bestUnitBenchmark([{ id: "a", name: "a", net: 100, areaFeddan: 10 }])).toBeNull();
  });
  it("returns null when the best unit is not profitable (no honest upside story)", () => {
    expect(
      bestUnitBenchmark([
        { id: "a", name: "a", net: -100, areaFeddan: 10 },
        { id: "b", name: "b", net: -200, areaFeddan: 10 },
      ]),
    ).toBeNull();
  });
});

describe("concentrationThesis", () => {
  it("fires when one center dominates positive net", () => {
    const t = concentrationThesis(centers)!; // 22-Feddan ~89% of positive net
    expect(t).not.toBeNull();
    expect(t.key).toBe("concentration");
    expect(t.body).toContain("ال 22 فدان");
  });
  it("stays silent when profit is evenly spread", () => {
    const even: CenterPerf[] = [
      { id: "a", name: "a", net: 100, areaFeddan: 10 },
      { id: "b", name: "b", net: 100, areaFeddan: 10 },
      { id: "c", name: "c", net: 100, areaFeddan: 10 },
    ];
    expect(concentrationThesis(even)).toBeNull();
  });
  it("returns null with no positive net (no fabricated leader)", () => {
    expect(
      concentrationThesis([
        { id: "a", name: "a", net: -1, areaFeddan: 10 },
        { id: "b", name: "b", net: -2, areaFeddan: 10 },
      ]),
    ).toBeNull();
  });
});
