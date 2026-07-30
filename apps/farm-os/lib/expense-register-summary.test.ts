import { describe, expect, it } from "vitest";
import {
  EXPENSE_REGISTER_DISPLAY_CAP,
  currentMonthBounds,
  expenseFilterCount,
  isExpenseRegisterTruncated,
  parseExpenseFilter,
  parseExpenseRegisterSummary,
} from "./expense-register-summary";

const VALID = {
  expense_count: 254,
  month_count: 40,
  operating_count: 200,
  drawing_count: 12,
  unrouted_count: 3,
  unclassified_count: 1,
  uncentered_count: 2,
  month_non_drawing_total: "11790.50",
  month_non_drawing_unknown_count: 1,
  month_drawing_total: 200,
  month_drawing_unknown_count: 1,
};

describe("parseExpenseRegisterSummary", () => {
  it("accepts Postgres numerics and legitimate zero values", () => {
    expect(parseExpenseRegisterSummary(VALID)).toEqual({
      expenseCount: 254,
      monthCount: 40,
      operatingCount: 200,
      drawingCount: 12,
      unroutedCount: 3,
      unclassifiedCount: 1,
      uncenteredCount: 2,
      monthNonDrawingTotal: 11790.5,
      monthNonDrawingUnknownCount: 1,
      monthDrawingTotal: 200,
      monthDrawingUnknownCount: 1,
    });
    expect(
      parseExpenseRegisterSummary({
        expense_count: 0,
        month_count: 0,
        operating_count: 0,
        drawing_count: 0,
        unrouted_count: 0,
        unclassified_count: 0,
        uncentered_count: 0,
        month_non_drawing_total: 0,
        month_non_drawing_unknown_count: 0,
        month_drawing_total: 0,
        month_drawing_unknown_count: 0,
      }),
    ).toEqual({
      expenseCount: 0,
      monthCount: 0,
      operatingCount: 0,
      drawingCount: 0,
      unroutedCount: 0,
      unclassifiedCount: 0,
      uncenteredCount: 0,
      monthNonDrawingTotal: 0,
      monthNonDrawingUnknownCount: 0,
      monthDrawingTotal: 0,
      monthDrawingUnknownCount: 0,
    });
  });

  it("keeps drawing-scoped fields null instead of fabricating zero for a non-finance caller", () => {
    expect(
      parseExpenseRegisterSummary({
        ...VALID,
        drawing_count: null,
        month_drawing_total: null,
        month_drawing_unknown_count: null,
      }),
    ).toEqual({
      expenseCount: 254,
      monthCount: 40,
      operatingCount: 200,
      drawingCount: null,
      unroutedCount: 3,
      unclassifiedCount: 1,
      uncenteredCount: 2,
      monthNonDrawingTotal: 11790.5,
      monthNonDrawingUnknownCount: 1,
      monthDrawingTotal: null,
      monthDrawingUnknownCount: null,
    });
  });

  it("fails closed on missing or malformed payloads", () => {
    for (const bad of [null, undefined, [], "bad"]) {
      expect(() => parseExpenseRegisterSummary(bad)).toThrow();
    }
    for (const bad of [undefined, "", "bad", Infinity, NaN, true]) {
      expect(() => parseExpenseRegisterSummary({ ...VALID, month_non_drawing_total: bad })).toThrow();
    }
  });

  it("fails closed on invalid counts, including the nullable drawing fields when present", () => {
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "bad"]) {
      expect(() => parseExpenseRegisterSummary({ ...VALID, expense_count: bad })).toThrow();
      expect(() => parseExpenseRegisterSummary({ ...VALID, drawing_count: bad })).toThrow();
    }
  });
});

describe("isExpenseRegisterTruncated", () => {
  it("only reports truncation above the display cap", () => {
    expect(isExpenseRegisterTruncated(EXPENSE_REGISTER_DISPLAY_CAP)).toBe(false);
    expect(isExpenseRegisterTruncated(EXPENSE_REGISTER_DISPLAY_CAP + 1)).toBe(true);
  });
});

describe("parseExpenseFilter", () => {
  it("accepts every known filter value", () => {
    for (const value of ["all", "month", "operating", "drawing", "unrouted", "unclassified", "uncentered"] as const) {
      expect(parseExpenseFilter(value)).toBe(value);
    }
  });

  it("falls back to 'all' for unknown, empty, or missing values", () => {
    expect(parseExpenseFilter(undefined)).toBe("all");
    expect(parseExpenseFilter("")).toBe("all");
    expect(parseExpenseFilter("cancelled")).toBe("all");
    expect(parseExpenseFilter("drawing.eq.true")).toBe("all");
  });
});

describe("expenseFilterCount", () => {
  const summary = parseExpenseRegisterSummary(VALID);

  it("reads the exact register-wide count for each filter, not a page length", () => {
    expect(expenseFilterCount("all", summary)).toBe(254);
    expect(expenseFilterCount("month", summary)).toBe(40);
    expect(expenseFilterCount("operating", summary)).toBe(200);
    expect(expenseFilterCount("drawing", summary)).toBe(12);
    expect(expenseFilterCount("unrouted", summary)).toBe(3);
    expect(expenseFilterCount("unclassified", summary)).toBe(1);
    expect(expenseFilterCount("uncentered", summary)).toBe(2);
  });

  it("falls back to 0 for a null drawing count rather than throwing", () => {
    const noDrawings = parseExpenseRegisterSummary({
      ...VALID,
      drawing_count: null,
      month_drawing_total: null,
      month_drawing_unknown_count: null,
    });
    expect(expenseFilterCount("drawing", noDrawings)).toBe(0);
  });
});

describe("currentMonthBounds", () => {
  it("returns the first day of the Cairo calendar month as an inclusive start", () => {
    // 2026-07-15 12:00 UTC is safely mid-month in Cairo (UTC+2/+3) too.
    const bounds = currentMonthBounds(new Date("2026-07-15T12:00:00Z"));
    expect(bounds).toEqual({ start: "2026-07-01", end: "2026-08-01" });
  });

  it("rolls the exclusive end over into January of the next year", () => {
    const bounds = currentMonthBounds(new Date("2026-12-15T12:00:00Z"));
    expect(bounds).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  });

  it("uses the Cairo calendar day rather than UTC across the midnight boundary", () => {
    // 2026-07-31 23:30 UTC is already 2026-08-01 in Cairo (UTC+3 in northern-hemisphere summer),
    // so the Cairo-anchored month must already be August, not July.
    const bounds = currentMonthBounds(new Date("2026-07-31T23:30:00Z"));
    expect(bounds).toEqual({ start: "2026-08-01", end: "2026-09-01" });
  });
});
