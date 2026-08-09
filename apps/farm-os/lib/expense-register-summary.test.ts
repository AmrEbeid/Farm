import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXPENSE_REGISTER_DISPLAY_CAP,
  assertFinanceUnpaidSummary,
  currentMonthBounds,
  expenseFilterCount,
  isExpenseRegisterTruncated,
  parseExpenseFilter,
  parseExpenseRegisterSummary,
  unpaidExpenseCount,
  unpaidKnownTotal,
  unpaidUnknownCount,
} from "./expense-register-summary";

const custodyPageSource = readFileSync(
  join(process.cwd(), "app", "(app)", "custody", "page.tsx"),
  "utf8"
);
const financeDashboardSource = readFileSync(
  join(process.cwd(), "app", "(app)", "finance", "dashboard", "page.tsx"),
  "utf8"
);

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
  month_drawing_total: "200",
  month_drawing_unknown_count: 1,
  unpaid_operating_count: 5,
  unpaid_operating_total: "1200.50",
  unpaid_operating_unknown_count: 1,
  unpaid_capex_count: 2,
  unpaid_capex_total: "800",
  unpaid_capex_unknown_count: 0,
  unpaid_drawing_count: 3,
  unpaid_drawing_total: "400",
  unpaid_drawing_unknown_count: 2,
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
      monthNonDrawingTotal: "11790.5",
      monthNonDrawingUnknownCount: 1,
      monthDrawingTotal: "200",
      monthDrawingUnknownCount: 1,
      unpaidOperatingCount: 5,
      unpaidOperatingTotal: "1200.5",
      unpaidOperatingUnknownCount: 1,
      unpaidCapexCount: 2,
      unpaidCapexTotal: "800",
      unpaidCapexUnknownCount: 0,
      unpaidDrawingCount: 3,
      unpaidDrawingTotal: "400",
      unpaidDrawingUnknownCount: 2,
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
        month_non_drawing_total: "0",
        month_non_drawing_unknown_count: 0,
        month_drawing_total: "0",
        month_drawing_unknown_count: 0,
        unpaid_operating_count: 0,
        unpaid_operating_total: "0",
        unpaid_operating_unknown_count: 0,
        unpaid_capex_count: 0,
        unpaid_capex_total: "0",
        unpaid_capex_unknown_count: 0,
        unpaid_drawing_count: 0,
        unpaid_drawing_total: "0",
        unpaid_drawing_unknown_count: 0,
      })
    ).toEqual({
      expenseCount: 0,
      monthCount: 0,
      operatingCount: 0,
      drawingCount: 0,
      unroutedCount: 0,
      unclassifiedCount: 0,
      uncenteredCount: 0,
      monthNonDrawingTotal: "0",
      monthNonDrawingUnknownCount: 0,
      monthDrawingTotal: "0",
      monthDrawingUnknownCount: 0,
      unpaidOperatingCount: 0,
      unpaidOperatingTotal: "0",
      unpaidOperatingUnknownCount: 0,
      unpaidCapexCount: 0,
      unpaidCapexTotal: "0",
      unpaidCapexUnknownCount: 0,
      unpaidDrawingCount: 0,
      unpaidDrawingTotal: "0",
      unpaidDrawingUnknownCount: 0,
    });
  });

  it("keeps drawing-scoped fields null instead of fabricating zero for a non-finance caller", () => {
    expect(
      parseExpenseRegisterSummary({
        ...VALID,
        drawing_count: null,
        month_drawing_total: null,
        month_drawing_unknown_count: null,
        unpaid_drawing_count: null,
        unpaid_drawing_total: null,
        unpaid_drawing_unknown_count: null,
      })
    ).toEqual({
      expenseCount: 254,
      monthCount: 40,
      operatingCount: 200,
      drawingCount: null,
      unroutedCount: 3,
      unclassifiedCount: 1,
      uncenteredCount: 2,
      monthNonDrawingTotal: "11790.5",
      monthNonDrawingUnknownCount: 1,
      monthDrawingTotal: null,
      monthDrawingUnknownCount: null,
      unpaidOperatingCount: 5,
      unpaidOperatingTotal: "1200.5",
      unpaidOperatingUnknownCount: 1,
      unpaidCapexCount: 2,
      unpaidCapexTotal: "800",
      unpaidCapexUnknownCount: 0,
      unpaidDrawingCount: null,
      unpaidDrawingTotal: null,
      unpaidDrawingUnknownCount: null,
    });
  });

  it("fails closed on missing or malformed payloads", () => {
    for (const bad of [null, undefined, [], "bad"]) {
      expect(() => parseExpenseRegisterSummary(bad)).toThrow();
    }
    for (const bad of [undefined, "", "bad", 1, Infinity, NaN, true]) {
      expect(() =>
        parseExpenseRegisterSummary({ ...VALID, month_non_drawing_total: bad })
      ).toThrow();
    }
  });

  it("requires decimal text and sums unpaid categories without binary floating-point drift", () => {
    const summary = parseExpenseRegisterSummary({
      ...VALID,
      unpaid_operating_total: "0.10",
      unpaid_capex_total: "0.20",
      unpaid_drawing_total: "0",
    });
    expect(summary.unpaidOperatingTotal).toBe("0.1");
    expect(unpaidKnownTotal(summary)).toBe("0.3");
    expect(() =>
      parseExpenseRegisterSummary({ ...VALID, unpaid_operating_total: 0.1 })
    ).toThrow(/decimal text/);
  });

  it("fails closed on invalid counts, including the nullable drawing fields when present", () => {
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "bad"]) {
      expect(() =>
        parseExpenseRegisterSummary({ ...VALID, expense_count: bad })
      ).toThrow();
      expect(() =>
        parseExpenseRegisterSummary({ ...VALID, drawing_count: bad })
      ).toThrow();
    }
  });
});

describe("isExpenseRegisterTruncated", () => {
  it("only reports truncation above the display cap", () => {
    expect(isExpenseRegisterTruncated(EXPENSE_REGISTER_DISPLAY_CAP)).toBe(
      false
    );
    expect(isExpenseRegisterTruncated(EXPENSE_REGISTER_DISPLAY_CAP + 1)).toBe(
      true
    );
  });
});

describe("parseExpenseFilter", () => {
  it("accepts every known filter value", () => {
    for (const value of [
      "all",
      "month",
      "operating",
      "drawing",
      "undated",
      "unrouted",
      "unclassified",
      "uncentered",
    ] as const) {
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

  it("requires the undated filter to use its exact filtered query count", () => {
    expect(() => expenseFilterCount("undated", summary)).toThrow(
      "undated filter count must come from its exact filtered query"
    );
  });

  it("falls back to 0 for a null drawing count rather than throwing", () => {
    const noDrawings = parseExpenseRegisterSummary({
      ...VALID,
      drawing_count: null,
      month_drawing_total: null,
      month_drawing_unknown_count: null,
      unpaid_drawing_count: null,
      unpaid_drawing_total: null,
      unpaid_drawing_unknown_count: null,
    });
    expect(expenseFilterCount("drawing", noDrawings)).toBe(0);
  });
});

describe("unpaid obligation totals", () => {
  it("combines exact per-kind counts and known money", () => {
    const summary = parseExpenseRegisterSummary(VALID);
    expect(unpaidExpenseCount(summary)).toBe(10);
    expect(unpaidKnownTotal(summary)).toBe("2400.5");
    expect(unpaidUnknownCount(summary)).toBe(3);
  });

  it("does not fabricate drawing values when they are withheld", () => {
    const summary = parseExpenseRegisterSummary({
      ...VALID,
      drawing_count: null,
      month_drawing_total: null,
      month_drawing_unknown_count: null,
      unpaid_drawing_count: null,
      unpaid_drawing_total: null,
      unpaid_drawing_unknown_count: null,
    });
    expect(unpaidExpenseCount(summary)).toBe(7);
    expect(unpaidKnownTotal(summary)).toBe("2000.5");
    expect(unpaidUnknownCount(summary)).toBe(1);
    expect(() => assertFinanceUnpaidSummary(summary)).toThrow(
      "finance caller received withheld drawing fields"
    );
  });

  it("accepts complete drawing fields for an owner/accountant surface", () => {
    const summary = parseExpenseRegisterSummary(VALID);
    expect(() => assertFinanceUnpaidSummary(summary)).not.toThrow();
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

describe("unpaid-obligation page wiring", () => {
  it("uses the exact summary RPC on both owner/accountant money surfaces", () => {
    expect(custodyPageSource).toContain('sb.rpc("fn_custody_daily_snapshot"');
    expect(custodyPageSource).toContain("parseCustodyDailySnapshot(snapshotRes.data)");
    expect(custodyPageSource).toContain("assertFinanceUnpaidSummary(");
    expect(custodyPageSource).toContain(
      "if (snapshotRes.error) throw snapshotRes.error;"
    );
    expect(financeDashboardSource).toContain(
      'sb.rpc("fn_finance_dashboard_snapshot"'
    );
    expect(financeDashboardSource).toContain("parseFinanceDashboardSnapshot(");
    expect(financeDashboardSource).toContain("assertFinanceUnpaidSummary(");
  });

  it("removes capped-array money sums", () => {
    expect(custodyPageSource).not.toContain(
      'sb.from("expenses").select("total, kind").eq("payment_status", "post_paid_unpaid")'
    );
    expect(financeDashboardSource).not.toMatch(
      /unpaidTotal\s*=\s*\(unpaidExpensesRes\.data[\s\S]*?\.reduce/
    );
    expect(financeDashboardSource).toContain(
      'const unpaidTotal = expenseSummary ? unpaidKnownTotal(expenseSummary) : "0";'
    );
  });

  it("discloses unknown amounts and gates partial dashboard export", () => {
    expect(custodyPageSource).toContain("unpaidUnknown > 0");
    expect(financeDashboardSource).toContain("unpaidUnknown > 0");
    expect(financeDashboardSource).toMatch(
      /exportFilename=\{\s*unpaidRowsTruncated\s*\? undefined\s*: "finance-dashboard-unpaid-obligations"\s*\}/
    );
    expect(financeDashboardSource).toContain("البحث داخل المعروض");
  });

  it("keeps bounded detail queries active-org scoped and deterministic", () => {
    expect(custodyPageSource).not.toContain('.from("custody_movements")');
    expect(custodyPageSource).not.toContain('.from("payment_requests")');
    expect(custodyPageSource).not.toContain('.from("custody_accounts")');
    expect(custodyPageSource).toContain("p_org: m.orgId");
    expect(custodyPageSource).toContain("p_movement_limit: MOVEMENT_DISPLAY_CAP");
    expect(custodyPageSource).toContain("p_request_limit: REQUEST_DISPLAY_CAP");

    expect(financeDashboardSource).not.toContain('.from("expenses")');
    expect(financeDashboardSource).not.toContain('.from("journal_entries")');
    expect(financeDashboardSource).toContain("p_org: m.orgId");
    expect(financeDashboardSource).toContain(
      "p_row_limit: FINANCE_DASHBOARD_ROW_LIMIT"
    );
    expect(financeDashboardSource).toContain(
      "p_journal_limit: FINANCE_DASHBOARD_JOURNAL_LIMIT"
    );
  });

  it("keeps custody request chips exact and the selected list bounded", () => {
    expect(custodyPageSource).toContain("const REQUEST_DISPLAY_CAP = 200;");
    expect(custodyPageSource).toContain(
      "const allRequestCount = snapshot.allRequestCount;"
    );
    expect(custodyPageSource).toContain(
      "const awaitingRequestCount = snapshot.awaitingRequestCount;"
    );
    expect(custodyPageSource).toContain(
      "const settledRequestCount = snapshot.settledRequestCount;"
    );
    expect(custodyPageSource).toContain("p_request_filter: requestFilter");
    expect(custodyPageSource).toContain("p_request_limit: REQUEST_DISPLAY_CAP");
    expect(custodyPageSource).toContain(
      'exportFilename={requestsTruncated ? undefined : "payment-requests"}'
    );
  });

  it("counts finance payment queues exactly before limiting displayed rows", () => {
    expect(financeDashboardSource).not.toContain('.from("payment_requests")');
    expect(financeDashboardSource).toContain(
      "const openPaymentRequestCount = finance?.openPaymentCount ?? 0;"
    );
    expect(financeDashboardSource).toContain(
      "value={num(openPaymentRequestCount)}"
    );
    expect(financeDashboardSource).toContain("value={num(readyPaymentCount)}");
    expect(financeDashboardSource).toMatch(
      /exportFilename=\{\s*paymentRowsTruncated\s*\? undefined\s*: "finance-dashboard-payment-requests"\s*\}/
    );
  });
});
