import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { failClosedAuthority, isAuthoritative } from "./data-authority";

const financeDashboardSource = readFileSync(
  join(process.cwd(), "app", "(app)", "finance", "dashboard", "page.tsx"),
  "utf8",
);
const occurrences = (source: string, needle: string) => source.split(needle).length - 1;

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
    const initialParallelWave = financeDashboardSource.slice(
      financeDashboardSource.indexOf("const ["),
      financeDashboardSource.indexOf("if (budgetsError)"),
    );
    const budgetKpiGate = financeDashboardSource.slice(
      financeDashboardSource.indexOf("{(budgetsVerified || canSeeAccounting)"),
      financeDashboardSource.indexOf(
        '\n\n      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">',
        financeDashboardSource.indexOf("{(budgetsVerified || canSeeAccounting)"),
      ),
    );
    const budgetChartGate = financeDashboardSource.slice(
      financeDashboardSource.indexOf(
        '{budgetsVerified && (filter === "all" || filter === "budgets") && budgetTotals.approved > 0 && (',
      ),
      financeDashboardSource.indexOf('<div className="no-print">'),
    );
    const budgetPressureGate = financeDashboardSource.slice(
      financeDashboardSource.indexOf('{(filter === "all" || filter === "budgets") && ('),
      financeDashboardSource.indexOf(
        '{(filter === "all" ||\n        filter === "expenses"',
      ),
    );

    expect(initialParallelWave).toContain('getDataAuthority(sb, m.orgId, "budgets")');
    expect(initialParallelWave).toContain('.eq("org_id", m.orgId)');
    expect(financeDashboardSource).toContain(
      "const budgetsVerified = isAuthoritative(budgetAuthority.status);",
    );
    expect(financeDashboardSource).toContain(
      '{budgetsVerified && (\n        <Alert tone="warning" title="أرقام الموازنة لقطة — ليست رقابة حية">',
    );
    expect(budgetKpiGate).toContain("{budgetsVerified && (");
    for (const sink of [
      '<KpiCard label="المعتمد (لقطة)"',
      '<KpiCard label="ملتزم + فعلي (لقطة)"',
      '<KpiCard label="المتاح (لقطة)"',
    ]) {
      expect(occurrences(financeDashboardSource, sink), sink).toBe(1);
      expect(budgetKpiGate, sink).toContain(sink);
    }
    for (const sink of ["<BudgetDoughnut", "<VarianceChart"]) {
      expect(occurrences(financeDashboardSource, sink), sink).toBe(1);
      expect(budgetChartGate, sink).toContain(sink);
    }
    expect(budgetPressureGate).toContain(
      '<Alert tone="warning" title="لا توجد موازنة موثقة" description={DATA_NOT_VERIFIED_AR} />',
    );
    expect(budgetPressureGate).toContain(
      '{budgetsVerified && (\n            <Card title="ضغط الموازنة (لقطة)">',
    );
    const budgetExport = 'exportFilename="finance-dashboard-budget-pressure"';
    expect(occurrences(financeDashboardSource, budgetExport)).toBe(1);
    expect(budgetPressureGate).toContain(budgetExport);
    expect(financeDashboardSource).toContain(
      'requireRole(["owner", "accountant", "farm_manager"])',
    );
  });
});
