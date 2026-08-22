import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readAppFile = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("finance bounded money summaries", () => {
  it("loads the finance dashboard through one atomic exact snapshot", () => {
    const source = readAppFile("app/(app)/finance/dashboard/page.tsx");
    expect(
      source.split('sb.rpc("fn_finance_dashboard_snapshot"').length - 1
    ).toBe(1);
    expect(source).toContain("parseFinanceDashboardSnapshot(");
    expect(source).toContain(
      "const canSeeAccounting = snapshot.canSeeAccounting;"
    );
    expect(source).not.toContain("Promise.all(");
    expect(source).not.toContain('.from("budgets")');
    expect(source).not.toContain('.from("expenses")');
    expect(source).not.toContain('.from("payment_requests")');
    expect(source).not.toMatch(/\bNumber\(/);
    expect(source).toContain('kind: "money-exact"');
    expect(source).toMatch(
      /kind:\s*"money-exact",\s*numeric:\s*true,\s*decimal:\s*true/
    );
    expect(source).toMatch(
      /sumDecimals\(\s*custodyWithBalance\.map\(\(account\) => account\.balance\)\s*\)\.total/
    );
    expect(source).not.toContain("Number(account.target_float");
    expect(source).not.toContain("sum + account.balance");
  });

  it("keeps unknown displayed expense amounts visible on the finance dashboard", () => {
    const source = readAppFile("app/(app)/finance/dashboard/page.tsx");

    expect(source).toContain("snapshot.expenseSample.drawingUnknownCount");
    expect(source).toContain("snapshot.expenseSample.operatingUnknownCount");
    expect(source).toContain('" + غير معروف"');
    expect(source).toContain('label="طلبات مرسلة ضمن المعروض"');
    expect(source).toContain('label="قريبة الاستحقاق ضمن المعروض"');
    expect(source).not.toContain("exportFilename={expenseExportFilename}");
    expect(source).not.toContain(
      'exportFilename="finance-dashboard-purchase-requests"'
    );
    expect(source).toContain("finance?.unclassifiedExpenseCount ?? 0");
    expect(source).not.toContain("Number(row.expense.total ?? 0)");
  });

  it("labels the supplier expense summary as a bounded latest-row total", () => {
    const source = readAppFile("app/(app)/suppliers/[supplierId]/page.tsx");

    expect(source).toContain(
      '.select("id, date, category, description, total", { count: "exact" })'
    );
    expect(source).toContain(
      '.order("date", { ascending: false, nullsFirst: false })'
    );
    expect(source).toContain('.order("id", { ascending: false })');
    expect(source).toContain(
      'requireExactCount({ count: expenseCount, error: expensesError }, "supplier expenses")'
    );
    expect(source).toContain('"supplier purchase lines"');
    expect(source).toContain('m.role === "owner" || m.role === "accountant"');
    expect(source).toContain("canReadPrivateFinance\n      ? sb");
    expect(source).toContain("const expensesSummary = sumMoney(");
    expect(source).toContain('label="آخر مصروفات معروضة"');
    expect(source).toContain("egpSummary(expensesSummary)");
    expect(source).toContain("num(exactExpenseCount)");
    expect(source).toContain("label: `المالية (${num(exactExpenseCount)})`");
    expect(source).toContain(
      "label: `حركات معروضة (${num((movements ?? []).length)})`"
    );
    expect(source).not.toContain("يعرض الجدول أحدث ٢٠");
    expect(source).not.toContain("expenseCount ?? 0");
    expect(source).not.toContain("prLineCount ??");
    expect(source).not.toContain("Number(expense.total ?? 0)");
  });
});
