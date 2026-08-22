import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { failClosedAuthority, isAuthoritative } from "./data-authority";

const financeDashboardSource = readFileSync(
  join(process.cwd(), "app", "(app)", "finance", "dashboard", "page.tsx"),
  "utf8"
);
const occurrences = (source: string, needle: string) =>
  source.split(needle).length - 1;

describe("data authority", () => {
  it("allows numerical claims only for verified data", () => {
    expect(isAuthoritative("verified")).toBe(true);
    expect(isAuthoritative("partial")).toBe(false);
    expect(isAuthoritative("unverified")).toBe(false);
    expect(isAuthoritative("blocked")).toBe(false);
    expect(isAuthoritative(undefined)).toBe(false);
  });

  it("treats a missing row as unverified", () => {
    expect(failClosedAuthority("budgets")).toEqual({
      domain: "budgets",
      status: "unverified",
      sourceLabel: null,
      recordCount: null,
      notes: null,
    });
  });

  it("fails the finance dashboard budget surfaces closed", () => {
    const budgetKpiGate = financeDashboardSource.slice(
      financeDashboardSource.indexOf("{(budgetsVerified || canSeeAccounting)"),
      financeDashboardSource.indexOf(
        '\n\n      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">',
        financeDashboardSource.indexOf("{(budgetsVerified || canSeeAccounting)")
      )
    );
    const budgetChartGate = financeDashboardSource.slice(
      financeDashboardSource.indexOf("{budgetsVerified &&"),
      financeDashboardSource.indexOf('<div className="no-print">')
    );
    const budgetPressureGate = financeDashboardSource.slice(
      financeDashboardSource.indexOf(
        '{(filter === "all" || filter === "budgets") && ('
      ),
      financeDashboardSource.indexOf(
        '{(filter === "all" ||\n        filter === "expenses"'
      )
    );

    expect(financeDashboardSource).toContain(
      'sb.rpc("fn_finance_dashboard_snapshot"'
    );
    expect(financeDashboardSource).toContain("p_org: m.orgId");
    expect(financeDashboardSource).toContain(
      "const budgetsVerified = isAuthoritative(snapshot.budgetAuthority);"
    );
    expect(financeDashboardSource).toContain(
      '{budgetsVerified && (\n        <Alert tone="warning" title="أرقام الموازنة لقطة — ليست رقابة حية">'
    );
    expect(budgetKpiGate).toContain("{budgetsVerified && (");
    for (const sink of [
      'label="المعتمد (لقطة)"',
      'label="ملتزم + فعلي (لقطة)"',
      'label="المتاح (لقطة)"',
    ]) {
      expect(occurrences(financeDashboardSource, sink), sink).toBe(1);
      expect(budgetKpiGate, sink).toContain(sink);
    }
    for (const sink of ["<BudgetDoughnut", "<VarianceChart"]) {
      expect(occurrences(financeDashboardSource, sink), sink).toBe(1);
      expect(budgetChartGate, sink).toContain(sink);
    }
    expect(budgetPressureGate).toContain('title="لا توجد موازنة موثقة"');
    expect(budgetPressureGate).toContain("description={DATA_NOT_VERIFIED_AR}");
    expect(budgetPressureGate).toContain(
      '{budgetsVerified && (\n            <Card title="ضغط الموازنة (لقطة)">'
    );
    expect(financeDashboardSource).toMatch(
      /const budgetRowsTruncated =\s*snapshot\.budgetSummary\.budgetCount > budgetRows\.length/
    );
    expect(budgetPressureGate).toContain(
      '? undefined\n                        : "finance-dashboard-budget-pressure"'
    );
    expect(financeDashboardSource).toContain(
      'requireRole(["owner", "accountant", "farm_manager"])'
    );
  });
});
