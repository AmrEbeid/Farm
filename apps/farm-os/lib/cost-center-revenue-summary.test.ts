import { describe, expect, it } from "vitest";
import { COST_CENTER_REVENUE_SUMMARY_VERSION, parseCostCenterRevenueSummary } from "./cost-center-revenue-summary";

const ORG = "00000000-0000-4000-8000-000000000001";
const LEGACY_FARM_ORG = "00000000-0000-0000-0000-000000000001";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const valid = () => ({
  version: COST_CENTER_REVENUE_SUMMARY_VERSION,
  org_id: ORG,
  sale_count: 4,
  total_revenue: "2300",
  rows: [
    { cost_center_id: null, sale_count: "1", revenue: "200" },
    { cost_center_id: A, sale_count: "2", revenue: "1500" },
    { cost_center_id: B, sale_count: "1", revenue: "600" },
  ],
});

describe("parseCostCenterRevenueSummary", () => {
  it("preserves exact center groups and the unallocated part while exposing the shared consumer shape", () => {
    const parsed = parseCostCenterRevenueSummary(valid(), ORG);
    expect(parsed).toMatchObject({ orgId: ORG, saleCount: 4, totalRevenue: "2300" });
    expect(parsed.rows[0]).toEqual({ costCenterId: null, saleCount: 1, revenue: "200" });
    expect(parsed.salesRevenue).toEqual({ byCenter: { [A]: 1500, [B]: 600 }, total: 2300 });
  });

  it("accepts the canonical PostgreSQL UUID used by the historical farm organization", () => {
    const value = { ...valid(), org_id: LEGACY_FARM_ORG };
    expect(parseCostCenterRevenueSummary(value, LEGACY_FARM_ORG).orgId).toBe(LEGACY_FARM_ORG);
  });

  it.each([
    ["wrong version", { ...valid(), version: "v2" }],
    ["wrong organization", { ...valid(), org_id: B }],
    ["missing rows", { ...valid(), rows: null }],
    ["invalid center", { ...valid(), rows: [{ cost_center_id: "bad", sale_count: 4, revenue: 2300 }] }],
    ["numeric money loses exact transport", { ...valid(), total_revenue: 2300 }],
    ["negative money", { ...valid(), total_revenue: "-1" }],
    ["unsafe count", { ...valid(), sale_count: Number.MAX_SAFE_INTEGER + 1 }],
    ["count mismatch", { ...valid(), sale_count: 5 }],
    ["money mismatch", { ...valid(), total_revenue: "2301" }],
    ["duplicate center", { ...valid(), rows: [...valid().rows, { cost_center_id: A, sale_count: "0", revenue: "0" }] }],
    ["duplicate unallocated", { ...valid(), rows: [...valid().rows, { cost_center_id: null, sale_count: "0", revenue: "0" }] }],
  ])("rejects %s", (_label, value) => {
    expect(() => parseCostCenterRevenueSummary(value, ORG)).toThrow();
  });

  it("foots many large decimal groups without binary floating-point drift", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      cost_center_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      sale_count: "1",
      revenue: "1000000000.01",
    }));
    const parsed = parseCostCenterRevenueSummary({
      version: COST_CENTER_REVENUE_SUMMARY_VERSION,
      org_id: ORG,
      sale_count: "100",
      total_revenue: "100000000001",
      rows,
    }, ORG);
    expect(parsed.totalRevenue).toBe("100000000001");
    expect(parsed.salesRevenue.total).toBe(100000000001);
  });

  it("fails closed before distinct oversized decimal amounts can collapse to one JS number", () => {
    const value = valid();
    value.rows[1] = { ...value.rows[1], revenue: "9007199254740993" };
    value.total_revenue = "9007199254741793";
    expect(() => parseCostCenterRevenueSummary(value, ORG)).toThrow("safe display range");
  });

  it("rejects fractional decimal collapse even below the safe-integer ceiling", () => {
    expect(() => parseCostCenterRevenueSummary({
      version: COST_CENTER_REVENUE_SUMMARY_VERSION,
      org_id: ORG,
      sale_count: "1",
      total_revenue: "70368744177664.01",
      rows: [{ cost_center_id: A, sale_count: "1", revenue: "70368744177664.01" }],
    }, ORG)).toThrow("safe display range");
  });
});
