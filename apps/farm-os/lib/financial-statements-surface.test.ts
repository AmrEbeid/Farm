import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const balancePage = read("../app/(app)/finance/balance-sheet/page.tsx");
const incomePage = read("../app/(app)/finance/income-statement/page.tsx");
const packageRoute = read("../app/api/finance/statements.pdf/route.ts");
const balanceRoute = read("../app/api/finance/balance-sheet.pdf/route.ts");
const closePage = read("../app/(app)/finance/close/page.tsx");
const periodsPage = read("../app/(app)/finance/periods/page.tsx");

describe("exact compact financial statement surfaces", () => {
  it("uses only the versioned exact statement snapshots", () => {
    expect(balancePage).toContain('.rpc("fn_accounting_balance_sheet_snapshot"');
    expect(incomePage).toContain('.rpc("fn_accounting_income_statement_snapshot"');
    expect(packageRoute).toContain('sb.rpc("fn_accounting_income_statement_snapshot"');
    expect(packageRoute).toContain('sb.rpc("fn_accounting_balance_sheet_snapshot"');
    expect(balanceRoute).toContain('.rpc("fn_accounting_balance_sheet_snapshot"');
    expect([balancePage, incomePage, packageRoute, balanceRoute].join("\n")).not.toMatch(
      /\.rpc\("fn_accounting_(?:balance_sheet|income_statement)"/,
    );
  });

  it("binds every parser to the active organization and requested dates", () => {
    expect(balancePage).toContain("parseBalanceSheet(result.data, member.orgId, asOf)");
    expect(incomePage).toContain("parseIncomeStatement(result.data, member.orgId, start, end)");
    expect(packageRoute).toContain("parseIncomeStatement(incomeRes.data, member.orgId, start, end)");
    expect(packageRoute).toContain("parseBalanceSheet(balanceRes.data, member.orgId, asOf)");
  });

  it("uses the compact shared header and decision strip without KPI cards or nested main landmarks", () => {
    for (const page of [balancePage, incomePage]) {
      expect(page).toContain("<PageHeader");
      expect(page).toContain("<StoryLine");
      expect(page).not.toContain("<KpiCard");
      expect(page).not.toContain("<main");
      expect(page).toContain('className="grid border-y sm:grid-cols-2 lg:grid-cols-4"');
    }
  });

  it("keeps exact-money table and PDF/export paths", () => {
    expect(balancePage).toContain('kind: "money-exact"');
    expect(incomePage).toContain('kind: "money-exact"');
    expect(balancePage).toContain("balanceSheetExportRows(statement.assets)");
    expect(balancePage).toContain("balanceSheetExportRows(statement.equity)");
    expect(incomePage).toContain("incomeStatementExportRows(statement.revenue)");
    expect(incomePage).toContain("incomeStatementExportRows(statement.expenses)");
    expect(balancePage).toContain("/api/finance/balance-sheet.pdf");
    expect(balancePage).toContain("/api/finance/statements.pdf");
    expect(incomePage).toContain("/api/finance/statements.pdf");
    expect(packageRoute).toContain('"Content-Type": "application/pdf"');
  });

  it("makes month close and period protection part of the same compact workflow", () => {
    for (const page of [closePage, periodsPage]) {
      expect(page).toContain("<PageHeader");
      expect(page).toContain("<StoryLine");
      expect(page).not.toContain("<KpiCard");
      expect(page).not.toContain("<main");
    }
    expect(closePage).toContain('.rpc("fn_month_close_summary"');
    expect(closePage).toContain('action={closePeriod}');
    expect(closePage).toContain('disabled={!ready}');
    expect(periodsPage).toContain("parseAccountingPeriods(result.data ?? [], member.orgId)");
    expect(periodsPage).toContain('href="/finance/close"');
    expect(periodsPage).toContain('action={reopenPeriod}');
    expect(periodsPage).not.toContain("truncate text-xs");
    expect(periodsPage).toContain("break-words text-xs leading-5");
  });
});

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
