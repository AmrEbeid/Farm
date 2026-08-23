import { describe, expect, it } from "vitest";
import {
  DIRECT_DISPLAY_CAP,
  costCenterSaleExclusions,
  isDirectTableTruncated,
  parseCostCenterDirectSummary,
} from "./cost-center-summary";

const VALID = {
  direct_expense_total: "2500.50",
  direct_expense_count: 250,
  unknown_expense_count: 1,
  expense_count: "251",
  direct_sale_revenue: 8000,
  finalized_sale_count: 2,
  pending_sale_count: 202,
  sale_count: 204,
};

describe("parseCostCenterDirectSummary", () => {
  it("accepts Postgres numerics and legitimate zero values", () => {
    expect(parseCostCenterDirectSummary(VALID)).toEqual({
      directExpenseTotal: 2500.5,
      directExpenseCount: 250,
      unknownExpenseCount: 1,
      expenseCount: 251,
      directSaleRevenue: 8000,
      finalizedSaleCount: 2,
      pendingSaleCount: 202,
      saleCount: 204,
    });
    expect(
      parseCostCenterDirectSummary({
        direct_expense_total: 0,
        direct_expense_count: 0,
        unknown_expense_count: 0,
        expense_count: 0,
        direct_sale_revenue: "0",
        finalized_sale_count: "0",
        pending_sale_count: 0,
        sale_count: 0,
      }),
    ).toEqual({
      directExpenseTotal: 0,
      directExpenseCount: 0,
      unknownExpenseCount: 0,
      expenseCount: 0,
      directSaleRevenue: 0,
      finalizedSaleCount: 0,
      pendingSaleCount: 0,
      saleCount: 0,
    });
  });

  it("fails closed on missing or malformed money", () => {
    for (const bad of [null, undefined, [], "bad"]) {
      expect(() => parseCostCenterDirectSummary(bad)).toThrow();
    }
    for (const bad of [null, "", "bad", Infinity, NaN, true]) {
      expect(() => parseCostCenterDirectSummary({ ...VALID, direct_expense_total: bad })).toThrow();
    }
  });

  it("fails closed on invalid counts", () => {
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "bad"]) {
      expect(() => parseCostCenterDirectSummary({ ...VALID, expense_count: bad })).toThrow();
    }
  });

  it("separates pending-price sales from finalized sales without a posted journal", () => {
    expect(costCenterSaleExclusions(parseCostCenterDirectSummary({
      ...VALID,
      finalized_sale_count: 2,
      pending_sale_count: 3,
      sale_count: 7,
    }))).toEqual({ pendingPrice: 3, finalizedWithoutPostedJournal: 2 });
  });

  it("fails closed when sale populations cannot reconcile", () => {
    expect(() => parseCostCenterDirectSummary({
      ...VALID,
      finalized_sale_count: 3,
      pending_sale_count: 3,
      sale_count: 5,
    })).toThrow("sale populations do not reconcile");
  });
});

describe("isDirectTableTruncated", () => {
  it("only reports truncation above the display cap", () => {
    expect(isDirectTableTruncated(DIRECT_DISPLAY_CAP)).toBe(false);
    expect(isDirectTableTruncated(DIRECT_DISPLAY_CAP + 1)).toBe(true);
  });
});
