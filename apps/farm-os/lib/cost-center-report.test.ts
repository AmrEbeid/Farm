import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilterableTable } from "../components/FilterableTable";
import {
  buildCostCenterYearMatrix,
  buildCostCenterYearTrend,
  costCenterHierarchyPresentation,
  costCenterDescendantIds,
  parseCostCenterHistorySummary,
  parseCostCenterReportView,
  parseCostCenterTrialBalance,
  summarizeCostCenterTrialBalance,
  topmostVisibleCostCenters,
} from "./cost-center-report";

const REPORT_PAGE = readFileSync(
  new URL("../app/(app)/finance/reports/page.tsx", import.meta.url),
  "utf8"
);

describe("cost-center report fast overview", () => {
  it("defaults unknown view parameters to the bounded overview", () => {
    expect(parseCostCenterReportView(undefined)).toBe("overview");
    expect(parseCostCenterReportView("anything")).toBe("overview");
    expect(parseCostCenterReportView("history")).toBe("history");
  });

  it("includes every descendant in a selected parent history scope", () => {
    const rows = [
      { costCenterId: "root", parentId: null },
      { costCenterId: "child", parentId: "root" },
      { costCenterId: "grandchild", parentId: "child" },
      { costCenterId: "other", parentId: null },
    ];
    expect([...costCenterDescendantIds(rows, "root")]).toEqual(["root", "child", "grandchild"]);
  });

  it("uses the topmost centers in a filtered hierarchy without dropping child-only results", () => {
    const root = { costCenterId: "root", parentId: null };
    const child = { costCenterId: "child", parentId: "root" };
    const sibling = { costCenterId: "sibling", parentId: "root" };
    const grandchild = { costCenterId: "grandchild", parentId: "child" };
    expect(topmostVisibleCostCenters([child, sibling])).toEqual([child, sibling]);
    expect(topmostVisibleCostCenters([root, child])).toEqual([root]);
    expect(topmostVisibleCostCenters([root, grandchild], [root, child, grandchild])).toEqual([root]);
  });

  it("marks overlapping parent rollups and preserves hierarchy depth", () => {
    const rows = [
      { costCenterId: "root", parentId: null },
      { costCenterId: "child", parentId: "root" },
      { costCenterId: "grandchild", parentId: "child" },
    ];
    expect(costCenterHierarchyPresentation(rows, "root")).toEqual({ depth: 0, includesDescendants: true });
    expect(costCenterHierarchyPresentation(rows, "child")).toEqual({ depth: 1, includesDescendants: true });
    expect(costCenterHierarchyPresentation(rows, "grandchild")).toEqual({ depth: 2, includesDescendants: false });
  });

  it("fails closed on a disconnected or cyclic display hierarchy", () => {
    expect(() => costCenterHierarchyPresentation([{ costCenterId: "child", parentId: "missing" }], "child"))
      .toThrow("parent is missing");
    expect(() => costCenterHierarchyPresentation([
      { costCenterId: "a", parentId: "b" },
      { costCenterId: "b", parentId: "a" },
    ], "a")).toThrow("contains a cycle");
  });

  it("computes exact normal-side totals from the posted-only trial balance", () => {
    const rows = parseCostCenterTrialBalance([
      {
        account_id: "expense",
        code: "5100",
        name_ar: "مصروف",
        account_type: "expense",
        debit: "60",
        credit: 5,
      },
      {
        account_id: "revenue",
        code: "4100",
        name_ar: "إيراد",
        account_type: "revenue",
        debit: 10,
        credit: "100",
      },
      {
        account_id: "cash",
        code: "1100",
        name_ar: "نقدية",
        account_type: "asset",
        debit: 100,
        credit: 60,
      },
    ]);

    expect(summarizeCostCenterTrialBalance(rows)).toEqual({
      expenseTotal: 55,
      revenueTotal: 90,
      profit: 35,
    });
  });

  it("fails closed instead of turning malformed ledger money into zero", () => {
    expect(() => parseCostCenterTrialBalance({})).toThrow(
      "payload must be an array"
    );
    expect(() =>
      parseCostCenterTrialBalance([
        {
          account_id: "expense",
          code: "5100",
          name_ar: "مصروف",
          account_type: "expense",
          debit: "bad",
          credit: 0,
        },
      ])
    ).toThrow("row 0 is incomplete");
  });

  it("parses the versioned annual aggregate without changing counter-normal amounts", () => {
    expect(
      parseCostCenterHistorySummary({
        version: "farm-os.cost-center-history.v1",
        rows: [
          {
            year: 2025,
            account_id: "expense-account",
            account_code: "5100",
            account_name_ar: "مصروف",
            account_type: "expense",
            cost_center_id: "cost-center",
            center_code: "CC-FARM",
            center_name_ar: "المزرعة",
            amount: "55.25",
          },
          {
            year: 2025,
            account_id: "revenue-account",
            account_code: "4100",
            account_name_ar: "إيراد",
            account_type: "revenue",
            cost_center_id: "unallocated-center",
            center_code: "CC-UNALLOC",
            center_name_ar: "غير موزع",
            amount: "-12",
          },
        ],
      }),
    ).toEqual([
      {
        year: "2025",
        accountId: "expense-account",
        accountCode: "5100",
        accountNameAr: "مصروف",
        accountType: "expense",
        costCenterId: "cost-center",
        centerCode: "CC-FARM",
        centerNameAr: "المزرعة",
        amount: "55.25",
      },
      {
        year: "2025",
        accountId: "revenue-account",
        accountCode: "4100",
        accountNameAr: "إيراد",
        accountType: "revenue",
        costCenterId: "unallocated-center",
        centerCode: "CC-UNALLOC",
        centerNameAr: "غير موزع",
        amount: "-12",
      },
    ]);
  });

  it("fails closed on an unknown annual payload or malformed aggregate row", () => {
    expect(() => parseCostCenterHistorySummary({ version: "v2", rows: [] })).toThrow(
      "payload version is invalid",
    );
    expect(() =>
      parseCostCenterHistorySummary({
        version: "farm-os.cost-center-history.v1",
        rows: [{ year: 2025, amount: "bad" }],
      }),
    ).toThrow("row 0 is incomplete");
    expect(() =>
      parseCostCenterHistorySummary({
        version: "farm-os.cost-center-history.v1",
        rows: [historyRow({ amount: 0.1 })],
      }),
    ).toThrow("row 0 is incomplete");
  });

  it("aggregates decimal-text history exactly before converting final chart values", () => {
    const rows = parseCostCenterHistorySummary({
      version: "farm-os.cost-center-history.v1",
      rows: [historyRow({ amount: "0.1" }), historyRow({ amount: "0.2" })],
    });
    expect(buildCostCenterYearMatrix(rows).rows[0]?.y_2025).toBe("0.3");
    expect(buildCostCenterYearTrend(rows)[0]?.مصروفات).toBe(0.3);
  });

  it("builds and renders exact multi-year matrix and trend values", () => {
    const historyRows = parseCostCenterHistorySummary({
      version: "farm-os.cost-center-history.v1",
      rows: [
        historyRow({ year: 2025, amount: "60" }),
        historyRow({ year: 2024, amount: "100" }),
        historyRow({ year: 2025, amount: "-5" }),
        historyRow({
          year: 2024,
          account_id: "revenue-account",
          account_code: "4100",
          account_name_ar: "إيراد",
          account_type: "revenue",
          cost_center_id: "unallocated-center",
          center_code: "CC-UNALLOC",
          center_name_ar: "غير موزع",
          amount: "250",
        }),
        historyRow({
          year: 2025,
          account_id: "revenue-account",
          account_code: "4100",
          account_name_ar: "إيراد",
          account_type: "revenue",
          amount: "80",
        }),
      ],
    });

    const matrix = buildCostCenterYearMatrix(historyRows);
    expect(matrix.columns.map((column) => column.id)).toEqual([
      "account",
      "type",
      "center",
      "y_2024",
      "y_2025",
    ]);
    expect(matrix.rows).toEqual([
      {
        id: "expense-account:CC-FARM",
        account: "5100 · مصروف",
        type: "مصروف",
        center: "CC-FARM · المزرعة",
        y_2024: "100",
        y_2025: "55",
      },
      {
        id: "revenue-account:CC-UNALLOC",
        account: "4100 · إيراد",
        type: "إيراد",
        center: "CC-UNALLOC · غير موزع",
        y_2024: "250",
      },
      {
        id: "revenue-account:CC-FARM",
        account: "4100 · إيراد",
        type: "إيراد",
        center: "CC-FARM · المزرعة",
        y_2025: "80",
      },
    ]);
    expect(buildCostCenterYearTrend(historyRows)).toEqual([
      { year: "2024", مصروفات: 100, إيرادات: 250, صافي: 150 },
      { year: "2025", مصروفات: 55, إيرادات: 80, صافي: 25 },
    ]);

    const html = renderToStaticMarkup(
      createElement(FilterableTable, {
        columns: matrix.columns,
        rows: matrix.rows,
        ariaLabel: "مصفوفة الحساب والسنة ومركز التكلفة",
        minRowsForSearch: 99,
      }),
    );
    expect(html).toContain("2024");
    expect(html).toContain("2025");
    expect(html).toContain("CC-UNALLOC");
    expect(html).toContain("٢٥٠");
    expect(html).toContain("٥٥");
  });

  it("loads overview or history through one exact atomic snapshot and no direct ledger reads", () => {
    expect(REPORT_PAGE).toContain('sb.rpc("fn_cost_center_reports_snapshot"');
    expect(REPORT_PAGE).toContain('p_include_history: view === "history"');
    expect(REPORT_PAGE).toContain("parseCostCenterReportsSnapshot");
    expect(REPORT_PAGE).toContain("buildCostCenterYearMatrix(visibleHistoryRows)");
    expect(REPORT_PAGE).toContain("safeHistoryTrend(visibleHistoryRows)");
    expect(REPORT_PAGE.match(/\.rpc\(/g)).toHaveLength(1);
    expect(REPORT_PAGE).not.toContain(".from(");
    expect(REPORT_PAGE).not.toContain(".range(");
    expect(REPORT_PAGE).not.toContain("fn_accounting_trial_balance");
    expect(REPORT_PAGE).not.toContain("fn_cost_center_history_summary");
    const chartEnd = REPORT_PAGE.indexOf('</section>\n      )}', REPORT_PAGE.indexOf('aria-labelledby="center-chart-title"'));
    const flagsStart = REPORT_PAGE.indexOf('{(visibleFlags.length > 0 || focus === "flags")');
    expect(chartEnd).toBeGreaterThan(-1);
    expect(flagsStart).toBeGreaterThan(chartEnd);
    expect(REPORT_PAGE).toContain('aria-labelledby="review-flags-title"');
    expect(REPORT_PAGE).toContain('{ id: "expense", header: "مصروفات"');
    expect(REPORT_PAGE).toContain('{ id: "revenue", header: "إيرادات"');
    expect(REPORT_PAGE).toContain("const visibleIds = new Set(visibleRollup.map");
    expect(REPORT_PAGE).toContain("flags.filter((flag) => visibleIds.has(flag.costCenterId))");
    expect(REPORT_PAGE).toContain("costCenterDescendantIds(rollup, row.costCenterId)");
    expect(REPORT_PAGE).toContain("historyRows.filter((row) => historyIds.has(row.costCenterId))");
    expect(REPORT_PAGE).toContain("topmostVisibleCostCenters(rollup, hierarchyRows)");
    expect(REPORT_PAGE).toContain(".filter((row) => row.lineCount > 0)");
  });
});

function historyRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    year: 2025,
    account_id: "expense-account",
    account_code: "5100",
    account_name_ar: "مصروف",
    account_type: "expense",
    cost_center_id: "cost-center",
    center_code: "CC-FARM",
    center_name_ar: "المزرعة",
    amount: "0",
    ...overrides,
  };
}
