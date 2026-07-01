import { describe, expect, it } from "vitest";
import { operatingProfit, parseOwnerPnlSummary, yearToDatePeriod } from "./owner-pnl";

describe("parseOwnerPnlSummary", () => {
  it("parses a real RPC payload", () => {
    expect(
      parseOwnerPnlSummary({
        period_start: "2026-01-01",
        period_end: "2026-07-01",
        operating_expenses: 120000,
        owner_drawings: 45000,
        capex: 300000,
      }),
    ).toEqual({
      periodStart: "2026-01-01",
      periodEnd: "2026-07-01",
      operatingExpenses: 120000,
      ownerDrawings: 45000,
      capex: 300000,
    });
  });

  it("treats numeric strings (Postgres numeric over the wire) as real numbers", () => {
    expect(parseOwnerPnlSummary({ operating_expenses: "1500.50" }).operatingExpenses).toBe(1500.5);
  });

  it("never fabricates: missing/malformed fields become a genuine zero, not NaN", () => {
    expect(parseOwnerPnlSummary(null)).toEqual({
      periodStart: null,
      periodEnd: null,
      operatingExpenses: 0,
      ownerDrawings: 0,
      capex: 0,
    });
    expect(parseOwnerPnlSummary({ operating_expenses: "not-a-number" }).operatingExpenses).toBe(0);
    expect(parseOwnerPnlSummary(undefined)).toEqual({
      periodStart: null,
      periodEnd: null,
      operatingExpenses: 0,
      ownerDrawings: 0,
      capex: 0,
    });
    expect(parseOwnerPnlSummary([1, 2, 3]).operatingExpenses).toBe(0);
  });

  it("keeps drawings and capex distinct fields — never merges them into operating (#6)", () => {
    const parsed = parseOwnerPnlSummary({ operating_expenses: 100, owner_drawings: 200, capex: 300 });
    expect(parsed.operatingExpenses).toBe(100);
    expect(parsed.ownerDrawings).toBe(200);
    expect(parsed.capex).toBe(300);
  });
});

describe("yearToDatePeriod", () => {
  it("spans Jan 1 of the given year through the given date", () => {
    expect(yearToDatePeriod(new Date("2026-07-01T12:00:00Z"))).toEqual({
      from: "2026-01-01",
      to: "2026-07-01",
    });
  });
});

describe("operatingProfit", () => {
  it("computes revenue minus operating expenses when a revenue model exists", () => {
    expect(operatingProfit(120000, 500000)).toBe(380000);
  });

  it("returns null (not a fabricated number) when there is no revenue model yet", () => {
    expect(operatingProfit(120000, null)).toBeNull();
  });
});
